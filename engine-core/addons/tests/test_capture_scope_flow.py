import asyncio
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

# Mock mitmproxy modules before importing core modules
import tests.mock_mitmproxy as mock_env

# is_reverse_client() does `from mitmproxy.proxy import mode_specs` at call
# time; `from X import Y` resolves via getattr on the parent mock, so the
# parent's .mode_specs attribute must point at the same mock we configure.
_mode_specs_mock = MagicMock()
_proxy_mock = MagicMock()
_proxy_mock.mode_specs = _mode_specs_mock
sys.modules["mitmproxy.proxy"] = _proxy_mock
sys.modules["mitmproxy.proxy.mode_specs"] = _mode_specs_mock

from core import capture_scope
from core.main import CoreAddon, set_traffic_active


class _ReverseMode:
    pass


# mode_specs is a MagicMock in tests; give ReverseMode a real class so
# isinstance() checks work.
_mode_specs_mock.ReverseMode = _ReverseMode


def _make_addon():
    addon = object.__new__(CoreAddon)
    addon.logger = MagicMock()
    addon.rule_engine = MagicMock()
    addon.debug_mgr = MagicMock()
    addon.traffic_monitor = MagicMock()
    addon.debug_mgr.should_intercept.return_value = None
    addon.process_resolver = MagicMock()
    return addon


def _make_flow(process_info=None, proxy_mode=None, host="example.com", path="/index.html"):
    client_conn = SimpleNamespace(
        id="conn1",
        peername=("127.0.0.1", 50001),
        sockname=("127.0.0.1", 8080),
        proxy_mode=proxy_mode if proxy_mode is not None else object(),
        address=("127.0.0.1", 50001),
    )
    flow = SimpleNamespace(
        id="flow1",
        metadata={},
        client_conn=client_conn,
        request=SimpleNamespace(
            method="GET",
            url=f"http://{host}{path}",
            pretty_url=f"http://{host}{path}",
            path=path,
            host=host,
            port=443 if host == "example.com" else 18080,
            headers={},
            content=b"",
        ),
        response=None,
        error=None,
    )
    return flow


class TestCaptureScopeRequestGate(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        capture_scope.set_config({"include": [], "exclude": []})
        set_traffic_active(True)
        self.addCleanup(set_traffic_active, False)
        self.addCleanup(capture_scope.set_config, {"include": [], "exclude": []})

    def _resolver_returning(self, info):
        resolver = MagicMock()

        async def _resolve(client, timeout=0.25):
            return info

        resolver.resolve = _resolve
        resolver.peek = lambda client: info
        return resolver

    async def test_out_of_scope_flow_skips_rule_engine_and_storage(self):
        capture_scope.set_config({"include": ["curl"], "exclude": []})
        addon = _make_addon()
        addon.process_resolver = self._resolver_returning(
            {"pid": 1, "name": "python", "path": None}
        )
        flow = _make_flow()

        await addon.request(flow)

        self.assertTrue(flow.metadata.get("_relaycraft_out_of_scope"))
        self.assertEqual(
            flow.metadata.get("_relaycraft_process"),
            {"pid": 1, "name": "python", "path": None},
        )
        addon.rule_engine.handle_request.assert_not_called()
        addon.debug_mgr.should_intercept.assert_not_called()
        addon.traffic_monitor.process_flow.assert_not_called()

    async def test_in_scope_flow_runs_rule_engine(self):
        capture_scope.set_config({"include": ["python"], "exclude": []})
        addon = _make_addon()
        addon.process_resolver = self._resolver_returning(
            {"pid": 1, "name": "python", "path": None}
        )
        flow = _make_flow()

        await addon.request(flow)

        self.assertFalse(flow.metadata.get("_relaycraft_out_of_scope", False))
        addon.rule_engine.handle_request.assert_called_once_with(flow)
        # Captured flows feed the recent-process registry (picker source).
        addon.process_resolver.note_seen.assert_called_once_with(
            {"pid": 1, "name": "python", "path": None}
        )

    async def test_internal_request_never_resolves_or_registers_seen(self):
        addon = _make_addon()
        addon.process_resolver = MagicMock()
        flow = _make_flow(host="127.0.0.1", path="/_relay/poll")

        await addon.request(flow)

        addon.process_resolver.resolve.assert_not_called()
        addon.process_resolver.note_seen.assert_not_called()
        addon.rule_engine.handle_request.assert_not_called()
        # Internal API is dispatched to the monitor instead.
        addon.traffic_monitor.handle_request.assert_called_once_with(flow)

    async def test_reverse_flow_is_exempt_from_scope(self):
        capture_scope.set_config({"include": ["curl"], "exclude": []})
        addon = _make_addon()
        addon.process_resolver = self._resolver_returning(
            {"pid": 1, "name": "python", "path": None}
        )
        flow = _make_flow(proxy_mode=_ReverseMode())

        await addon.request(flow)

        self.assertFalse(flow.metadata.get("_relaycraft_out_of_scope", False))
        addon.rule_engine.handle_request.assert_called_once_with(flow)

    async def test_unknown_process_out_of_scope_under_include(self):
        capture_scope.set_config({"include": ["curl"], "exclude": []})
        addon = _make_addon()
        addon.process_resolver = self._resolver_returning(None)
        flow = _make_flow()

        await addon.request(flow)

        self.assertTrue(flow.metadata.get("_relaycraft_out_of_scope"))
        addon.rule_engine.handle_request.assert_not_called()

    async def test_response_and_ws_hooks_skip_out_of_scope(self):
        addon = _make_addon()
        flow = _make_flow()
        flow.metadata["_relaycraft_out_of_scope"] = True

        await addon.response(flow)
        addon.responseheaders(flow)
        addon.websocket_start(flow)
        addon.websocket_message(flow)
        addon.websocket_end(flow)
        await addon.error(flow)

        addon.rule_engine.handle_response.assert_not_called()
        addon.traffic_monitor.handle_response.assert_not_called()
        addon.traffic_monitor.handle_websocket_message.assert_not_called()
        addon.traffic_monitor.process_flow.assert_not_called()
        addon.traffic_monitor.process_tls_error.assert_not_called()


if __name__ == "__main__":
    unittest.main()
