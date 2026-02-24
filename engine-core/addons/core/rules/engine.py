from typing import List, Dict, Any, Optional
from mitmproxy import http, ctx
from mitmproxy.http import Response
from .loader import RuleLoader
from .matcher import RuleMatcher
from .actions import ActionExecutor
from ..utils import setup_logging
import time # Added for new record_rule_hit

class RuleEngine:
    def __init__(self):
        self.logger = setup_logging()
        self.loader = RuleLoader()
        self.matcher = RuleMatcher()
        self.executor = ActionExecutor(self)

    def handle_request(self, flow: http.HTTPFlow) -> None:
        """Standard matching and request-phase pipeline execution"""
        self.loader.load_rules()
        matched_rules = []

        # 1. Tiered Candidate Selection
        host = flow.request.host
        candidates = []

        # Add Global Rules
        candidates.extend(self.loader.global_rules)
        # Add Exact Host Matches
        if host in self.loader.exact_host_rules:
            candidates.extend(self.loader.exact_host_rules[host])
        # Add Wildcard/Complex Host Matches
        candidates.extend(self.loader.wildcard_host_rules)

        # Sort by priority for deterministic execution
        candidates.sort(key=lambda r: (
            r.get("execution", {}).get("priority", 9999),
            r.get("name", ""),
            r.get("id", "")
        ))

        # 2. Identify all matching rules (Optimized matching)
        for rule in candidates:
            # Check enabled status (should be True by default)
            if not rule.get("execution", {}).get("enabled", True):
                continue

            matched, url_match = self.matcher.match_rule(flow, rule)
            if matched:
                # Store match context for this flow
                rc = rule.copy()
                # Ensure url_match groups are serializable
                if url_match and hasattr(url_match, "expand"):
                    rc["_url_match_data"] = {
                        "groups": url_match.groups(),
                        "groupdict": url_match.groupdict(),
                        "string": url_match.string
                    }
                    # Transient reference for immediate request phase
                    rc["_url_match_transient"] = url_match

                matched_rules.append(rc)

                # Record hit
                self.record_rule_hit(flow, rule)

                # stopOnMatch prevents further matching
                if rule.get("execution", {}).get("stopOnMatch", False):
                    break

        if matched_rules:
            flow.metadata["_relaycraft_matched_rules"] = matched_rules
            # 2. Execute Request Pipeline
            self.execute_pipeline(flow, "request")

    def handle_response(self, flow: http.HTTPFlow) -> None:
        """Execute response-phase pipeline for already matched rules"""
        # Skip if flow was terminated in request phase (e.g. Map Local / Block)
        if flow.metadata.get("_relaycraft_terminated"):
            return

        # Execute Response Pipeline
        self.execute_pipeline(flow, "response")

    def execute_pipeline(self, flow: http.HTTPFlow, phase: str) -> None:
        """Execute actions in a deterministic pipeline order"""
        matched_rules = flow.metadata.get("_relaycraft_matched_rules", [])
        if not matched_rules:
            return

        # Collect all actions and their rule context
        all_actions = []
        for rule in matched_rules:
            url_match = rule.get("_url_match_transient")

            for action in rule.get("actions", []):
                a = action.copy()
                a["_rule_id"] = rule.get("id")
                a["_rule_name"] = rule.get("name")
                a["_url_match_data"] = rule.get("_url_match_data")
                a["_url_match_transient"] = url_match
                all_actions.append(a)

        if phase == "request":
            # 1. Network Actions (Latency / Packet Loss)
            # Must run first so delay/loss applies before mock or block
            for a in [act for act in all_actions if act.get("type") == "throttle"]:
                self.executor.apply_throttle(flow, a, phase="request")

            # 2. Terminal Actions (Short-circuit content modification)
            # Block Request
            for a in [act for act in all_actions if act.get("type") == "block_request"]:
                from mitmproxy.http import Response
                flow.response = Response.make(403, b"Blocked by RelayCraft Rule")
                self.logger.info(f"Pipeline: [BLOCK] {a.get('_rule_name')}")
                flow.metadata["_relaycraft_terminated"] = True
                return

            # Map Local / Map Remote
            for a in [act for act in all_actions if act.get("type") in ["map_local", "map_remote"]]:
                if a.get("type") == "map_local":
                    self.executor.apply_map_local(flow, a, a.get("_url_match_transient") or a.get("_url_match_data"))
                else:
                    self.executor.apply_map_remote(flow, a, a.get("_url_match_transient") or a.get("_url_match_data"))

                if flow.response:
                    flow.metadata["_relaycraft_terminated"] = True
                    return

            # 3. Modification Actions
            # Rewrite Header (Request)
            for a in [act for act in all_actions if act.get("type") == "rewrite_header"]:
                headers_config = a.get("headers")
                if headers_config:
                    self.executor.apply_rewrite_header(flow, headers_config, "request")

            # Rewrite Body (Request)
            for a in [act for act in all_actions if act.get("type") == "rewrite_body" and act.get("target") == "request"]:
                self.executor.apply_rewrite_body(flow, a, a.get("_url_match_transient") or a.get("_url_match_data"))

        elif phase == "response":
            # 1. Network Actions (Bandwidth Throttling)
            for a in [act for act in all_actions if act.get("type") == "throttle"]:
                self.executor.apply_throttle(flow, a, phase="response")

            # 2. Map Remote (Response Headers)
            for a in [act for act in all_actions if act.get("type") == "map_remote"]:
                headers_config = a.get("headers")
                if headers_config:
                    self.executor.apply_rewrite_header(flow, headers_config, "response")

            # 3. Modification Actions
            # Rewrite Header (Response)
            for a in [act for act in all_actions if act.get("type") == "rewrite_header"]:
                headers_config = a.get("headers")
                if headers_config:
                    self.executor.apply_rewrite_header(flow, headers_config, "response")

            # Rewrite Body (Response)
            for a in [act for act in all_actions if act.get("type") == "rewrite_body" and act.get("target", "response") == "response"]:
                self.executor.apply_rewrite_body(flow, a, a.get("_url_match_transient") or a.get("_url_match_data"))

    def record_hit(self, flow: http.HTTPFlow, id: str, name: str, type: str = "rule", status: str = "success", message: str = None, timestamp: float = None):
        """Standardized hit recording (HAR-like metadata structure)"""
        if "_relaycraft_hits" not in flow.metadata:
            flow.metadata["_relaycraft_hits"] = []

        if timestamp is None:
            timestamp = time.time()

        hit_info = {
            "id": id,
            "name": name,
            "type": type,
            "status": status,
            "timestamp": timestamp
        }
        if message:
            hit_info["message"] = message

        # Deduplicate by id+type
        for i, h in enumerate(flow.metadata["_relaycraft_hits"]):
            if h.get("id") == id and h.get("type") == type:
                # Update if new status overrides
                if status != "success" or h.get("status") == "unknown":
                    flow.metadata["_relaycraft_hits"][i].update(hit_info)
                    flow.metadata["_relaycraft_dirty"] = True
                return

        flow.metadata["_relaycraft_hits"].append(hit_info)
        flow.metadata["_relaycraft_dirty"] = True

    def record_rule_hit(self, flow: http.HTTPFlow, rule: dict, status="success", message=None):
        """Backward compatible wrapper for RuleEngine"""
        rule_id = rule.get("id", "")
        rule_name = rule.get("name", "Unknown Rule")
        rule_type = rule.get("type", "unknown")
        self.record_hit(flow, id=rule_id, name=rule_name, type=rule_type, status=status, message=message)
        # Mark as dirty for anchor.py re-sync
        flow.metadata["_relaycraft_dirty"] = True
