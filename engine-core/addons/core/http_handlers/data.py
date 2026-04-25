import json
from typing import Any, Callable

from ..flowdb import (
    export_to_file_iter,
    get_all_flows,
    get_flow_count,
    get_stats,
    search_by_body,
    search_by_header,
)
from .errors import CORS_HEADERS, JSON_HEADERS


def _handle_search(monitor: Any, flow: Any, Response: Any) -> None:
    data = json.loads(flow.request.content.decode("utf-8"))
    keyword = data.get("keyword", "").strip()
    search_type = data.get("type", "response")
    session_id_param = data.get("session_id", None)
    case_sensitive = bool(data.get("case_sensitive", False))

    if not keyword:
        result = {"matches": [], "scanned": 0}
    elif search_type == "header":
        result = search_by_header(
            monitor.db,
            keyword=keyword,
            session_id=session_id_param,
            case_sensitive=case_sensitive,
        )
    else:
        if search_type not in ("response", "request"):
            search_type = "response"
        result = search_by_body(
            monitor.db,
            keyword=keyword,
            body_type=search_type,
            session_id=session_id_param,
            case_sensitive=case_sensitive,
        )

    json_str = json.dumps(result, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_stats(monitor: Any, flow: Any, Response: Any) -> None:
    stats = get_stats(monitor.db)
    json_str = json.dumps(stats, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_traffic_active(monitor: Any, flow: Any, Response: Any) -> None:
    from ..main import is_traffic_active, set_traffic_active

    if flow.request.method == "GET":
        result = {"active": is_traffic_active()}
        json_str = json.dumps(result, ensure_ascii=False)
        flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)
    elif flow.request.method == "POST":
        data = json.loads(flow.request.content.decode("utf-8"))
        active = data.get("active", False)
        set_traffic_active(active)
        monitor.logger.info(f"Traffic active state changed to: {active}")
        result = {"success": True, "active": active}
        json_str = json.dumps(result, ensure_ascii=False)
        flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)
    else:
        flow.response = Response.make(405, b"Method Not Allowed", CORS_HEADERS)


def _handle_export_session(
    monitor: Any,
    flow: Any,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> None:
    export_path = flow.request.query.get("path")
    session_id = flow.request.query.get("session_id")

    if export_path:
        metadata = {}
        try:
            if flow.request.content:
                body_data = json.loads(flow.request.content.decode("utf-8"))
                metadata = body_data if isinstance(body_data, dict) else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

        export_to_file_iter(
            monitor.db,
            export_path,
            session_id=session_id,
            format="session",
            metadata=metadata,
        )
        flow.response = Response.make(
            200,
            json.dumps({"success": True, "path": export_path}).encode("utf-8"),
            JSON_HEADERS,
        )
    else:
        all_flows = get_all_flows(monitor.db, session_id=session_id)
        json_str = json.dumps(all_flows, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_export_har(
    monitor: Any,
    flow: Any,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> None:
    export_path = flow.request.query.get("path")
    session_id = flow.request.query.get("session_id")

    if export_path:
        export_to_file_iter(monitor.db, export_path, session_id=session_id, format="har")
        flow.response = Response.make(
            200,
            json.dumps({"success": True, "path": export_path}).encode("utf-8"),
            JSON_HEADERS,
        )
    else:
        all_flows = get_all_flows(monitor.db, session_id=session_id)
        har_data = {
            "log": {
                "version": "1.2",
                "creator": {"name": "RelayCraft", "version": "1.0"},
                "entries": all_flows,
            }
        }
        json_str = json.dumps(har_data, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_export_progress(monitor: Any, flow: Any, Response: Any) -> None:
    total = get_flow_count(monitor.db)
    flow.response = Response.make(
        200,
        json.dumps({"total": total}).encode("utf-8"),
        JSON_HEADERS,
    )
