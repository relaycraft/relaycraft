import json
import traceback
from typing import Any


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
