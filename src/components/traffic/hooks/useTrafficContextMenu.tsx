import { AlertTriangle, Code, Copy, RotateCcw, Send, Terminal, Workflow } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { generateCurlCommand } from "../../../lib/curl";
import { notify } from "../../../lib/notify";
import { fetchFlowDetail } from "../../../lib/trafficMonitor";
import { useBreakpointStore } from "../../../stores/breakpointStore";
import { useComposerStore } from "../../../stores/composerStore";
import { useRuleStore } from "../../../stores/ruleStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useTrafficStore } from "../../../stores/trafficStore";
import { useUIStore } from "../../../stores/uiStore";
import type { Flow, FlowIndex } from "../../../types";
import { getHeaderValue, harToLegacyHeaders } from "../../../types";
import type { ContextMenuItem } from "../../common/ContextMenu";

export function useTrafficContextMenu() {
  const { t } = useTranslation();
  const isMac = useUIStore((state) => state.isMac);
  const { setDraftRule } = useRuleStore();
  const { setActiveTab } = useUIStore();
  const { selectFlow, indices } = useTrafficStore();
  const { addBreakpoint } = useBreakpointStore();

  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuTargetIndex, setMenuTargetIndex] = useState<FlowIndex | null>(null);
  const [menuTargetFlow, setMenuTargetFlow] = useState<Flow | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [pausedIndices, setPausedIndices] = useState<FlowIndex[] | null>(null);

  const handleToggleBreakpoint = useCallback(
    async (pattern: string) => {
      if (!pattern || pattern.trim() === "") return;
      try {
        const port = useSettingsStore.getState().config.proxy_port;
        await fetch(`http://127.0.0.1:${port}/_relay/breakpoints`, {
          method: "POST",
          body: JSON.stringify({ action: "add", pattern }),
        });
        addBreakpoint(pattern);
      } catch (e) {
        console.error("Failed to set breakpoint", e);
        notify.error(`Failed to set breakpoint: ${e}`);
      }
    },
    [addBreakpoint],
  );

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, index: FlowIndex) => {
      e.preventDefault();
      e.stopPropagation();
      setMenuTargetIndex(index);
      setMenuPosition({ x: e.clientX, y: e.clientY });
      setMenuVisible(true);
      setPausedIndices(indices);

      // Load full flow detail on demand
      setIsLoadingDetail(true);
      try {
        const flow = await fetchFlowDetail(index.id);
        setMenuTargetFlow(flow);
      } catch (error) {
        console.error("Failed to load flow detail for context menu:", error);
        setMenuTargetFlow(null);
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [indices],
  );

  const handleCloseMenu = useCallback(() => {
    setMenuVisible(false);
    setPausedIndices(null);
    setMenuTargetFlow(null);
    setMenuTargetIndex(null);
  }, []);

  // Context menu items - some are disabled until flow detail loads
  const contextMenuItems: ContextMenuItem[] = menuTargetIndex
    ? [
        {
          label: t("traffic.context_menu.copy_url"),
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: isMac ? "⌘C" : "Ctrl+C",
          disabled: isLoadingDetail,
          onClick: () => {
            // URL is available in FlowIndex
            navigator.clipboard.writeText(menuTargetIndex.url);
            notify.success(t("traffic.context_menu.url_copied"), {
              toastOnly: true,
            });
          },
        },
        {
          label: t("traffic.context_menu.copy_curl"),
          icon: <Terminal className="w-3.5 h-3.5" />,
          disabled: !menuTargetFlow,
          onClick: () => {
            if (menuTargetFlow) {
              navigator.clipboard.writeText(generateCurlCommand(menuTargetFlow));
              notify.success(t("traffic.context_menu.curl_copied"), {
                toastOnly: true,
              });
            }
          },
        },
        { separator: true, label: "" },
        {
          label: t("traffic.context_menu.create_rule"),
          icon: <Workflow className="w-3.5 h-3.5" />,
          disabled: !menuTargetFlow,
          onClick: () => {
            if (!menuTargetFlow) return;
            const { isEditorDirty, selectRule } = useRuleStore.getState();
            const { showConfirm } = useUIStore.getState();

            const createNewRule = () => {
              // Truncate body if too large to prevent UI freeze
              let bodyContent = menuTargetFlow.response.content.text || "";
              if (bodyContent.length > 50000) {
                bodyContent = `${bodyContent.slice(0, 10000)}\n\n[TRUNCATED_FOR_PERFORMANCE: Content > 50KB]`;
                notify.warning(
                  t(
                    "traffic.context_menu.body_truncated",
                    'Body truncated for performance. Use "Map Local" for large files.',
                  ),
                );
              }

              selectRule(null);
              setDraftRule({
                name: `Mock ${new URL(menuTargetFlow.request.url).pathname}`,
                type: "rewrite_body",
                match: {
                  request: [
                    {
                      type: "url",
                      value: menuTargetFlow.request.url,
                      matchType: "exact",
                    },
                    {
                      type: "method",
                      value: menuTargetFlow.request.method,
                      matchType: "equals",
                    },
                  ],
                  response: [],
                },
                actions: [
                  {
                    type: "rewrite_body",
                    target: "response",
                    set: {
                      content: bodyContent,
                      statusCode: menuTargetFlow.response.status,
                      contentType:
                        menuTargetFlow.response.content.mimeType ||
                        getHeaderValue(menuTargetFlow.response.headers, "Content-Type") ||
                        getHeaderValue(menuTargetFlow.response.headers, "content-type"),
                    },
                  },
                ] as any,
              });
              setActiveTab("rules");
              selectFlow(null);
            };

            if (isEditorDirty) {
              showConfirm({
                title: t("rules.alerts.discard_title"),
                message: t("rules.alerts.discard_msg"),
                variant: "warning",
                onConfirm: createNewRule,
              });
            } else {
              createNewRule();
            }
          },
        },
        { separator: true, label: "" },
        {
          label: t("traffic.context_menu.replay"),
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          shortcut: isMac ? "⌘R" : "Ctrl+R",
          disabled: !menuTargetFlow,
          onClick: async () => {
            if (!menuTargetFlow) return;
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("replay_request", {
                req: {
                  method: menuTargetFlow.request.method,
                  url: menuTargetFlow.request.url,
                  headers: harToLegacyHeaders(menuTargetFlow.request.headers),
                  body: menuTargetFlow.request.postData?.text || null,
                },
              });
              notify.success(t("traffic.replay_success"), { toastOnly: true });
            } catch (_error) {
              notify.error(t("traffic.replay_failed"));
            }
            handleCloseMenu();
          },
        },
        {
          label: t("traffic.context_menu.edit_composer"),
          icon: <Send className="w-3.5 h-3.5" />,
          shortcut: isMac ? "⌘E" : "Ctrl+E",
          disabled: !menuTargetFlow,
          onClick: () => {
            if (!menuTargetFlow) return;
            useComposerStore.getState().setComposerFromFlow(menuTargetFlow);
            setActiveTab("composer");
            handleCloseMenu();
          },
        },
        { separator: true, label: "" },
        {
          label: t("traffic.context_menu.set_breakpoint"),
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
          onClick: () => {
            const url = new URL(menuTargetIndex.url);
            handleToggleBreakpoint(url.host);
            handleCloseMenu();
          },
        },
        { separator: true, label: "" },
        {
          label: t("traffic.context_menu.copy_req_body"),
          icon: <Code className="w-3.5 h-3.5" />,
          disabled: !menuTargetFlow?.request.postData?.text,
          onClick: () => {
            if (menuTargetFlow?.request.postData?.text) {
              navigator.clipboard.writeText(menuTargetFlow.request.postData.text);
              notify.success(t("traffic.context_menu.req_body_copied"), {
                toastOnly: true,
              });
            }
          },
        },
        {
          label: t("traffic.context_menu.copy_res_body"),
          icon: <Code className="w-3.5 h-3.5" />,
          disabled: !menuTargetFlow?.response.content.text,
          onClick: () => {
            if (menuTargetFlow?.response.content.text) {
              navigator.clipboard.writeText(menuTargetFlow.response.content.text);
              notify.success(t("traffic.context_menu.res_body_copied"), {
                toastOnly: true,
              });
            }
          },
        },
      ]
    : [];

  return {
    menuVisible,
    menuPosition,
    contextMenuItems,
    handleContextMenu,
    handleCloseMenu,
    pausedIndices,
  };
}
