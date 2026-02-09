import { AlertTriangle, Code, Copy, RotateCcw, Send, Terminal, Workflow } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { generateCurlCommand } from "../../../lib/curl";
import { notify } from "../../../lib/notify";
import { useBreakpointStore } from "../../../stores/breakpointStore";
import { useComposerStore } from "../../../stores/composerStore";
import { useRuleStore } from "../../../stores/ruleStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useTrafficStore } from "../../../stores/trafficStore";
import { useUIStore } from "../../../stores/uiStore";
import type { Flow } from "../../../types";
import type { ContextMenuItem } from "../../common/ContextMenu";

export function useTrafficContextMenu() {
  const { t } = useTranslation();
  const isMac = useUIStore((state) => state.isMac);
  const { setDraftRule } = useRuleStore();
  const { setActiveTab } = useUIStore();
  const { selectFlow, flows } = useTrafficStore();
  const { addBreakpoint } = useBreakpointStore();

  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuTargetFlow, setMenuTargetFlow] = useState<Flow | null>(null);
  const [pausedFlows, setPausedFlows] = useState<Flow[] | null>(null);

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
    (e: React.MouseEvent, flow: Flow) => {
      e.preventDefault();
      e.stopPropagation();
      setMenuTargetFlow(flow);
      setMenuPosition({ x: e.clientX, y: e.clientY });
      setMenuVisible(true);
      setPausedFlows(flows);
    },
    [flows],
  );

  const handleCloseMenu = useCallback(() => {
    setMenuVisible(false);
    setPausedFlows(null);
  }, []);

  const contextMenuItems: ContextMenuItem[] = menuTargetFlow
    ? [
        {
          label: t("traffic.context_menu.copy_url"),
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: isMac ? "⌘C" : "Ctrl+C",
          onClick: () => {
            navigator.clipboard.writeText(menuTargetFlow.url);
            notify.success(t("traffic.context_menu.url_copied"), {
              toastOnly: true,
            });
          },
        },
        {
          label: t("traffic.context_menu.copy_curl"),
          icon: <Terminal className="w-3.5 h-3.5" />,
          onClick: () => {
            navigator.clipboard.writeText(generateCurlCommand(menuTargetFlow));
            notify.success(t("traffic.context_menu.curl_copied"), {
              toastOnly: true,
            });
          },
        },
        { separator: true, label: "" },
        {
          label: t("traffic.context_menu.create_rule"),
          icon: <Workflow className="w-3.5 h-3.5" />,
          onClick: () => {
            // Truncate body if too large to prevent UI freeze
            let bodyContent = menuTargetFlow.responseBody || "";
            if (bodyContent.length > 50000) {
              bodyContent = `${bodyContent.slice(0, 10000)}\n\n[TRUNCATED_FOR_PERFORMANCE: Content > 50KB]`;
              notify.warning(
                t(
                  "traffic.context_menu.body_truncated",
                  'Body truncated for performance. Use "Map Local" for large files.',
                ),
              );
            }

            setDraftRule({
              name: `Mock ${new URL(menuTargetFlow.url).pathname}`,
              type: "rewrite_body",
              match: {
                request: [
                  {
                    type: "url",
                    value: menuTargetFlow.url,
                    matchType: "exact",
                  },
                  {
                    type: "method",
                    value: menuTargetFlow.method,
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
                    statusCode: menuTargetFlow.statusCode,
                    contentType:
                      menuTargetFlow.contentType ||
                      menuTargetFlow.responseHeaders?.["Content-Type"] ||
                      menuTargetFlow.responseHeaders?.["content-type"],
                  },
                },
              ] as any,
            });
            setActiveTab("rules");
            selectFlow(null);
          },
        },
        { separator: true, label: "" },
        {
          label: t("traffic.context_menu.replay"),
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          shortcut: isMac ? "⌘R" : "Ctrl+R",
          onClick: async () => {
            if (!menuTargetFlow) return;
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("replay_request", {
                req: {
                  method: menuTargetFlow.method,
                  url: menuTargetFlow.url,
                  headers: menuTargetFlow.requestHeaders,
                  body: menuTargetFlow.requestBody || null,
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
          onClick: () => {
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
            handleToggleBreakpoint(menuTargetFlow.host);
            handleCloseMenu();
          },
        },
        { separator: true, label: "" },
        {
          label: t("traffic.context_menu.copy_req_body"),
          icon: <Code className="w-3.5 h-3.5" />,
          disabled: !menuTargetFlow.requestBody,
          onClick: () => {
            if (menuTargetFlow.requestBody) {
              navigator.clipboard.writeText(menuTargetFlow.requestBody);
              notify.success(t("traffic.context_menu.req_body_copied"), {
                toastOnly: true,
              });
            }
          },
        },
        {
          label: t("traffic.context_menu.copy_res_body"),
          icon: <Code className="w-3.5 h-3.5" />,
          disabled: !menuTargetFlow.responseBody,
          onClick: () => {
            if (menuTargetFlow.responseBody) {
              navigator.clipboard.writeText(menuTargetFlow.responseBody);
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
    pausedFlows,
  };
}
