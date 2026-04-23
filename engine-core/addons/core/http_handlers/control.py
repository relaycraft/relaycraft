import json
from typing import Any


def _handle_breakpoints(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        action = data.get("action")
        if action == "add":
            rule = data.get("rule") or {"pattern": data.get("pattern")}
            monitor.debug_mgr.add_breakpoint(rule)
        elif action == "remove":
            monitor.debug_mgr.remove_breakpoint(data.get("id") or data.get("pattern"))
        elif action == "clear":
            with monitor.debug_mgr.lock:
                monitor.debug_mgr.breakpoints = []
        elif action == "list":
            with monitor.debug_mgr.lock:
                bp_list = monitor.debug_mgr.breakpoints
                flow.response = Response.make(
                    200,
                    json.dumps(bp_list).encode("utf-8"),
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
                return

        flow.response = Response.make(200, b"OK", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_resume(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        flow_id = data.get("id")
        modifications = data.get("modifications")
        success = monitor.debug_mgr.resume_flow(flow_id, modifications)
        flow.response = Response.make(
            200 if success else 404,
            b"OK" if success else b"NOTFOUND",
            {"Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_sessions_delete_all(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        count = monitor.db.delete_all_historical_sessions()
        json_str = json.dumps({"success": True, "count": count}, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_sessions_get(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        sessions = monitor.db.list_sessions()
        json_str = json.dumps(sessions, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_sessions_post(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        session_id = monitor.db.create_session(
            name=data.get("name", "New Session"),
            description=data.get("description"),
            metadata=data.get("metadata"),
        )
        json_str = json.dumps({"id": session_id}, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_new(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        session_id = monitor.db.create_new_session_for_app_start()
        json_str = json.dumps({"id": session_id}, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_activate(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        session_id = data.get("id")
        success = monitor.db.switch_session(session_id)
        json_str = json.dumps({"success": success}, ensure_ascii=False)
        flow.response = Response.make(
            200 if success else 404,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_delete(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        session_id = data.get("id")
        success = monitor.db.delete_session(session_id)
        json_str = json.dumps({"success": success}, ensure_ascii=False)
        flow.response = Response.make(
            200 if success else 400,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_clear(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8")) if flow.request.content else {}
        session_id = data.get("id")

        if session_id:
            active = monitor.db.get_active_session()
            if active and session_id != active.get("id"):
                monitor.db.delete_session(session_id)
            else:
                monitor.db.clear_session(session_id)
        else:
            monitor.db.clear_session()

        monitor.reset_seq_counter()
        flow.response = Response.make(
            200,
            b'{"success": true}',
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})
