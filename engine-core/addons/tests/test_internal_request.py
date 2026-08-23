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
import tests.mock_mitmproxy  # noqa: F401

# core.main additionally imports mitmproxy.proxy / mitmproxy.tls
sys.modules.setdefault("mitmproxy.proxy", MagicMock())
sys.modules.setdefault("mitmproxy.proxy.mode_specs", MagicMock())
sys.modules.setdefault("mitmproxy.tls", MagicMock())

from core.main import CoreAddon
from core.monitor import TrafficMonitor, is_engine_internal_host


def _make_flow(path: str, host: str, port: int = 443):
    return SimpleNamespace(
        request=SimpleNamespace(path=path, host=host, port=port),
    )


class TestIsInternalRequest(unittest.TestCase):
    def setUp(self):
        # Bypass __init__ (it builds the SQLite-backed TrafficMonitor).
        self.addon = object.__new__(CoreAddon)

    def test_external_url_with_relay_in_path_is_not_internal(self):
        """External sites whose path contains /_relay are regular traffic."""
        flow = _make_flow("/api/_relay/status", "example.com")
        self.assertFalse(self.addon.is_internal_request(flow))

        flow = _make_flow("/_relay", "evil.example.org")
        self.assertFalse(self.addon.is_internal_request(flow))

    def test_loopback_relay_path_is_internal(self):
        for host in ("127.0.0.1", "localhost", "::1"):
            with self.subTest(host=host):
                flow = _make_flow("/_relay/poll?since=0", host)
                self.assertTrue(self.addon.is_internal_request(flow))

    def test_relay_guide_alias_is_internal(self):
        flow = _make_flow("/anything", "relay.guide")
        self.assertTrue(self.addon.is_internal_request(flow))

    def test_external_normal_path_is_not_internal(self):
        flow = _make_flow("/index.html", "example.com")
        self.assertFalse(self.addon.is_internal_request(flow))


class TestMonitorHandleResponseRelayGuard(unittest.TestCase):
    def setUp(self):
        monitor = object.__new__(TrafficMonitor)
        monitor.logger = MagicMock()
        self.captured = []
        monitor.process_flow = lambda flow: {"captured": True}
        monitor._store_flow = lambda data: self.captured.append(data)
        self.monitor = monitor

    def test_external_flow_with_relay_path_is_captured(self):
        flow = _make_flow("/_relay/exfil", "example.com")
        self.monitor.handle_response(flow)
        self.assertEqual(len(self.captured), 1)

    def test_internal_loopback_relay_flow_is_skipped(self):
        for host in ("127.0.0.1", "localhost", "::1", "relay.guide"):
            with self.subTest(host=host):
                self.captured.clear()
                flow = _make_flow("/_relay/poll", host)
                self.monitor.handle_response(flow)
                self.assertEqual(len(self.captured), 0)

    def test_is_engine_internal_host(self):
        self.assertTrue(is_engine_internal_host("127.0.0.1"))
        self.assertTrue(is_engine_internal_host("LOCALHOST"))
        self.assertFalse(is_engine_internal_host("example.com"))
        self.assertFalse(is_engine_internal_host(None))


if __name__ == "__main__":
    unittest.main()
