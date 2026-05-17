import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Play,
  Server,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type McpActivity, useMcpActivityStore } from "../../stores/mcpActivityStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { useUIStore } from "../../stores/uiStore";
import { Tooltip } from "../common/Tooltip";

interface McpStatus {
  running: boolean;
  port: number;
}

const isReadActivity = (activity: McpActivity) =>
  activity.toolName.startsWith("get_") ||
  activity.toolName.startsWith("list_") ||
  activity.toolName.startsWith("search_");

export function McpActivityTimeline() {
  const { t } = useTranslation();
  const activities = useMcpActivityStore((state) => state.activities);
  const clearActivities = useMcpActivityStore((state) => state.clearActivities);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const configuredMcpPort = useSettingsStore((state) => state.config.mcp_config?.port ?? 7090);
  const [mcpStatus, setMcpStatus] = useState<McpStatus>({
    running: false,
    port: configuredMcpPort,
  });
  const [showReads, setShowReads] = useState(false);

  useEffect(() => {
    let active = true;
    const pollStatus = () => {
      invoke<McpStatus>("get_mcp_status")
        .then((status) => {
          if (active) setMcpStatus(status);
        })
        .catch(() => {
          if (active) setMcpStatus((status) => ({ ...status, running: false }));
        });
    };
    pollStatus();
    const id = window.setInterval(pollStatus, 3000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const sortedActivities = activities;

  const filteredActivities = sortedActivities.filter((activity) => {
    if (showReads) return true;
    return !isReadActivity(activity);
  });

  const hasHiddenReads = !showReads && activities.length > filteredActivities.length;

  if (activities.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background border-l border-border w-80 flex-shrink-0">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">
              {t("mcp.timeline.title", "AI Debug Timeline")}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center">
          <Activity className="w-8 h-8 mb-3 opacity-20" />
          <p className="text-sm">{t("mcp.timeline.empty", "No AI debugging activities yet.")}</p>
          <p className="text-xs mt-2 opacity-60 leading-relaxed">
            {t(
              "mcp.timeline.empty_desc",
              "Activities will appear here when an external AI assistant (like Cursor or Claude Desktop) interacts with RelayCraft via MCP.",
            )}
          </p>
        </div>
      </div>
    );
  }

  const renderActivityIcon = (activity: McpActivity) => {
    if (activity.status === "error" || activity.status === "unauthorized") {
      return <AlertCircle className="w-3.5 h-3.5 text-error" />;
    }
    if (activity.phase === "started") {
      return <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />;
    }
    if (activity.toolName === "create_rule") {
      return <Settings2 className="w-3.5 h-3.5 text-success" />;
    }
    if (activity.toolName === "delete_rule") {
      return <Settings2 className="w-3.5 h-3.5 text-error" />;
    }
    if (activity.toolName === "toggle_rule") {
      return <Settings2 className="w-3.5 h-3.5 text-primary" />;
    }
    if (activity.toolName === "replay_request") {
      return <Play className="w-3.5 h-3.5 text-success" />;
    }
    if (isReadActivity(activity)) {
      return (
        <div className="w-1.5 h-1.5 rounded-full border border-muted-foreground/40 bg-muted" />
      );
    }
    return <CheckCircle2 className="w-3.5 h-3.5 text-success/70" />;
  };

  const formatActivityText = (activity: McpActivity) => {
    // Determine the actual client name to show (AI or specific tool)
    const client = activity.clientName || "AI";

    // Enrich with rule name if available
    let targetName = "";
    if (activity.relatedRuleId) {
      const rule = useRuleStore.getState().rules.find((r) => r.id === activity.relatedRuleId);
      if (rule) targetName = rule.name;
    }

    if (activity.toolName === "create_rule") {
      if (activity.status === "error") {
        return t("mcp.timeline.create_rule_failed", "{{client}} failed to create rule", { client });
      }
      return t("mcp.timeline.created_rule", "{{client}} created a rule", { client });
    }
    if (activity.toolName === "toggle_rule") {
      if (activity.status === "error") {
        return t("mcp.timeline.toggle_rule_failed", "{{client}} failed to toggle rule", { client });
      }
      return t("mcp.timeline.toggled_rule", "{{client}} toggled rule {{name}}", {
        client,
        name: targetName ? `"${targetName}"` : "",
      });
    }
    if (activity.toolName === "delete_rule") {
      if (activity.status === "error") {
        return t("mcp.timeline.delete_rule_failed", "{{client}} failed to delete rule", { client });
      }
      return t("mcp.timeline.deleted_rule", "{{client}} deleted rule {{name}}", {
        client,
        name: targetName ? `"${targetName}"` : "",
      });
    }
    if (activity.toolName === "replay_request") {
      if (activity.status === "error") {
        return t("mcp.timeline.replay_request_failed", "{{client}} failed to replay request", {
          client,
        });
      }
      return t("mcp.timeline.replayed_request", "{{client}} replayed a request", { client });
    }
    if (isReadActivity(activity)) {
      return t("mcp.timeline.read_data", "{{client}} read data: {{tool}}", {
        client,
        tool: activity.toolName,
      });
    }
    return `${client}: ${activity.toolName}`;
  };

  return (
    <div className="flex flex-col h-full bg-background border-l border-border w-80 flex-shrink-0">
      <div className="flex flex-col border-b border-border bg-muted/20">
        <div className="flex items-center justify-between p-3 pb-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">
              {t("mcp.timeline.title", "AI Debug Timeline")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReads(!showReads)}
              className={`text-xs flex items-center gap-1 transition-colors ${
                showReads ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
              title={t("mcp.timeline.toggle_reads", "Toggle Read Operations")}
            >
              {showReads ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <div className="w-px h-3 bg-border" />
            <button
              onClick={clearActivities}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.clear", "Clear")}
            </button>
          </div>
        </div>
        <div className="px-3 pb-3 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Server className="w-3 h-3" />
            <span>MCP :{mcpStatus.port || configuredMcpPort}</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${mcpStatus.running ? "bg-success" : "bg-error"}`}
            />
          </div>
          {filteredActivities.length > 0 && (
            <span className="truncate ml-4 flex-1 text-right">
              {t("mcp.timeline.last_action", "Last: {{action}}", {
                action: formatActivityText(filteredActivities[0]),
              })}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 relative">
        <div className="absolute top-3 bottom-3 left-6 w-px bg-border" />
        <AnimatePresence initial={false}>
          {hasHiddenReads && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="relative pl-8 mb-4 flex items-center"
            >
              <div className="absolute left-0 top-1/2 -translate-y-1/2 bg-background py-0.5 flex items-center justify-center w-6">
                <div className="w-1.5 h-1.5 rounded-full border border-muted-foreground/40 bg-muted" />
              </div>
              <span className="text-[11px] text-muted-foreground italic bg-muted/30 px-2 py-0.5 rounded">
                {t("mcp.timeline.hidden_reads", "{{count}} read operations hidden", {
                  count: activities.length - filteredActivities.length,
                })}
              </span>
            </motion.div>
          )}
          {filteredActivities.map((activity, _index) => (
            <motion.div
              key={activity.id + activity.phase}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative pl-8 mb-4 last:mb-0"
            >
              <div className="absolute left-0 top-0 bg-background py-[3px] flex items-center justify-center w-6 z-10">
                {renderActivityIcon(activity)}
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-foreground">
                    {formatActivityText(activity)}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-2 flex-shrink-0">
                    {new Date(activity.timestamp).toLocaleTimeString([], { hour12: false })}
                  </span>
                </div>

                {activity.intent && (
                  <div className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2 py-0.5 mt-0.5">
                    "{activity.intent}"
                  </div>
                )}

                {activity.argumentSummary && activity.toolName !== "create_rule" && (
                  <Tooltip
                    content={
                      <div className="max-w-xs break-all whitespace-pre-wrap font-mono text-[9px]">
                        {activity.argumentSummary}
                      </div>
                    }
                    side="right"
                  >
                    <div className="text-[11px] text-muted-foreground font-mono bg-muted/40 p-1 rounded truncate mt-1 w-fit max-w-full hover:bg-muted/60 transition-colors">
                      {activity.argumentSummary}
                    </div>
                  </Tooltip>
                )}

                {activity.status === "error" && activity.errorMessage && (
                  <div
                    className="text-xs text-error mt-1 bg-error/10 p-1.5 rounded line-clamp-2"
                    title={activity.errorMessage}
                  >
                    {activity.errorMessage}
                  </div>
                )}

                {(activity.relatedFlowId || activity.relatedRuleId) && (
                  <div className="flex items-center gap-3 mt-1.5">
                    {activity.relatedFlowId && (
                      <button
                        onClick={() => {
                          setActiveTab("traffic");
                          setTimeout(() => {
                            useTrafficStore.getState().selectFlow(activity.relatedFlowId!);
                          }, 50);
                        }}
                        className="text-[11px] text-primary hover:text-primary/80 hover:underline flex items-center gap-0.5"
                      >
                        {t("mcp.timeline.view_flow", "View Flow")}{" "}
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                    {activity.relatedRuleId && activity.toolName !== "delete_rule" && (
                      <button
                        onClick={() => {
                          setActiveTab("rules");
                          setTimeout(() => {
                            const rule = useRuleStore
                              .getState()
                              .rules.find((r) => r.id === activity.relatedRuleId);
                            if (rule) {
                              useRuleStore.getState().selectRule(rule);
                            }
                          }, 50);
                        }}
                        className="text-[11px] text-primary hover:text-primary/80 hover:underline flex items-center gap-0.5"
                      >
                        {t("mcp.timeline.view_rule", "View Rule")}{" "}
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
