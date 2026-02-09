import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
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
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAILanguageInfo } from "../../lib/ai/lang";
import { FLOW_ANALYSIS_SYSTEM_PROMPT } from "../../lib/ai/prompts";
import { generateCurlCommand } from "../../lib/curl";
import { formatProtocol, getProtocolColor } from "../../lib/utils";
import { useAIStore } from "../../stores/aiStore";
import { useComposerStore } from "../../stores/composerStore";
import { useUIStore } from "../../stores/uiStore";
import type { Flow } from "../../types";
import { AIMarkdown } from "../ai/AIMarkdown";
import { CopyButton } from "../common/CopyButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../common/Tabs";
import { Tooltip } from "../common/Tooltip";
import { BodyView } from "./BodyView";
import { HeadersView } from "./HeadersView";

// ... existing imports ...

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
  const analysisScrollRef = useRef<HTMLDivElement>(null);

  // Reset analysis when flow changes
  useEffect(() => {
    setAnalysis(null);
    setAnalyzing(false);
  }, []);

  // Auto-scroll for analysis
  useEffect(() => {
    if (analysisScrollRef.current && analyzing) {
      analysisScrollRef.current.scrollTop = analysisScrollRef.current.scrollHeight;
    }
  }, [analyzing]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAIAnalysis = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalysis(""); // Reset to empty for streaming
    try {
      const { chatCompletionStream } = useAIStore.getState();
      const flowData = {
        url: flow.url,
        method: flow.method,
        statusCode: flow.statusCode,
        requestHeaders: flow.requestHeaders,
        responseHeaders: flow.responseHeaders,
        duration: flow.duration,
        requestSize: flow.requestBody?.length || 0,
        responseSize: flow.responseBody?.length || 0,
        requestBody: flow.requestBody ? flow.requestBody.slice(0, 2000) : null,
        responseBody: flow.responseBody ? flow.responseBody.slice(0, 2000) : null,
        timing: flow.timing,
        hits: flow.hits || [],
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
        content: `Analyze this flow: ${JSON.stringify(flowData, null, 2)}`,
      };

      await chatCompletionStream(
        [systemMsg, userMsg],
        (chunk) => {
          setAnalysis((prev) => {
            let newVal = (prev || "") + chunk;
            // Robust fix for missing bold markers at the start of the stream
            // If the stream starts with text followed by **:, it's likely a title missing its opening **
            if (newVal.length > 0 && newVal.length < 50 && !newVal.startsWith("**")) {
              // Match something like "Title**:" or "Any Language Title**:"
              // but only at the very beginning of the string
              if (/^[^*]+(\*\*):/.test(newVal)) {
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
            method: flow.method,
            url: flow.url,
            headers: flow.requestHeaders,
            body: flow.requestBody || null,
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
      className="h-full flex flex-col bg-card/40 backdrop-blur-2xl border-l border-white/10 overflow-hidden"
    >
      {/* Header - Glassy Sub-surface */}
      <div className="flex flex-col p-4 border-b border-white/10 bg-muted/20 backdrop-blur-md flex-shrink-0 gap-3">
        {/* Row 1: Status & Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {flow.httpVersion && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${getProtocolColor(flow.httpVersion)}`}
              >
                {formatProtocol(flow.httpVersion)}
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                flow.method === "GET"
                  ? "bg-blue-500/20 text-blue-400"
                  : flow.method === "POST"
                    ? "bg-green-500/20 text-green-400"
                    : flow.method === "PUT"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : flow.method === "DELETE"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-gray-500/20 text-gray-400"
              }`}
            >
              {flow.method}
            </span>
            {!(flow.statusCode === 0 || String(flow.statusCode) === "0") && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                  flow.statusCode && flow.statusCode < 300
                    ? "bg-green-500/20 text-green-400"
                    : flow.statusCode && flow.statusCode < 400
                      ? "bg-yellow-500/20 text-yellow-400"
                      : flow.statusCode
                        ? "bg-red-500/20 text-red-400"
                        : "bg-gray-500/20 text-gray-400"
                }`}
              >
                {flow.statusCode || t("traffic.status.pending")}
              </span>
            )}
            {!!flow.duration && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border transition-colors ${
                  flow.duration < 400
                    ? "bg-muted/10 text-muted-foreground/50 border-border/30"
                    : flow.duration < 1000
                      ? "bg-yellow-500/5 text-yellow-500/80 border-yellow-500/20"
                      : flow.duration < 3000
                        ? "bg-orange-500/10 text-orange-500 border-orange-500/20"
                        : "bg-red-500/10 text-red-500 border-red-500/30 animate-pulse"
                }`}
              >
                {flow.duration.toFixed(0)}ms
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {aiSettings.enabled && (
              <Tooltip content={t("flow.analysis.title")}>
                <button
                  onClick={handleAIAnalysis}
                  disabled={analyzing}
                  className={`flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 hover:border-indigo-500/30 text-indigo-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-indigo-500/10 hover:scale-105 active:scale-95 ${
                    analyzing ? "animate-pulse" : ""
                  }`}
                >
                  {analyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span className="text-[11px] font-bold tracking-tight">
                    {t("flow.analysis.btn")}
                  </span>
                </button>
              </Tooltip>
            )}
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
                className={`flex items-center gap-1.5 px-3 py-1 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg transition-all duration-200 shadow-sm ${
                  replaying ? "opacity-80" : "hover:scale-105 active:scale-95"
                }`}
              >
                <RotateCw className={`w-3.5 h-3.5 ${replaying ? "animate-spin" : ""}`} />
                <span className="text-[11px] font-bold tracking-tight">{t("flow.replay_btn")}</span>
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
                <span className="text-[11px] font-bold tracking-tight">{t("common.edit")}</span>
              </button>
            </Tooltip>
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
            <Tooltip content={flow.url} side="bottom" className="flex-1 min-w-0">
              <p className="text-[12px] font-mono truncate text-foreground/90 select-all pr-4 leading-relaxed tracking-tight bg-muted/20 px-2 py-1 rounded-md border border-white/[0.03]">
                {flow.url}
              </p>
            </Tooltip>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/url:opacity-100 transition-opacity flex-shrink-0 bg-gradient-to-l from-card via-card/95 to-transparent pl-8 py-1">
              <CopyButton
                text={flow.url}
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

          {flow.hits && flow.hits.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-col gap-1.5">
                {flow.hits.map((hit, idx) => (
                  <div
                    key={idx}
                    className={`text-[10px] px-2 py-1 rounded border flex items-center gap-2 ${
                      hit.status === "error" || hit.status === "file_not_found"
                        ? "bg-yellow-500/20 text-yellow-600 border-yellow-400"
                        : hit.type === "script"
                          ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30"
                          : hit.type === "rewrite_body"
                            ? "bg-purple-500/10 text-purple-600 border-purple-200"
                            : hit.type === "map_local"
                              ? "bg-blue-500/10 text-blue-600 border-blue-200"
                              : hit.type === "map_remote"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-200"
                                : hit.type === "rewrite_header"
                                  ? "bg-orange-500/10 text-orange-600 border-orange-200"
                                  : hit.type === "throttle"
                                    ? "bg-cyan-500/10 text-cyan-600 border-cyan-200"
                                    : hit.type === "block_request"
                                      ? "bg-rose-500/10 text-rose-600 border-rose-200"
                                      : "bg-gray-500/10 text-gray-600 border-gray-200"
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {hit.type === "script" && <Terminal className="w-3.5 h-3.5" />}
                      {hit.type === "rewrite_body" && <FileSignature className="w-3.5 h-3.5" />}
                      {hit.type === "map_local" && <FileCode className="w-3.5 h-3.5" />}
                      {hit.type === "map_remote" && <Globe className="w-3.5 h-3.5" />}
                      {hit.type === "rewrite_header" && <LayoutList className="w-3.5 h-3.5" />}
                      {hit.type === "throttle" && <Wifi className="w-3.5 h-3.5" />}
                      {hit.type === "block_request" && <Ban className="w-3.5 h-3.5" />}
                    </div>
                    <Tooltip content={hit.name} className="flex-shrink min-w-0">
                      <span className="text-[12px] font-extrabold truncate tracking-tight">
                        {hit.name}
                      </span>
                    </Tooltip>
                    {hit.message && (
                      <Tooltip
                        content={hit.message}
                        className="ml-auto flex-shrink truncate max-w-[60%] text-right"
                      >
                        <span className="text-[10px] opacity-60 italic truncate font-mono">
                          {hit.message}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>

              {flow.hits.some((h) => h.status === "file_not_found") && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-1.5 flex items-start gap-2 shadow-sm">
                  <div className="p-0.5 bg-yellow-500/20 rounded flex-shrink-0">
                    <AlertTriangle className="w-3 h-3 text-yellow-600" />
                  </div>
                  <div className="text-[10px] space-y-0.5 min-w-0 flex-1">
                    <div className="font-bold text-yellow-700 leading-tight">
                      {t("flow.map_local.file_not_found")}
                    </div>
                    <Tooltip
                      content={flow.hits
                        .filter((h) => h.status === "file_not_found")
                        .map((h) => h.message)
                        .join(", ")}
                    >
                      <div className="text-yellow-600/80 font-mono truncate bg-yellow-500/5 px-1 py-0.5 rounded border border-yellow-500/10 select-all cursor-help text-[9px]">
                        {flow.hits
                          .filter((h) => h.status === "file_not_found")
                          .map((h) => h.message)
                          .join(", ")}
                      </div>
                    </Tooltip>
                    <div className="text-yellow-600/70 text-[8px] italic flex items-center gap-1">
                      <Globe className="w-2 h-2" />
                      {t("flow.map_local.fallback_hint")}
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
            <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-xl relative overflow-hidden shadow-sm">
              <div className="absolute top-0 right-0 w-24 h-24 bg-destructive/5 blur-3xl -mr-12 -mt-12 pointer-events-none" />
              <div className="flex items-start gap-3 relative z-10">
                <div className="p-2 bg-destructive/10 rounded-lg shrink-0">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                </div>
                <div className="space-y-1 pt-0.5 flex-1">
                  <h3 className="text-xs font-bold text-destructive flex items-center justify-between">
                    <span>{t("flow.analysis.error")}</span>
                    <button
                      onClick={() => setError(null)}
                      className="p-1 hover:bg-destructive/10 rounded-full transition-colors text-destructive/60 hover:text-destructive"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </h3>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/80 font-medium">
                    {error}
                  </p>
                  <div
                    className="pt-1 flex items-center gap-1.5 cursor-pointer text-[10px] text-muted-foreground/60 hover:text-primary transition-colors"
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
                  <span className="text-[10px] font-bold text-primary tracking-widest uppercase">
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
                className="overflow-y-auto pr-1 no-scrollbar scroll-smooth relative z-10"
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
              className="py-1.5 px-6 text-xs font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
            >
              {t("flow.tabs.request")}
            </TabsTrigger>
            <TabsTrigger
              value="response"
              className="py-1.5 px-6 text-xs font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
            >
              {t("flow.tabs.response")}
            </TabsTrigger>
            {flow.isWebsocket && (
              <TabsTrigger
                value="messages"
                className="py-1.5 px-6 text-xs font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
              >
                {t("flow.tabs.messages")}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto p-4 pt-2">
          <AnimatePresence mode="wait">
            {activeTab === "request" && (
              <TabsContent value="request" key="request" forceMount className="mt-0 space-y-4">
                <motion.div
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em] pl-1">
                        {t("flow.sections.request_headers")}
                      </h3>
                    </div>
                    <HeadersView headers={flow.requestHeaders} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em] pl-1">
                        {t("flow.sections.request_body")}
                      </h3>
                    </div>
                    <BodyView
                      content={flow.requestBody || undefined}
                      encoding={flow.requestBodyEncoding}
                      headers={flow.requestHeaders}
                    />
                  </div>
                </motion.div>
              </TabsContent>
            )}

            {activeTab === "response" && (
              <TabsContent value="response" key="response" forceMount className="mt-0 space-y-4">
                <motion.div
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em] pl-1">
                        {t("flow.sections.response_headers")}
                      </h3>
                    </div>
                    <HeadersView headers={flow.responseHeaders || {}} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em] pl-1">
                        {t("flow.sections.response_body")}
                      </h3>
                    </div>
                    <BodyView
                      content={flow.responseBody || undefined}
                      encoding={flow.responseBodyEncoding}
                      headers={flow.responseHeaders}
                    />
                  </div>
                </motion.div>
              </TabsContent>
            )}

            {activeTab === "messages" && flow.isWebsocket && (
              <TabsContent
                value="messages"
                key="messages"
                forceMount
                className="mt-0 h-full flex flex-col"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.99 }}
                  transition={{ duration: 0.15 }}
                  className="flex-1 flex flex-col h-full"
                >
                  <div className="flex-1 flex flex-col min-h-0 bg-muted/5 rounded-xl border border-border/40 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/20">
                      <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
                        {t("traffic.websocket.frames")}
                      </h3>
                      <span className="text-[10px] text-muted-foreground/60">
                        {t("traffic.websocket.messages_count", {
                          count: flow.websocketFrames?.length || 0,
                        })}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto scrollbar-thin">
                      {flow.websocketFrames && flow.websocketFrames.length > 0 ? (
                        <div className="divide-y divide-border/20">
                          {flow.websocketFrames.map((frame, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-3 p-2.5 hover:bg-muted/30 transition-colors group/frame"
                            >
                              <div
                                className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm ${
                                  frame.fromClient
                                    ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                                    : "bg-green-500/10 text-green-500 border border-green-500/20"
                                }`}
                              >
                                {frame.fromClient ? "↑" : "↓"}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border ${
                                      frame.type === "text"
                                        ? "bg-purple-500/5 text-purple-500/70 border-purple-500/10"
                                        : frame.type === "binary"
                                          ? "bg-orange-500/5 text-orange-500/70 border-orange-500/10"
                                          : "bg-muted text-muted-foreground/60 border-border/20"
                                    }`}
                                  >
                                    {frame.type}
                                  </span>
                                  <span className="text-[9px] text-muted-foreground/40 font-mono">
                                    {new Date(frame.timestamp).toLocaleTimeString([], {
                                      hour12: false,
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </span>
                                  <span className="text-[9px] text-muted-foreground/30 ml-auto group-hover/frame:text-muted-foreground/60 transition-colors">
                                    {frame.length} B
                                  </span>
                                </div>
                                <p className="text-[11px] font-mono leading-relaxed break-all text-foreground/80 selection:bg-primary/20">
                                  {frame.content}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                          <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-3">
                            <Wifi className="w-6 h-6 text-muted-foreground/20" />
                          </div>
                          <p className="text-xs text-muted-foreground/50 font-medium">
                            {t("traffic.websocket.no_frames")}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              </TabsContent>
            )}
          </AnimatePresence>
        </div>
      </Tabs>
    </motion.div>
  );
}
