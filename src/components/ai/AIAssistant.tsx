import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BookOpen, Bot, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAILanguageInfo } from "../../lib/ai/lang";
import {
  FILTER_ASSISTANT_SYSTEM_PROMPT,
  NAMING_ASSISTANT_SYSTEM_PROMPT,
  REGEX_ASSISTANT_SYSTEM_PROMPT,
  REGEX_EXPLAIN_SYSTEM_PROMPT,
} from "../../lib/ai/prompts";
import { cleanAIResult } from "../../lib/ai/utils";
import { Logger } from "../../lib/logger";
import { useAIStore } from "../../stores/aiStore";
import { useUIStore } from "../../stores/uiStore";
import { Tooltip } from "../common/Tooltip";
import { AIMarkdown } from "./AIMarkdown";

export interface AIAssistantProps {
  onGenerate: (result: string) => void;
  className?: string;
  mode: "filter" | "regex" | "naming";
  context?: any;
  value?: string; // Current content of the field
  align?: "left" | "right" | "center";
}

export function AIAssistant({
  onGenerate,
  className = "",
  mode,
  context,
  value,
  align = "right",
}: AIAssistantProps) {
  const { t } = useTranslation();
  const { chatCompletionStream, abortChat, settings: aiSettings } = useAIStore();
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"input" | "explanation">("input");
  const [content, setContent] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const prevIsOpen = useRef(isOpen);
  // Clear state when closing
  useEffect(() => {
    if (!isOpen && prevIsOpen.current) {
      setPrompt("");
      setContent("");
      setView("input");
      abortChat();
    }
    prevIsOpen.current = isOpen;
  }, [isOpen, abortChat]);

  if (!aiSettings.enabled) return null;

  const handleGenerate = async () => {
    if (!prompt || loading) return;
    setLoading(true);
    setContent("");
    if (mode !== "filter" && mode !== "regex") {
      setView("explanation"); // Switch to view to show streaming or loading
    }

    try {
      const systemPrompt = {
        naming: NAMING_ASSISTANT_SYSTEM_PROMPT,
        filter: FILTER_ASSISTANT_SYSTEM_PROMPT,
        regex: REGEX_ASSISTANT_SYSTEM_PROMPT,
      }[mode];

      const langInfo = getAILanguageInfo();

      const systemMsg = {
        role: "system" as const,
        content: systemPrompt
          .replace(/{{LANGUAGE}}/g, langInfo.name)
          .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
          .replace(/{{ACTIVE_TAB}}/g, useUIStore.getState().activeTab),
      };

      let userContent = prompt;
      if (mode === "naming" && (prompt === t("ai.assistant.naming.suggestions.auto") || !prompt)) {
        userContent = `Please suggest a name for this rule config: ${JSON.stringify(context || {})}`;
      } else if (mode === "regex") {
        userContent = `[REGEX ONLY] ${prompt}`;
      }

      const userMsg = { role: "user" as const, content: userContent };

      let fullResult = "";
      await chatCompletionStream([systemMsg, userMsg], (chunk) => {
        fullResult += chunk;
        setContent(fullResult);
      });

      if (fullResult) {
        const cleaned = cleanAIResult(fullResult);
        onGenerate(cleaned);
        // For naming/regex/filter, we close after applying unless it's an explanation
        setTimeout(() => setIsOpen(false), 200);
      }
    } catch (error) {
      Logger.error("Assistant generation failed", error);
    } finally {
      setLoading(false);
    }
  };

  const handleExplain = async () => {
    if (!value || loading) return;
    setLoading(true);
    setContent("");
    setView("explanation");
    try {
      const langInfo = getAILanguageInfo();

      const systemMsg = {
        role: "system" as const,
        content: REGEX_EXPLAIN_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name)
          .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
          .replace(/{{ACTIVE_TAB}}/g, useUIStore.getState().activeTab)
          .replace(/{{SUMMARY}}/g, t("scripts.editor.ai.summary_header"))
          .replace(/{{BREAKDOWN}}/g, t("scripts.editor.ai.logic_header"))
          .replace(/{{SAMPLES}}/g, t("scripts.editor.ai.insight_title")),
      };

      const userMsg = {
        role: "user" as const,
        content: `Please explain this content: ${value}`,
      };

      let fullResult = "";
      await chatCompletionStream([systemMsg, userMsg], (chunk) => {
        fullResult += chunk;
        setContent(fullResult);
      });
    } catch (error) {
      console.error("Assistant explanation failed", error);
      setContent("Failed to generate explanation.");
    } finally {
      setLoading(false);
    }
  };

  const config = {
    filter: {
      title: t("ai.assistant.search.title"),
      placeholder: t("ai.assistant.search.placeholder"),
      suggestions: [
        t("ai.assistant.search.suggestions.error"),
        t("ai.assistant.search.suggestions.json"),
      ],
    },
    regex: {
      title: t("ai.assistant.regex.title"),
      placeholder: t("ai.assistant.regex.placeholder"),
      suggestions: [
        t("ai.assistant.regex.suggestions.path"),
        t("ai.assistant.regex.suggestions.domain"),
      ],
    },
    naming: {
      title: t("ai.assistant.naming.title"),
      placeholder: t("ai.assistant.naming.placeholder"),
      suggestions: [
        t("ai.assistant.naming.suggestions.auto"),
        t("ai.assistant.naming.suggestions.tech"),
        t("ai.assistant.naming.suggestions.desc"),
      ],
    },
  }[mode];

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <Tooltip content={config.title} side="bottom">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`p-1.5 rounded-lg transition-all ${isOpen ? "bg-primary text-primary-foreground shadow-lg scale-110" : "text-muted-foreground hover:bg-primary/10 hover:text-primary hover:scale-105"}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </Tooltip>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className={`absolute top-full mt-2 w-[480px] max-w-[calc(100vw-80px)] p-4 rounded-2xl z-50 shadow-2xl shadow-primary/20 overflow-hidden ${
              align === "right"
                ? "right-0 origin-top-right"
                : align === "center"
                  ? "left-1/2 -translate-x-1/2 origin-top"
                  : "left-0 origin-top-left"
            } bg-popover backdrop-blur-xl border border-border/40`}
          >
            <div className="relative z-10 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {view !== "input" && !loading && (
                    <button
                      onClick={() => {
                        setView("input");
                        setContent("");
                        abortChat();
                      }}
                      className="p-1 hover:bg-white/5 dark:hover:bg-white/10 rounded-md transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                  <div className="flex items-center gap-1.5">
                    <div className="p-1 bg-primary/20 rounded-md">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-xs font-bold text-primary uppercase tracking-widest">
                      {config.title}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-white/5 dark:hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>

              {view === "input" ? (
                <>
                  <div className="relative group">
                    <div className="absolute inset-0 bg-primary/5 rounded-xl blur-lg group-focus-within:bg-primary/10 transition-all opacity-0 group-focus-within:opacity-100" />
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                        placeholder={config.placeholder}
                        className="w-full pl-3.5 pr-10 h-8 bg-muted/30 border border-border/20 rounded-xl text-xs placeholder:text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 font-sans transition-all disabled:opacity-50"
                        disabled={loading}
                      />
                      <button
                        onClick={handleGenerate}
                        disabled={!prompt || loading}
                        className="absolute right-2 p-1 text-primary hover:scale-110 disabled:opacity-30 transition-all"
                      >
                        {loading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-nowrap overflow-x-auto no-scrollbar gap-1.5 py-0.5">
                    {config.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setPrompt(s);
                          setTimeout(handleGenerate, 50);
                        }}
                        className="text-xs font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all cursor-pointer whitespace-nowrap"
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  {value && mode !== "naming" && (
                    <button
                      onClick={handleExplain}
                      disabled={loading}
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors text-xs font-bold mt-1 px-1"
                    >
                      <BookOpen className="w-3 h-3" />
                      {t("ai.assistant.regex.explain_btn")}
                    </button>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="max-h-[260px] overflow-y-auto no-scrollbar pr-1 bg-muted/20 border border-border/10 rounded-xl p-3 min-h-[80px] relative">
                    <div className="text-xs leading-relaxed text-foreground/90 font-medium">
                      {loading && !content ? (
                        <div className="flex items-center gap-2 text-muted-foreground animate-pulse py-1 text-center justify-center h-full">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      ) : (
                        <>
                          <AIMarkdown content={content} />
                          {loading && (
                            <motion.span
                              animate={{ opacity: [1, 0] }}
                              transition={{ duration: 0.8, repeat: Infinity }}
                              className="inline-block w-1.5 h-4 ml-1 bg-primary align-middle"
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
