import codecs
import time
from collections import deque
from typing import Any, Dict, List, Optional

from .flowdb import get_sse_events as db_get_sse_events, store_sse_events as db_store_sse_events


def is_sse_content_type(content_type: str) -> bool:
    return "text/event-stream" in (content_type or "").lower()


def is_client_disconnect_error(err_msg: str) -> bool:
    if not err_msg:
        return False
    err_lower = err_msg.lower()
    disconnect_markers = (
        "client disconnected",
        "client disconnect",
        "connection reset by peer",
        "broken pipe",
        "connection closed",
        "stream closed",
        "peer closed connection",
        "eof",
        "cancelled",
        "canceled",
    )
    return any(marker in err_lower for marker in disconnect_markers)


def get_response_content_type(flow: Any) -> str:
    if not flow or not getattr(flow, "response", None):
        return ""
    for k, v in flow.response.headers.items():
        if k.lower() == "content-type":
            return v or ""
    return ""


def ensure_sse_state(monitor: Any, flow_id: str) -> Dict[str, Any]:
    state = monitor._sse_states.get(flow_id)
    if state is None:
        state = {
            "flow_id": flow_id,
            "buffer": "",
            "events": deque(maxlen=monitor._sse_max_events_per_flow),
            "next_seq": 0,
            "stream_open": True,
            "dropped_count": 0,
            "finalized": False,
            "decoder": codecs.getincrementaldecoder("utf-8")(errors="replace"),
            "last_touched": time.time(),
        }
        monitor._sse_states[flow_id] = state
    else:
        state["last_touched"] = time.time()
    return state


def cleanup_inactive_sse_states_locked(monitor: Any, now_ts: Optional[float] = None) -> None:
    now = now_ts if now_ts is not None else time.time()
    stale_ids: List[str] = []
    for flow_id, state in monitor._sse_states.items():
        if state.get("stream_open", False):
            continue
        last_touched = float(state.get("last_touched", now))
        if now - last_touched >= monitor._sse_state_retention_seconds:
            stale_ids.append(flow_id)
    for flow_id in stale_ids:
        monitor._sse_states.pop(flow_id, None)


def bind_sse_stream_if_needed(monitor: Any, flow: Any) -> None:
    """Attach mitmproxy stream callback for SSE flows."""
    if not flow or not getattr(flow, "response", None):
        return

    content_type = get_response_content_type(flow)
    if not is_sse_content_type(content_type):
        return

    flow.metadata["_relaycraft_is_sse"] = True
    flow.metadata["_relaycraft_msg_ts"] = time.time()

    with monitor._sse_lock:
        cleanup_inactive_sse_states_locked(monitor)
        state = ensure_sse_state(monitor, flow.id)
        state["stream_open"] = True
        state["finalized"] = False
        state["last_touched"] = time.time()

    # Ensure frontend can identify this flow as SSE before connection closes.
    flow_data = monitor.process_flow(flow)
    if flow_data:
        monitor._store_flow(flow_data)

    def _stream_handler(chunk: bytes) -> bytes:
        try:
            handle_sse_chunk(monitor, flow.id, chunk)
        except Exception as e:
            monitor.logger.debug(f"SSE chunk handler error: {e}")
        return chunk

    flow.response.stream = _stream_handler


def handle_sse_chunk(monitor: Any, flow_id: str, chunk: bytes) -> None:
    if not flow_id or chunk is None:
        return

    persisted_events: List[Dict[str, Any]] = []
    with monitor._sse_lock:
        state = ensure_sse_state(monitor, flow_id)
        decoder = state.get("decoder")
        if decoder is None:
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            state["decoder"] = decoder

        text = decoder.decode(chunk)
        text = text.replace("\r\n", "\n").replace("\r", "\n")

        state["buffer"] += text
        state["stream_open"] = True
        state["finalized"] = False
        state["last_touched"] = time.time()

        # Guard rail: malformed streams without frame delimiter can cause unbounded growth.
        if len(state["buffer"].encode("utf-8")) > monitor._sse_max_buffer_bytes:
            overflow_raw = state["buffer"]
            state["buffer"] = ""
            state["dropped_count"] += 1
            parsed = parse_sse_frame_locked(state, overflow_raw)
            if parsed:
                persisted_events.append(parsed)

        parts = state["buffer"].split("\n\n")
        state["buffer"] = parts.pop() if parts else ""

        for raw_event in parts:
            parsed = parse_sse_frame_locked(state, raw_event)
            if parsed:
                persisted_events.append(parsed)

    persist_sse_events(monitor, flow_id, persisted_events)


def parse_sse_frame_locked(state: Dict[str, Any], raw_event: str) -> Optional[Dict[str, Any]]:
    lines = raw_event.split("\n")
    data_lines: List[str] = []
    event_name: Optional[str] = None
    event_id: Optional[str] = None
    retry: Optional[int] = None

    for line in lines:
        if not line:
            continue
        if line.startswith(":"):
            continue

        if ":" in line:
            field, value = line.split(":", 1)
            if value.startswith(" "):
                value = value[1:]
        else:
            field, value = line, ""

        if field == "data":
            data_lines.append(value)
        elif field == "event":
            event_name = value
        elif field == "id":
            event_id = value
        elif field == "retry":
            try:
                retry = int(value)
            except (TypeError, ValueError):
                retry = None

    if not data_lines and event_name is None and event_id is None and retry is None:
        return None

    event = {
        "flowId": state["flow_id"],
        "seq": state["next_seq"],
        "ts": int(time.time() * 1000),
        "event": event_name,
        "id": event_id,
        "retry": retry,
        "data": "\n".join(data_lines),
        "rawSize": len(raw_event.encode("utf-8")),
    }

    state["next_seq"] += 1
    events_deque: deque = state["events"]
    was_full = len(events_deque) == events_deque.maxlen
    events_deque.append(event)
    if was_full:
        state["dropped_count"] += 1
    return event


def get_sse_events(monitor: Any, flow_id: str, since_seq: int = 0, limit: int = 0) -> Dict[str, Any]:
    limit_value = limit or monitor._sse_default_limit
    limit_value = max(1, min(limit_value, monitor._sse_max_limit))
    since = max(0, since_seq)

    with monitor._sse_lock:
        cleanup_inactive_sse_states_locked(monitor)
        state = monitor._sse_states.get(flow_id)
        if state is None:
            payload = db_get_sse_events(monitor.db, flow_id, since_seq=since, limit=limit_value)
            return {
                "flowId": flow_id,
                "events": payload.get("events", []),
                "nextSeq": int(payload.get("nextSeq", since)),
                "streamOpen": False,
                "droppedCount": 0,
            }

        events = [e for e in list(state["events"]) if e.get("seq", -1) >= since]
        events = events[:limit_value]
        next_seq = state["next_seq"]
        if events:
            next_seq = events[-1]["seq"] + 1

        return {
            "flowId": flow_id,
            "events": events,
            "nextSeq": next_seq,
            "streamOpen": bool(state.get("stream_open", False)),
            "droppedCount": int(state.get("dropped_count", 0)),
        }


def persist_sse_events(monitor: Any, flow_id: str, events: List[Dict[str, Any]]) -> None:
    if not flow_id or not events:
        return
    db = getattr(monitor, "db", None)
    if db is None:
        return
    try:
        db_store_sse_events(db, flow_id, events)
    except Exception as e:
        monitor.logger.debug(f"SSE events persistence failed: {e}")


def finalize_sse_flow(monitor: Any, flow: Any, stream_open: bool = False) -> None:
    if not flow or not flow.id:
        return
    if not flow.metadata.get("_relaycraft_is_sse"):
        return

    persisted_events: List[Dict[str, Any]] = []
    with monitor._sse_lock:
        state = ensure_sse_state(monitor, flow.id)
        state["stream_open"] = bool(stream_open)
        state["last_touched"] = time.time()
        already_finalized = bool(state.get("finalized", False))
        # Try to parse a trailing frame without delimiter on stream end.
        tail = state.get("buffer", "")
        tail_flushed = False
        if not stream_open:
            if not already_finalized:
                decoder = state.get("decoder")
                if decoder is not None:
                    flushed = decoder.decode(b"", final=True)
                    if flushed:
                        tail = f"{tail}{flushed}"
            state["buffer"] = ""
            if tail:
                parsed = parse_sse_frame_locked(state, tail)
                if parsed:
                    persisted_events.append(parsed)
                tail_flushed = True
            state["finalized"] = True
        else:
            state["finalized"] = False
        should_store = (not already_finalized) or tail_flushed
        cleanup_inactive_sse_states_locked(monitor)

    persist_sse_events(monitor, flow.id, persisted_events)
    if should_store:
        flow.metadata["_relaycraft_msg_ts"] = time.time()
        flow_data = monitor.process_flow(flow)
        if flow_data:
            monitor._store_flow(flow_data)
