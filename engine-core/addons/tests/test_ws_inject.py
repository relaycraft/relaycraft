import base64
import os
import sys
import threading
import unittest
from unittest.mock import MagicMock

current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

import tests.mock_mitmproxy  # noqa: F401

from core.monitor import TrafficMonitor


def make_monitor() -> TrafficMonitor:
    """Build a minimal TrafficMonitor without invoking its heavy __init__."""
    monitor = object.__new__(TrafficMonitor)
    monitor.logger = MagicMock()
    monitor.db = MagicMock()
    monitor._sse_lock = threading.Lock()
    monitor._sse_states = {}
    monitor._sse_max_events_per_flow = 2000
    monitor._sse_max_buffer_bytes = 1024 * 1024
    monitor._sse_default_limit = 200
    monitor._sse_max_limit = 1000
    monitor._sse_state_retention_seconds = 60.0
    monitor._ws_flows_lock = threading.Lock()
    monitor._ws_flows = {}
    monitor._ws_inject_max_payload_bytes = 1024 * 1024
    return monitor


class _FakeWebSocket:
    def __init__(self, closed_client=False, closed_server=False):
        self.messages = []
        self.closed_at_client = closed_client
        self.closed_at_server = closed_server


class _FakeFlow:
    def __init__(self, flow_id="flow_ws_1", ws=None):
        self.id = flow_id
        self.websocket = ws
        self.metadata = {}


class _FakeMessage:
    def __init__(self, content: bytes, from_client: bool = True, is_text: bool = True):
        self.content = content
        self.from_client = from_client
        self.is_text = is_text


class TestWsInject(unittest.TestCase):
    def setUp(self):
        # Patch mitmproxy.ctx.master.commands.call used by inject_ws_frame.
        import mitmproxy.ctx as _ctx

        self._ctx = _ctx
        self.call_mock = MagicMock()
        _ctx.master = MagicMock()
        _ctx.master.commands = MagicMock()
        _ctx.master.commands.call = self.call_mock

    def test_inject_text_success(self):
        monitor = make_monitor()
        ws = _FakeWebSocket()
        flow = _FakeFlow(flow_id="f_text", ws=ws)
        monitor.register_ws_flow(flow)
        self.call_mock.side_effect = lambda *args: ws.messages.append(
            _FakeMessage(b"hello", from_client=True, is_text=True)
        )

        status, body = monitor.inject_ws_frame("f_text", "text", "hello")

        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.call_mock.assert_called_once()
        args = self.call_mock.call_args.args
        # inject.websocket, flow, False (to_client=False => client->server),
        # payload_bytes, is_text
        self.assertEqual(args[0], "inject.websocket")
        self.assertIs(args[1], flow)
        self.assertFalse(args[2])
        self.assertEqual(args[3], b"hello")
        self.assertTrue(args[4])
        # Injected seq recorded on the appended message.
        self.assertIn(0, flow.metadata["_relaycraft_injected_seqs"])

    def test_inject_binary_success(self):
        monitor = make_monitor()
        ws = _FakeWebSocket()
        # Pre-populate existing messages so seq prediction is non-zero.
        ws.messages = [object(), object(), object()]
        flow = _FakeFlow(flow_id="f_bin", ws=ws)
        monitor.register_ws_flow(flow)

        raw = b"\x01\x02\x03\xff"
        payload_b64 = base64.b64encode(raw).decode("ascii")
        self.call_mock.side_effect = lambda *args: ws.messages.append(
            _FakeMessage(raw, from_client=True, is_text=False)
        )

        status, body = monitor.inject_ws_frame("f_bin", "binary", payload_b64)

        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        args = self.call_mock.call_args.args
        self.assertEqual(args[3], raw)
        self.assertFalse(args[4])  # is_text=False
        self.assertIn(3, flow.metadata["_relaycraft_injected_seqs"])

    def test_inject_prefers_matching_seq_in_concurrent_append_window(self):
        monitor = make_monitor()
        ws = _FakeWebSocket()
        ws.messages = [object(), object()]
        flow = _FakeFlow(flow_id="f_race", ws=ws)
        monitor.register_ws_flow(flow)

        def _side_effect(*_args):
            ws.messages.append(_FakeMessage(b"other", from_client=True, is_text=True))
            ws.messages.append(_FakeMessage(b"hello", from_client=True, is_text=True))

        self.call_mock.side_effect = _side_effect

        status, body = monitor.inject_ws_frame("f_race", "text", "hello")

        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        # Should mark the exact matching message (seq=3), not the first appended (seq=2).
        self.assertIn(3, flow.metadata["_relaycraft_injected_seqs"])
        self.assertNotIn(2, flow.metadata["_relaycraft_injected_seqs"])

    def test_inject_flow_not_found(self):
        monitor = make_monitor()

        status, body = monitor.inject_ws_frame("nope", "text", "x")

        self.assertEqual(status, 404)
        self.assertFalse(body["ok"])
        self.assertEqual(body["code"], "flow_not_found")
        self.call_mock.assert_not_called()

    def test_inject_flow_closed_returns_409(self):
        monitor = make_monitor()
        ws = _FakeWebSocket(closed_client=True)
        flow = _FakeFlow(flow_id="f_closed", ws=ws)
        monitor.register_ws_flow(flow)

        status, body = monitor.inject_ws_frame("f_closed", "text", "x")

        self.assertEqual(status, 409)
        self.assertEqual(body["code"], "flow_closed")
        self.call_mock.assert_not_called()
        # Registry should be cleaned up after detecting closure.
        with monitor._ws_flows_lock:
            self.assertNotIn("f_closed", monitor._ws_flows)

    def test_inject_invalid_base64_returns_400(self):
        monitor = make_monitor()
        ws = _FakeWebSocket()
        flow = _FakeFlow(flow_id="f_badb64", ws=ws)
        monitor.register_ws_flow(flow)

        status, body = monitor.inject_ws_frame("f_badb64", "binary", "not-base64!!!")

        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "invalid_payload")
        self.call_mock.assert_not_called()

    def test_inject_unsupported_type_returns_400(self):
        monitor = make_monitor()
        ws = _FakeWebSocket()
        flow = _FakeFlow(flow_id="f_type", ws=ws)
        monitor.register_ws_flow(flow)

        status, body = monitor.inject_ws_frame("f_type", "ping", "x")

        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "invalid_payload")
        self.call_mock.assert_not_called()

    def test_inject_engine_error_does_not_leave_injected_seq(self):
        monitor = make_monitor()
        ws = _FakeWebSocket()
        flow = _FakeFlow(flow_id="f_fail", ws=ws)
        monitor.register_ws_flow(flow)
        self.call_mock.side_effect = RuntimeError("inject failed")

        status, body = monitor.inject_ws_frame("f_fail", "text", "hello")

        self.assertEqual(status, 500)
        self.assertEqual(body["code"], "engine_error")
        self.assertNotIn("_relaycraft_injected_seqs", flow.metadata)

    def test_inject_payload_too_large_returns_400(self):
        monitor = make_monitor()
        monitor._ws_inject_max_payload_bytes = 8
        ws = _FakeWebSocket()
        flow = _FakeFlow(flow_id="f_big", ws=ws)
        monitor.register_ws_flow(flow)

        status, body = monitor.inject_ws_frame("f_big", "text", "123456789")

        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "invalid_payload")
        self.call_mock.assert_not_called()

    def test_register_unregister_roundtrip(self):
        monitor = make_monitor()
        ws = _FakeWebSocket()
        flow = _FakeFlow(flow_id="f_rt", ws=ws)

        monitor.register_ws_flow(flow)
        with monitor._ws_flows_lock:
            self.assertIn("f_rt", monitor._ws_flows)

        monitor.unregister_ws_flow(flow)
        with monitor._ws_flows_lock:
            self.assertNotIn("f_rt", monitor._ws_flows)


if __name__ == "__main__":
    unittest.main()
