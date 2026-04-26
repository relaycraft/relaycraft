import logging
import sys
from pathlib import Path

class RelayCraftLogger:
    """Unified logger that adapts to mitmproxy or standalone environment"""
    def __init__(self, name: str = "relaycraft"):
        self.name = name
        self._fallback_logger = logging.getLogger(name)

    def _get_log_func(self, level: str):
        # Use ctx.log if inside mitmproxy addon
        try:
            from mitmproxy import ctx
            if hasattr(ctx, "log"):
                return getattr(ctx.log, level)
        except (ImportError, RuntimeError):
            pass
        return getattr(self._fallback_logger, level)

    def info(self, msg: str):
        self._get_log_func("info")(f"{msg}")

    def warn(self, msg: str):
        # mitmproxy uses .warn, logging uses .warning/ .warn
        func = self._get_log_func("warn")
        func(f"{msg}")

    def warning(self, msg: str):
        self.warn(msg)

    def error(self, msg: str):
        self._get_log_func("error")(f"{msg}")

    def debug(self, msg: str):
        self._get_log_func("debug")(f"{msg}")

def setup_logging(name: str = "relaycraft") -> RelayCraftLogger:
    """Create a named RelayCraftLogger. Root logger setup is idempotent."""
    root = logging.getLogger()
    if root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

    if not root.handlers and not any(arg.startswith("mitm") for arg in sys.argv):
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
        handler.setFormatter(formatter)
        root.addHandler(handler)

    logging.getLogger("mitmproxy").setLevel(logging.WARNING)

    return RelayCraftLogger(name)

def get_mime_type(file_path: str) -> str:
    """Detect MIME type from file extension"""
    ext = Path(file_path).suffix.lower()
    mime_types = {
        # Text
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
        # Images
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        # Fonts
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.eot': 'application/vnd.ms-fontobject',
        # Media
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        # Documents
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
    }
    return mime_types.get(ext, 'application/octet-stream')
