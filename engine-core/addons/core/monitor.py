import time
import base64
from collections import deque
from typing import Optional, Dict, Any, Tuple, List
from mitmproxy import http, ctx
from .debug import DebugManager
from .utils import setup_logging

class TrafficMonitor:
    def __init__(self, debug_mgr: DebugManager):
        self.logger = setup_logging()
        self.flow_buffer: deque = deque(maxlen=1000)
        self.debug_mgr = debug_mgr
    
    def decode_content(self, message: Any) -> Tuple[str, str]:
        if not message.content:
            return "", "text"
        content_type = ""
        for k, v in message.headers.items():
            if k.lower() == "content-type":
                content_type = v.lower()
                break
        binary_types = ["image/", "video/", "audio/", "application/octet-stream", "application/pdf", "application/zip", "application/x-protobuf", "application/x-tar", "application/gzip", "font/"]
        is_magic_binary = False
        prefix = message.content[:4]
        if prefix.startswith(b'\xff\xd8\xff') or prefix.startswith(b'\x89PNG') or prefix.startswith(b'GIF8') or (len(prefix) > 1 and prefix[0] == 0):
            is_magic_binary = True
        should_be_binary = any(t in content_type for t in binary_types) or is_magic_binary
        if should_be_binary:
            try: return base64.b64encode(message.content).decode('ascii'), "base64"
            except Exception as e: return f"<Error encoding binary: {e}>", "text"
        try: return message.content.decode('utf-8'), "text"
        except UnicodeDecodeError: pass
        try: return base64.b64encode(message.content).decode('ascii'), "base64"
        except Exception as e: return f"<Error encoding content: {e}>", "text"

    def process_flow(self, flow: http.HTTPFlow) -> Optional[Dict[str, Any]]:
        """Convert flow to serializable dict"""
        try:
            req_body, req_enc = self.decode_content(flow.request)
            req_truncated = False
            if req_body and len(req_body) > 100000:
                req_body = req_body[:100000] + "... (truncated)"
                req_truncated = True

            # Process Response Body
            res_body, res_enc = "", "text"
            res_truncated = False
            if flow.response:
                res_body, res_enc = self.decode_content(flow.response)
                
                if res_body and len(res_body) > 100000:
                    res_body = res_body[:100000] + "... (truncated)"
                    res_truncated = True
            
            # Duration & Timing
            duration = None
            timing = None
            if flow.request.timestamp_start:
                t_start = flow.request.timestamp_start
                t_end = flow.response.timestamp_end if (flow.response and flow.response.timestamp_end) else time.time()
                duration = (t_end - t_start) * 1000

                # Detailed Timing (if available) - Mitmproxy 10+ uses timestamp_tls_setup
                if flow.server_conn and getattr(flow.server_conn, "timestamp_start", None):
                    conn = flow.server_conn
                    ts_start = getattr(conn, "timestamp_start", None)
                    ts_tcp = getattr(conn, "timestamp_tcp_setup", None)
                    # Support both old (ssl) and new (tls) attribute names
                    ts_tls = getattr(conn, "timestamp_tls_setup", getattr(conn, "timestamp_ssl_setup", None))
                    ts_end = getattr(conn, "timestamp_end", None)
                    
                    t_dns = (ts_tcp - ts_start) * 1000 if (ts_tcp and ts_start) else 0
                    t_connect = 0 # Included in t_dns usually in transparent mode
                    t_ssl = (ts_tls - ts_tcp) * 1000 if (ts_tls and ts_tcp) else 0
                    
                    # TTFB: Request End -> Response Start
                    t_ttfb = 0
                    if flow.request.timestamp_end and flow.response and flow.response.timestamp_start:
                        t_ttfb = (flow.response.timestamp_start - flow.request.timestamp_end) * 1000
                    
                    timing = {
                        "dns": max(0, t_dns),
                        "connect": max(0, t_connect),
                        "ssl": max(0, t_ssl),
                        "ttfb": max(0, t_ttfb),
                        "total": max(0, duration)
                    }

            # Check if this flow is currently paused for breakpoint
            is_paused = False
            paused_at = None
            is_aborted = flow.metadata.get("_relaycraft_aborted", False)
            
            with self.debug_mgr.lock:
                if flow.id in self.debug_mgr.intercepted_flows:
                    is_paused = True
                    paused_at = self.debug_mgr.intercepted_flows[flow.id]["phase"]

            # Error Handling
            error_detail = None
            if flow.error:
                error_detail = {
                    "message": str(flow.error),
                    "errorType": "connection" # Generic for now
                }

            # IPs
            client_ip = flow.client_conn.address[0] if flow.client_conn and flow.client_conn.address else None
            server_ip = flow.server_conn.address[0] if flow.server_conn and flow.server_conn.address else None

            # URL and Scheme - Chrome shows wss:// for websockets
            url = flow.request.url
            is_websocket = flow.websocket is not None if hasattr(flow, 'websocket') else False
            if is_websocket:
                url = url.replace("https://", "wss://").replace("http://", "ws://")

            # Protocol Labeling
            proto = flow.request.http_version
            if is_websocket:
                # If it's a websocket, we can label it specifically or keep transport
                # Let's show "ws" or "wss" as the protocol to trigger our color logic
                proto = "wss" if "wss://" in url else "ws"

            return {
                "id": flow.id,
                "timestamp": flow.request.timestamp_start * 1000,
                "msg_ts": flow.metadata.get("_relaycraft_msg_ts", time.time()),
                "method": flow.request.method,
                "url": url,
                "host": flow.request.host,
                "path": flow.request.path,
                "statusCode": 101 if is_websocket and not is_aborted else (0 if is_aborted else (flow.response.status_code if flow.response else None)),
                "requestHeaders": {str(k): str(v) for k, v in flow.request.headers.items()},
                "responseHeaders": {str(k): str(v) for k, v in flow.response.headers.items()} if flow.response else None,
                "requestBody": req_body,
                "requestBodyEncoding": req_enc,
                "responseBody": res_body,
                "responseBodyEncoding": res_enc,
                "size": len(flow.response.content) if flow.response and flow.response.content else 0,
                "duration": duration,
                "hits": flow.metadata.get("_relaycraft_hits", []) + getattr(flow, "_relaycraft_script_hits", []),
                "intercepted": is_paused,
                "interceptPhase": paused_at,
 
                # V2 Fields
                "httpVersion": proto,
                "clientIp": client_ip,
                "serverIp": server_ip,
                "error": error_detail,
                "timing": timing,
                "isWebsocket": is_websocket,
                "websocketFrames": [
                    {
                        "type": m.type,
                        "fromClient": m.from_client,
                        "content": m.text if m.type == 'text' else (m.content.hex() if m.content else ""),
                        "timestamp": m.timestamp * 1000,
                        "length": len(m.content) if m.content else 0
                    }
                    for m in flow.websocket.messages[-100:]
                ] if getattr(flow, 'websocket', None) and flow.websocket.messages else None,
                "bodyTruncated": req_truncated or res_truncated
            }
        except Exception as e:
            self.logger.error(f"Error processing flow: {e}")
            return None

    def process_tls_error(self, tls_start: Any) -> None:
        """Synthesize a flow record from a TLS error"""
        import uuid
        try:
            client_conn = tls_start.context.client
            server_conn = tls_start.context.server
            
            # Extract basic info
            client_ip = client_conn.peername[0] if client_conn.peername else None
            server_ip = server_conn.peername[0] if server_conn.peername else None
            sni = client_conn.sni or (server_conn.address[0] if server_conn.address else "unknown")
            
            # Error is usually on the connection object in TlsData
            conn_error = getattr(tls_start, "conn", None) and getattr(tls_start.conn, "error", None)
            if not conn_error:
                 # Fallback: check context
                 conn_error = getattr(tls_start, "error", None)

            error_msg = str(conn_error) if conn_error else "Client TLS Handshake Failed"
            
            # Construct a virtual flow ID
            flow_id = str(uuid.uuid4())
            
            flow_data = {
                "id": flow_id,
                "timestamp": time.time() * 1000,
                "msg_ts": time.time(),
                "method": "CONNECT", # Pseudo-method
                "url": f"https://{sni}/",
                "host": sni,
                "path": "/",
                "statusCode": 0, # 0 indicates failure/aborted
                "requestHeaders": {},
                "responseHeaders": {},
                "requestBody": "",
                "requestBodyEncoding": "text",
                "responseBody": "",
                "responseBodyEncoding": "text",
                "size": 0,
                "duration": 0,
                "hits": [],
                "intercepted": False,
                "interceptPhase": None,
                "httpVersion": "", # Empty since no protocol established
                "clientIp": client_ip,
                "serverIp": server_ip,
                "error": {
                    "message": error_msg,
                    "errorType": "tls_error" # Specific type for frontend to styling
                },
                "timing": None,
                "isWebsocket": False,
                "bodyTruncated": False
            }
            
            self.flow_buffer.append(flow_data)
        except Exception as e:
            self.logger.error(f"Error processing TLS error: {e}")

    def handle_websocket_message(self, flow: http.HTTPFlow) -> None:
        """Called when a new websocket message arrives"""
        flow.metadata["_relaycraft_msg_ts"] = time.time()
        flow_data = self.process_flow(flow)
        if flow_data:
            self.flow_buffer.append(flow_data)

    async def handle_request(self, flow: http.HTTPFlow) -> None:
        """Intercept polling and control requests"""
        import json
        from mitmproxy.http import Response
        
        # Handle CORS preflight
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

        if "/_relay/poll" in flow.request.path:
            try:
                query = flow.request.query
                try:
                    since_param = query.get("since", "0")
                    if not since_param: since_param = "0"
                    since_ts = float(since_param)
                except ValueError:
                    since_ts = 0.0
                
                # Polling based on msg_ts (precise drift-free seconds)
                updates = [f for f in list(self.flow_buffer) if f.get("msg_ts", 0) > since_ts]
                
                response_data = {"flows": updates, "server_ts": time.time()}
                # Use default handler for safety, but allow Unicode (False) to save space and keep formatting
                json_str = json.dumps(response_data, default=safe_json_default, ensure_ascii=False)
                flow.response = Response.make(
                    200, 
                    json_str.encode("utf-8"), 
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                )
                # Explicitly set status to prevent downstream changes
                flow.response.status_code = 200
                flow.response.reason = b"OK"
                
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                # Print to stdout/stderr to ensure visibility in Tauri console
                print(f"RelayCraft Poll Error:\n{tb}")
                self.logger.error(f"Error in poll handler: {tb}")
                error_resp = {"error": str(e), "traceback": tb}
                try:
                    safe_err = json.dumps(error_resp, default=safe_json_default)
                    flow.response = Response.make(500, safe_err.encode("utf-8"), {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"})
                except:
                    flow.response = Response.make(500, b'{"error": "Critical serialization failure"}', {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"})
        
        elif "/_relay/breakpoints" in flow.request.path:
            # Set/Manage breakpoints
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                action = data.get("action")
                if action == "add":
                    self.debug_mgr.add_breakpoint(data.get("pattern"))
                elif action == "remove":
                    self.debug_mgr.remove_breakpoint(data.get("pattern"))
                elif action == "clear":
                    with self.debug_mgr.lock: self.debug_mgr.breakpoints = []
                
                flow.response = Response.make(200, b"OK", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                flow.response = Response.make(500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"})

        elif "/_relay/resume" in flow.request.path:
            # Resume flow
            try:
                data = json.loads(flow.request.content.decode('utf-8'))
                flow_id = data.get("id")
                modifications = data.get("modifications")
                success = self.debug_mgr.resume_flow(flow_id, modifications)
                flow.response = Response.make(200 if success else 404, b"OK" if success else b"NOTFOUND", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                flow.response = Response.make(500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"})
        
        elif flow.request.path == "/cert":
            # Serve the CA certificate
            try:
                import os
                confdir = os.environ.get("MITMPROXY_CONFDIR")
                if confdir:
                    # Prefer .crt (DER) as it's more widely recognized as a "Certificate" by OS installers
                    cert_path_crt = os.path.join(confdir, "relaycraft-ca-cert.crt")
                    cert_path_pem = os.path.join(confdir, "relaycraft-ca-cert.pem")
                    
                    target_path = cert_path_crt if os.path.exists(cert_path_crt) else cert_path_pem
                    filename = "relaycraft-ca-cert.crt" if target_path == cert_path_crt else "relaycraft-ca-cert.pem"
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
                
                flow.response = Response.make(404, b"Not Found", {"Access-Control-Allow-Origin": "*"})
            except Exception as e:
                flow.response = Response.make(500, str(e).encode('utf-8'), {"Access-Control-Allow-Origin": "*"})

    def handle_response(self, flow: http.HTTPFlow) -> None:
        """Capture flows"""
        if flow.request.path.startswith("/_relay"): return
        flow_data = self.process_flow(flow)
        if flow_data: 
            self.flow_buffer.append(flow_data)
