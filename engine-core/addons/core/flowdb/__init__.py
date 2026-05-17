"""Flow database submodules package.

This package is the canonical home for flow persistence submodules.
Legacy module paths under ``addons.core`` are kept as compatibility shims.
"""

from .body_storage import get_placeholder, load_body, process_body
from .cleanup import (
    clear_session,
    delete_body_files,
    get_stats,
    reindex,
    run_cleanup,
    run_wal_checkpoint,
    vacuum,
)
from .export import export_to_file_iter, get_all_flows
from .flow_repo import (
    build_flow_data_clean,
    extract_index,
    get_detail,
    get_flow_seq,
    get_indices,
    insert_flow_rows,
    store_flow,
    store_flows_batch,
)
from .query_repo import get_flow_count, search_by_body, search_by_header, search_by_url
from .schema import Config, SCHEMA
from .session_repo import (
    create_new_session,
    create_session,
    delete_all_historical_sessions,
    delete_session,
    get_active_session,
    list_sessions,
    switch_session,
    update_session_flow_count,
    update_session_stats,
)
from .sse_event_repo import get_sse_events, store_sse_events

__all__ = [
    "Config",
    "SCHEMA",
    "process_body",
    "get_placeholder",
    "load_body",
    "create_new_session",
    "create_session",
    "update_session_flow_count",
    "get_active_session",
    "switch_session",
    "list_sessions",
    "delete_session",
    "delete_all_historical_sessions",
    "update_session_stats",
    "store_sse_events",
    "get_sse_events",
    "get_all_flows",
    "export_to_file_iter",
    "build_flow_data_clean",
    "store_flow",
    "insert_flow_rows",
    "store_flows_batch",
    "extract_index",
    "get_indices",
    "get_flow_seq",
    "get_detail",
    "run_wal_checkpoint",
    "run_cleanup",
    "delete_body_files",
    "clear_session",
    "get_stats",
    "vacuum",
    "reindex",
    "get_flow_count",
    "search_by_body",
    "search_by_header",
    "search_by_url",
]
