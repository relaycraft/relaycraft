import { motion } from "framer-motion";
import { Activity, ArrowDown, ArrowUp, RefreshCw, RotateCw, Wifi } from "lucide-react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import type { RcWebSocketFrame } from "../../../types";
import { CopyButton } from "../../common/CopyButton";
import { Input } from "../../common/Input";
import { TabsContent } from "../../common/Tabs";
import { Tooltip } from "../../common/Tooltip";

const WS_MAX_PREVIEW_CHARS = 2000;

export type WsDirectionFilter = "all" | "client" | "server";

interface WSMessagesPanelProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  frameCount: number;
  rawFrameCount: number;
  filteredFrames: RcWebSocketFrame[];
  wsAutoScroll: boolean;
  wsAutoRefresh: boolean;
  wsKeywordFilter: string;
  wsDirectionFilter: WsDirectionFilter;
  wsListRef: React.RefObject<VirtuosoHandle | null>;
  setWsAutoScroll: React.Dispatch<React.SetStateAction<boolean>>;
  setWsAutoRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  setWsKeywordFilter: React.Dispatch<React.SetStateAction<string>>;
  setWsDirectionFilter: React.Dispatch<React.SetStateAction<WsDirectionFilter>>;
  onResendFrame: (frame: RcWebSocketFrame) => void;
}

export function WSMessagesPanel({
  t,
  frameCount,
  rawFrameCount,
  filteredFrames,
  wsAutoScroll,
  wsAutoRefresh,
  wsKeywordFilter,
  wsDirectionFilter,
  wsListRef,
  setWsAutoScroll,
  setWsAutoRefresh,
  setWsKeywordFilter,
  setWsDirectionFilter,
  onResendFrame,
}: WSMessagesPanelProps) {
  return (
    <TabsContent
      value="messages"
      key="messages"
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
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-[0.15em]">
              {t("traffic.websocket.frames")}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground/60">
                {t("traffic.websocket.messages_count", {
                  count: frameCount || 0,
                })}
              </span>
              {rawFrameCount < frameCount && (
                <span className="text-tiny px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium">
                  {t("traffic.websocket.showing_last", {
                    count: rawFrameCount,
                  })}
                </span>
              )}
              <Tooltip
                content={
                  wsAutoScroll
                    ? t("traffic.websocket.auto_scroll_on")
                    : t("traffic.websocket.auto_scroll_off")
                }
              >
                <button
                  onClick={() => setWsAutoScroll((v) => !v)}
                  className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                    wsAutoScroll
                      ? "border-primary/40 text-primary bg-primary/10"
                      : "border-border/60 text-muted-foreground bg-muted/20"
                  }`}
                  aria-label={
                    wsAutoScroll
                      ? t("traffic.websocket.auto_scroll_on")
                      : t("traffic.websocket.auto_scroll_off")
                  }
                >
                  <Activity className="w-3 h-3" />
                </button>
              </Tooltip>
              <Tooltip
                content={
                  wsAutoRefresh
                    ? t("traffic.websocket.auto_refresh_on")
                    : t("traffic.websocket.auto_refresh_off")
                }
              >
                <button
                  onClick={() => setWsAutoRefresh((v) => !v)}
                  className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                    wsAutoRefresh
                      ? "border-primary/40 text-primary bg-primary/10"
                      : "border-border/60 text-muted-foreground bg-muted/20"
                  }`}
                  aria-label={
                    wsAutoRefresh
                      ? t("traffic.websocket.auto_refresh_on")
                      : t("traffic.websocket.auto_refresh_off")
                  }
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/10">
            <Input
              value={wsKeywordFilter}
              onChange={(e) => setWsKeywordFilter(e.target.value)}
              placeholder={t("traffic.websocket.filter_placeholder")}
              className="h-7 text-xs flex-1 min-w-[180px]"
            />
            <div className="flex items-center rounded-lg border border-border/50 bg-background/60 p-0.5 shrink-0">
              <button
                type="button"
                className={`px-2 py-1 rounded text-tiny whitespace-nowrap transition-colors ${
                  wsDirectionFilter === "all"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setWsDirectionFilter("all")}
              >
                {t("traffic.websocket.direction_all")}
              </button>
              <button
                type="button"
                className={`px-2 py-1 rounded text-tiny whitespace-nowrap transition-colors ${
                  wsDirectionFilter === "client"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setWsDirectionFilter("client")}
              >
                {t("traffic.websocket.direction_client")}
              </button>
              <button
                type="button"
                className={`px-2 py-1 rounded text-tiny whitespace-nowrap transition-colors ${
                  wsDirectionFilter === "server"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setWsDirectionFilter("server")}
              >
                {t("traffic.websocket.direction_server")}
              </button>
            </div>
            {(wsKeywordFilter || wsDirectionFilter !== "all") && (
              <button
                type="button"
                className="px-2 py-1 text-tiny rounded border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/20"
                onClick={() => {
                  setWsKeywordFilter("");
                  setWsDirectionFilter("all");
                }}
              >
                {t("traffic.websocket.clear_filter")}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            {filteredFrames.length > 0 ? (
              <Virtuoso
                ref={wsListRef}
                data={filteredFrames}
                style={{ height: "100%" }}
                computeItemKey={(_, frame) => frame.id}
                followOutput={wsAutoScroll ? "auto" : false}
                increaseViewportBy={320}
                itemContent={(_, frame) => {
                  const canResend =
                    frame.fromClient && (frame.type === "text" || frame.type === "binary");
                  const truncated = frame.content.length > WS_MAX_PREVIEW_CHARS;
                  const preview = truncated
                    ? `${frame.content.slice(0, WS_MAX_PREVIEW_CHARS)}...`
                    : frame.content;
                  return (
                    <div className="group flex items-start gap-3 px-3 py-2 border-b border-border/20 hover:bg-muted/10 transition-colors">
                      <div className="flex-shrink-0 mt-0.5">
                        {frame.fromClient ? (
                          <ArrowUp className="w-3.5 h-3.5 text-blue-500" />
                        ) : (
                          <ArrowDown className="w-3.5 h-3.5 text-green-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-tiny font-medium px-1.5 py-0.5 rounded ${
                              frame.type === "text"
                                ? "bg-blue-500/10 text-blue-600"
                                : frame.type === "binary"
                                  ? "bg-purple-500/10 text-purple-600"
                                  : frame.type === "close"
                                    ? "bg-red-500/10 text-red-600"
                                    : "bg-muted/20 text-muted-foreground"
                            }`}
                          >
                            {frame.type.toUpperCase()}
                          </span>
                          {frame.injected && (
                            <span className="text-tiny font-medium px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600">
                              {t("traffic.websocket.injected_badge")}
                            </span>
                          )}
                          <span className="text-tiny text-muted-foreground/60">
                            {frame.length} bytes
                          </span>
                          <span className="text-tiny text-muted-foreground/40">
                            {new Date(frame.timestamp).toLocaleTimeString()}
                          </span>
                          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canResend && (
                              <Tooltip content={t("traffic.websocket.resend")}>
                                <button
                                  type="button"
                                  onClick={() => onResendFrame(frame)}
                                  className="p-1 rounded hover:bg-muted/40 transition-colors text-muted-foreground/60 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                >
                                  <RotateCw className="w-3 h-3" />
                                </button>
                              </Tooltip>
                            )}
                            <CopyButton text={frame.content} />
                          </div>
                        </div>
                        <div className="text-xs font-mono text-foreground/80 break-all whitespace-pre-wrap">
                          {preview}
                        </div>
                        {truncated && (
                          <div className="text-tiny mt-1 text-muted-foreground/50">
                            {t("traffic.websocket.preview_truncated", {
                              size: WS_MAX_PREVIEW_CHARS,
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-3">
                  <Wifi className="w-6 h-6 text-muted-foreground/20" />
                </div>
                <p className="text-xs text-muted-foreground/50 font-medium">
                  {wsKeywordFilter || wsDirectionFilter !== "all"
                    ? t("traffic.websocket.no_match")
                    : t("traffic.websocket.no_frames")}
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </TabsContent>
  );
}
