import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

# Mock mitmproxy modules before importing handlers
from tests import mock_mitmproxy

from core.http_handlers import (
    handle_cert_routes,
    handle_control_routes,
    handle_data_routes,
    handle_import_routes,
    handle_realtime_routes,
)

_ = mock_mitmproxy


class _FakeResponse:
    @staticmethod
    def make(status_code, content, headers):
        return SimpleNamespace(
            status_code=status_code,
            content=content,
            headers=headers,
            reason=b"",
        )


def _safe_json_default(obj):
    return str(obj)


def _make_flow(query=None, content=b"", method="GET"):
    req = SimpleNamespace(
        query=query or {},
        content=content,
        method=method,
        headers={},
    )
    return SimpleNamespace(request=req, response=None)


def _make_monitor():
    monitor = SimpleNamespace()
    monitor.db = MagicMock()
    monitor.logger = MagicMock()
    monitor.debug_mgr = MagicMock()
    monitor.reset_seq_counter = MagicMock()
    return monitor


class TestHttpHandlersSmoke(unittest.TestCase):
    def test_relay_poll_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.get_indices.return_value = [{"id": "f1", "msg_ts": 123}]
        monitor.db.drain_notifications.return_value = []

        flow = _make_flow(query={"since": "0"})
        handled = handle_realtime_routes(monitor, flow, "relay_poll", _FakeResponse, _safe_json_default)
        self.assertTrue(handled)
        self.assertEqual(flow.response.status_code, 200)

        monitor = _make_monitor()
        monitor.db.get_indices.side_effect = RuntimeError("db error")
        flow = _make_flow(query={"since": "0"})
        handle_realtime_routes(monitor, flow, "relay_poll", _FakeResponse, _safe_json_default)
        self.assertEqual(flow.response.status_code, 500)

    def test_relay_detail_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.get_detail.return_value = {"id": "f1"}
        flow = _make_flow(query={"id": "f1"})
        handle_realtime_routes(monitor, flow, "relay_detail", _FakeResponse, _safe_json_default)
        self.assertEqual(flow.response.status_code, 200)

        monitor = _make_monitor()
        monitor.db.get_detail.side_effect = RuntimeError("detail error")
        flow = _make_flow(query={"id": "f1"})
        handle_realtime_routes(monitor, flow, "relay_detail", _FakeResponse, _safe_json_default)
        self.assertEqual(flow.response.status_code, 500)

    def test_relay_search_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.search_by_body.return_value = {"matches": ["f1"], "scanned": 1}
        payload = json.dumps({"keyword": "hello", "type": "response"}).encode("utf-8")
        flow = _make_flow(content=payload, method="POST")
        handled = handle_data_routes(monitor, flow, "relay_search", _FakeResponse, _safe_json_default)
        self.assertTrue(handled)
        self.assertEqual(flow.response.status_code, 200)

        monitor = _make_monitor()
        flow = _make_flow(content=b"{invalid-json", method="POST")
        handle_data_routes(monitor, flow, "relay_search", _FakeResponse, _safe_json_default)
        self.assertEqual(flow.response.status_code, 500)

    def test_relay_session_new_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.create_new_session_for_app_start.return_value = "s_new"
        flow = _make_flow(content=b"{}", method="POST")
        handle_control_routes(monitor, flow, "relay_session_new", _FakeResponse)
        self.assertEqual(flow.response.status_code, 200)

        monitor = _make_monitor()
        monitor.db.create_new_session_for_app_start.side_effect = RuntimeError("session new error")
        flow = _make_flow(content=b"{}", method="POST")
        handle_control_routes(monitor, flow, "relay_session_new", _FakeResponse)
        self.assertEqual(flow.response.status_code, 500)

    def test_relay_session_activate_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.switch_session.return_value = True
        flow = _make_flow(content=json.dumps({"id": "s1"}).encode("utf-8"), method="POST")
        handle_control_routes(monitor, flow, "relay_session_activate", _FakeResponse)
        self.assertEqual(flow.response.status_code, 200)

        monitor = _make_monitor()
        monitor.db.switch_session.side_effect = RuntimeError("activate error")
        flow = _make_flow(content=json.dumps({"id": "s1"}).encode("utf-8"), method="POST")
        handle_control_routes(monitor, flow, "relay_session_activate", _FakeResponse)
        self.assertEqual(flow.response.status_code, 500)

    def test_relay_session_delete_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.delete_session.return_value = True
        flow = _make_flow(content=json.dumps({"id": "s1"}).encode("utf-8"), method="POST")
        handle_control_routes(monitor, flow, "relay_session_delete", _FakeResponse)
        self.assertEqual(flow.response.status_code, 200)

        monitor = _make_monitor()
        monitor.db.delete_session.side_effect = RuntimeError("delete error")
        flow = _make_flow(content=json.dumps({"id": "s1"}).encode("utf-8"), method="POST")
        handle_control_routes(monitor, flow, "relay_session_delete", _FakeResponse)
        self.assertEqual(flow.response.status_code, 500)

    def test_relay_session_clear_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.get_active_session.return_value = {"id": "s_active"}
        flow = _make_flow(content=json.dumps({"id": "s_active"}).encode("utf-8"), method="POST")
        handle_control_routes(monitor, flow, "relay_session_clear", _FakeResponse)
        self.assertEqual(flow.response.status_code, 200)
        monitor.reset_seq_counter.assert_called_once()

        monitor = _make_monitor()
        monitor.db.clear_session.side_effect = RuntimeError("clear error")
        flow = _make_flow(content=b"", method="POST")
        handle_control_routes(monitor, flow, "relay_session_clear", _FakeResponse)
        self.assertEqual(flow.response.status_code, 500)

    def test_relay_import_session_success_and_exception(self):
        monitor = _make_monitor()
        monitor.db.create_session.return_value = "s_imported"
        monitor._build_session_indices = MagicMock(return_value=[{"id": "f1"}])
        payload = json.dumps([{"id": "f1", "msg_ts": 1.0}]).encode("utf-8")
        flow = _make_flow(content=payload, method="POST")
        handled = handle_import_routes(monitor, flow, "relay_import_session", _FakeResponse)
        self.assertTrue(handled)
        self.assertEqual(flow.response.status_code, 200)

        monitor = _make_monitor()
        monitor.db.create_session.side_effect = RuntimeError("import error")
        monitor._build_session_indices = MagicMock(return_value=[])
        flow = _make_flow(content=payload, method="POST")
        handle_import_routes(monitor, flow, "relay_import_session", _FakeResponse)
        self.assertEqual(flow.response.status_code, 500)

    def test_cert_serve_success_and_exception(self):
        monitor = _make_monitor()
        flow = SimpleNamespace(
            request=SimpleNamespace(path="/cert", host="127.0.0.1", headers={}),
            response=None,
        )
        handled = handle_cert_routes(monitor, flow, "cert_serve", _FakeResponse)
        self.assertTrue(handled)
        self.assertIn(flow.response.status_code, (200, 404))

        monitor = _make_monitor()
        broken_flow = SimpleNamespace(request=None, response=None)
        handle_cert_routes(monitor, broken_flow, "cert_serve", _FakeResponse)
        self.assertEqual(broken_flow.response.status_code, 500)


if __name__ == "__main__":
    unittest.main()
