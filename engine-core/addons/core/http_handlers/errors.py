"""Centralized error handling for HTTP handlers."""
import json
import traceback
from typing import Any

CORS_HEADERS = {"Access-Control-Allow-Origin": "*"}
JSON_HEADERS = {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}


def make_error_response(
    Response: Any,
    error: Exception,
    monitor: Any = None,
    handler_name: str = "handler",
    safe_json_default: Any = None,
    payload: dict = None,
) -> Any:
    """Build a standardized 500 error response for unhandled handler failures."""
    tb = traceback.format_exc()
    if monitor is not None and hasattr(monitor, "logger"):
        monitor.logger.error(f"Error in {handler_name} handler: {tb}")
    else:
        print(f"RelayCraft {handler_name} Error:\n{tb}")

    body = payload.copy() if payload else {}
    body.setdefault("error", str(error))
    body.setdefault("traceback", tb)

    try:
        safe_err = json.dumps(body, default=safe_json_default, ensure_ascii=False)
        return Response.make(500, safe_err.encode("utf-8"), JSON_HEADERS)
    except Exception:
        return Response.make(
            500,
            b'{"error": "Critical serialization failure"}',
            JSON_HEADERS,
        )
