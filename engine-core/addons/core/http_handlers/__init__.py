"""HTTP handlers migrated from monitor.py in PR13B-2."""

import json
import traceback
from typing import Any, Callable

from mitmproxy import ctx

from ..i18n_cert import build_cert_template_vars


def handle_realtime_routes(
    monitor: Any,
    flow: Any,
    route_key: str,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> bool:
    if route_key == "relay_poll":
        _handle_poll(monitor, flow, Response, safe_json_default)
        return True
    if route_key == "relay_detail":
        _handle_detail(monitor, flow, Response, safe_json_default)
        return True
    if route_key == "relay_sse":
        _handle_sse(monitor, flow, Response, safe_json_default)
        return True
    if route_key == "relay_ws_inject":
        _handle_ws_inject(monitor, flow, Response)
        return True
    return False


def handle_control_routes(monitor: Any, flow: Any, route_key: str, Response: Any) -> bool:
    if route_key == "relay_breakpoints":
        _handle_breakpoints(monitor, flow, Response)
        return True
    if route_key == "relay_resume":
        _handle_resume(monitor, flow, Response)
        return True
    if route_key == "relay_sessions_delete_all":
        _handle_sessions_delete_all(monitor, flow, Response)
        return True
    if route_key == "relay_sessions_get":
        _handle_sessions_get(monitor, flow, Response)
        return True
    if route_key == "relay_sessions_post":
        _handle_sessions_post(monitor, flow, Response)
        return True
    if route_key == "relay_session_new":
        _handle_session_new(monitor, flow, Response)
        return True
    if route_key == "relay_session_activate":
        _handle_session_activate(monitor, flow, Response)
        return True
    if route_key == "relay_session_delete":
        _handle_session_delete(monitor, flow, Response)
        return True
    if route_key == "relay_session_clear":
        _handle_session_clear(monitor, flow, Response)
        return True
    return False


def handle_data_routes(
    monitor: Any,
    flow: Any,
    route_key: str,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> bool:
    if route_key == "relay_search":
        _handle_search(monitor, flow, Response)
        return True
    if route_key == "relay_stats":
        _handle_stats(monitor, flow, Response)
        return True
    if route_key == "relay_traffic_active":
        _handle_traffic_active(monitor, flow, Response)
        return True
    if route_key == "relay_export_session":
        _handle_export_session(monitor, flow, Response, safe_json_default)
        return True
    if route_key == "relay_export_har":
        _handle_export_har(monitor, flow, Response, safe_json_default)
        return True
    if route_key == "relay_export_progress":
        _handle_export_progress(monitor, flow, Response)
        return True
    return False


def handle_import_routes(monitor: Any, flow: Any, route_key: str, Response: Any) -> bool:
    if route_key == "relay_import_session":
        _handle_import_session(monitor, flow, Response)
        return True
    if route_key == "relay_import_session_file":
        _handle_import_session_file(monitor, flow, Response)
        return True
    if route_key == "relay_import_har":
        _handle_import_har(monitor, flow, Response)
        return True
    if route_key == "relay_import_har_file":
        _handle_import_har_file(monitor, flow, Response)
        return True
    return False


def handle_cert_routes(monitor: Any, flow: Any, route_key: str, Response: Any) -> bool:
    if route_key == "cert_serve":
        _handle_cert_serve(monitor, flow, Response)
        return True
    return False


def _handle_cert_serve(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        import os

        confdir = os.environ.get("MITMPROXY_CONFDIR")
        cert_path_pem = os.path.join(confdir, "relaycraft-ca-cert.pem") if confdir else None
        cert_path_crt = os.path.join(confdir, "relaycraft-ca-cert.crt") if confdir else None

        path = flow.request.path.split("?")[0]

        if path in ("/cert", "/cert.pem"):
            if cert_path_pem and os.path.exists(cert_path_pem):
                with open(cert_path_pem, "rb") as file_handle:
                    content = file_handle.read()
                flow.response = Response.make(
                    200,
                    content,
                    {
                        "Content-Type": "application/x-pem-file",
                        "Content-Disposition": 'attachment; filename="relaycraft-ca-cert.pem"',
                        "Access-Control-Allow-Origin": "*",
                    },
                )
            else:
                flow.response = Response.make(404, b"Certificate not found", {"Access-Control-Allow-Origin": "*"})
            return

        if path == "/cert.crt":
            target = cert_path_crt if (cert_path_crt and os.path.exists(cert_path_crt)) else cert_path_pem
            file_name = "relaycraft-ca-cert.crt"
            if target and os.path.exists(target):
                with open(target, "rb") as file_handle:
                    content = file_handle.read()
                flow.response = Response.make(
                    200,
                    content,
                    {
                        "Content-Type": "application/x-x509-ca-cert",
                        "Content-Disposition": f'attachment; filename="{file_name}"',
                        "Access-Control-Allow-Origin": "*",
                    },
                )
            else:
                flow.response = Response.make(404, b"Certificate not found", {"Access-Control-Allow-Origin": "*"})
            return

        try:
            proxy_host = flow.request.host if flow.request.host != "relay.guide" else "127.0.0.1"
            current_port = (
                ctx.options.listen_port
                if (hasattr(ctx, "options") and hasattr(ctx.options, "listen_port"))
                else 9090
            )
            proxy_addr = f"{proxy_host}:{current_port}"
        except Exception as e:
            monitor.logger.debug(f"Failed to get proxy address, using default: {e}")
            proxy_addr = "127.0.0.1:9090"

        template_vars = build_cert_template_vars(
            flow.request.headers.get("accept-language", ""),
            flow.request.headers.get("user-agent", ""),
            proxy_addr,
        )

        try:
            import string

            assets_dir = os.path.join(os.path.dirname(__file__), "..", "assets")
            template_path = os.path.join(os.path.abspath(assets_dir), "cert_landing.html")
            with open(template_path, "r", encoding="utf-8") as file_handle:
                template_str = file_handle.read()
            html_content = string.Template(template_str).safe_substitute(template_vars)
        except Exception as template_err:
            monitor.logger.error(f"Template loading error: {template_err}")
            html_content = "<h1>RelayCraft</h1><p>Setup Guide (Template Error)</p><p><a href='/cert'>Download Certificate</a></p>"

        flow.response = Response.make(
            200,
            html_content.encode("utf-8"),
            {"Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_import_session(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        from datetime import datetime
        import time

        if flow.request.method == "POST":
            data = json.loads(flow.request.content.decode("utf-8"))

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

            for idx, item in enumerate(flows):
                if not item.get("msg_ts"):
                    if item.get("startedDateTime"):
                        try:
                            from datetime import datetime as dt

                            dt_str = item["startedDateTime"].replace("Z", "+00:00")
                            item["msg_ts"] = dt.fromisoformat(dt_str).timestamp()
                        except Exception:
                            item["msg_ts"] = time.time() + idx * 0.001
                    else:
                        item["msg_ts"] = time.time() + idx * 0.001

            session_id = monitor.db.create_session(
                name=session_name,
                description=session_description,
                metadata=session_metadata,
                is_active=False,
                created_at=session_created_at,
            )

            monitor.db.store_flows_batch(flows, session_id=session_id)
            monitor.db.update_session_flow_count(session_id)

            indices = monitor._build_session_indices(flows)
            json_str = json.dumps({"session_id": session_id, "indices": indices}, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        tb = traceback.format_exc()
        monitor.logger.error(f"Import session error: {tb}")
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_import_session_file(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        from datetime import datetime
        import os as _os

        if flow.request.method == "POST":
            req_data = json.loads(flow.request.content.decode("utf-8"))
            file_path = req_data.get("path")
            if not file_path:
                flow.response = Response.make(
                    400,
                    b'{"error": "Missing path"}',
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
                return

            try:
                file_path = _os.path.abspath(file_path)
            except Exception as e:
                monitor.logger.debug(f"Path normalization failed, using raw path: {e}")

            if not file_path.lower().endswith(".relay"):
                flow.response = Response.make(
                    400,
                    b'{"error": "Invalid file type. Only .relay allowed"}',
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
                return

            if not _os.path.exists(file_path):
                flow.response = Response.make(
                    404,
                    b'{"error": "File not found"}',
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
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
                with open(file_path, "rb") as fh:
                    parser = ijson.parse(fh)
                    for prefix, event, value in parser:
                        if prefix == "name" and event == "string":
                            session_name = value
                        elif prefix == "description" and event == "string":
                            session_description = value
                        elif prefix == "flows" or event == "start_array":
                            break
            except Exception as e:
                monitor.logger.warning(f"Fast metadata parse failed, using defaults: {e}")

            session_id = monitor.db.create_session(
                name=session_name,
                description=session_description,
                metadata=session_metadata,
                is_active=False,
                created_at=session_created_at,
            )

            def stream_import_worker() -> None:
                try:
                    with open(file_path, "rb") as fh:
                        fh.seek(0)
                        first_char = b""
                        while first_char in (b"", b" ", b"\t", b"\r", b"\n"):
                            first_char = fh.read(1)
                        fh.seek(0)

                        item_path = "item" if first_char == b"[" else "flows.item"
                        flows_stream = ijson.items(fh, item_path)

                        batch = []
                        batch_size = 500
                        count = 0

                        for item in flows_stream:
                            if not item.get("msg_ts"):
                                if item.get("startedDateTime"):
                                    try:
                                        from datetime import datetime as dt

                                        dt_str = item["startedDateTime"].replace("Z", "+00:00")
                                        item["msg_ts"] = dt.fromisoformat(dt_str).timestamp()
                                    except Exception:
                                        item["msg_ts"] = time.time() + count * 0.001
                                else:
                                    item["msg_ts"] = time.time() + count * 0.001

                            batch.append(item)
                            count += 1

                            if len(batch) >= batch_size:
                                monitor.db.store_flows_batch(batch, session_id=session_id)
                                batch = []
                                time.sleep(0.01)

                        if batch:
                            monitor.db.store_flows_batch(batch, session_id=session_id)

                        monitor.db.update_session_flow_count(session_id)

                        with monitor.db._lock:
                            conn = monitor.db._get_conn()
                            row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                            if row and row[0]:
                                md = json.loads(row[0])
                                md["status"] = "ready"
                                conn.execute(
                                    "UPDATE sessions SET metadata = ? WHERE id = ?",
                                    (json.dumps(md), session_id),
                                )
                                conn.commit()

                except Exception as e:
                    monitor.logger.error(f"Background stream import failed: {traceback.format_exc()}")
                    try:
                        with monitor.db._lock:
                            conn = monitor.db._get_conn()
                            row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                            if row and row[0]:
                                md = json.loads(row[0])
                                md["status"] = "error"
                                md["error_message"] = str(e)
                                conn.execute(
                                    "UPDATE sessions SET metadata = ? WHERE id = ?",
                                    (json.dumps(md), session_id),
                                )
                                conn.commit()
                    except Exception as inner_e:
                        monitor.logger.debug(f"Failed to update session error status: {inner_e}")

            t = threading.Thread(target=stream_import_worker, name=f"ImportWorker-{session_id}", daemon=True)
            t.start()

            json_str = json.dumps({"session_id": session_id, "status": "importing"}, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        tb = traceback.format_exc()
        monitor.logger.error(f"Import session file error: {tb}")
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_import_har(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        from datetime import datetime

        if flow.request.method == "POST":
            har_data = json.loads(flow.request.content.decode("utf-8"))
            entries = har_data.get("log", {}).get("entries", []) or []

            session_id = monitor.db.create_session(
                name=f"Imported HAR ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})",
                description="",
                metadata={"type": "har_import"},
                is_active=False,
            )

            flows, indices = monitor._normalize_har_entries(entries)
            monitor.db.store_flows_batch(flows, session_id=session_id)
            monitor.db.update_session_flow_count(session_id)

            json_str = json.dumps({"session_id": session_id, "indices": indices}, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        tb = traceback.format_exc()
        monitor.logger.error(f"Import HAR error: {tb}")
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_import_har_file(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        from datetime import datetime
        import os as _os
        import threading

        if flow.request.method == "POST":
            req_data = json.loads(flow.request.content.decode("utf-8"))
            file_path = req_data.get("path")
            if not file_path:
                flow.response = Response.make(
                    400,
                    b'{"error": "Missing path"}',
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
                return

            try:
                file_path = _os.path.abspath(file_path)
            except Exception as e:
                monitor.logger.debug(f"Path normalization failed, using raw path: {e}")

            if not file_path.lower().endswith(".har"):
                flow.response = Response.make(
                    400,
                    b'{"error": "Invalid file type. Only .har allowed"}',
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
                return

            if not _os.path.exists(file_path):
                flow.response = Response.make(
                    404,
                    b'{"error": "File not found"}',
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
                return

            session_id = monitor.db.create_session(
                name=f"Imported HAR ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})",
                description="",
                metadata={"type": "har_import", "status": "importing"},
                is_active=False,
            )

            def stream_har_worker() -> None:
                try:
                    import ijson
                    import time

                    with open(file_path, "rb") as fh:
                        entries_stream = ijson.items(fh, "log.entries.item")

                        batch = []
                        batch_size = 500

                        for entry in entries_stream:
                            batch.append(entry)

                            if len(batch) >= batch_size:
                                flows, _ = monitor._normalize_har_entries(batch)
                                monitor.db.store_flows_batch(flows, session_id=session_id)
                                batch = []
                                time.sleep(0.01)

                        if batch:
                            flows, _ = monitor._normalize_har_entries(batch)
                            monitor.db.store_flows_batch(flows, session_id=session_id)

                        monitor.db.update_session_flow_count(session_id)

                        with monitor.db._lock:
                            conn = monitor.db._get_conn()
                            row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                            if row and row[0]:
                                md = json.loads(row[0])
                                md["status"] = "ready"
                                conn.execute(
                                    "UPDATE sessions SET metadata = ? WHERE id = ?",
                                    (json.dumps(md), session_id),
                                )
                                conn.commit()

                except Exception as e:
                    monitor.logger.error(f"Background HAR stream import failed: {traceback.format_exc()}")
                    try:
                        with monitor.db._lock:
                            conn = monitor.db._get_conn()
                            row = conn.execute("SELECT metadata FROM sessions WHERE id = ?", (session_id,)).fetchone()
                            if row and row[0]:
                                md = json.loads(row[0])
                                md["status"] = "error"
                                md["error_message"] = str(e)
                                conn.execute(
                                    "UPDATE sessions SET metadata = ? WHERE id = ?",
                                    (json.dumps(md), session_id),
                                )
                                conn.commit()
                    except Exception as inner_e:
                        monitor.logger.debug(f"Failed to update session error status: {inner_e}")

            t = threading.Thread(target=stream_har_worker, name=f"ImportHARWorker-{session_id}", daemon=True)
            t.start()

            json_str = json.dumps({"session_id": session_id, "status": "importing"}, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        tb = traceback.format_exc()
        monitor.logger.error(f"Import HAR file error: {tb}")
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_search(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        keyword = data.get("keyword", "").strip()
        search_type = data.get("type", "response")
        session_id_param = data.get("session_id", None)
        case_sensitive = bool(data.get("case_sensitive", False))

        if not keyword:
            result = {"matches": [], "scanned": 0}
        elif search_type == "header":
            result = monitor.db.search_by_header(
                keyword=keyword,
                session_id=session_id_param,
                case_sensitive=case_sensitive,
            )
        else:
            if search_type not in ("response", "request"):
                search_type = "response"
            result = monitor.db.search_by_body(
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


def _handle_stats(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        stats = monitor.db.get_stats()
        json_str = json.dumps(stats, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_traffic_active(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        from ..main import is_traffic_active, set_traffic_active

        if flow.request.method == "GET":
            result = {"active": is_traffic_active()}
            json_str = json.dumps(result, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        elif flow.request.method == "POST":
            data = json.loads(flow.request.content.decode("utf-8"))
            active = data.get("active", False)
            set_traffic_active(active)
            monitor.logger.info(f"Traffic active state changed to: {active}")
            result = {"success": True, "active": active}
            json_str = json.dumps(result, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            flow.response = Response.make(405, b"Method Not Allowed", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        monitor.logger.error(f"Error handling traffic_active: {e}")
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_export_session(
    monitor: Any,
    flow: Any,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> None:
    try:
        export_path = flow.request.query.get("path")
        session_id = flow.request.query.get("session_id")

        if export_path:
            metadata = {}
            try:
                if flow.request.content:
                    body_data = json.loads(flow.request.content.decode("utf-8"))
                    metadata = body_data if isinstance(body_data, dict) else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

            monitor.db.export_to_file_iter(
                export_path,
                session_id=session_id,
                format="session",
                metadata=metadata,
            )
            flow.response = Response.make(
                200,
                json.dumps({"success": True, "path": export_path}).encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            all_flows = monitor.db.get_all_flows(session_id=session_id)
            json_str = json.dumps(all_flows, default=safe_json_default, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_export_har(
    monitor: Any,
    flow: Any,
    Response: Any,
    safe_json_default: Callable[[Any], str],
) -> None:
    try:
        export_path = flow.request.query.get("path")
        session_id = flow.request.query.get("session_id")

        if export_path:
            monitor.db.export_to_file_iter(export_path, session_id=session_id, format="har")
            flow.response = Response.make(
                200,
                json.dumps({"success": True, "path": export_path}).encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        else:
            all_flows = monitor.db.get_all_flows(session_id=session_id)
            har_data = {
                "log": {
                    "version": "1.2",
                    "creator": {"name": "RelayCraft", "version": "1.0"},
                    "entries": all_flows,
                }
            }
            json_str = json.dumps(har_data, default=safe_json_default, ensure_ascii=False)
            flow.response = Response.make(
                200,
                json_str.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_export_progress(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        total = monitor.db.get_flow_count()
        flow.response = Response.make(
            200,
            json.dumps({"total": total}).encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_breakpoints(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        action = data.get("action")
        if action == "add":
            rule = data.get("rule") or {"pattern": data.get("pattern")}
            monitor.debug_mgr.add_breakpoint(rule)
        elif action == "remove":
            monitor.debug_mgr.remove_breakpoint(data.get("id") or data.get("pattern"))
        elif action == "clear":
            with monitor.debug_mgr.lock:
                monitor.debug_mgr.breakpoints = []
        elif action == "list":
            with monitor.debug_mgr.lock:
                bp_list = monitor.debug_mgr.breakpoints
                flow.response = Response.make(
                    200,
                    json.dumps(bp_list).encode("utf-8"),
                    {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
                )
                return

        flow.response = Response.make(200, b"OK", {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_resume(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        flow_id = data.get("id")
        modifications = data.get("modifications")
        success = monitor.debug_mgr.resume_flow(flow_id, modifications)
        flow.response = Response.make(
            200 if success else 404,
            b"OK" if success else b"NOTFOUND",
            {"Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_sessions_delete_all(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        count = monitor.db.delete_all_historical_sessions()
        json_str = json.dumps({"success": True, "count": count}, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_sessions_get(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        sessions = monitor.db.list_sessions()
        json_str = json.dumps(sessions, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_sessions_post(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        session_id = monitor.db.create_session(
            name=data.get("name", "New Session"),
            description=data.get("description"),
            metadata=data.get("metadata"),
        )
        json_str = json.dumps({"id": session_id}, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_new(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        session_id = monitor.db.create_new_session_for_app_start()
        json_str = json.dumps({"id": session_id}, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_activate(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        session_id = data.get("id")
        success = monitor.db.switch_session(session_id)
        json_str = json.dumps({"success": success}, ensure_ascii=False)
        flow.response = Response.make(
            200 if success else 404,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_delete(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
        session_id = data.get("id")
        success = monitor.db.delete_session(session_id)
        json_str = json.dumps({"success": success}, ensure_ascii=False)
        flow.response = Response.make(
            200 if success else 400,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_session_clear(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8")) if flow.request.content else {}
        session_id = data.get("id")

        if session_id:
            active = monitor.db.get_active_session()
            if active and session_id != active.get("id"):
                monitor.db.delete_session(session_id)
            else:
                monitor.db.clear_session(session_id)
        else:
            monitor.db.clear_session()

        monitor.reset_seq_counter()
        flow.response = Response.make(
            200,
            b'{"success": true}',
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})


def _handle_poll(monitor: Any, flow: Any, Response: Any, safe_json_default: Callable[[Any], str]) -> None:
    try:
        query = flow.request.query
        try:
            since_param = query.get("since", "0")
            if not since_param:
                since_param = "0"
            since_ts = float(since_param)
        except ValueError:
            since_ts = 0.0

        session_id_param = query.get("session_id", None)
        db_indices = monitor.db.get_indices(session_id=session_id_param, since=since_ts)

        indices = []
        for idx in db_indices:
            indices.append(
                {
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
                }
            )

        max_msg_ts = 0
        if indices:
            max_msg_ts = max(idx.get("msg_ts", 0) for idx in indices)

        response_data = {
            "indices": indices,
            "server_ts": max_msg_ts if max_msg_ts > 0 else since_ts,
            "notifications": monitor.db.drain_notifications(),
        }
        json_str = json.dumps(response_data, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
        flow.response.status_code = 200
        flow.response.reason = b"OK"

    except Exception as e:
        tb = traceback.format_exc()
        print(f"RelayCraft Poll Error:\n{tb}")
        monitor.logger.error(f"Error in poll handler: {tb}")
        error_resp = {"error": str(e), "traceback": tb}
        try:
            safe_err = json.dumps(error_resp, default=safe_json_default)
            flow.response = Response.make(
                500,
                safe_err.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        except Exception:
            flow.response = Response.make(
                500,
                b'{"error": "Critical serialization failure"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )


def _handle_detail(monitor: Any, flow: Any, Response: Any, safe_json_default: Callable[[Any], str]) -> None:
    try:
        query = flow.request.query
        flow_id = query.get("id", "")

        if not flow_id:
            flow.response = Response.make(
                400,
                b'{"error": "Missing flow id"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        flow_data = monitor.db.get_detail(flow_id)
        if not flow_data:
            flow.response = Response.make(
                404,
                b'{"error": "Flow not found"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        json_str = json.dumps(flow_data, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )

    except Exception as e:
        tb = traceback.format_exc()
        print(f"RelayCraft Detail Error:\n{tb}")
        monitor.logger.error(f"Error in detail handler: {tb}")
        error_resp = {"error": str(e), "traceback": tb}
        try:
            safe_err = json.dumps(error_resp, default=safe_json_default)
            flow.response = Response.make(
                500,
                safe_err.encode("utf-8"),
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
        except Exception:
            flow.response = Response.make(
                500,
                b'{"error": "Critical serialization failure"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )


def _handle_sse(monitor: Any, flow: Any, Response: Any, safe_json_default: Callable[[Any], str]) -> None:
    try:
        query = flow.request.query
        flow_id = query.get("flow_id", "")
        if not flow_id:
            flow.response = Response.make(
                400,
                b'{"error": "Missing flow_id"}',
                {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            )
            return

        try:
            since_seq = int(query.get("since_seq", "0") or "0")
        except ValueError:
            since_seq = 0

        try:
            limit = int(query.get("limit", str(monitor._sse_default_limit)) or str(monitor._sse_default_limit))
        except ValueError:
            limit = monitor._sse_default_limit

        payload = monitor.get_sse_events(flow_id, since_seq=since_seq, limit=limit)
        json_str = json.dumps(payload, default=safe_json_default, ensure_ascii=False)
        flow.response = Response.make(
            200,
            json_str.encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        error_resp = {"error": str(e)}
        flow.response = Response.make(
            500,
            json.dumps(error_resp, ensure_ascii=False).encode("utf-8"),
            {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
        )


def _handle_ws_inject(monitor: Any, flow: Any, Response: Any) -> None:
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

        status, body_dict = monitor.inject_ws_frame(flow_id, frame_type, payload)
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
