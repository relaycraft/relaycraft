import os
import re
from pathlib import Path
from typing import Dict, Optional

import yaml


class EnvResolver:
    _VAR_PATTERN = re.compile(r"\$\{(\w+)(?::-([^}]*))?\}")

    def __init__(self):
        self._profile_vars: Dict[str, str] = {}
        self._active_profile = "default"
        data_dir = os.environ.get("RELAYCRAFT_DATA_DIR")
        if data_dir:
            self._env_dir = Path(data_dir) / "gateway" / "env"
        else:
            self._env_dir = None

    def set_profile(self, profile: str):
        self._active_profile = profile
        self._profile_vars.clear()
        if self._env_dir is not None:
            profile_path = self._env_dir / f"{profile}.yaml"
            if profile_path.exists():
                try:
                    content = profile_path.read_text(encoding="utf-8")
                    vars_dict = yaml.safe_load(content)
                    if isinstance(vars_dict, dict):
                        self._profile_vars = {str(k): str(v) for k, v in vars_dict.items() if v is not None}
                except Exception:
                    pass

    def resolve(self, url: str) -> str:
        def _replace(match: re.Match) -> str:
            name = match.group(1)
            default = match.group(2)
            value = self._profile_vars.get(name) or os.environ.get(name)
            if value:
                return value
            if default is not None:
                return default
            raise KeyError(f"env variable ${{{name}}} is not set (profile={self._active_profile})")

        try:
            return self._VAR_PATTERN.sub(_replace, url)
        except KeyError:
            raise
