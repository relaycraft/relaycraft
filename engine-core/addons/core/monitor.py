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
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple, List

from mitmproxy import http, ctx

from .debug import DebugManager
from .utils import setup_logging
from .flow_database import FlowDatabase


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
        """
        Convert mitmproxy headers to HAR format.

        @note Uses .fields to preserve all values including duplicates
        """
        result = []
        for name, value in headers.fields:
            result.append({
                "name": self._safe_decode(name),
                "value": self._safe_decode(value),
            })
        return result

    def cookies_to_har(self, cookies) -> List[Dict[str, Any]]:
        """
        Convert mitmproxy cookies to HAR format.

        @note Uses .fields to preserve all values including duplicates
        """
        result = []
        for name, value in cookies.fields:
            result.append({
                "name": self._safe_decode(name),
                "value": self._safe_decode(value),
            })
        return result

    def query_to_har(self, query) -> List[Dict[str, str]]:
        """
        Convert mitmproxy query to HAR format.

        @note Uses .fields to preserve all values including duplicates
        """
        result = []
        for name, value in query.fields:
            result.append({
                "name": self._safe_decode(name),
                "value": self._safe_decode(value),
            })
        return result

    def _safe_decode(self, value) -> str:
        """Safely decode bytes to string."""
        if isinstance(value, bytes):
            try:
                return value.decode('utf-8')
            except UnicodeDecodeError:
                return value.decode('latin-1')
        return str(value)

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

                # Detailed timing from server connection
                if flow.server_conn and hasattr(flow.server_conn, "timestamp_start"):
                    conn = flow.server_conn
                    ts_start = getattr(conn, "timestamp_start", None)
                    ts_tcp = getattr(conn, "timestamp_tcp_setup", None)
                    ts_tls = getattr(
                        conn, "timestamp_tls_setup",
                        getattr(conn, "timestamp_ssl_setup", None)
                    )

                    if ts_start and ts_tcp:
                        timings["dns"] = max(0, (ts_tcp - ts_start) * 1000)
                    if ts_tcp and ts_tls:
                        timings["ssl"] = max(0, (ts_tls - ts_tcp) * 1000)

                    # TTFB: Request End -> Response Start
                    if (flow.request.timestamp_end and
                        flow.response and
                        flow.response.timestamp_start):
                        timings["wait"] = max(0, (
                            flow.response.timestamp_start - flow.request.timestamp_end
                        ) * 1000)

                # Total receive time
                if flow.response and flow.response.timestamp_start:
                    timings["receive"] = max(0, duration - (timings["wait"] or 0))

            # ========== WebSocket ==========
            is_websocket = hasattr(flow, 'websocket') and flow.websocket is not None
            ws_frames = None
            ws_frame_count = 0

            if is_websocket and flow.websocket and flow.websocket.messages:
                ws_frame_count = len(flow.websocket.messages)
                # Only include last 100 frames in the flow
                ws_frames = [
                    {
                        "id": str(uuid.uuid4()),
                        "flowId": flow.id,
                        "order": i,
                        "type": m.type,
                        "fromClient": m.from_client,
                        "content": (
                            m.text if m.type == 'text'
                            else (m.content.hex() if m.content else "")
                        ),
                        "encoding": "text" if m.type == 'text' else "base64",
                        "timestamp": m.timestamp * 1000,
                        "length": len(m.content) if m.content else 0,
                    }
                    for i, m in enumerate(flow.websocket.messages[-100:])
                ]

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

            # ========== Error Handling ==========
            error_detail = None
            if flow.error:
                error_detail = {
                    "message": str(flow.error),
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

            # ========== Content Type ==========
            content_type = None
            for h in flow.response.headers.fields if flow.response else []:
                if h[0].lower() == b'content-type':
                    content_type = self._safe_decode(h[1])
                    break

            # ========== Status Code ==========
            if is_websocket and not is_aborted:
                status_code = 101
            elif is_aborted:
                status_code = 0
            elif flow.response:
                status_code = flow.response.status_code
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
                    "websocketFrameCount": ws_frame_count,
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
                "websocketFrames": ws_frames,
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

    # ==================== HTTP Handlers ====================

    async def handle_request(self, flow: http.HTTPFlow) -> None:
        """Handle polling and control requests."""
        import json
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
            except:
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
                except:
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
                except:
                    flow.response = Response.make(
                        500,
                        b'{"error": "Critical serialization failure"}',
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
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
                    except:
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

        # Import session
        elif "/_relay/import_session" in flow.request.path:
            try:
                if flow.request.method == "POST":
                    data = json.loads(flow.request.content.decode('utf-8'))
                    
                    # Handle both old format (array of flows) and new format (object with metadata)
                    if isinstance(data, list):
                        flows = data
                        session_name = f"Imported Session ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"
                        session_description = "Imported from session file"
                        session_metadata = {"type": "session_import"}
                        session_created_at = None
                    else:
                        flows = data.get("flows", [])
                        # Use original session name and metadata
                        session_name = data.get("name") or f"Imported Session ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"
                        session_description = data.get("description") or "Imported from session file"
                        session_metadata = data.get("metadata") or {}
                        session_metadata["type"] = "session_import"
                        # Use original createdAt from metadata (it's in milliseconds)
                        metadata_created = (session_metadata or {}).get("createdAt")
                        if metadata_created:
                            session_created_at = metadata_created / 1000.0  # Convert ms to seconds
                        else:
                            session_created_at = None
                    
                    # Create a new session for this import (as historical/inactive)
                    session_id = self.db.create_session(
                        name=session_name,
                        description=session_description,
                        metadata=session_metadata,
                        is_active=False,  # Import as historical session
                        created_at=session_created_at  # Use original created_at
                    )
                    
                    # Import flows to database and return indices
                    indices = []
                    for idx, f in enumerate(flows):
                        # Preserve original msg_ts if available, otherwise use startedDateTime
                        if f.get("msg_ts"):
                            msg_ts = f["msg_ts"]
                        elif f.get("startedDateTime"):
                            try:
                                from datetime import datetime as dt
                                # Parse ISO format datetime
                                dt_str = f["startedDateTime"].replace("Z", "+00:00")
                                msg_ts = dt.fromisoformat(dt_str).timestamp()
                            except:
                                msg_ts = time.time() + idx * 0.001
                        else:
                            msg_ts = time.time() + idx * 0.001
                        
                        f["msg_ts"] = msg_ts
                        self.db.store_flow(f, session_id=session_id)
                        
                        rc = f.get("_rc") or {}
                        req = f.get("request") or {}
                        resp = f.get("response") or {}
                        
                        indices.append({
                            "id": f.get("id"),
                            "msg_ts": msg_ts,
                            "method": req.get("method") or "",
                            "url": req.get("url") or "",
                            "host": f.get("host") or "",
                            "path": f.get("path") or "",
                            "status": resp.get("status") or 0,
                            "contentType": f.get("contentType") or "",
                            "startedDateTime": f.get("startedDateTime") or "",
                            "time": f.get("time") or 0,
                            "size": f.get("size") or 0,
                            "hasError": bool(rc.get("error")),
                            "hasRequestBody": bool((req.get("postData") or {}).get("text")),
                            "hasResponseBody": bool((resp.get("content") or {}).get("text")),
                            "isWebsocket": bool(rc.get("isWebsocket")),
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
                    
                    # Update session flow count after import
                    self.db.update_session_flow_count(session_id)
                    
                    # Return session_id so frontend can switch to it
                    json_str = json.dumps({"session_id": session_id, "indices": indices}, ensure_ascii=False)
                    flow.response = Response.make(
                        200,
                        json_str.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                else:
                    flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                self.logger.error(f"Import session error: {tb}")
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Import HAR
        elif "/_relay/import_har" in flow.request.path:
            try:
                if flow.request.method == "POST":
                    import uuid
                    from urllib.parse import urlparse

                    har_data = json.loads(flow.request.content.decode('utf-8'))
                    entries = har_data.get("log", {}).get("entries", []) or []
                    
                    # Create a new session for this HAR import
                    import os
                    from pathlib import Path
                    session_id = self.db.create_session(
                        name=f"Imported HAR ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})",
                        description=f"Imported from HAR file with {len(entries)} entries",
                        metadata={"type": "har_import"}
                    )

                    indices = []
                    for idx, entry in enumerate(entries):
                        if not entry:
                            continue
                        
                        # Generate unique ID for HAR entry
                        flow_id = str(uuid.uuid4())

                        # Parse URL to extract host and path
                        req = entry.get("request") or {}
                        url = req.get("url") or ""
                        parsed = urlparse(url) if url else None
                        
                        # Get response safely
                        resp = entry.get("response") or {}
                        resp_content = resp.get("content") or {}
                        
                        # Get _rc safely
                        rc = entry.get("_rc") or {}

                        # Transform HAR entry to internal format
                        flow_data = {
                            "id": flow_id,
                            "msg_ts": time.time() + idx * 0.001,
                            "request": req,
                            "response": resp,
                            "host": (parsed.hostname if parsed else "") or "",
                            "path": (parsed.path if parsed else "") or "",
                            "contentType": resp_content.get("mimeType") or "",
                            "startedDateTime": entry.get("startedDateTime") or "",
                            "time": entry.get("time") or 0,
                            "size": resp_content.get("size") or 0,
                            "_rc": rc,
                        }

                        self.db.store_flow(flow_data, session_id=session_id)

                        # Build index for response
                        req_postdata = req.get("postData") or {}
                        resp_content_text = resp_content.get("text")
                        
                        indices.append({
                            "id": flow_id,
                            "msg_ts": flow_data["msg_ts"],
                            "method": req.get("method") or "",
                            "url": url,
                            "host": flow_data["host"],
                            "path": flow_data["path"],
                            "status": resp.get("status") or 0,
                            "contentType": flow_data["contentType"],
                            "startedDateTime": flow_data["startedDateTime"],
                            "time": flow_data["time"],
                            "size": flow_data["size"],
                            "hasError": bool(rc.get("error")),
                            "hasRequestBody": bool(req_postdata.get("text")),
                            "hasResponseBody": bool(resp_content_text),
                            "isWebsocket": bool(rc.get("isWebsocket")),
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

                    # Update session flow count after import
                    self.db.update_session_flow_count(session_id)

                    # Return response with session_id and indices
                    response_data = {
                        "session_id": session_id,
                        "indices": indices
                    }
                    json_str = json.dumps(response_data, ensure_ascii=False)
                    flow.response = Response.make(
                        200,
                        json_str.encode("utf-8"),
                        {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*"
                        }
                    )
                else:
                    flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                self.logger.error(f"Import HAR error: {tb}")
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
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
                # Determine proxy address for display
                try:
                    proxy_host = flow.request.host if flow.request.host != "relay.guide" else "127.0.0.1"
                    current_port = ctx.options.listen_port if (hasattr(ctx, "options") and hasattr(ctx.options, "listen_port")) else 9090
                    proxy_addr = f"{proxy_host}:{current_port}"
                except Exception:
                    proxy_addr = "127.0.0.1:9090"

                ua = flow.request.headers.get("user-agent", "").lower()
                if "iphone" in ua or "ipad" in ua:
                    detected_os = "ios"
                elif "android" in ua:
                    detected_os = "android"
                elif "macintosh" in ua or "mac os x" in ua:
                    detected_os = "macos"
                elif "windows" in ua:
                    detected_os = "windows"
                else:
                    detected_os = "android"  # default for mobile-first context

                html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RelayCraft · 证书安装</title>
<style>
  :root {{
    --bg: #0b0c0f;
    --surface: #161a22;
    --surface2: #1e2229;
    --border: rgba(255,255,255,0.08);
    --primary: #60a5fa;
    --primary-dim: rgba(96,165,250,0.12);
    --fg: #e6edf3;
    --muted: #8b949e;
    --success: #10b981;
    --warning: #f59e0b;
    --radius: 12px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    --mono: "JetBrains Mono", "Fira Code", Menlo, monospace;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font);
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 16px 60px;
  }}
  .card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    width: 100%;
    max-width: 520px;
  }}
  /* Header */
  .header {{
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
    width: 100%;
    max-width: 520px;
  }}
  .logo {{
    width: 36px; height: 36px;
    background: var(--primary-dim);
    border: 1px solid rgba(96,165,250,0.2);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }}
  .header-text h1 {{ font-size: 16px; font-weight: 700; letter-spacing: -0.02em; }}
  .header-text p {{ font-size: 12px; color: var(--muted); }}
  /* Proxy badge */
  .proxy-badge {{
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--primary-dim);
    border: 1px solid rgba(96,165,250,0.2);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 20px;
    font-size: 12px;
  }}
  .proxy-badge .dot {{
    width: 6px; height: 6px;
    background: var(--success);
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 6px var(--success);
  }}
  .proxy-badge code {{
    font-family: var(--mono);
    font-size: 12px;
    color: var(--primary);
  }}
  .proxy-badge .label {{ color: var(--muted); }}
  /* Section title */
  .section-title {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin-bottom: 12px;
  }}
  /* OS tabs */
  .tabs {{
    display: flex;
    gap: 6px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }}
  .tab {{
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--font);
    cursor: pointer;
    transition: all 0.15s;
  }}
  .tab:hover {{ background: var(--surface2); color: var(--fg); }}
  .tab.active {{
    background: var(--primary-dim);
    border-color: rgba(96,165,250,0.3);
    color: var(--primary);
    font-weight: 600;
  }}
  /* Panel */
  .panel {{ display: none; }}
  .panel.active {{ display: block; }}
  /* Steps */
  .steps {{ list-style: none; display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }}
  .step {{
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }}
  .step-num {{
    width: 22px; height: 22px;
    border-radius: 50%;
    background: var(--primary-dim);
    border: 1px solid rgba(96,165,250,0.25);
    color: var(--primary);
    font-size: 11px;
    font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }}
  .step-text {{ font-size: 13px; color: var(--fg); line-height: 1.5; }}
  .step-text strong {{ color: var(--fg); font-weight: 600; }}
  .step-text code {{
    font-family: var(--mono);
    font-size: 11px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    color: var(--primary);
  }}
  /* Download button */
  .dl-btn {{
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 12px 20px;
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    text-decoration: none;
    transition: opacity 0.15s, transform 0.1s;
    margin-bottom: 10px;
  }}
  .dl-btn:hover {{ opacity: 0.88; }}
  .dl-btn:active {{ transform: scale(0.98); }}
  .dl-btn-secondary {{
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
    padding: 9px 16px;
  }}
  .dl-btn-secondary:hover {{ color: var(--fg); opacity: 1; background: var(--surface2); border-color: rgba(255,255,255,0.15); }}
  /* Warning box */
  .warn-box {{
    display: flex;
    gap: 10px;
    background: rgba(245,158,11,0.06);
    border: 1px solid rgba(245,158,11,0.2);
    border-radius: 8px;
    padding: 12px 14px;
    margin-top: 16px;
    font-size: 12px;
    color: rgba(245,158,11,0.85);
    line-height: 1.5;
  }}
  .warn-icon {{ flex-shrink: 0; font-size: 14px; margin-top: 1px; }}
  /* Divider */
  .divider {{ border: none; border-top: 1px solid var(--border); margin: 20px 0; }}
  /* Footer */
  .footer {{
    margin-top: 28px;
    font-size: 11px;
    color: var(--muted);
    text-align: center;
    opacity: 0.6;
  }}
</style>
</head>
<body>

<div class="header">
  <div class="logo">🔀</div>
  <div class="header-text">
    <h1>RelayCraft</h1>
    <p>relay.guide · 证书安装向导</p>
  </div>
</div>

<div class="card">
  <div class="proxy-badge">
    <div class="dot"></div>
    <span class="label">代理已连接 ·</span>
    <code>{proxy_addr}</code>
  </div>

  <p class="section-title">选择您的设备系统</p>
  <div class="tabs">
    <button class="tab" data-os="ios" onclick="switchTab('ios')">📱 iOS</button>
    <button class="tab" data-os="android" onclick="switchTab('android')">🤖 Android</button>
    <button class="tab" data-os="macos" onclick="switchTab('macos')">🍎 macOS</button>
    <button class="tab" data-os="windows" onclick="switchTab('windows')">🪟 Windows</button>
  </div>

  <!-- iOS -->
  <div class="panel" id="panel-ios">
    <a class="dl-btn" href="/cert.crt" download>
      ⬇ 下载证书（iOS 推荐）
    </a>
    <ol class="steps">
      <li class="step"><div class="step-num">1</div><div class="step-text">点击上方按钮下载证书文件，Safari 会提示"已下载描述文件"</div></li>
      <li class="step"><div class="step-num">2</div><div class="step-text">前往 <strong>设置 → 已下载的描述文件</strong>，点击安装</div></li>
      <li class="step"><div class="step-num">3</div><div class="step-text">前往 <strong>设置 → 通用 → 关于本机 → 证书信任设置</strong></div></li>
      <li class="step"><div class="step-num">4</div><div class="step-text">找到 <strong>RelayCraft CA</strong>，开启完全信任</div></li>
    </ol>
  </div>

  <!-- Android -->
  <div class="panel" id="panel-android">
    <a class="dl-btn" href="/cert.crt" download>
      ⬇ 下载证书（Android 推荐）
    </a>
    <ol class="steps">
      <li class="step"><div class="step-num">1</div><div class="step-text">点击上方按钮下载 <code>.crt</code> 证书文件</div></li>
      <li class="step"><div class="step-num">2</div><div class="step-text">前往 <strong>设置 → 安全 → 加密与凭据 → 安装证书</strong></div></li>
      <li class="step"><div class="step-num">3</div><div class="step-text">选择 <strong>CA 证书</strong>，找到下载的文件并安装</div></li>
      <li class="step"><div class="step-num">4</div><div class="step-text">部分机型路径不同，可在设置中搜索「证书」或「CA 证书」</div></li>
    </ol>
  </div>

  <!-- macOS -->
  <div class="panel" id="panel-macos">
    <a class="dl-btn" href="/cert.pem" download>
      ⬇ 下载证书（macOS）
    </a>
    <ol class="steps">
      <li class="step"><div class="step-num">1</div><div class="step-text">下载证书后，双击 <code>.pem</code> 文件打开「钥匙串访问」</div></li>
      <li class="step"><div class="step-num">2</div><div class="step-text">在「系统」钥匙串中找到 <strong>RelayCraft CA</strong></div></li>
      <li class="step"><div class="step-num">3</div><div class="step-text">双击证书 → 展开「信任」→ 将「使用此证书时」设为 <strong>始终信任</strong></div></li>
      <li class="step"><div class="step-num">4</div><div class="step-text">关闭窗口，输入系统密码确认</div></li>
    </ol>
  </div>

  <!-- Windows -->
  <div class="panel" id="panel-windows">
    <a class="dl-btn" href="/cert.crt" download>
      ⬇ 下载证书（Windows）
    </a>
    <ol class="steps">
      <li class="step"><div class="step-num">1</div><div class="step-text">下载证书后，双击 <code>.crt</code> 文件</div></li>
      <li class="step"><div class="step-num">2</div><div class="step-text">点击「安装证书」→ 选择「本地计算机」→ 下一步</div></li>
      <li class="step"><div class="step-num">3</div><div class="step-text">选择「将所有证书放入下列存储」→ 浏览 → 选择 <strong>受信任的根证书颁发机构</strong></div></li>
      <li class="step"><div class="step-num">4</div><div class="step-text">完成安装，重启浏览器</div></li>
    </ol>
  </div>

  <hr class="divider">

  <p class="section-title">其他格式</p>
  <a class="dl-btn dl-btn-secondary" href="/cert.pem" download>⬇ 下载 PEM 格式</a>
  <a class="dl-btn dl-btn-secondary" href="/cert.crt" download>⬇ 下载 CRT 格式</a>

  <div class="warn-box">
    <span class="warn-icon">⚠</span>
    <span>此证书仅用于本地抓包调试，请勿在生产环境或不受信任的设备上安装。</span>
  </div>
</div>

<div class="footer">RelayCraft · {proxy_addr} · relay.guide</div>

<script>
  function switchTab(os) {{
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.os === os));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + os));
  }}
  switchTab('{detected_os}');
</script>
</body>
</html>"""

                flow.response = Response.make(
                    200,
                    html.encode("utf-8"),
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
