import logging
import sys
from pathlib import Path

def setup_logging():
    # Configure root logger
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    
    # Clear existing handlers to avoid duplicates/mitmproxy interference
    if root.handlers:
        for handler in root.handlers:
            root.removeHandler(handler)
            
    # Stdout Handler (Formatted)
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
    handler.setFormatter(formatter)
    root.addHandler(handler)
    
    # Reduce noise from mitmproxy's own logging
    logging.getLogger("mitmproxy").setLevel(logging.WARNING)
    
    logger = logging.getLogger("relaycraft")
    logger.setLevel(logging.INFO)
    logger.info("RelayCraft engine logging initialized")
    return logger

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
