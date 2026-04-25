"""Centralized error handling for HTTP handlers."""
from typing import Any

CORS_HEADERS = {"Access-Control-Allow-Origin": "*"}
JSON_HEADERS = {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}


def make_error_response(Response: Any, error: Exception) -> Any:
    """Build a standardized 500 error response for unhandled handler failures."""
    return Response.make(
        500,
        str(error).encode("utf-8"),
        {"Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*"},
    )
