import os
import sys
import tempfile
import importlib.util
import traceback
import asyncio
import atexit
import shutil
import time
from pathlib import Path

# Add current directory to sys.path to allow package imports
sys.path.append(str(Path(__file__).parent))

from typing import List, Any, Optional
from core import CoreAddon
from injector import inject_tracking


def _safe_print(message: str) -> None:
    """
    Print text safely across different terminal encodings (e.g. GBK on Windows).
    Falls back to escaped output when the stream cannot encode Unicode characters.
    """
    try:
        print(message, flush=True)
    except UnicodeEncodeError:
        stream = getattr(sys, "stdout", None)
        encoding = (getattr(stream, "encoding", None) or "utf-8")
        safe_message = message.encode(encoding, errors="backslashreplace").decode(
            encoding, errors="replace"
        )
        print(safe_message, flush=True)


def _setup_asyncio_exception_handler():
    """
    Setup global asyncio exception handler to suppress harmless Windows ProactorEventLoop errors.
    These errors occur when connections are closed abruptly on Windows.
    """
    def handle_exception(loop, context):
        # Get the exception/message
        exception = context.get('exception')
        message = context.get('message', '')

        # List of harmless error patterns to suppress
        suppress_patterns = [
            'proactor_events.py',
            '_call_connection_lost',
            'Unhandled error in task',
            'Event loop is closed',
        ]

        # Check if this is a harmless error
        is_harmless = any(pattern in str(message) for pattern in suppress_patterns)
        if exception:
            exception_str = ''.join(traceback.format_exception(type(exception), exception, exception.__traceback__))
            is_harmless = is_harmless or any(pattern in exception_str for pattern in suppress_patterns)

        if is_harmless:
            # Silently ignore harmless Windows asyncio errors
            return

        # Log other errors
        if exception:
            _safe_print(f"[RELAYCRAFT][WARN] Asyncio error: {exception}")
        else:
            _safe_print(f"[RELAYCRAFT][WARN] Asyncio warning: {message}")

    # Set the exception handler
    try:
        loop = asyncio.get_event_loop()
        loop.set_exception_handler(handle_exception)
    except RuntimeError:
        # No event loop yet, will be set when loop is created
        def on_loop_created():
            try:
                asyncio.get_event_loop().set_exception_handler(handle_exception)
            except Exception:
                pass
        # Schedule for when loop is created
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy() if sys.platform == 'win32' else asyncio.DefaultEventLoopPolicy())


# Setup asyncio exception handler early
_setup_asyncio_exception_handler()

# Global temp directory for preprocessed scripts
_preprocessed_dir = None


def _cleanup_preprocessed_dir() -> None:
    """Remove current process preprocessed script temp directory."""
    global _preprocessed_dir
    if not _preprocessed_dir:
        return
    try:
        if os.path.isdir(_preprocessed_dir):
            shutil.rmtree(_preprocessed_dir, ignore_errors=True)
    except Exception:
        # Never let cleanup errors affect engine shutdown.
        pass
    finally:
        _preprocessed_dir = None


def _cleanup_stale_preprocessed_dirs(max_age_hours: int = 24) -> None:
    """Remove stale relaycraft temp dirs left by previous abnormal exits."""
    try:
        temp_root = Path(tempfile.gettempdir())
        cutoff = time.time() - max_age_hours * 3600
        for p in temp_root.glob("relaycraft_scripts_*"):
            if not p.is_dir():
                continue
            try:
                if p.stat().st_mtime < cutoff:
                    shutil.rmtree(p, ignore_errors=True)
            except Exception:
                # Ignore per-path errors and continue cleanup.
                continue
    except Exception:
        pass


# Best-effort cleanup: remove stale leftovers on startup, and current temp dir on exit.
_cleanup_stale_preprocessed_dirs(max_age_hours=24)
atexit.register(_cleanup_preprocessed_dir)

def _log_message(level: str, message: str) -> None:
    """
    Robust logging helper that works in all contexts.
    Tries mitmproxy ctx.log first, falls back to print with flush.
    """
    try:
        from mitmproxy import ctx
        if hasattr(ctx, 'log') and hasattr(ctx.log, level):
            getattr(ctx.log, level)(message)
            return
    except Exception:
        pass
    # Fallback: print with flush for immediate output
    _safe_print(f"[RELAYCRAFT][{level.upper()}] {message}")

def _preprocess_and_load_script(source_path: str) -> Optional[Any]:
    """
    Preprocess a script by injecting tracking code and load it as a module.
    Returns the loaded module object, or None on failure.
    Logs detailed error information for debugging.
    """
    global _preprocessed_dir

    script_name = Path(source_path).name if source_path else "unknown"

    try:
        source = Path(source_path)
        if not source.exists():
            _log_message("error", f"Script file not found: {source_path}")
            return None

        # Check if file is readable
        if not os.access(source, os.R_OK):
            _log_message("error", f"Script file not readable (permission denied): {source_path}")
            return None

        # Create temp directory if not exists
        if _preprocessed_dir is None:
            _preprocessed_dir = tempfile.mkdtemp(prefix="relaycraft_scripts_")
            _log_message("info", f"Created temp directory for scripts: {_preprocessed_dir}")

        # Read original source
        try:
            with open(source, "r", encoding="utf-8") as f:
                original_code = f.read()
        except UnicodeDecodeError as e:
            _log_message("error", f"Script encoding error (expected UTF-8): {source_path}: {e}")
            return None
        except IOError as e:
            _log_message("error", f"Failed to read script: {source_path}: {e}")
            return None

        # Check for empty script
        if not original_code.strip():
            _log_message("warn", f"Script is empty, skipping: {source_path}")
            return None

        # Inject tracking code (with path for better error messages)
        modified_code = inject_tracking(original_code, script_path=source_path)

        # Write to temp file
        temp_path = Path(_preprocessed_dir) / source.name
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                f.write(modified_code)
        except IOError as e:
            _log_message("error", f"Failed to write preprocessed script: {temp_path}: {e}")
            return None

        # Load as module
        module_name = source.stem
        # Add unique suffix to avoid module name conflicts when reloading
        if module_name in sys.modules:
            import time
            module_name = f"{module_name}_{int(time.time() * 1000)}"

        spec = importlib.util.spec_from_file_location(module_name, temp_path)
        if spec is None or spec.loader is None:
            _log_message("error", f"Failed to create module spec: {source_path}")
            return None

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module

        # Execute the module - this is where script errors will surface
        try:
            spec.loader.exec_module(module)
        except SyntaxError as e:
            _log_message("error", f"Syntax error in script {script_name}: {e}")
            return None
        except Exception as e:
            _log_message("error", f"Error executing script {script_name}: {type(e).__name__}: {e}")
            # Log traceback for debugging
            _log_message("debug", f"Traceback: {traceback.format_exc()}")
            return None

        # Verify the module has at least one hook function
        # Check both module-level functions and class instances in 'addons' list
        hook_functions = ['request', 'response', 'error', 'websocket_message']
        has_hook = any(hasattr(module, hook) for hook in hook_functions)

        # Also check if there's an 'addons' list with class instances that have hook methods
        if not has_hook and hasattr(module, 'addons'):
            addons_list = getattr(module, 'addons', [])
            if isinstance(addons_list, list):
                for addon_instance in addons_list:
                    if any(hasattr(addon_instance, hook) for hook in hook_functions):
                        has_hook = True
                        break

        if not has_hook:
            _log_message("warn", f"Script {script_name} has no hook functions (request/response/error/websocket_message)")

        return module
    except Exception as e:
        _log_message("error", f"Unexpected error loading script {script_name}: {type(e).__name__}: {e}")
        _log_message("debug", f"Traceback: {traceback.format_exc()}")
        return None

# Build addons list
addons: List[Any] = [
    CoreAddon()
]

# Load user scripts from environment variable (Passed by Rust)
user_scripts_env = os.environ.get("RELAYCRAFT_USER_SCRIPTS", "")
loaded_count = 0
failed_count = 0

if user_scripts_env:
    script_paths = [p for p in user_scripts_env.split(";") if p.strip()]
    if script_paths:
        _log_message("info", f"Loading {len(script_paths)} user script(s)...")

    for path_str in script_paths:
        path_str = path_str.strip()
        if not path_str:
            continue

        module = _preprocess_and_load_script(path_str)
        if module is not None:
            addons.append(module)
            loaded_count += 1
            _log_message("info", f"Loaded user script: {Path(path_str).name}")
        else:
            failed_count += 1

    if loaded_count > 0 or failed_count > 0:
        _log_message("info", f"Script loading complete: {loaded_count} loaded, {failed_count} failed")
