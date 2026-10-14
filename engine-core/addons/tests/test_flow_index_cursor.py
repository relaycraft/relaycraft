import os
import sqlite3
import sys
import unittest

current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

from core.flowdb.flow_repo import get_indices


class _FakeDb:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def _get_session_id(self, session_id=None):
        return session_id

    def _execute_with_retry(self, _operation_name, operation, _max_retries=3):
        return operation(self._conn)


class TestFlowIndexCursor(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(
            """
            CREATE TABLE flow_indices (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                msg_ts REAL NOT NULL
            )
            """
        )
        self.db = _FakeDb(self.conn)

    def tearDown(self):
        self.conn.close()

    def _insert(self, flow_id: str, msg_ts: float):
        self.conn.execute(
            "INSERT INTO flow_indices(id, session_id, msg_ts) VALUES (?, 's1', ?)",
            (flow_id, msg_ts),
        )

    def test_exclusive_cursor_continues_through_a_shared_timestamp(self):
        for flow_id in ("a", "b", "c"):
            self._insert(flow_id, 5.0)
        self._insert("d", 6.0)

        first = get_indices(self.db, session_id="s1", since=0, limit=2)
        self.assertEqual([row["id"] for row in first], ["a", "b"])

        last = first[-1]
        second = get_indices(
            self.db,
            session_id="s1",
            since=last["msg_ts"],
            limit=2,
            since_id=last["id"],
        )
        self.assertEqual([row["id"] for row in second], ["c", "d"])
