"""HTTP handlers package thin exports."""

from .router import (
    handle_cert_routes,
    handle_control_routes,
    handle_data_routes,
    handle_import_routes,
    handle_realtime_routes,
)

__all__ = [
    "handle_realtime_routes",
    "handle_control_routes",
    "handle_data_routes",
    "handle_import_routes",
    "handle_cert_routes",
]
