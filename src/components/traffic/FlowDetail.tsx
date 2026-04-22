import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
  CirclePause,
  FileCode,
  FileSignature,
  Globe,
  LayoutList,
  Loader2,
  RotateCw,
  Send,
  Settings,
  Sparkles,
  Terminal,
  Wifi,
  X,
} from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VirtuosoHandle } from "react-virtuoso";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { getAILanguageInfo } from "../../lib/ai/lang";
import { FLOW_ANALYSIS_SYSTEM_PROMPT } from "../../lib/ai/prompts";
import { generateCurlCommand } from "../../lib/curl";
import { getReadableUrlPreview, resolveFlowRequestUrl } from "../../lib/flowUrl";
import {
  formatProtocol,
  getDurationBadgeClass,
  getHttpMethodBadgeClass,
  getHttpStatusCodeClass,
  getProtocolColor,
  getRuleTypeBadgeClass,
} from "../../lib/utils";
import { useAIStore } from "../../stores/aiStore";
import { useComposerStore } from "../../stores/composerStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { useUIStore } from "../../stores/uiStore";
import type { Flow, RcWebSocketFrame } from "../../types";
import { harToLegacyHeaders } from "../../types";
import { AIMarkdown } from "../ai/AIMarkdown";
import { CopyButton } from "../common/CopyButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../common/Tabs";
import { Tooltip } from "../common/Tooltip";
import { BodyView } from "./BodyView";
import { SSEPanel } from "./FlowDetail/SSEPanel";
import { useSSEPanel } from "./FlowDetail/SSEPanel.hooks";
import { WSMessagesPanel, type WsDirectionFilter } from "./FlowDetail/WSMessagesPanel";
import { useWSRefresh } from "./FlowDetail/WSRefresh.hooks";
import { HeadersView } from "./HeadersView";
import { WsResendDrawer } from "./WsResendDrawer";

interface FlowDetailProps {
  flow: Flow;
  onClose: () => void;
}

export function FlowDetail({ flow, onClose }: FlowDetailProps) {
  const { t } = useTranslation();
  const isMac = useUIStore((state) => state.isMac);
  const { settings: aiSettings } = useAIStore();
  const [activeTab, setActiveTab] = useState("request");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const isSse = !!flow._rc?.isSse;
  const [sseAutoScroll, setSseAutoScroll] = useState<boolean>(true);
  const [sseAutoRefresh, setSseAutoRefresh] = useState<boolean>(true);
  const [sseKeywordFilter, setSseKeywordFilter] = useState("");
  const [wsAutoScroll, setWsAutoScroll] = useState<boolean>(true);
  const [wsAutoRefresh, setWsAutoRefresh] = useState<boolean>(true);
  const [wsDirectionFilter, setWsDirectionFilter] = useState<WsDirectionFilter>("all");
  const [wsKeywordFilter, setWsKeywordFilter] = useState("");
  const [expandedSseIds, setExpandedSseIds] = useState<Record<string, boolean>>({});
  const [resendFrame, setResendFrame] = useState<RcWebSocketFrame | null>(null);
  const lastFlowIdRef = useRef<string>("");
  const sseListRef = useRef<VirtuosoHandle | null>(null);
  const wsListRef = useRef<VirtuosoHandle | null>(null);
  const wsRefreshInFlightRef = useRef(false);
  const initialSseEvents = useMemo(
    () => (isSse && Array.isArray(flow._rc?.sseEvents) ? flow._rc.sseEvents : []),
    [isSse, flow._rc?.sseEvents],
  );
  const { sseEvents, sseStreamOpen, sseDroppedCount, filteredSseEvents } = useSSEPanel({
    flowId: flow.id,
    isSse,
    initialEvents: initialSseEvents,
    initialStreamOpen: !!flow._rc?.sseStreamOpen,
    autoRefresh: sseAutoRefresh,
    keywordFilter: sseKeywordFilter,
  });
  const resolvedUrl = resolveFlowRequestUrl(flow.request) || t("traffic.url_unavailable");
  const resolvedUrlPreview = getReadableUrlPreview(resolvedUrl);

  // Use smart auto-scroll hook for AI analysis
  const { scrollRef: analysisScrollRef } = useAutoScroll({
    enabled: analyzing || !!analysis,
    pauseOnUserScroll: true,
    dependencies: [analysis],
  });

  // Reset analysis when flow changes
  useEffect(() => {
    setAnalysis(null);
    setAnalyzing(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const currentFlowId = flow.id;
    if (!currentFlowId) return;
    const flowChanged = lastFlowIdRef.current !== currentFlowId;
    lastFlowIdRef.current = currentFlowId;

    setSseAutoScroll(true);
    setSseAutoRefresh(true);
    setWsAutoScroll(true);
    setWsAutoRefresh(true);
    if (flowChanged) {
      setSseKeywordFilter("");
      setWsDirectionFilter("all");
      setWsKeywordFilter("");
      setResendFrame(null);
    }
    setExpandedSseIds({});
  }, [flow.id]);

  const refreshCurrentFlow = useCallback(async () => {
    if (wsRefreshInFlightRef.current) return;
    wsRefreshInFlightRef.current = true;
    try {
      const { loadDetail, selectedFlow } = useTrafficStore.getState();
      if (!selectedFlow) return;
      const refreshedFlow = await loadDetail(selectedFlow.id, true);
      if (refreshedFlow) {
        useTrafficStore.setState({ selectedFlow: refreshedFlow });
      }
    } finally {
      wsRefreshInFlightRef.current = false;
    }
  }, []);

  useWSRefresh({
    activeTab,
    isWebsocket: flow._rc.isWebsocket,
    autoRefresh: wsAutoRefresh,
    refresh: refreshCurrentFlow,
  });

  const wsFrames = flow._rc.websocketFrames ?? [];
  const filteredWsFrames = useMemo(() => {
    const keyword = wsKeywordFilter.trim().toLowerCase();
    return wsFrames.filter((frame) => {
      if (wsDirectionFilter === "client" && !frame.fromClient) return false;
      if (wsDirectionFilter === "server" && frame.fromClient) return false;
      if (!keyword) return true;
      return frame.content.toLowerCase().includes(keyword);
    });
  }, [wsFrames, wsDirectionFilter, wsKeywordFilter]);

  const handleAIAnalysis = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalysis(""); // Reset to empty for streaming
    try {
      const { chatCompletionStream } = useAIStore.getState();
      const flowData = {
        url: flow.request.url,
        method: flow.request.method,
        statusCode: flow.response.status,
        requestHeaders: harToLegacyHeaders(flow.request.headers),
        responseHeaders: harToLegacyHeaders(flow.response.headers),
        duration: flow.time,
        requestSize: flow.request.postData?.text?.length || 0,
        responseSize: flow.response.content.text?.length || 0,
        requestBody: flow.request.postData?.text ? flow.request.postData.text.slice(0, 2000) : null,
        responseBody: flow.response.content.text ? flow.response.content.text.slice(0, 2000) : null,
        timing: flow.timings,
        hits: flow._rc.hits || [],
      };

      const langInfo = getAILanguageInfo();
      const systemMsg = {
        role: "system" as const,
        content: FLOW_ANALYSIS_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name)
          .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
          .replace(/{{SUMMARY_TITLE}}/g, langInfo.flow.summary)
          .replace(/{{DIAGNOSTICS_TITLE}}/g, langInfo.flow.diagnostics)
          .replace(/{{OPTIMIZATION_TITLE}}/g, langInfo.flow.optimization),
      };

      const userMsg = {
        role: "user" as const,
        content: `Analyze this flow: ${JSON.stringify(flowData, null, 2)} `,
      };

      await chatCompletionStream(
        [systemMsg, userMsg],
        (chunk) => {
          setAnalysis((prev) => {
            let newVal = (prev || "") + chunk;
            // Fix for missing bold markers in stream
            if (newVal.length > 0 && newVal.length < 50 && !newVal.startsWith("**")) {
              // Match title at stream beginning
              if (/^[^*]+\*\*:(.*)/.test(newVal)) {
                newVal = `**${newVal}`;
              }
            }
            return newVal;
          });
        },
        0,
      ); // Force 0 temp for analysis precision
    } catch (error) {
      console.error("AI Analysis failed", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      let userDisplayMsg = errorMsg;

      if (errorMsg.includes("401") || errorMsg.includes("auth") || errorMsg.includes("key")) {
        userDisplayMsg = `${t("flow.analysis.error_auth")} (${errorMsg})`;
      } else if (errorMsg.includes("429") || errorMsg.includes("quota")) {
        userDisplayMsg = `${t("flow.analysis.error_quota")} (${errorMsg})`;
      }

      setError(userDisplayMsg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleReplay = async () => {
    if (replaying) return;
    setReplaying(true);
    try {
      await Promise.all([
        invoke("replay_request", {
          req: {
            method: flow.request.method,
            url: flow.request.url,
            headers: harToLegacyHeaders(flow.request.headers),
            body: flow.request.postData?.text || null,
          },
        }),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    } catch (error) {
      console.error("Replay failed", error);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="h-full flex flex-col bg-card border-l border-subtle overflow-hidden"
    >
      {/* Header - Glassy Sub-surface */}
      <div className="flex flex-col p-4 border-b border-subtle bg-muted/20 flex-shrink-0 gap-3">
        {/* Row 1: Status & Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {flow.request.httpVersion && (
              <span
                className={`px-1.5 py-0.5 rounded text-micro font-semibold font-mono border tracking-wider uppercase ${getProtocolColor(flow.request.httpVersion)}`}
              >
                {formatProtocol(flow.request.httpVersion)}
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded text-micro font-semibold font-mono border tracking-wider ${getHttpMethodBadgeClass(flow.request.method)}`}
            >
              {flow.request.method}
            </span>
            {!(flow.response.status === 0 || String(flow.response.status) === "0") && (
              <span
                className={`px-2 py-0.5 rounded text-micro font-semibold font-mono border tracking-wider ${getHttpStatusCodeClass(flow.response.status)}`}
              >
                {flow.response.status || t("traffic.status.pending")}
              </span>
            )}
            {!!flow.time && (
              <span
                className={`px-1.5 py-0.5 rounded text-micro font-semibold font-mono border tracking-wider transition-colors ${getDurationBadgeClass(flow.time)}`}
              >
                {flow.time.toFixed(0)}ms
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {aiSettings.enabled && (
              <Tooltip content={t("flow.analysis.title")}>
                <button
                  onClick={handleAIAnalysis}
                  disabled={analyzing}
                  className={`flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 hover:border-indigo-500/30 text-indigo-500 rounded-lg transition-all duration-200 shadow-sm interactive-pop ${
                    analyzing ? "animate-pulse" : ""
                  }`}
                >
                  {analyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span className="text-xs font-medium tracking-tight">
                    {t("flow.analysis.btn")}
                  </span>
                </button>
              </Tooltip>
            )}
            {!(flow._rc.isWebsocket || isSse) && (
              <>
                <Tooltip
                  content={
                    <span>
                      {t("flow.replay")}{" "}
                      <span className="text-xs opacity-50 ml-1">{isMac ? "⌘R" : "Ctrl+R"}</span>
                    </span>
                  }
                >
                  <button
                    onClick={handleReplay}
                    disabled={replaying}
                    className={`flex items-center gap-1.5 px-3 py-1 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg transition-all duration-200 shadow-sm interactive-pop ${
                      replaying ? "opacity-80" : ""
                    }`}
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${replaying ? "animate-spin" : ""}`} />
                    <span className="text-xs font-medium tracking-tight">
                      {t("flow.replay_btn")}
                    </span>
                  </button>
                </Tooltip>
                <Tooltip content={t("traffic.context_menu.edit_composer")}>
                  <button
                    onClick={() => {
                      useComposerStore.getState().setComposerFromFlow(flow);
                      useUIStore.getState().setActiveTab("composer");
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/10 hover:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-lg transition-all duration-200 shadow-sm hover:scale-105 active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium tracking-tight">{t("common.edit")}</span>
                  </button>
                </Tooltip>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2: URL & Matched Rules */}
        <div className="space-y-3">
          <div className="flex items-center group/url w-full overflow-hidden relative">
            <Tooltip content={resolvedUrl} side="bottom" className="flex-1 min-w-0">
              <p className="text-xs font-mono truncate text-foreground/90 select-all pr-4 leading-relaxed tracking-tight bg-muted/20 px-2 py-1 rounded-md border border-subtle">
                {resolvedUrlPreview || t("traffic.url_unavailable")}
              </p>
            </Tooltip>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/url:opacity-100 transition-opacity flex-shrink-0 bg-gradient-to-l from-card via-card/95 to-transparent pl-8 py-1">
              <CopyButton
                text={resolvedUrl}
                label={t("traffic.context_menu.copy_url")}
                showLabel={false}
                className="h-7 w-7 hover:bg-muted/50 rounded-lg text-muted-foreground hover:text-foreground"
                tooltipSide="left"
              />
              <CopyButton
                text={generateCurlCommand(flow)}
                label={t("traffic.context_menu.copy_curl")}
                showLabel={false}
                className="h-7 w-7 hover:bg-muted/50 rounded-lg text-muted-foreground hover:text-foreground"
                tooltipSide="left"
              />
            </div>
          </div>

          {flow._rc.hits && flow._rc.hits.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-col gap-1.5">
                {
                  // Deduplicate hits and collect breakpoint phases
                  [
                    ...new Map(
                      flow._rc.hits.map((h) => [
                        h.type === "breakpoint" ? h.id.replace(/:request$|:response$/, "") : h.id,
                        h,
                      ]),
                    ).values(),
                  ].map((hit, idx) => {
                    // Collect unique phases for breakpoint
                    const phases =
                      hit.type === "breakpoint"
                        ? [
                            ...new Set(
                              flow._rc.hits
                                .filter(
                                  (h) =>
                                    h.type === "breakpoint" &&
                                    h.id.replace(/:request$|:response$/, "") ===
                                      hit.id.replace(/:request$|:response$/, ""),
                                )
                                .map((h) => h.phase)
                                .filter(Boolean),
                            ),
                          ]
                        : [];
                    return (
                      <div
                        key={idx}
                        className={`text-xs px-2.5 py-2.5 rounded border flex items-center gap-2 ${getRuleTypeBadgeClass(hit.type, hit.status)}`}
                      >
                        <div className="flex-shrink-0">
                          {hit.type === "script" && (
                            <div className="w-[14px] h-[14px] mt-0.5 flex items-center justify-center rounded-full bg-indigo-500 text-white flex-shrink-0 shadow-[0_1px_2px_rgba(99,102,241,0.4)]">
                              <Terminal className="w-[10px] h-[10px]" strokeWidth={2.5} />
                            </div>
                          )}
                          {hit.type === "breakpoint" && (
                            <CirclePause
                              className="w-4 h-4 text-red-500 flex-shrink-0"
                              strokeWidth={2}
                            />
                          )}
                          {hit.type === "rewrite_body" && <FileSignature className="w-3.5 h-3.5" />}
                          {hit.type === "map_local" && <FileCode className="w-3.5 h-3.5" />}
                          {hit.type === "map_remote" && <Globe className="w-3.5 h-3.5" />}
                          {hit.type === "rewrite_header" && <LayoutList className="w-3.5 h-3.5" />}
                          {hit.type === "throttle" && <Wifi className="w-3.5 h-3.5" />}
                          {hit.type === "block_request" && <Ban className="w-3.5 h-3.5" />}
                        </div>
                        <Tooltip content={hit.name} className="flex-shrink min-w-0">
                          <span className="text-xs font-semibold truncate tracking-tight">
                            {hit.name}
                          </span>
                        </Tooltip>
                        {hit.type === "breakpoint" && phases.length > 0 && (
                          <span className="text-xs opacity-60">
                            (
                            {phases.map((p, i) => (
                              <span key={p}>
                                {p === "request"
                                  ? t("breakpoint.request_phase", "Request")
                                  : t("breakpoint.response_phase", "Response")}
                                {i < phases.length - 1 && " & "}
                              </span>
                            ))}
                            )
                          </span>
                        )}
                        {hit.message &&
                          !(hit.type === "map_local" && hit.status === "file_not_found") && (
                            <Tooltip
                              content={hit.message}
                              className="ml-auto flex-shrink truncate max-w-[60%] text-right"
                            >
                              <span className="text-xs opacity-60 italic truncate font-mono">
                                {hit.message}
                              </span>
                            </Tooltip>
                          )}
                      </div>
                    );
                  })
                }
              </div>

              {flow._rc.hits.some((h) => h.status === "file_not_found") && (
                <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 flex items-start gap-3 shadow-sm overflow-hidden min-w-0">
                  <div className="p-1.5 bg-amber-500/10 rounded-lg flex-shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600/80" />
                  </div>
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="font-semibold text-amber-700/90 text-xs leading-tight">
                      {t("flow.map_local.file_not_found")}
                    </div>
                    <div className="space-y-1.5 min-w-0 flex-1">
                      {flow._rc.hits
                        .filter((h) => h.status === "file_not_found")
                        .map((h, i) => (
                          <div key={i} className="flex items-center group/path gap-1.5 min-w-0">
                            <Tooltip content={h.message} className="min-w-0 flex-1">
                              <div className="text-amber-700/70 font-mono truncate bg-amber-500/[0.03] px-2 py-1 rounded border border-amber-500/5 select-all text-[11px] leading-relaxed">
                                {h.message}
                              </div>
                            </Tooltip>
                            <CopyButton
                              text={h.message || ""}
                              showLabel={false}
                              iconSize={12}
                              className="h-7 w-7 justify-center opacity-0 group-hover/path:opacity-100 transition-all hover:bg-amber-500/10 text-amber-600/60 hover:text-amber-600 p-0 flex-shrink-0"
                              tooltipSide="left"
                            />
                          </div>
                        ))}
                      <div className="text-amber-600/60 text-[11px] flex items-center gap-1.5 mt-0.5">
                        <Globe className="w-3 h-3 opacity-70" />
                        <span>{t("flow.map_local.fallback_hint")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI Analysis Result */}
      {(analysis || error) && (
        <div className="mx-4 mt-3 p-0 bg-transparent animate-in slide-in-from-bottom-2 duration-300 max-h-[40vh] flex flex-col relative overflow-hidden">
          {error && (
            <div className="p-3 bg-error/5 border border-error/20 rounded-xl relative overflow-hidden shadow-sm">
              <div className="absolute top-0 right-0 w-24 h-24 bg-error/5 blur-3xl -mr-12 -mt-12 pointer-events-none" />
              <div className="flex items-start gap-3 relative z-10">
                <div className="p-2 bg-error/10 rounded-lg shrink-0">
                  <AlertTriangle className="w-4 h-4 text-error" />
                </div>
                <div className="space-y-1 pt-0.5 flex-1">
                  <h3 className="text-ui font-semibold text-error flex items-center justify-between">
                    <span>{t("flow.analysis.error")}</span>
                    <button
                      onClick={() => setError(null)}
                      className="p-1 hover:bg-error/10 rounded-full transition-colors text-error/60 hover:text-error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground/80 font-medium">
                    {error}
                  </p>
                  <div
                    className="pt-1 flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground/60 hover:text-primary transition-colors"
                    onClick={() => {
                      useUIStore.getState().setSettingsTab("general");
                      useUIStore.getState().setActiveTab("settings");
                    }}
                  >
                    <Settings className="w-3 h-3" />
                    <span>{t("flow.analysis.check_settings")}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {analysis && (
            <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl shadow-inner relative overflow-hidden flex flex-col">
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 blur-3xl -mr-12 -mt-12" />
              <div className="flex items-center justify-between mb-3 flex-shrink-0 relative z-10">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-primary/20 rounded-lg">
                    <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
                  </div>
                  <span className="text-xs font-semibold text-primary tracking-wider uppercase">
                    {t("flow.analysis.title")}
                  </span>
                </div>
                <button
                  onClick={() => setAnalysis(null)}
                  className="p-1 hover:bg-primary/10 rounded-md transition-colors text-muted-foreground/40 hover:text-primary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div
                ref={analysisScrollRef}
                className="overflow-y-auto pr-1 no-scrollbar scroll-smooth relative z-10 max-h-[300px]"
              >
                <div className="pb-1">
                  <AIMarkdown content={analysis} />
                  {analyzing && (
                    <span className="inline-block w-1.5 h-4 ml-1 bg-primary animate-pulse align-middle" />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-border bg-muted/10 flex justify-center">
          <TabsList className="p-1 rounded-xl h-auto bg-muted/30 border border-border/40">
            <TabsTrigger
              value="request"
              className="py-1 px-5 text-xs font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
            >
              {t("flow.tabs.request")}
            </TabsTrigger>
            <TabsTrigger
              value="response"
              className="py-1 px-5 text-xs font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
            >
              {t("flow.tabs.response")}
            </TabsTrigger>
            {isSse && (
              <TabsTrigger
                value="sse"
                className="py-1 px-5 text-xs font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
              >
                SSE
              </TabsTrigger>
            )}
            {flow._rc.isWebsocket && (
              <TabsTrigger
                value="messages"
                className="py-1 px-5 text-xs font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
              >
                {t("flow.tabs.messages")}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <AnimatePresence mode="wait">
            {activeTab === "request" && (
              <TabsContent
                value="request"
                key="request"
                forceMount
                className="mt-0 flex-1 overflow-y-auto p-4 pt-2 space-y-4"
              >
                <motion.div
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("flow.sections.request_headers")}
                      </h3>
                    </div>
                    <HeadersView headers={flow.request.headers} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("flow.sections.request_body")}
                      </h3>
                    </div>
                    <BodyView
                      content={flow.request.postData?.text || undefined}
                      encoding={flow.request.postData?.text ? "text" : undefined}
                      headers={flow.request.headers}
                    />
                  </div>
                </motion.div>
              </TabsContent>
            )}

            {activeTab === "response" && (
              <TabsContent
                value="response"
                key="response"
                forceMount
                className="mt-0 flex-1 overflow-y-auto p-4 pt-2 space-y-4"
              >
                <motion.div
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("flow.sections.response_headers")}
                      </h3>
                    </div>
                    <HeadersView headers={flow.response.headers} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("flow.sections.response_body")}
                      </h3>
                    </div>
                    <BodyView
                      content={flow.response.content.text || undefined}
                      encoding={
                        flow.response.content.encoding === "base64url"
                          ? "base64"
                          : flow.response.content.encoding
                      }
                      headers={flow.response.headers}
                    />
                  </div>
                </motion.div>
              </TabsContent>
            )}

            {activeTab === "messages" && flow._rc.isWebsocket && (
              <WSMessagesPanel
                t={t}
                frameCount={flow._rc.websocketFrameCount || 0}
                rawFrameCount={flow._rc.websocketFrames?.length ?? 0}
                filteredFrames={filteredWsFrames}
                wsAutoScroll={wsAutoScroll}
                wsAutoRefresh={wsAutoRefresh}
                wsKeywordFilter={wsKeywordFilter}
                wsDirectionFilter={wsDirectionFilter}
                wsListRef={wsListRef}
                setWsAutoScroll={setWsAutoScroll}
                setWsAutoRefresh={setWsAutoRefresh}
                setWsKeywordFilter={setWsKeywordFilter}
                setWsDirectionFilter={setWsDirectionFilter}
                onResendFrame={setResendFrame}
              />
            )}

            {activeTab === "sse" && isSse && (
              <SSEPanel
                t={t}
                sseStreamOpen={sseStreamOpen}
                sseEvents={sseEvents}
                sseDroppedCount={sseDroppedCount}
                sseAutoScroll={sseAutoScroll}
                sseAutoRefresh={sseAutoRefresh}
                sseKeywordFilter={sseKeywordFilter}
                filteredSseEvents={filteredSseEvents}
                expandedSseIds={expandedSseIds}
                sseListRef={sseListRef}
                setSseAutoScroll={setSseAutoScroll}
                setSseAutoRefresh={setSseAutoRefresh}
                setSseKeywordFilter={setSseKeywordFilter}
                setExpandedSseIds={setExpandedSseIds}
              />
            )}
          </AnimatePresence>
        </div>
      </Tabs>
      <WsResendDrawer
        isOpen={!!resendFrame}
        onClose={() => setResendFrame(null)}
        flowId={flow.id}
        frame={resendFrame}
      />
    </motion.div>
  );
}
