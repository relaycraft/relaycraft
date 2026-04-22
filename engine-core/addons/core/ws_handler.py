import base64
import hashlib
import time
from typing import Any, Dict, List, Optional, Tuple

from mitmproxy import ctx


def register_ws_flow(monitor: Any, flow: Any) -> None:
    """Register an active WebSocket flow so it can receive injected frames."""
    if not flow or not getattr(flow, "id", None):
        return
    with monitor._ws_flows_lock:
        monitor._ws_flows[flow.id] = flow


def unregister_ws_flow(monitor: Any, flow: Any) -> None:
    """Remove a WebSocket flow from the inject registry when it closes."""
    if not flow or not getattr(flow, "id", None):
        return
    with monitor._ws_flows_lock:
        monitor._ws_flows.pop(flow.id, None)


def is_ws_closed(ws: Any) -> bool:
    """Check whether a mitmproxy WebSocketData is already closed on either side."""
    if ws is None:
        return True
    return bool(getattr(ws, "closed_at_client", None) or getattr(ws, "closed_at_server", None))


def ws_has_close_frame(ws: Any) -> bool:
    """Best-effort close detection from captured WS CLOSE frames."""
    messages = getattr(ws, "messages", None) or []
    for msg in reversed(messages[-20:]):
        msg_type = getattr(getattr(msg, "type", None), "name", None)
        if msg_type is None:
            msg_type = str(getattr(msg, "type", "")).lower()
        else:
            msg_type = str(msg_type).lower()
        if msg_type == "close":
            return True
    return False


def ensure_injected_seq_set(flow: Any) -> set:
    injected_seqs = flow.metadata.setdefault("_relaycraft_injected_seqs", set())
    if not isinstance(injected_seqs, set):
        injected_seqs = set(injected_seqs)
        flow.metadata["_relaycraft_injected_seqs"] = injected_seqs
    return injected_seqs


def payload_fingerprint(payload_bytes: bytes) -> Dict[str, Any]:
    return {
        "len": len(payload_bytes),
        "sha256": hashlib.sha256(payload_bytes).hexdigest(),
    }


def message_matches_fingerprint(message: Any, is_text: bool, fingerprint: Dict[str, Any]) -> bool:
    if bool(getattr(message, "from_client", False)) is not True:
        return False
    if bool(getattr(message, "is_text", False)) is not bool(is_text):
        return False
    content = getattr(message, "content", None)
    if not isinstance(content, (bytes, bytearray)):
        return False
    if len(content) != fingerprint["len"]:
        return False
    return hashlib.sha256(bytes(content)).hexdigest() == fingerprint["sha256"]


def append_pending_injected_marker(
    flow: Any, lower_bound: int, is_text: bool, fingerprint: Dict[str, Any]
) -> None:
    pending = flow.metadata.setdefault("_relaycraft_pending_injected", [])
    if not isinstance(pending, list):
        pending = []
        flow.metadata["_relaycraft_pending_injected"] = pending
    pending.append(
        {
            "lower_bound": max(0, int(lower_bound)),
            "is_text": bool(is_text),
            "len": int(fingerprint["len"]),
            "sha256": str(fingerprint["sha256"]),
            "created_at": time.time(),
        }
    )


def resolve_pending_injected_markers(monitor: Any, flow: Any, ws: Any) -> None:
    pending = flow.metadata.get("_relaycraft_pending_injected")
    if not pending or not isinstance(pending, list):
        return
    messages = getattr(ws, "messages", None) or []
    if not messages:
        return

    injected_seqs = ensure_injected_seq_set(flow)
    now = time.time()
    ttl_seconds = 15.0
    unresolved: List[Dict[str, Any]] = []

    resolved_count = 0
    for marker in pending:
        if not isinstance(marker, dict):
            continue
        created_at = float(marker.get("created_at", now))
        if now - created_at > ttl_seconds:
            continue
        lower_bound = max(0, int(marker.get("lower_bound", 0)))
        marker_fp = {
            "len": int(marker.get("len", 0)),
            "sha256": str(marker.get("sha256", "")),
        }
        marker_is_text = bool(marker.get("is_text", False))
        matched = False
        for seq in range(lower_bound, len(messages)):
            if seq in injected_seqs:
                continue
            if message_matches_fingerprint(messages[seq], marker_is_text, marker_fp):
                injected_seqs.add(seq)
                matched = True
                resolved_count += 1
                break
        if not matched:
            unresolved.append(marker)

    if unresolved:
        flow.metadata["_relaycraft_pending_injected"] = unresolved
    else:
        flow.metadata.pop("_relaycraft_pending_injected", None)
    if resolved_count > 0:
        monitor.logger.debug(
            "Resolved pending WS injected markers for flow %s: +%s (remaining=%s)",
            getattr(flow, "id", ""),
            resolved_count,
            len(unresolved),
        )


def inject_ws_frame(monitor: Any, flow_id: str, type_: str, payload: str) -> Tuple[int, Dict[str, Any]]:
    """Inject a WebSocket frame from client to server on an active flow.

    Returns (http_status, body_dict). The body always follows the shape
    {"ok": bool, "code"?: str, "message"?: str}.
    """
    if not flow_id:
        return 404, {
            "ok": False,
            "code": "flow_not_found",
            "message": "flow_id is missing",
        }

    with monitor._ws_flows_lock:
        flow = monitor._ws_flows.get(flow_id)

    if not flow or not getattr(flow, "websocket", None):
        return 404, {
            "ok": False,
            "code": "flow_not_found",
            "message": f"No active WebSocket flow for id {flow_id}",
        }

    ws = flow.websocket
    if is_ws_closed(ws):
        # Drop from registry proactively so the next call short-circuits.
        unregister_ws_flow(monitor, flow)
        return 409, {
            "ok": False,
            "code": "flow_closed",
            "message": "WebSocket connection is already closed",
        }

    if type_ not in ("text", "binary"):
        return 400, {
            "ok": False,
            "code": "invalid_payload",
            "message": f"Unsupported frame type: {type_!r}",
        }

    is_text = type_ == "text"
    try:
        if is_text:
            if not isinstance(payload, str):
                raise TypeError("text payload must be a string")
            payload_bytes = payload.encode("utf-8")
        else:
            if not isinstance(payload, str):
                raise TypeError("binary payload must be a base64 string")
            payload_bytes = base64.b64decode(payload, validate=True)
    except Exception as e:
        return 400, {
            "ok": False,
            "code": "invalid_payload",
            "message": f"Invalid payload: {e}",
        }

    if len(payload_bytes) > monitor._ws_inject_max_payload_bytes:
        return 400, {
            "ok": False,
            "code": "invalid_payload",
            "message": f"Payload {len(payload_bytes)} bytes exceeds 1 MiB limit",
        }

    try:
        # Snapshot message length before injection for best-effort seq
        # correlation.
        before_len = len(getattr(ws, "messages", None) or [])
        # mitmproxy inject.websocket's direction flag is "to_client":
        # False => client -> server, True => server -> client.
        # Our WS resend scope is fixed to client -> server.
        ctx.master.commands.call("inject.websocket", flow, False, payload_bytes, is_text)
        # Only mark injected seq after inject call succeeds. This avoids
        # stale metadata when injection fails.
        after_len = len(getattr(ws, "messages", None) or [])
        injected_seqs = ensure_injected_seq_set(flow)
        fingerprint = payload_fingerprint(payload_bytes)
        matched_seq: Optional[int] = None
        messages_after = getattr(ws, "messages", None) or []
        if after_len > before_len and messages_after:
            for seq in range(before_len, after_len):
                if seq >= len(messages_after):
                    break
                if message_matches_fingerprint(messages_after[seq], is_text, fingerprint):
                    matched_seq = seq
                    break
        if matched_seq is not None:
            injected_seqs.add(matched_seq)
            monitor.logger.debug(
                "WS inject matched immediately for flow %s at seq=%s (before=%s after=%s)",
                flow_id,
                matched_seq,
                before_len,
                after_len,
            )
        else:
            # Fallback for asynchronous append / concurrent frame races:
            # defer matching to process_flow where more messages are visible.
            append_pending_injected_marker(
                flow, lower_bound=before_len, is_text=is_text, fingerprint=fingerprint
            )
            pending = flow.metadata.get("_relaycraft_pending_injected") or []
            monitor.logger.debug(
                "WS inject deferred marker for flow %s (before=%s after=%s pending=%s)",
                flow_id,
                before_len,
                after_len,
                len(pending) if isinstance(pending, list) else 0,
            )
        return 200, {"ok": True}
    except Exception as e:
        monitor.logger.error(f"Error injecting WebSocket frame: {e}")
        return 500, {
            "ok": False,
            "code": "engine_error",
            "message": str(e),
        }
