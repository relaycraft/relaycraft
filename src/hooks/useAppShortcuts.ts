import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "../hooks/useNavigate";
import { notify } from "../lib/notify";
import { useComposerStore } from "../stores/composerStore";
import { usePluginPageStore } from "../stores/pluginPageStore";
import { useProxyStore } from "../stores/proxyStore";
import { useTrafficStore } from "../stores/trafficStore";
import { useUIStore } from "../stores/uiStore";

export function useAppShortcuts() {
  const { t } = useTranslation();
  const { selectedFlow, clearFlows } = useTrafficStore();
  const { running, startProxy, stopProxy } = useProxyStore();
  const { activeTab } = useUIStore();
  const { navigate } = useNavigate();

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ignore if input/textarea is focused (except for specific global shortcuts that should override)
      // const target = e.target as HTMLElement;
      // const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // Global: Command Center (Cmd+K) - Already handled in CommandCenter.tsx
      // We just need to ensure we don't block it or conflict with it if we added logic here.

      // Global: Toggle Proxy (Cmd + \)
      if (isCmdOrCtrl && e.key === "\\") {
        e.preventDefault();
        if (running) {
          await stopProxy();
          notify.success(t("titlebar.stopped"), {
            title: t("sidebar.traffic"),
            toastOnly: true,
          });
        } else {
          await startProxy();
          notify.success(t("titlebar.running"), {
            title: t("sidebar.traffic"),
            toastOnly: true,
          });
        }
        return;
      }

      // Global: Switch Tabs (Cmd + 1-9)
      if (isCmdOrCtrl && /^[1-9]$/.test(e.key)) {
        const pluginPages = usePluginPageStore.getState().pages;
        const allTabs = [
          "traffic",
          "composer",
          "rules",
          "scripts",
          ...pluginPages.map((p) => p.id),
        ];
        const index = parseInt(e.key, 10) - 1;
        const targetTab = allTabs[index];

        if (targetTab && activeTab !== targetTab) {
          e.preventDefault();
          navigate(targetTab as any);
        }
        return;
      }

      // Global: Clear Requests (Cmd + L)
      if (isCmdOrCtrl && e.key.toLowerCase() === "l") {
        e.preventDefault();
        clearFlows();
        notify.success(t("traffic.list_cleared"), { toastOnly: true });
        return;
      }

      // Global: Edit in Composer (Cmd + E)
      if (isCmdOrCtrl && e.key.toLowerCase() === "e") {
        if (selectedFlow) {
          e.preventDefault();
          useComposerStore.getState().setComposerFromFlow(selectedFlow);
          if (activeTab !== "composer") {
            navigate("composer");
          }
          notify.success(t("traffic.context_menu.edit_composer"), {
            toastOnly: true,
          });
        }
        return;
      }

      // Context: Traffic Tab
      if (activeTab === "traffic") {
        // Focus Search (Cmd + F)
        if (isCmdOrCtrl && e.key === "f") {
          e.preventDefault();
          // Dispatch a custom event that FilterBar can listen to
          window.dispatchEvent(new CustomEvent("focus-traffic-search"));
          return;
        }

        // Replay (Cmd + R)
        if (isCmdOrCtrl && e.key === "r") {
          e.preventDefault();
          if (selectedFlow) {
            try {
              // Convert HarHeader[] to Record<string, string> for replay
              const headersRecord: Record<string, string> = {};
              for (const h of selectedFlow.request.headers) {
                headersRecord[h.name] = h.value;
              }
              await invoke("replay_request", {
                req: {
                  method: selectedFlow.request.method,
                  url: selectedFlow.request.url,
                  headers: headersRecord,
                  body: selectedFlow.request.postData?.text || null,
                },
              });
              notify.success(t("traffic.replay_success"), { toastOnly: true });
            } catch (_error) {
              notify.error(t("traffic.replay_failed"));
            }
          }
          return;
        }

        // Copy URL (Cmd + C)
        // Only if no text is selected (to avoid overriding text copy)
        if (isCmdOrCtrl && e.key === "c") {
          const selection = window.getSelection();
          if (!selection || selection.toString().length === 0) {
            if (selectedFlow) {
              e.preventDefault();
              await navigator.clipboard.writeText(selectedFlow.request.url);
              notify.success(t("traffic.context_menu.url_copied"), {
                toastOnly: true,
              });
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFlow, running, activeTab, t, clearFlows, startProxy, stopProxy, navigate]); // Dependencies updated
}
