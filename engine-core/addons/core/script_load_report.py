"""
In-memory report of user script load results for the current engine process.
Populated at addon import time (entry.py); read via GET /_relay/scripts/load_status.
"""

from typing import Any, Dict, List

_loaded: List[str] = []
_failed: List[Dict[str, str]] = []


def reset() -> None:
    _loaded.clear()
    _failed.clear()


def record_loaded(name: str) -> None:
    _loaded.append(name)


def record_failed(path: str, name: str, error: str) -> None:
    _failed.append(
        {
            "path": path,
            "name": name,
            "error": (error or "Unknown error")[:500],
        }
    )


def get_report() -> Dict[str, Any]:
    return {
        "loaded": list(_loaded),
        "failed": list(_failed),
        "loaded_count": len(_loaded),
        "failed_count": len(_failed),
    }
