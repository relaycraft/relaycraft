import os
import time
from pathlib import Path
from typing import Optional, Any, List
from mitmproxy import http, ctx, tls
from .rules import RuleEngine
from .monitor import TrafficMonitor
from .debug import DebugManager
from .proxy import ProxyManager
from .utils import setup_logging, RelayCraftLogger
from injector import inject_tracking


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
        self._scripts_wrapped: bool = False

    def load(self, loader: Any) -> None:
        """Standard mitmproxy load hook"""
        if hasattr(ctx, "master"):
            ctx.master.relaycraft_main = self

    async def running(self) -> None:
        """Called when proxy is up and running. Good time for discovery."""
        if not self._scripts_wrapped:
            self.logger.info("RelayCraft: Performing initial script discovery...")
            self.discover_and_wrap_scripts()
            self._scripts_wrapped = True

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

        # 3. Baseline Capture - Synchronous
        # This records the state BEFORE user scripts process it (or AFTER rules)
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

            # Robust Check: Any path containing /_relay is internal
            if "/_relay" in path or path == "/cert" or path in ("/cert.pem", "/cert.crt"):
                return True

            # Secondary check for localhost on proxy port
            is_localhost = host in ["127.0.0.1", "localhost", "::1"]
            # Dynamically check against the actual running port
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
        self.logger.error(f"RelayCraft: [ERROR] Flow error for {flow.request.pretty_url if (flow.request and hasattr(flow.request, 'pretty_url')) else 'unknown'}: {err_msg}")

        # Capture the error flow for the UI so it doesn't just disappear
        try:
            # Mark it as an error for the monitor
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

    def tls_failed_client(self, tls_start: tls.TlsData) -> None:
        """
        Hook called when a client TLS handshake fails (e.g. unknown CA, pinning).
        This is critical for detecting SSL Pinning issues.
        """
        try:
            # We filter out internal stuff if possible, but TlsData is lower level
            # Check context or address if needed.
            # For now, we trust process_tls_error to format it nicely.
            self.traffic_monitor.process_tls_error(tls_start)
        except Exception as e:
            self.logger.error(f"Error in tls_failed_client: {e}")

    def discover_and_wrap_scripts(self) -> None:
        """Discover and wrap all loaded script addons."""
        try:
            count = 0
            potential_scripts = []

            # 1. Discover built-in addons (chains)
            for addon in ctx.master.addons.chain:
                # Is it a direct script?
                if hasattr(addon, "path"):
                    potential_scripts.append(addon)

                # Is it a ScriptLoader? (Mitmproxy 10+)
                a_type = type(addon).__name__
                if "ScriptLoader" in a_type:
                    # Look for children
                    for attr in ["addons", "scripts"]:
                        subs = getattr(addon, attr, [])
                        if subs:
                            potential_scripts.extend(list(subs))

            # 2. Add user scripts from environment variable (Passed by Rust)
            user_scripts_env = os.environ.get("RELAYCRAFT_USER_SCRIPTS", "")
            if user_scripts_env:
                for path_str in user_scripts_env.split(";"):
                    if not path_str: continue
                    path = Path(path_str)
                    if path.exists():
                        try:
                            # Load script into mitmproxy
                            # We use loader.add to ensure it's managed by mitmproxy
                            self.logger.info(f"RelayCraft: Loading user script: {path}")
                            ctx.master.addons.add(str(path))
                            count += 1
                        except Exception as e:
                            self.logger.error(f"Failed to load user script {path}: {e}")

            # Re-discover after adding
            potential_scripts = []
            for addon in ctx.master.addons.chain:
                if hasattr(addon, "path"):
                    potential_scripts.append(addon)
                a_type = type(addon).__name__
                if "ScriptLoader" in a_type:
                    for attr in ["addons", "scripts"]:
                        subs = getattr(addon, attr, [])
                        if subs: potential_scripts.extend(list(subs))

            for script in potential_scripts:
                if script is self: continue

                path = getattr(script, "path", None)
                if not path: path = getattr(script, "filename", None)

                if path:
                    spath = str(path).lower().replace("\\", "/")
                    if "core" not in spath and "anchor.py" not in spath and "entry.py" not in spath:
                        self.wrap_script_addon(script)
                        count += 1

            if count > 0:
                self.logger.info(f"RelayCraft: Initialized tracking for {count} user scripts")
            else:
                self.logger.info("RelayCraft: No user scripts found to wrap.")
        except Exception as e:
            self.logger.error(f"RelayCraft: Discovery error: {e}")
            import traceback
            self.logger.error(traceback.format_exc())

    def wrap_script_addon(self, addon: Any) -> None:
        """Dynamic wrapping logic using AST injection"""
        try:
            path = getattr(addon, "path", None)
            if not path:
                path = getattr(addon, "filename", None)
            if not path:
                return

            self.logger.info(f"RelayCraft: Injecting tracking into {path}")

            # Read source
            with open(path, "r", encoding="utf-8") as f:
                source = f.read()

            # Inject tracking
            modified_source = inject_tracking(source)

            # NOTE: For mitmproxy addons, they are already loaded.
            # However, since this happens in the 'running' hook,
            # we can actually modify the addon instance's methods.
            # But it's cleaner to re-execute the modified source in the addon's context
            # or replace the hook functions.

            # Simple strategy: compile and exec modified source within the addon's namespace
            # This follows how mitmproxy's ScriptLoader works.
            code = compile(modified_source, str(path), "exec")
            # Clear existing hooks to prevent duplicate/old logic
            for hook in {"request", "response", "error", "websocket_message"}:
                if hasattr(addon, hook):
                    delattr(addon, hook)

            # Execute modified code in the addon's __dict__
            # This will populate it with the fresh (injected) hook functions
            exec(code, addon.__dict__)

        except Exception as e:
            self.logger.error(f"RelayCraft: Failed to wrap script {getattr(addon, 'path', 'unknown')}: {e}")
