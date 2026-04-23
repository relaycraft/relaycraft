"""Flow export helpers for FlowDatabase."""

import gzip
import json
import time
from typing import Dict, List


def get_all_flows(db, session_id: str = None) -> List[Dict]:
    """Get all flows for export using batch loading."""
    session_id = db._get_session_id(session_id)
    conn = db._get_conn()

    rows = conn.execute(
        """
        SELECT fd.id, fd.data, fd.request_body_ref, fd.response_body_ref
        FROM flow_details fd
        JOIN flow_indices fi ON fd.id = fi.id
        WHERE fd.session_id = ?
        ORDER BY fi.msg_ts
        """,
        (session_id,),
    ).fetchall()

    body_cache = {}
    body_rows = conn.execute(
        "SELECT flow_id, type, data FROM flow_bodies WHERE session_id = ?",
        (session_id,),
    ).fetchall()
    for row in body_rows:
        key = (row["flow_id"], row["type"])
        body_cache[key] = row["data"]

    flows = []
    for row in rows:
        try:
            flow_data = json.loads(row["data"])
            flow_id = row["id"]
            req_ref = row["request_body_ref"]
            res_ref = row["response_body_ref"]

            if req_ref and req_ref == "compressed":
                cache_key = (flow_id, "request")
                if cache_key in body_cache:
                    body = gzip.decompress(body_cache[cache_key]).decode("utf-8")
                    if flow_data.get("request", {}).get("postData"):
                        flow_data["request"]["postData"]["text"] = body

            if res_ref and res_ref == "compressed":
                cache_key = (flow_id, "response")
                if cache_key in body_cache:
                    body = gzip.decompress(body_cache[cache_key]).decode("utf-8")
                    if flow_data.get("response", {}).get("content"):
                        flow_data["response"]["content"]["text"] = body

            flows.append(flow_data)
        except Exception:
            pass

    return flows


def export_to_file_iter(
    db,
    file_path: str,
    session_id: str = None,
    format: str = "har",
    metadata: Dict = None,
    progress_callback=None,
):
    """Stream export flows to file to avoid memory issues with large sessions."""
    session_id = db._get_session_id(session_id)
    conn = db._get_conn()

    total = conn.execute(
        "SELECT COUNT(*) FROM flow_indices WHERE session_id = ?",
        (session_id,),
    ).fetchone()[0]

    if total == 0:
        with open(file_path, "w", encoding="utf-8") as f:
            if format == "har":
                json.dump(
                    {"log": {"version": "1.2", "creator": {"name": "RelayCraft", "version": "1.0"}, "entries": []}},
                    f,
                )
            else:
                inner_meta = metadata.get("metadata", {}) if metadata else {}
                session_metadata = {
                    "createdAt": inner_meta.get("createdAt", int(time.time() * 1000)),
                    "duration": inner_meta.get("duration", 0),
                    "flowCount": inner_meta.get("flowCount", 0),
                    "sizeBytes": inner_meta.get("sizeBytes", 0),
                    "clientInfo": inner_meta.get("clientInfo"),
                    "networkCondition": inner_meta.get("networkCondition"),
                    "viewState": inner_meta.get("viewState"),
                }
                session_obj = {
                    "id": metadata.get("id", "") if metadata else "",
                    "name": metadata.get("name", "") if metadata else "",
                    "description": metadata.get("description") if metadata else None,
                    "metadata": session_metadata,
                    "flows": [],
                }
                json.dump(session_obj, f, ensure_ascii=False)
        return

    body_cache = {}
    body_rows = conn.execute(
        "SELECT flow_id, type, data FROM flow_bodies WHERE session_id = ?",
        (session_id,),
    ).fetchall()
    for row in body_rows:
        key = (row["flow_id"], row["type"])
        body_cache[key] = row["data"]

    cursor = conn.execute(
        """
        SELECT fd.id, fd.data, fd.request_body_ref, fd.response_body_ref
        FROM flow_details fd
        JOIN flow_indices fi ON fd.id = fi.id
        WHERE fd.session_id = ?
        ORDER BY fi.msg_ts
        """,
        (session_id,),
    )

    with open(file_path, "w", encoding="utf-8") as f:
        if format == "har":
            f.write('{"log":{"version":"1.2","creator":{"name":"RelayCraft","version":"1.0"},"entries":[')
        else:
            inner_meta = metadata.get("metadata", {}) if metadata else {}
            session_metadata = {
                "createdAt": inner_meta.get("createdAt", int(time.time() * 1000)),
                "duration": inner_meta.get("duration", 0),
                "flowCount": inner_meta.get("flowCount", 0),
                "sizeBytes": inner_meta.get("sizeBytes", 0),
                "clientInfo": inner_meta.get("clientInfo"),
                "networkCondition": inner_meta.get("networkCondition"),
                "viewState": inner_meta.get("viewState"),
            }
            session_obj = {
                "id": metadata.get("id", "") if metadata else "",
                "name": metadata.get("name", "") if metadata else "",
                "description": metadata.get("description") if metadata else None,
                "metadata": session_metadata,
            }
            header = json.dumps(session_obj, ensure_ascii=False)
            if header.endswith("}"):
                header = header[:-1] + ',"flows":['
            f.write(header)

        first = True
        current = 0

        for row in cursor:
            try:
                flow_data = json.loads(row["data"])
                flow_id = row["id"]
                req_ref = row["request_body_ref"]
                res_ref = row["response_body_ref"]

                if req_ref and req_ref == "compressed":
                    cache_key = (flow_id, "request")
                    if cache_key in body_cache:
                        body = gzip.decompress(body_cache[cache_key]).decode("utf-8")
                        if flow_data.get("request", {}).get("postData"):
                            flow_data["request"]["postData"]["text"] = body

                if res_ref and res_ref == "compressed":
                    cache_key = (flow_id, "response")
                    if cache_key in body_cache:
                        body = gzip.decompress(body_cache[cache_key]).decode("utf-8")
                        if flow_data.get("response", {}).get("content"):
                            flow_data["response"]["content"]["text"] = body

                if not first:
                    f.write(",")
                first = False

                f.write(json.dumps(flow_data, ensure_ascii=False))
                current += 1

                if progress_callback and current % 1000 == 0:
                    progress_callback(current, total)
            except Exception:
                pass

        if format == "har":
            f.write("]}}")
        else:
            f.write("]}")

    if progress_callback:
        progress_callback(total, total)
