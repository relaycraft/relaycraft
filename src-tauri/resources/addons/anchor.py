"""
Capture Anchor for RelayCraft
This script MUST be loaded as the LAST addon (-s) to ensure it captures 
the FINAL state of the flow after all other scripts have processed it.
"""
from mitmproxy import ctx

def response(flow):
    """Trigger final traffic capture in CoreAddon if flow is dirty"""
    # Skip internal requests and clean requests
    if flow.request.path.startswith("/_relay"):
        return
        
    if not flow.metadata.get("_relaycraft_dirty", False):
        return

    # Trigger final capture to pick up all modifications
    if hasattr(ctx.master, "relaycraft_main"):
        main = ctx.master.relaycraft_main
        try:
            flow_data = main.traffic_monitor.process_flow(flow)
            if flow_data:
                main.traffic_monitor.flow_buffer.append(flow_data)
                # Clear dirty flag after successful sync
                flow.metadata["_relaycraft_dirty"] = False
        except Exception as e:
            ctx.log.error(f"RelayCraft: Anchor sync error: {e}")

def error(flow):
    """Handle final error capture"""
    if hasattr(ctx.master, "relaycraft_main"):
        main = ctx.master.relaycraft_main
        try:
            flow_data = main.traffic_monitor.process_flow(flow)
            if flow_data:
                flow_data["error"] = str(flow.error)
                main.traffic_monitor.flow_buffer.append(flow_data)
        except:
            pass
