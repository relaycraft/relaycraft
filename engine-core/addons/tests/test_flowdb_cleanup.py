import os
import sqlite3
import sys
import time
import unittest
from unittest.mock import MagicMock, patch

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

from core.flowdb import cleanup
from core.flowdb.schema import Config


class _FakeDb:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn
        self.logger = MagicMock()
        self.db_path = "/tmp/relaycraft-test-nonexistent.db"
        self.body_dir = "/tmp/relaycraft-test-bodies"
        self.deleted_sessions = []
        self.notifications = []

    def _get_conn(self):
        return self._conn

    def delete_session(self, session_id):
        self.deleted_sessions.append(session_id)

    def push_notification(self, **kwargs):
        self.notifications.append(kwargs)


def _create_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            is_active INTEGER NOT NULL DEFAULT 1,
            flow_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE flow_indices (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            msg_ts REAL NOT NULL
        );
        CREATE TABLE flow_details (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            data TEXT
        );
        CREATE TABLE flow_bodies (
            flow_id TEXT NOT NULL,
            type TEXT NOT NULL,
            data BLOB
        );
        """
    )
    return conn


class TestFlowDbCleanup(unittest.TestCase):
    def test_run_cleanup_keeps_cross_table_consistency_with_grouped_and_chunked_deletes(self):
        conn = _create_conn()
        self.addCleanup(conn.close)
        now = time.time()
        old_ts = now - 3 * 24 * 3600

        conn.executemany(
            "INSERT INTO sessions(id, is_active, flow_count) VALUES (?, ?, ?)",
            [("s1", 1, 0), ("s2", 1, 0), ("default", 1, 0)],
        )

        old_s1_ids = [f"s1_{idx}" for idx in range(350)]
        old_s2_ids = [f"s2_{idx}" for idx in range(250)]
        all_old_ids = old_s1_ids + old_s2_ids  # 600 -> forces 500-chunk + 100-chunk
        live_id = "live_1"

        conn.executemany(
            "INSERT INTO flow_indices(id, session_id, msg_ts) VALUES (?, ?, ?)",
            [(fid, "s1", old_ts) for fid in old_s1_ids]
            + [(fid, "s2", old_ts) for fid in old_s2_ids]
            + [(live_id, "s1", now)],
        )
        conn.executemany(
            "INSERT INTO flow_details(id, session_id, data) VALUES (?, ?, ?)",
            [(fid, "s1", "{}") for fid in old_s1_ids]
            + [(fid, "s2", "{}") for fid in old_s2_ids]
            + [(live_id, "s1", "{}")],
        )
        conn.executemany(
            "INSERT INTO flow_bodies(flow_id, type, data) VALUES (?, ?, ?)",
            [(fid, "request", b"r") for fid in all_old_ids] + [(live_id, "request", b"live")],
        )
        conn.commit()

        db = _FakeDb(conn)
        deleted_body_groups = []

        def mock_delete_body_files(db_inst, session_id, flow_ids=None):
            deleted_body_groups.append((session_id, list(flow_ids or [])))

        original = (
            Config.MAX_FLOW_AGE_DAYS,
            Config.MAX_TOTAL_FLOWS,
            Config.MAX_DB_SIZE_MB,
        )
        try:
            Config.MAX_FLOW_AGE_DAYS = 1
            Config.MAX_TOTAL_FLOWS = 100000
            Config.MAX_DB_SIZE_MB = 100000
            with patch("core.flowdb.cleanup.delete_body_files", side_effect=mock_delete_body_files):
                cleanup.run_cleanup(db)
        finally:
            Config.MAX_FLOW_AGE_DAYS, Config.MAX_TOTAL_FLOWS, Config.MAX_DB_SIZE_MB = original

        by_session = {sid: set(ids) for sid, ids in deleted_body_groups}
        self.assertEqual(by_session.get("s1"), set(old_s1_ids))
        self.assertEqual(by_session.get("s2"), set(old_s2_ids))

        index_ids = {row["id"] for row in conn.execute("SELECT id FROM flow_indices")}
        detail_ids = {row["id"] for row in conn.execute("SELECT id FROM flow_details")}
        body_ids = {row["flow_id"] for row in conn.execute("SELECT flow_id FROM flow_bodies")}

        self.assertEqual(index_ids, {live_id})
        self.assertEqual(detail_ids, {live_id})
        self.assertEqual(body_ids, {live_id})


if __name__ == "__main__":
    unittest.main()
