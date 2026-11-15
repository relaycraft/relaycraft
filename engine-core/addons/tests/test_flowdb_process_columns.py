import os
import sqlite3
import sys
import tempfile
import unittest

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

# Mock mitmproxy modules before importing core modules
import tests.mock_mitmproxy  # noqa: F401

from core.flow_database import FlowDatabase
from core.flowdb.flow_repo import extract_index, get_indices, store_flow
from core.flowdb.session_repo import create_session

# The flow_indices schema as it existed before pid/process_name columns.
_OLD_FLOW_INDICES = """
CREATE TABLE flow_indices (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    http_version TEXT,
    content_type TEXT,
    started_datetime TEXT NOT NULL,
    time REAL NOT NULL,
    size INTEGER NOT NULL,
    client_ip TEXT,
    app_name TEXT,
    app_display_name TEXT,
    has_error INTEGER DEFAULT 0,
    has_request_body INTEGER DEFAULT 0,
    has_response_body INTEGER DEFAULT 0,
    is_websocket INTEGER DEFAULT 0,
    is_sse INTEGER DEFAULT 0,
    websocket_frame_count INTEGER DEFAULT 0,
    is_intercepted INTEGER DEFAULT 0,
    hits TEXT,
    msg_ts REAL NOT NULL,
    created_at REAL DEFAULT (julianday('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
"""

_OLD_SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    flow_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    metadata TEXT,
    is_active INTEGER DEFAULT 0
);
CREATE TABLE flow_details (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    data TEXT NOT NULL,
    request_body_ref TEXT,
    response_body_ref TEXT,
    created_at REAL DEFAULT (julianday('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE TABLE flow_bodies (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data BLOB NOT NULL,
    original_size INTEGER,
    FOREIGN KEY (flow_id) REFERENCES flow_details(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE TABLE sse_events (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    event TEXT,
    event_id TEXT,
    retry INTEGER,
    data TEXT,
    raw_size INTEGER DEFAULT 0,
    FOREIGN KEY (flow_id) REFERENCES flow_details(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
""" + _OLD_FLOW_INDICES


def _flow_data(flow_id="f1", pid=4321, process_name="curl", process_path="/usr/bin/curl"):
    return {
        "id": flow_id,
        "msg_ts": 1700000000.0,
        "startedDateTime": "2023-11-14T22:13:20+00:00",
        "time": 12.5,
        "request": {
            "method": "GET",
            "url": "https://example.com/api",
            "httpVersion": "HTTP/2.0",
            "headers": [],
            "cookies": [],
            "queryString": [],
            "_parsedUrl": {"scheme": "https", "host": "example.com", "port": 443, "path": "/api", "query": ""},
        },
        "response": {
            "status": 200,
            "statusText": "OK",
            "httpVersion": "HTTP/2.0",
            "headers": [],
            "cookies": [],
            "content": {"size": 4, "mimeType": "text/plain", "text": "body"},
        },
        "_rc": {
            "clientIp": "127.0.0.1",
            "appName": "macos.curl",
            "appDisplayName": "curl",
            "pid": pid,
            "processName": process_name,
            "processPath": process_path,
            "hits": [],
        },
    }


class TestFlowDbProcessColumns(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="rc149-db-")
        self.db_path = os.path.join(self.tmpdir, "traffic.db")
        self.body_dir = os.path.join(self.tmpdir, "bodies")
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        # Pre-create the DB with the OLD schema (no pid/process_name).
        conn = sqlite3.connect(self.db_path)
        conn.executescript(_OLD_SCHEMA)
        conn.commit()
        conn.close()

        self.db = FlowDatabase(db_path=self.db_path, body_dir=self.body_dir)
        self.addCleanup(self.db.close)

    def _columns(self, table="flow_indices"):
        conn = sqlite3.connect(self.db_path)
        try:
            return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        finally:
            conn.close()

    def test_migration_adds_pid_and_process_name(self):
        cols = self._columns()
        self.assertIn("pid", cols)
        self.assertIn("process_name", cols)

    def test_extract_index_includes_process_fields(self):
        idx = extract_index(self.db, _flow_data(), "s_test")
        self.assertEqual(idx["pid"], 4321)
        self.assertEqual(idx["process_name"], "curl")

    def test_extract_index_defaults_when_unknown(self):
        data = _flow_data()
        data["_rc"]["pid"] = None
        data["_rc"]["processName"] = None
        idx = extract_index(self.db, data, "s_test")
        self.assertIsNone(idx["pid"])
        self.assertEqual(idx["process_name"], "")

    def test_store_and_poll_roundtrip(self):
        session_id = create_session(self.db, name="t", is_active=True)
        self.assertTrue(store_flow(self.db, _flow_data("f_proc"), session_id=session_id))

        rows = get_indices(self.db, session_id=session_id, since=0)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["pid"], 4321)
        self.assertEqual(row["process_name"], "curl")

        # The poll handler maps snake_case columns to camelCase API fields.
        api_idx = {
            "pid": row.get("pid"),
            "processName": row.get("process_name", "") or "",
        }
        self.assertEqual(api_idx["pid"], 4321)
        self.assertEqual(api_idx["processName"], "curl")

    def test_store_flow_without_process_fields(self):
        session_id = create_session(self.db, name="t2", is_active=True)
        data = _flow_data("f_noproc")
        data["_rc"].pop("pid", None)
        data["_rc"].pop("processName", None)
        data["_rc"].pop("processPath", None)
        self.assertTrue(store_flow(self.db, data, session_id=session_id))
        rows = get_indices(self.db, session_id=session_id, since=0)
        self.assertIsNone(rows[0]["pid"])
        self.assertEqual(rows[0]["process_name"], "")


if __name__ == "__main__":
    unittest.main()
