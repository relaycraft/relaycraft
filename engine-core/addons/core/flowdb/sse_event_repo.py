"""SSE event persistence helpers for FlowDatabase."""

import json
import time
from typing import Any, Dict, List, Tuple


def store_sse_events(db, flow_id: str, events: List[Dict]) -> int:
    """Persist SSE events for a flow. Returns number of rows written."""
    if not flow_id or not events:
        return 0

    def _resolve_session(conn):
        row = conn.execute(
            "SELECT session_id FROM flow_indices WHERE id = ? LIMIT 1",
            (flow_id,),
        ).fetchone()
        if row and row["session_id"]:
            return row["session_id"]
        return db._get_session_id(None)

    rows: List[Tuple] = []
    written = 0
    with db._lock:
        conn = db._get_conn()
        try:
            session_id = _resolve_session(conn)
            if not session_id:
                return 0

            for evt in events:
                seq = evt.get("seq")
                if seq is None:
                    continue
                evt_id = f"{flow_id}:{int(seq)}"
                rows.append(
                    (
                        evt_id,
                        flow_id,
                        session_id,
                        int(seq),
                        int(evt.get("ts", int(time.time() * 1000))),
                        evt.get("event"),
                        evt.get("id"),
                        evt.get("retry"),
                        evt.get("data", ""),
                        int(evt.get("rawSize", 0)),
                    )
                )

            if not rows:
                return 0

            conn.executemany(
                """
                INSERT OR REPLACE INTO sse_events
                (id, flow_id, session_id, seq, ts, event, event_id, retry, data, raw_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
            written = len(rows)
        except Exception:
            conn.rollback()
            raise

    return written


def get_sse_events(db, flow_id: str, since_seq: int = 0, limit: int = 200) -> Dict[str, Any]:
    """Read persisted SSE events for a flow."""
    if not flow_id:
        return {"events": [], "nextSeq": max(0, since_seq)}

    since = max(0, int(since_seq or 0))
    limit_value = max(1, int(limit or 200))

    def _query(conn):
        rows = conn.execute(
            """
            SELECT seq, ts, event, event_id, retry, data, raw_size
            FROM sse_events
            WHERE flow_id = ? AND seq >= ?
            ORDER BY seq ASC
            LIMIT ?
            """,
            (flow_id, since, limit_value),
        ).fetchall()

        events = []
        for row in rows:
            events.append(
                {
                    "flowId": flow_id,
                    "seq": int(row["seq"]),
                    "ts": int(row["ts"]),
                    "event": row["event"],
                    "id": row["event_id"],
                    "retry": row["retry"],
                    "data": row["data"] or "",
                    "rawSize": int(row["raw_size"] or 0),
                }
            )

        if events:
            next_seq = int(events[-1]["seq"]) + 1
            return {"events": events, "nextSeq": next_seq}

        # Fallback path: legacy/partial writes can leave sse_events empty.
        # Recover from flow_details snapshot (_rc.sseEvents) for history replay.
        detail_row = conn.execute(
            "SELECT data FROM flow_details WHERE id = ? LIMIT 1",
            (flow_id,),
        ).fetchone()
        if detail_row and detail_row["data"]:
            try:
                detail_data = json.loads(detail_row["data"])
                snapshot = (((detail_data.get("_rc") or {}).get("sseEvents")) or [])
                filtered = []
                for evt in snapshot:
                    seq = evt.get("seq")
                    if seq is None:
                        continue
                    if int(seq) < since:
                        continue
                    filtered.append(
                        {
                            "flowId": flow_id,
                            "seq": int(seq),
                            "ts": int(evt.get("ts", int(time.time() * 1000))),
                            "event": evt.get("event"),
                            "id": evt.get("id"),
                            "retry": evt.get("retry"),
                            "data": evt.get("data", "") or "",
                            "rawSize": int(evt.get("rawSize", 0)),
                        }
                    )
                filtered = filtered[:limit_value]
                if filtered:
                    return {"events": filtered, "nextSeq": int(filtered[-1]["seq"]) + 1}
            except Exception:
                pass

        max_row = conn.execute(
            "SELECT MAX(seq) AS max_seq FROM sse_events WHERE flow_id = ?",
            (flow_id,),
        ).fetchone()
        max_seq = max_row["max_seq"] if max_row else None
        next_seq = int(max_seq) + 1 if max_seq is not None else since
        return {"events": events, "nextSeq": next_seq}

    return db._execute_with_retry("get_sse_events", _query)
