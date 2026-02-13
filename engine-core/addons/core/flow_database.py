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
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from contextlib import contextmanager
from datetime import datetime


# ==================== Configuration ====================

class Config:
    """Database configuration"""
    # Storage thresholds
    COMPRESS_THRESHOLD = 10 * 1024        # 10KB - compress if larger
    FILE_THRESHOLD = 1 * 1024 * 1024      # 1MB - store as file if larger
    MAX_PERSIST_SIZE = 50 * 1024 * 1024   # 50MB - skip persistence if larger

    # Limits
    # MAX_FLOWS_PER_SESSION removed - no limit, let user's disk be the only constraint
    MAX_SESSIONS = 100                     # Max sessions to keep

    # Cleanup
    CLEANUP_INTERVAL = 300                 # Seconds between cleanup runs

    # Database
    DB_PATH = os.path.expanduser("~/.relaycraft/traffic.db")
    BODY_DIR = os.path.expanduser("~/.relaycraft/bodies")


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
    content_type TEXT,
    started_datetime TEXT NOT NULL,
    time REAL NOT NULL,
    size INTEGER NOT NULL,

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
CREATE INDEX IF NOT EXISTS idx_bodies_flow ON flow_bodies(flow_id);
"""


# ==================== FlowDatabase Class ====================

class FlowDatabase:
    """
    SQLite-based flow persistence layer.

    Thread-safe via connection-per-thread and lock for writes.
    """

    def __init__(self, db_path: str = None, body_dir: str = None):
        self.db_path = db_path or Config.DB_PATH
        self.body_dir = body_dir or Config.BODY_DIR

        # Ensure directories exist
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        os.makedirs(self.body_dir, exist_ok=True)

        # Thread-local storage for connections
        self._local = threading.local()
        self._lock = threading.Lock()

        # Initialize database
        self._init_db()

        # Get or create active session
        # Frontend decides when to create new session via API
        # Backend just uses whatever session is currently active
        self._current_session_id = self._get_active_session_id()

        # Cleanup old sessions (keep 5 most recent, delete after 7 days)
        self._cleanup_old_sessions(keep_count=5, max_age_days=7)

        # Last cleanup time
        self._last_cleanup = time.time()

    def _get_active_session_id(self) -> str:
        """Get current active session ID, or create default if none exists.

        Backend always reuses existing active session.
        Frontend calls create_new_session_for_app_start() on app launch to create new session.
        This gives clear semantics:
        - App restart (close & reopen) = new session (frontend triggers)
        - Proxy restart (stop & start) = same session (backend reuses)
        """
        conn = self._get_conn()
        row = conn.execute("""
            SELECT id FROM sessions WHERE is_active = 1 LIMIT 1
        """).fetchone()

        if row:
            return row[0]
        else:
            # No active session - create default
            return self._create_new_session()

    def create_new_session_for_app_start(self) -> str:
        """Create a new session when app starts (called from frontend).

        This is the only way to create a new session during normal operation.
        Proxy stop/start will NOT create new sessions.
        """
        return self._create_new_session()

    def _get_conn(self) -> sqlite3.Connection:
        """Get thread-local connection"""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            self._local.conn = sqlite3.connect(
                self.db_path,
                check_same_thread=False
            )
            self._local.conn.row_factory = sqlite3.Row
            # Enable WAL mode for better concurrency
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA synchronous=NORMAL")
            self._local.conn.execute("PRAGMA foreign_keys=ON")
        return self._local.conn

    def _init_db(self):
        """Initialize database schema and run migrations"""
        conn = self._get_conn()
        conn.executescript(SCHEMA)
        conn.commit()

        # Migration: Remove seq column if it exists (from older versions)
        self._migrate_remove_seq_column()

    def _migrate_remove_seq_column(self):
        """Migration: Remove seq column from flow_indices table.

        SQLite doesn't support DROP COLUMN in older versions,so we need to
        recreate the table.
        """
        conn = self._get_conn()

        # Check if seq column exists
        cursor = conn.execute("PRAGMA table_info(flow_indices)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'seq' not in columns:
            return  # Already migrated

        # Create new table without seq column
        conn.execute("""
            CREATE TABLE IF NOT EXISTS flow_indices_new (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,

                method TEXT NOT NULL,
                url TEXT NOT NULL,
                host TEXT NOT NULL,
                path TEXT NOT NULL,
                status INTEGER NOT NULL,
                content_type TEXT,
                started_datetime TEXT NOT NULL,
                time REAL NOT NULL,
                size INTEGER NOT NULL,

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
            )
        """)

        # Copy data (excluding seq column)
        conn.execute("""
            INSERT INTO flow_indices_new
            SELECT id, session_id, method, url, host, path, status, content_type,
                   started_datetime, time, size, has_error, has_request_body,
                   has_response_body, is_websocket, websocket_frame_count,
                   is_intercepted, hits, msg_ts, created_at
            FROM flow_indices
        """)

        # Drop old table and rename new one
        conn.execute("DROP TABLE flow_indices")
        conn.execute("ALTER TABLE flow_indices_new RENAME TO flow_indices")

        # Recreate indexes
        conn.execute("CREATE INDEX IF NOT EXISTS idx_indices_session_ts ON flow_indices(session_id, msg_ts DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_indices_session_host ON flow_indices(session_id, host)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_indices_session_status ON flow_indices(session_id, status)")

        conn.commit()

    def _create_new_session(self) -> str:
        """Create a new session with timestamp name for auto-isolation.

        Each app start creates a new session to isolate traffic data.
        Old sessions are automatically cleaned up.
        """
        from datetime import datetime

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

        return session_id

    def _cleanup_old_sessions(self, keep_count: int = 5, max_age_days: int = 7):
        """Clean up old sessions to prevent database bloat.

        Args:
            keep_count: Keep at most this many recent sessions (default 5)
            max_age_days: Delete sessions older than this many days (default 7)
        """
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

    def _ensure_default_session(self):
        """Ensure default session exists and is active"""
        conn = self._get_conn()
        cursor = conn.execute("SELECT id FROM sessions WHERE id = 'default'")
        if not cursor.fetchone():
            now = time.time()
            conn.execute("""
                INSERT INTO sessions (id, name, created_at, updated_at, is_active)
                VALUES ('default', 'Default Session', ?, ?, 1)
            """, (now, now))
        else:
            # Ensure default session is active
            conn.execute("UPDATE sessions SET is_active = 0")
            conn.execute("UPDATE sessions SET is_active = 1 WHERE id = 'default'")
        conn.commit()

    # ==================== Session Management ====================

    def _get_session_id(self, session_id: str = None) -> str:
        """Get session ID, using current session or ensuring active session exists."""
        if session_id:
            return session_id
        # Use cached current session ID for performance
        if hasattr(self, '_current_session_id') and self._current_session_id:
            return self._current_session_id
        active_session = self.get_active_session()
        if not active_session:
            self._ensure_default_session()
            active_session = self.get_active_session()
        return active_session['id']

    def create_session(self, name: str, description: str = None, metadata: dict = None) -> str:
        """Create a new session"""
        session_id = str(uuid.uuid4())[:8]
        now = time.time()

        with self._lock:
            conn = self._get_conn()
            conn.execute("""
                INSERT INTO sessions (id, name, description, created_at, updated_at, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                name,
                description,
                now,
                now,
                json.dumps(metadata) if metadata else None
            ))
            conn.commit()

        return session_id

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
        """List all sessions"""
        conn = self._get_conn()
        rows = conn.execute("""
            SELECT * FROM sessions ORDER BY updated_at DESC
        """).fetchall()
        return [dict(row) for row in rows]

    def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its flows"""
        if session_id == 'default':
            return False

        with self._lock:
            conn = self._get_conn()

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
            conn.commit()

        return True

    def update_session_stats(self, session_id: str):
        """Update session statistics"""
        with self._lock:
            conn = self._get_conn()
            conn.execute("""
                UPDATE sessions SET
                    flow_count = (SELECT COUNT(*) FROM flow_indices WHERE session_id = ?),
                    total_size = (SELECT COALESCE(SUM(size), 0) FROM flow_indices WHERE session_id = ?),
                    updated_at = ?
                WHERE id = ?
            """, (session_id, session_id, time.time(), session_id))
            conn.commit()

    # ==================== Flow Storage ====================

    def store_flow(self, flow_data: Dict, session_id: str = None) -> bool:
        """
        Store a flow with tiered body storage.

        Returns True if successful.
        """
        session_id = self._get_session_id(session_id)

        flow_id = flow_data.get('id')
        if not flow_id:
            return False

        # Extract index fields
        index_data = self._extract_index(flow_data, session_id)

        # Process bodies and get refs (use 'or {}' to handle explicit None values)
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

        # Update flow data with processed bodies
        flow_data_clean = json.loads(json.dumps(flow_data))
        if req_ref != 'inline':
            req_clean = flow_data_clean.get('request') or {}
            if req_clean.get('postData'):
                req_clean['postData']['text'] = self._get_placeholder(req_ref)
        if res_ref != 'inline':
            res_clean = flow_data_clean.get('response') or {}
            if res_clean.get('content'):
                res_clean['content']['text'] = self._get_placeholder(res_ref)

        with self._lock:
            conn = self._get_conn()

            try:
                # Store index
                conn.execute("""
                    INSERT OR REPLACE INTO flow_indices (
                        id, session_id, method, url, host, path, status,
                        content_type, started_datetime, time, size,
                        has_error, has_request_body, has_response_body,
                        is_websocket, websocket_frame_count, is_intercepted,
                        hits, msg_ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    index_data['id'],
                    index_data['session_id'],
                    index_data['method'],
                    index_data['url'],
                    index_data['host'],
                    index_data['path'],
                    index_data['status'],
                    index_data['content_type'],
                    index_data['started_datetime'],
                    index_data['time'],
                    index_data['size'],
                    index_data['has_error'],
                    index_data['has_request_body'],
                    index_data['has_response_body'],
                    index_data['is_websocket'],
                    index_data['websocket_frame_count'],
                    index_data['is_intercepted'],
                    index_data['hits'],
                    index_data['msg_ts'],
                ))

                # Store detail
                conn.execute("""
                    INSERT OR REPLACE INTO flow_details
                    (id, session_id, data, request_body_ref, response_body_ref)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    flow_id,
                    session_id,
                    json.dumps(flow_data_clean, ensure_ascii=False),
                    req_ref,
                    res_ref
                ))

                # Store compressed bodies
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

                # Update session timestamp (for session reuse detection)
                conn.execute("""
                    UPDATE sessions SET updated_at = ? WHERE id = ?
                """, (time.time(), session_id))

                conn.commit()

            except Exception as e:
                conn.rollback()
                raise e

        # Periodic cleanup
        self._maybe_cleanup()

        return True

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
            'content_type': flow_data.get('contentType', ''),
            'started_datetime': flow_data.get('startedDateTime', ''),
            'time': flow_data.get('time', 0),
            'size': flow_data.get('size', 0),
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
        """
        session_id = self._get_session_id(session_id)

        conn = self._get_conn()

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

        return result

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
        conn = self._get_conn()

        row = conn.execute("""
            SELECT * FROM flow_details WHERE id = ?
        """, (flow_id,)).fetchone()

        if not row:
            return None

        flow_data = json.loads(row['data'])
        session_id = row['session_id']

        # Restore request body
        req_ref = row['request_body_ref']
        if req_ref and req_ref != 'inline':
            body = self._load_body(conn, flow_id, session_id, req_ref, 'request')
            if body and flow_data.get('request', {}).get('postData'):
                flow_data['request']['postData']['text'] = body

        # Restore response body
        res_ref = row['response_body_ref']
        if res_ref and res_ref != 'inline':
            body = self._load_body(conn, flow_id, session_id, res_ref, 'response')
            if body and flow_data.get('response', {}).get('content'):
                flow_data['response']['content']['text'] = body

        return flow_data

    def _load_body(self, conn, flow_id: str, session_id: str, ref: str, body_type: str) -> Optional[str]:
        """Load body from appropriate storage"""
        if ref == 'inline':
            return None

        if ref == 'compressed':
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
        """Get all flows for export"""
        session_id = self._get_session_id(session_id)

        conn = self._get_conn()

        flow_ids = [
            row[0] for row in conn.execute(
                "SELECT id FROM flow_indices WHERE session_id = ? ORDER BY msg_ts", (session_id,)
            )
        ]

        flows = []
        for flow_id in flow_ids:
            flow = self.get_detail(flow_id)
            if flow:
                flows.append(flow)

        return flows

    # ==================== Cleanup ====================

    def _maybe_cleanup(self):
        """Run cleanup if interval has passed"""
        now = time.time()
        if now - self._last_cleanup > Config.CLEANUP_INTERVAL:
            self._last_cleanup = now
            self._run_cleanup()

    def _run_cleanup(self):
        """Clean up old data - only cleans up old sessions, no flow limit"""
        with self._lock:
            conn = self._get_conn()

            # Clean up old sessions (keep MAX_SESSIONS)
            old_sessions = conn.execute("""
                SELECT id FROM sessions
                WHERE id != 'default' AND is_active = 0
                ORDER BY updated_at DESC
                LIMIT -1 OFFSET ?
            """, (Config.MAX_SESSIONS - 1,)).fetchall()

            for row in old_sessions:
                self.delete_session(row['id'])

            # No flow limit - user's disk is the only constraint
            # Flows are only deleted when their session is deleted

            conn.commit()

    def _delete_body_files(self, session_id: str, flow_ids: List[str]):
        """Delete body files for given flows"""
        session_dir = Path(self.body_dir) / session_id

        if not session_dir.exists():
            return

        for flow_id in flow_ids:
            for suffix in ['_r.dat', '_s.dat', '_req.dat', '_res.dat']:
                filepath = session_dir / f"{flow_id}{suffix}"
                if filepath.exists():
                    try:
                        filepath.unlink()
                    except:
                        pass

    def clear_session(self, session_id: str = None):
        """Clear all flows in a session"""
        session_id = self._get_session_id(session_id)

        with self._lock:
            conn = self._get_conn()

            # Get flow IDs for file cleanup
            flow_ids = [
                row[0] for row in conn.execute(
                    "SELECT id FROM flow_indices WHERE session_id = ?", (session_id,)
                )
            ]

            # Delete body files
            self._delete_body_files(session_id, flow_ids)

            # Delete from database
            conn.execute("DELETE FROM flow_bodies WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM flow_details WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM flow_indices WHERE session_id = ?", (session_id,))

            # Update stats inline (avoid deadlock from nested lock)
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

    def vacuum(self):
        """Run VACUUM to reclaim space"""
        with self._lock:
            conn = self._get_conn()
            conn.execute("VACUUM")
            conn.commit()

    def close(self):
        """Close database connection"""
        if hasattr(self._local, 'conn') and self._local.conn:
            self._local.conn.close()
            self._local.conn = None
