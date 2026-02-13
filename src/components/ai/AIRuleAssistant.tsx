import {
  Bot,
  Check,
  Code,
  FileCode,
  Loader2,
  PlusCircle,
  RotateCcw,
  Sparkles,
  SquareCode,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildAIContext } from "../../lib/ai/contextBuilder";
import { getAILanguageInfo } from "../../lib/ai/lang";
import { PROXY_RULE_SYSTEM_PROMPT } from "../../lib/ai/prompts";
import { mapAIRuleToInternal } from "../../lib/ai/ruleMapper";
import { generateScriptFromRule } from "../../lib/scriptGenerator";
import { parseYAML, stringifyYAML, validateRuleSchema } from "../../lib/yamlParser";
import { useAIStore } from "../../stores/aiStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useScriptStore } from "../../stores/scriptStore";
import { useUIStore } from "../../stores/uiStore";
import type { Rule } from "../../types/rules";
import { Button } from "../common/Button";
import { CopyButton } from "../common/CopyButton";
import { Editor } from "../common/Editor";
import { Input } from "../common/Input";
import { Skeleton } from "../common/Skeleton";
import { Switch } from "../common/Switch";
import { Tooltip } from "../common/Tooltip";
import { AIMarkdown } from "./AIMarkdown";

interface AIRuleAssistantProps {
  initialRule?: Partial<Rule>;
  initialMode?: "ai" | "yaml" | "script";
  onApply: (partialRule: Partial<Rule>) => void;
  onClose: () => void;
  onScriptCreated?: (name: string) => void;
  setIsDirty?: (isDirty: boolean) => void;
}

export function AIRuleAssistant({
  initialRule,
  initialMode = "ai",
  onApply,
  onClose,
  onScriptCreated,
  setIsDirty,
}: AIRuleAssistantProps) {
  const { t } = useTranslation();
  const { settings: aiSettings } = useAIStore();
  const { saveScript, toggleScript } = useScriptStore();
  const { updateRule } = useRuleStore();

  const [mode, setMode] = useState<"ai" | "yaml" | "script">(() => {
    if (initialMode === "ai" && !aiSettings.enabled) return "yaml";
    return initialMode;
  });
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [detectedIntent, setDetectedIntent] = useState<"explain" | "rule" | "unknown">("unknown");
  const [preview, setPreview] = useState<Partial<Rule> | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // YAML Editor State
  const [yamlContent, setYamlContent] = useState("");
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);

  // Script Mode State
  const [scriptName, setScriptName] = useState("");
  const [scriptContent, setScriptContent] = useState("");
  const [disableOriginal, setDisableOriginal] = useState(true);
  const [enableScript, setEnableScript] = useState(true);

  // Sync initial rule to YAML content when initialRule changes (especially for rule switching)
  useEffect(() => {
    if (initialRule) {
      setYamlContent(stringifyYAML(initialRule));
    }
  }, [initialRule?.id, initialRule]); // Only trigger sync when rule ID changes to avoid overwriting edits during form typing

  // Generate script when entering script mode
  useEffect(() => {
    if (mode === "script" && initialRule && !scriptContent) {
      try {
        // Generate content
        const content = generateScriptFromRule(initialRule as Rule);
        setScriptContent(content);

        // detailed name generation
        let baseName = (initialRule.name || "script").trim().replace(/[\\/:*?"<>|]/g, "_");
        if (!baseName) baseName = `script_${Date.now()}`;

        let name = `${baseName}.py`;
        let counter = 1;
        const existingScripts = useScriptStore.getState().scripts;
        while (existingScripts.some((s) => s.name === name)) {
          name = `${baseName}_${counter}.py`;
          counter++;
        }
        setScriptName(name);
      } catch (e) {
        console.error("Failed to generate script", e);
      }
    }
  }, [mode, initialRule, scriptContent]);

  // Sync mode when prop changes
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Force switch off AI mode if disabled dynamically
  useEffect(() => {
    if (mode === "ai" && !aiSettings.enabled) {
      setMode("yaml");
    }
  }, [mode, aiSettings.enabled]);

  // Track dirty state
  useEffect(() => {
    if (!setIsDirty) return;

    const initialYaml = initialRule ? stringifyYAML(initialRule) : "";
    const isYamlDirty = yamlContent !== initialYaml;
    const hasPreview = !!preview;
    const hasExplanation = !!explanation;
    const isScriptDirty = !!scriptContent; // If a script was generated but not saved

    setIsDirty(isYamlDirty || hasPreview || hasExplanation || isScriptDirty || generating);
  }, [yamlContent, preview, explanation, scriptContent, generating, initialRule, setIsDirty]);

  // Auto-scroll for AI analysis
  useEffect(() => {
    if (scrollRef.current && generating) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [generating]);

  const handleGenerate = async () => {
    if (!prompt || generating) return;
    setGenerating(true);
    setExplanation(""); // Prepare for streaming
    setPreview(null);
    setDetectedIntent("unknown");

    try {
      const { chatCompletionStream } = useAIStore.getState();
      // Build fresh context including active rules
      const context = buildAIContext();
      const contextString = JSON.stringify(context, null, 2);

      const langInfo = getAILanguageInfo();

      const systemMsg = {
        role: "system" as const,
        content: `${PROXY_RULE_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name).replace(
          /{{TERMINOLOGY}}/g,
          langInfo.terminology,
        )}\n\n## Current Application Context:\n${contextString}`,
      };

      // Inject context if modifying or explaining
      let finalPrompt = prompt;
      if (yamlContent && yamlContent.trim() !== "") {
        // Truncate YAML context if too large (e.g. > 20KB) to prevent token overflow/lag
        let contextYaml = yamlContent;
        if (contextYaml.length > 20000) {
          contextYaml = `${contextYaml.slice(0, 20000)}\n...[YAML_TRUNCATED_FOR_AI_CONTEXT]`;
        }
        finalPrompt = `Current Rule YAML:\n${contextYaml}\n\nUser Request: ${prompt}`;
      }

      const userMsg = { role: "user" as const, content: finalPrompt };

      let fullResponse = "";
      let currentDetectedIntent: "explain" | "rule" | "unknown" = "unknown";

      await chatCompletionStream(
        [systemMsg, userMsg],
        (chunk) => {
          fullResponse += chunk;

          // Detect intent from stream if not yet known
          if (currentDetectedIntent === "unknown") {
            // Search for markers more robustly
            const hasRuleKey = /"rule"\s*:/.test(fullResponse);
            const hasNameKey = /"name"\s*:/.test(fullResponse);
            const hasMessageKey = /"message"\s*:/.test(fullResponse);

            if (hasRuleKey || hasNameKey) {
              currentDetectedIntent = "rule";
              setDetectedIntent("rule");
            } else if (hasMessageKey || fullResponse.includes("<think>")) {
              currentDetectedIntent = "explain";
              setDetectedIntent("explain");
            }
          }

          // Update UI based on intent
          if (currentDetectedIntent === "explain") {
            // Extract message content if it's within JSON, otherwise show full response (for thinking)
            const msgMatch = fullResponse.match(/"message":\s*"((?:[^"\\]|\\.)*)/);
            if (msgMatch?.[1]) {
              const content = msgMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
              setExplanation(content);
            } else {
              // This handles raw text or <think>... blocks
              setExplanation(fullResponse);
            }
          } else if (currentDetectedIntent === "rule") {
            // Don't show text explanation for rule intent while generating
            setExplanation(null);
          } else if (currentDetectedIntent === "unknown") {
            // If it looks like JSON (starts with {), hide it while detecting
            // If it looks like plain text, show it as explanation
            const trimmed = fullResponse.trim();
            if (trimmed.startsWith("{")) {
              setExplanation(null);
            } else if (trimmed.length > 20) {
              // If we have some text and it's not JSON, it's probably an explanation
              setDetectedIntent("explain");
              setExplanation(fullResponse);
            }
          } else {
            setExplanation(fullResponse);
          }
        },
        0,
      );

      // AI output should be JSON or contains JSON. Extract it.
      let jsonString = "";

      // 1. Try to find JSON in markdown code blocks first (highest priority)
      const codeBlockMatch = fullResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonString = codeBlockMatch[1];
      } else {
        // Try to find the message content directly to avoid JSON wrap issues
        const msgMatch = fullResponse.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (msgMatch && !fullResponse.includes('"rule"')) {
          // This is likely an explanation. We can extract it directly to avoid parsing issues.
          const content = msgMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
          setExplanation(content);
          setGenerating(false);
          return;
        }

        // 2. Try to find the largest balanced JSON-like structure
        // We look for { and find its matching } by counting braces
        const firstBraceIndex = fullResponse.indexOf("{");
        if (firstBraceIndex !== -1) {
          let braceCount = 0;
          let lastBraceIndex = -1;
          for (let i = firstBraceIndex; i < fullResponse.length; i++) {
            if (fullResponse[i] === "{") braceCount++;
            else if (fullResponse[i] === "}") {
              braceCount--;
              if (braceCount === 0) {
                lastBraceIndex = i;
                break; // Found the matching closing brace
              }
            }
          }
          if (lastBraceIndex !== -1) {
            jsonString = fullResponse.substring(firstBraceIndex, lastBraceIndex + 1);
          }
        }

        // 3. Fallback: If still not found, try the old method or fragment matching
        if (!jsonString) {
          const lastBrace = fullResponse.lastIndexOf("}");
          if (firstBraceIndex !== -1 && lastBrace !== -1 && lastBrace > firstBraceIndex) {
            jsonString = fullResponse.substring(firstBraceIndex, lastBrace + 1);
          } else if (fullResponse.includes('"rule":') || fullResponse.includes('"name":')) {
            const fragmentMatch = fullResponse.match(/("rule"|"name")\s*:\s*(\{[\s\S]*\}|"[^"]*")/);
            if (fragmentMatch) {
              jsonString = `{ ${fragmentMatch[0]} }`;
            }
          }
        }
      }

      if (jsonString) {
        try {
          let aiData: any;
          const tryParse = (str: string) => {
            try {
              return JSON.parse(str);
            } catch (_e) {
              // Try to fix common LLM JSON errors
              const cleaned = str
                .replace(/,\s*([\]}])/g, "$1") // remove trailing commas
                .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // ensure keys are quoted
                .replace(/'/g, '"'); // replace single quotes with double quotes

              try {
                return JSON.parse(cleaned);
              } catch (e2) {
                // Last resort: if it's a raw YAML-like block that AI forgot to wrap
                // (not a perfect fix, but helps with some models)
                if (str.includes("name:") && str.includes("type:")) {
                  try {
                    const yamlParsed = parseYAML(str);
                    if (yamlParsed && typeof yamlParsed === "object") return yamlParsed;
                  } catch (_e3) {}
                }
                throw e2;
              }
            }
          };

          aiData = tryParse(jsonString);

          // Case 1: Explanation / Chat Message
          if (aiData.message && !aiData.rule) {
            setYamlErrors([]);
            // Extract content and handle escaping
            let finalMsg = aiData.message;

            // If it's still a JSON string (with escaped quotes and newlines), we need to unescape it
            // The JSON.parse(jsonString) already gave us aiData.message as a string
            // But if the LLM output was doubly stringified or the parser didn't handle it well:
            if (
              typeof finalMsg === "string" &&
              finalMsg.startsWith('"') &&
              finalMsg.endsWith('"')
            ) {
              try {
                finalMsg = JSON.parse(finalMsg);
              } catch (_e) {}
            }

            setExplanation(finalMsg);
            setPreview(null);
            return;
          }

          // Case 2: Rule Generation
          const ruleData = aiData.rule || (aiData.name && aiData.type ? aiData : null);
          if (ruleData) {
            const internalRule = mapAIRuleToInternal(ruleData);
            setPreview(internalRule);
            setYamlErrors([]);

            // Auto-fill YAML content
            setYamlContent(stringifyYAML(internalRule));

            // Clear explanation if it was just a loading hint
            setExplanation(null);
            return;
          }
        } catch (e) {
          console.warn("Failed to parse extracted JSON", e, "Raw string:", jsonString);
        }
      }

      // Final fallback: if we couldn't parse as a rule but it's clearly a rule intent
      if (detectedIntent === "rule" && !preview) {
        // Try to see if it's at least valid YAML or partially valid JSON
        // If so, put it in the YAML editor so user can fix it
        setYamlContent(fullResponse);
        setMode("yaml");
        setExplanation(null);
        setYamlErrors([
          `${t("rule_editor.ai.generate_fail")}: ${t("rule_editor.ai.parse_error_hint")}`,
        ]);
      } else if (!preview) {
        setExplanation(fullResponse);
      }
    } catch (error) {
      console.error("AI Rule Generation failed", error);
      setYamlErrors([t("rule_editor.ai.generate_fail")]);
    } finally {
      setGenerating(false);
    }
  };

  const handleBeautify = () => {
    try {
      const parsed = parseYAML(yamlContent);
      setYamlContent(stringifyYAML(parsed));
      setYamlErrors([]);
    } catch (e) {
      setYamlErrors([(e as Error).message]);
    }
  };

  const handleResetYAML = () => {
    if (initialRule) {
      setYamlContent(stringifyYAML(initialRule));
      setYamlErrors([]);
    }
  };

  const handleApplyYAML = () => {
    try {
      const parsed = parseYAML<Partial<Rule>>(yamlContent);

      // Perform semantic validation
      const validation = validateRuleSchema(parsed);
      if (!validation.valid) {
        const ValidRuleTypes = [
          "map_local",
          "map_remote",
          "rewrite_header",
          "rewrite_body",
          "throttle",
          "block_request",
        ];
        const typesStr = ValidRuleTypes.join(", ");
        setYamlErrors(validation.errors.map((err) => t(err, { types: typesStr })));
        return;
      }

      onApply(parsed);
      onClose();
    } catch (e) {
      setYamlErrors([(e as Error).message]);
    }
  };

  const handleCreateScript = async () => {
    if (!(scriptContent && scriptName.trim())) return;

    // Construct dynamic message
    let message = t("rule_editor.convert_script_confirm_dynamic", {
      name: scriptName,
    });
    if (disableOriginal && initialRule?.id) {
      message += ` ${t("rule_editor.convert_script_confirm_disable_rule")}`;
    }
    if (enableScript) {
      message += ` ${t("rule_editor.convert_script_confirm_enable_script")}`;
      message += `\n\n${t("rule_editor.convert_script_confirm_restart")}`;
    }

    // Confirmation before proceeding
    useUIStore.getState().showConfirm({
      title: t("rule_editor.convert_script_title"),
      message: message,
      variant: "warning",
      onConfirm: async () => {
        try {
          await saveScript(scriptName, scriptContent);
          if (enableScript) {
            await toggleScript(scriptName, true);
          }
          if (disableOriginal && initialRule?.id) {
            updateRule(initialRule.id, {
              ...(initialRule as Rule),
              execution: { ...(initialRule as Rule).execution, enabled: false },
            });
          }
          if (onScriptCreated) {
            onScriptCreated(scriptName);
          } else {
            // Fallback but better to handle in parent
            useUIStore.getState().setActiveTab("scripts");
            setTimeout(() => {
              useScriptStore.getState().selectScript(scriptName);
            }, 100);
            onClose();
          }
        } catch (error) {
          console.error("Failed to create script:", error);
          alert(`Failed to create script: ${error}`);
        }
      },
    });
  };

  return (
    <div className="relative w-full bg-background/50 backdrop-blur-xl">
      <div className="relative z-10 w-full bg-background/20 backdrop-blur-md">
        {/* Tabs */}
        <div className="flex items-center px-6 py-2 justify-between border-b border-border/10">
          <div className="flex bg-muted/10 p-1 rounded-xl border border-border/5">
            {aiSettings.enabled && (
              <button
                onClick={() => setMode("ai")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${mode === "ai" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Sparkles className="w-3 h-3" />
                {t("rule_editor.ai.tab_ai")}
              </button>
            )}
            <button
              onClick={() => setMode("yaml")}
              className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${mode === "yaml" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Code className="w-3 h-3" />
              YAML
            </button>
            <button
              onClick={() => setMode("script")}
              className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${mode === "script" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <FileCode className="w-3 h-3" />
              {t("rule_editor.ai.tab_script")}
            </button>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <X className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {mode === "ai" && aiSettings.enabled && (
            <>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                    placeholder={t("rule_editor.ai.placeholder")}
                    className="pr-10 text-xs rounded-xl h-8 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/40"
                    autoFocus
                  />
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    {generating ? (
                      <div className="p-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      </div>
                    ) : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={handleGenerate}
                        disabled={!prompt}
                        className="hover:bg-transparent"
                      >
                        <Wand2 className="w-4 h-4 text-primary hover:scale-110 transition-transform disabled:opacity-30" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setPrompt(t("rule_editor.ai.chip_explain"))}
                  className="text-[10px] font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
                >
                  {t("rule_editor.ai.chip_explain")}
                </button>
                <button
                  onClick={() => setPrompt(`${t("rule_editor.ai.chip_modify")}: `)}
                  className="text-[10px] font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
                >
                  {t("rule_editor.ai.chip_modify")}
                </button>
                <button
                  onClick={() => setPrompt(`${t("rule_editor.ai.chip_create")}: `)}
                  className="text-[10px] font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
                >
                  {t("rule_editor.ai.chip_create")}
                </button>
                <button
                  onClick={() => setPrompt(`${t("rule_editor.ai.chip_import")}: `)}
                  className="text-[10px] font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
                >
                  {t("rule_editor.ai.chip_import")}
                </button>
              </div>

              {generating && detectedIntent === "rule" && (
                <div className="p-3 bg-card border border-primary/10 rounded-xl animate-in fade-in duration-500 shadow-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-14 rounded bg-primary/10" />
                    <Skeleton className="h-4 w-24 rounded bg-muted" />
                  </div>
                  <Skeleton className="h-2.5 w-full rounded bg-muted/60" />
                  <div className="flex justify-end gap-2 pt-0.5">
                    <Skeleton className="h-7 w-16 rounded bg-muted/40" />
                    <Skeleton className="h-7 w-20 rounded bg-primary/20" />
                  </div>
                </div>
              )}

              {preview && (
                <div className="flex items-center justify-between p-3 bg-card border border-primary/20 rounded-xl animate-in fade-in zoom-in-95 duration-200 shadow-sm">
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-primary px-1.5 py-0.5 bg-primary/10 rounded uppercase flex-shrink-0">
                        {preview.type
                          ? t(
                              `rule_editor.core.types.${preview.type === "rewrite_header" ? "rewrite" : preview.type === "block_request" ? "block" : preview.type}_label`,
                            )
                          : "UNKNOWN"}
                      </span>
                      <span className="text-xs font-semibold text-foreground truncate">
                        {preview.name}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {t("rule_editor.match.label", "Match")}:{" "}
                      {preview.match?.request?.find((a) => a.type === "url")?.value || ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        if (preview) {
                          setYamlContent(stringifyYAML(preview));
                          setMode("yaml");
                        }
                      }}
                      className="text-[10px] h-8"
                    >
                      <Code className="w-3 h-3 mr-1" />
                      {t("rule_editor.ai.edit_yaml")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => preview && onApply(preview)}
                      className="flex-shrink-0 gap-1.5 shadow-sm shadow-primary/20"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      {t("rule_editor.ai.fill_form")}
                    </Button>
                  </div>
                </div>
              )}

              {explanation && (detectedIntent !== "rule" || !generating) && (
                <div className="bg-muted/50 rounded-xl p-4 mb-4 animate-in fade-in slide-in-from-bottom-2 border border-border/40 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 blur-3xl -mr-12 -mt-12" />
                  <div className="flex items-start gap-4 relative z-10">
                    <div className="mt-1 p-1 bg-primary/10 rounded-lg">
                      <Bot className="w-4 h-4 text-primary shrink-0" />
                    </div>
                    <div className="space-y-2 flex-1 overflow-hidden">
                      {detectedIntent === "explain" && (
                        <h4 className="text-[10px] font-bold text-primary tracking-widest uppercase">
                          {t("rule_editor.ai.analysis_title")}
                        </h4>
                      )}
                      <div>
                        <AIMarkdown content={explanation || ""} />
                        {generating && (
                          <span className="inline-block w-1.5 h-4 ml-1 bg-primary animate-pulse align-middle" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!(preview || generating || explanation) && <div />}
            </>
          )}

          {mode === "yaml" && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="relative group border border-border/40 rounded-xl overflow-hidden bg-muted/5 h-[400px] focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <Editor
                  language="yaml"
                  value={yamlContent}
                  onChange={(val: string) => {
                    setYamlContent(val);
                    setYamlErrors([]);
                  }}
                  options={{
                    lineNumbers: "on",
                    tabSize: 2,
                    lineWrapping: true,
                  }}
                />
                <div className="absolute right-3 top-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Tooltip content={t("common.beautify")}>
                    <Button variant="quiet" size="icon-sm" onClick={handleBeautify}>
                      <SquareCode className="w-3 h-3" />
                    </Button>
                  </Tooltip>
                  <CopyButton text={yamlContent} variant="quiet" className="h-8 w-8" />
                </div>
              </div>

              {yamlErrors.length > 0 && (
                <div className="space-y-1">
                  {yamlErrors.map((err, i) => (
                    <div
                      key={i}
                      className="text-[10px] text-destructive flex items-start gap-1 px-1"
                    >
                      <X className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end items-center pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={handleResetYAML}
                    disabled={!initialRule || yamlContent === stringifyYAML(initialRule)}
                    className="h-8 text-[11px]"
                  >
                    <RotateCcw className="w-3 h-3 mr-1.5" />
                    {t("common.reset")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyYAML}
                    className="gap-1.5"
                    disabled={!initialRule || yamlContent === stringifyYAML(initialRule)}
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t("rule_editor.ai.apply_yaml")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {mode === "script" && scriptContent && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
              <div className="relative border border-border/40 rounded-xl overflow-hidden bg-muted/5 h-[400px]">
                <Editor
                  language="python"
                  value={scriptContent}
                  options={{
                    readOnly: true,
                    lineNumbers: "on",
                    tabSize: 4,
                  }}
                />
                <div className="absolute top-2 right-2 z-10">
                  <CopyButton
                    text={scriptContent}
                    variant="secondary"
                    className="h-8 w-8"
                    tooltipSide="left"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="disable-rule"
                      size="sm"
                      checked={disableOriginal}
                      onCheckedChange={setDisableOriginal}
                      disabled={!initialRule?.id}
                    />
                    <label
                      htmlFor="disable-rule"
                      className={`text-xs select-none cursor-pointer ${!initialRule?.id ? "opacity-50" : ""}`}
                    >
                      {t("rule_editor.ai.script.disable_rule")}
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="enable-script"
                      size="sm"
                      checked={enableScript}
                      onCheckedChange={setEnableScript}
                    />
                    <label htmlFor="enable-script" className="text-xs select-none cursor-pointer">
                      {t("rule_editor.ai.script.enable_script")}
                    </label>
                  </div>
                </div>
                <Button size="sm" onClick={handleCreateScript} className="gap-1.5 h-8">
                  <FileCode className="w-3.5 h-3.5" />
                  {t("rule_editor.ai.script.create_btn")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
