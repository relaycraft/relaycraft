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
import json
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple, List

from mitmproxy import http, ctx

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
from .i18n_cert import build_cert_template_vars
from . import sse_processor, ws_handler


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

    async def handle_request(self, flow: http.HTTPFlow) -> None:
        """Handle polling and control requests."""
        from mitmproxy.http import Response

        # CORS preflight
        if flow.request.method == "OPTIONS" and flow.request.path.startswith("/_relay"):
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

        # Polling endpoint - returns lightweight indices only
        if "/_relay/poll" in flow.request.path:
            try:
                query = flow.request.query
                try:
                    since_param = query.get("since", "0")
                    if not since_param:
                        since_param = "0"
                    since_ts = float(since_param)
                except ValueError:
                    since_ts = 0.0

                # Support session_id parameter for historical session viewing
                session_id_param = query.get("session_id", None)

                # Get indices from database
                db_indices = self.db.get_indices(session_id=session_id_param, since=since_ts)

                # Transform to frontend format
                # Note: seq is not included - frontend calculates from array index
                indices = []
                for idx in db_indices:
                    indices.append({
                        "id": idx.get("id"),
                        "method": idx.get("method", ""),
                        "url": idx.get("url", ""),
                        "host": idx.get("host", ""),
                        "path": idx.get("path", ""),
                        "status": idx.get("status", 0),
                        "httpVersion": idx.get("http_version", ""),
                        "contentType": idx.get("content_type", ""),
                        "startedDateTime": idx.get("started_datetime", ""),
                        "time": idx.get("time", 0),
                        "size": idx.get("size", 0),
                        "clientIp": idx.get("client_ip", ""),
                        "appName": idx.get("app_name", ""),
                        "appDisplayName": idx.get("app_display_name", ""),
                        "hasError": bool(idx.get("has_error")),
                        "hasRequestBody": bool(idx.get("has_request_body")),
                        "hasResponseBody": bool(idx.get("has_response_body")),
                        "isWebsocket": bool(idx.get("is_websocket")),
                        "isSse": bool(idx.get("is_sse")),
                        "websocketFrameCount": idx.get("websocket_frame_count", 0),
                        "isIntercepted": bool(idx.get("is_intercepted")),
                        "hits": idx.get("hits", []),
                        "msg_ts": idx.get("msg_ts"),
                            })
        
                        # Return max msg_ts from returned indices (not current time!)
                # This ensures we don't skip records with earlier timestamps
                max_msg_ts = 0
                if indices:
                    max_msg_ts = max(idx.get("msg_ts", 0) for idx in indices)

                response_data = {
                    "indices": indices,
                    "server_ts": max_msg_ts if max_msg_ts > 0 else since_ts,
                    # Pending notifications from background cleanup/WAL threads
                    "notifications": self.db.drain_notifications(),
                }
                json_str = json.dumps(
                    response_data,
                    default=safe_json_default,
                    ensure_ascii=False
                )
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
                flow.response.status_code = 200
                flow.response.reason = b"OK"

            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                print(f"RelayCraft Poll Error:\n{tb}")
                self.logger.error(f"Error in poll handler: {tb}")
                error_resp = {"error": str(e), "traceback": tb}
                try:
                    safe_err = json.dumps(error_resp, default=safe_json_default)
                    flow.response = Response.make(
                        500,
                        safe_err.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                except Exception:
                    flow.response = Response.make(
                        500,
                        b'{"error": "Critical serialization failure"}',
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )

        # Detail endpoint - returns full flow data on demand
        elif "/_relay/detail" in flow.request.path:
            try:
                query = flow.request.query
                flow_id = query.get("id", "")

                if not flow_id:
                    flow.response = Response.make(
                        400,
                        b'{"error": "Missing flow id"}',
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                    )
                    return

                # Get flow from database
                flow_data = self.db.get_detail(flow_id)

                if not flow_data:
                    flow.response = Response.make(
                        404,
                        b'{"error": "Flow not found"}',
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                    )
                    return

                json_str = json.dumps(
                    flow_data,
                    default=safe_json_default,
                    ensure_ascii=False
                )
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )

            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                print(f"RelayCraft Detail Error:\n{tb}")
                self.logger.error(f"Error in detail handler: {tb}")
                error_resp = {"error": str(e), "traceback": tb}
                try:
                    safe_err = json.dumps(error_resp, default=safe_json_default)
                    flow.response = Response.make(
                        500,
                        safe_err.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                except Exception:
                    flow.response = Response.make(
                        500,
                        b'{"error": "Critical serialization failure"}',
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )

        # SSE incremental events endpoint
        elif "/_relay/sse" in flow.request.path:
            try:
                query = flow.request.query
                flow_id = query.get("flow_id", "")
                if not flow_id:
                    flow.response = Response.make(
                        400,
                        b'{"error": "Missing flow_id"}',
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                    )
                    return

                try:
                    since_seq = int(query.get("since_seq", "0") or "0")
                except ValueError:
                    since_seq = 0

                try:
                    limit = int(query.get("limit", str(self._sse_default_limit)) or str(self._sse_default_limit))
                except ValueError:
                    limit = self._sse_default_limit

                payload = self.get_sse_events(flow_id, since_seq=since_seq, limit=limit)
                json_str = json.dumps(payload, default=safe_json_default, ensure_ascii=False)
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                )
            except Exception as e:
                error_resp = {"error": str(e)}
                flow.response = Response.make(
                    500,
                    json.dumps(error_resp, ensure_ascii=False).encode("utf-8"),
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                )

        # WebSocket frame inject
        elif "/_relay/ws/inject" in flow.request.path:
            try:
                if flow.request.method != "POST":
                    flow.response = Response.make(
                        405,
                        b'{"ok": false, "code": "invalid_payload", "message": "POST required"}',
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                    )
                    return

                try:
                    raw = flow.request.content.decode("utf-8") if flow.request.content else ""
                    data = json.loads(raw) if raw else {}
                except Exception as e:
                    body = json.dumps(
                        {"ok": False, "code": "invalid_payload", "message": f"Invalid JSON: {e}"},
                        ensure_ascii=False,
                    )
                    flow.response = Response.make(
                        400,
                        body.encode("utf-8"),
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                    )
                    return

                flow_id = data.get("flowId") or data.get("flow_id") or ""
                frame_type = data.get("type", "text")
                payload = data.get("payload", "")

                status, body_dict = self.inject_ws_frame(flow_id, frame_type, payload)
                body_json = json.dumps(body_dict, ensure_ascii=False)
                flow.response = Response.make(
                    status,
                    body_json.encode("utf-8"),
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
            except Exception as e:
                error_resp = {"ok": False, "code": "engine_error", "message": str(e)}
                flow.response = Response.make(
                    500,
                    json.dumps(error_resp, ensure_ascii=False).encode("utf-8"),
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )

        # Breakpoint management
        elif "/_relay/breakpoints" in flow.request.path:
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                action = data.get("action")
                if action == "add":
                    # Support both legacy pattern format and new rule format
                    rule = data.get("rule") or {"pattern": data.get("pattern")}
                    self.debug_mgr.add_breakpoint(rule)
                elif action == "remove":
                    # Support removal by ID or pattern
                    self.debug_mgr.remove_breakpoint(data.get("id") or data.get("pattern"))
                elif action == "clear":
                    with self.debug_mgr.lock:
                        self.debug_mgr.breakpoints = []
                elif action == "list":
                    with self.debug_mgr.lock:
                        bp_list = self.debug_mgr.breakpoints
                        flow.response = Response.make(
                            200,
                            json.dumps(bp_list).encode('utf-8'),
                            {
                                "Content-Type": "application/json",
                                "Access-Control-Allow-Origin": "*"
                            }
                        )
                        return

                flow.response = Response.make(200, b"OK", {
                    "Access-Control-Allow-Origin": "*"
                })
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Resume flow
        elif "/_relay/resume" in flow.request.path:
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                flow_id = data.get("id")
                modifications = data.get("modifications")
                success = self.debug_mgr.resume_flow(flow_id, modifications)
                flow.response = Response.make(
                    200 if success else 404,
                    b"OK" if success else b"NOTFOUND",
                    {"Access-Control-Allow-Origin": "*"}
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # ==================== Session API ====================
        # Delete all historical sessions
        elif "/_relay/sessions/delete_all" in flow.request.path:
            try:
                count = self.db.delete_all_historical_sessions()
                json_str = json.dumps({"success": True, "count": count}, ensure_ascii=False)
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                    },
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # List sessions
        elif "/_relay/sessions" in flow.request.path and flow.request.method == "GET":
            try:
                sessions = self.db.list_sessions()
                json_str = json.dumps(sessions, ensure_ascii=False)
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Create session
        elif "/_relay/sessions" in flow.request.path and flow.request.method == "POST":
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                session_id = self.db.create_session(
                    name=data.get("name", "New Session"),
                    description=data.get("description"),
                    metadata=data.get("metadata")
                )
                json_str = json.dumps({"id": session_id}, ensure_ascii=False)
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Create new session for app start (called by frontend on app launch)
        elif "/_relay/session/new" in flow.request.path and flow.request.method == "POST":
            try:
                session_id = self.db.create_new_session_for_app_start()
                json_str = json.dumps({"id": session_id}, ensure_ascii=False)
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Switch session
        elif "/_relay/session/activate" in flow.request.path:
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                session_id = data.get("id")
                success = self.db.switch_session(session_id)
                json_str = json.dumps({"success": success}, ensure_ascii=False)
                flow.response = Response.make(
                    200 if success else 404,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Delete session
        elif "/_relay/session/delete" in flow.request.path:
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                session_id = data.get("id")
                success = self.db.delete_session(session_id)
                json_str = json.dumps({"success": success}, ensure_ascii=False)
                flow.response = Response.make(
                    200 if success else 400,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )


        # List sessions
        elif "/_relay/sessions" in flow.request.path and flow.request.method == "GET":
            try:
                sessions = self.db.list_sessions()
                json_str = json.dumps(sessions, ensure_ascii=False)
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Clear session
        elif "/_relay/session/clear" in flow.request.path:
            try:
                data = json.loads(flow.request.content.decode('utf-8')) if flow.request.content else {}
                session_id = data.get("id")
                
                # If it's a historical session, delete it instead of clearing
                # (unless no session_id provided, then clear active)
                if session_id:
                    active = self.db.get_active_session()
                    if active and session_id != active.get('id'):
                        self.db.delete_session(session_id)
                    else:
                        self.db.clear_session(session_id)
                else:
                    self.db.clear_session()
                
                # Reset sequence counter when clearing active session
                self.reset_seq_counter()
                
                flow.response = Response.make(
                    200,
                    b'{"success": true}',
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Body / header search — POST /_relay/search  { keyword, type, session_id }
        # type: "response" | "request" (body) | "header"
        elif "/_relay/search" in flow.request.path and flow.request.method == "POST":
            try:
                data = json.loads(flow.request.content.decode("utf-8"))
                keyword = data.get("keyword", "").strip()
                search_type = data.get("type", "response")
                session_id_param = data.get("session_id", None)
                case_sensitive = bool(data.get("case_sensitive", False))

                if not keyword:
                    result = {"matches": [], "scanned": 0}
                elif search_type == "header":
                    result = self.db.search_by_header(
                        keyword=keyword,
                        session_id=session_id_param,
                        case_sensitive=case_sensitive,
                    )
                else:
                    if search_type not in ("response", "request"):
                        search_type = "response"
                    result = self.db.search_by_body(
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

        # Get database stats
        elif "/_relay/stats" in flow.request.path:
            try:
                stats = self.db.get_stats()
                json_str = json.dumps(stats, ensure_ascii=False)
                flow.response = Response.make(
                    200,
                    json_str.encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Traffic active state - GET to check, POST to set
        elif "/_relay/traffic_active" in flow.request.path:
            try:
                from .main import is_traffic_active, set_traffic_active
                if flow.request.method == "GET":
                    result = {"active": is_traffic_active()}
                    json_str = json.dumps(result, ensure_ascii=False)
                    flow.response = Response.make(
                        200,
                        json_str.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                elif flow.request.method == "POST":
                    data = json.loads(flow.request.content.decode('utf-8'))
                    active = data.get("active", False)
                    set_traffic_active(active)
                    self.logger.info(f"Traffic active state changed to: {active}")
                    result = {"success": True, "active": active}
                    json_str = json.dumps(result, ensure_ascii=False)
                    flow.response = Response.make(
                        200,
                        json_str.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                else:
                    flow.response = Response.make(
                        405,
                        b"Method Not Allowed",
                        {"Access-Control-Allow-Origin": "*"}
                    )
            except Exception as e:
                self.logger.error(f"Error handling traffic_active: {e}")
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        elif "/_relay/export_session" in flow.request.path:
            try:
                # Use query.get directly instead of parse_qs
                export_path = flow.request.query.get('path')
                session_id = flow.request.query.get('session_id')

                if export_path:
                    # Parse metadata from request body
                    metadata = {}
                    try:
                        if flow.request.content:
                            body_data = json.loads(flow.request.content.decode('utf-8'))
                            metadata = body_data if isinstance(body_data, dict) else {}
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass

                    # Use streaming export to avoid memory issues
                    self.db.export_to_file_iter(
                        export_path,
                        session_id=session_id,
                        format='session',
                        metadata=metadata
                    )
                    flow.response = Response.make(
                        200,
                        json.dumps({"success": True, "path": export_path}).encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                else:
                    # Return as response (for small exports only - use with caution)
                    all_flows = self.db.get_all_flows(session_id=session_id)
                    json_str = json.dumps(
                        all_flows,
                        default=safe_json_default,
                        ensure_ascii=False
                    )
                    flow.response = Response.make(
                        200,
                        json_str.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Export HAR
        elif "/_relay/export_har" in flow.request.path:
            try:
                # Use query.get directly instead of parse_qs
                export_path = flow.request.query.get('path')
                session_id = flow.request.query.get('session_id')

                if export_path:
                    # Use streaming export to avoid memory issues
                    self.db.export_to_file_iter(
                        export_path,
                        session_id=session_id,
                        format='har'
                    )
                    flow.response = Response.make(
                        200,
                        json.dumps({"success": True, "path": export_path}).encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                else:
                    # Return as response (for small exports only - use with caution)
                    all_flows = self.db.get_all_flows(session_id=session_id)
                    har_data = {
                        "log": {
                            "version": "1.2",
                            "creator": {"name": "RelayCraft", "version": "1.0"},
                            "entries": all_flows
                        }
                    }
                    json_str = json.dumps(
                        har_data,
                        default=safe_json_default,
                        ensure_ascii=False
                    )
                    flow.response = Response.make(
                        200,
                        json_str.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Export progress (for large exports)
        elif "/_relay/export_progress" in flow.request.path:
            try:
                total = self.db.get_flow_count()
                flow.response = Response.make(
                    200,
                    json.dumps({"total": total}).encode("utf-8"),
                    {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    }
                )
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Import session (data sent in HTTP body — for small sessions / legacy)
        elif "/_relay/import_session" in flow.request.path and "_file" not in flow.request.path:
            try:
                if flow.request.method == "POST":
                    data = json.loads(flow.request.content.decode('utf-8'))

                    if isinstance(data, list):
                        flows = data
                        session_name = f"Imported Session ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"
                        session_description = ""
                        session_metadata = {"type": "session_import"}
                        session_created_at = None
                    else:
                        flows = data.get("flows", [])
                        session_name = data.get("name") or f"Imported Session ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"
                        session_description = data.get("description") or ""
                        session_metadata = data.get("metadata") or {}
                        session_metadata["type"] = "session_import"
                        metadata_created = (session_metadata or {}).get("createdAt")
                        session_created_at = metadata_created / 1000.0 if metadata_created else None

                    # Stamp msg_ts on each flow
                    for idx, f in enumerate(flows):
                        if not f.get("msg_ts"):
                            if f.get("startedDateTime"):
                                try:
                                    from datetime import datetime as dt
                                    dt_str = f["startedDateTime"].replace("Z", "+00:00")
                                    f["msg_ts"] = dt.fromisoformat(dt_str).timestamp()
                                except Exception:
                                    f["msg_ts"] = time.time() + idx * 0.001
                            else:
                                f["msg_ts"] = time.time() + idx * 0.001

                    session_id = self.db.create_session(
                        name=session_name, description=session_description,
                        metadata=session_metadata, is_active=False,
                        created_at=session_created_at
                    )

                    # Batch write: single transaction per 500 flows
                    self.db.store_flows_batch(flows, session_id=session_id)
                    self.db.update_session_flow_count(session_id)

                    # Build lightweight indices for frontend response (no extra DB round-trip)
                    indices = self._build_session_indices(flows)

                    json_str = json.dumps({"session_id": session_id, "indices": indices}, ensure_ascii=False)
                    flow.response = Response.make(
                        200, json_str.encode("utf-8"),
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                    )
                else:
                    flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                self.logger.error(f"Import session error: {tb}")
                flow.response = Response.make(
                    500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"}
                )

        # Import session FROM FILE (Python reads file directly — no HTTP body overhead)
        elif "/_relay/import_session_file" in flow.request.path:
            try:
                if flow.request.method == "POST":
                    req_data = json.loads(flow.request.content.decode('utf-8'))
                    file_path = req_data.get("path")
                    if not file_path:
                        flow.response = Response.make(
                            400, b'{"error": "Missing path"}',
                            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                        )
                        return

                    # Security: Normalize path and enforce extension
                    import os as _os
                    
                    try:
                        file_path = _os.path.abspath(file_path)
                    except Exception as e:
                        self.logger.debug(f"Path normalization failed, using raw path: {e}")

                    if not file_path.lower().endswith('.relay'):
                        flow.response = Response.make(
                            400, b'{"error": "Invalid file type. Only .relay allowed"}',
                            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                        )
                        return

                    # Python reads the file directly — no memory duplication
                    if not _os.path.exists(file_path):
                        flow.response = Response.make(
                            404, b'{"error": "File not found"}',
                            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                        )
                        return

                    import ijson
                    import threading
                    import time

                    session_name = f"Imported Session ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"
                    session_description = ""
                    session_metadata = {"type": "session_import", "status": "importing"}
                    session_created_at = None

                    try:
                        with open(file_path, 'rb') as fh:
                            parser = ijson.parse(fh)
                            for prefix, event, value in parser:
                                if prefix == 'name' and event == 'string':
                                    session_name = value
                                elif prefix == 'description' and event == 'string':
                                    session_description = value
                                elif prefix == 'flows' or event == 'start_array':
                                    break
                    except Exception as e:
                        self.logger.warning(f"Fast metadata parse failed, using defaults: {e}")

                    session_id = self.db.create_session(
                        name=session_name, description=session_description,
                        metadata=session_metadata, is_active=False,
                        created_at=session_created_at
                    )

                    def stream_import_worker():
                        try:
                            with open(file_path, 'rb') as fh:
                                fh.seek(0)
                                first_char = b''
                                while first_char in (b'', b' ', b'\t', b'\r', b'\n'):
                                    first_char = fh.read(1)
                                fh.seek(0)

                                item_path = "item" if first_char == b'[' else "flows.item"
                                flows_stream = ijson.items(fh, item_path)

                                batch = []
                                batch_size = 500
                                count = 0

                                for f in flows_stream:
                                    if not f.get("msg_ts"):
                                        if f.get("startedDateTime"):
                                            try:
                                                from datetime import datetime as dt
                                                dt_str = f["startedDateTime"].replace("Z", "+00:00")
                                                f["msg_ts"] = dt.fromisoformat(dt_str).timestamp()
                                            except Exception:
                                                f["msg_ts"] = time.time() + count * 0.001
                                        else:
                                            f["msg_ts"] = time.time() + count * 0.001

                                    batch.append(f)
                                    count += 1

                                    if len(batch) >= batch_size:
                                        self.db.store_flows_batch(batch, session_id=session_id)
                                        batch = []
                                        time.sleep(0.01)

                                if batch:
                                    self.db.store_flows_batch(batch, session_id=session_id)
                                
                                self.db.update_session_flow_count(session_id)
                                
                                with self.db._lock:
                                    conn = self.db._get_conn()
                                    row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                                    if row and row[0]:
                                        import json
                                        md = json.loads(row[0])
                                        md["status"] = "ready"
                                        conn.execute("UPDATE sessions SET metadata = ? WHERE id = ?", (json.dumps(md), session_id))
                                        conn.commit()

                        except Exception as e:
                            import traceback
                            self.logger.error(f"Background stream import failed: {traceback.format_exc()}")
                            try:
                                with self.db._lock:
                                    conn = self.db._get_conn()
                                    row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                                    if row and row[0]:
                                        import json
                                        md = json.loads(row[0])
                                        md["status"] = "error"
                                        md["error_message"] = str(e)
                                        conn.execute("UPDATE sessions SET metadata = ? WHERE id = ?", (json.dumps(md), session_id))
                                        conn.commit()
                            except Exception as e:
                                self.logger.debug(f"Failed to update session error status: {e}")

                    t = threading.Thread(target=stream_import_worker, name=f"ImportWorker-{session_id}", daemon=True)
                    t.start()

                    json_str = json.dumps({"session_id": session_id, "status": "importing"}, ensure_ascii=False)
                    flow.response = Response.make(
                        200, json_str.encode("utf-8"),
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                    )
                else:
                    flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                self.logger.error(f"Import session file error: {tb}")
                flow.response = Response.make(
                    500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"}
                )

        # Import HAR (data in HTTP body — legacy)
        elif "/_relay/import_har" in flow.request.path and "_file" not in flow.request.path:
            try:
                if flow.request.method == "POST":
                    har_data = json.loads(flow.request.content.decode('utf-8'))
                    entries = har_data.get("log", {}).get("entries", []) or []

                    session_id = self.db.create_session(
                        name=f"Imported HAR ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})",
                        description="",
                        metadata={"type": "har_import"},
                        is_active=False
                    )

                    flows, indices = self._normalize_har_entries(entries)
                    self.db.store_flows_batch(flows, session_id=session_id)
                    self.db.update_session_flow_count(session_id)

                    json_str = json.dumps({"session_id": session_id, "indices": indices}, ensure_ascii=False)
                    flow.response = Response.make(
                        200, json_str.encode("utf-8"),
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                    )
                else:
                    flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                self.logger.error(f"Import HAR error: {tb}")
                flow.response = Response.make(
                    500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"}
                )

        # Import HAR FROM FILE (Python reads file directly — no HTTP body overhead)
        elif "/_relay/import_har_file" in flow.request.path:
            try:
                if flow.request.method == "POST":
                    import os as _os

                    req_data = json.loads(flow.request.content.decode('utf-8'))
                    file_path = req_data.get("path")
                    if not file_path:
                        flow.response = Response.make(
                            400, b'{"error": "Missing path"}',
                            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                        )
                        return

                    # Security: Normalize path and enforce extension
                    try:
                        file_path = _os.path.abspath(file_path)
                    except Exception as e:
                        self.logger.debug(f"Path normalization failed, using raw path: {e}")

                    if not file_path.lower().endswith('.har'):
                        flow.response = Response.make(
                            400, b'{"error": "Invalid file type. Only .har allowed"}',
                            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                        )
                        return

                    if not _os.path.exists(file_path):
                        flow.response = Response.make(
                            404, b'{"error": "File not found"}',
                            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                        )
                        return

                    session_id = self.db.create_session(
                        name=f"Imported HAR ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})",
                        description="",
                        metadata={"type": "har_import", "status": "importing"},
                        is_active=False
                    )

                    def stream_har_worker():
                        try:
                            import ijson
                            import time
                            
                            with open(file_path, 'rb') as fh:
                                entries_stream = ijson.items(fh, "log.entries.item")

                                batch = []
                                batch_size = 500

                                for entry in entries_stream:
                                    batch.append(entry)

                                    if len(batch) >= batch_size:
                                        flows, _ = self._normalize_har_entries(batch)
                                        self.db.store_flows_batch(flows, session_id=session_id)
                                        batch = []
                                        time.sleep(0.01)

                                if batch:
                                    flows, _ = self._normalize_har_entries(batch)
                                    self.db.store_flows_batch(flows, session_id=session_id)
                                
                                self.db.update_session_flow_count(session_id)
                                
                                with self.db._lock:
                                    conn = self.db._get_conn()
                                    row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                                    if row and row[0]:
                                        import json
                                        md = json.loads(row[0])
                                        md["status"] = "ready"
                                        conn.execute("UPDATE sessions SET metadata = ? WHERE id = ?", (json.dumps(md), session_id))
                                        conn.commit()

                        except Exception as e:
                            import traceback
                            self.logger.error(f"Background HAR stream import failed: {traceback.format_exc()}")
                            try:
                                with self.db._lock:
                                    conn = self.db._get_conn()
                                    row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                                    if row and row[0]:
                                        import json
                                        md = json.loads(row[0])
                                        md["status"] = "error"
                                        md["error_message"] = str(e)
                                        conn.execute("UPDATE sessions SET metadata = ? WHERE id = ?", (json.dumps(md), session_id))
                                        conn.commit()
                            except Exception as e:
                                self.logger.debug(f"Failed to update session error status: {e}")

                    import threading
                    t = threading.Thread(target=stream_har_worker, name=f"ImportHARWorker-{session_id}", daemon=True)
                    t.start()

                    json_str = json.dumps({"session_id": session_id, "status": "importing"}, ensure_ascii=False)
                    flow.response = Response.make(
                        200, json_str.encode("utf-8"),
                        {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                    )
                else:
                    flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                self.logger.error(f"Import HAR file error: {tb}")
                flow.response = Response.make(
                    500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"}
                )

        # Certificate serving — relay.guide landing page + direct downloads
        # Handles:
        #   relay.guide /          → HTML landing page
        #   relay.guide /cert      → download PEM (default)
        #   relay.guide /cert.pem  → download PEM
        #   relay.guide /cert.crt  → download CRT
        #   127.x.x.x:port /cert   → legacy direct download (kept for compatibility)
        elif (
            flow.request.host == "relay.guide"
            or flow.request.path == "/cert"
            or flow.request.path.startswith("/cert?")
            or flow.request.path in ("/cert.pem", "/cert.crt")
        ):
            try:
                import os
                confdir = os.environ.get("MITMPROXY_CONFDIR")
                cert_path_pem = os.path.join(confdir, "relaycraft-ca-cert.pem") if confdir else None
                cert_path_crt = os.path.join(confdir, "relaycraft-ca-cert.crt") if confdir else None

                path = flow.request.path.split("?")[0]  # strip query string

                # ── Direct download paths ──────────────────────────────────────
                if path in ("/cert", "/cert.pem"):
                    if cert_path_pem and os.path.exists(cert_path_pem):
                        with open(cert_path_pem, "rb") as f:
                            content = f.read()
                        flow.response = Response.make(
                            200, content,
                            {
                                "Content-Type": "application/x-pem-file",
                                "Content-Disposition": 'attachment; filename="relaycraft-ca-cert.pem"',
                                "Access-Control-Allow-Origin": "*",
                            }
                        )
                    else:
                        flow.response = Response.make(404, b"Certificate not found", {"Access-Control-Allow-Origin": "*"})
                    return

                elif path == "/cert.crt":
                    target = cert_path_crt if (cert_path_crt and os.path.exists(cert_path_crt)) else cert_path_pem
                    fname = "relaycraft-ca-cert.crt"
                    if target and os.path.exists(target):
                        with open(target, "rb") as f:
                            content = f.read()
                        flow.response = Response.make(
                            200, content,
                            {
                                "Content-Type": "application/x-x509-ca-cert",
                                "Content-Disposition": f'attachment; filename="{fname}"',
                                "Access-Control-Allow-Origin": "*",
                            }
                        )
                    else:
                        flow.response = Response.make(404, b"Certificate not found", {"Access-Control-Allow-Origin": "*"})
                    return

                # ── Landing page ───────────────────────────────────────────────
                # 1. Determine proxy address for display
                try:
                    proxy_host = flow.request.host if flow.request.host != "relay.guide" else "127.0.0.1"
                    current_port = ctx.options.listen_port if (hasattr(ctx, "options") and hasattr(ctx.options, "listen_port")) else 9090
                    proxy_addr = f"{proxy_host}:{current_port}"
                except Exception as e:
                    self.logger.debug(f"Failed to get proxy address, using default: {e}")
                    proxy_addr = "127.0.0.1:9090"
                t_vars = build_cert_template_vars(
                    flow.request.headers.get("accept-language", ""),
                    flow.request.headers.get("user-agent", ""),
                    proxy_addr,
                )

                # 2. Load and render template
                try:
                    import string
                    assets_dir = os.path.join(os.path.dirname(__file__), "assets")
                    template_path = os.path.join(assets_dir, "cert_landing.html")
                    with open(template_path, "r", encoding="utf-8") as f:
                        template_str = f.read()

                    # Use string.Template for safe substitution
                    html_content = string.Template(template_str).safe_substitute(t_vars)
                except Exception as template_err:
                    self.logger.error(f"Template loading error: {template_err}")
                    html_content = f"<h1>RelayCraft</h1><p>Setup Guide (Template Error)</p><p><a href='/cert'>Download Certificate</a></p>"

                flow.response = Response.make(
                    200,
                    html_content.encode("utf-8"),
                    {
                        "Content-Type": "text/html; charset=utf-8",
                        "Access-Control-Allow-Origin": "*",
                    }
                )

            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode("utf-8"),
                    {"Access-Control-Allow-Origin": "*"}
                )


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
