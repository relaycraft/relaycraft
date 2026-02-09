import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  CornerDownLeft,
  FileJson,
  Layers,
  Loader2,
  Lock,
  MessageSquare,
  Package,
  Power,
  Radar,
  SendHorizontal,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSuggestionEngine } from "../../hooks/useSuggestionEngine";
import { dispatchCommand } from "../../lib/ai/dispatcher";
import { mapAIRuleToInternal } from "../../lib/ai/ruleMapper";
import { SuggestionEngine } from "../../lib/ai/suggestionEngine";
import { useAIStore } from "../../stores/aiStore";
import { type CommandAction, useCommandStore } from "../../stores/commandStore";
import { useComposerStore } from "../../stores/composerStore";
import { usePluginPageStore } from "../../stores/pluginPageStore";
import { useProxyStore } from "../../stores/proxyStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useScriptStore } from "../../stores/scriptStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { type TabType, useUIStore } from "../../stores/uiStore";
import { Tooltip } from "../common/Tooltip";
import { AIMarkdown } from "./AIMarkdown";

export function CommandCenter() {
  const { t } = useTranslation();
  const { getSuggestions } = useSuggestionEngine();
  const { isOpen, setIsOpen, input, setInput, addHistory, suggestions, setSuggestions } =
    useCommandStore();
  const { setActiveTab, setDraftScriptPrompt } = useUIStore();
  const { settings: aiSettings } = useAIStore();
  const [executing, setExecuting] = useState(false);
  const pluginPages = usePluginPageStore((state) => state.pages);

  // Reset state when closed (Aborts UI stream)
  useEffect(() => {
    if (!isOpen) {
      setExecuting(false);
      setStreamingMessage(null);
      setAction(null);
      setError(null); // Clear error when closing
    }
  }, [isOpen]);

  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [action, setAction] = useState<CommandAction | null>(null);
  const [error, setError] = useState<string | null>(null); // New error state
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Feature stores for context gathering
  const activeTab = useUIStore((state) => state.activeTab);
  const selectedFlow = useTrafficStore((state) => state.selectedFlow);
  const selectedRule = useRuleStore((state) => state.selectedRule);
  const draftRule = useRuleStore((state) => state.draftRule);

  const { setDraftRule, selectRule, rules } = useRuleStore();
  const { startProxy, stopProxy } = useProxyStore();
  const { clearFlows } = useTrafficStore();
  const { scripts } = useScriptStore();

  const activeRulesCount = rules.filter((r) => r.execution.enabled).length;
  const activeScriptsCount = scripts.filter((s) => s.enabled).length;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setAction(null);

      // Auto-prefill / if AI is disabled and empty
      if (!(aiSettings.enabled || input.trim())) {
        setInput("/");
      }
    }
  }, [isOpen, aiSettings.enabled, input, setInput]);

  const updateContextualSuggestions = useCallback(() => {
    const newSuggestions = getSuggestions(input);
    setSuggestions(newSuggestions);
  }, [input, getSuggestions, setSuggestions]);

  useEffect(() => {
    if (isOpen) {
      updateContextualSuggestions();
    }
  }, [isOpen, updateContextualSuggestions]);

  // Auto-scroll to bottom when streaming
  useEffect(() => {
    if (scrollRef.current && (streamingMessage || executing)) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingMessage, executing]);

  const handleRunCommand = async (forceInput?: string) => {
    const commandToRun = forceInput || input;
    if (!commandToRun || executing) return;

    if (!(aiSettings.enabled || commandToRun.startsWith("/"))) {
      return;
    }

    setExecuting(true);
    setAction(null);
    setStreamingMessage("");

    try {
      const context = {
        activePage: activeTab,
        selectedTraffic: selectedFlow
          ? {
              id: selectedFlow.id,
              url: selectedFlow.url,
              method: selectedFlow.method,
              status: selectedFlow.statusCode,
              requestHeaders: selectedFlow.requestHeaders,
              responseHeaders: selectedFlow.responseHeaders,
            }
          : null,
        activeRule: selectedRule || draftRule || null,
      };

      const result = await dispatchCommand(commandToRun, context, t, (chunk) => {
        setStreamingMessage((prev) => (prev || "") + chunk);
      });

      // For CHAT and CREATE_SCRIPT with requirements, keep streamingMessage visible
      if (
        result.intent !== "CHAT" &&
        !(result.intent === "CREATE_SCRIPT" && result.params?.requirement)
      ) {
        setStreamingMessage(null);
      }

      const SafeIntents = [
        "NAVIGATE",
        "OPEN_SETTINGS",
        "CREATE_RULE",
        "CREATE_SCRIPT",
        "CLEAR_TRAFFIC",
        "GENERATE_REQUEST",
        "CHAT",
      ];

      if (!aiSettings.enabled && result.intent === "CHAT") {
        setAction({
          intent: "CHAT",
          params: { message: t("command_center.not_enabled_warning") },
          confidence: 1.0,
        });
      } else if (SafeIntents.includes(result.intent)) {
        await executeAction(result);
      } else {
        setAction(result);
      }
      addHistory(commandToRun);
      SuggestionEngine.recordUsage(
        commandToRun.startsWith("/") ? commandToRun.split(" ")[0] : commandToRun,
      );
    } catch (error) {
      console.error("Command failed", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setError(errorMsg);
    } finally {
      setExecuting(false);
    }
  };

  const mapperPathToTab = (path: string): TabType | null => {
    const p = path.toLowerCase();
    if (p.includes("rule")) return "rules";
    if (p.includes("script")) return "scripts";
    if (p.includes("traffic") || p.includes("dashboard")) return "traffic";
    if (p.includes("composer")) return "composer";
    if (p.includes("plugin")) return "plugins";
    if (p.includes("cert")) return "certificate";
    if (p.includes("setting")) return "settings";
    return null;
  };

  const executeAction = async (forcedAction?: CommandAction) => {
    const act = forcedAction || action;
    if (!act) return;

    switch (act.intent) {
      case "NAVIGATE":
        if (act.params?.path) {
          const tab = mapperPathToTab(act.params.path);
          if (tab) setActiveTab(tab);
        }
        setIsOpen(false);
        break;
      case "CREATE_RULE": {
        selectRule(null);
        const rawRule = act.params?.rule || {
          name: act.params?.description || "AI Rule",
        };
        setDraftRule(mapAIRuleToInternal(rawRule));
        setActiveTab("rules");
        setIsOpen(false);
        break;
      }
      case "OPEN_SETTINGS":
        if (act.params?.category) {
          useUIStore.getState().setSettingsTab(act.params.category as any);
        }
        setActiveTab("settings");
        setIsOpen(false);
        break;
      case "CREATE_SCRIPT": {
        const scriptName = act.params?.name || `Untitled Script.py`;

        // Direct jump logic: user wants to generate IN the editor
        // We ignore any potential generated code in the message and just take the intent/requirement
        const requirement =
          act.params?.requirement || act.params?.description || act.params?.message || "";

        // Initialize a blank draft so the editor opens
        const defaultTemplate = `"""\nAddon Script for RelayCraft\n"""\nfrom mitmproxy import http, ctx\n\nclass Addon:\n    def request(self, flow: http.HTTPFlow):\n        # TODO: Add your logic\n        pass\n\naddons = [Addon()]\n`;
        useScriptStore.getState().setDraftScript({ name: scriptName, content: defaultTemplate });

        // Pass the requirement to AI Assistant to pre-fill/auto-run
        if (requirement) {
          setDraftScriptPrompt(requirement);
        } else {
          // Fallback to just opening the AI panel
          setDraftScriptPrompt("INITIAL_OPEN_ONLY");
        }

        setActiveTab("scripts");
        setIsOpen(false);
        break;
      }
      case "CLEAR_TRAFFIC":
        clearFlows();
        setIsOpen(false);
        break;
      case "TOGGLE_PROXY":
        if (act.params?.action === "start") await startProxy();
        else if (act.params?.action === "stop") await stopProxy();
        setIsOpen(false);
        break;
      case "GENERATE_REQUEST":
        if (act.params) {
          const composer = useComposerStore.getState();
          if (act.params.method) composer.setMethod(act.params.method);
          if (act.params.url) composer.setUrl(act.params.url);
          if (act.params.headers) {
            composer.setHeaders(act.params.headers.map((h: any) => ({ ...h, enabled: true })));
          }
          if (act.params.body) composer.setBody(act.params.body);
          if (act.params.bodyType) composer.setBodyType(act.params.bodyType);
        }
        setActiveTab("composer");
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  const getIntentLabel = (intent: string) => {
    const labels: Record<string, string> = {
      NAVIGATE: t("command_center.actions.navigate"),
      CREATE_RULE: t("command_center.actions.create_rule"),
      CREATE_SCRIPT: t("command_center.actions.create_script"),
      OPEN_SETTINGS: t("command_center.actions.open_settings"),
      CLEAR_TRAFFIC: t("command_center.actions.clear_traffic"),
      TOGGLE_PROXY: t("command_center.actions.toggle_proxy"),
      CHAT: t("command_center.actions.chat"),
    };
    return labels[intent] || intent;
  };

  const isEditingRule = activeTab === "rules" && (selectedRule || draftRule);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-black/25 backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className="w-full max-w-2xl bg-popover/95 backdrop-blur-xl border border-border/40 rounded-xl shadow-2xl overflow-hidden flex flex-col ring-1 ring-border/40"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input Area */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-muted/20">
              <div className="p-1.5 bg-primary/10 rounded-md shrink-0">
                {aiSettings.enabled ? (
                  <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                ) : (
                  <Terminal className="w-4 h-4 text-muted-foreground opacity-60" />
                )}
              </div>
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRunCommand()}
                  placeholder={
                    isEditingRule
                      ? t("command_center.placeholder.editing_rule")
                      : aiSettings.enabled
                        ? t("command_center.placeholder.ai")
                        : t("command_center.placeholder.default")
                  }
                  className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/40 font-medium"
                />
                {isEditingRule && (
                  <div className="shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 animate-in zoom-in-95">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="text-[10px] font-bold text-primary uppercase tracking-tight">
                      {t("command_center.status.editing")}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Trash icon removed */}
                {/* ESC hint removed */}
              </div>
            </div>

            {/* Content Area */}
            <div
              ref={scrollRef}
              className="flex-1 max-h-[50vh] overflow-y-auto p-1 no-scrollbar scroll-smooth"
            >
              {!(action || executing) && (
                <div className="p-1 space-y-0.5">
                  <div className="px-2 py-1.5 flex items-center justify-between min-h-[32px]">
                    <div className="flex flex-wrap gap-1 items-center">
                      {/* Tab Context */}
                      <span className="text-[9px] bg-muted/50 text-muted-foreground/70 h-5 px-1.5 rounded-md border border-border/40 flex items-center gap-1 font-bold">
                        {(() => {
                          const page = pluginPages.find(
                            (p) => p.id === activeTab || p.route === activeTab,
                          );
                          if (page?.icon) {
                            const PluginIcon = page.icon;
                            return <PluginIcon className="w-3 h-3" />;
                          }

                          if (activeTab === "traffic") return <Radar className="w-3 h-3" />;
                          if (activeTab === "composer")
                            return <SendHorizontal className="w-3 h-3" />;
                          if (activeTab === "rules") return <Layers className="w-3 h-3" />;
                          if (activeTab === "scripts") return <Braces className="w-3 h-3" />;
                          if (activeTab === "plugins") return <Package className="w-3 h-3" />;
                          if (activeTab === "certificate") return <Lock className="w-3 h-3" />;
                          if (activeTab === "settings") return <Settings className="w-3 h-3" />;
                          return null;
                        })()}
                        {(() => {
                          if (
                            [
                              "traffic",
                              "composer",
                              "rules",
                              "scripts",
                              "plugins",
                              "certificate",
                              "settings",
                            ].includes(activeTab)
                          ) {
                            return t(`sidebar.${activeTab}`);
                          }
                          // Try to find plugin page name
                          const page = pluginPages.find(
                            (p) => p.id === activeTab || p.route === activeTab,
                          );
                          return page ? (page.nameKey ? t(page.nameKey) : page.name) : activeTab;
                        })()}
                      </span>

                      {/* Flow Context */}
                      {selectedFlow && (
                        <span
                          className="text-[9px] bg-muted/50 text-muted-foreground/70 h-5 px-1.5 rounded-md border border-border/40 flex items-center gap-1 font-bold animate-in fade-in zoom-in-95"
                          title={selectedFlow.url}
                        >
                          <FileJson className="w-3 h-3" />
                        </span>
                      )}

                      {/* Active Rules Count */}
                      {activeRulesCount > 0 && (
                        <span className="text-[9px] bg-muted/50 text-muted-foreground/70 h-5 px-1.5 rounded-md border border-border/40 flex items-center gap-1 font-bold animate-in fade-in zoom-in-95">
                          <Layers className="w-3 h-3" /> {activeRulesCount}
                        </span>
                      )}

                      {/* Active Scripts Count */}
                      {activeScriptsCount > 0 && (
                        <span className="text-[9px] bg-muted/50 text-muted-foreground/70 h-5 px-1.5 rounded-md border border-border/40 flex items-center gap-1 font-bold animate-in fade-in zoom-in-95">
                          <Braces className="w-3 h-3" /> {activeScriptsCount}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {useAIStore.getState().history.length > 0 && (
                        <Tooltip content={t("ai.clear_memory")}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              useAIStore.getState().clearHistory();
                            }}
                            className="text-[9px] bg-muted/50 text-muted-foreground/70 h-5 px-1.5 rounded-md border border-border/40 flex items-center gap-1 font-bold animate-in fade-in zoom-in-95 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all cursor-pointer"
                          >
                            <MessageSquare className="w-3 h-3" />
                            {Math.ceil(useAIStore.getState().history.length / 2)}
                          </button>
                        </Tooltip>
                      )}

                      {aiSettings.enabled && (
                        <div
                          className="flex items-center gap-1 bg-muted/30 px-1.5 py-0.5 rounded-md border border-white/5"
                          title="AI Active"
                        >
                          <Sparkles className="w-2.5 h-2.5 text-muted-foreground/60" />
                        </div>
                      )}
                    </div>
                  </div>

                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const cmd = s.action.startsWith("/") ? s.action.split(" ")[0] : s.action;
                        setInput(cmd);
                        handleRunCommand(cmd);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/50 text-xs transition-all group"
                    >
                      <div className="p-1.5 bg-muted rounded-md group-hover:bg-primary/10 transition-colors">
                        {s.group === "navigation" && (
                          <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary" />
                        )}
                        {s.group === "action" && (
                          <Terminal className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary" />
                        )}
                        {s.group === "ai" && (
                          <Sparkles className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary" />
                        )}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-foreground/80 group-hover:text-foreground">
                          {s.label}
                        </div>
                        {s.description && (
                          <div className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground/70">
                            {s.description}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {(executing || streamingMessage || error) && (
                <div className="px-4 py-3 space-y-3">
                  {error && (
                    <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-destructive/5 blur-3xl -mr-12 -mt-12 pointer-events-none" />
                      <div className="flex items-start gap-3 relative z-10">
                        <div className="p-2 bg-destructive/10 rounded-lg shrink-0">
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        </div>
                        <div className="space-y-1 pt-0.5">
                          <h3 className="text-xs font-bold text-destructive flex items-center gap-2">
                            {t("command_center.error_generic")}
                          </h3>
                          <p className="text-[11px] leading-relaxed text-muted-foreground/80 font-medium">
                            {error}
                          </p>
                          <div
                            className="pt-1 flex items-center gap-1.5 cursor-pointer text-[10px] text-muted-foreground/60 hover:text-primary transition-colors"
                            onClick={() => {
                              useUIStore.getState().setSettingsTab("general"); // Use 'general' or specific AI tab if available, but 'settings' tab navigate is common
                              setActiveTab("settings");
                              setIsOpen(false);
                            }}
                          >
                            <Settings className="w-3 h-3" />
                            <span>{t("flow.analysis.check_settings")}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setError(null)}
                          className="ml-auto p-1.5 hover:bg-destructive/10 rounded-full transition-colors text-muted-foreground/40 hover:text-destructive"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {streamingMessage && (
                    <div className="space-y-2">
                      <div className="p-3 bg-muted/30 border border-border/50 rounded-xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300">
                        <div className="text-system leading-relaxed text-foreground/90 font-medium px-1 prose-compact">
                          <AIMarkdown
                            content={streamingMessage.replace(/```(?:python)?\s*$/i, "")}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {executing && !streamingMessage && !error && (
                    <div className="py-8 flex flex-col items-center justify-center gap-3 animate-in fade-in duration-300">
                      <div className="relative">
                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
                        <Loader2 className="w-8 h-8 text-primary animate-spin relative" />
                      </div>
                      <div className="text-xs font-bold text-muted-foreground/60 animate-pulse tracking-widest uppercase">
                        {aiSettings.enabled
                          ? t("command_center.loading.ai")
                          : t("command_center.loading.default")}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {action && (action.intent !== "CHAT" || !streamingMessage) && (
                <div className="p-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="relative overflow-hidden rounded-xl border border-border/20 shadow-2xl bg-popover/80 backdrop-blur-md ring-1 ring-border/20 group">
                    {/* Ambient Background Gradient - Consistent Primary Color */}
                    <div className="absolute top-0 right-0 w-[300px] h-[300px] blur-[100px] opacity-15 rounded-full -mr-20 -mt-20 pointer-events-none bg-primary/40 transition-colors duration-500" />

                    <div className="relative p-5 space-y-3">
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2.5 rounded-xl border border-white/5 shadow-inner ${
                              action.intent === "CLEAR_TRAFFIC"
                                ? "bg-destructive/10 text-destructive"
                                : action.intent === "TOGGLE_PROXY"
                                  ? "bg-orange-500/10 text-orange-500"
                                  : "bg-primary/10 text-primary"
                            }`}
                          >
                            {action.intent === "NAVIGATE" && <ArrowRight className="w-5 h-5" />}
                            {action.intent === "CREATE_RULE" && <Shield className="w-5 h-5" />}
                            {action.intent === "CREATE_SCRIPT" && <Terminal className="w-5 h-5" />}
                            {action.intent === "OPEN_SETTINGS" && <Settings className="w-5 h-5" />}
                            {action.intent === "CLEAR_TRAFFIC" && <Trash2 className="w-5 h-5" />}
                            {action.intent === "TOGGLE_PROXY" && <Power className="w-5 h-5" />}
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-foreground tracking-tight">
                              {getIntentLabel(action.intent)}
                            </h3>
                            <p className="text-[11px] text-muted-foreground font-medium mt-0.5 opacity-80">
                              {t("command_center.confirm_required")}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setAction(null)}
                          className="p-1.5 hover:bg-white/5 rounded-full transition-colors text-muted-foreground/60 hover:text-foreground"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Explanation Content */}
                      <div className="bg-muted/30 rounded-lg p-3 border border-border/10 backdrop-blur-sm">
                        <div className="flex gap-2.5">
                          <div className="shrink-0 mt-0.5">
                            <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground/50" />
                          </div>
                          <p className="text-[12px] leading-relaxed text-muted-foreground/90 font-medium">
                            {action.explanation || t("command_center.default_explanation")}
                          </p>
                        </div>
                      </div>

                      {/* Action Button */}
                      <button
                        onClick={() => executeAction()}
                        className="w-full h-10 rounded-lg flex items-center justify-center gap-2 text-system font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-900/20 active:scale-[0.98] transition-all"
                      >
                        <span>{t("command_center.confirm_action")}</span>
                        <ArrowRight className="w-3.5 h-3.5 opacity-80 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border/40 bg-muted/10 flex items-center justify-end">
              <div className="text-[9px] text-muted-foreground/30 font-black uppercase tracking-widest flex items-center gap-1.5 opacity-60">
                <Sparkles className="w-2.5 h-2.5" />
                <span>{t("command_center.ai_integrated")}</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
