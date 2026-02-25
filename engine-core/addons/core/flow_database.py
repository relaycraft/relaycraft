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
import json
import gzip
import uuid
import sqlite3
import threading
import time
import shutil
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from contextlib import contextmanager
from datetime import datetime
from collections import deque
from .utils import setup_logging


# ==================== Configuration ====================

class Config:
    """Database configuration"""
    # Storage thresholds
    COMPRESS_THRESHOLD = 10 * 1024        # 10KB - compress if larger
    FILE_THRESHOLD = 1 * 1024 * 1024      # 1MB - store as file if larger
    MAX_PERSIST_SIZE = 50 * 1024 * 1024   # 50MB - skip persistence if larger

    # Limits
    MAX_TOTAL_FLOWS = 1000000              # Max total flows across all sessions (1M)
    MAX_SESSIONS = 20                      # Max sessions to keep
    MAX_FLOW_AGE_DAYS = 30                 # Delete flows older than this many days

    # Cleanup
    CLEANUP_INTERVAL = 300                 # Seconds between cleanup runs
    MAX_DB_SIZE_MB = 2000                  # Warn if database exceeds this size (MB)

    # Database - use RELAYCRAFT_DATA_DIR from Tauri if available, otherwise fallback to ~/.relaycraft
    # All traffic-related data (database and bodies) is stored in a dedicated 'traffic' subdirectory
    _data_dir = os.environ.get("RELAYCRAFT_DATA_DIR", os.path.expanduser("~/.relaycraft"))
    _traffic_dir = os.path.join(_data_dir, "traffic")
    DB_PATH = os.path.join(_traffic_dir, "traffic.db")
    BODY_DIR = os.path.join(_traffic_dir, "bodies")


# ==================== Database Schema ====================

SCHEMA = """
-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    flow_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    metadata TEXT,
    is_active INTEGER DEFAULT 0
);

-- Flow indices (lightweight, for list display)
CREATE TABLE IF NOT EXISTS flow_indices (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,

    method TEXT NOT NULL,
    url TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    http_version TEXT,
    content_type TEXT,
    started_datetime TEXT NOT NULL,
    time REAL NOT NULL,
    size INTEGER NOT NULL,
    client_ip TEXT,
    app_name TEXT,
    app_display_name TEXT,

    has_error INTEGER DEFAULT 0,
    has_request_body INTEGER DEFAULT 0,
    has_response_body INTEGER DEFAULT 0,
    is_websocket INTEGER DEFAULT 0,
    websocket_frame_count INTEGER DEFAULT 0,
    is_intercepted INTEGER DEFAULT 0,
    hits TEXT,

    msg_ts REAL NOT NULL,
    created_at REAL DEFAULT (julianday('now')),

    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Flow details (full data)
CREATE TABLE IF NOT EXISTS flow_details (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    data TEXT NOT NULL,
    request_body_ref TEXT,
    response_body_ref TEXT,
    created_at REAL DEFAULT (julianday('now')),

    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Compressed bodies (< 1MB)
CREATE TABLE IF NOT EXISTS flow_bodies (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data BLOB NOT NULL,
    original_size INTEGER,

    FOREIGN KEY (flow_id) REFERENCES flow_details(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_indices_session_ts ON flow_indices(session_id, msg_ts DESC);
CREATE INDEX IF NOT EXISTS idx_indices_session_host ON flow_indices(session_id, host);
CREATE INDEX IF NOT EXISTS idx_indices_session_status ON flow_indices(session_id, status);
CREATE INDEX IF NOT EXISTS idx_details_session ON flow_details(session_id);
CREATE INDEX IF NOT EXISTS idx_details_id ON flow_details(id);
CREATE INDEX IF NOT EXISTS idx_bodies_flow ON flow_bodies(flow_id);
"""


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
                except Exception:
                    pass
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
                        except:
                            pass
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
                        except:
                            pass
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
        conn.commit()

    def _create_new_session(self) -> str:
        """Create a new session with timestamp name for auto-isolation.

        Each app start creates a new session to isolate traffic data.
        Old sessions are automatically cleaned up.
        """
        from datetime import datetime

        with self._lock:
            conn = self._get_conn()
            now = time.time()

            # Generate session name with timestamp
            dt = datetime.fromtimestamp(now)
            session_name = f"Session {dt.strftime('%Y-%m-%d %H:%M')}"
            session_id = f"s_{int(now * 1000)}"

            # Deactivate all existing sessions
            conn.execute("UPDATE sessions SET is_active = 0")

            # Create new active session
            conn.execute("""
                INSERT INTO sessions (id, name, created_at, updated_at, is_active)
                VALUES (?, ?, ?, ?, 1)
            """, (session_id, session_name, now, now))
            conn.commit()

            # Update cached session ID
            self._current_session_id = session_id

        return session_id

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
            except Exception:
                pass

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
        """Create a new session
        
        Args:
            name: Session name
            description: Optional description
            metadata: Optional metadata dict
            is_active: Whether this session should be active (default True)
                       Set to False for imported historical sessions
            created_at: Optional created timestamp (for imported sessions)
        """
        session_id = str(uuid.uuid4())[:8]
        now = time.time()
        # Use provided created_at or current time
        session_created_at = created_at if created_at is not None else now

        with self._lock:
            conn = self._get_conn()
            
            # If this session should be active, deactivate others first
            if is_active:
                conn.execute("UPDATE sessions SET is_active = 0")
            
            conn.execute("""
                INSERT INTO sessions (id, name, description, created_at, updated_at, metadata, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                name,
                description,
                session_created_at,
                now,  # updated_at is always now
                json.dumps(metadata) if metadata else None,
                1 if is_active else 0
            ))
            conn.commit()

        return session_id
    
    def update_session_flow_count(self, session_id: str) -> None:
        """Update the flow_count for a session after importing flows"""
        with self._lock:
            conn = self._get_conn()
            conn.execute("""
                UPDATE sessions SET flow_count = (
                    SELECT COUNT(*) FROM flow_indices WHERE session_id = ?
                )
                WHERE id = ?
            """, (session_id, session_id))
            conn.commit()

    def get_active_session(self) -> Optional[Dict]:
        """Get current active session"""
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM sessions WHERE is_active = 1").fetchone()
        return dict(row) if row else None

    def switch_session(self, session_id: str) -> bool:
        """Switch to a different session"""
        with self._lock:
            conn = self._get_conn()
            # Check if session exists
            row = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if not row:
                return False

            # Deactivate all, activate target
            conn.execute("UPDATE sessions SET is_active = 0")
            conn.execute("""
                UPDATE sessions SET is_active = 1, updated_at = ?
                WHERE id = ?
            """, (time.time(), session_id))
            conn.commit()

        return True

    def list_sessions(self) -> List[Dict]:
        """List all sessions with real-time flow counts"""
        def _query(conn):
            rows = conn.execute("""
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
            """).fetchall()
            return [dict(row) for row in rows]
        
        return self._execute_with_retry("list_sessions", _query)

    def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its flows.

        Cannot delete the currently active session (is_active = 1).
        """
        if session_id == 'default':
            return False

        with self._lock:
            conn = self._get_conn()

            # Check if this is the active session
            active_row = conn.execute(
                "SELECT id FROM sessions WHERE id = ? AND is_active = 1",
                (session_id,)
            ).fetchone()
            if active_row:
                # Cannot delete active session
                return False

            # Delete body files (entire directory)
            self._delete_body_files(session_id)

            # Delete from database (CASCADE handles related tables)
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()

        return True

    def delete_all_historical_sessions(self) -> int:
        """Delete all inactive sessions and their flows.
        
        Returns the number of deleted sessions.
        """
        conn = self._get_conn()
        
        # Get all inactive sessions
        rows = conn.execute("SELECT id FROM sessions WHERE is_active = 0").fetchall()
        if not rows:
            return 0
            
        self.logger.info(f"Deleting all {len(rows)} historical sessions...")
        deleted_count = 0
        for row in rows:
            session_id = row[0]
            if self.delete_session(session_id):
                deleted_count += 1
        
        # Run VACUUM in background to reclaim disk space without blocking HTTP response
        if deleted_count > 0:
            def _async_vacuum():
                try:
                    self.logger.info("Post-clearall VACUUM started in background thread...")
                    self.vacuum(full=True)
                    self.logger.info("Post-clearall VACUUM completed.")
                except Exception as e:
                    self.logger.error(f"Post-clearall vacuum failed: {e}")
            t = threading.Thread(target=_async_vacuum, name="PostClearall-VACUUM", daemon=True)
            t.start()
                
        return deleted_count

    def update_session_stats(self, session_id: str):
        """Update session statistics"""
        with self._lock:
            conn = self._get_conn()
            conn.execute("""
                UPDATE sessions SET
                    flow_count = (SELECT COUNT(*) FROM flow_indices WHERE session_id = ?),
                    total_size = (SELECT COALESCE(SUM(size), 0) FROM flow_indices WHERE session_id = ?)
                WHERE id = ?
            """, (session_id, session_id, session_id))
            conn.commit()

    # ==================== Flow Storage ====================

    def _build_flow_data_clean(self, flow_data: Dict, req_ref: str, res_ref: str) -> str:
        """Serialize flow data for storage, replacing non-inline bodies with placeholders.

        Avoids the expensive json.loads(json.dumps(flow_data)) round-trip by only
        copying the body fields that need to be replaced.
        """
        # Build a shallow-ish copy: deep-copy only the body fields we need to mutate
        import copy
        flow_copy = dict(flow_data)  # shallow copy of top level

        if req_ref != 'inline':
            req = flow_data.get('request')
            if req and req.get('postData'):
                req_copy = dict(req)
                pd_copy = dict(req.get('postData'))
                pd_copy['text'] = self._get_placeholder(req_ref)
                req_copy['postData'] = pd_copy
                flow_copy['request'] = req_copy

        if res_ref != 'inline':
            res = flow_data.get('response')
            if res and res.get('content'):
                res_copy = dict(res)
                ct_copy = dict(res.get('content'))
                ct_copy['text'] = self._get_placeholder(res_ref)
                res_copy['content'] = ct_copy
                flow_copy['response'] = res_copy

        return json.dumps(flow_copy, ensure_ascii=False)

    def store_flow(self, flow_data: Dict, session_id: str = None,
                   update_session_ts: bool = True) -> bool:
        """
        Store a flow with tiered body storage.

        Args:
            flow_data: Flow data dict
            session_id: Target session (default: active session)
            update_session_ts: Whether to update sessions.updated_at (set False
                               during batch imports; caller updates once at the end)

        Returns True if successful.
        """
        t0 = time.time()

        session_id = self._get_session_id(session_id)
        if not session_id:
            return False

        flow_id = flow_data.get('id')
        if not flow_id:
            return False

        index_data = self._extract_index(flow_data, session_id)

        req = flow_data.get('request') or {}
        res = flow_data.get('response') or {}
        req_body, req_ref = self._process_body(
            flow_id, session_id,
            (req.get('postData') or {}).get('text', ''),
            'request'
        )
        res_body, res_ref = self._process_body(
            flow_id, session_id,
            (res.get('content') or {}).get('text', ''),
            'response'
        )

        # Serialize without expensive full round-trip deep copy
        detail_json = self._build_flow_data_clean(flow_data, req_ref, res_ref)

        with self._lock:
            conn = self._get_conn()
            try:
                self._insert_flow_rows(
                    conn, flow_id, session_id,
                    index_data, detail_json,
                    req_body, req_ref, res_body, res_ref
                )

                if update_session_ts:
                    conn.execute(
                        "UPDATE sessions SET updated_at = ? WHERE id = ?",
                        (time.time(), session_id)
                    )

                conn.commit()
                self._last_write_ts = time.time()

            except Exception as e:
                conn.rollback()
                raise e

        elapsed_ms = (time.time() - t0) * 1000
        if elapsed_ms > 200:
            self.logger.warning(
                f"store_flow SLOW ({elapsed_ms:.0f}ms): flow_id={flow_id}"
            )

        self._maybe_cleanup()
        return True

    def _insert_flow_rows(self, conn, flow_id: str, session_id: str,
                          index_data: Dict, detail_json: str,
                          req_body, req_ref: str, res_body, res_ref: str):
        """Execute the INSERT statements for one flow (no commit, no lock).

        Factored out so store_flows_batch() can reuse it inside a single transaction.
        """
        conn.execute("""
            INSERT OR REPLACE INTO flow_indices (
                id, session_id, method, url, host, path, status, http_version,
                content_type, started_datetime, time, size, client_ip,
                app_name, app_display_name,
                has_error, has_request_body, has_response_body,
                is_websocket, websocket_frame_count, is_intercepted,
                hits, msg_ts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            index_data['id'], index_data['session_id'],
            index_data['method'], index_data['url'],
            index_data['host'], index_data['path'],
            index_data['status'], index_data['http_version'],
            index_data['content_type'], index_data['started_datetime'],
            index_data['time'], index_data['size'],
            index_data['client_ip'],
            index_data.get('app_name', ''), index_data.get('app_display_name', ''),
            index_data['has_error'], index_data['has_request_body'],
            index_data['has_response_body'], index_data['is_websocket'],
            index_data['websocket_frame_count'], index_data['is_intercepted'],
            index_data['hits'], index_data['msg_ts'],
        ))

        conn.execute("""
            INSERT OR REPLACE INTO flow_details
            (id, session_id, data, request_body_ref, response_body_ref)
            VALUES (?, ?, ?, ?, ?)
        """, (flow_id, session_id, detail_json, req_ref, res_ref))

        if req_ref == 'compressed' and req_body:
            conn.execute("""
                INSERT OR REPLACE INTO flow_bodies
                (id, flow_id, session_id, type, data, original_size)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (f"{flow_id}_req", flow_id, session_id, 'request', req_body, len(req_body)))

        if res_ref == 'compressed' and res_body:
            conn.execute("""
                INSERT OR REPLACE INTO flow_bodies
                (id, flow_id, session_id, type, data, original_size)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (f"{flow_id}_res", flow_id, session_id, 'response', res_body, len(res_body)))

    def store_flows_batch(self, flows: List[Dict], session_id: str,
                          batch_size: int = 500) -> int:
        """
        Bulk-insert multiple flows into a session with minimal commits.

        Dramatically faster than calling store_flow() in a loop:
        - Bodies are processed per-flow (no change)
        - All INSERTs within a batch share a single transaction / commit
        - sessions.updated_at is written only once at the very end

        Args:
            flows: List of flow data dicts
            session_id: Target session ID (must exist)
            batch_size: Number of flows per commit (default 500)

        Returns:
            Number of flows successfully stored.
        """
        if not flows or not session_id:
            return 0

        t0 = time.time()
        stored = 0
        errors = 0

        # Pre-process all bodies outside the lock (CPU-bound, can run freely)
        prepared: List[Tuple] = []
        for flow_data in flows:
            flow_id = flow_data.get('id')
            if not flow_id:
                continue
            try:
                index_data = self._extract_index(flow_data, session_id)
                req = flow_data.get('request') or {}
                res = flow_data.get('response') or {}
                req_body, req_ref = self._process_body(
                    flow_id, session_id,
                    (req.get('postData') or {}).get('text', ''), 'request'
                )
                res_body, res_ref = self._process_body(
                    flow_id, session_id,
                    (res.get('content') or {}).get('text', ''), 'response'
                )
                detail_json = self._build_flow_data_clean(flow_data, req_ref, res_ref)
                prepared.append((flow_id, index_data, detail_json,
                                  req_body, req_ref, res_body, res_ref))
            except Exception as e:
                self.logger.warning(f"store_flows_batch: skipping flow {flow_id}: {e}")
                errors += 1

        # Write in batches, one commit per batch
        for batch_start in range(0, len(prepared), batch_size):
            batch = prepared[batch_start:batch_start + batch_size]
            with self._lock:
                conn = self._get_conn()
                try:
                    for (flow_id, index_data, detail_json,
                         req_body, req_ref, res_body, res_ref) in batch:
                        self._insert_flow_rows(
                            conn, flow_id, session_id,
                            index_data, detail_json,
                            req_body, req_ref, res_body, res_ref
                        )
                    conn.commit()
                    stored += len(batch)
                    self._last_write_ts = time.time()
                except Exception as e:
                    conn.rollback()
                    self.logger.error(
                        f"store_flows_batch: batch commit failed at offset "
                        f"{batch_start}: {e}"
                    )
                    errors += len(batch)

        # Update session stats once at the end
        if stored > 0:
            with self._lock:
                conn = self._get_conn()
                conn.execute(
                    "UPDATE sessions SET updated_at = ? WHERE id = ?",
                    (time.time(), session_id)
                )
                conn.commit()

        elapsed_ms = (time.time() - t0) * 1000
        self.logger.info(
            f"store_flows_batch: {stored} flows stored in {elapsed_ms:.0f}ms "
            f"({len(flows)} total, {errors} errors, "
            f"batch_size={batch_size})"
        )
        return stored

    def _extract_index(self, flow_data: Dict, session_id: str) -> Dict:
        """Extract index fields from flow data"""
        req = flow_data.get('request') or {}
        res = flow_data.get('response') or {}
        rc = flow_data.get('_rc') or {}

        return {
            'id': flow_data.get('id'),
            'session_id': session_id,
            'method': req.get('method', ''),
            'url': req.get('url', ''),
            'host': flow_data.get('host', ''),
            'path': flow_data.get('path', ''),
            'status': res.get('status', 0),
            'http_version': flow_data.get('httpVersion', '') or req.get('httpVersion', ''),
            'content_type': flow_data.get('contentType', ''),
            'started_datetime': flow_data.get('startedDateTime', ''),
            'time': flow_data.get('time', 0),
            'size': flow_data.get('size') or (flow_data.get('response') or {}).get('content', {}).get('size', 0),
            'client_ip': rc.get('clientIp', '') or flow_data.get('clientIp', ''),
            'app_name': rc.get('appName', '') or flow_data.get('appName', ''),
            'app_display_name': rc.get('appDisplayName', '') or flow_data.get('appDisplayName', ''),
            'has_error': 1 if rc.get('error') else 0,
            'has_request_body': 1 if (req.get('postData') or {}).get('text') else 0,
            'has_response_body': 1 if (res.get('content') or {}).get('text') else 0,
            'is_websocket': 1 if rc.get('isWebsocket') else 0,
            'websocket_frame_count': rc.get('websocketFrameCount', 0),
            'is_intercepted': 1 if (rc.get('intercept') or {}).get('intercepted') else 0,
            'hits': json.dumps(rc.get('hits', [])),
            'msg_ts': flow_data.get('msg_ts', time.time()),
        }

    def _process_body(self, flow_id: str, session_id: str, body: str, body_type: str) -> Tuple[bytes, str]:
        """
        Process body for storage.

        Returns: (compressed_data_or_None, storage_ref)
        """
        if not body:
            return None, 'inline'

        size = len(body.encode('utf-8'))

        # Too large - skip
        if size > Config.MAX_PERSIST_SIZE:
            return None, f'skipped:{size}'

        # Small - inline
        if size < Config.COMPRESS_THRESHOLD:
            return None, 'inline'

        # Medium - compress to BLOB
        if size < Config.FILE_THRESHOLD:
            compressed = gzip.compress(body.encode('utf-8'))
            return compressed, 'compressed'

        # Large - store as file
        filename = f"{flow_id}_{body_type[0]}.dat"
        session_dir = Path(self.body_dir) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        filepath = session_dir / filename
        with gzip.open(filepath, 'wt', encoding='utf-8') as f:
            f.write(body)

        return None, f'file:{filename}'

    def _get_placeholder(self, ref: str) -> str:
        """Get placeholder text for non-inline body"""
        if ref == 'compressed':
            return '__COMPRESSED__'
        if ref.startswith('file:'):
            return f'__FILE__'
        if ref.startswith('skipped:'):
            size = int(ref.split(':')[1])
            return f'<Body too large: {size // 1024 // 1024}MB>'
        return '__UNKNOWN__'

    # ==================== Flow Retrieval ====================

    def get_indices(self, session_id: str = None, since: float = 0, limit: int = None) -> List[Dict]:
        """Get flow indices for polling.

        Seq numbers are NOT included - frontend calculates them based on array position.
        Ordering is by msg_ts ascending (oldest first).

        Args:
            session_id: If provided, query this specific session. Otherwise use current active session.
            since: Only return flows with msg_ts >= since
            limit: Maximum number of results
        """
        import time as time_module
        t0 = time_module.time()
        
        # Only call _get_session_id if not provided
        if session_id is None:
            session_id = self._get_session_id(session_id)
            if session_id is None:
                # No active session, return empty
                return []

        def _query(conn):
            t1 = time_module.time()

            query = """
                SELECT * FROM flow_indices
                WHERE session_id = ? AND msg_ts >= ?
                ORDER BY msg_ts ASC
            """
            params = [session_id, since]

            if limit:
                query += " LIMIT ?"
                params.append(limit)

            rows = conn.execute(query, params).fetchall()
            t2 = time_module.time()

            result = []
            for row in rows:
                item = dict(row)
                # Parse hits JSON
                if item.get('hits'):
                    try:
                        item['hits'] = json.loads(item['hits'])
                    except:
                        item['hits'] = []
                else:
                    item['hits'] = []
                result.append(item)
            t3 = time_module.time()
            
            # Log if slow (>100ms) or large result set
            total_ms = (t3 - t0) * 1000
            if total_ms > 100 or len(result) > 100:
                self.logger.info(
                    f"get_indices ({total_ms:.0f}ms, {len(result)} rows): "
                    f"session={(t1-t0)*1000:.0f}ms, "
                    f"query={(t2-t1)*1000:.0f}ms, "
                    f"parse={(t3-t2)*1000:.0f}ms"
                )

            return result
        
        return self._execute_with_retry("get_indices", _query)

    def get_flow_seq(self, flow_id: str) -> Optional[int]:
        """Get sequence number for an existing flow, or None if not exists"""
        if not flow_id:
            return None
        conn = self._get_conn()
        row = conn.execute(
            "SELECT seq FROM flow_indices WHERE id = ?", (flow_id,)
        ).fetchone()
        return row['seq'] if row else None

    def get_detail(self, flow_id: str) -> Optional[Dict]:
        """Get full flow detail, loading bodies as needed"""
        import time as time_module
        t0 = time_module.time()
        
        def _query(conn):
            # Only select needed columns for better performance
            t1 = time_module.time()
            row = conn.execute("""
                SELECT id, session_id, data, request_body_ref, response_body_ref
                FROM flow_details WHERE id = ?
            """, (flow_id,)).fetchone()
            t2 = time_module.time()

            if not row:
                return None

            flow_data = json.loads(row['data'])
            session_id = row['session_id']
            req_ref = row['request_body_ref']
            res_ref = row['response_body_ref']
            t3 = time_module.time()

            # Batch load compressed bodies in a single query for better performance
            compressed_bodies = {}
            if (req_ref == 'compressed' or res_ref == 'compressed'):
                body_rows = conn.execute("""
                    SELECT type, data FROM flow_bodies WHERE flow_id = ?
                """, (flow_id,)).fetchall()
                for body_row in body_rows:
                    compressed_bodies[body_row['type']] = body_row['data']
            t4 = time_module.time()

            # Restore request body
            if req_ref and req_ref != 'inline':
                body = self._load_body(conn, flow_id, session_id, req_ref, 'request', compressed_bodies)
                if body and flow_data.get('request', {}).get('postData'):
                    flow_data['request']['postData']['text'] = body

            # Restore response body
            if res_ref and res_ref != 'inline':
                body = self._load_body(conn, flow_id, session_id, res_ref, 'response', compressed_bodies)
                if body and flow_data.get('response', {}).get('content'):
                    flow_data['response']['content']['text'] = body
            t5 = time_module.time()
            
            # Log if slow (>100ms)
            total_ms = (t5 - t0) * 1000
            if total_ms > 100:
                self.logger.info(
                    f"get_detail SLOW ({total_ms:.0f}ms): "
                    f"conn={(t1-t0)*1000:.0f}ms, "
                    f"query={(t2-t1)*1000:.0f}ms, "
                    f"json={(t3-t2)*1000:.0f}ms, "
                    f"bodies={(t4-t3)*1000:.0f}ms, "
                    f"restore={(t5-t4)*1000:.0f}ms"
                )

            return flow_data
        
        return self._execute_with_retry("get_detail", _query)

    def _load_body(self, conn, flow_id: str, session_id: str, ref: str, body_type: str,
                   compressed_bodies: Dict = None) -> Optional[str]:
        """Load body from appropriate storage

        Args:
            conn: Database connection
            flow_id: Flow ID
            session_id: Session ID
            ref: Body reference (inline, compressed, file:xxx, skipped:xxx)
            body_type: 'request' or 'response'
            compressed_bodies: Pre-loaded compressed bodies dict (for batch optimization)
        """
        if ref == 'inline':
            return None

        if ref == 'compressed':
            # Use pre-loaded bodies if available
            if compressed_bodies and body_type in compressed_bodies:
                return gzip.decompress(compressed_bodies[body_type]).decode('utf-8')

            row = conn.execute("""
                SELECT data FROM flow_bodies
                WHERE flow_id = ? AND type = ?
            """, (flow_id, body_type)).fetchone()

            if row:
                return gzip.decompress(row['data']).decode('utf-8')
            return None

        if ref.startswith('file:'):
            filename = ref[5:]
            filepath = Path(self.body_dir) / session_id / filename

            if filepath.exists():
                with gzip.open(filepath, 'rt', encoding='utf-8') as f:
                    return f.read()
            return None

        if ref.startswith('skipped:'):
            size = int(ref.split(':')[1])
            return f'<Body not persisted (too large: {size // 1024 // 1024}MB)>'

        return None

    def get_all_flows(self, session_id: str = None) -> List[Dict]:
        """Get all flows for export - optimized batch loading

        WARNING: For large sessions, use export_to_file_iter() instead to avoid memory issues.
        """
        session_id = self._get_session_id(session_id)

        conn = self._get_conn()

        # Batch load all flow data in one query
        rows = conn.execute("""
            SELECT fd.id, fd.data, fd.request_body_ref, fd.response_body_ref
            FROM flow_details fd
            JOIN flow_indices fi ON fd.id = fi.id
            WHERE fd.session_id = ?
            ORDER BY fi.msg_ts
        """, (session_id,)).fetchall()

        # Batch load all compressed bodies
        body_cache = {}
        body_rows = conn.execute("""
            SELECT flow_id, type, data FROM flow_bodies WHERE session_id = ?
        """, (session_id,)).fetchall()
        for row in body_rows:
            key = (row['flow_id'], row['type'])
            body_cache[key] = row['data']

        flows = []
        for row in rows:
            try:
                flow_data = json.loads(row['data'])
                flow_id = row['id']
                req_ref = row['request_body_ref']
                res_ref = row['response_body_ref']

                # Restore request body
                if req_ref and req_ref == 'compressed':
                    cache_key = (flow_id, 'request')
                    if cache_key in body_cache:
                        body = gzip.decompress(body_cache[cache_key]).decode('utf-8')
                        if flow_data.get('request', {}).get('postData'):
                            flow_data['request']['postData']['text'] = body

                # Restore response body
                if res_ref and res_ref == 'compressed':
                    cache_key = (flow_id, 'response')
                    if cache_key in body_cache:
                        body = gzip.decompress(body_cache[cache_key]).decode('utf-8')
                        if flow_data.get('response', {}).get('content'):
                            flow_data['response']['content']['text'] = body

                flows.append(flow_data)
            except Exception as e:
                # Skip corrupted entries
                pass

        return flows

    def export_to_file_iter(self, file_path: str, session_id: str = None,
                            format: str = 'har', metadata: Dict = None,
                            progress_callback=None):
        """Stream export flows to file to avoid memory issues with large sessions.

        Args:
            file_path: Output file path
            session_id: Session to export (default: current session)
            format: 'har' or 'session'
            metadata: Optional metadata dict (for session format)
            progress_callback: Optional callback(current, total) for progress

        Yields progress as (current, total) tuples.
        """
        import gzip as gzip_module

        session_id = self._get_session_id(session_id)
        conn = self._get_conn()

        # Get total count for progress
        total = conn.execute(
            "SELECT COUNT(*) FROM flow_indices WHERE session_id = ?", (session_id,)
        ).fetchone()[0]

        if total == 0:
            # Write empty file with correct structure
            with open(file_path, 'w', encoding='utf-8') as f:
                if format == 'har':
                    json.dump({"log": {"version": "1.2", "creator": {"name": "RelayCraft", "version": "1.0"}, "entries": []}}, f)
                else:
                    # Session format must match Rust struct
                    inner_meta = metadata.get("metadata", {}) if metadata else {}
                    session_metadata = {
                        "createdAt": inner_meta.get("createdAt", int(time.time() * 1000)),
                        "duration": inner_meta.get("duration", 0),
                        "flowCount": inner_meta.get("flowCount", 0),
                        "sizeBytes": inner_meta.get("sizeBytes", 0),
                        "clientInfo": inner_meta.get("clientInfo"),
                        "networkCondition": inner_meta.get("networkCondition"),
                        "viewState": inner_meta.get("viewState"),
                    }
                    session_obj = {
                        "id": metadata.get("id", "") if metadata else "",
                        "name": metadata.get("name", "") if metadata else "",
                        "description": metadata.get("description") if metadata else None,
                        "metadata": session_metadata,
                        "flows": []
                    }
                    json.dump(session_obj, f, ensure_ascii=False)
            return

        # Load all compressed bodies (smaller when compressed)
        body_cache = {}
        body_rows = conn.execute("""
            SELECT flow_id, type, data FROM flow_bodies WHERE session_id = ?
        """, (session_id,)).fetchall()
        for row in body_rows:
            key = (row['flow_id'], row['type'])
            body_cache[key] = row['data']

        # Memory-efficient cursor iteration
        cursor = conn.execute("""
            SELECT fd.id, fd.data, fd.request_body_ref, fd.response_body_ref
            FROM flow_details fd
            JOIN flow_indices fi ON fd.id = fi.id
            WHERE fd.session_id = ?
            ORDER BY fi.msg_ts
        """, (session_id,))

        with open(file_path, 'w', encoding='utf-8') as f:
            if format == 'har':
                f.write('{"log":{"version":"1.2","creator":{"name":"RelayCraft","version":"1.0"},"entries":[')
            else:
                # Session format must match Rust Session struct:
                # { id, name, description?, metadata, flows }
                # Ensure metadata has all required fields with defaults
                inner_meta = metadata.get("metadata", {}) if metadata else {}
                session_metadata = {
                    "createdAt": inner_meta.get("createdAt", int(time.time() * 1000)),
                    "duration": inner_meta.get("duration", 0),
                    "flowCount": inner_meta.get("flowCount", 0),
                    "sizeBytes": inner_meta.get("sizeBytes", 0),
                    "clientInfo": inner_meta.get("clientInfo"),
                    "networkCondition": inner_meta.get("networkCondition"),
                    "viewState": inner_meta.get("viewState"),
                }
                session_obj = {
                    "id": metadata.get("id", "") if metadata else "",
                    "name": metadata.get("name", "") if metadata else "",
                    "description": metadata.get("description") if metadata else None,
                    "metadata": session_metadata,
                }
                # Write session header (without flows yet)
                # Remove the closing brace to add flows array
                header = json.dumps(session_obj, ensure_ascii=False)
                # header ends with }, we need to replace it with ,"flows":[
                if header.endswith('}'):
                    header = header[:-1] + ',"flows":['
                f.write(header)

            first = True
            current = 0

            for row in cursor:
                try:
                    flow_data = json.loads(row['data'])
                    flow_id = row['id']
                    req_ref = row['request_body_ref']
                    res_ref = row['response_body_ref']

                    # Restore request body
                    if req_ref and req_ref == 'compressed':
                        cache_key = (flow_id, 'request')
                        if cache_key in body_cache:
                            body = gzip_module.decompress(body_cache[cache_key]).decode('utf-8')
                            if flow_data.get('request', {}).get('postData'):
                                flow_data['request']['postData']['text'] = body

                    # Restore response body
                    if res_ref and res_ref == 'compressed':
                        cache_key = (flow_id, 'response')
                        if cache_key in body_cache:
                            body = gzip_module.decompress(body_cache[cache_key]).decode('utf-8')
                            if flow_data.get('response', {}).get('content'):
                                flow_data['response']['content']['text'] = body

                    if not first:
                        f.write(',')
                    first = False

                    f.write(json.dumps(flow_data, ensure_ascii=False))
                    current += 1

                    # Report progress every 1000 items
                    if progress_callback and current % 1000 == 0:
                        progress_callback(current, total)

                except Exception as e:
                    pass  # Skip corrupted entries

            if format == 'har':
                f.write(']}}')
            else:
                f.write(']}')

        # Final progress callback
        if progress_callback:
            progress_callback(total, total)

    def get_flow_count(self, session_id: str = None) -> int:
        """Get total flow count for a session"""
        session_id = self._get_session_id(session_id)
        conn = self._get_conn()
        row = conn.execute(
            "SELECT COUNT(*) FROM flow_indices WHERE session_id = ?", (session_id,)
        ).fetchone()
        return row[0] if row else 0

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
        """Run WAL checkpoint.

        Args:
            mode: 'PASSIVE' (non-blocking, use during active traffic),
                  'TRUNCATE' (blocks until all readers done, shrinks WAL file,
                              use only when traffic is idle).
        """
        _VALID_WAL_MODES = {'PASSIVE', 'TRUNCATE', 'RESTART', 'FULL'}
        mode = mode.upper()
        if mode not in _VALID_WAL_MODES:
            self.logger.warning(f"Invalid WAL checkpoint mode: {mode}, falling back to PASSIVE")
            mode = 'PASSIVE'

        try:
            conn = self._get_conn()
            result = conn.execute(f"PRAGMA wal_checkpoint({mode})").fetchone()
            # result is (busy, log, checkpointed)
            if result:
                busy, log_pages, checkpointed = result[0], result[1], result[2]
                if mode == 'TRUNCATE':
                    self.logger.info(
                        f"WAL TRUNCATE checkpoint: busy={busy}, "
                        f"log={log_pages}, checkpointed={checkpointed}"
                    )
                elif busy > 0:
                    self.logger.debug(f"WAL PASSIVE checkpoint busy: {result}")
        except sqlite3.Error as e:
            self.logger.warning(f"WAL checkpoint ({mode}) error: {e}")

    def _run_cleanup(self):
        """Clean up old data and enforce total flow limit
        
        This runs periodically (every CLEANUP_INTERVAL seconds) in a background thread.
        
        IMPORTANT: This method uses _cleanup_lock (not _lock) to avoid blocking
        normal database operations like store_flow and get_indices.
        
        Performs:
        1. Delete flows older than MAX_FLOW_AGE_DAYS
        2. Enforce total flow limit (delete oldest if exceeds MAX_TOTAL_FLOWS)
        3. Clean up empty sessions (0 flows)
        4. Clean up old sessions (keep MAX_SESSIONS)
        5. Database size check and warning
        6. WAL checkpoint
        7. Index optimization (PRAGMA optimize)
        8. Integrity check (quick)
        """
        # Use cleanup lock - this allows normal operations to continue
        # while cleanup is running. The cleanup lock only prevents
        # concurrent cleanup operations.
        with self._cleanup_lock:
            conn = self._get_conn()
            cleanup_start = time.time()
            deleted_flows = 0
            deleted_sessions = 0

            # 1. Delete flows older than MAX_FLOW_AGE_DAYS (按天清理)
            if Config.MAX_FLOW_AGE_DAYS > 0:
                age_threshold = time.time() - (Config.MAX_FLOW_AGE_DAYS * 24 * 60 * 60)
                old_flows = conn.execute("""
                    SELECT id, session_id FROM flow_indices
                    WHERE msg_ts < ?
                """, (age_threshold,)).fetchall()
                
                if old_flows:
                    self.logger.info(
                        f"Deleting {len(old_flows)} flows older than {Config.MAX_FLOW_AGE_DAYS} days"
                    )
                    for row in old_flows:
                        flow_id = row['id']
                        session_id = row['session_id']
                        self._delete_body_files(session_id, [flow_id])
                        conn.execute("DELETE FROM flow_bodies WHERE flow_id = ?", (flow_id,))
                        conn.execute("DELETE FROM flow_details WHERE id = ?", (flow_id,))
                        conn.execute("DELETE FROM flow_indices WHERE id = ?", (flow_id,))
                        deleted_flows += 1

            # 2. Enforce TOTAL flow limit (SQLite performance depends on total records)
            total_count = conn.execute("SELECT COUNT(*) FROM flow_indices").fetchone()[0]

            if total_count > Config.MAX_TOTAL_FLOWS:
                excess = total_count - Config.MAX_TOTAL_FLOWS
                self.logger.info(
                    f"Total flows ({total_count}) exceeds limit ({Config.MAX_TOTAL_FLOWS}), "
                    f"deleting {excess} oldest flows"
                )
                # Delete oldest flows across ALL sessions
                old_flows = conn.execute("""
                    SELECT id, session_id FROM flow_indices
                    ORDER BY msg_ts ASC
                    LIMIT ?
                """, (excess,)).fetchall()

                for row in old_flows:
                    flow_id = row['id']
                    session_id = row['session_id']
                    # Delete body files
                    self._delete_body_files(session_id, [flow_id])
                    # Delete from database
                    conn.execute("DELETE FROM flow_bodies WHERE flow_id = ?", (flow_id,))
                    conn.execute("DELETE FROM flow_details WHERE id = ?", (flow_id,))
                    conn.execute("DELETE FROM flow_indices WHERE id = ?", (flow_id,))
                    deleted_flows += 1

            # 3. Update session flow counts and clean up empty sessions
            conn.execute("""
                UPDATE sessions SET flow_count = (
                    SELECT COUNT(*) FROM flow_indices WHERE session_id = sessions.id
                )
            """)
            
            # Delete empty sessions (except default and active sessions)
            empty_sessions = conn.execute("""
                SELECT id FROM sessions
                WHERE id != 'default'
                AND is_active = 0
                AND flow_count = 0
            """).fetchall()
            
            for row in empty_sessions:
                self.delete_session(row['id'])
                deleted_sessions += 1

            # 4. Check database size and warn if too large
            db_size_mb = 0
            try:
                db_size_mb = os.path.getsize(self.db_path) / (1024 * 1024)
                if db_size_mb > Config.MAX_DB_SIZE_MB:
                    self.logger.warning(
                        f"Database size ({db_size_mb:.1f}MB) exceeds "
                        f"limit ({Config.MAX_DB_SIZE_MB}MB)."
                    )
                    self.push_notification(
                        title_key='database.notifications.storage_warning_title',
                        message_key='database.notifications.storage_warning_msg',
                        params={'size_mb': f'{db_size_mb:.0f}'},
                        n_type='warning',
                        priority='high',
                    )
            except Exception:
                pass

            # 6. Perform WAL checkpoint to merge WAL file into main database
            # Use PASSIVE mode to avoid blocking - it will checkpoint what it can
            # without waiting for readers. TRUNCATE mode can block indefinitely
            # when there are continuous readers (like frontend polling).
            checkpoint_result = None
            try:
                # PASSIVE: checkpoint without blocking readers/writers
                checkpoint_result = conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
                # result is (busy, log, checkpointed)
                if checkpoint_result and checkpoint_result[0] > 0:
                    self.logger.debug(f"WAL checkpoint partial: {checkpoint_result}")
            except Exception as e:
                pass  # Ignore checkpoint errors

            # 7. Optimize indexes (analyzes tables and updates statistics)
            try:
                conn.execute("PRAGMA optimize")
            except Exception:
                pass

            # 8. Quick integrity check (only if database is small enough)
            integrity_ok = True
            if db_size_mb < 1000:  # Skip for very large databases
                try:
                    result = conn.execute("PRAGMA quick_check").fetchone()
                    integrity_ok = result[0] == 'ok' if result else False
                    if not integrity_ok:
                        self.logger.error(f"Database integrity check failed: {result}")
                except Exception:
                    pass

            conn.commit()

            # 9. Conditional VACUUM if we deleted a lot of data
            if deleted_flows > max(1000, total_count * 0.1):
                self.logger.info(f"Running VACUUM after deleting {deleted_flows} flows...")
                try:
                    conn.execute("VACUUM")
                    conn.commit()
                except Exception as e:
                    self.logger.error(f"VACUUM failed: {e}")

            # Log cleanup summary (always)
            cleanup_time = (time.time() - cleanup_start) * 1000
            self.logger.info(
                f"Cleanup: deleted {deleted_sessions} sessions, {deleted_flows} flows "
                f"in {cleanup_time:.0f}ms "
                f"(db={db_size_mb:.0f}MB, integrity={'ok' if integrity_ok else 'FAIL'})"
            )

            # Notify frontend if any data was actually deleted
            if deleted_flows > 0 or deleted_sessions > 0:
                self.push_notification(
                    title_key='database.notifications.cleanup_title',
                    message_key='database.notifications.cleanup_msg',
                    params={
                        'flows': deleted_flows,
                        'sessions': deleted_sessions,
                    },
                    n_type='info',
                    priority='low',
                )

    def _delete_body_files(self, session_id: str, flow_ids: List[str] = None):
        """Delete body files for given flows or entire session directory.
        
        If flow_ids is None, the entire session directory is removed (much faster).
        """
        session_dir = Path(self.body_dir) / session_id

        if not session_dir.exists():
            return

        if flow_ids is None:
            # Delete entire directory - much faster for large sessions
            try:
                shutil.rmtree(session_dir)
                self.logger.debug(f"Removed session directory: {session_dir}")
            except Exception as e:
                self.logger.error(f"Error removing session directory {session_dir}: {e}")
        else:
            # Delete individual files (used for incremental cleanup)
            for flow_id in flow_ids:
                for suffix in ['_r.dat', '_s.dat', '_req.dat', '_res.dat']:
                    filepath = session_dir / f"{flow_id}{suffix}"
                    if filepath.exists():
                        try:
                            filepath.unlink()
                        except:
                            pass

    def clear_session(self, session_id: str = None):
        """Clear all flows in a session.

        Uses directory-level deletion for body files (fast), instead of
        the old approach of listing every flow_id then deleting files one-by-one
        while holding the write lock.
        """
        session_id = self._get_session_id(session_id)

        # Delete body files outside the lock — rmtree the whole session dir
        self._delete_body_files(session_id)  # flow_ids=None → deletes entire dir

        with self._lock:
            conn = self._get_conn()

            # CASCADE on sessions→flow_indices→flow_details/flow_bodies handles
            # child rows, but we need explicit deletes here because we are NOT
            # deleting the session row itself.
            conn.execute("DELETE FROM flow_bodies WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM flow_details WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM flow_indices WHERE session_id = ?", (session_id,))

            conn.execute("""
                UPDATE sessions SET
                    flow_count = 0,
                    total_size = 0,
                    updated_at = ?
                WHERE id = ?
            """, (time.time(), session_id))

            conn.commit()

    # ==================== Utility ====================

    def get_stats(self) -> Dict:
        """Get database statistics"""
        conn = self._get_conn()

        sessions = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        total_flows = conn.execute("SELECT COUNT(*) FROM flow_indices").fetchone()[0]
        total_size = conn.execute("SELECT COALESCE(SUM(size), 0) FROM flow_indices").fetchone()[0]

        # Database file size
        db_size = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0

        # Body files size
        body_size = 0
        body_path = Path(self.body_dir)
        if body_path.exists():
            for f in body_path.rglob('*.dat'):
                body_size += f.stat().st_size

        return {
            'sessions': sessions,
            'total_flows': total_flows,
            'total_size': total_size,
            'db_size': db_size,
            'body_files_size': body_size,
            'disk_usage': db_size + body_size,
        }

    def vacuum(self, full: bool = False):
        """Run VACUUM to reclaim space and defragment database.

        Uses _lock (the write lock) to ensure exclusive access — VACUUM requires
        no other writers or readers on the same connection. Previously used
        _cleanup_lock which did not prevent concurrent store_flow() calls from
        hitting SQLite 'database is locked' and triggering 30-second timeouts.

        Args:
            full: If True, always run VACUUM. If False, only run if >20% pages free.
        """
        with self._lock:  # Must use write lock, not _cleanup_lock
            conn = self._get_conn()

            if not full:
                try:
                    result = conn.execute("PRAGMA freelist_count").fetchone()
                    free_pages = result[0] if result else 0
                    result = conn.execute("PRAGMA page_count").fetchone()
                    total_pages = result[0] if result else 1
                    if free_pages / total_pages < 0.2:
                        self.logger.info(
                            f"VACUUM skipped: only {free_pages}/{total_pages} free pages"
                        )
                        return
                except Exception:
                    pass

            self.logger.info("Starting VACUUM...")
            start_time = time.time()
            try:
                conn.execute("VACUUM")
                conn.commit()
                elapsed = time.time() - start_time
                new_size_mb = os.path.getsize(self.db_path) / (1024 * 1024)
                self.logger.info(
                    f"VACUUM completed in {elapsed:.1f}s, "
                    f"database size: {new_size_mb:.1f}MB"
                )
            except Exception as e:
                self.logger.error(f"VACUUM failed: {e}")

    def reindex(self):
        """Rebuild all indexes to fix potential corruption and improve performance"""
        with self._lock:
            conn = self._get_conn()
            self.logger.info("Starting REINDEX...")
            start_time = time.time()
            
            try:
                conn.execute("REINDEX")
                conn.commit()
                elapsed = time.time() - start_time
                self.logger.info(f"REINDEX completed in {elapsed:.1f}s")
            except Exception as e:
                self.logger.error(f"REINDEX failed: {e}")

    def close(self):
        """Close database connection and stop cleanup thread"""
        # Stop the background cleanup thread first
        self._stop_cleanup_thread()
        
        if hasattr(self._local, 'conn') and self._local.conn:
            self._local.conn.close()
            self._local.conn = None
