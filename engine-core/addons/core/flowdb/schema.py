"""Database configuration and schema for flow persistence."""

import os


class Config:
    """Database configuration."""

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
    is_sse INTEGER DEFAULT 0,
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

-- SSE events (event-level persistence for replay/history)
CREATE TABLE IF NOT EXISTS sse_events (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    event TEXT,
    event_id TEXT,
    retry INTEGER,
    data TEXT,
    raw_size INTEGER DEFAULT 0,

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
CREATE INDEX IF NOT EXISTS idx_sse_events_flow_seq ON sse_events(flow_id, seq);
CREATE INDEX IF NOT EXISTS idx_sse_events_session_flow ON sse_events(session_id, flow_id);
"""
