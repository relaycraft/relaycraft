import re
import json
import time
from pathlib import Path
from typing import Optional, Any, Dict, List, Union
from mitmproxy import http, ctx
from mitmproxy.http import Response
from ..utils import get_mime_type, setup_logging

class ActionExecutor:
    def __init__(self, engine: Any):
        self.engine = engine  # Reference back to engine if needed
        self.logger = setup_logging()

    def apply_rewrite_body(self, flow: http.HTTPFlow, action: Dict[str, Any], url_match: Optional[re.Match] = None) -> None:
        """Apply body modifications (Text/Regex/JSON) to Request or Response"""
        target = action.get("target", "response")
        
        # Determine which message to modify
        message = flow.request if target == "request" else flow.response
        if not message:
            return

        try:
            # Ensure decompression for modification
            if message.content:
                message.decode()

            # V3 Structure: check for specific mode blocks
            set_mode = action.get("set")
            replace_mode = action.get("replace")
            regex_mode = action.get("regex_replace")
            json_mode = action.get("json")

            # Handle JSON Modification mode
            if json_mode:
                modifications = json_mode.get("modifications", [])
                if modifications:
                    try:
                        content_str = message.text if message.text else "{}"
                        json_data = json.loads(content_str)
                        for mod in modifications:
                            if mod.get("enabled") is False: continue
                            self.apply_json_modification(json_data, mod.get("path", ""), mod.get("value"), mod.get("operation", "set"))
                        message.text = json.dumps(json_data, ensure_ascii=False)
                        self.logger.info(f"RelayCraft: Applied JSON rewrite to {target}")
                    except json.JSONDecodeError:
                        self.logger.warn(f"Cannot apply JSON rewrite: Body is not valid JSON ({target})")
                
            # Handle Text/Regex modes
            elif set_mode or replace_mode or regex_mode:
                original_content = message.text if message.text else ""
                new_content_str = original_content

                if set_mode:
                    new_content_str = set_mode.get("content", "")
                elif replace_mode:
                    pattern = replace_mode.get("pattern", "")
                    replacement = replace_mode.get("replacement", "")
                    if pattern:
                       new_content_str = original_content.replace(pattern, replacement)
                elif regex_mode:
                    pattern = regex_mode.get("pattern", "")
                    replacement = regex_mode.get("replacement", "")
                    if pattern:
                        try:
                            # Expand regex substitutes if we have url_match
                            if url_match:
                                # Escape backslashes for expansion safely
                                template = replacement.replace("\\", "\\\\").replace("$", "\\")
                                new_content_str = url_match.expand(template)
                            else:
                                new_content_str = re.sub(pattern, replacement, original_content)
                        except re.error as e:
                            self.logger.error(f"Invalid regex for body rewrite: {e}")

                if new_content_str != original_content:
                    message.text = new_content_str
                    self.logger.info(f"Applied body rewrite to {target}")

            # Apply status code / content type if specified (Set mode only in V3)
            if set_mode and target == "response" and flow.response:
                status_code = set_mode.get("statusCode")
                if status_code:
                    flow.response.status_code = int(status_code)
                content_type = set_mode.get("contentType")
                if content_type:
                    flow.response.headers["Content-Type"] = content_type

        except Exception as e:
            self.logger.error(f"Error in apply_rewrite_body: {e}")
    
    def apply_json_modification(self, data: Union[Dict, List], path: str, value: Any, operation: str) -> None:
        """Apply JSONPath modification to data"""
        try:
            import jsonpath_ng
            from jsonpath_ng import parse
            
            jsonpath_expr = parse(path)
            matches = jsonpath_expr.find(data)
            
            if not matches:
                self.logger.warn(f"RelayCraft: JSONPath '{path}' matched no fields in the body")
                return
            
            if operation == "set":
                # Update all matching paths
                jsonpath_expr.update(data, value)
                ctx.log.info(f"Set {path} = {value} ({len(matches)} matches)")

            elif operation == "delete":
                # Group matches by parent to handle multiple deletions safely
                matches_by_parent = {}
                for match in matches:
                    if not match.context: continue # Cannot delete root
                    parent_id = id(match.context.value)
                    if parent_id not in matches_by_parent:
                        matches_by_parent[parent_id] = {'parent': match.context.value, 'matches': []}
                    matches_by_parent[parent_id]['matches'].append(match)
                
                count = 0
                for pid, info in matches_by_parent.items():
                    parent = info['parent']
                    p_matches = info['matches']
                    
                    if isinstance(parent, list):
                        # Collect indices to delete
                        indices = set()
                        for m in p_matches:
                            if isinstance(m.path, jsonpath_ng.Index):
                                indices.add(m.path.index)
                        
                        # Delete from highest index down
                        for idx in sorted(list(indices), reverse=True):
                            if 0 <= idx < len(parent):
                                parent.pop(idx)
                                count += 1
                                
                    elif isinstance(parent, dict):
                        for m in p_matches:
                                for field in m.path.fields:
                                    if field in parent:
                                        del parent[field]
                                        count += 1
                                        
                ctx.log.info(f"Deleted {path} ({count} actual deletions)")
                    
            elif operation == "append":
                # Append value to array matches
                for match in matches:
                    if isinstance(match.value, list):
                        match.value.append(value)
                        self.logger.info(f"Appended to {path}")
                    else:
                        self.logger.warn(f"Cannot append to non-array at {path}")
                        
        except ImportError:
            self.logger.error("jsonpath-ng not installed, cannot modify JSON")
        except Exception as e:
            self.logger.error(f"JSONPath error for '{path}': {e}")
    

    def apply_map_local(self, flow: http.HTTPFlow, action: Dict[str, Any], url_match: Optional[re.Match] = None) -> None:
        """Apply map local - supports File and Manual sources"""
        source = action.get("source", "file")
        content_type = action.get("contentType", "")
        status_code = action.get("statusCode", 200)

        if source == "manual":
            content = action.get("content", "")
            body = content.encode("utf-8") if isinstance(content, str) else b""
            
            headers = {}
            if content_type:
                headers["Content-Type"] = content_type
            elif content.strip().startswith(("{", "[")):
                headers["Content-Type"] = "application/json; charset=utf-8"
            else:
                headers["Content-Type"] = "text/plain; charset=utf-8"

            flow.response = Response.make(
                status_code=status_code,
                content=body,
                headers=headers
            )
            
            # Apply unified headers structure (V3)
            headers_config = action.get("headers")
            if headers_config:
                self.apply_rewrite_header(flow, headers_config, "response")
                
            self.logger.info(f"Map Local (Manual Mock): {len(body)} bytes, status {status_code}")
            return

        # --- File Source Logic ---
        local_path = action.get("localPath", "")
        # Perform regex substitution if match object exists
        if url_match and local_path:
            try:
            # 1. Escape backslashes in Windows paths
                template = local_path.replace("\\", "\\\\")
                # 2. Convert $1, $2 to \1, \2 for python regex expansion
                template = re.sub(r'\$(\d+)', r'\\\1', template)
                local_path = url_match.expand(template)
                self.logger.info(f"Regex substitution result: {local_path}")
            except Exception as e:
                self.logger.error(f"Error expanding regex in local path: {e}")
        
        if not local_path:
            # Case 1: Empty path -> Use status code only (mock response)
            self.logger.info(f"Map Local (Empty Path): using status {status_code}")
            flow.response = Response.make(
                status_code=status_code,
                content=b"",
                headers={"Content-Type": content_type or "text/plain"}
            )
            return

        file_path = Path(local_path)
        if file_path.exists() and file_path.is_file():
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                
                headers = {}
                # Auto-detect Content-Type
                if content_type:
                    headers["Content-Type"] = content_type
                else:
                    detected_type = get_mime_type(local_path)
                    headers["Content-Type"] = detected_type
                
                flow.response = Response.make(
                    status_code=status_code, 
                    content=content,
                    headers=headers
                )
                
                # Apply unified headers structure (V3)
                headers_config = action.get("headers")
                if headers_config:
                    self.apply_rewrite_header(flow, headers_config, "response")
                    
                self.logger.info(f"[DEBUG] Map Local SUCCESS: {local_path}")
                # ctx.log.info(f"[DEBUG] Request Headers Count: {len(flow.request.headers)}")
                # ctx.log.info(f"[DEBUG] Request Headers: {dict(flow.request.headers)}")
                self.logger.info(f"Map Local (File): {local_path}, status {status_code}")
            except Exception as e:
                self.logger.error(f"Error reading local file: {e}")
        else:
            # File missing - fallback to network
            self.logger.warn(f"Map Local file not found: {local_path}")
            
            # handle_request already recorded the hit, just update status
            rule_id = action.get("_rule_id") # We should ensure action has rule context
            if rule_id:
                # Mock a rule dict for record_rule_hit
                temp_rule = {"id": rule_id, "name": action.get("_rule_name", "Unknown"), "type": "map_local"}
                self.engine.record_rule_hit(flow, temp_rule, status="file_not_found", message=local_path)
            
            # Do NOT set flow.response, allowing fallback to network (or next rule)
    
    def apply_map_remote(self, flow: http.HTTPFlow, action: Dict[str, Any], url_match: Optional[re.Match] = None) -> None:
        """Apply URL redirection with regex substitution support"""
        target_url = action.get("targetUrl", "")
        preserve_path = action.get("preservePath", True)
        
        # Check if target URL contains group references ($1, \1 etc)
        use_regex_sub = False
        if url_match and target_url:
            if re.search(r'(?<!\\)(\$\d|\\\d)', target_url):
                use_regex_sub = True

        # 1. Regex Substitution Mode
        if use_regex_sub:
            try:
                # Escape backslashes in Windows paths (if any)
                template = target_url.replace("\\", "\\\\")
                # Convert $1, $2 to \1, \2 for re.expand
                template = re.sub(r'\$(\d+)', r'\\\1', template)
                target_url = url_match.expand(template)
                self.logger.info(f"Regex substitution result: {target_url}")
                flow.request.url = target_url
            except Exception as e:
                self.logger.error(f"Error expanding regex in target URL: {e}")
                # Fallback to simple replacement if regex fails
                flow.request.url = target_url

        # 2. Simple Mapping Mode (Preserve Path Logic)
        else:
            if preserve_path:
                from urllib.parse import urlparse
                
                # Ensure target has scheme for parsing
                parse_url = target_url
                if "://" not in parse_url:
                    parse_url = f"https://{parse_url}"
                
                try:
                    parsed = urlparse(parse_url)
                    
                    # Update Scheme
                    if parsed.scheme:
                        flow.request.scheme = parsed.scheme
                    
                    # Update Host
                    if parsed.hostname:
                        flow.request.host = parsed.hostname
                    
                    # Update Port
                    if parsed.port:
                        flow.request.port = parsed.port
                    else:
                        # Reset port to default for scheme
                        flow.request.port = 443 if flow.request.scheme == "https" else 80
                    
                    # Prepend target path prefixif exists
                    if parsed.path and parsed.path != "/":
                        prefix = parsed.path.rstrip('/')
                        original_path = flow.request.path
                        if not original_path.startswith("/"):
                            original_path = "/" + original_path
                        flow.request.path = prefix + original_path
                        
                except Exception as e:
                    self.logger.error(f"Error parsing target URL {target_url}: {e}")
                    flow.request.url = target_url
            else:
                # No preserve path - exact URL replacement
                flow.request.url = target_url
        
        self.logger.info(f"Redirected to: {flow.request.url}")
        
        # Apply optional request headers
        headers_config = action.get("headers")
        if headers_config:
            self.apply_rewrite_header(flow, headers_config, "request")
            
        # Legacy fallback for requestHeaders
        request_headers = action.get("requestHeaders", [])
        if request_headers:
            self.apply_rewrite_header(flow, {
                "request": request_headers
            }, "request")
    
    def apply_rewrite_header(self, flow: http.HTTPFlow, headers_config: Dict[str, Any], phase: str) -> None:
        # V3: headers_config is { "request": [...], "response": [...] }
        operations = headers_config.get(phase, [])
        if not operations:
            return

        message = flow.request if phase == "request" else flow.response
        if not message:
            return

        for op in operations:
            operation = op.get("operation")
            key = op.get("key")
            value = op.get("value", "")

            if operation == "add":
                message.headers.add(key, value)
            elif operation == "set":
                message.headers[key] = value
            elif operation == "remove":
                if key in message.headers:
                    del message.headers[key]
        
        self.logger.info(f"RelayCraft: Applied {len(operations)} header operations to {phase}")
    
    def apply_throttle(self, flow: http.HTTPFlow, action: Dict[str, Any], phase: str = "request") -> None:
        """Apply network faults (Latency, Packet Loss, and Bandwidth Throttling)"""
        import random
        
        delay_ms = action.get("delayMs") or 0
        packet_loss = action.get("packetLoss") or 0
        bandwidth_kbps = action.get("bandwidthKbps") or 0
        
        # 1. Latency (request phase)
        if phase == "request" and delay_ms > 0:
            time.sleep(delay_ms / 1000.0)
            # ctx.log.info(f"Latency delay: {delay_ms}ms")
            
        # 2. Packet Loss (request phase to kill early)
        if phase == "request" and packet_loss > 0:
            if random.randint(1, 100) <= packet_loss:
                flow.kill()
                self.logger.info(f"Dropped request (Packet Loss {packet_loss}%)")
                return

        # 3. Bandwidth throttle
        if bandwidth_kbps > 0:
            content = None
            if phase == "request":
                content = flow.request.content
            elif phase == "response" and flow.response:
                content = flow.response.content
            
            if content:
                content_size = len(content)
                # delay = bytes * 8 / (kbps * 1000)
                bw_delay_sec = (content_size * 8) / (bandwidth_kbps * 1000.0)
                if bw_delay_sec > 0:
                    time.sleep(bw_delay_sec)
                    # ctx.log.info(f"Bandwidth delay ({phase}): {bw_delay_sec:.4f}s for {content_size} bytes @ {bandwidth_kbps}Kbps")
