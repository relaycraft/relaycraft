import time
import uuid
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse


def safe_decode(value: Any) -> str:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.decode("latin-1")
    return str(value)


def headers_to_har(headers: Any) -> List[Dict[str, str]]:
    result = []
    for name, value in headers.fields:
        result.append({"name": safe_decode(name), "value": safe_decode(value)})
    return result


def cookies_to_har(cookies: Any) -> List[Dict[str, Any]]:
    result = []
    for name, value in cookies.fields:
        result.append({"name": safe_decode(name), "value": safe_decode(value)})
    return result


def query_to_har(query: Any) -> List[Dict[str, str]]:
    result = []
    for name, value in query.fields:
        result.append({"name": safe_decode(name), "value": safe_decode(value)})
    return result


def normalize_har_entries(entries: list) -> Tuple[list, list]:
    flows = []
    indices = []
    base_ts = time.time()

    for idx, entry in enumerate(entries):
        if not entry:
            continue

        flow_id = str(uuid.uuid4())
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

        indices.append(
            {
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
            }
        )

    return flows, indices
