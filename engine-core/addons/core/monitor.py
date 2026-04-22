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

        # Note: seq is no longer tracked in backend
        # Frontend calculates display seq from array index (seq = index + 1)
        self._sse_lock = threading.Lock()
        self._sse_states: Dict[str, Dict[str, Any]] = {}
        self._sse_max_events_per_flow = 2000
        self._sse_snapshot_persist_limit = 500
        self._sse_max_buffer_bytes = 1024 * 1024  # 1 MiB guard rail
        self._sse_default_limit = 200
        self._sse_max_limit = 1000
        self._sse_state_retention_seconds = 60.0

        # WebSocket inject — registry of currently open WS flows.
        # Populated by CoreAddon.websocket_start, cleared by websocket_end.
        self._ws_flows_lock = threading.Lock()
        self._ws_flows: Dict[str, http.HTTPFlow] = {}
        self._ws_inject_max_payload_bytes = 1024 * 1024  # 1 MiB

    # ==================== SSE Processing ====================

    def _is_sse_content_type(self, content_type: str) -> bool:
        return sse_processor.is_sse_content_type(content_type)

    def _is_client_disconnect_error(self, err_msg: str) -> bool:
        return sse_processor.is_client_disconnect_error(err_msg)

    def _get_response_content_type(self, flow: http.HTTPFlow) -> str:
        return sse_processor.get_response_content_type(flow)

    def _ensure_sse_state(self, flow_id: str) -> Dict[str, Any]:
        return sse_processor.ensure_sse_state(self, flow_id)

    def _cleanup_inactive_sse_states_locked(self, now_ts: Optional[float] = None) -> None:
        sse_processor.cleanup_inactive_sse_states_locked(self, now_ts)

    def bind_sse_stream_if_needed(self, flow: http.HTTPFlow) -> None:
        sse_processor.bind_sse_stream_if_needed(self, flow)

    def handle_sse_chunk(self, flow_id: str, chunk: bytes) -> None:
        sse_processor.handle_sse_chunk(self, flow_id, chunk)

    def _parse_sse_frame_locked(self, state: Dict[str, Any], raw_event: str) -> Optional[Dict[str, Any]]:
        return sse_processor.parse_sse_frame_locked(state, raw_event)

    def get_sse_events(self, flow_id: str, since_seq: int = 0, limit: int = 0) -> Dict[str, Any]:
        return sse_processor.get_sse_events(self, flow_id, since_seq, limit)

    def _persist_sse_events(self, flow_id: str, events: List[Dict[str, Any]]) -> None:
        sse_processor.persist_sse_events(self, flow_id, events)

    def finalize_sse_flow(self, flow: http.HTTPFlow, stream_open: bool = False) -> None:
        sse_processor.finalize_sse_flow(self, flow, stream_open)

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

    # ==================== HAR Format Converters ====================

    def headers_to_har(self, headers) -> List[Dict[str, str]]:
        return headers_to_har(headers)

    def cookies_to_har(self, cookies) -> List[Dict[str, Any]]:
        return cookies_to_har(cookies)

    def query_to_har(self, query) -> List[Dict[str, str]]:
        return query_to_har(query)

    def _safe_decode(self, value) -> str:
        return safe_decode(value)

    # ==================== Flow Processing ====================

    def process_flow(self, flow: http.HTTPFlow) -> Optional[Dict[str, Any]]:
        """
        Convert flow to HAR-compatible serializable dict.

        Structure follows HAR 1.2 spec with RelayCraft extensions
        under the '_rc' namespace.
        """
        try:
            # ========== Request Processing ==========
            req_body, req_enc, req_truncated = self.decode_content(flow.request)
            # No truncation - frontend handles large bodies with virtual scrolling

            # ========== Response Processing ==========
            res_body, res_enc, res_truncated = "", "text", False
            if flow.response:
                res_body, res_enc, res_truncated = self.decode_content(flow.response)
                # No truncation - frontend handles large bodies with virtual scrolling

            # ========== Timing ==========
            duration = 0.0
            timings = {
                "blocked": -1,
                "dns": -1,
                "connect": -1,
                "ssl": -1,
                "send": -1,
                "wait": -1,
                "receive": -1,
            }

            if flow.request.timestamp_start:
                t_start = flow.request.timestamp_start
                t_end = (
                    flow.response.timestamp_end
                    if (flow.response and flow.response.timestamp_end)
                    else time.time()
                )
                duration = (t_end - t_start) * 1000

                # Detailed timing from server connection.
                if flow.server_conn and hasattr(flow.server_conn, "timestamp_start"):
                    conn = flow.server_conn
                    ts_start = getattr(conn, "timestamp_start", None)
                    ts_tcp = getattr(conn, "timestamp_tcp_setup", None)
                    ts_tls = getattr(
                        conn, "timestamp_tls_setup",
                        getattr(conn, "timestamp_ssl_setup", None)
                    )

                    # Connection-reuse guard: if TCP setup completed before this
                    # request started, the socket was already open (keep-alive /
                    # HTTP2 multiplex). Per HAR 1.2 spec, dns/connect/ssl should be
                    # -1 for reused connections.  Only populate them when the
                    # handshake timestamps fall within this request's window.
                    conn_is_new = ts_tcp is not None and ts_tcp >= t_start

                    if conn_is_new:
                        if ts_start and ts_tcp:
                            timings["dns"] = max(0, (ts_tcp - ts_start) * 1000)
                        if ts_tcp and ts_tls:
                            timings["ssl"] = max(0, (ts_tls - ts_tcp) * 1000)

                    # TTFB: Request End → Response Start
                    if (flow.request.timestamp_end and
                            flow.response and
                            flow.response.timestamp_start):
                        timings["wait"] = max(0, (
                            flow.response.timestamp_start - flow.request.timestamp_end
                        ) * 1000)

                # Receive: use real timestamps instead of arithmetic.
                # The old formula `duration - (timings["wait"] or 0)` had two bugs:
                #   1. In Python, -1 is truthy, so `-1 or 0` → -1, making receive = duration+1.
                #   2. Any rounding in wait propagated into receive unpredictably.
                if (flow.response and
                        flow.response.timestamp_start and
                        flow.response.timestamp_end):
                    timings["receive"] = max(
                        0,
                        (flow.response.timestamp_end - flow.response.timestamp_start) * 1000
                    )
                elif flow.response and flow.response.timestamp_start:
                    # No response end timestamp — estimate from duration minus wait.
                    wait_ms = timings["wait"] if timings["wait"] >= 0 else 0
                    timings["receive"] = max(0, duration - wait_ms)

            # ========== WebSocket ==========
            is_websocket = hasattr(flow, 'websocket') and flow.websocket is not None
            ws_frames = None
            ws_frame_count = 0
            ws_open = False

            if is_websocket and flow.websocket:
                # Use active registry as primary source of truth for "open":
                # - websocket_end unregisters immediately, so closed state is reflected fast
                # - closed_at_* flags may lag on some servers / teardown paths
                with self._ws_flows_lock:
                    is_registered_open = flow.id in self._ws_flows
                ws_closed = self._is_ws_closed(flow.websocket) or self._ws_has_close_frame(flow.websocket)
                ws_open = is_registered_open and (not ws_closed)
                if is_registered_open and ws_closed:
                    # Proactively clear stale registry entries when protocol close is observed.
                    self.unregister_ws_flow(flow)
                self._resolve_pending_injected_markers(flow, flow.websocket)

            if is_websocket and flow.websocket and flow.websocket.messages:
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
                    # Keep `seq` as the relative index into the returned slice to
                    # match the current frontend contract. The absolute index is
                    # used internally for injected-frame lookup only.
                    abs_seq = slice_start + i
                    # Stable frame.id — derived from flow + absolute seq. Must
                    # NOT be a fresh UUID per call, otherwise React's keyed list
                    # reconciliation re-mounts every row on every websocket
                    # message arrival and freezes the UI for busy streams.
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

            # ========== URL Processing ==========
            url = flow.request.url
            if is_websocket:
                url = url.replace("https://", "wss://").replace("http://", "ws://")

            # Protocol
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

            # ========== Content Type ==========
            content_type = None
            for h in flow.response.headers.fields if flow.response else []:
                if h[0].lower() == b'content-type':
                    content_type = self._safe_decode(h[1])
                    break
            is_sse = bool(flow.metadata.get("_relaycraft_is_sse")) or self._is_sse_content_type(
                content_type or ""
            )
            if is_sse:
                flow.metadata["_relaycraft_is_sse"] = True
            sse_event_count = 0
            sse_stream_open = False
            if is_sse:
                with self._sse_lock:
                    state = self._ensure_sse_state(flow.id)
                    sse_event_count = state["next_seq"]
                    sse_stream_open = bool(state.get("stream_open", False))
                    events_deque: deque = state.get("events", deque())
                    sse_events_snapshot = list(events_deque)[-self._sse_snapshot_persist_limit:]
            else:
                sse_events_snapshot = []

            # ========== Error Handling ==========
            error_detail = None
            sse_client_disconnect = False
            if flow.error:
                err_msg = str(flow.error)
                sse_client_disconnect = is_sse and self._is_client_disconnect_error(err_msg)
                if not sse_client_disconnect:
                    error_detail = {
                        "message": err_msg,
                        "type": "connection",
                    }

            # ========== IPs ==========
            client_ip = (
                flow.client_conn.address[0]
                if flow.client_conn and flow.client_conn.address
                else None
            )
            server_ip = (
                flow.server_conn.address[0]
                if flow.server_conn and flow.server_conn.address
                else None
            )

            # ========== Status Code ==========
            if is_websocket and not is_aborted:
                status_code = 101
            elif is_aborted:
                status_code = 0
            elif flow.response:
                status_code = flow.response.status_code
            elif sse_client_disconnect:
                # User-initiated close of SSE stream should not be shown as request failure.
                status_code = 200
            else:
                status_code = 0

            # ========== Build HAR-Compatible Structure ==========
            started_dt = datetime.fromtimestamp(
                flow.request.timestamp_start,
                tz=timezone.utc
            ).isoformat() if flow.request.timestamp_start else ""

            # Hits from rules/scripts/breakpoints
            hits = flow.metadata.get("_relaycraft_hits", [])
            script_hits = getattr(flow, "_relaycraft_script_hits", [])
            breakpoint_hits = getattr(flow, "_relaycraft_breakpoint_hits", [])
            
            
            hits.extend(script_hits)
            hits.extend(breakpoint_hits)

            return {
                # ========== Identity ==========
                "id": flow.id,
                "order": 0,  # Will be set by frontend

                # ========== HAR Standard Fields ==========
                "startedDateTime": started_dt,
                "time": duration,

                "request": {
                    "method": flow.request.method,
                    "url": url,
                    "httpVersion": proto,

                    # HAR arrays (preserve duplicates)
                    "headers": self.headers_to_har(flow.request.headers),
                    "cookies": self.cookies_to_har(flow.request.cookies),
                    "queryString": self.query_to_har(flow.request.query),

                    # Body
                    "postData": {
                        "mimeType": content_type or "text/plain",
                        "text": req_body,
                    } if req_body else None,
                    "bodySize": len(flow.request.content) if flow.request.content else 0,
                    "headersSize": -1,

                    # Parsed URL (RelayCraft extension)
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

                    # HAR arrays (preserve duplicates)
                    "headers": self.headers_to_har(flow.response.headers) if flow.response else [],
                    "cookies": self.cookies_to_har(flow.response.cookies) if flow.response else [],

                    # Body
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

                # ========== RelayCraft Extensions ==========
                "_rc": {
                    "clientIp": client_ip,
                    "serverIp": server_ip,
                    "error": error_detail,
                    "isWebsocket": is_websocket,
                    "isSse": is_sse,
                    "sseEventCount": sse_event_count,
                    "sseStreamOpen": sse_stream_open,
                    "sseEvents": sse_events_snapshot,
                    "websocketFrameCount": ws_frame_count,
                    "websocketFrames": ws_frames,
                    "wsOpen": ws_open,
                    "hits": hits,
                    "intercept": {
                        "intercepted": is_paused,
                        "phase": paused_at,
                    },
                    "bodyTruncated": req_truncated or res_truncated,
                },

                # ========== Legacy Fields (for backward compatibility) ==========
                # These will be removed after frontend migration
                "timestamp": flow.request.timestamp_start * 1000 if flow.request.timestamp_start else 0,
                "msg_ts": flow.metadata.get("_relaycraft_msg_ts", time.time()),
                "host": flow.request.host,
                "path": flow.request.path,
                "statusCode": status_code,
                "requestHeaders": {str(k): str(v) for k, v in flow.request.headers.items()},
                "responseHeaders": {str(k): str(v) for k, v in flow.response.headers.items()} if flow.response else {},
                "requestBody": req_body,
                "requestBodyEncoding": req_enc,
                "responseBody": res_body,
                "responseBodyEncoding": res_enc,
                "size": len(flow.response.content) if flow.response and flow.response.content else 0,
                "duration": duration,
                "contentType": content_type,
                "httpVersion": proto,
                "clientIp": client_ip,
                "serverIp": server_ip,
                "isWebsocket": is_websocket,
                "bodyTruncated": req_truncated or res_truncated,
                "hits": hits,
                "intercepted": is_paused,
                "interceptPhase": paused_at,
                "error": error_detail,
                "timing": {
                    "dns": timings.get("dns", -1),
                    "connect": timings.get("connect", -1),
                    "ssl": timings.get("ssl", -1),
                    "ttfb": timings.get("wait", -1),
                    "total": duration,
                } if timings else None,
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
                # Legacy
                "timestamp": time.time() * 1000,
                "msg_ts": time.time(),
                "method": "CONNECT",
                "url": f"https://{sni}/",
                "host": sni,
                "path": "/",
                "statusCode": 0,
                "requestHeaders": {},
                "responseHeaders": {},
                "requestBody": "",
                "responseBody": "",
                "size": 0,
                "duration": 0,
                "hits": [],
                "intercepted": False,
                "interceptPhase": None,
                "httpVersion": "",
                "clientIp": client_ip,
                "serverIp": server_ip,
                "error": {
                    "message": error_msg,
                    "errorType": "tls_error",
                },
                "isWebsocket": False,
                "bodyTruncated": False,
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

    def register_ws_flow(self, flow: http.HTTPFlow) -> None:
        ws_handler.register_ws_flow(self, flow)

    def unregister_ws_flow(self, flow: http.HTTPFlow) -> None:
        ws_handler.unregister_ws_flow(self, flow)

    def _is_ws_closed(self, ws: Any) -> bool:
        return ws_handler.is_ws_closed(ws)

    def _ws_has_close_frame(self, ws: Any) -> bool:
        return ws_handler.ws_has_close_frame(ws)

    def _ensure_injected_seq_set(self, flow: http.HTTPFlow) -> set:
        return ws_handler.ensure_injected_seq_set(flow)

    def _payload_fingerprint(self, payload_bytes: bytes) -> Dict[str, Any]:
        return ws_handler.payload_fingerprint(payload_bytes)

    def _message_matches_fingerprint(
        self, message: Any, is_text: bool, fingerprint: Dict[str, Any]
    ) -> bool:
        return ws_handler.message_matches_fingerprint(message, is_text, fingerprint)

    def _append_pending_injected_marker(
        self, flow: http.HTTPFlow, lower_bound: int, is_text: bool, fingerprint: Dict[str, Any]
    ) -> None:
        ws_handler.append_pending_injected_marker(flow, lower_bound, is_text, fingerprint)

    def _resolve_pending_injected_markers(self, flow: http.HTTPFlow, ws: Any) -> None:
        ws_handler.resolve_pending_injected_markers(self, flow, ws)

    def inject_ws_frame(
        self, flow_id: str, type_: str, payload: str
    ) -> Tuple[int, Dict[str, Any]]:
        return ws_handler.inject_ws_frame(self, flow_id, type_, payload)

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
        """Build lightweight index dicts from already-parsed session flows.

        Called after store_flows_batch() to return indices to the frontend
        without an extra DB round-trip.
        """
        indices = []
        for f in flows:
            rc = f.get("_rc") or {}
            req = f.get("request") or {}
            resp = f.get("response") or {}
            indices.append({
                "id": f.get("id"),
                "msg_ts": f.get("msg_ts", 0),
                "method": req.get("method") or "",
                "url": req.get("url") or "",
                "host": f.get("host") or "",
                "path": f.get("path") or "",
                "status": resp.get("status") or 0,
                "contentType": f.get("contentType") or "",
                "startedDateTime": f.get("startedDateTime") or "",
                "time": f.get("time") or 0,
                "size": f.get("size") or (resp.get("content") or {}).get("size", 0),
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

    def _normalize_har_entries(self, entries: list):
        """Convert raw HAR log.entries into (flows, indices) ready for store_flows_batch().

        Returns:
            Tuple of (flows list, indices list)
        """
        return normalize_har_entries(entries)

    def _store_flow(self, flow_data: Dict) -> None:
        """Store flow data to database.

        Note: seq is no longer tracked in backend.
        Frontend calculates display seq from array index (seq = index + 1).
        """
        try:
            self.db.store_flow(flow_data)
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
