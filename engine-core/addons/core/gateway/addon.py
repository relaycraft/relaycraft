import time
from typing import Optional
from mitmproxy import http
from mitmproxy.proxy import mode_specs
from .loader import GatewayLoader
from .router import GatewayRouter
from .env_resolver import EnvResolver
from ..utils import setup_logging


class GatewayAddon:
    def __init__(self):
        self.logger = setup_logging()
        self.loader = GatewayLoader()
        self.router = GatewayRouter()
        self.env_resolver = EnvResolver()

    def load(self, _loader):
        import os
        profile = os.environ.get("RELAYCRAFT_GATEWAY_ACTIVE_PROFILE", "default")
        self.env_resolver.set_profile(profile)
        self.loader.load_routes()

    def request(self, flow: http.HTTPFlow) -> None:
        if not isinstance(flow.client_conn.proxy_mode, mode_specs.ReverseMode):
            return

        routes = self.loader.load_routes()
        req = flow.request
        matched = self.router.match(
            routes,
            req.host,
            req.path,
            req.method,
            req.headers,
        )

        if matched is None:
            flow.response = http.Response.make(404, b"No gateway route matched")
            self._tag_gateway_path(flow, matched, "404")
            return

        upstream_cfg = matched.get("upstream", {})
        upstream_url = upstream_cfg.get("url", "")
        strip_prefix = upstream_cfg.get("strip_prefix", "")

        try:
            resolved = self.env_resolver.resolve(upstream_url)
        except KeyError as e:
            flow.response = http.Response.make(
                502, f"Bad gateway: {e}".encode()
            )
            self._tag_gateway_path(flow, matched, "error")
            return

        import urllib.parse
        parsed = urllib.parse.urlparse(resolved)
        req.host = parsed.hostname or req.host
        req.port = parsed.port or (443 if parsed.scheme == "https" else 80)
        req.scheme = parsed.scheme or "http"

        if strip_prefix:
            new_path = req.path
            if new_path.startswith(strip_prefix):
                new_path = new_path[len(strip_prefix):]
                if not new_path.startswith("/"):
                    new_path = "/" + new_path
            req.path = new_path or "/"

        self._tag_gateway_path(flow, matched, "forwarded")

    def _tag_gateway_path(self, flow: http.HTTPFlow, matched_route: Optional[dict], outcome: str):
        try:
            hits = flow.metadata.get("_relaycraft_hits", [])
            rules_applied = []
            for h in hits:
                t = h.get("type", "")
                if t in ("map_local", "map_remote", "rewrite_header", "rewrite_body", "throttle", "block_request"):
                    rules_applied.append({"id": h.get("id", ""), "type": t, "name": h.get("name", "")})

            gateway_route_id = matched_route.get("id") if matched_route else None
            gateway_route_name = matched_route.get("name") if matched_route else None
            resolved_upstream = None
            if matched_route:
                upstream_cfg = matched_route.get("upstream", {})
                raw_url = upstream_cfg.get("url", "")
                try:
                    resolved_upstream = self.env_resolver.resolve(raw_url)
                except Exception:
                    resolved_upstream = raw_url

            flow.metadata["_relaycraft_gateway"] = {
                "route_id": gateway_route_id,
                "route_name": gateway_route_name,
                "env_profile": self.env_resolver._active_profile,
                "resolved_upstream": resolved_upstream,
            }
        except Exception:
            pass
