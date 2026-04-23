import json
import traceback
from typing import Any, Callable


def _handle_poll(monitor: Any, flow: Any, Response: Any, safe_json_default: Callable[[Any], str]) -> None:
    try:
        query = flow.request.query
        try:
            since_param = query.get("since", "0")
            if not since_param:
                since_param = "0"
            since_ts = float(since_param)
        except ValueError:
            since_ts = 0.0

        session_id_param = query.get("session_id", None)
        db_indices = monitor.db.get_indices(session_id=session_id_param, since=since_ts)

        indices = []
        for idx in db_indices:
            indices.append(
                {
                    "id": idx.get("id"),
                    "method": idx.get("method", ""),
                    "url": idx.get("url", ""),
                    "host": idx.get("host", ""),
                    "path": idx.get("path", ""),
                    "status": idx.get("status", 0),
                    "httpVersion": idx.get("http_version", ""),
                    "contentType": idx.get("content_type", ""),
                    "startedDateTime": idx.get("started_datetime", ""),
                    "time": idx.get("time", 0),
                    "size": idx.get("size", 0),
                    "clientIp": idx.get("client_ip", ""),
                    "appName": idx.get("app_name", ""),
                    "appDisplayName": idx.get("app_display_name", ""),
                    "hasError": bool(idx.get("has_error")),
                    "hasRequestBody": bool(idx.get("has_request_body")),
                    "hasResponseBody": bool(idx.get("has_response_body")),
                    "isWebsocket": bool(idx.get("is_websocket")),
                    "isSse": bool(idx.get("is_sse")),
                    "websocketFrameCount": idx.get("websocket_frame_count", 0),
                    "isIntercepted": bool(idx.get("is_intercepted")),
                    "hits": idx.get("hits", []),
                    "msg_ts": idx.get("msg_ts"),
                }
            )

        max_msg_ts = 0
        if indices:
            max_msg_ts = max(idx.get("msg_ts", 0) for idx in indices)

        response_data = {
            "indices": indices,
            "server_ts": max_msg_ts if max_msg_ts > 0 else since_ts,
            "notifications": monitor.db.drain_notifications(),
        }
        json_str = json.dumps(response_data, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
        flow.response.status_code = 200
        flow.response.reason = b"OK"

    except Exception as e:
        tb = traceback.format_exc()
        print(f"RelayCraft Poll Error:\n{tb}")
        monitor.logger.error(f"Error in poll handler: {tb}")
        error_resp = {"error": str(e), "traceback": tb}
        try:
            safe_err = json.dumps(error_resp, default=safe_json_default)
            flow.response = Response.make(
                500,
                safe_err.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        except Exception:
            flow.response = Response.make(
                500,
                b'{"error": "Critical serialization failure"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )


def _handle_detail(monitor: Any, flow: Any, Response: Any, safe_json_default: Callable[[Any], str]) -> None:
    try:
        query = flow.request.query
        flow_id = query.get("id", "")

        if not flow_id:
            flow.response = Response.make(
                400,
                b'{"error": "Missing flow id"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        flow_data = monitor.db.get_detail(flow_id)
        if not flow_data:
            flow.response = Response.make(
                404,
                b'{"error": "Flow not found"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        json_str = json.dumps(flow_data, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )

    except Exception as e:
        tb = traceback.format_exc()
        print(f"RelayCraft Detail Error:\n{tb}")
        monitor.logger.error(f"Error in detail handler: {tb}")
        error_resp = {"error": str(e), "traceback": tb}
        try:
            safe_err = json.dumps(error_resp, default=safe_json_default)
            flow.response = Response.make(
                500,
                safe_err.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        except Exception:
            flow.response = Response.make(
                500,
                b'{"error": "Critical serialization failure"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )


def _handle_sse(monitor: Any, flow: Any, Response: Any, safe_json_default: Callable[[Any], str]) -> None:
    try:
        query = flow.request.query
        flow_id = query.get("flow_id", "")
        if not flow_id:
            flow.response = Response.make(
                400,
                b'{"error": "Missing flow_id"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        try:
            since_seq = int(query.get("since_seq", "0") or "0")
        except ValueError:
            since_seq = 0

        try:
            limit = int(query.get("limit", str(monitor._sse_default_limit)) or str(monitor._sse_default_limit))
        except ValueError:
            limit = monitor._sse_default_limit

        payload = monitor.get_sse_events(flow_id, since_seq=since_seq, limit=limit)
        json_str = json.dumps(payload, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        error_resp = {"error": str(e)}
        flow.response = Response.make(
            500,
            json.dumps(error_resp, ensure_ascii=False).encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )


def _handle_ws_inject(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        if flow.request.method != "POST":
            flow.response = Response.make(
                405,
                b'{"ok": false, "code": "invalid_payload", "message": "POST required"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        try:
            raw = flow.request.content.decode("utf-8") if flow.request.content else ""
            data = json.loads(raw) if raw else {}
        except Exception as e:
            body = json.dumps(
                {"ok": False, "code": "invalid_payload", "message": f"Invalid JSON: {e}"},
                ensure_ascii=False,
            )
            flow.response = Response.make(
                400,
                body.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        flow_id = data.get("flowId") or data.get("flow_id") or ""
        frame_type = data.get("type", "text")
        payload = data.get("payload", "")

        status, body_dict = monitor.inject_ws_frame(flow_id, frame_type, payload)
        body_json = json.dumps(body_dict, ensure_ascii=False)
        flow.response = Response.make(
            status,
            body_json.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        error_resp = {"ok": False, "code": "engine_error", "message": str(e)}
        flow.response = Response.make(
            500,
            json.dumps(error_resp, ensure_ascii=False).encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
