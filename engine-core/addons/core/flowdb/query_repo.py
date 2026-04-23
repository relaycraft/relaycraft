"""Query helpers for FlowDatabase."""

import gzip
import json

from .search import make_text_checker


def get_flow_count(db, session_id: str = None) -> int:
    """Get total flow count for a session."""
    session_id = db._get_session_id(session_id)
    conn = db._get_conn()
    row = conn.execute(
        "SELECT COUNT(*) FROM flow_indices WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    return row[0] if row else 0


def search_by_body(
    db,
    keyword: str,
    body_type: str = "response",
    session_id: str = None,
    case_sensitive: bool = False,
) -> dict:
    """Search flow bodies for a keyword."""
    session_id = db._get_session_id(session_id)
    if not session_id or not keyword:
        return {"matches": [], "scanned": 0}

    check_text = make_text_checker(keyword, case_sensitive)
    body_ref_col = "request_body_ref" if body_type == "request" else "response_body_ref"
    body_json_path = (
        ("request", "postData", "text")
        if body_type == "request"
        else ("response", "content", "text")
    )

    def _query(conn):
        candidates = conn.execute(
            f"""
            SELECT fd.id, fd.data, fd.{body_ref_col} AS body_ref
            FROM flow_details fd
            JOIN flow_indices fi ON fd.id = fi.id
            WHERE fi.session_id = ?
              AND fd.{body_ref_col} IN ('inline', 'compressed')
            ORDER BY fi.msg_ts DESC
            LIMIT ?
            """,
            (session_id, db.BODY_SEARCH_SCAN_LIMIT),
        ).fetchall()

        compressed_ids = [r["id"] for r in candidates if r["body_ref"] == "compressed"]
        compressed_data: dict = {}
        if compressed_ids:
            placeholders = ",".join("?" * len(compressed_ids))
            rows = conn.execute(
                f"SELECT flow_id, data FROM flow_bodies "
                f"WHERE flow_id IN ({placeholders}) AND type = ?",
                compressed_ids + [body_type],
            ).fetchall()
            for row in rows:
                compressed_data[row["flow_id"]] = row["data"]

        k1, k2, k3 = body_json_path
        matches = []
        for candidate in candidates:
            fid = candidate["id"]
            try:
                if candidate["body_ref"] == "compressed":
                    raw = compressed_data.get(fid)
                    if raw is None:
                        continue
                    text = gzip.decompress(bytes(raw)).decode("utf-8", errors="replace")
                else:
                    data = json.loads(candidate["data"])
                    text = data.get(k1, {}).get(k2, {}).get(k3, "") or ""
                if text and check_text(text):
                    matches.append(fid)
            except Exception:
                pass

        return {"matches": matches, "scanned": len(candidates)}

    return db._execute_with_retry("search_by_body", _query)


def search_by_header(
    db,
    keyword: str,
    session_id: str = None,
    case_sensitive: bool = False,
) -> dict:
    """Search flow headers for a keyword."""
    session_id = db._get_session_id(session_id)
    if not session_id or not keyword:
        return {"matches": [], "scanned": 0}

    check_text = make_text_checker(keyword, case_sensitive)

    def _query(conn):
        rows = conn.execute(
            """
            SELECT fd.id, fd.data
            FROM flow_details fd
            JOIN flow_indices fi ON fd.id = fi.id
            WHERE fi.session_id = ?
            ORDER BY fi.msg_ts DESC
            LIMIT ?
            """,
            (session_id, db.BODY_SEARCH_SCAN_LIMIT),
        ).fetchall()

        matches = []
        for row in rows:
            try:
                data = json.loads(row["data"])
                req_headers = data.get("request", {}).get("headers", [])
                res_headers = data.get("response", {}).get("headers", [])
                for h in req_headers + res_headers:
                    if check_text(str(h.get("name", ""))) or check_text(str(h.get("value", ""))):
                        matches.append(row["id"])
                        break
            except Exception:
                pass

        return {"matches": matches, "scanned": len(rows)}

    return db._execute_with_retry("search_by_header", _query)
