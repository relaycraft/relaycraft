import fnmatch
from typing import Any, Dict, List, Optional
from ..utils import setup_logging


class GatewayRouter:
    def __init__(self):
        self.logger = setup_logging()

    def match(
        self,
        routes: List[Dict[str, Any]],
        host: str,
        path: str,
        method: str,
        headers: Any,
    ) -> Optional[Dict[str, Any]]:
        for route in routes:
            if not route.get("enabled", True):
                continue

            match_cfg = route.get("match", {})
            if not self._match_path(match_cfg.get("path", ""), path):
                continue

            if match_cfg.get("host"):
                if host != match_cfg["host"]:
                    continue

            required_methods = match_cfg.get("methods", [])
            if required_methods and method.upper() not in (m.upper() for m in required_methods):
                continue

            required_headers = match_cfg.get("headers", [])
            if required_headers and not self._match_headers(required_headers, headers):
                continue

            return route

        return None

    @staticmethod
    def _match_path(pattern: str, path: str) -> bool:
        if not pattern:
            return True
        if pattern.endswith("*"):
            return path.startswith(pattern[:-1])
        return fnmatch.fnmatch(path, pattern)

    @staticmethod
    def _match_headers(
        required: List[Dict[str, str]], headers: Any
    ) -> bool:
        for h in required:
            name = h.get("name", "")
            value = h.get("value", "")
            if not name:
                continue
            actual = headers.get(name)
            if actual != value:
                return False
        return True
