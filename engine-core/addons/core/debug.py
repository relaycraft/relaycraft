import threading
import asyncio
import re
from typing import List, Dict, Any, Optional, Callable
from mitmproxy import http, ctx
from .utils import setup_logging

class DebugManager:
    def __init__(self):
        self.logger = setup_logging()
        # List of breakpoint rule objects with format:
        # { id, pattern, matchType: "contains"|"exact"|"regex",
        #   breakOnRequest: bool, breakOnResponse: bool, enabled: bool }
        self.breakpoints: List[Dict[str, Any]] = []
        self.intercepted_flows: Dict[str, Dict[str, Any]] = {} # flow_id -> {event: asyncio.Event, flow: HTTPFlow, phase: str}
        self.lock = threading.Lock()

    def add_breakpoint(self, rule: Dict[str, Any]):
        """Add a breakpoint rule. Can be called with:
        - { pattern: "..." } - simple pattern string (legacy)
        - { id, pattern, matchType, breakOnRequest, breakOnResponse, enabled } - full rule
        """
        if not rule:
            return

        # Legacy support: if rule is just a pattern string
        if isinstance(rule, str):
            rule = {"pattern": rule, "matchType": "contains"}

        pattern = rule.get("pattern")
        if not pattern or not pattern.strip():
            return

        # Set defaults
        rule.setdefault("id", pattern)
        rule.setdefault("matchType", "contains")
        rule.setdefault("breakOnRequest", True)
        rule.setdefault("breakOnResponse", False)
        rule.setdefault("enabled", True)

        with self.lock:
            # Check if already exists by ID
            rule_id = rule.get("id")
            exists = False
            for i, bp in enumerate(self.breakpoints):
                if bp.get("id") == rule_id:
                    self.breakpoints[i] = rule
                    exists = True
                    break

            if not exists:
                self.breakpoints.append(rule)
                self.logger.info(f"Added breakpoint: {pattern} (matchType: {rule.get('matchType')})")

    def remove_breakpoint(self, id_or_pattern: str) -> None:
        """Remove breakpoint by ID or pattern (for backwards compatibility)"""
        with self.lock:
            self.breakpoints = [
                bp for bp in self.breakpoints
                if bp.get("id") != id_or_pattern and bp.get("pattern") != id_or_pattern
            ]

    def _match_url(self, url: str, rule: Dict[str, Any]) -> bool:
        """Check if URL matches a breakpoint rule based on matchType"""
        pattern = rule.get("pattern", "")
        match_type = rule.get("matchType", "contains")

        try:
            if match_type == "exact":
                return url == pattern
            elif match_type == "regex":
                return bool(re.search(pattern, url, re.IGNORECASE))
            else:  # contains (default)
                return pattern in url
        except re.error:
            # Invalid regex, fall back to contains
            return pattern in url

    def _record_breakpoint_hit(self, flow: http.HTTPFlow, phase: str, rule: Optional[Dict[str, Any]] = None) -> None:
        """Record breakpoint hit in flow metadata for display in traffic list"""
        if not hasattr(flow, "_relaycraft_breakpoint_hits"):
            flow._relaycraft_breakpoint_hits = []

        import time
        rule_id = rule.get("id", "unknown") if rule else "unknown"
        rule_name = rule.get("pattern", "Breakpoint") if rule else "Breakpoint"

        # Check for duplicate
        hit_id = f"breakpoint:{rule_id}:{phase}"
        for existing in flow._relaycraft_breakpoint_hits:
            if existing.get("id") == hit_id:
                return

        flow._relaycraft_breakpoint_hits.append({
            "id": hit_id,
            "name": rule_name,
            "type": "breakpoint",
            "status": "success",
            "phase": phase,
            "timestamp": time.time()
        })
        self.logger.info(f"Recorded breakpoint hit for {flow.id}: {rule_name} ({phase})")

    def should_intercept(self, flow: http.HTTPFlow, phase: str = "request") -> Optional[Dict[str, Any]]:
        """Check if the flow should be intercepted at the given phase.
        phase: "request" or "response"
        Returns: The matching rule dict if should intercept, None otherwise
        """
        # Never intercept internal requests
        if flow.request.path.startswith("/_relay"):
            return None

        url = flow.request.pretty_url

        with self.lock:
            for rule in self.breakpoints:
                if not rule.get("enabled", True):
                    continue

                # Check phase
                if phase == "request" and not rule.get("breakOnRequest", True):
                    continue
                if phase == "response" and not rule.get("breakOnResponse", False):
                    continue

                # Check URL match
                if self._match_url(url, rule):
                    self.logger.info(f"Breakpoint matched: {rule.get('pattern')} for {url} ({phase})")
                    return rule

        return None

    async def wait_for_resume(self, flow: http.HTTPFlow, phase: str, on_pause: Optional[Callable[[], Any]] = None, rule: Optional[Dict[str, Any]] = None) -> None:
        """Suspend execution and wait for user signal"""
        flow_id = flow.id
        event = asyncio.Event()

        with self.lock:
            self.intercepted_flows[flow_id] = {
                "event": event,
                "flow": flow,
                "phase": phase,
                "status": "paused",
                "rule": rule
            }

        # Record breakpoint hit in flow metadata (for display in traffic list)
        self._record_breakpoint_hit(flow, phase, rule)

        self.logger.info(f"Flow {flow_id} INTERCEPTED at {phase}. Waiting for resume...")

        # Notify that we are paused (so UI can see 'intercepted: true')
        if on_pause:
            on_pause()

        try:
            # Wait for the resume signal
            await event.wait()
            self.logger.info(f"Flow {flow_id} RESUMED.")
        finally:
            with self.lock:
                if flow_id in self.intercepted_flows:
                    del self.intercepted_flows[flow_id]

    def resume_flow(self, flow_id: str, modified_data: Optional[Dict[str, Any]] = None) -> bool:
        """Signal a flow to resume, optionally applying modifications"""
        with self.lock:
            if flow_id in self.intercepted_flows:
                info = self.intercepted_flows[flow_id]
                flow = info["flow"]

                if modified_data:
                    # Check for explicit abort action
                    if modified_data.get("action") == "abort":
                        # Mark as aborted for the UI
                        flow.metadata["_relaycraft_aborted"] = True
                        flow.kill()
                        self.logger.info(f"Flow {flow_id} ABORTED by user.")
                    else:
                        # Apply modifications (Header/Body)
                        if info["phase"] == "request":
                            if "requestHeaders" in modified_data:
                                flow.request.headers.clear()
                                for k, v in modified_data["requestHeaders"].items():
                                    flow.request.headers[k] = v
                            if "requestBody" in modified_data:
                                flow.request.content = modified_data["requestBody"].encode('utf-8')
                        else:
                            if "responseHeaders" in modified_data:
                                flow.response.headers.clear()
                                for k, v in modified_data["responseHeaders"].items():
                                    flow.response.headers[k] = v
                            if "responseBody" in modified_data:
                                flow.response.content = modified_data["responseBody"].encode('utf-8')
                            if "statusCode" in modified_data:
                                flow.response.status_code = int(modified_data["statusCode"])

                # Signal the event safely
                # Use call_soon_threadsafe with the event's loop to avoid Windows ProactorEventLoop issues
                try:
                    loop = info["event"]._loop if hasattr(info["event"], '_loop') else None
                    if loop is None:
                        # Fallback: try to get running loop
                        try:
                            loop = asyncio.get_running_loop()
                        except RuntimeError:
                            loop = asyncio.get_event_loop()
                    loop.call_soon_threadsafe(info["event"].set)
                except Exception as e:
                    # Last resort: set directly (may cause warning but works)
                    self.logger.warn(f"Could not signal event safely: {e}")
                    info["event"].set()
                return True
        return False
