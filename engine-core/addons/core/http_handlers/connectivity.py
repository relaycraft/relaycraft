"""
Connectivity Check Handler — diagnostic endpoint for mobile setup verification.

Provides a simple health-check endpoint that confirms:
- The mobile device is properly connected through the proxy
- The proxy engine is running
- Basic connectivity information
"""

import json
import socket
from typing import Any

from .errors import CORS_HEADERS, JSON_HEADERS


def _get_lan_ip() -> str:
    """Auto-detect LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _handle_connectivity(monitor: Any, flow: Any, Response: Any) -> None:
    """Handle GET /_relay/connectivity — returns proxy connectivity diagnostic info."""
    client_ip = (
        flow.client_conn.address[0]
        if flow.client_conn and flow.client_conn.address else None
    )
    server_ip = (
        flow.server_conn.address[0]
        if flow.server_conn and flow.server_conn.address else None
    )

    lan_ip = _get_lan_ip()
    is_local = client_ip in ("127.0.0.1", "::1", "localhost", None)

    # Detect if the request came through the proxy (mobile) or is local
    connection_type = "proxy" if not is_local else "local"

    data = {
        "status": "connected",
        "message": "Your device is successfully connected through RelayCraft proxy.",
        "connection_type": connection_type,
        "client_ip": client_ip,
        "lan_ip": lan_ip,
        "proxy_port": flow.request.port if flow.request.port else None,
    }

    json_str = json.dumps(data, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)
