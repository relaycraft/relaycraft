"""
Capture Anchor for RelayCraft
This script MUST be loaded as the LAST addon (-s) to ensure it captures
the FINAL state of the flow after all other scripts have processed it.
"""
from mitmproxy import http, ctx
from typing import Optional, Any
from core.utils import setup_logging

logger = setup_logging()

def _get_relaycraft_main() -> Optional[Any]:
    """Safely retrieve the RelayCraft CoreAddon instance"""
    main = getattr(ctx.master, "relaycraft_main", None)
    if main and hasattr(main, "traffic_monitor") and main.traffic_monitor:
        return main
    return None

def _should_resync(flow: http.HTTPFlow) -> bool:
    """Check if flow needs to be re-captured after script/rule modifications"""
    # Check if rules modified the flow
    if flow.metadata.get("_relaycraft_dirty", False):
        return True

    # Check if scripts modified the flow (via injector tracking)
    if hasattr(flow, "_relaycraft_script_hits") and flow._relaycraft_script_hits:
        return True

    return False

def response(flow: http.HTTPFlow) -> None:
    """Trigger final traffic capture in CoreAddon if flow was modified"""
    # Skip internal requests
    if flow.request.path.startswith("/_relay"):
        return

    if not _should_resync(flow):
        return

    # Trigger final capture to pick up all modifications
    main = _get_relaycraft_main()
    if main:
        try:
            flow_data = main.traffic_monitor.process_flow(flow)
            if flow_data:
                # Use _store_flow instead of flow_buffer (which no longer exists)
                main.traffic_monitor._store_flow(flow_data)
                # Clear dirty flag after successful sync
                flow.metadata["_relaycraft_dirty"] = False
                # Clear script hits to avoid duplicate syncs
                if hasattr(flow, "_relaycraft_script_hits"):
                    flow._relaycraft_script_hits = []
        except Exception as e:
            logger.error(f"RelayCraft: Anchor sync error: {e}")

def error(flow: http.HTTPFlow) -> None:
    """Handle final error capture"""
    main = _get_relaycraft_main()
    if main:
        try:
            flow_data = main.traffic_monitor.process_flow(flow)
            if flow_data:
                flow_data["error"] = str(flow.error)
                # Use _store_flow instead of flow_buffer (which no longer exists)
                main.traffic_monitor._store_flow(flow_data)
        except:
            pass
