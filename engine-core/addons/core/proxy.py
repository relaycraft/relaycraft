import os
from typing import Optional, Tuple, Any
from mitmproxy import ctx
from .utils import setup_logging

class ProxyManager:
    def __init__(self):
        self.logger = setup_logging()
        self.upstream_proxy: Optional[Tuple[str, Tuple[str, int]]] = None
        
        # Parse upstream proxy from environment variable for robustness
        proxy_url = os.environ.get("RELAYCRAFT_UPSTREAM_PROXY", "")
        if not proxy_url:
            # Fallback to parsing from options if direct env var is missing
            try:
                mode = getattr(ctx.options, "mode", [])
                if mode and mode[0].startswith("upstream:"):
                    proxy_url = mode[0][9:]
            except:
                pass
                
        if proxy_url:
            try:
                # Handle cases without scheme (default to http)
                if "://" not in proxy_url:
                    proxy_url = "http://" + proxy_url
                
                from urllib.parse import urlparse
                parsed = urlparse(proxy_url)
                
                if parsed.hostname and parsed.port:
                    # mitmproxy 10.x next_hop_proxy requires (type, (host, port))
                    # type: "http", "https", "socks4", "socks5", "socks5-auth"
                    scheme = parsed.scheme if parsed.scheme else "http"
                    if "socks5" in scheme:
                        scheme = "socks5"
                    elif "socks4" in scheme:
                        scheme = "socks4"
                    
                    self.upstream_proxy = (scheme, (parsed.hostname, parsed.port))
                    
                    # Store credentials in the expected mitmproxy option
                    if parsed.username and parsed.password:
                        ctx.options.proxy_auth = f"{parsed.username}:{parsed.password}"
                    
                    self.logger.info(f"ProxyManager: Upstream target -> {scheme}://{parsed.hostname}:{parsed.port}")
                else:
                    self.logger.warn(f"ProxyManager: Invalid proxy URL (missing hostname or port): {proxy_url}")
            except Exception as e:
                self.logger.error(f"ProxyManager: failed to parse upstream proxy: {e}")
