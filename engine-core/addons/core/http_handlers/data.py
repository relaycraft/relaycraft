import json
from typing import Any, Callable


def _handle_search(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        keyword = data.get("keyword", "").strip()
        search_type = data.get("type", "response")
        session_id_param = data.get("session_id", None)
        case_sensitive = bool(data.get("case_sensitive", False))

        if not keyword:
            result = {"matches": [], "scanned": 0}
        elif search_type == "header":
            result = monitor.db.search_by_header(
                keyword=keyword,
                session_id=session_id_param,
                case_sensitive=case_sensitive,
            )
        else:
            if search_type not in ("response", "request"):
                search_type = "response"
            result = monitor.db.search_by_body(
                keyword=keyword,
                body_type=search_type,
                session_id=session_id_param,
                case_sensitive=case_sensitive,
            )

        json_str = json.dumps(result, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(
            500,
            str(e).encode("utf-8"),
            {"Access-Control-Allow-Origin": "*"},
        )


def _handle_stats(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        stats = monitor.db.get_stats()
        json_str = json.dumps(stats, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_traffic_active(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        from ..main import is_traffic_active, set_traffic_active

        if flow.request.method == "GET":
            result = {"active": is_traffic_active()}
            json_str = json.dumps(result, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        elif flow.request.method == "POST":
            data = json.loads(flow.request.content.decode("utf-8"))
            active = data.get("active", False)
            set_traffic_active(active)
            monitor.logger.info(f"Traffic active state changed to: {active}")
            result = {"success": True, "active": active}
            json_str = json.dumps(result, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        monitor.logger.error(f"Error handling traffic_active: {e}")
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_export_session(
    monitor: Any,
    flow: Any,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> None:
    try:
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

            monitor.db.export_to_file_iter(
                export_path,
                session_id=session_id,
                format="session",
                metadata=metadata,
            )
            flow.response = Response.make(
                200,
                json.dumps({"success": True, "path": export_path}).encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            all_flows = monitor.db.get_all_flows(session_id=session_id)
            json_str = json.dumps(all_flows, default=safe_json_default, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_export_har(
    monitor: Any,
    flow: Any,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> None:
    try:
        export_path = flow.request.query.get("path")
        session_id = flow.request.query.get("session_id")

        if export_path:
            monitor.db.export_to_file_iter(export_path, session_id=session_id, format="har")
            flow.response = Response.make(
                200,
                json.dumps({"success": True, "path": export_path}).encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            all_flows = monitor.db.get_all_flows(session_id=session_id)
            har_data = {
                "log": {
                    "version": "1.2",
                    "creator": {"name": "RelayCraft", "version": "1.0"},
                    "entries": all_flows,
                }
            }
            json_str = json.dumps(har_data, default=safe_json_default, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_export_progress(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        total = monitor.db.get_flow_count()
        flow.response = Response.make(
            200,
            json.dumps({"total": total}).encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})
