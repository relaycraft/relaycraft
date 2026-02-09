import { motion } from "framer-motion";
import { Bot, Check, Loader2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAILanguageInfo } from "../../lib/ai/lang";
import {
  getScriptExplanationPrompt,
  getScriptGenerationPrompt,
  MITMPROXY_SYSTEM_PROMPT,
  SCRIPT_EXPLAIN_SYSTEM_PROMPT,
} from "../../lib/ai/prompts";
import { useAIStore } from "../../stores/aiStore";
import { useUIStore } from "../../stores/uiStore";
import { AIMarkdown } from "./AIMarkdown";

interface AIScriptAssistantProps {
  onApply: (code: string, name?: string) => void;
  onClose: () => void;
  currentCode?: string;
  isCreateMode?: boolean;
  initialPrompt?: string | null;
}

const extractPythonCode = (text: string): string | null => {
  if (!text) return null;
  const codeBlockRegex = /```(?:python)?\s*([\s\S]*?)(?:```|$)/i;
  const match = text.match(codeBlockRegex);
  let code: string | null = null;
  if (match && match[1].trim().length > 10) {
    code = match[1].trim();
  } else {
    const patterns = ['"""', "'''", "import ", "class Addon", "# "];
    let codeStart = Infinity;
    for (const p of patterns) {
      const idx = text.indexOf(p);
      if (idx !== -1 && idx < codeStart) {
        codeStart = idx;
      }
    }
    if (codeStart !== Infinity) {
      code = text.substring(codeStart).trim();
    }
  }
  if (code) {
    return code.replace(/```\s*$/g, "").trim();
  }
  return null;
};

export function AIScriptAssistant({
  onApply,
  onClose,
  currentCode,
  isCreateMode,
  initialPrompt,
}: AIScriptAssistantProps) {
  const { t } = useTranslation();
  const { draftScriptPrompt, setDraftScriptPrompt } = useUIStore();

  const [prompt, setPrompt] = useState(initialPrompt || draftScriptPrompt || "");
  const [explanation, setExplanation] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genMode, setGenMode] = useState<"generate" | "explain" | null>(null);
  const [tempCode, setTempCode] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleGenerate = useCallback(
    async (mode: "generate" | "explain" = "generate") => {
      if (generating) return;
      if (mode === "generate" && !prompt) return;

      setGenerating(true);
      setGenMode(mode);
      setExplanation("");
      setTempCode(null);

      try {
        const { chatCompletionStream } = useAIStore.getState();
        let systemMsg: { role: "system"; content: string };
        let userMsg: { role: "user"; content: string };
        const langInfo = getAILanguageInfo();

        if (mode === "explain") {
          systemMsg = {
            role: "system",
            content: SCRIPT_EXPLAIN_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name)
              .replace(/{{TERMINOLOGY}}/g, "RelayCraft, mitmproxy, Addon")
              .replace(/{{SUMMARY}}/g, t("script_editor.ai.summary_header", "Summary"))
              .replace(/{{KEY_LOGIC}}/g, t("script_editor.ai.logic_header", "Key Logic"))
              .replace(/{{SUGGESTIONS}}/g, t("script_editor.ai.suggestions_header", "Suggestions"))
              .replace(
                /{{RESTART_NOTICE}}/g,
                t("script_editor.ai.restart_notice", "Restart Required"),
              ),
          };
          userMsg = {
            role: "user",
            content: getScriptExplanationPrompt(currentCode || ""),
          };
        } else {
          systemMsg = {
            role: "system",
            content: MITMPROXY_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name).replace(
              /{{TERMINOLOGY}}/g,
              "RelayCraft, mitmproxy, Addon",
            ),
          };
          userMsg = {
            role: "user",
            content: getScriptGenerationPrompt(prompt, currentCode),
          };
        }

        let fullResponse = "";
        await chatCompletionStream([systemMsg, userMsg], (chunk) => {
          fullResponse += chunk;
          setExplanation(fullResponse);
          if (mode === "generate") {
            const extracted = extractPythonCode(fullResponse);
            if (extracted) setTempCode(extracted);
          }
        });
      } catch (error) {
        console.error("AI Generation failed", error);
      } finally {
        setGenerating(false);
        // If we were in generate mode, clear the explanation so the suggestions footer reappears
        // and the "ghost" text is definitely gone.
        if (mode === "generate") {
          setExplanation("");
          setGenMode(null);
        }
      }
    },
    [generating, prompt, currentCode, t],
  );

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Handle initial prompt changes or store updates
  useEffect(() => {
    const targetPrompt = initialPrompt || draftScriptPrompt;
    if (targetPrompt) {
      if (targetPrompt === "INITIAL_OPEN_ONLY") {
        setPrompt("");
        if (inputRef.current) inputRef.current.focus();
      } else {
        setPrompt(targetPrompt);
        // User requirement: "input and create", implies auto-execution.
        handleGenerate("generate");
      }
      if (draftScriptPrompt) setDraftScriptPrompt(null);
    }
  }, [
    draftScriptPrompt,
    initialPrompt, // User requirement: "input and create", implies auto-execution.
    handleGenerate,
    setDraftScriptPrompt,
  ]);

  // UI refinement: regex to hide code more robustly during streaming
  const cleanInsight = (text: string) => {
    if (!text) return "";

    // 1. Remove complete or partial markdown code blocks
    let cleaned = text.replace(/```(?:python|py)?[\s\S]*?(?:```|$)/gi, "");

    // 2. Remove "naked" code blocks
    const codePatterns = [
      /^import\s+/m,
      /^from\s+[\w.]+\s+import/m,
      /^class\s+\w+[:(]/m,
      /^def\s+\w+[:(]/m,
      /^addons\s*=\s*\[/m,
    ];

    if (codePatterns.some((p) => p.test(cleaned))) {
      const lines = cleaned.split("\n");
      const filteredLines = lines.filter(
        (line) =>
          !(
            codePatterns.some((p) => p.test(line)) ||
            line.trim().startsWith("    ") ||
            line.trim().startsWith('"""')
          ),
      );
      cleaned = filteredLines.join("\n");
    }

    return cleaned.trim();
  };

  // Proactive filling: Update editor as code streams
  useEffect(() => {
    if (generating && tempCode) {
      onApply(tempCode);
    }
  }, [tempCode, generating, onApply]);

  useEffect(() => {
    if (scrollRef.current && generating) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [generating]);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="border-b border-border bg-muted/30 overflow-hidden flex flex-col"
    >
      <div className="flex flex-col w-full p-4 gap-4">
        {/* Input Area */}
        <div className="flex items-center gap-2 px-3.5 bg-muted/30 border border-border/20 shadow-sm rounded-xl transition-all focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/40">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate("generate")}
            placeholder={t("script_editor.ai.placeholder")}
            className="flex-1 bg-transparent border-none outline-none text-xs placeholder:text-muted-foreground/30 h-8"
            autoComplete="off"
            disabled={generating}
          />
          <div className="flex items-center gap-1.5">
            {generating ? (
              <div className="p-1.5">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              </div>
            ) : (
              <button
                onClick={() => handleGenerate("generate")}
                disabled={!prompt}
                title={t("common.generate")}
                className="p-1.5 text-primary/60 hover:text-primary hover:bg-primary/10 disabled:opacity-20 transition-all rounded-lg"
              >
                <Wand2 className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="w-[1px] h-3 bg-border mx-0.5" />
            <button
              onClick={onClose}
              title={t("common.close")}
              className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content / Explanation Area */}
        {(explanation || generating) && !(genMode === "generate" && tempCode && !explanation) && (
          <div className="flex gap-4 p-4 bg-background/50 border border-border/50 rounded-2xl relative overflow-hidden">
            <div className="mt-1 p-2 bg-primary/10 rounded-xl h-fit">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em] opacity-80">
                  {t("script_editor.ai.insight_title", "RelayCraft AI Insight")}
                </span>
                <div className="flex items-center gap-2">
                  {tempCode && (
                    <div className="flex items-center gap-2">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${generating ? "text-primary bg-primary/5 border-primary/10" : "text-green-500 bg-green-500/5 border-green-500/10"}`}
                        title={
                          generating ? t("script_editor.ai.syncing") : t("script_editor.ai.synced")
                        }
                      >
                        <div className="relative flex items-center justify-center">
                          {generating ? (
                            <>
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              <motion.div
                                className="absolute inset-0 bg-primary/20 rounded-full animate-ping"
                                style={{ animationDuration: "2s" }}
                              />
                            </>
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                        </div>
                      </motion.div>
                    </div>
                  )}
                  {!generating && (
                    <button
                      onClick={() => {
                        setExplanation("");
                        setGenMode(null);
                      }}
                      className="hover:bg-primary/10 p-1 rounded-full transition-colors"
                      title={t("common.close", "Close")}
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground/70" />
                    </button>
                  )}
                </div>
              </div>

              <div
                className="text-[12px] text-foreground/80 leading-[1.6] max-h-[220px] overflow-y-auto pr-2 no-scrollbar scroll-smooth font-medium"
                ref={scrollRef}
              >
                <AIMarkdown
                  content={genMode === "generate" && generating ? "" : cleanInsight(explanation)}
                />
                {generating && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="inline-block w-1 h-3.5 ml-1.5 bg-primary/30 rounded-full align-middle animate-pulse"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Suggestions Footer */}
        {!(generating || explanation) && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
            {isCreateMode ? (
              <>
                <QuickAction
                  label={t("script_editor.ai.chip_create")}
                  onClick={() => setPrompt(t("script_editor.ai.prompt_create"))}
                />
                <QuickAction
                  label={t("script_editor.ai.chip_custom_logic", "Generate specific logic...")}
                  onClick={() =>
                    setPrompt(
                      t("script_editor.ai.prompt_custom_logic", "Help me write a logic that: "),
                    )
                  }
                />
              </>
            ) : (
              <>
                <QuickAction
                  label={t("script_editor.ai.chip_explain")}
                  onClick={() => handleGenerate("explain")}
                />
                <QuickAction
                  label={t("script_editor.ai.chip_modify")}
                  onClick={() => setPrompt(t("script_editor.ai.prompt_modify"))}
                />
                <QuickAction
                  label={t("script_editor.ai.chip_fix")}
                  onClick={() => setPrompt(t("script_editor.ai.prompt_fix"))}
                />
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1 bg-muted/20 border border-border/10 rounded-full text-[10px] font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all whitespace-nowrap"
    >
      {label}
    </button>
  );
}
