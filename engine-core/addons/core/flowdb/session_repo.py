"""Session-related persistence helpers for FlowDatabase."""

import json
import threading
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional


def create_new_session(db) -> str:
    """Create a new session with timestamp name for auto-isolation."""
    with db._lock:
        conn = db._get_conn()
        now = time.time()

        dt = datetime.fromtimestamp(now)
        session_name = f"Session {dt.strftime('%Y-%m-%d %H:%M')}"
        session_id = f"s_{int(now * 1000)}"

        conn.execute("UPDATE sessions SET is_active = 0")
        conn.execute(
            """
            INSERT INTO sessions (id, name, created_at, updated_at, is_active)
            VALUES (?, ?, ?, ?, 1)
            """,
            (session_id, session_name, now, now),
        )
        conn.commit()

        db._current_session_id = session_id
    return session_id


def create_session(
    db,
    name: str,
    description: str = None,
    metadata: dict = None,
    is_active: bool = True,
    created_at: float = None,
) -> str:
    """Create a new session."""
    session_id = str(uuid.uuid4())[:8]
    now = time.time()
    session_created_at = created_at if created_at is not None else now

    with db._lock:
        conn = db._get_conn()
        if is_active:
            conn.execute("UPDATE sessions SET is_active = 0")

        conn.execute(
            """
            INSERT INTO sessions (id, name, description, created_at, updated_at, metadata, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                name,
                description,
                session_created_at,
                now,
                json.dumps(metadata) if metadata else None,
                1 if is_active else 0,
            ),
        )
        conn.commit()

        if is_active:
            db._current_session_id = session_id

    return session_id


def update_session_flow_count(db, session_id: str) -> None:
    """Update flow_count for a session."""
    with db._lock:
        conn = db._get_conn()
        conn.execute(
            """
            UPDATE sessions SET flow_count = (
                SELECT COUNT(*) FROM flow_indices WHERE session_id = ?
            )
            WHERE id = ?
            """,
            (session_id, session_id),
        )
        conn.commit()


def get_active_session(db) -> Optional[Dict]:
    """Get current active session."""
    conn = db._get_conn()
    row = conn.execute("SELECT * FROM sessions WHERE is_active = 1").fetchone()
    return dict(row) if row else None


def switch_session(db, session_id: str) -> bool:
    """Switch to a different session."""
    with db._lock:
        conn = db._get_conn()
        row = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return False

        conn.execute("UPDATE sessions SET is_active = 0")
        conn.execute(
            """
            UPDATE sessions SET is_active = 1, updated_at = ?
            WHERE id = ?
            """,
            (time.time(), session_id),
        )
        conn.commit()
        db._current_session_id = session_id
    return True


def list_sessions(db) -> List[Dict]:
    """List all sessions with real-time flow counts."""

    def _query(conn):
        rows = conn.execute(
            """
            SELECT
                s.id, s.name, s.description, s.created_at, s.updated_at,
                s.metadata, s.is_active,
                COALESCE(f.flow_count, 0) as flow_count,
                COALESCE(f.total_size, 0) as total_size
            FROM sessions s
            LEFT JOIN (
                SELECT session_id, COUNT(*) as flow_count, SUM(size) as total_size
                FROM flow_indices
                GROUP BY session_id
            ) f ON s.id = f.session_id
            ORDER BY s.created_at DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]

    return db._execute_with_retry("list_sessions", _query)


def delete_session(db, session_id: str) -> bool:
    """Delete a session and all its flows."""
    if session_id == "default":
        return False

    with db._lock:
        conn = db._get_conn()
        active_row = conn.execute(
            "SELECT id FROM sessions WHERE id = ? AND is_active = 1",
            (session_id,),
        ).fetchone()
        if active_row:
            return False

        db._delete_body_files(session_id)
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()

    return True


def delete_all_historical_sessions(db) -> int:
    """Delete all inactive sessions and their flows."""
    conn = db._get_conn()
    rows = conn.execute("SELECT id FROM sessions WHERE is_active = 0").fetchall()
    if not rows:
        return 0

    db.logger.info(f"Deleting all {len(rows)} historical sessions...")
    deleted_count = 0
    for row in rows:
        session_id = row[0]
        if db.delete_session(session_id):
            deleted_count += 1

    if deleted_count > 0:
        def _async_vacuum():
            try:
                db.logger.info("Post-clearall VACUUM started in background thread...")
                db.vacuum(full=True)
                db.logger.info("Post-clearall VACUUM completed.")
            except Exception as e:
                db.logger.error(f"Post-clearall vacuum failed: {e}")

        t = threading.Thread(target=_async_vacuum, name="PostClearall-VACUUM", daemon=True)
        t.start()

    return deleted_count


def update_session_stats(db, session_id: str) -> None:
    """Update session statistics."""
    with db._lock:
        conn = db._get_conn()
        conn.execute(
            """
            UPDATE sessions SET
                flow_count = (SELECT COUNT(*) FROM flow_indices WHERE session_id = ?),
                total_size = (SELECT COALESCE(SUM(size), 0) FROM flow_indices WHERE session_id = ?)
            WHERE id = ?
            """,
            (session_id, session_id, session_id),
        )
        conn.commit()
