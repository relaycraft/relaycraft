"""
Flow Database - SQLite Persistence Layer

Implements:
- Session management
- Flow index/detail storage
- Tiered body storage (inline/compressed/file)
- Automatic cleanup

Consumers should import data operations directly from flowdb/ submodules
and pass this instance as the first argument.

@see docs/architecture/traffic-persistence.md
"""

import os
import sqlite3
import threading
import time
from typing import Optional, Dict, Any, List, Tuple
from collections import deque
from .flowdb.schema import Config, SCHEMA
from .flowdb.body_storage import process_body, load_body
from .flowdb.session_repo import (
    create_new_session,
    get_active_session as _get_active_session,
)
from .flowdb.cleanup import (
    run_wal_checkpoint as _run_wal_checkpoint,
    run_cleanup as _run_cleanup,
    delete_body_files as _delete_body_files,
)
from .utils import setup_logging


class FlowDatabase:
    """
    SQLite-based flow persistence layer.

    Thread-safe via connection-per-thread and lock for writes.
    Cleanup runs in a background thread to avoid blocking the main event loop.
    """

    def __init__(self, db_path: str = None, body_dir: str = None):
        self.db_path = db_path or Config.DB_PATH
        self.body_dir = body_dir or Config.BODY_DIR
        self.logger = setup_logging()

        # Ensure directories exist
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        os.makedirs(self.body_dir, exist_ok=True)

        # Thread-local storage for connections
        self._local = threading.local()
        # Write lock for write operations.
        # Use RLock so maintenance paths can safely call helpers that also lock.
        self._lock = threading.RLock()
        # Separate lock for cleanup
        self._cleanup_lock = threading.Lock()

        # Initialize database
        self._init_db()

        # Get or reuse active session (created by frontend on launch)
        self._current_session_id = self._get_or_reuse_session_id()

        # Notification queue: Python → frontend via poll response
        # deque with maxlen prevents unbounded growth if frontend is slow
        self._notifications: deque = deque(maxlen=50)

        # Initial cleanup on startup — runs async so it never delays app init
        def _deferred_startup_cleanup():
            time.sleep(5)  # give the app time to finish starting up
            try:
                self._cleanup_old_sessions()
            except Exception as e:
                self.logger.warning(f"Startup cleanup error: {e}")
        t = threading.Thread(target=_deferred_startup_cleanup,
                             name="StartupCleanup", daemon=True)
        t.start()

        # Last cleanup time
        self._last_cleanup = time.time()
        # Last write timestamp (used for WAL idle-TRUNCATE checkpoint)
        self._last_write_ts = time.time()

        # Start background cleanup thread
        self._cleanup_thread = None
        self._cleanup_stop_event = threading.Event()
        self._start_cleanup_thread()

    # ==================== Session Helpers ====================

    def _get_or_reuse_session_id(self) -> str:
        """Get or reuse session ID without creating new one."""
        conn = self._get_conn()
        row = conn.execute("""
            SELECT id FROM sessions WHERE is_active = 1 LIMIT 1
        """).fetchone()
        if row:
            return row[0]
        return None

    def create_new_session_for_app_start(self) -> str:
        """Create a new session when app starts (called from frontend)."""
        return create_new_session(self)

    def _get_session_id(self, session_id: str = None) -> str:
        """Get session ID, using current session or ensuring active session exists."""
        if session_id:
            return session_id
        if hasattr(self, '_current_session_id') and self._current_session_id:
            return self._current_session_id
        active_session = _get_active_session(self)
        if active_session:
            self._current_session_id = active_session['id']
            return self._current_session_id
        return None

    # ==================== Connection Management ====================

    def _create_connection(self) -> sqlite3.Connection:
        """Create a new database connection with proper settings."""
        conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
            timeout=30.0
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA cache_size=-64000")
        conn.execute("PRAGMA mmap_size=268435456")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA wal_autocheckpoint=1000")
        conn.execute("PRAGMA busy_timeout=30000")
        return conn

    def _get_conn(self) -> sqlite3.Connection:
        """Get thread-local connection with health check and auto-reconnect."""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            self._local.conn = self._create_connection()
        else:
            try:
                self._local.conn.execute("SELECT 1")
            except sqlite3.Error as e:
                self.logger.warning(f"Database connection unhealthy ({e}), reconnecting...")
                try:
                    self._local.conn.close()
                except Exception as e:
                    self.logger.debug(f"Failed to close unhealthy connection: {e}")
                self._local.conn = self._create_connection()
        return self._local.conn

    def _execute_with_retry(self, operation_name: str, operation, max_retries: int = 3):
        """Execute a database operation with retry logic for transient errors."""
        last_error = None
        for attempt in range(max_retries):
            try:
                conn = self._get_conn()
                return operation(conn)
            except sqlite3.OperationalError as e:
                last_error = e
                error_msg = str(e).lower()
                if 'locked' in error_msg or 'database is locked' in error_msg:
                    self.logger.warning(f"Database locked during {operation_name}, retry {attempt + 1}/{max_retries}")
                    if hasattr(self._local, 'conn') and self._local.conn:
                        try:
                            self._local.conn.close()
                        except Exception as e:
                            self.logger.debug(f"Failed to close locked connection: {e}")
                        self._local.conn = None
                    time.sleep(0.1 * (attempt + 1))
                    continue
                else:
                    raise
            except sqlite3.DatabaseError as e:
                last_error = e
                error_msg = str(e).lower()
                if 'disk i/o' in error_msg or 'malformed' in error_msg:
                    self.logger.error(f"Database error during {operation_name}: {e}, retry {attempt + 1}/{max_retries}")
                    if hasattr(self._local, 'conn') and self._local.conn:
                        try:
                            self._local.conn.close()
                        except Exception as e:
                            self.logger.debug(f"Failed to close errored connection: {e}")
                        self._local.conn = None
                    time.sleep(0.2 * (attempt + 1))
                    continue
                else:
                    raise

        self.logger.error(f"All {max_retries} retries failed for {operation_name}")
        raise last_error

    # ==================== Schema ====================

    def _init_db(self):
        """Initialize database schema"""
        conn = self._get_conn()
        conn.executescript(SCHEMA)
        self._ensure_flow_indices_columns(conn)
        conn.commit()

    def _ensure_flow_indices_columns(self, conn: sqlite3.Connection) -> None:
        """Apply additive schema migrations for flow_indices."""
        rows = conn.execute("PRAGMA table_info(flow_indices)").fetchall()
        existing = {row[1] for row in rows}
        if "is_sse" not in existing:
            conn.execute("ALTER TABLE flow_indices ADD COLUMN is_sse INTEGER DEFAULT 0")
            conn.execute(
                "UPDATE flow_indices SET is_sse = 1 "
                "WHERE lower(content_type) LIKE 'text/event-stream%'"
            )

    # ==================== Body Storage Adapters ====================

    def _process_body(self, flow_id: str, session_id: str, body: str, body_type: str) -> Tuple[bytes, str]:
        return process_body(
            body_dir=self.body_dir,
            flow_id=flow_id,
            session_id=session_id,
            body=body,
            body_type=body_type,
            config=Config,
        )

    def _load_body(self, conn, flow_id: str, session_id: str, ref: str, body_type: str,
                   compressed_bodies: Dict = None) -> Optional[str]:
        return load_body(
            conn=conn,
            body_dir=self.body_dir,
            flow_id=flow_id,
            session_id=session_id,
            ref=ref,
            body_type=body_type,
            compressed_bodies=compressed_bodies,
        )

    # ==================== Cleanup ====================

    def _cleanup_old_sessions(self, keep_count: int = None, max_age_days: int = None):
        """Clean up old sessions to prevent database bloat."""
        if keep_count is None:
            keep_count = Config.MAX_SESSIONS
        if max_age_days is None:
            max_age_days = Config.MAX_FLOW_AGE_DAYS
        conn = self._get_conn()
        now = time.time()
        cutoff_time = now - (max_age_days * 24 * 60 * 60)

        rows = conn.execute("""
            SELECT id FROM sessions
            WHERE is_active = 0
            AND created_at < ?
            ORDER BY created_at DESC
            LIMIT -1 OFFSET ?
        """, (cutoff_time, keep_count)).fetchall()

        if not rows:
            return 0

        session_ids = [row[0] for row in rows]
        deleted_count = 0

        for session_id in session_ids:
            try:
                flow_ids = [
                    row[0] for row in conn.execute(
                        "SELECT id FROM flow_indices WHERE session_id = ?", (session_id,)
                    )
                ]
                _delete_body_files(self, session_id, flow_ids)
                conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
                deleted_count += 1
            except Exception as e:
                self.logger.debug(f"Failed to delete expired session: {e}")

        if deleted_count > 0:
            conn.commit()

        return deleted_count

    # ==================== Notifications ====================

    def push_notification(self, title_key: str, message_key: str,
                          params: dict = None,
                          n_type: str = 'info', priority: str = 'normal') -> None:
        self._notifications.append({
            'title_key': title_key,
            'message_key': message_key,
            'params': params or {},
            'type': n_type,
            'priority': priority,
            'ts': time.time(),
        })

    def drain_notifications(self) -> list:
        """Return and clear all pending notifications (called by poll endpoint)."""
        result = list(self._notifications)
        self._notifications.clear()
        return result

    # ==================== Background Cleanup Thread ====================

    _WAL_IDLE_TRUNCATE_SECS = 60
    _CLEANUP_WRITE_IDLE_SECS = 30

    def _start_cleanup_thread(self):
        """Start the background cleanup thread."""
        def cleanup_worker():
            self.logger.info("Background cleanup thread started")
            tick = 0
            while not self._cleanup_stop_event.is_set():
                try:
                    self._cleanup_stop_event.wait(10)
                    if self._cleanup_stop_event.is_set():
                        break

                    tick += 1

                    idle_secs = time.time() - self._last_write_ts
                    if idle_secs >= self._WAL_IDLE_TRUNCATE_SECS:
                        _run_wal_checkpoint(self, 'TRUNCATE')

                    full_interval_ticks = max(1, int(Config.CLEANUP_INTERVAL / 10))
                    if tick % full_interval_ticks == 0:
                        write_idle = time.time() - self._last_write_ts
                        if write_idle < self._CLEANUP_WRITE_IDLE_SECS:
                            self.logger.debug(
                                f"Cleanup deferred: write activity {write_idle:.0f}s ago "
                                f"(threshold: {self._CLEANUP_WRITE_IDLE_SECS}s)"
                            )
                        else:
                            self._run_cleanup_background()

                except Exception as e:
                    self.logger.error(f"Error in cleanup thread: {e}")

            self.logger.info("Background cleanup thread stopped")

        self._cleanup_thread = threading.Thread(
            target=cleanup_worker,
            name="FlowDatabase-Cleanup",
            daemon=True
        )
        self._cleanup_thread.start()

    def _stop_cleanup_thread(self):
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            self._cleanup_stop_event.set()
            self._cleanup_thread.join(timeout=5.0)
            if self._cleanup_thread.is_alive():
                self.logger.warning("Cleanup thread did not stop gracefully")

    def _maybe_cleanup(self):
        pass

    def _run_cleanup_background(self):
        """Run cleanup in background thread context."""
        with self._cleanup_lock:
            try:
                _run_cleanup(self)
                self._last_cleanup = time.time()
            except Exception as e:
                self.logger.error(f"Background cleanup error: {e}")

    # ==================== Lifecycle ====================

    def close(self):
        """Close database connection and stop cleanup thread"""
        self._stop_cleanup_thread()
        if hasattr(self, '_local') and hasattr(self._local, 'conn') and self._local.conn:
            self._local.conn.close()
            self._local.conn = None
