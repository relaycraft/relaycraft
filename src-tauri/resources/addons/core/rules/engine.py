import time
from mitmproxy import http, ctx
from mitmproxy.http import Response
from .loader import RuleLoader
from .matcher import RuleMatcher
from .actions import ActionExecutor

class RuleEngine:
    def __init__(self):
        self.loader = RuleLoader()
        self.matcher = RuleMatcher()
        self.executor = ActionExecutor(self)
        
    def handle_request(self, flow: http.HTTPFlow):
        """Standard matching and request-phase pipeline execution"""
        self.loader.load_rules()
        matched_rules = []
        
        # 1. Identify all matching rules (One-time matching)
        for rule in self.loader.rules:
            # Check enabled status from execution object
            if not rule.get("execution", {}).get("enabled", True):
                continue
            
            matched, url_match = self.matcher.match_rule(flow, rule)
            if matched:
                # Store match context in rule object for this flow
                rc = rule.copy()
                # Ensure url_match data is serializable (don't store the Match object directly)
                if url_match and hasattr(url_match, "expand"):
                    rc["_url_match_data"] = {
                        "groups": url_match.groups(),
                        "groupdict": url_match.groupdict(),
                        "string": url_match.string
                    }
                    # Keep a transient reference for the immediate request phase
                    rc["_url_match_transient"] = url_match
                
                matched_rules.append(rc)
                
                # Record hit (Even if some actions are for response phase)
                self.record_rule_hit(flow, rule)
                
                # stopOnMatch prevents FURTHER rules from matching
                if rule.get("execution", {}).get("stopOnMatch", False):
                    break

        if matched_rules:
            flow.metadata["_relaycraft_matched_rules"] = matched_rules
            # 2. Execute Request Pipeline
            self.execute_pipeline(flow, "request")

    def handle_response(self, flow: http.HTTPFlow):
        """Execute response-phase pipeline for already matched rules"""
        # Skip if flow was terminated in request phase (e.g. Map Local / Block)
        if flow.metadata.get("_relaycraft_terminated"):
            return

        # Execute Response Pipeline
        self.execute_pipeline(flow, "response")

    def execute_pipeline(self, flow: http.HTTPFlow, phase: str):
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
            # 1. Terminal Actions (Short-circuit)
            # Block Request
            for a in [act for act in all_actions if act.get("type") == "block_request"]:
                flow.response = Response.make(403, b"Blocked by RelayCraft Rule")
                ctx.log.info(f"Pipeline: [BLOCK] {a.get('_rule_name')}")
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

            # 2. Modification Actions
            # Rewrite Header (Request)
            for a in [act for act in all_actions if act.get("type") == "rewrite_header"]:
                headers_config = a.get("headers")
                if headers_config:
                    self.executor.apply_rewrite_header(flow, headers_config, "request")

            # Rewrite Body (Request)
            for a in [act for act in all_actions if act.get("type") == "rewrite_body" and act.get("target") == "request"]:
                self.executor.apply_rewrite_body(flow, a, a.get("_url_match_transient") or a.get("_url_match_data"))

            # 3. Network Actions (Latency / Packet Loss)
            for a in [act for act in all_actions if act.get("type") == "throttle"]:
                self.executor.apply_throttle(flow, a, phase="request")

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

    def record_hit(self, flow: http.HTTPFlow, id: str, name: str, type: str = "rule", status: str = "success", message: str = None, ts: float = None):
        """Standardized hit recording (HAR-like metadata structure)"""
        if "_relaycraft_hits" not in flow.metadata:
            flow.metadata["_relaycraft_hits"] = []
            
        if ts is None:
            ts = time.time()
            
        hit_info = {
            "id": id,
            "name": name,
            "type": type,
            "status": status,
            "ts": ts
        }
        if message:
            hit_info["message"] = message
            
        # Deduplicate
        for i, h in enumerate(flow.metadata["_relaycraft_hits"]):
            if h.get("id") == id and h.get("type") == type:
                # Update if new status is not success or if message is new
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
        # Performance: Mark as dirty for final capture re-sync
        flow.metadata["_relaycraft_dirty"] = True
