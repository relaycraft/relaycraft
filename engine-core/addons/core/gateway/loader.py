import os
import yaml
from pathlib import Path
from typing import List, Dict, Any, Optional
from ..utils import setup_logging


class GatewayLoader:
    def __init__(self):
        self.logger = setup_logging()
        self.routes: List[Dict[str, Any]] = []
        self._last_dir: Optional[str] = None
        self._last_mtime: float = 0.0
        self._last_count: int = 0

        data_dir = os.environ.get("RELAYCRAFT_DATA_DIR")
        if data_dir:
            self._routes_dir = Path(data_dir) / "gateway" / "routes"
        else:
            self._routes_dir = None

    def _should_reload(self) -> bool:
        if self._routes_dir is None or not self._routes_dir.exists():
            return self._last_count != 0

        dir_str = str(self._routes_dir)
        try:
            stat = self._routes_dir.stat()
            mtime = stat.st_mtime

            count = 0
            for _ in self._routes_dir.rglob("*.yaml"):
                count += 1

            changed = (
                dir_str != self._last_dir
                or mtime != self._last_mtime
                or count != self._last_count
            )
            if changed:
                self._last_dir = dir_str
                self._last_mtime = mtime
                self._last_count = count
            return changed
        except Exception:
            return self._last_count != 0

    def load_routes(self) -> List[Dict[str, Any]]:
        if not self._should_reload():
            return self.routes

        self.logger.debug("[Gateway] reloading routes")
        routes: List[Dict[str, Any]] = []

        if self._routes_dir is not None and self._routes_dir.exists():
            for yaml_file in self._routes_dir.rglob("*.yaml"):
                try:
                    content = yaml_file.read_text(encoding="utf-8")
                    doc = yaml.safe_load(content)
                    if isinstance(doc, dict) and "route" in doc:
                        route = doc["route"]
                        if isinstance(route, dict):
                            route.setdefault("enabled", True)
                            route.setdefault("priority", 0)
                            if "match" in route:
                                match = route["match"]
                                match.setdefault("headers", [])
                                match.setdefault("methods", [])
                            if "upstream" in route:
                                upstream = route["upstream"]
                                upstream.setdefault("stripPrefix", "")
                                upstream.setdefault("timeoutMs", 30000)
                            routes.append(route)
                except Exception as e:
                    self.logger.debug(f"[Gateway] skip {yaml_file}: {e}")

        routes.sort(
            key=lambda r: (-r.get("priority", 0), -len(r.get("match", {}).get("path", "")))
        )
        self.routes = routes
        return self.routes
