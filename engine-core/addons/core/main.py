import os
import time
from typing import Optional, Any, List
from mitmproxy import http, ctx, tls
from .rules import RuleEngine
from .monitor import TrafficMonitor
from .debug import DebugManager
from .proxy import ProxyManager
from .utils import setup_logging, RelayCraftLogger

# Global traffic active state (in-memory, controlled via HTTP API)
_traffic_active: bool = False


def is_traffic_active() -> bool:
    """Check if traffic processing is active."""
    return _traffic_active


def set_traffic_active(active: bool) -> None:
    """Set traffic processing active state."""
    global _traffic_active
    _traffic_active = active


class CoreAddon:
    def __init__(self):
        self.logger: RelayCraftLogger = setup_logging()
        self.rule_engine: RuleEngine = RuleEngine()
        self.debug_mgr: DebugManager = DebugManager()
        self.proxy_mgr: ProxyManager = ProxyManager()
        self.traffic_monitor: TrafficMonitor = TrafficMonitor(self.debug_mgr)

    def load(self, loader: Any) -> None:
        """Standard mitmproxy load hook"""
        if hasattr(ctx, "master"):
            ctx.master.relaycraft_main = self
        
        # Note: User scripts are loaded before CoreAddon (see entry.py)

    async def running(self) -> None:
        """Called when proxy is up and running."""
        pass

    async def request(self, flow: http.HTTPFlow) -> None:

        # 1. System / Relay Requests - Handle first and exclusively
        if self.is_internal_request(flow):
            try:
                if hasattr(self.traffic_monitor, "handle_request"):
                    coro = self.traffic_monitor.handle_request(flow)
                    import inspect
                    if inspect.iscoroutine(coro):
                        await coro
            except Exception as e:
                self.logger.error(f"Error handling relay request: {e}")
            return

        # 2. Check if traffic processing is active
        # If not active, kill the connection (simulate proxy off)
        if not is_traffic_active():
            # Kill the connection to simulate proxy being off
            flow.kill()
            return

        try:
            # Initialize script hits list if not exists
            if not hasattr(flow, "_relaycraft_script_hits"):
                flow._relaycraft_script_hits = []

            # 1. Rule Engine (Automated) - Synchronous
            self.rule_engine.handle_request(flow)

            # We don't capture here anymore; anchor.py will handle it in the response phase.
            # EXCEPT if we are mocking a response immediately, then we should still capture.
            if flow.response:
                flow_data = self.traffic_monitor.process_flow(flow)
                if flow_data:
                    self.traffic_monitor._store_flow(flow_data)

            # 2. Interception (Manual/Breakpoint) - Asynchronous
            matched_rule = self.debug_mgr.should_intercept(flow)
            if matched_rule:
                def push_paused():
                    f_data = self.traffic_monitor.process_flow(flow)
                    if f_data:
                        self.traffic_monitor._store_flow(f_data)

                coro = self.debug_mgr.wait_for_resume(flow, "request", on_pause=push_paused, rule=matched_rule)
                import inspect
                if inspect.iscoroutine(coro):
                    await coro
        except Exception as e:
            self.logger.error(f"Critical error in CoreAddon.request: {e}")

    async def response(self, flow: http.HTTPFlow) -> None:
        if self.is_internal_request(flow):
            return

        try:
            # 1. Rule Engine response handling - Synchronous
            self.rule_engine.handle_response(flow)

            # 2. Interception (Manual/Breakpoint) - Asynchronous
            matched_rule = self.debug_mgr.should_intercept(flow, "response")
            if matched_rule:
                def push_paused_res():
                    f_data = self.traffic_monitor.process_flow(flow)
                    if f_data:
                        self.traffic_monitor._store_flow(f_data)

                coro = self.debug_mgr.wait_for_resume(flow, "response", on_pause=push_paused_res, rule=matched_rule)
                import inspect
                if inspect.iscoroutine(coro):
                    await coro
        except Exception as e:
            self.logger.error(f"Critical error in CoreAddon.response hook processing: {e}")

        # 3. Baseline Capture - before anchor.py runs
        # Records BEFORE user scripts, AFTER rules
        try:
            self.traffic_monitor.handle_response(flow)
        except Exception as e:
            self.logger.error(f"Critical error capturing traffic: {e}")

        # 4. Access Logging
        if not self.is_internal_request(flow):
            try:
                res_code = flow.response.status_code if flow.response else 0
                res_len = len(flow.response.content) if flow.response and flow.response.content else 0
                self.logger.info(f"{flow.request.method} {flow.request.url} {res_code} {res_len}b")
            except:
                pass

    def is_internal_request(self, flow: http.HTTPFlow) -> bool:
        """Check if request is to RelayCraft internal API"""
        if not flow or not flow.request:
            return False
        try:
            path = flow.request.path or ""
            host = flow.request.host or ""
            port = flow.request.port

            # relay.guide is always internal (certificate landing page)
            if host == "relay.guide":
                return True

            # Robust: /_relay paths are internal
            if "/_relay" in path or path == "/cert" or path in ("/cert.pem", "/cert.crt"):
                return True

            # Secondary check for localhost on proxy port
            is_localhost = host in ["127.0.0.1", "localhost", "::1"]
            # Dynamically get current port
            current_port = ctx.options.listen_port if (hasattr(ctx, "options") and hasattr(ctx.options, "listen_port")) else 9090
            is_proxy_port = port == current_port

            return is_localhost and is_proxy_port and ("/_relay" in path or path == "/" or path in ("/cert", "/cert.pem", "/cert.crt"))
        except:
            return False

    async def error(self, flow: http.HTTPFlow) -> None:
        """Handle errors (e.g. connection failures)"""
        if self.is_internal_request(flow):
            return

        err_msg = str(flow.error)
        
        # Skip CONNECT client TLS failures (logged by tls_failed_client)
        if flow.request and flow.request.method == "CONNECT":
            err_lower = err_msg.lower()
            if "client" in err_lower and ("disconnect" in err_lower or "tls" in err_lower or "handshake" in err_lower or "closed" in err_lower):
                return

        self.logger.error(f"RelayCraft: [ERROR] Flow error for {flow.request.pretty_url if (flow.request and hasattr(flow.request, 'pretty_url')) else 'unknown'}: {err_msg}")

        # Capture the error flow for the UI so it doesn't just disappear
        try:
            # Mark as error for monitor
            flow_data = self.traffic_monitor.process_flow(flow)
            if flow_data:
                # Add error info to data
                flow_data["error"] = {
                    "message": err_msg,
                    "errorType": "connection"
                }
                self.traffic_monitor._store_flow(flow_data)
        except Exception as e:
            self.logger.error(f"Error capturing error flow: {e}")

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        """Called when a WebSocket message is received."""
        if self.is_internal_request(flow):
            return

        try:
            # Update the flow data with new WebSocket frames
            self.traffic_monitor.handle_websocket_message(flow)
        except Exception as e:
            self.logger.error(f"Error handling WebSocket message: {e}")

    def tls_failed_client(self, tls_start: tls.TlsData) -> None:
        """
        Hook called when a client TLS handshake fails (e.g. unknown CA, pinning).
        This is critical for detecting SSL Pinning issues.
        """
        try:
            # TlsData is lower-level, just pass to error processor
            # For now, trust process_tls_error to format it.
            self.traffic_monitor.process_tls_error(tls_start)
        except Exception as e:
            self.logger.error(f"Error in tls_failed_client: {e}")
