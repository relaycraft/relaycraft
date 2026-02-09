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

def response(flow: http.HTTPFlow) -> None:
    """Trigger final traffic capture in CoreAddon if flow is dirty"""
    # Skip internal requests and clean requests
    if flow.request.path.startswith("/_relay"):
        return
        
    if not flow.metadata.get("_relaycraft_dirty", False):
        return

    # Trigger final capture to pick up all modifications
    main = _get_relaycraft_main()
    if main:
        try:
            flow_data = main.traffic_monitor.process_flow(flow)
            if flow_data:
                main.traffic_monitor.flow_buffer.append(flow_data)
                # Clear dirty flag after successful sync
                flow.metadata["_relaycraft_dirty"] = False
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
                main.traffic_monitor.flow_buffer.append(flow_data)
        except:
            pass
