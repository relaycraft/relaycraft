"""Body storage helpers for flow persistence."""

import gzip
from pathlib import Path
from typing import Dict, Optional, Tuple


def process_body(
    body_dir: str,
    flow_id: str,
    session_id: str,
    body: str,
    body_type: str,
    config: object,
) -> Tuple[Optional[bytes], str]:
    """
    Process body for storage.

    Returns: (compressed_data_or_None, storage_ref)
    """
    if not body:
        return None, "inline"

    size = len(body.encode("utf-8"))

    # Too large - skip
    if size > config.MAX_PERSIST_SIZE:
        return None, f"skipped:{size}"

    # Small - inline
    if size < config.COMPRESS_THRESHOLD:
        return None, "inline"

    # Medium - compress to BLOB
    if size < config.FILE_THRESHOLD:
        compressed = gzip.compress(body.encode("utf-8"))
        return compressed, "compressed"

    # Large - store as file
    filename = f"{flow_id}_{body_type[0]}.dat"
    session_dir = Path(body_dir) / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    filepath = session_dir / filename
    with gzip.open(filepath, "wt", encoding="utf-8") as f:
        f.write(body)

    return None, f"file:{filename}"


def get_placeholder(ref: str) -> str:
    """Get placeholder text for non-inline body."""
    if ref == "compressed":
        return "__COMPRESSED__"
    if ref.startswith("file:"):
        return "__FILE__"
    if ref.startswith("skipped:"):
        size = int(ref.split(":")[1])
        return f"<Body too large: {size // 1024 // 1024}MB>"
    return "__UNKNOWN__"


def load_body(
    conn,
    body_dir: str,
    flow_id: str,
    session_id: str,
    ref: str,
    body_type: str,
    compressed_bodies: Dict = None,
) -> Optional[str]:
    """Load body from inline/compressed/file storage."""
    if ref == "inline":
        return None

    if ref == "compressed":
        # Use pre-loaded bodies if available.
        if compressed_bodies and body_type in compressed_bodies:
            return gzip.decompress(compressed_bodies[body_type]).decode("utf-8")

        row = conn.execute(
            """
            SELECT data FROM flow_bodies
            WHERE flow_id = ? AND type = ?
            """,
            (flow_id, body_type),
        ).fetchone()

        if row:
            return gzip.decompress(row["data"]).decode("utf-8")
        return None

    if ref.startswith("file:"):
        filename = ref[5:]
        filepath = Path(body_dir) / session_id / filename

        if filepath.exists():
            with gzip.open(filepath, "rt", encoding="utf-8") as f:
                return f.read()
        return None

    if ref.startswith("skipped:"):
        size = int(ref.split(":")[1])
        return f"<Body not persisted (too large: {size // 1024 // 1024}MB)>"

    return None
