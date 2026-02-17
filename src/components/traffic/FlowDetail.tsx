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
import { useUIStore } from "../../stores/uiStore";
import type { Flow } from "../../types";
import { harToLegacyHeaders } from "../../types";
import { AIMarkdown } from "../ai/AIMarkdown";
import { CopyButton } from "../common/CopyButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../common/Tabs";
import { Tooltip } from "../common/Tooltip";
import { BodyView } from "./BodyView";
import { HeadersView } from "./HeadersView";

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
      className="h-full flex flex-col bg-card/60 backdrop-blur-lg border-l border-subtle overflow-hidden"
    >
      {/* Header - Glassy Sub-surface */}
      <div className="flex flex-col p-4 border-b border-subtle bg-muted/20 backdrop-blur-md flex-shrink-0 gap-3">
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
                  <span className="text-ui font-semibold tracking-tight">
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
                className={`flex items-center gap-1.5 px-3 py-1 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg transition-all duration-200 shadow-sm interactive-pop ${
                  replaying ? "opacity-80" : ""
                }`}
              >
                <RotateCw className={`w-3.5 h-3.5 ${replaying ? "animate-spin" : ""}`} />
                <span className="text-ui font-semibold tracking-tight">{t("flow.replay_btn")}</span>
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
                <span className="text-ui font-semibold tracking-tight">{t("common.edit")}</span>
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
            <Tooltip content={flow.request.url} side="bottom" className="flex-1 min-w-0">
              <p className="text-xs font-mono truncate text-foreground/90 select-all pr-4 leading-relaxed tracking-tight bg-muted/20 px-2 py-1 rounded-md border border-subtle">
                {flow.request.url}
              </p>
            </Tooltip>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/url:opacity-100 transition-opacity flex-shrink-0 bg-gradient-to-l from-card via-card/95 to-transparent pl-8 py-1">
              <CopyButton
                text={flow.request.url}
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
                  // Deduplicate hits by id (same script/rule may hit multiple times in different branches)
                  [...new Map(flow._rc.hits.map((h) => [h.id, h])).values()].map((hit, idx) => (
                    <div
                      key={idx}
                      className={`text-xs px-2 py-1 rounded border flex items-center gap-2 ${getRuleTypeBadgeClass(hit.type, hit.status)}`}
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
                        <span className="text-xs font-semibold truncate tracking-tight">
                          {hit.name}
                        </span>
                      </Tooltip>
                      {hit.message && (
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
                  ))
                }
              </div>

              {flow._rc.hits.some((h) => h.status === "file_not_found") && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-1.5 flex items-start gap-2 shadow-sm">
                  <div className="p-0.5 bg-yellow-500/20 rounded flex-shrink-0">
                    <AlertTriangle className="w-3 h-3 text-yellow-600" />
                  </div>
                  <div className="text-xs spaces-y-0.5 min-w-0 flex-1">
                    <div className="font-semibold text-yellow-700 leading-tight">
                      {t("flow.map_local.file_not_found")}
                    </div>
                    <Tooltip
                      content={flow._rc.hits
                        .filter((h) => h.status === "file_not_found")
                        .map((h) => h.message)
                        .join(", ")}
                    >
                      <div className="text-yellow-600/80 font-mono truncate bg-yellow-500/5 px-1 py-0.5 rounded border border-yellow-500/10 select-all cursor-help text-xs">
                        {flow._rc.hits
                          .filter((h) => h.status === "file_not_found")
                          .map((h) => h.message)
                          .join(", ")}
                      </div>
                    </Tooltip>
                    <div className="text-yellow-600/70 text-xs italic flex items-center gap-1">
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
              className="py-1 px-5 text-tiny font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
            >
              {t("flow.tabs.request")}
            </TabsTrigger>
            <TabsTrigger
              value="response"
              className="py-1 px-5 text-tiny font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
            >
              {t("flow.tabs.response")}
            </TabsTrigger>
            {flow._rc.isWebsocket && (
              <TabsTrigger
                value="messages"
                className="py-1 px-5 text-tiny font-semibold tracking-tight rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
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
                      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-[0.15em]">
                        {t("traffic.websocket.frames")}
                      </h3>
                      <span className="text-xs text-muted-foreground/60">
                        {t("traffic.websocket.messages_count", {
                          count: flow._rc.websocketFrameCount || 0,
                        })}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto scrollbar-thin">
                      {flow._rc.websocketFrameCount && flow._rc.websocketFrameCount > 0 ? (
                        <div className="divide-y divide-border/20">
                          {/* WebSocket frames would be loaded separately */}
                          <div className="p-4 text-center text-muted-foreground text-xs">
                            WebSocket frames are stored separately and loaded on demand.
                          </div>
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
