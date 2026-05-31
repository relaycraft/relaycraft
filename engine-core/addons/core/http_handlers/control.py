import json
from typing import Any

from ..flowdb import (
    clear_session,
    create_new_session as db_create_new_session,
    create_session,
    delete_all_historical_sessions,
    delete_session,
    get_active_session,
    list_sessions,
    switch_session,
)
from ..script_load_report import get_report
from .errors import CORS_HEADERS, JSON_HEADERS


def _handle_breakpoints(monitor: Any, flow: Any, Response: Any) -> None:
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
                200, json.dumps(bp_list).encode("utf-8"), JSON_HEADERS,
            )
            return

    flow.response = Response.make(200, b"OK", CORS_HEADERS)


def _handle_resume(monitor: Any, flow: Any, Response: Any) -> None:
    data = json.loads(flow.request.content.decode("utf-8"))
    flow_id = data.get("id")
    modifications = data.get("modifications")
    success = monitor.debug_mgr.resume_flow(flow_id, modifications)
    flow.response = Response.make(
        200 if success else 404,
        b"OK" if success else b"NOTFOUND",
        CORS_HEADERS,
    )


def _handle_sessions_delete_all(monitor: Any, flow: Any, Response: Any) -> None:
    count = delete_all_historical_sessions(monitor.db)
    json_str = json.dumps({"success": True, "count": count}, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_sessions_get(monitor: Any, flow: Any, Response: Any) -> None:
    sessions = list_sessions(monitor.db)
    json_str = json.dumps(sessions, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_sessions_post(monitor: Any, flow: Any, Response: Any) -> None:
    data = json.loads(flow.request.content.decode("utf-8"))
    session_id = create_session(
        monitor.db,
        name=data.get("name", "New Session"),
        description=data.get("description"),
        metadata=data.get("metadata"),
    )
    json_str = json.dumps({"id": session_id}, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_session_new(monitor: Any, flow: Any, Response: Any) -> None:
    session_id = monitor.db.create_new_session_for_app_start()
    json_str = json.dumps({"id": session_id}, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_session_activate(monitor: Any, flow: Any, Response: Any) -> None:
    data = json.loads(flow.request.content.decode("utf-8"))
    session_id = data.get("id")
    success = switch_session(monitor.db, session_id)
    json_str = json.dumps({"success": success}, ensure_ascii=False)
    flow.response = Response.make(
        200 if success else 404, json_str.encode("utf-8"), JSON_HEADERS,
    )


def _handle_session_delete(monitor: Any, flow: Any, Response: Any) -> None:
    data = json.loads(flow.request.content.decode("utf-8"))
    session_id = data.get("id")
    success = delete_session(monitor.db, session_id)
    json_str = json.dumps({"success": success}, ensure_ascii=False)
    flow.response = Response.make(
        200 if success else 400, json_str.encode("utf-8"), JSON_HEADERS,
    )


def _handle_database_reset(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        db = monitor.db
        from ..flowdb import get_flow_count, vacuum
        active = get_active_session(db)

        # 1. Count active session flows before clearing
        cleared = get_flow_count(db, active['id']) if active else 0

        # 2. Clear the active session's flows
        if active:
            clear_session(db, active['id'])

        # 3. Delete all inactive sessions
        deleted = delete_all_historical_sessions(db)

        # 4. Reclaim disk space
        vacuum(db, full=True)

        json_str = json.dumps({
            "success": True,
            "cleared_active_flows": cleared,
            "deleted_sessions": deleted,
        }, ensure_ascii=False)
        flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)
    except Exception as e:
        monitor.logger.error(f"Database reset failed: {e}")
        json_str = json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)
        flow.response = Response.make(500, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_session_clear(monitor: Any, flow: Any, Response: Any) -> None:
    data = json.loads(flow.request.content.decode("utf-8")) if flow.request.content else {}
    session_id = data.get("id")

    if session_id:
        active = get_active_session(monitor.db)
        if active and session_id != active.get("id"):
            delete_session(monitor.db, session_id)
        else:
            clear_session(monitor.db, session_id)
    else:
        clear_session(monitor.db)

    flow.response = Response.make(200, b'{"success": true}', JSON_HEADERS)


def _handle_scripts_load_status(monitor: Any, flow: Any, Response: Any) -> None:
    """Return user script load results for the current engine process."""
    report = get_report()
    json_str = json.dumps(report, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)


def _handle_scripts_load_status(monitor: Any, flow: Any, Response: Any) -> None:
    """Return user script load results for the current engine process."""
    report = get_report()
    json_str = json.dumps(report, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)
