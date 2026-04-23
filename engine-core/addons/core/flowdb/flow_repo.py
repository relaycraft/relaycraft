"""Flow storage and retrieval helpers for FlowDatabase."""

import json
import time
from typing import Dict, List, Optional, Tuple


def build_flow_data_clean(db, flow_data: Dict, req_ref: str, res_ref: str) -> str:
    """Serialize flow data for storage, replacing non-inline bodies with placeholders.

    Avoids the expensive json.loads(json.dumps(flow_data)) round-trip by only
    copying the body fields that need to be replaced.
    """
    from decimal import Decimal

    flow_copy = dict(flow_data)  # shallow copy of top level

    if req_ref != "inline":
        req = flow_data.get("request")
        if req and req.get("postData"):
            req_copy = dict(req)
            pd_copy = dict(req.get("postData"))
            pd_copy["text"] = db._get_placeholder(req_ref)
            req_copy["postData"] = pd_copy
            flow_copy["request"] = req_copy

    if res_ref != "inline":
        res = flow_data.get("response")
        if res and res.get("content"):
            res_copy = dict(res)
            ct_copy = dict(res.get("content"))
            ct_copy["text"] = db._get_placeholder(res_ref)
            res_copy["content"] = ct_copy
            flow_copy["response"] = res_copy

    def decimal_default(obj):
        if isinstance(obj, Decimal):
            return float(obj)
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

    return json.dumps(flow_copy, ensure_ascii=False, default=decimal_default)


def store_flow(db, flow_data: Dict, session_id: str = None, update_session_ts: bool = True) -> bool:
    """Store a flow with tiered body storage."""
    t0 = time.time()

    session_id = db._get_session_id(session_id)
    if not session_id:
        return False

    flow_id = flow_data.get("id")
    if not flow_id:
        return False

    index_data = db._extract_index(flow_data, session_id)

    req = flow_data.get("request") or {}
    res = flow_data.get("response") or {}
    req_body, req_ref = db._process_body(
        flow_id,
        session_id,
        (req.get("postData") or {}).get("text", ""),
        "request",
    )
    res_body, res_ref = db._process_body(
        flow_id,
        session_id,
        (res.get("content") or {}).get("text", ""),
        "response",
    )

    detail_json = db._build_flow_data_clean(flow_data, req_ref, res_ref)

    with db._lock:
        conn = db._get_conn()
        try:
            db._insert_flow_rows(
                conn,
                flow_id,
                session_id,
                index_data,
                detail_json,
                req_body,
                req_ref,
                res_body,
                res_ref,
            )

            if update_session_ts:
                conn.execute(
                    "UPDATE sessions SET updated_at = ? WHERE id = ?",
                    (time.time(), session_id),
                )

            conn.commit()
            db._last_write_ts = time.time()

        except Exception as e:
            conn.rollback()
            raise e

    elapsed_ms = (time.time() - t0) * 1000
    if elapsed_ms > 200:
        db.logger.warning(f"store_flow SLOW ({elapsed_ms:.0f}ms): flow_id={flow_id}")

    db._maybe_cleanup()
    return True


def insert_flow_rows(
    db,
    conn,
    flow_id: str,
    session_id: str,
    index_data: Dict,
    detail_json: str,
    req_body,
    req_ref: str,
    res_body,
    res_ref: str,
):
    """Execute the INSERT statements for one flow (no commit, no lock)."""
    conn.execute(
        """
        INSERT OR REPLACE INTO flow_indices (
            id, session_id, method, url, host, path, status, http_version,
            content_type, started_datetime, time, size, client_ip,
            app_name, app_display_name,
            has_error, has_request_body, has_response_body,
            is_websocket, is_sse, websocket_frame_count, is_intercepted,
            hits, msg_ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            index_data["id"],
            index_data["session_id"],
            index_data["method"],
            index_data["url"],
            index_data["host"],
            index_data["path"],
            index_data["status"],
            index_data["http_version"],
            index_data["content_type"],
            index_data["started_datetime"],
            index_data["time"],
            index_data["size"],
            index_data["client_ip"],
            index_data.get("app_name", ""),
            index_data.get("app_display_name", ""),
            index_data["has_error"],
            index_data["has_request_body"],
            index_data["has_response_body"],
            index_data["is_websocket"],
            index_data["is_sse"],
            index_data["websocket_frame_count"],
            index_data["is_intercepted"],
            index_data["hits"],
            index_data["msg_ts"],
        ),
    )

    conn.execute(
        """
        INSERT OR REPLACE INTO flow_details
        (id, session_id, data, request_body_ref, response_body_ref)
        VALUES (?, ?, ?, ?, ?)
        """,
        (flow_id, session_id, detail_json, req_ref, res_ref),
    )

    if req_ref == "compressed" and req_body:
        conn.execute(
            """
            INSERT OR REPLACE INTO flow_bodies
            (id, flow_id, session_id, type, data, original_size)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (f"{flow_id}_req", flow_id, session_id, "request", req_body, len(req_body)),
        )

    if res_ref == "compressed" and res_body:
        conn.execute(
            """
            INSERT OR REPLACE INTO flow_bodies
            (id, flow_id, session_id, type, data, original_size)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (f"{flow_id}_res", flow_id, session_id, "response", res_body, len(res_body)),
        )


def store_flows_batch(db, flows: List[Dict], session_id: str, batch_size: int = 500) -> int:
    """Bulk-insert multiple flows into a session with minimal commits."""
    if not flows or not session_id:
        return 0

    t0 = time.time()
    stored = 0
    errors = 0

    prepared: List[Tuple] = []
    for flow_data in flows:
        flow_id = flow_data.get("id")
        if not flow_id:
            continue
        try:
            index_data = db._extract_index(flow_data, session_id)
            req = flow_data.get("request") or {}
            res = flow_data.get("response") or {}
            req_body, req_ref = db._process_body(
                flow_id,
                session_id,
                (req.get("postData") or {}).get("text", ""),
                "request",
            )
            res_body, res_ref = db._process_body(
                flow_id,
                session_id,
                (res.get("content") or {}).get("text", ""),
                "response",
            )
            detail_json = db._build_flow_data_clean(flow_data, req_ref, res_ref)
            prepared.append((flow_id, index_data, detail_json, req_body, req_ref, res_body, res_ref))
        except Exception as e:
            db.logger.warning(f"store_flows_batch: skipping flow {flow_id}: {e}")
            errors += 1

    for batch_start in range(0, len(prepared), batch_size):
        batch = prepared[batch_start : batch_start + batch_size]
        with db._lock:
            conn = db._get_conn()
            try:
                for flow_id, index_data, detail_json, req_body, req_ref, res_body, res_ref in batch:
                    db._insert_flow_rows(
                        conn,
                        flow_id,
                        session_id,
                        index_data,
                        detail_json,
                        req_body,
                        req_ref,
                        res_body,
                        res_ref,
                    )
                conn.commit()
                stored += len(batch)
                db._last_write_ts = time.time()
            except Exception as e:
                conn.rollback()
                db.logger.error(
                    f"store_flows_batch: batch commit failed at offset "
                    f"{batch_start}: {e}"
                )
                errors += len(batch)

    if stored > 0:
        with db._lock:
            conn = db._get_conn()
            conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (time.time(), session_id),
            )
            conn.commit()

    elapsed_ms = (time.time() - t0) * 1000
    db.logger.info(
        f"store_flows_batch: {stored} flows stored in {elapsed_ms:.0f}ms "
        f"({len(flows)} total, {errors} errors, "
        f"batch_size={batch_size})"
    )
    return stored


def extract_index(db, flow_data: Dict, session_id: str) -> Dict:
    """Extract index fields from flow data."""
    from decimal import Decimal

    req = flow_data.get("request") or {}
    res = flow_data.get("response") or {}
    rc = flow_data.get("_rc") or {}

    def to_float(v, default=0.0):
        if v is None:
            return default
        if isinstance(v, Decimal):
            return float(v)
        return v

    return {
        "id": flow_data.get("id"),
        "session_id": session_id,
        "method": req.get("method", ""),
        "url": req.get("url", ""),
        "host": flow_data.get("host", ""),
        "path": flow_data.get("path", ""),
        "status": to_float(res.get("status"), 0),
        "http_version": flow_data.get("httpVersion", "") or req.get("httpVersion", ""),
        "content_type": flow_data.get("contentType", ""),
        "started_datetime": flow_data.get("startedDateTime", ""),
        "time": to_float(flow_data.get("time"), 0),
        "size": to_float(
            flow_data.get("size") or (flow_data.get("response") or {}).get("content", {}).get("size", 0),
            0,
        ),
        "client_ip": rc.get("clientIp", "") or flow_data.get("clientIp", ""),
        "app_name": rc.get("appName", "") or flow_data.get("appName", ""),
        "app_display_name": rc.get("appDisplayName", "") or flow_data.get("appDisplayName", ""),
        "has_error": 1 if rc.get("error") else 0,
        "has_request_body": 1 if (req.get("postData") or {}).get("text") else 0,
        "has_response_body": 1 if (res.get("content") or {}).get("text") else 0,
        "is_websocket": 1 if rc.get("isWebsocket") else 0,
        "is_sse": 1 if rc.get("isSse") else 0,
        "websocket_frame_count": to_float(rc.get("websocketFrameCount"), 0),
        "is_intercepted": 1 if (rc.get("intercept") or {}).get("intercepted") else 0,
        "hits": json.dumps(rc.get("hits", [])),
        "msg_ts": to_float(flow_data.get("msg_ts"), time.time()),
    }


def get_indices(db, session_id: str = None, since: float = 0, limit: int = None) -> List[Dict]:
    """Get flow indices for polling."""
    import time as time_module

    t0 = time_module.time()

    if session_id is None:
        session_id = db._get_session_id(session_id)
        if session_id is None:
            return []

    def _query(conn):
        t1 = time_module.time()

        query = """
            SELECT * FROM flow_indices
            WHERE session_id = ? AND msg_ts >= ?
            ORDER BY msg_ts ASC
        """
        params = [session_id, since]

        if limit:
            query += " LIMIT ?"
            params.append(limit)

        rows = conn.execute(query, params).fetchall()
        t2 = time_module.time()

        result = []
        for row in rows:
            item = dict(row)
            if item.get("hits"):
                try:
                    item["hits"] = json.loads(item["hits"])
                except (json.JSONDecodeError, TypeError):
                    item["hits"] = []
            else:
                item["hits"] = []
            result.append(item)
        t3 = time_module.time()

        total_ms = (t3 - t0) * 1000
        if total_ms > 100 or len(result) > 100:
            db.logger.info(
                f"get_indices ({total_ms:.0f}ms, {len(result)} rows): "
                f"session={(t1-t0)*1000:.0f}ms, "
                f"query={(t2-t1)*1000:.0f}ms, "
                f"parse={(t3-t2)*1000:.0f}ms"
            )

        return result

    return db._execute_with_retry("get_indices", _query)


def get_flow_seq(db, flow_id: str) -> Optional[int]:
    """Get sequence number for an existing flow, or None if not exists."""
    if not flow_id:
        return None
    conn = db._get_conn()
    row = conn.execute("SELECT seq FROM flow_indices WHERE id = ?", (flow_id,)).fetchone()
    return row["seq"] if row else None


def get_detail(db, flow_id: str) -> Optional[Dict]:
    """Get full flow detail, loading bodies as needed."""
    import time as time_module

    t0 = time_module.time()

    def _query(conn):
        t1 = time_module.time()
        row = conn.execute(
            """
            SELECT id, session_id, data, request_body_ref, response_body_ref
            FROM flow_details WHERE id = ?
            """,
            (flow_id,),
        ).fetchone()
        t2 = time_module.time()

        if not row:
            return None

        flow_data = json.loads(row["data"])
        session_id = row["session_id"]
        req_ref = row["request_body_ref"]
        res_ref = row["response_body_ref"]
        t3 = time_module.time()

        compressed_bodies = {}
        if req_ref == "compressed" or res_ref == "compressed":
            body_rows = conn.execute(
                """
                SELECT type, data FROM flow_bodies WHERE flow_id = ?
                """,
                (flow_id,),
            ).fetchall()
            for body_row in body_rows:
                compressed_bodies[body_row["type"]] = body_row["data"]
        t4 = time_module.time()

        if req_ref and req_ref != "inline":
            body = db._load_body(conn, flow_id, session_id, req_ref, "request", compressed_bodies)
            if body and flow_data.get("request", {}).get("postData"):
                flow_data["request"]["postData"]["text"] = body

        if res_ref and res_ref != "inline":
            body = db._load_body(conn, flow_id, session_id, res_ref, "response", compressed_bodies)
            if body and flow_data.get("response", {}).get("content"):
                flow_data["response"]["content"]["text"] = body
        t5 = time_module.time()

        total_ms = (t5 - t0) * 1000
        if total_ms > 100:
            db.logger.info(
                f"get_detail SLOW ({total_ms:.0f}ms): "
                f"conn={(t1-t0)*1000:.0f}ms, "
                f"query={(t2-t1)*1000:.0f}ms, "
                f"json={(t3-t2)*1000:.0f}ms, "
                f"bodies={(t4-t3)*1000:.0f}ms, "
                f"restore={(t5-t4)*1000:.0f}ms"
            )

        return flow_data

    return db._execute_with_retry("get_detail", _query)
