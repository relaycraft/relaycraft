import os
import threading
import time
from typing import Optional, Any, List
from mitmproxy import http, ctx, tls
from .rules import RuleEngine
from .monitor import TrafficMonitor
from .debug import DebugManager
from .proxy import ProxyManager
from .process_resolver import ProcessResolver
from . import capture_scope
from .utils import setup_logging, RelayCraftLogger, is_reverse_flow
from . import sse_processor, ws_handler

# Global traffic active state (in-memory, controlled via HTTP API)
_traffic_active_event = threading.Event()


def is_traffic_active() -> bool:
    """Check if traffic processing is active."""
    return _traffic_active_event.is_set()


def set_traffic_active(active: bool) -> None:
    """Set traffic processing active state."""
    if active:
        _traffic_active_event.set()
    else:
        _traffic_active_event.clear()


class CoreAddon:
    def __init__(self):
        self.logger: RelayCraftLogger = setup_logging()
        self.rule_engine: RuleEngine = RuleEngine()
        self.debug_mgr: DebugManager = DebugManager()
        self.proxy_mgr: ProxyManager = ProxyManager()
        self.process_resolver: ProcessResolver = ProcessResolver()
        self.traffic_monitor: TrafficMonitor = TrafficMonitor(
            self.debug_mgr, process_resolver=self.process_resolver
        )

    def load(self, loader: Any) -> None:
        """Standard mitmproxy load hook"""
        if hasattr(ctx, "master"):
            ctx.master.relaycraft_main = self

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

        # 2. Check if traffic processing is active. Reverse-mode (share entry)
        # traffic is exempt: visitors must be served even when local capture
        # is paused.
        if not is_traffic_active() and not self._is_reverse_flow(flow):
            flow.kill()
            return

        # Per-process attribution, then the capture-scope gate. Out-of-scope
        # flows pass through untouched: no rule engine, no breakpoints, no
        # recording.
        try:
            process_info = await self.process_resolver.resolve(flow.client_conn)
        except Exception:
            process_info = None
        flow.metadata["_relaycraft_process"] = process_info
        if process_info is not None:
            try:
                self.process_resolver.note_seen(process_info)
            except Exception:
                pass

        if self._is_out_of_capture_scope(flow):
            flow.metadata["_relaycraft_out_of_scope"] = True
            return

        try:
            # Initialize script hits list if not exists
            if not hasattr(flow, "_relaycraft_script_hits"):
                flow._relaycraft_script_hits = []

            # 1. Rule Engine (Automated) - Synchronous
            self.rule_engine.handle_request(flow)

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
        if flow.metadata.get("_relaycraft_out_of_scope"):
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
        try:
            self.traffic_monitor.handle_response(flow)
        except Exception as e:
            self.logger.error(f"Critical error capturing traffic: {e}")
        finally:
            try:
                sse_processor.finalize_sse_flow(self.traffic_monitor, flow, stream_open=False)
            except Exception as e:
                self.logger.debug(f"SSE finalize on response failed: {e}")

        # 4. Access Logging
        if not self.is_internal_request(flow):
            try:
                res_code = flow.response.status_code if flow.response else 0
                res_len = len(flow.response.content) if flow.response and flow.response.content else 0
                self.logger.info(f"{flow.request.method} {flow.request.url} {res_code} {res_len}b")
            except Exception as e:
                self.logger.debug(f"Access log write failed: {e}")

    def is_internal_request(self, flow: http.HTTPFlow) -> bool:
        """Check if request is to RelayCraft internal API"""
        if not flow or not flow.request:
            return False
        # Reverse-mode (share entry) traffic always runs the full pipeline.
        if self._is_reverse_flow(flow):
            return False
        try:
            path = flow.request.path or ""
            host = flow.request.host or ""
            port = flow.request.port

            if host == "relay.guide":
                return True

            is_localhost = host in ["127.0.0.1", "localhost", "::1"]

            # The engine's internal API is only ever reached via loopback (or
            # the relay.guide alias handled above). An external site whose URL
            # path merely contains /_relay is regular traffic and must not be
            # treated as internal.
            if "/_relay" in path and is_localhost:
                return True

            if path == "/cert" or path in ("/cert.pem", "/cert.crt"):
                return True

            current_port = ctx.options.listen_port if (hasattr(ctx, "options") and hasattr(ctx.options, "listen_port")) else 9090
            is_proxy_port = port == current_port

            return is_localhost and is_proxy_port and ("/_relay" in path or path == "/" or path in ("/cert", "/cert.pem", "/cert.crt"))
        except Exception:
            return False

    @staticmethod
    def _is_reverse_flow(flow: http.HTTPFlow) -> bool:
        """Whether the flow entered via a reverse-mode listener (share entry)."""
        return is_reverse_flow(flow)

    def _is_out_of_capture_scope(self, flow: http.HTTPFlow) -> bool:
        """Whether the flow is excluded by the capture scope (fail-open)."""
        try:
            if not capture_scope.is_enabled():
                return False
            if self._is_reverse_flow(flow):
                return False
            process_info = flow.metadata.get("_relaycraft_process")
            return not capture_scope.is_in_scope(process_info)
        except Exception as e:
            self.logger.debug(f"capture scope check failed, treating as in-scope: {e}")
            return False

    def _is_sse_flow(self, flow: http.HTTPFlow) -> bool:
        """Best-effort SSE flow detection for error classification."""
        if not flow:
            return False
        try:
            if flow.metadata.get("_relaycraft_is_sse"):
                return True
            if flow.response and flow.response.headers:
                content_type = flow.response.headers.get("content-type", "")
                return "text/event-stream" in (content_type or "").lower()
        except Exception:
            return False
        return False

    async def error(self, flow: http.HTTPFlow) -> None:
        """Handle errors (e.g. connection failures)"""
        if self.is_internal_request(flow):
            return
        if flow.metadata.get("_relaycraft_out_of_scope"):
            return

        err_msg = str(flow.error)

        # Skip CONNECT client TLS failures (logged by tls_failed_client)
        if flow.request and flow.request.method == "CONNECT":
            err_lower = err_msg.lower()
            if "client" in err_lower and ("disconnect" in err_lower or "tls" in err_lower or "handshake" in err_lower or "closed" in err_lower):
                return

        if self._is_sse_flow(flow) and sse_processor.is_client_disconnect_error(err_msg):
            try:
                sse_processor.finalize_sse_flow(self.traffic_monitor, flow, stream_open=False)
            except Exception as e:
                self.logger.debug(f"SSE finalize on client disconnect failed: {e}")
            return

        self.logger.error(f"RelayCraft: [ERROR] Flow error for {flow.request.pretty_url if (flow.request and hasattr(flow.request, 'pretty_url')) else 'unknown'}: {err_msg}")

        try:
            flow_data = self.traffic_monitor.process_flow(flow)
            if flow_data:
                flow_data["error"] = {
                    "message": err_msg,
                    "errorType": "connection"
                }
                self.traffic_monitor._store_flow(flow_data)
        except Exception as e:
            self.logger.error(f"Error capturing error flow: {e}")
        finally:
            try:
                sse_processor.finalize_sse_flow(self.traffic_monitor, flow, stream_open=False)
            except Exception as e:
                self.logger.debug(f"SSE finalize on error failed: {e}")

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        """Attach SSE stream handler as early as response headers are available."""
        if self.is_internal_request(flow):
            return
        if flow.metadata.get("_relaycraft_out_of_scope"):
            return
        try:
            sse_processor.bind_sse_stream_if_needed(self.traffic_monitor, flow)
        except Exception as e:
            self.logger.error(f"Error binding SSE stream handler: {e}")

    def websocket_start(self, flow: http.HTTPFlow) -> None:
        """Called when a WebSocket connection is established (after handshake)."""
        if self.is_internal_request(flow):
            return
        if flow.metadata.get("_relaycraft_out_of_scope"):
            return

        try:
            flow.metadata["_relaycraft_ws_started"] = True
            ws_handler.register_ws_flow(self.traffic_monitor, flow)
        except Exception as e:
            self.logger.error(f"Error handling WebSocket start: {e}")

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        """Called when a WebSocket message is received."""
        if self.is_internal_request(flow):
            return
        if flow.metadata.get("_relaycraft_out_of_scope"):
            return

        try:
            self.traffic_monitor.handle_websocket_message(flow)
        except Exception as e:
            self.logger.error(f"Error handling WebSocket message: {e}")

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        """Called when a WebSocket connection closes."""
        if self.is_internal_request(flow):
            return
        if flow.metadata.get("_relaycraft_out_of_scope"):
            return

        try:
            flow_data = self.traffic_monitor.process_flow(flow)
            if flow_data:
                self.traffic_monitor._store_flow(flow_data)
        except Exception as e:
            self.logger.error(f"Error handling WebSocket end: {e}")
        finally:
            try:
                ws_handler.unregister_ws_flow(self.traffic_monitor, flow)
            except Exception as e:
                self.logger.debug(f"WS registry unregister failed: {e}")

    def client_connected(self, client: Any) -> None:
        """Start process resolution for local clients (fire-and-forget)."""
        try:
            if is_traffic_active():
                self.process_resolver.start(client)
        except Exception as e:
            self.logger.debug(f"client_connected hook failed: {e}")

    def client_disconnected(self, client: Any) -> None:
        """Drop process-resolution state for the closed client."""
        try:
            self.process_resolver.forget(client)
        except Exception as e:
            self.logger.debug(f"client_disconnected hook failed: {e}")

    def tls_failed_client(self, tls_start: tls.TlsData) -> None:
        """Hook called when a client TLS handshake fails."""
        try:
            self.traffic_monitor.process_tls_error(tls_start)
        except Exception as e:
            self.logger.error(f"Error in tls_failed_client: {e}")
