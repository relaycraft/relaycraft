import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { useMemo } from "react";
import { notify } from "../../lib/notify";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { useUIStore } from "../../stores/uiStore";
import { CommandCenter } from "../ai/CommandCenter";
import { AlertDialog } from "../common/AlertDialog";
import { ImportRuleModal } from "../rules/ImportRuleModal";
import { SaveSessionModal } from "../session/SaveSessionModal";
import { LogViewer } from "../traffic/LogViewer";
import { BreakpointModal } from "./BreakpointModal";
import { ExitConfirmModal } from "./ExitConfirmModal";

interface GlobalModalsProps {
  showExitModal: boolean;
  setShowExitModal: (show: boolean) => void;
}

export function GlobalModals({ showExitModal, setShowExitModal }: GlobalModalsProps) {
  // Subscribe to the Map directly, then memoize the array conversion
  const interceptedFlowsMap = useTrafficStore((state) => state.interceptedFlows);
  const interceptedFlows = useMemo(
    () => Array.from(interceptedFlowsMap.values()),
    [interceptedFlowsMap],
  );

  const { logViewerOpen, setLogViewerOpen } = useUIStore();

  const handleResumeBreakpoint = async (flowId: string, modifications: any) => {
    try {
      const port = useSettingsStore.getState().config.proxy_port;
      await fetch(`http://127.0.0.1:${port}/_relay/resume`, {
        method: "POST",
        body: JSON.stringify({ id: flowId, modifications }),
        cache: "no-store",
      });
      // Remove from intercepted flows after successful resume
      useTrafficStore.getState().updateInterceptedFlow(flowId, null);
    } catch (e) {
      console.error("Failed to resume breakpoint", e);
      notify.error(`Failed to resume breakpoint: ${e}`);
    }
  };

  return (
    <>
      <AlertDialog />
      <ImportRuleModal />
      <CommandCenter />
      {interceptedFlows.length > 0 && (
        <BreakpointModal
          flows={interceptedFlows}
          onClose={() => {
            interceptedFlows.forEach((f) => {
              handleResumeBreakpoint(f.id, { action: "abort" });
            });
          }}
          onResume={handleResumeBreakpoint}
        />
      )}
      <SaveSessionModal />
      <ExitConfirmModal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        onConfirm={async () => {
          setShowExitModal(false);
          await getCurrentWindow().hide();
          await exit(0);
        }}
      />
      {logViewerOpen && <LogViewer onClose={() => setLogViewerOpen(false)} />}
    </>
  );
}
