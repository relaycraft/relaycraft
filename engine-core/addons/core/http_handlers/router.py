from typing import Any, Callable

from .cert import _handle_cert_serve
from .control import (
    _handle_breakpoints,
    _handle_resume,
    _handle_session_activate,
    _handle_session_clear,
    _handle_session_delete,
    _handle_session_new,
    _handle_sessions_delete_all,
    _handle_sessions_get,
    _handle_sessions_post,
)
from .data import (
    _handle_export_har,
    _handle_export_progress,
    _handle_export_session,
    _handle_search,
    _handle_stats,
    _handle_traffic_active,
)
from .importers import (
    _handle_import_har,
    _handle_import_har_file,
    _handle_import_session,
    _handle_import_session_file,
)
from .realtime import _handle_detail, _handle_poll, _handle_sse, _handle_ws_inject


def handle_realtime_routes(
    monitor: Any,
    flow: Any,
    route_key: str,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> bool:
    route_map = {
        "relay_poll": lambda: _handle_poll(monitor, flow, Response, safe_json_default),
        "relay_detail": lambda: _handle_detail(monitor, flow, Response, safe_json_default),
        "relay_sse": lambda: _handle_sse(monitor, flow, Response, safe_json_default),
        "relay_ws_inject": lambda: _handle_ws_inject(monitor, flow, Response),
    }
    handler = route_map.get(route_key)
    if not handler:
        return False
    handler()
    return True


def handle_control_routes(monitor: Any, flow: Any, route_key: str, Response: Any) -> bool:
    route_map = {
        "relay_breakpoints": lambda: _handle_breakpoints(monitor, flow, Response),
        "relay_resume": lambda: _handle_resume(monitor, flow, Response),
        "relay_sessions_delete_all": lambda: _handle_sessions_delete_all(monitor, flow, Response),
        "relay_sessions_get": lambda: _handle_sessions_get(monitor, flow, Response),
        "relay_sessions_post": lambda: _handle_sessions_post(monitor, flow, Response),
        "relay_session_new": lambda: _handle_session_new(monitor, flow, Response),
        "relay_session_activate": lambda: _handle_session_activate(monitor, flow, Response),
        "relay_session_delete": lambda: _handle_session_delete(monitor, flow, Response),
        "relay_session_clear": lambda: _handle_session_clear(monitor, flow, Response),
    }
    handler = route_map.get(route_key)
    if not handler:
        return False
    handler()
    return True


def handle_data_routes(
    monitor: Any,
    flow: Any,
    route_key: str,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> bool:
    route_map = {
        "relay_search": lambda: _handle_search(monitor, flow, Response),
        "relay_stats": lambda: _handle_stats(monitor, flow, Response),
        "relay_traffic_active": lambda: _handle_traffic_active(monitor, flow, Response),
        "relay_export_session": lambda: _handle_export_session(monitor, flow, Response, safe_json_default),
        "relay_export_har": lambda: _handle_export_har(monitor, flow, Response, safe_json_default),
        "relay_export_progress": lambda: _handle_export_progress(monitor, flow, Response),
    }
    handler = route_map.get(route_key)
    if not handler:
        return False
    handler()
    return True


def handle_import_routes(monitor: Any, flow: Any, route_key: str, Response: Any) -> bool:
    route_map = {
        "relay_import_session": lambda: _handle_import_session(monitor, flow, Response),
        "relay_import_session_file": lambda: _handle_import_session_file(monitor, flow, Response),
        "relay_import_har": lambda: _handle_import_har(monitor, flow, Response),
        "relay_import_har_file": lambda: _handle_import_har_file(monitor, flow, Response),
    }
    handler = route_map.get(route_key)
    if not handler:
        return False
    handler()
    return True


def handle_cert_routes(monitor: Any, flow: Any, route_key: str, Response: Any) -> bool:
    route_map = {
        "cert_serve": lambda: _handle_cert_serve(monitor, flow, Response),
    }
    handler = route_map.get(route_key)
    if not handler:
        return False
    handler()
    return True
