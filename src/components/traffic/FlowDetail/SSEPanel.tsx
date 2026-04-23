import { motion } from "framer-motion";
import { Activity, ChevronDown, ChevronUp, RefreshCw, Wifi } from "lucide-react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import type { SseEvent } from "../../../types";
import { CopyButton } from "../../common/CopyButton";
import { Input } from "../../common/Input";
import { TabsContent } from "../../common/Tabs";
import { Tooltip } from "../../common/Tooltip";

const SSE_MAX_PREVIEW_CHARS = 2000;
const SSE_ID_PREVIEW_CHARS = 96;

interface SSEPanelProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  sseStreamOpen: boolean;
  sseEvents: SseEvent[];
  sseDroppedCount: number;
  sseAutoScroll: boolean;
  sseAutoRefresh: boolean;
  sseKeywordFilter: string;
  filteredSseEvents: SseEvent[];
  expandedSseIds: Record<string, boolean>;
  sseListRef: React.RefObject<VirtuosoHandle | null>;
  setSseAutoScroll: React.Dispatch<React.SetStateAction<boolean>>;
  setSseAutoRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  setSseKeywordFilter: React.Dispatch<React.SetStateAction<string>>;
  setExpandedSseIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function SSEPanel({
  t,
  sseStreamOpen,
  sseEvents,
  sseDroppedCount,
  sseAutoScroll,
  sseAutoRefresh,
  sseKeywordFilter,
  filteredSseEvents,
  expandedSseIds,
  sseListRef,
  setSseAutoScroll,
  setSseAutoRefresh,
  setSseKeywordFilter,
  setExpandedSseIds,
}: SSEPanelProps) {
  return (
    <TabsContent
      value="sse"
      key="sse"
      forceMount
      className="mt-0 flex-1 flex flex-col overflow-hidden p-2"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.15 }}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex-1 flex flex-col min-h-0 bg-muted/5 rounded-lg border border-border/40 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/20">
            <div className="flex items-center gap-2">
              <Tooltip content={sseStreamOpen ? t("traffic.sse.open") : t("traffic.sse.closed")}>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    sseStreamOpen ? "bg-emerald-500" : "bg-muted-foreground/50"
                  }`}
                  title={sseStreamOpen ? t("traffic.sse.open") : t("traffic.sse.closed")}
                />
              </Tooltip>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-[0.15em]">
                {t("traffic.sse.events")}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground/60">
                {t("traffic.sse.events_count", { count: sseEvents.length })}
              </span>
              {sseDroppedCount > 0 && (
                <span className="text-tiny px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium">
                  {t("traffic.sse.dropped", { count: sseDroppedCount })}
                </span>
              )}
              <Tooltip
                content={
                  sseAutoScroll ? t("traffic.sse.auto_scroll_on") : t("traffic.sse.auto_scroll_off")
                }
              >
                <button
                  onClick={() => setSseAutoScroll((v) => !v)}
                  className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                    sseAutoScroll
                      ? "border-primary/40 text-primary bg-primary/10"
                      : "border-border/60 text-muted-foreground bg-muted/20"
                  }`}
                  aria-label={
                    sseAutoScroll
                      ? t("traffic.sse.auto_scroll_on")
                      : t("traffic.sse.auto_scroll_off")
                  }
                >
                  <Activity className="w-3 h-3" />
                </button>
              </Tooltip>
              <Tooltip
                content={
                  sseAutoRefresh
                    ? t("traffic.sse.auto_refresh_on")
                    : t("traffic.sse.auto_refresh_off")
                }
              >
                <button
                  onClick={() => setSseAutoRefresh((v) => !v)}
                  className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                    sseAutoRefresh
                      ? "border-primary/40 text-primary bg-primary/10"
                      : "border-border/60 text-muted-foreground bg-muted/20"
                  }`}
                  aria-label={
                    sseAutoRefresh
                      ? t("traffic.sse.auto_refresh_on")
                      : t("traffic.sse.auto_refresh_off")
                  }
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/10">
            <Input
              value={sseKeywordFilter}
              onChange={(e) => setSseKeywordFilter(e.target.value)}
              placeholder={t("traffic.sse.filter_placeholder")}
              className="h-7 text-xs flex-1 min-w-[180px]"
            />
            {sseKeywordFilter && (
              <button
                type="button"
                className="px-2 py-1 text-tiny rounded border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/20"
                onClick={() => setSseKeywordFilter("")}
              >
                {t("traffic.sse.clear_filter")}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            {filteredSseEvents.length > 0 ? (
              <Virtuoso
                ref={sseListRef}
                data={filteredSseEvents}
                style={{ height: "100%" }}
                computeItemKey={(_, evt) => `${evt.flowId}-${evt.seq}`}
                followOutput={sseAutoScroll ? "auto" : false}
                increaseViewportBy={320}
                itemContent={(_, evt) => (
                  <div className="group flex items-start gap-3 px-3 py-2 border-b border-border/20 hover:bg-muted/10 transition-colors">
                    <div className="text-tiny mt-0.5 text-muted-foreground/60 font-mono">
                      #{evt.seq}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {evt.event && (
                          <span className="text-tiny font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">
                            {evt.event}
                          </span>
                        )}
                        <span className="text-tiny text-muted-foreground/40">
                          {new Date(evt.ts).toLocaleTimeString()}
                        </span>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <CopyButton text={evt.data} />
                        </div>
                      </div>
                      {evt.id && (
                        <button
                          onClick={() =>
                            setExpandedSseIds((prev) => ({
                              ...prev,
                              [`${evt.flowId}-${evt.seq}-id`]: !prev[`${evt.flowId}-${evt.seq}-id`],
                            }))
                          }
                          className="mb-1 text-tiny font-medium px-1.5 py-0.5 rounded border border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300 w-full inline-flex items-start gap-1 hover:bg-purple-500/25 transition-colors"
                          title={evt.id}
                        >
                          {expandedSseIds[`${evt.flowId}-${evt.seq}-id`] ? (
                            <ChevronUp className="w-3 h-3 flex-shrink-0 mt-[2px]" />
                          ) : (
                            <ChevronDown className="w-3 h-3 flex-shrink-0 mt-[2px]" />
                          )}
                          <span
                            className={
                              expandedSseIds[`${evt.flowId}-${evt.seq}-id`]
                                ? "whitespace-pre-wrap break-all text-left"
                                : "truncate text-left"
                            }
                          >
                            {expandedSseIds[`${evt.flowId}-${evt.seq}-id`]
                              ? evt.id
                              : evt.id.length > SSE_ID_PREVIEW_CHARS
                                ? `${evt.id.slice(0, SSE_ID_PREVIEW_CHARS)}...`
                                : evt.id}
                          </span>
                        </button>
                      )}
                      <div className="text-xs font-mono text-foreground/80 break-all whitespace-pre-wrap">
                        {evt.data.length > SSE_MAX_PREVIEW_CHARS
                          ? `${evt.data.slice(0, SSE_MAX_PREVIEW_CHARS)}...`
                          : evt.data}
                      </div>
                      {evt.data.length > SSE_MAX_PREVIEW_CHARS && (
                        <div className="text-tiny mt-1 text-muted-foreground/50">
                          {t("traffic.sse.content_truncated", {
                            size: SSE_MAX_PREVIEW_CHARS,
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-3">
                  <Wifi className="w-6 h-6 text-muted-foreground/20" />
                </div>
                <p className="text-xs text-muted-foreground/50 font-medium">
                  {sseKeywordFilter ? t("traffic.sse.no_match") : t("traffic.sse.waiting")}
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </TabsContent>
  );
}
