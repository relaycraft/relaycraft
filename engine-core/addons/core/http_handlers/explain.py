import json
import os
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlparse

from .errors import CORS_HEADERS, JSON_HEADERS


def _build_mock_flow(method: str, url: str) -> Any:
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    headers = SimpleNamespace()
    headers.get = lambda key, default=None: None

    query = SimpleNamespace()
    query.get = lambda key, default=None: None

    request = SimpleNamespace(
        pretty_url=url,
        url=url,
        host=host,
        port=port,
        method=method.upper(),
        headers=headers,
        query=query,
    )

    client_conn = SimpleNamespace(
        address=(host, port),
    )

    return SimpleNamespace(
        request=request,
        client_conn=client_conn,
        metadata={},
        response=None,
        error=None,
    )


def _handle_explain_path(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        data = json.loads(flow.request.content.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        flow.response = Response.make(400, b"Invalid JSON body", CORS_HEADERS)
        return

    method = data.get("method", "GET")
    url = data.get("url", "")
    entry = data.get("entry", "forward")

    if not url:
        flow.response = Response.make(400, b"Missing url field", CORS_HEADERS)
        return

    mock_flow = _build_mock_flow(method, url)

    import mitmproxy.ctx as mctx

    main = getattr(mctx.master, "relaycraft_main", None) if hasattr(mctx, "master") else None

    if main is None:
        result = {
            "entry": entry,
            "rules_applied": [],
            "outbound": {"via_upstream_proxy": False, "proxy_url": None},
            "outcome": "forwarded",
        }
    else:
        proxy_mgr = main.proxy_mgr
        upstream_proxy = proxy_mgr.upstream_proxy
        proxy_url = None
        if upstream_proxy is not None:
            proxy_url = "{}://{}:{}".format(
                upstream_proxy[0], upstream_proxy[1][0], upstream_proxy[1][1]
            )

        gateway_info = {}
        if entry == "gateway":
            try:
                from ..gateway.loader import GatewayLoader
                from ..gateway.router import GatewayRouter

                loader = GatewayLoader()
                g_routes = loader.load_routes()
                router = GatewayRouter()
                gw_match = router.match(
                    g_routes,
                    mock_flow.request.host,
                    mock_flow.request.path,
                    mock_flow.request.method,
                    mock_flow.request.headers,
                )
                if gw_match is not None:
                    gateway_info = {
                        "gateway_route_id": gw_match.get("id"),
                        "gateway_route_name": gw_match.get("name"),
                        "env_profile": os.environ.get(
                            "RELAYCRAFT_GATEWAY_ACTIVE_PROFILE", "default"
                        ),
                    }

                    # Rewrite mock URL so Rules match the post-Gateway target.
                    from ..gateway.env_resolver import EnvResolver
                    import urllib.parse as urlparse_mod

                    resolver = EnvResolver()
                    resolver.set_profile(
                        os.environ.get("RELAYCRAFT_GATEWAY_ACTIVE_PROFILE", "default")
                    )
                    upstream_url = gw_match.get("upstream", {}).get("url", "")
                    strip_prefix = gw_match.get("upstream", {}).get("stripPrefix", "")
                    try:
                        resolved = resolver.resolve(upstream_url)
                        parsed = urlparse_mod.urlparse(resolved)
                        mock_flow.request.host = parsed.hostname or mock_flow.request.host
                        mock_flow.request.port = parsed.port or (443 if parsed.scheme == "https" else 80)
                        new_path = mock_flow.request.path
                        if strip_prefix and new_path.startswith(strip_prefix):
                            new_path = new_path[len(strip_prefix):]
                        if parsed.path and parsed.path != "/":
                            new_path = parsed.path.rstrip("/") + new_path
                        if not new_path.startswith("/"):
                            new_path = "/" + new_path
                        mock_flow.request.path = new_path or "/"
                    except Exception:
                        pass
            except Exception:
                pass

        # Simulate rule matching only (no execution).
        try:
            main.rule_engine.handle_request(mock_flow, match_only=True)
        except Exception:
            pass

        hits = mock_flow.metadata.get("_relaycraft_hits", [])
        rules_applied = []
        for h in hits:
            t = h.get("type", "")
            if t in (
                "map_local",
                "map_remote",
                "rewrite_header",
                "rewrite_body",
                "throttle",
                "block_request",
            ):
                rules_applied.append(
                    {"id": h.get("id", ""), "type": t, "name": h.get("name", "")}
                )

        terminated = mock_flow.metadata.get("_relaycraft_terminated", False)
        if terminated:
            if any(h.get("type") == "block_request" for h in hits):
                outcome = "blocked"
            elif any(h.get("type") == "map_local" for h in hits):
                outcome = "mapped_local"
            else:
                outcome = "mocked"
        else:
            outcome = "forwarded"

        result = {
            "entry": entry,
            "rules_applied": rules_applied,
            "outbound": {
                "via_upstream_proxy": upstream_proxy is not None,
                "proxy_url": proxy_url,
            },
            "outcome": outcome,
            **gateway_info,
        }

    json_str = json.dumps(result, ensure_ascii=False)
    flow.response = Response.make(200, json_str.encode("utf-8"), JSON_HEADERS)
