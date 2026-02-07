import threading
import asyncio
from mitmproxy import http, ctx

class DebugManager:
    def __init__(self):
        self.breakpoints = [] # List of regex/patterns to toggle interception
        self.intercepted_flows = {} # flow_id -> {event: asyncio.Event, flow: HTTPFlow, action: str}
        self.lock = threading.Lock()

    def add_breakpoint(self, pattern: str):
        if not pattern or not pattern.strip():
            return
            
        with self.lock:
            if pattern not in self.breakpoints:
                self.breakpoints.append(pattern)
                ctx.log.info(f"Added breakpoint pattern: {pattern}")

    def remove_breakpoint(self, pattern: str):
        with self.lock:
            if pattern in self.breakpoints:
                self.breakpoints.remove(pattern)

    def should_intercept(self, flow: http.HTTPFlow) -> bool:
        # Never intercept internal requests
        if flow.request.path.startswith("/_relay"):
            return False
            
        url = flow.request.pretty_url
        with self.lock:
            for pattern in self.breakpoints:
                if pattern in url: # Simple substring for now, can be regex or match_url logic
                    return True
        return False

    async def wait_for_resume(self, flow: http.HTTPFlow, phase: str, on_pause=None):
        """Suspend execution and wait for user signal"""
        flow_id = flow.id
        event = asyncio.Event()
        
        with self.lock:
            self.intercepted_flows[flow_id] = {
                "event": event,
                "flow": flow,
                "phase": phase,
                "status": "paused"
            }
            
        ctx.log.info(f"Flow {flow_id} INTERCEPTED at {phase}. Waiting for resume...")
        
        # Notify that we are paused (so UI can see 'intercepted: true')
        if on_pause:
            on_pause()
            
        try:
            # Wait for the resume signal
            await event.wait()
            ctx.log.info(f"Flow {flow_id} RESUMED.")
        finally:
            with self.lock:
                if flow_id in self.intercepted_flows:
                    del self.intercepted_flows[flow_id]

    def resume_flow(self, flow_id: str, modified_data: dict = None):
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
                        ctx.log.info(f"Flow {flow_id} ABORTED by user.")
                    else:
                        # Apply modifications (Header/Body)
                        if info["phase"] == "request":
                            if "requestHeaders" in modified_data:
                                flow.request.headers = http.Headers(**modified_data["requestHeaders"])
                            if "requestBody" in modified_data:
                                flow.request.content = modified_data["requestBody"].encode('utf-8')
                        else:
                            if "responseHeaders" in modified_data:
                                flow.response.headers = http.Headers(**modified_data["responseHeaders"])
                            if "responseBody" in modified_data:
                                flow.response.content = modified_data["responseBody"].encode('utf-8')
                            if "statusCode" in modified_data:
                                flow.response.status_code = int(modified_data["statusCode"])

                # Signal the event
                asyncio.get_event_loop().call_soon_threadsafe(info["event"].set)
                return True
        return False
