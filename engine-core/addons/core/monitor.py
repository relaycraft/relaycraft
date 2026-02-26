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

import string
from mitmproxy import http, ctx

from .debug import DebugManager
from .utils import setup_logging
from .flow_database import FlowDatabase

# Professional translations for the certificate landing page
I18N_CERT_LANDING = {
    "zh": {
        "lang": "zh-CN",
        "title": "RelayCraft · 证书安装指南",
        "tagline": "AI 原生网络流量调试工具",
        "proxy_connected_label": "代理已连接",
        "device_system_label": "选择设备系统",
        "ios_label": "iOS",
        "android_label": "Android",
        "harmony_label": "HarmonyOS",
        "dl_ios_btn": "下载 iOS 证书",
        "dl_android_btn": "下载 Android 证书",
        "dl_harmony_btn": "下载 HarmonyOS 证书",
        "step_ios_1": "在 <strong>Safari</strong> 浏览器中点击允许下载",
        "step_ios_2": "进入 <strong>设置 → 已下载描述文件</strong> 进行安装",
        "step_ios_3": "进入 <strong>通用 → 关于本机 → 证书信任设置</strong>",
        "step_ios_4": "勾选 <strong>RelayCraft CA</strong> 开启完全信任",
        "step_android_1": "点击上方按钮下载 <code>.crt</code> 证书文件",
        "step_android_2": "进入 <strong>系统设置 → 安全 → 从存储设备安装</strong>",
        "step_android_3": "选择 <strong>CA 证书</strong> 选项",
        "step_android_4": "在文件选择器中找到下载的证书并确认",
        "step_harmony_1": "点击上方按钮下载 <code>.pem</code> 证书文件",
        "step_harmony_2": "设置 → 安全 → 更多安全设置 → 加密和凭据",
        "step_harmony_3": "点击 <strong>从存储设备安装</strong> → <strong>CA 证书</strong>",
        "step_harmony_4": "在下载目录选择证书并确认安装",
        "manual_install_label": "手动下载格式",
        "pem_format_label": "PEM 格式",
        "crt_format_label": "CRT 格式",
        "warning_text": "仅供本地调试使用。请勿在非信任设备上安装。",
        "footer_text": "RelayCraft · AI 原生网络流量调试工具",
    },
    "en": {
        "lang": "en-US",
        "title": "RelayCraft · Certificate Guide",
        "tagline": "AI-Native Web Traffic Debugging Tool",
        "proxy_connected_label": "Proxy Connected",
        "device_system_label": "Device System",
        "ios_label": "iOS",
        "android_label": "Android",
        "harmony_label": "HarmonyOS",
        "dl_ios_btn": "Download for iOS",
        "dl_android_btn": "Download for Android",
        "dl_harmony_btn": "Download for HarmonyOS",
        "step_ios_1": "Allow download in <strong>Safari</strong>",
        "step_ios_2": "Install in <strong>Settings → Profile Downloaded</strong>",
        "step_ios_3": "Go to <strong>General → About → Trust Settings</strong>",
        "step_ios_4": "Enable full trust for <strong>RelayCraft CA</strong>",
        "step_android_1": "Download the <code>.crt</code> certificate file",
        "step_android_2": "Go to <strong>Settings → Security → Install from storage</strong>",
        "step_android_3": "Select <strong>CA Certificate</strong>",
        "step_android_4": "Choose the RelayCraft file to confirm",
        "step_harmony_1": "Download the <code>.pem</code> certificate file",
        "step_harmony_2": "Settings → Security → More → Encryption & Credentials",
        "step_harmony_3": "Tap <strong>Install from storage</strong> → <strong>CA Certificate</strong>",
        "step_harmony_4": "Select the certificate from Downloads to confirm",
        "manual_install_label": "Manual Install",
        "pem_format_label": "PEM Format",
        "crt_format_label": "CRT Format",
        "warning_text": "For local debugging only. Do not install on untrusted devices.",
        "footer_text": "RelayCraft · AI-Native Web Traffic Debugging Tool",
    }
}


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
                        "seq": i,
                        "type": m.type.name.lower() if hasattr(m.type, 'name') else str(m.type),
                        "fromClient": m.from_client,
                        "content": (
                            m.text if m.is_text
                            else (m.content.hex() if m.content else "")
                        ),
                        "encoding": "text" if m.is_text else "base64",
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
                    "websocketFrames": ws_frames,
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
                    except Exception:
                        pass
                        
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

                    with open(file_path, 'r', encoding='utf-8') as fh:
                        data = json.load(fh)

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
                    self.db.store_flows_batch(flows, session_id=session_id)
                    self.db.update_session_flow_count(session_id)

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
                self.logger.error(f"Import session file error: {tb}")
                flow.response = Response.make(
                    500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"}
                )

        # Import HAR (data in HTTP body — legacy)
        elif "/_relay/import_har" in flow.request.path and "_file" not in flow.request.path:
            try:
                if flow.request.method == "POST":
                    import uuid as _uuid
                    from urllib.parse import urlparse

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
                    from urllib.parse import urlparse
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
                    except Exception:
                        pass
                        
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

                    with open(file_path, 'r', encoding='utf-8') as fh:
                        har_data = json.load(fh)
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
                # 1. Detect language
                lang_header = flow.request.headers.get("accept-language", "").lower()
                lang = "zh" if "zh" in lang_header else "en"
                t_vars = I18N_CERT_LANDING[lang].copy()

                # 2. Determine proxy address for display
                try:
                    proxy_host = flow.request.host if flow.request.host != "relay.guide" else "127.0.0.1"
                    current_port = ctx.options.listen_port if (hasattr(ctx, "options") and hasattr(ctx.options, "listen_port")) else 9090
                    proxy_addr = f"{proxy_host}:{current_port}"
                except Exception:
                    proxy_addr = "127.0.0.1:9090"
                t_vars["proxy_addr"] = proxy_addr

                # 3. Detect OS for default tab
                ua = flow.request.headers.get("user-agent", "").lower()
                if "iphone" in ua or "ipad" in ua or "macintosh" in ua or "mac os x" in ua:
                    detected_os = "ios"
                elif "harmony" in ua or "hms" in ua or "openharmony" in ua:
                    detected_os = "harmony"
                elif "android" in ua:
                    detected_os = "android"
                else:
                    # Default to android for other mobile contexts
                    detected_os = "android"
                t_vars["detected_os"] = detected_os

                # 4. Load and render template
                try:
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
        import uuid as _uuid
        from urllib.parse import urlparse

        flows = []
        indices = []
        base_ts = time.time()

        for idx, entry in enumerate(entries):
            if not entry:
                continue

            flow_id = str(_uuid.uuid4())
            req = entry.get("request") or {}
            url = req.get("url") or ""
            parsed = urlparse(url) if url else None
            resp = entry.get("response") or {}
            resp_content = resp.get("content") or {}
            rc = entry.get("_rc") or {}

            msg_ts = base_ts + idx * 0.001

            flow_data = {
                "id": flow_id,
                "msg_ts": msg_ts,
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
            flows.append(flow_data)

            indices.append({
                "id": flow_id,
                "msg_ts": msg_ts,
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
                "hasRequestBody": bool((req.get("postData") or {}).get("text")),
                "hasResponseBody": bool(resp_content.get("text")),
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

        return flows, indices

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
