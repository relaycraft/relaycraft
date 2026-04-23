import gzip
import json
import os
import sqlite3
import sys
import unittest

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

from core.flowdb import query_repo


class _FakeDb:
    BODY_SEARCH_SCAN_LIMIT = 100

    def __init__(self, conn: sqlite3.Connection, active_session: str = "s1"):
        self._conn = conn
        self._active_session = active_session

    def _get_conn(self):
        return self._conn

    def _get_session_id(self, session_id=None):
        return session_id or self._active_session

    def _execute_with_retry(self, _operation_name, operation, _max_retries=3):
        return operation(self._conn)


def _create_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE flow_indices (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            msg_ts REAL NOT NULL
        );
        CREATE TABLE flow_details (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            request_body_ref TEXT NOT NULL DEFAULT 'inline',
            response_body_ref TEXT NOT NULL DEFAULT 'inline'
        );
        CREATE TABLE flow_bodies (
            flow_id TEXT NOT NULL,
            type TEXT NOT NULL,
            data BLOB NOT NULL
        );
        """
    )
    return conn


def _detail_with_response_body(text: str):
    return json.dumps({"response": {"content": {"text": text}}}, ensure_ascii=False)


def _detail_with_headers(req_headers=None, res_headers=None):
    return json.dumps(
        {
            "request": {"headers": req_headers or []},
            "response": {"headers": res_headers or []},
        },
        ensure_ascii=False,
    )


class TestFlowDbQueryRepo(unittest.TestCase):
    def test_search_by_body_returns_empty_for_blank_keyword(self):
        conn = _create_conn()
        self.addCleanup(conn.close)
        db = _FakeDb(conn)
        self.assertEqual(
            query_repo.search_by_body(db, keyword=""),
            {"matches": [], "scanned": 0},
        )

    def test_search_by_body_respects_case_and_compressed_body(self):
        conn = _create_conn()
        self.addCleanup(conn.close)
        conn.executemany(
            "INSERT INTO flow_indices(id, session_id, msg_ts) VALUES (?, ?, ?)",
            [("f1", "s1", 3), ("f2", "s1", 2), ("f3", "s1", 1)],
        )
        conn.executemany(
            """
            INSERT INTO flow_details(id, data, response_body_ref)
            VALUES (?, ?, ?)
            """,
            [
                ("f1", _detail_with_response_body("Hello World"), "inline"),
                ("f2", _detail_with_response_body("hello lower"), "inline"),
                ("f3", _detail_with_response_body(""), "compressed"),
            ],
        )
        conn.execute(
            "INSERT INTO flow_bodies(flow_id, type, data) VALUES (?, ?, ?)",
            ("f3", "response", gzip.compress("Compressed MAGIC".encode("utf-8"))),
        )
        conn.commit()

        db = _FakeDb(conn)
        insensitive = query_repo.search_by_body(db, keyword="hello", case_sensitive=False)
        sensitive = query_repo.search_by_body(db, keyword="hello", case_sensitive=True)
        compressed = query_repo.search_by_body(db, keyword="magic", case_sensitive=False)

        self.assertEqual(set(insensitive["matches"]), {"f1", "f2"})
        self.assertEqual(sensitive["matches"], ["f2"])
        self.assertIn("f3", compressed["matches"])

    def test_search_by_body_honors_scan_limit(self):
        conn = _create_conn()
        self.addCleanup(conn.close)
        conn.executemany(
            "INSERT INTO flow_indices(id, session_id, msg_ts) VALUES (?, ?, ?)",
            [("n1", "s1", 3), ("n2", "s1", 2), ("old_hit", "s1", 1)],
        )
        conn.executemany(
            "INSERT INTO flow_details(id, data, response_body_ref) VALUES (?, ?, 'inline')",
            [
                ("n1", _detail_with_response_body("no match 1")),
                ("n2", _detail_with_response_body("no match 2")),
                ("old_hit", _detail_with_response_body("needle")),
            ],
        )
        conn.commit()

        db = _FakeDb(conn)
        db.BODY_SEARCH_SCAN_LIMIT = 2
        result = query_repo.search_by_body(db, keyword="needle")
        self.assertEqual(result["scanned"], 2)
        self.assertEqual(result["matches"], [])

    def test_search_by_header_respects_case_and_scan_limit(self):
        conn = _create_conn()
        self.addCleanup(conn.close)
        conn.executemany(
            "INSERT INTO flow_indices(id, session_id, msg_ts) VALUES (?, ?, ?)",
            [("h1", "s1", 3), ("h2", "s1", 2), ("h3", "s1", 1)],
        )
        conn.executemany(
            "INSERT INTO flow_details(id, data) VALUES (?, ?)",
            [
                ("h1", _detail_with_headers(req_headers=[{"name": "X-Token", "value": "Alpha"}])),
                ("h2", _detail_with_headers(res_headers=[{"name": "Server", "value": "beta"}])),
                ("h3", _detail_with_headers(req_headers=[{"name": "X-Token", "value": "ALPHA"}])),
            ],
        )
        conn.commit()

        db = _FakeDb(conn)
        db.BODY_SEARCH_SCAN_LIMIT = 2

        insensitive = query_repo.search_by_header(db, keyword="alpha", case_sensitive=False)
        sensitive = query_repo.search_by_header(db, keyword="alpha", case_sensitive=True)
        blank = query_repo.search_by_header(db, keyword="")

        self.assertEqual(insensitive["matches"], ["h1"])
        self.assertEqual(sensitive["matches"], [])
        self.assertEqual(insensitive["scanned"], 2)
        self.assertEqual(blank, {"matches": [], "scanned": 0})


if __name__ == "__main__":
    unittest.main()
