"""
Flow Database - SQLite Persistence Layer

Implements:
- Session management
- Flow index/detail storage
- Tiered body storage (inline/compressed/file)
- Automatic cleanup

@see docs/architecture/traffic-persistence.md
"""

import os
import sqlite3
import threading
import time
from typing import Optional, Dict, Any, List, Tuple
from collections import deque
from .flowdb.schema import Config, SCHEMA
from .flowdb.body_storage import process_body, get_placeholder, load_body
from .flowdb.session_repo import (
    create_new_session,
    create_session as repo_create_session,
    update_session_flow_count as repo_update_session_flow_count,
    get_active_session as repo_get_active_session,
    switch_session as repo_switch_session,
    list_sessions as repo_list_sessions,
    delete_session as repo_delete_session,
    delete_all_historical_sessions as repo_delete_all_historical_sessions,
    update_session_stats as repo_update_session_stats,
)
from .flowdb.sse_event_repo import (
    store_sse_events as repo_store_sse_events,
    get_sse_events as repo_get_sse_events,
)
from .flowdb.export import (
    get_all_flows as repo_get_all_flows,
    export_to_file_iter as repo_export_to_file_iter,
)
from .flowdb.flow_repo import (
    build_flow_data_clean as repo_build_flow_data_clean,
    store_flow as repo_store_flow,
    insert_flow_rows as repo_insert_flow_rows,
    store_flows_batch as repo_store_flows_batch,
    extract_index as repo_extract_index,
    get_indices as repo_get_indices,
    get_flow_seq as repo_get_flow_seq,
    get_detail as repo_get_detail,
)
from .flowdb.cleanup import (
    run_wal_checkpoint as repo_run_wal_checkpoint,
    run_cleanup as repo_run_cleanup,
    delete_body_files as repo_delete_body_files,
    clear_session as repo_clear_session,
    get_stats as repo_get_stats,
    vacuum as repo_vacuum,
    reindex as repo_reindex,
)
from .flowdb.query_repo import (
    get_flow_count as repo_get_flow_count,
    search_by_body as repo_search_by_body,
    search_by_header as repo_search_by_header,
)
from .utils import setup_logging


# ==================== FlowDatabase Class ====================

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
        # Write lock for write operations
        self._lock = threading.Lock()
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

    def _get_or_reuse_session_id(self) -> str:
        """Get or reuse session ID without creating new one.

        Called during backend initialization. Will return existing active session
        if available, otherwise returns None (frontend will create one).
        """
        conn = self._get_conn()

        # Check for active session
        row = conn.execute("""
            SELECT id FROM sessions WHERE is_active = 1 LIMIT 1
        """).fetchone()

        if row:
            return row[0]

        # No active session - return None, frontend will create one
        return None

    def create_new_session_for_app_start(self) -> str:
        """Create a new session when app starts (called from frontend).

        This is the only way to create a new session during normal operation.
        Proxy stop/start will NOT create new sessions.
        """
        return self._create_new_session()

    def _create_connection(self) -> sqlite3.Connection:
        """Create a new database connection with proper settings."""
        conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
            timeout=30.0  # 30 second timeout for locked database
        )
        conn.row_factory = sqlite3.Row
        # Enable WAL mode for better concurrency
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        # Performance optimizations for large databases
        conn.execute("PRAGMA cache_size=-64000")  # 64MB cache
        conn.execute("PRAGMA mmap_size=268435456")  # 256MB memory-mapped I/O
        conn.execute("PRAGMA temp_store=MEMORY")  # Store temp tables in memory
        # Optimize WAL checkpoint - auto-checkpoint every 1000 pages
        conn.execute("PRAGMA wal_autocheckpoint=1000")
        # Set busy timeout to wait for locks
        conn.execute("PRAGMA busy_timeout=30000")  # 30 seconds
        return conn

    def _get_conn(self) -> sqlite3.Connection:
        """Get thread-local connection with health check and auto-reconnect."""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            self._local.conn = self._create_connection()
        else:
            # Health check - verify connection is still valid
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
        """Execute a database operation with retry logic for transient errors.
        
        Args:
            operation_name: Name of the operation for logging
            operation: Callable that takes a connection and returns a result
            max_retries: Maximum number of retries
            
        Returns:
            Result of the operation
            
        Raises:
            Last exception if all retries fail
        """
        last_error = None
        for attempt in range(max_retries):
            try:
                conn = self._get_conn()
                return operation(conn)
            except sqlite3.OperationalError as e:
                last_error = e
                error_msg = str(e).lower()
                # Retry on transient errors
                if 'locked' in error_msg or 'database is locked' in error_msg:
                    self.logger.warning(f"Database locked during {operation_name}, retry {attempt + 1}/{max_retries}")
                    # Force reconnection on next attempt
                    if hasattr(self._local, 'conn') and self._local.conn:
                        try:
                            self._local.conn.close()
                        except Exception as e:
                            self.logger.debug(f"Failed to close locked connection: {e}")
                        self._local.conn = None
                    time.sleep(0.1 * (attempt + 1))  # Exponential backoff
                    continue
                else:
                    raise
            except sqlite3.DatabaseError as e:
                last_error = e
                error_msg = str(e).lower()
                # Retry on disk I/O errors
                if 'disk i/o' in error_msg or 'malformed' in error_msg:
                    self.logger.error(f"Database error during {operation_name}: {e}, retry {attempt + 1}/{max_retries}")
                    # Force reconnection
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
        
        # All retries failed
        self.logger.error(f"All {max_retries} retries failed for {operation_name}")
        raise last_error

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

    def _create_new_session(self) -> str:
        return create_new_session(self)

    def _cleanup_old_sessions(self, keep_count: int = None, max_age_days: int = None):
        """Clean up old sessions to prevent database bloat.

        Args:
            keep_count: Keep at most this many recent sessions
                        (default: Config.MAX_SESSIONS)
            max_age_days: Delete sessions older than this many days
                          (default: Config.MAX_FLOW_AGE_DAYS)
        """
        if keep_count is None:
            keep_count = Config.MAX_SESSIONS
        if max_age_days is None:
            max_age_days = Config.MAX_FLOW_AGE_DAYS
        conn = self._get_conn()
        now = time.time()
        cutoff_time = now - (max_age_days * 24 * 60 * 60)

        # Get sessions to delete (old ones, excluding the most recent keep_count)
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
                # Get flow IDs for file cleanup
                flow_ids = [
                    row[0] for row in conn.execute(
                        "SELECT id FROM flow_indices WHERE session_id = ?", (session_id,)
                    )
                ]

                # Delete body files
                self._delete_body_files(session_id, flow_ids)

                # Delete from database (CASCADE handles related tables)
                conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
                deleted_count += 1
            except Exception as e:
                self.logger.debug(f"Failed to delete expired session: {e}")

        if deleted_count > 0:
            conn.commit()

        return deleted_count

    # ==================== Session Management ====================

    def _get_session_id(self, session_id: str = None) -> str:
        """Get session ID, using current session or ensuring active session exists."""
        if session_id:
            return session_id
        # Use cached current session ID for performance
        if hasattr(self, '_current_session_id') and self._current_session_id:
            return self._current_session_id
        active_session = self.get_active_session()
        if active_session:
            self._current_session_id = active_session['id']
            return self._current_session_id
        # No active session, let frontend create one
        return None

    def create_session(self, name: str, description: str = None, metadata: dict = None,
                       is_active: bool = True, created_at: float = None) -> str:
        return repo_create_session(
            self,
            name=name,
            description=description,
            metadata=metadata,
            is_active=is_active,
            created_at=created_at,
        )
    
    def update_session_flow_count(self, session_id: str) -> None:
        repo_update_session_flow_count(self, session_id)

    def get_active_session(self) -> Optional[Dict]:
        return repo_get_active_session(self)

    def switch_session(self, session_id: str) -> bool:
        return repo_switch_session(self, session_id)

    def list_sessions(self) -> List[Dict]:
        return repo_list_sessions(self)

    def delete_session(self, session_id: str) -> bool:
        return repo_delete_session(self, session_id)

    def delete_all_historical_sessions(self) -> int:
        return repo_delete_all_historical_sessions(self)

    def update_session_stats(self, session_id: str):
        repo_update_session_stats(self, session_id)

    # ==================== Flow Storage ====================

    def _build_flow_data_clean(self, flow_data: Dict, req_ref: str, res_ref: str) -> str:
        return repo_build_flow_data_clean(self, flow_data, req_ref, res_ref)

    def store_flow(self, flow_data: Dict, session_id: str = None,
                   update_session_ts: bool = True) -> bool:
        return repo_store_flow(self, flow_data, session_id, update_session_ts)

    def _insert_flow_rows(self, conn, flow_id: str, session_id: str,
                          index_data: Dict, detail_json: str,
                          req_body, req_ref: str, res_body, res_ref: str):
        return repo_insert_flow_rows(
            self, conn, flow_id, session_id, index_data, detail_json, req_body, req_ref, res_body, res_ref
        )

    def store_flows_batch(self, flows: List[Dict], session_id: str,
                          batch_size: int = 500) -> int:
        return repo_store_flows_batch(self, flows, session_id, batch_size)

    def _extract_index(self, flow_data: Dict, session_id: str) -> Dict:
        return repo_extract_index(self, flow_data, session_id)

    def _process_body(self, flow_id: str, session_id: str, body: str, body_type: str) -> Tuple[bytes, str]:
        return process_body(
            body_dir=self.body_dir,
            flow_id=flow_id,
            session_id=session_id,
            body=body,
            body_type=body_type,
            config=Config,
        )

    def _get_placeholder(self, ref: str) -> str:
        return get_placeholder(ref)

    # ==================== Flow Retrieval ====================

    def get_indices(self, session_id: str = None, since: float = 0, limit: int = None) -> List[Dict]:
        return repo_get_indices(self, session_id, since, limit)

    def get_flow_seq(self, flow_id: str) -> Optional[int]:
        return repo_get_flow_seq(self, flow_id)

    def get_detail(self, flow_id: str) -> Optional[Dict]:
        return repo_get_detail(self, flow_id)

    def store_sse_events(self, flow_id: str, events: List[Dict]) -> int:
        return repo_store_sse_events(self, flow_id, events)

    def get_sse_events(self, flow_id: str, since_seq: int = 0, limit: int = 200) -> Dict[str, Any]:
        return repo_get_sse_events(self, flow_id, since_seq, limit)

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

    def get_all_flows(self, session_id: str = None) -> List[Dict]:
        return repo_get_all_flows(self, session_id)

    def export_to_file_iter(self, file_path: str, session_id: str = None,
                            format: str = 'har', metadata: Dict = None,
                            progress_callback=None):
        return repo_export_to_file_iter(
            self,
            file_path=file_path,
            session_id=session_id,
            format=format,
            metadata=metadata,
            progress_callback=progress_callback,
        )

    def get_flow_count(self, session_id: str = None) -> int:
        return repo_get_flow_count(self, session_id)

    # Max number of flow bodies to decompress per body search request.
    # Acts as a performance safety net for large sessions.
    BODY_SEARCH_SCAN_LIMIT = 5000

    def search_by_body(self, keyword: str, body_type: str = "response",
                       session_id: str = None, case_sensitive: bool = False) -> dict:
        return repo_search_by_body(self, keyword, body_type, session_id, case_sensitive)

    def search_by_header(self, keyword: str, session_id: str = None,
                         case_sensitive: bool = False) -> dict:
        return repo_search_by_header(self, keyword, session_id, case_sensitive)

    # ==================== Background Cleanup Thread ====================

    # Idle time (seconds) before running a TRUNCATE WAL checkpoint
    _WAL_IDLE_TRUNCATE_SECS = 60
    # Minimum write-idle time before allowing a cleanup run
    _CLEANUP_WRITE_IDLE_SECS = 30

    def push_notification(self, title_key: str, message_key: str,
                          params: dict = None,
                          n_type: str = 'info', priority: str = 'normal') -> None:
        """Push a notification into the queue for the frontend to pick up via poll.

        Args:
            title_key: i18n key for the title (e.g. 'database.notifications.cleanup_title')
            message_key: i18n key for the message
            params: Optional params dict passed to i18n.t(key, params)
            n_type: 'info' | 'success' | 'warning' | 'error'
            priority: 'low' | 'normal' | 'high' | 'critical'
        """
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

    def _start_cleanup_thread(self):
        """Start the background cleanup thread."""
        def cleanup_worker():
            self.logger.info("Background cleanup thread started")
            tick = 0  # 10-second tick counter
            while not self._cleanup_stop_event.is_set():
                try:
                    self._cleanup_stop_event.wait(10)
                    if self._cleanup_stop_event.is_set():
                        break

                    tick += 1

                    # WAL idle-TRUNCATE checkpoint every 10s tick when traffic is quiet
                    idle_secs = time.time() - self._last_write_ts
                    if idle_secs >= self._WAL_IDLE_TRUNCATE_SECS:
                        self._run_wal_checkpoint('TRUNCATE')

                    # Full cleanup every CLEANUP_INTERVAL seconds
                    full_interval_ticks = max(1, int(Config.CLEANUP_INTERVAL / 10))
                    if tick % full_interval_ticks == 0:
                        # Skip if there has been recent write activity
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
            daemon=True  # Daemon thread so it doesn't prevent app exit
        )
        self._cleanup_thread.start()
    
    def _stop_cleanup_thread(self):
        """Stop the background cleanup thread."""
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            self._cleanup_stop_event.set()
            self._cleanup_thread.join(timeout=5.0)
            if self._cleanup_thread.is_alive():
                self.logger.warning("Cleanup thread did not stop gracefully")

    def _maybe_cleanup(self):
        """Schedule cleanup - now just updates timestamp, actual cleanup runs in background.
        
        This method is kept for compatibility but no longer blocks the main thread.
        """
        # Just update the timestamp to indicate activity
        # The background thread will handle actual cleanup
        pass

    # ==================== Cleanup ====================

    def _run_cleanup_background(self):
        """Run cleanup in background thread context.
        
        This is called by the background cleanup thread, not from store_flow().
        Uses a separate lock to avoid blocking normal database operations.
        """
        with self._cleanup_lock:
            try:
                self._run_cleanup()
                self._last_cleanup = time.time()
            except Exception as e:
                self.logger.error(f"Background cleanup error: {e}")

    def _run_wal_checkpoint(self, mode: str = 'PASSIVE'):
        repo_run_wal_checkpoint(self, mode)

    def _run_cleanup(self):
        repo_run_cleanup(self)

    def _delete_body_files(self, session_id: str, flow_ids: List[str] = None):
        repo_delete_body_files(self, session_id, flow_ids)

    def clear_session(self, session_id: str = None):
        repo_clear_session(self, session_id)

    # ==================== Utility ====================

    def get_stats(self) -> Dict:
        return repo_get_stats(self)

    def vacuum(self, full: bool = False):
        repo_vacuum(self, full)

    def reindex(self):
        repo_reindex(self)

    def close(self):
        """Close database connection and stop cleanup thread"""
        # Stop the background cleanup thread first
        self._stop_cleanup_thread()
        
        if hasattr(self._local, 'conn') and self._local.conn:
            self._local.conn.close()
            self._local.conn = None
