"""Capture scope — per-process traffic filtering (engine side).

Config shape: ``{"include": [str], "exclude": [str]}``. Each entry is either
a PID (all digits -> exact pid match) or a process-name pattern: entries
containing ``*`` or ``?`` are matched case-insensitively with fnmatch,
anything else is a case-insensitive substring of the process name.

Semantics (aligned with mitmproxy ``--mode local:`` so a future engine can
reuse it):

- Both lists empty -> scope disabled, everything is captured.
- include non-empty -> in scope iff the process is known AND matches some
  include AND matches no exclude. Unknown processes (remote devices,
  unresolved) are out of scope.
- include empty, exclude non-empty -> in scope iff the process matches no
  exclude (unknown processes stay in scope).

The initial value is read from the ``RELAYCRAFT_CAPTURE_SCOPE`` env var
(JSON of the same shape) at import time; the Rust host sets it at spawn.
"""

import fnmatch
import json
import os
import threading
from typing import Any, Dict, List, Optional

from .utils import setup_logging

_log = setup_logging("relaycraft.capture_scope")

ENV_VAR = "RELAYCRAFT_CAPTURE_SCOPE"

_lock = threading.Lock()
_config: Dict[str, List[str]] = {"include": [], "exclude": []}


def _normalize_list(value: Any, field: str) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"capture scope '{field}' must be a list of strings")
    out: List[str] = []
    for item in value:
        text = str(item).strip()
        if text:
            out.append(text)
    return out


def normalize(payload: Any) -> Dict[str, List[str]]:
    """Validate and normalize a capture-scope payload.

    Raises ValueError on invalid payloads; never partially applies.
    """
    if not isinstance(payload, dict):
        raise ValueError("capture scope payload must be an object")
    return {
        "include": _normalize_list(payload.get("include"), "include"),
        "exclude": _normalize_list(payload.get("exclude"), "exclude"),
    }


def set_config(payload: Any) -> Dict[str, List[str]]:
    """Validate, normalize and apply a new capture scope."""
    norm = normalize(payload)
    with _lock:
        _config["include"] = norm["include"]
        _config["exclude"] = norm["exclude"]
    return get()


def get() -> Dict[str, List[str]]:
    """Return the current capture scope (a copy)."""
    with _lock:
        return {"include": list(_config["include"]), "exclude": list(_config["exclude"])}


def is_enabled() -> bool:
    cfg = get()
    return bool(cfg["include"] or cfg["exclude"])


def _entry_matches(entry: str, process_info: Dict[str, Any]) -> bool:
    try:
        if entry.isdigit():
            pid = process_info.get("pid")
            return pid is not None and int(entry) == int(pid)
        name = str(process_info.get("name") or "")
        lowered = name.lower()
        entry_lower = entry.lower()
        if "*" in entry or "?" in entry:
            return fnmatch.fnmatchcase(lowered, entry_lower)
        return entry_lower in lowered
    except Exception:
        return False


def is_in_scope(process_info: Optional[Dict[str, Any]]) -> bool:
    """Whether a flow from ``process_info`` should be captured.

    ``process_info`` is a ProcessInfo dict (``{"pid", "name", "path"}``) or
    None when the client process is unknown (remote device / unresolved).
    Fails open (returns True) on unexpected errors so traffic is never lost
    silently.
    """
    try:
        cfg = get()
        include = cfg["include"]
        exclude = cfg["exclude"]
        if not include and not exclude:
            return True
        if process_info is None:
            return not include
        excluded = any(_entry_matches(e, process_info) for e in exclude)
        if include:
            included = any(_entry_matches(e, process_info) for e in include)
            return included and not excluded
        return not excluded
    except Exception as e:
        _log.debug(f"capture scope check failed, treating as in-scope: {e}")
        return True


def init_from_env() -> None:
    """Load the initial capture scope from RELAYCRAFT_CAPTURE_SCOPE."""
    raw = os.environ.get(ENV_VAR)
    if not raw:
        return
    try:
        set_config(json.loads(raw))
    except Exception as e:
        _log.warning(f"Invalid {ENV_VAR}, capture scope disabled: {e}")


init_from_env()
