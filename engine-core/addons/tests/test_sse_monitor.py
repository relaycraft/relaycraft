import os
import sys
import time
import threading
import unittest
from unittest.mock import MagicMock, patch

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

# Mock mitmproxy modules before importing monitor
import tests.mock_mitmproxy  # noqa: F401

from core.monitor import TrafficMonitor
from core import sse_processor


def make_monitor() -> TrafficMonitor:
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
    return monitor


class TestSseMonitor(unittest.TestCase):
    def test_multibyte_utf8_across_chunks(self):
        monitor = make_monitor()
        flow_id = "f_utf8"
        utf8_char = "你".encode("utf-8")

        sse_processor.handle_sse_chunk(monitor, flow_id, b"data: " + utf8_char[:2])
        sse_processor.handle_sse_chunk(monitor, flow_id, utf8_char[2:] + b"\n\n")

        data = sse_processor.get_sse_events(monitor, flow_id, since_seq=0, limit=10)
        self.assertEqual(len(data["events"]), 1)
        self.assertEqual(data["events"][0]["data"], "你")

    def test_sse_parsing_comment_crlf_and_multiline_data(self):
        monitor = make_monitor()
        flow_id = "f_parse"
        chunk = (
            b": keep-alive\r\n"
            b"event: message\r\n"
            b"data: hello\r\n"
            b"data: world\r\n"
            b"id: a b c\r\n"
            b"retry: 3000\r\n"
            b"\r\n"
        )
        sse_processor.handle_sse_chunk(monitor, flow_id, chunk)

        data = sse_processor.get_sse_events(monitor, flow_id, since_seq=0, limit=10)
        self.assertEqual(len(data["events"]), 1)
        evt = data["events"][0]
        self.assertEqual(evt["event"], "message")
        self.assertEqual(evt["id"], "a b c")
        self.assertEqual(evt["retry"], 3000)
        self.assertEqual(evt["data"], "hello\nworld")

    def test_buffer_overflow_guard_creates_event_and_marks_drop(self):
        monitor = make_monitor()
        monitor._sse_max_buffer_bytes = 32
        flow_id = "f_overflow"

        sse_processor.handle_sse_chunk(monitor, flow_id, b"data: " + (b"a" * 128))

        data = sse_processor.get_sse_events(monitor, flow_id, since_seq=0, limit=10)
        self.assertGreaterEqual(data["droppedCount"], 1)
        self.assertEqual(len(data["events"]), 1)
        self.assertTrue(data["events"][0]["data"].startswith("a"))

    def test_cleanup_stale_closed_sse_state(self):
        monitor = make_monitor()
        flow_id = "f_cleanup"
        with monitor._sse_lock:
            state = sse_processor.ensure_sse_state(monitor, flow_id)
            state["stream_open"] = False
            state["last_touched"] = time.time() - 120
            sse_processor.cleanup_inactive_sse_states_locked(monitor, time.time())

        self.assertNotIn(flow_id, monitor._sse_states)

    def test_get_sse_events_falls_back_to_db_when_state_missing(self):
        monitor = make_monitor()
        flow_id = "f_db"

        with patch("core.sse_processor.db_get_sse_events") as mock_db_get:
            mock_db_get.return_value = {
                "events": [{
                    "flowId": flow_id,
                    "seq": 0,
                    "ts": 1,
                    "event": "message",
                    "id": None,
                    "retry": None,
                    "data": "hello",
                    "rawSize": 5,
                }],
                "nextSeq": 1,
            }

            data = sse_processor.get_sse_events(monitor, flow_id, since_seq=0, limit=10)
            self.assertEqual(len(data["events"]), 1)
            self.assertEqual(data["events"][0]["data"], "hello")
            self.assertFalse(data["streamOpen"])
            self.assertEqual(data["nextSeq"], 1)


if __name__ == "__main__":
    unittest.main()
