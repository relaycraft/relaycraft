"""
Traffic Monitor - HAR-Compatible Data Processing with SQLite Persistence

This module converts mitmproxy flows to HAR-compatible format.
All headers, cookies, and query parameters are preserved as arrays
to support multiple values with the same name (e.g., Set-Cookie).

Features:
- SQLite persistence for all flow data
- Session management
- Tiered body storage (inline/compressed/file)

@see https://w3c.github.io/web-performance/specs/HAR/Overview.html
"""

import time
import base64
import uuid
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple, List

from mitmproxy import http

from .debug import DebugManager
from .utils import setup_logging
from .flow_database import FlowDatabase
from .har_converters import (
    cookies_to_har,
    headers_to_har,
    normalize_har_entries,
    query_to_har,
    safe_decode,
)
from .flowdb.flow_repo import store_flow as _store_flow_repo
from . import sse_processor, ws_handler
from .http_handlers import (
    handle_realtime_routes,
    handle_control_routes,
    handle_data_routes,
    handle_import_routes,
    handle_cert_routes,
)


class TrafficMonitor:
    """Converts mitmproxy flows to HAR-compatible format with SQLite persistence."""

    def __init__(self, debug_mgr: DebugManager):
        self.logger = setup_logging()
        self.debug_mgr = debug_mgr

        # Initialize SQLite database
        self.db = FlowDatabase()
        self.logger.info("FlowDatabase initialized for traffic persistence")

        # SSE state (used by sse_processor module)
        self._sse_lock = threading.Lock()
        self._sse_states: Dict[str, Dict[str, Any]] = {}
        self._sse_max_events_per_flow = 2000
        self._sse_snapshot_persist_limit = 500
        self._sse_max_buffer_bytes = 1024 * 1024
        self._sse_default_limit = 200
        self._sse_max_limit = 1000
        self._sse_state_retention_seconds = 60.0

        # WebSocket registry (used by ws_handler module)
        self._ws_flows_lock = threading.Lock()
        self._ws_flows: Dict[str, http.HTTPFlow] = {}
        self._ws_inject_max_payload_bytes = 1024 * 1024

    # ==================== Content Processing ====================

    def decode_content(
        self, message: Any
    ) -> Tuple[str, str, bool]:
        """
        Decode message content for storage.

        Returns:
            Tuple of (content, encoding, truncated)
        """
        if not message.content:
            return "", "text", False

        # Detect content type
        content_type = ""
        for k, v in message.headers.items():
            if k.lower() == "content-type":
                content_type = v.lower()
                break

        # Binary content types
        binary_types = [
            "image/", "video/", "audio/",
            "application/octet-stream", "application/pdf",
            "application/zip", "application/x-protobuf",
            "application/x-tar", "application/gzip",
            "font/"
        ]

        # Magic number detection
        is_magic_binary = False
        prefix = message.content[:4]
        if (prefix.startswith(b'\xff\xd8\xff') or
            prefix.startswith(b'\x89PNG') or
            prefix.startswith(b'GIF8') or
            (len(prefix) > 1 and prefix[0] == 0)):
            is_magic_binary = True

        should_be_binary = any(t in content_type for t in binary_types) or is_magic_binary

        # Encode binary as base64
        if should_be_binary:
            try:
                return base64.b64encode(message.content).decode('ascii'), "base64", False
            except Exception as e:
                return f"<Error encoding binary: {e}>", "text", False

        # Try UTF-8
        try:
            return message.content.decode('utf-8'), "text", False
        except UnicodeDecodeError:
            pass

        # Fallback to base64
        try:
            return base64.b64encode(message.content).decode('ascii'), "base64", False
        except Exception as e:
            return f"<Error encoding content: {e}>", "text", False

    # ==================== Flow Processing Helpers ====================

    def _build_timings(self, flow: http.HTTPFlow) -> dict:
        """Calculate request timing breakdown from flow timestamps."""
        timings = {
            "blocked": -1, "dns": -1, "connect": -1, "ssl": -1,
            "send": -1, "wait": -1, "receive": -1,
        }
        duration = 0.0

        if not flow.request.timestamp_start:
            return timings, duration

        t_start = flow.request.timestamp_start
        t_end = (
            flow.response.timestamp_end
            if (flow.response and flow.response.timestamp_end)
            else time.time()
        )
        duration = (t_end - t_start) * 1000

        if flow.server_conn and hasattr(flow.server_conn, "timestamp_start"):
            conn = flow.server_conn
            ts_start = getattr(conn, "timestamp_start", None)
            ts_tcp = getattr(conn, "timestamp_tcp_setup", None)
            ts_tls = getattr(
                conn, "timestamp_tls_setup",
                getattr(conn, "timestamp_ssl_setup", None)
            )

            conn_is_new = ts_tcp is not None and ts_tcp >= t_start
            if conn_is_new:
                if ts_start and ts_tcp:
                    timings["dns"] = max(0, (ts_tcp - ts_start) * 1000)
                if ts_tcp and ts_tls:
                    timings["ssl"] = max(0, (ts_tls - ts_tcp) * 1000)

            if (flow.request.timestamp_end and
                    flow.response and
                    flow.response.timestamp_start):
                timings["wait"] = max(0, (
                    flow.response.timestamp_start - flow.request.timestamp_end
                ) * 1000)

        if (flow.response and
                flow.response.timestamp_start and
                flow.response.timestamp_end):
            timings["receive"] = max(
                0,
                (flow.response.timestamp_end - flow.response.timestamp_start) * 1000
            )
        elif flow.response and flow.response.timestamp_start:
            wait_ms = timings["wait"] if timings["wait"] >= 0 else 0
            timings["receive"] = max(0, duration - wait_ms)

        return timings, duration

    def _build_ws_data(self, flow: http.HTTPFlow, is_websocket: bool) -> dict:
        """Extract WebSocket frame data and manage WS lifecycle."""
        ws_frames = None
        ws_frame_count = 0
        ws_open = False

        if not is_websocket or not flow.websocket:
            return {"frames": ws_frames, "count": ws_frame_count, "open": ws_open}

        with self._ws_flows_lock:
            is_registered_open = flow.id in self._ws_flows
        ws_closed = ws_handler.is_ws_closed(flow.websocket) or ws_handler.ws_has_close_frame(flow.websocket)
        ws_open = is_registered_open and (not ws_closed)
        if is_registered_open and ws_closed:
            ws_handler.unregister_ws_flow(self, flow)
        ws_handler.resolve_pending_injected_markers(self, flow, flow.websocket)

        if not flow.websocket.messages:
            return {"frames": [], "count": 0, "open": ws_open}

        total_messages = len(flow.websocket.messages)
        ws_frame_count = total_messages
        slice_start = max(0, total_messages - 500)
        injected_seqs = flow.metadata.get("_relaycraft_injected_seqs") or set()
        if not isinstance(injected_seqs, set):
            try:
                injected_seqs = set(injected_seqs)
            except TypeError:
                injected_seqs = set()

        ws_frames = []
        for i, m in enumerate(flow.websocket.messages[-500:]):
            abs_seq = slice_start + i
            frame = {
                "id": f"{flow.id}-{abs_seq}",
                "flowId": flow.id,
                "seq": i,
                "type": m.type.name.lower() if hasattr(m.type, 'name') else str(m.type),
                "fromClient": m.from_client,
                "content": (
                    m.text if m.is_text
                    else (base64.b64encode(m.content).decode("ascii") if m.content else "")
                ),
                "encoding": "text" if m.is_text else "base64",
                "timestamp": m.timestamp * 1000,
                "length": len(m.content) if m.content else 0,
            }
            if abs_seq in injected_seqs:
                frame["injected"] = True
            ws_frames.append(frame)

        return {"frames": ws_frames, "count": ws_frame_count, "open": ws_open}

    def _build_sse_data(self, flow: http.HTTPFlow, content_type: Optional[str]) -> dict:
        """Extract SSE event data and manage SSE state."""
        is_sse = bool(flow.metadata.get("_relaycraft_is_sse")) or sse_processor.is_sse_content_type(
            content_type or ""
        )
        if is_sse:
            flow.metadata["_relaycraft_is_sse"] = True

        event_count = 0
        stream_open = False
        events_snapshot = []

        if is_sse:
            with self._sse_lock:
                state = sse_processor.ensure_sse_state(self, flow.id)
                event_count = state["next_seq"]
                stream_open = bool(state.get("stream_open", False))
                events_deque: deque = state.get("events", deque())
                events_snapshot = list(events_deque)[-self._sse_snapshot_persist_limit:]

        return {
            "is_sse": is_sse,
            "event_count": event_count,
            "stream_open": stream_open,
            "events_snapshot": events_snapshot,
        }

    # ==================== Flow Processing ====================

    def process_flow(self, flow: http.HTTPFlow) -> Optional[Dict[str, Any]]:
        """
        Convert flow to HAR-compatible serializable dict.

        Structure follows HAR 1.2 spec with RelayCraft extensions
        under the '_rc' namespace.
        """
        try:
            # ========== Body Decoding ==========
            req_body, req_enc, req_truncated = self.decode_content(flow.request)
            res_body, res_enc, res_truncated = "", "text", False
            if flow.response:
                res_body, res_enc, res_truncated = self.decode_content(flow.response)

            # ========== Sub-Processing ==========
            timings, duration = self._build_timings(flow)

            is_websocket = hasattr(flow, 'websocket') and flow.websocket is not None
            ws = self._build_ws_data(flow, is_websocket)

            # ========== URL Processing ==========
            url = flow.request.url
            if is_websocket:
                url = url.replace("https://", "wss://").replace("http://", "ws://")
            proto = flow.request.http_version
            if is_websocket:
                proto = "wss" if "wss://" in url else "ws"

            # ========== Breakpoint Status ==========
            is_paused = False
            paused_at = None
            is_aborted = flow.metadata.get("_relaycraft_aborted", False)
            with self.debug_mgr.lock:
                if flow.id in self.debug_mgr.intercepted_flows:
                    is_paused = True
                    paused_at = self.debug_mgr.intercepted_flows[flow.id]["phase"]

            # ========== Content Type & SSE ==========
            content_type = None
            for h in flow.response.headers.fields if flow.response else []:
                if h[0].lower() == b'content-type':
                    content_type = safe_decode(h[1])
                    break
            sse = self._build_sse_data(flow, content_type)

            # ========== Error Handling ==========
            error_detail = None
            sse_client_disconnect = False
            if flow.error:
                err_msg = str(flow.error)
                sse_client_disconnect = sse["is_sse"] and sse_processor.is_client_disconnect_error(err_msg)
                if not sse_client_disconnect:
                    error_detail = {"message": err_msg, "type": "connection"}

            # ========== IPs ==========
            client_ip = (
                flow.client_conn.address[0]
                if flow.client_conn and flow.client_conn.address else None
            )
            server_ip = (
                flow.server_conn.address[0]
                if flow.server_conn and flow.server_conn.address else None
            )

            # ========== Status Code ==========
            if is_websocket and not is_aborted:
                status_code = 101
            elif is_aborted:
                status_code = 0
            elif flow.response:
                status_code = flow.response.status_code
            elif sse_client_disconnect:
                status_code = 200
            else:
                status_code = 0

            # ========== Build HAR-Compatible Structure ==========
            started_dt = datetime.fromtimestamp(
                flow.request.timestamp_start, tz=timezone.utc
            ).isoformat() if flow.request.timestamp_start else ""

            hits = flow.metadata.get("_relaycraft_hits", [])
            hits.extend(getattr(flow, "_relaycraft_script_hits", []))
            hits.extend(getattr(flow, "_relaycraft_breakpoint_hits", []))

            return {
                "id": flow.id,
                "order": 0,
                "startedDateTime": started_dt,
                "time": duration,

                "request": {
                    "method": flow.request.method,
                    "url": url,
                    "httpVersion": proto,
                    "headers": headers_to_har(flow.request.headers),
                    "cookies": cookies_to_har(flow.request.cookies),
                    "queryString": query_to_har(flow.request.query),
                    "postData": {
                        "mimeType": content_type or "text/plain",
                        "text": req_body,
                    } if req_body else None,
                    "bodySize": len(flow.request.content) if flow.request.content else 0,
                    "headersSize": -1,
                    "_parsedUrl": {
                        "scheme": "https" if url.startswith("https") or url.startswith("wss") else "http",
                        "host": flow.request.host,
                        "port": flow.request.port,
                        "path": flow.request.path,
                        "query": flow.request.query_string if hasattr(flow.request, 'query_string') else "",
                    },
                },

                "response": {
                    "status": status_code,
                    "statusText": flow.response.reason if flow.response else "",
                    "httpVersion": proto,
                    "headers": headers_to_har(flow.response.headers) if flow.response else [],
                    "cookies": cookies_to_har(flow.response.cookies) if flow.response else [],
                    "content": {
                        "size": len(flow.response.content) if flow.response and flow.response.content else 0,
                        "mimeType": content_type or "",
                        "text": res_body,
                        "encoding": res_enc,
                    },
                    "headersSize": -1,
                    "bodySize": len(flow.response.content) if flow.response and flow.response.content else 0,
                    "redirectUrl": "",
                },

                "timings": timings,
                "cache": {},

                "_rc": {
                    "clientIp": client_ip,
                    "serverIp": server_ip,
                    "error": error_detail,
                    "isWebsocket": is_websocket,
                    "isSse": sse["is_sse"],
                    "sseEventCount": sse["event_count"],
                    "sseStreamOpen": sse["stream_open"],
                    "sseEvents": sse["events_snapshot"],
                    "websocketFrameCount": ws["count"],
                    "websocketFrames": ws["frames"],
                    "wsOpen": ws["open"],
                    "hits": hits,
                    "intercept": {
                        "intercepted": is_paused,
                        "phase": paused_at,
                    },
                    "bodyTruncated": req_truncated or res_truncated,
                },

                "msg_ts": flow.metadata.get("_relaycraft_msg_ts", time.time()),
            }

        except Exception as e:
            self.logger.error(f"Error processing flow: {e}")
            import traceback
            traceback.print_exc()
            return None

    # ==================== TLS Error Handling ====================

    def process_tls_error(self, tls_start: Any) -> None:
        """Synthesize a flow record from a TLS error."""
        try:
            client_conn = tls_start.context.client
            server_conn = tls_start.context.server

            client_ip = client_conn.peername[0] if client_conn.peername else None
            server_ip = server_conn.peername[0] if server_conn.peername else None
            sni = client_conn.sni or (
                server_conn.address[0] if server_conn.address else "unknown"
            )

            conn_error = (
                getattr(tls_start, "conn", None) and
                getattr(tls_start.conn, "error", None)
            )
            if not conn_error:
                conn_error = getattr(tls_start, "error", None)

            error_msg = str(conn_error) if conn_error else "Client TLS Handshake Failed"
            flow_id = str(uuid.uuid4())

            flow_data = {
                "id": flow_id,
                "order": 0,
                "startedDateTime": datetime.now(tz=timezone.utc).isoformat(),
                "time": 0,
                "request": {
                    "method": "CONNECT",
                    "url": f"https://{sni}/",
                    "httpVersion": "",
                    "headers": [],
                    "cookies": [],
                    "queryString": [],
                    "bodySize": 0,
                    "headersSize": -1,
                },
                "response": {
                    "status": 0,
                    "statusText": "",
                    "httpVersion": "",
                    "headers": [],
                    "cookies": [],
                    "content": {"size": 0, "mimeType": "", "text": ""},
                    "headersSize": -1,
                    "bodySize": 0,
                    "redirectUrl": "",
                },
                "timings": {},
                "cache": {},
                "_rc": {
                    "clientIp": client_ip,
                    "serverIp": server_ip,
                    "error": {
                        "message": error_msg,
                        "type": "tls",
                    },
                    "isWebsocket": False,
                    "websocketFrameCount": 0,
                    "hits": [],
                    "intercept": {"intercepted": False, "phase": None},
                    "bodyTruncated": False,
                },
                "msg_ts": time.time(),
            }

            self._store_flow(flow_data)

        except Exception as e:
            self.logger.error(f"Error processing TLS error: {e}")

    # ==================== WebSocket ====================

    def handle_websocket_message(self, flow: http.HTTPFlow) -> None:
        """Called when a new websocket message arrives."""
        flow.metadata["_relaycraft_msg_ts"] = time.time()
        flow_data = self.process_flow(flow)
        if flow_data:
            self._store_flow(flow_data)

    # ==================== HTTP Handlers ====================

    def _resolve_request_route(self, flow: http.HTTPFlow) -> str:
        path = flow.request.path
        method = flow.request.method
        host = flow.request.host

        if method == "OPTIONS" and path.startswith("/_relay"):
            return "relay_options"
        if "/_relay/poll" in path:
            return "relay_poll"
        if "/_relay/detail" in path:
            return "relay_detail"
        if "/_relay/sse" in path:
            return "relay_sse"
        if "/_relay/ws/inject" in path:
            return "relay_ws_inject"
        if "/_relay/breakpoints" in path:
            return "relay_breakpoints"
        if "/_relay/resume" in path:
            return "relay_resume"
        if "/_relay/sessions/delete_all" in path:
            return "relay_sessions_delete_all"
        if "/_relay/sessions" in path and method == "GET":
            return "relay_sessions_get"
        if "/_relay/sessions" in path and method == "POST":
            return "relay_sessions_post"
        if "/_relay/session/new" in path and method == "POST":
            return "relay_session_new"
        if "/_relay/session/activate" in path:
            return "relay_session_activate"
        if "/_relay/session/delete" in path:
            return "relay_session_delete"
        if "/_relay/session/clear" in path:
            return "relay_session_clear"
        if "/_relay/search" in path and method == "POST":
            return "relay_search"
        if "/_relay/stats" in path:
            return "relay_stats"
        if "/_relay/traffic_active" in path:
            return "relay_traffic_active"
        if "/_relay/export_session" in path:
            return "relay_export_session"
        if "/_relay/export_har" in path:
            return "relay_export_har"
        if "/_relay/export_progress" in path:
            return "relay_export_progress"
        if "/_relay/import_session" in path and "_file" not in path:
            return "relay_import_session"
        if "/_relay/import_session_file" in path:
            return "relay_import_session_file"
        if "/_relay/import_har" in path and "_file" not in path:
            return "relay_import_har"
        if "/_relay/import_har_file" in path:
            return "relay_import_har_file"
        if (
            host == "relay.guide"
            or path == "/cert"
            or path.startswith("/cert?")
            or path in ("/cert.pem", "/cert.crt")
        ):
            return "cert_serve"
        return ""

    async def handle_request(self, flow: http.HTTPFlow) -> None:
        """Handle polling and control requests."""
        from mitmproxy.http import Response

        route_key = self._resolve_request_route(flow)

        # CORS preflight
        if route_key == "relay_options":
            flow.response = Response.make(200, b"", {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            })
            return

        def safe_json_default(obj):
            if isinstance(obj, bytes):
                return obj.decode('utf-8', 'replace')
            try:
                return str(obj)
            except Exception:
                return "<Non-serializable>"

        if handle_realtime_routes(self, flow, route_key, Response, safe_json_default):
            return

        if handle_control_routes(self, flow, route_key, Response):
            return

        if handle_data_routes(self, flow, route_key, Response, safe_json_default):
            return

        if handle_import_routes(self, flow, route_key, Response):
            return

        if handle_cert_routes(self, flow, route_key, Response):
            return

    # ==================== Import Helpers ====================

    def _build_session_indices(self, flows: list) -> list:
        """Build lightweight index dicts from already-parsed session flows."""
        indices = []
        for f in flows:
            rc = f.get("_rc") or {}
            req = f.get("request") or {}
            resp = f.get("response") or {}
            parsed_url = req.get("_parsedUrl") or {}
            indices.append({
                "id": f.get("id"),
                "msg_ts": f.get("msg_ts", 0),
                "method": req.get("method") or "",
                "url": req.get("url") or "",
                "host": parsed_url.get("host") or f.get("host") or "",
                "path": parsed_url.get("path") or f.get("path") or "",
                "status": resp.get("status") or 0,
                "contentType": (resp.get("content") or {}).get("mimeType", "") or f.get("contentType") or "",
                "startedDateTime": f.get("startedDateTime") or "",
                "time": f.get("time") or 0,
                "size": (resp.get("content") or {}).get("size", 0) or f.get("size") or 0,
                "hasError": bool(rc.get("error")),
                "hasRequestBody": bool((req.get("postData") or {}).get("text")),
                "hasResponseBody": bool((resp.get("content") or {}).get("text")),
                "isWebsocket": bool(rc.get("isWebsocket")),
                "isSse": bool(rc.get("isSse")),
                "websocketFrameCount": rc.get("websocketFrameCount") or 0,
                "isIntercepted": bool((rc.get("intercept") or {}).get("intercepted")),
                "hits": [
                    {
                        "id": (h or {}).get("id") or "",
                        "name": (h or {}).get("name") or "",
                        "type": (h or {}).get("type") or "",
                        "status": (h or {}).get("status"),
                    }
                    for h in (rc.get("hits") or [])
                ],
            })
        return indices

    def _store_flow(self, flow_data: Dict) -> None:
        """Store flow data to database."""
        try:
            _store_flow_repo(self.db, flow_data)
        except Exception as e:
            import traceback
            self.logger.error(f"Error storing flow to database: {e}")
            self.logger.error(traceback.format_exc())

    def handle_response(self, flow: http.HTTPFlow) -> None:
        """Capture flows on response."""
        if flow.request.path.startswith("/_relay"):
            return
        flow_data = self.process_flow(flow)
        if flow_data:
            self._store_flow(flow_data)
