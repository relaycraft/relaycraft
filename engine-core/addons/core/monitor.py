"""
Traffic Monitor - HAR-Compatible Data Processing

This module converts mitmproxy flows to HAR-compatible format.
All headers, cookies, and query parameters are preserved as arrays
to support multiple values with the same name (e.g., Set-Cookie).

@see https://w3c.github.io/web-performance/specs/HAR/Overview.html
"""

import time
import base64
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple, List

from mitmproxy import http, ctx

from .debug import DebugManager
from .utils import setup_logging


class TrafficMonitor:
    """Converts mitmproxy flows to HAR-compatible format."""

    def __init__(self, debug_mgr: DebugManager):
        self.logger = setup_logging()
        self.flow_buffer: deque = deque(maxlen=10000)  # Match frontend maxIndices
        self.debug_mgr = debug_mgr

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

            # Hits from rules/scripts
            hits = flow.metadata.get("_relaycraft_hits", [])
            hits.extend(getattr(flow, "_relaycraft_script_hits", []))

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

            self.flow_buffer.append(flow_data)

        except Exception as e:
            self.logger.error(f"Error processing TLS error: {e}")

    # ==================== WebSocket ====================

    def handle_websocket_message(self, flow: http.HTTPFlow) -> None:
        """Called when a new websocket message arrives."""
        flow.metadata["_relaycraft_msg_ts"] = time.time()
        flow_data = self.process_flow(flow)
        if flow_data:
            self.flow_buffer.append(flow_data)

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

                # Return only lightweight indices for memory efficiency
                indices = []
                for f in list(self.flow_buffer):
                    if f.get("msg_ts", 0) > since_ts:
                        # Safely extract nested fields with None checks
                        req = f.get("request") or {}
                        res = f.get("response") or {}
                        rc = f.get("_rc") or {}

                        # Extract only the fields needed for list display
                        indices.append({
                            "id": f.get("id"),
                            "seq": f.get("order", 0),
                            "method": req.get("method", ""),
                            "url": req.get("url", ""),
                            "host": f.get("host", ""),
                            "path": f.get("path", ""),
                            "status": res.get("status", 0),
                            "contentType": f.get("contentType", ""),
                            "startedDateTime": f.get("startedDateTime", ""),
                            "time": f.get("time", 0),
                            "size": f.get("size", 0),
                            "hasError": bool(rc.get("error")),
                            "hasRequestBody": bool((req.get("postData") or {}).get("text")),
                            "hasResponseBody": bool((res.get("content") or {}).get("text")),
                            "isWebsocket": rc.get("isWebsocket", False),
                            "websocketFrameCount": rc.get("websocketFrameCount", 0),
                            "isIntercepted": bool((rc.get("intercept") or {}).get("intercepted")),
                            # Include hit metadata for list display
                            "hits": [
                                {
                                    "id": h.get("id", ""),
                                    "name": h.get("name", ""),
                                    "type": h.get("type", ""),
                                    "status": h.get("status"),
                                }
                                for h in rc.get("hits", [])
                            ],
                            "msg_ts": f.get("msg_ts"),
                        })

                response_data = {
                    "indices": indices,
                    "server_ts": time.time(),
                    "buffer_ids": [f.get("id") for f in list(self.flow_buffer) if f.get("id")]
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

                # Find the flow in buffer
                flow_data = None
                for f in list(self.flow_buffer):
                    if f.get("id") == flow_id:
                        flow_data = f
                        break

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

        # Breakpoint management
        elif "/_relay/breakpoints" in flow.request.path:
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                action = data.get("action")
                if action == "add":
                    self.debug_mgr.add_breakpoint(data.get("pattern"))
                elif action == "remove":
                    self.debug_mgr.remove_breakpoint(data.get("pattern"))
                elif action == "clear":
                    with self.debug_mgr.lock:
                        self.debug_mgr.breakpoints = []

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

        # Export session (all flows)
        elif "/_relay/export_session" in flow.request.path:
            try:
                all_flows = list(self.flow_buffer)
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
                all_flows = list(self.flow_buffer)
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

        # Import session
        elif "/_relay/import_session" in flow.request.path:
            try:
                if flow.request.method == "POST":
                    flows = json.loads(flow.request.content.decode('utf-8'))
                    # Add flows to buffer and return indices
                    indices = []
                    for idx, f in enumerate(flows):
                        f["order"] = idx + 1
                        f["msg_ts"] = time.time() + idx * 0.001
                        self.flow_buffer.append(f)
                        rc = f.get("_rc", {})
                        indices.append({
                            "id": f.get("id"),
                            "seq": idx + 1,
                            "method": f.get("request", {}).get("method", ""),
                            "url": f.get("request", {}).get("url", ""),
                            "host": f.get("host", ""),
                            "path": f.get("path", ""),
                            "status": f.get("response", {}).get("status", 0),
                            "contentType": f.get("contentType", ""),
                            "startedDateTime": f.get("startedDateTime", ""),
                            "time": f.get("time", 0),
                            "size": f.get("size", 0),
                            "hasError": bool(rc.get("error")),
                            "hasRequestBody": bool(f.get("request", {}).get("postData", {}).get("text")),
                            "hasResponseBody": bool(f.get("response", {}).get("content", {}).get("text")),
                            "isWebsocket": rc.get("isWebsocket", False),
                            "websocketFrameCount": rc.get("websocketFrameCount", 0),
                            "isIntercepted": bool(rc.get("intercept", {}).get("intercepted")),
                            # Include hit metadata for list display
                            "hits": [
                                {
                                    "id": h.get("id", ""),
                                    "name": h.get("name", ""),
                                    "type": h.get("type", ""),
                                    "status": h.get("status"),
                                }
                                for h in rc.get("hits", [])
                            ],
                        })
                    json_str = json.dumps(indices, ensure_ascii=False)
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
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Import HAR
        elif "/_relay/import_har" in flow.request.path:
            try:
                if flow.request.method == "POST":
                    har_data = json.loads(flow.request.content.decode('utf-8'))
                    entries = har_data.get("log", {}).get("entries", [])
                    indices = []
                    for idx, entry in enumerate(entries):
                        entry["order"] = idx + 1
                        entry["msg_ts"] = time.time() + idx * 0.001
                        self.flow_buffer.append(entry)
                        rc = entry.get("_rc", {})
                        indices.append({
                            "id": entry.get("id"),
                            "seq": idx + 1,
                            "method": entry.get("request", {}).get("method", ""),
                            "url": entry.get("request", {}).get("url", ""),
                            "host": entry.get("host", ""),
                            "path": entry.get("path", ""),
                            "status": entry.get("response", {}).get("status", 0),
                            "contentType": entry.get("contentType", ""),
                            "startedDateTime": entry.get("startedDateTime", ""),
                            "time": entry.get("time", 0),
                            "size": entry.get("size", 0),
                            "hasError": bool(rc.get("error")),
                            "hasRequestBody": bool(entry.get("request", {}).get("postData", {}).get("text")),
                            "hasResponseBody": bool(entry.get("response", {}).get("content", {}).get("text")),
                            "isWebsocket": rc.get("isWebsocket", False),
                            "websocketFrameCount": rc.get("websocketFrameCount", 0),
                            "isIntercepted": bool(rc.get("intercept", {}).get("intercepted")),
                            # Include hit metadata for list display
                            "hits": [
                                {
                                    "id": h.get("id", ""),
                                    "name": h.get("name", ""),
                                    "type": h.get("type", ""),
                                    "status": h.get("status"),
                                }
                                for h in rc.get("hits", [])
                            ],
                        })
                    json_str = json.dumps(indices, ensure_ascii=False)
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
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

        # Certificate serving
        elif flow.request.path == "/cert":
            try:
                import os
                confdir = os.environ.get("MITMPROXY_CONFDIR")
                if confdir:
                    cert_path_crt = os.path.join(confdir, "relaycraft-ca-cert.crt")
                    cert_path_pem = os.path.join(confdir, "relaycraft-ca-cert.pem")

                    target_path = cert_path_crt if os.path.exists(cert_path_crt) else cert_path_pem
                    filename = (
                        "relaycraft-ca-cert.crt"
                        if target_path == cert_path_crt
                        else "relaycraft-ca-cert.pem"
                    )
                    content_type = "application/x-x509-ca-cert"

                    if os.path.exists(target_path):
                        with open(target_path, "rb") as f:
                            content = f.read()

                        flow.response = Response.make(
                            200,
                            content,
                            {
                                "Content-Type": content_type,
                                "Content-Disposition": f'attachment; filename="{filename}"',
                                "Access-Control-Allow-Origin": "*"
                            }
                        )
                        return

                flow.response = Response.make(404, b"Not Found", {
                    "Access-Control-Allow-Origin": "*"
                })
            except Exception as e:
                flow.response = Response.make(
                    500,
                    str(e).encode('utf-8'),
                    {"Access-Control-Allow-Origin": "*"}
                )

    def handle_response(self, flow: http.HTTPFlow) -> None:
        """Capture flows on response."""
        if flow.request.path.startswith("/_relay"):
            return
        flow_data = self.process_flow(flow)
        if flow_data:
            self.flow_buffer.append(flow_data)
