"""Cleanup and maintenance helpers for FlowDatabase."""

import os
import shutil
import sqlite3
import time
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

from .schema import Config


def _chunked(items: Sequence[str], size: int = 500) -> List[List[str]]:
    if not items:
        return []
    return [list(items[i : i + size]) for i in range(0, len(items), size)]


def _delete_flows(conn, flow_ids: Sequence[str]) -> int:
    if not flow_ids:
        return 0

    deleted = 0
    for chunk in _chunked(list(flow_ids), 500):
        placeholders = ",".join("?" for _ in chunk)
        conn.execute(f"DELETE FROM flow_bodies WHERE flow_id IN ({placeholders})", chunk)
        conn.execute(f"DELETE FROM flow_details WHERE id IN ({placeholders})", chunk)
        conn.execute(f"DELETE FROM flow_indices WHERE id IN ({placeholders})", chunk)
        deleted += len(chunk)
    return deleted


def _collect_flow_targets(rows) -> Tuple[List[str], Dict[str, List[str]]]:
    flow_ids: List[str] = []
    session_flows: Dict[str, List[str]] = defaultdict(list)
    for row in rows:
        flow_id = row["id"]
        session_id = row["session_id"]
        flow_ids.append(flow_id)
        session_flows[session_id].append(flow_id)
    return flow_ids, session_flows


def run_wal_checkpoint(db, mode: str = "PASSIVE"):
    """Run WAL checkpoint."""
    valid_wal_modes = {"PASSIVE", "TRUNCATE", "RESTART", "FULL"}
    mode = mode.upper()
    if mode not in valid_wal_modes:
        db.logger.warning(f"Invalid WAL checkpoint mode: {mode}, falling back to PASSIVE")
        mode = "PASSIVE"

    try:
        # Serialize checkpoint with normal writers to avoid lock contention.
        with db._lock:
            conn = db._get_conn()
            result = conn.execute(f"PRAGMA wal_checkpoint({mode})").fetchone()
            if result:
                busy, log_pages, checkpointed = result[0], result[1], result[2]
                if mode == "TRUNCATE":
                    db.logger.info(
                        f"WAL TRUNCATE checkpoint: busy={busy}, "
                        f"log={log_pages}, checkpointed={checkpointed}"
                    )
                elif busy > 0:
                    db.logger.debug(f"WAL PASSIVE checkpoint busy: {result}")
    except sqlite3.Error as e:
        db.logger.warning(f"WAL checkpoint ({mode}) error: {e}")


def run_cleanup(db):
    """Clean up old data and enforce total flow limit."""
    # Serialize cleanup with writes; avoids concurrent write transactions
    # from cleanup thread and capture path on separate SQLite connections.
    with db._lock:
        conn = db._get_conn()
        cleanup_start = time.time()
        deleted_flows = 0
        deleted_sessions = 0

        if Config.MAX_FLOW_AGE_DAYS > 0:
            age_threshold = time.time() - (Config.MAX_FLOW_AGE_DAYS * 24 * 60 * 60)
            old_flows = conn.execute(
                """
                SELECT id, session_id FROM flow_indices
                WHERE msg_ts < ?
                """,
                (age_threshold,),
            ).fetchall()

            if old_flows:
                db.logger.info(
                    f"Deleting {len(old_flows)} flows older than {Config.MAX_FLOW_AGE_DAYS} days"
                )
                flow_ids, session_flows = _collect_flow_targets(old_flows)
                for session_id, session_flow_ids in session_flows.items():
                    delete_body_files(db, session_id, session_flow_ids)
                deleted_flows += _delete_flows(conn, flow_ids)

        total_count = conn.execute("SELECT COUNT(*) FROM flow_indices").fetchone()[0]

        if total_count > Config.MAX_TOTAL_FLOWS:
            excess = total_count - Config.MAX_TOTAL_FLOWS
            db.logger.info(
                f"Total flows ({total_count}) exceeds limit ({Config.MAX_TOTAL_FLOWS}), "
                f"deleting {excess} oldest flows"
            )
            old_flows = conn.execute(
                """
                SELECT id, session_id FROM flow_indices
                ORDER BY msg_ts ASC
                LIMIT ?
                """,
                (excess,),
            ).fetchall()
            flow_ids, session_flows = _collect_flow_targets(old_flows)
            for session_id, session_flow_ids in session_flows.items():
                db._delete_body_files(session_id, session_flow_ids)
            deleted_flows += _delete_flows(conn, flow_ids)

        conn.execute(
            """
            UPDATE sessions SET flow_count = (
                SELECT COUNT(*) FROM flow_indices WHERE session_id = sessions.id
            )
            """
        )

        empty_sessions = conn.execute(
            """
            SELECT id FROM sessions
            WHERE id != 'default'
            AND is_active = 0
            AND flow_count = 0
            """
        ).fetchall()

        for row in empty_sessions:
            db.delete_session(row["id"])
            deleted_sessions += 1

        db_size_mb = 0
        try:
            db_size_mb = os.path.getsize(db.db_path) / (1024 * 1024)
            if db_size_mb > Config.MAX_DB_SIZE_MB:
                db.logger.warning(
                    f"Database size ({db_size_mb:.1f}MB) exceeds "
                    f"limit ({Config.MAX_DB_SIZE_MB}MB)."
                )
                db.push_notification(
                    title_key="database.notifications.storage_warning_title",
                    message_key="database.notifications.storage_warning_msg",
                    params={"size_mb": f"{db_size_mb:.0f}"},
                    n_type="warning",
                    priority="high",
                )
        except Exception as e:
            db.logger.debug(f"DB size check failed: {e}")

        checkpoint_result = None
        try:
            checkpoint_result = conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
            if checkpoint_result and checkpoint_result[0] > 0:
                db.logger.debug(f"WAL checkpoint partial: {checkpoint_result}")
        except Exception as e:
            db.logger.debug(f"WAL checkpoint failed: {e}")

        try:
            conn.execute("PRAGMA optimize")
        except Exception as e:
            db.logger.debug(f"PRAGMA optimize failed: {e}")

        integrity_ok = True
        if db_size_mb < 1000:
            try:
                result = conn.execute("PRAGMA quick_check").fetchone()
                integrity_ok = result[0] == "ok" if result else False
                if not integrity_ok:
                    db.logger.error(f"Database integrity check failed: {result}")
            except Exception as e:
                db.logger.debug(f"Integrity check failed: {e}")

        conn.commit()

        if deleted_flows > max(1000, total_count * 0.1):
            db.logger.info(f"Running VACUUM after deleting {deleted_flows} flows...")
            try:
                conn.execute("VACUUM")
                conn.commit()
            except Exception as e:
                db.logger.error(f"VACUUM failed: {e}")

        cleanup_time = (time.time() - cleanup_start) * 1000
        db.logger.info(
            f"Cleanup: deleted {deleted_sessions} sessions, {deleted_flows} flows "
            f"in {cleanup_time:.0f}ms "
            f"(db={db_size_mb:.0f}MB, integrity={'ok' if integrity_ok else 'FAIL'})"
        )

        if deleted_flows > 0 or deleted_sessions > 0:
            db.push_notification(
                title_key="database.notifications.cleanup_title",
                message_key="database.notifications.cleanup_msg",
                params={"flows": deleted_flows, "sessions": deleted_sessions},
                n_type="info",
                priority="low",
            )


def delete_body_files(db, session_id: str, flow_ids: List[str] = None):
    """Delete body files for given flows or entire session directory."""
    session_dir = Path(db.body_dir) / session_id

    if not session_dir.exists():
        return

    if flow_ids is None:
        try:
            shutil.rmtree(session_dir)
            db.logger.debug(f"Removed session directory: {session_dir}")
        except Exception as e:
            db.logger.error(f"Error removing session directory {session_dir}: {e}")
    else:
        for flow_id in flow_ids:
            for suffix in ["_r.dat", "_s.dat", "_req.dat", "_res.dat"]:
                filepath = session_dir / f"{flow_id}{suffix}"
                if filepath.exists():
                    try:
                        filepath.unlink()
                    except OSError:
                        pass


def clear_session(db, session_id: str = None):
    """Clear all flows in a session."""
    session_id = db._get_session_id(session_id)
    delete_body_files(db, session_id)

    with db._lock:
        conn = db._get_conn()
        conn.execute("DELETE FROM flow_bodies WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM flow_details WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM flow_indices WHERE session_id = ?", (session_id,))

        conn.execute(
            """
            UPDATE sessions SET
                flow_count = 0,
                total_size = 0,
                updated_at = ?
            WHERE id = ?
            """,
            (time.time(), session_id),
        )

        conn.commit()


def get_stats(db) -> Dict:
    """Get database statistics."""
    conn = db._get_conn()
    sessions = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    total_flows = conn.execute("SELECT COUNT(*) FROM flow_indices").fetchone()[0]
    total_size = conn.execute("SELECT COALESCE(SUM(size), 0) FROM flow_indices").fetchone()[0]

    db_size = os.path.getsize(db.db_path) if os.path.exists(db.db_path) else 0

    body_size = 0
    body_path = Path(db.body_dir)
    if body_path.exists():
        for f in body_path.rglob("*.dat"):
            body_size += f.stat().st_size

    return {
        "sessions": sessions,
        "total_flows": total_flows,
        "total_size": total_size,
        "db_size": db_size,
        "body_files_size": body_size,
        "disk_usage": db_size + body_size,
    }


def vacuum(db, full: bool = False):
    """Run VACUUM to reclaim space and defragment database."""
    with db._lock:
        conn = db._get_conn()

        if not full:
            try:
                result = conn.execute("PRAGMA freelist_count").fetchone()
                free_pages = result[0] if result else 0
                result = conn.execute("PRAGMA page_count").fetchone()
                total_pages = result[0] if result else 1
                if free_pages / total_pages < 0.2:
                    db.logger.info(f"VACUUM skipped: only {free_pages}/{total_pages} free pages")
                    return
            except Exception as e:
                db.logger.debug(f"VACUUM prerequisite check failed: {e}")

        db.logger.info("Starting VACUUM...")
        start_time = time.time()
        try:
            conn.execute("VACUUM")
            conn.commit()
            elapsed = time.time() - start_time
            new_size_mb = os.path.getsize(db.db_path) / (1024 * 1024)
            db.logger.info(
                f"VACUUM completed in {elapsed:.1f}s, "
                f"database size: {new_size_mb:.1f}MB"
            )
        except Exception as e:
            db.logger.error(f"VACUUM failed: {e}")


def reindex(db):
    """Rebuild all indexes to fix potential corruption and improve performance."""
    with db._lock:
        conn = db._get_conn()
        db.logger.info("Starting REINDEX...")
        start_time = time.time()

        try:
            conn.execute("REINDEX")
            conn.commit()
            elapsed = time.time() - start_time
            db.logger.info(f"REINDEX completed in {elapsed:.1f}s")
        except Exception as e:
            db.logger.error(f"REINDEX failed: {e}")
