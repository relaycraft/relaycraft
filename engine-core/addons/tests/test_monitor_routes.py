import os
import sys
import unittest
from types import SimpleNamespace

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

# Mock mitmproxy modules before importing monitor
import tests.mock_mitmproxy  # noqa: F401

from core.monitor import TrafficMonitor


def _make_flow(path: str, method: str = "GET", host: str = "127.0.0.1"):
    return SimpleNamespace(
        request=SimpleNamespace(path=path, method=method, host=host),
    )


class TestMonitorRouteResolution(unittest.TestCase):
    def test_resolve_request_route_table_driven(self):
        monitor = object.__new__(TrafficMonitor)
        cases = [
            ("GET", "/_relay/poll?since=0", "127.0.0.1", "relay_poll"),
            ("GET", "/_relay/detail?id=f1", "127.0.0.1", "relay_detail"),
            ("GET", "/_relay/sse?flow_id=f1", "127.0.0.1", "relay_sse"),
            ("POST", "/_relay/ws/inject", "127.0.0.1", "relay_ws_inject"),
            ("POST", "/_relay/import_session", "127.0.0.1", "relay_import_session"),
            ("POST", "/_relay/import_session_file", "127.0.0.1", "relay_import_session_file"),
            ("POST", "/_relay/import_har", "127.0.0.1", "relay_import_har"),
            ("POST", "/_relay/import_har_file", "127.0.0.1", "relay_import_har_file"),
            ("GET", "/_relay/export_session?session_id=s1", "127.0.0.1", "relay_export_session"),
            ("GET", "/_relay/export_har?session_id=s1", "127.0.0.1", "relay_export_har"),
            ("GET", "/cert", "127.0.0.1", "cert_serve"),
            ("GET", "/", "relay.guide", "cert_serve"),
            ("OPTIONS", "/_relay/anything", "127.0.0.1", "relay_options"),
            ("GET", "/unmatched", "127.0.0.1", ""),
        ]

        for method, path, host, expected in cases:
            with self.subTest(method=method, path=path, host=host):
                route = monitor._resolve_request_route(_make_flow(path=path, method=method, host=host))
                self.assertEqual(route, expected)


if __name__ == "__main__":
    unittest.main()
