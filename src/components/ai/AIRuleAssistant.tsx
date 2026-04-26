import { Code, FileCode, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { buildAIContext } from "../../lib/ai/context";
import {
  classifyAIError,
  composeActionableMessage,
  toUserActionableMessage,
} from "../../lib/ai/errorClassifier";
import { getAILanguageInfo } from "../../lib/ai/lang";
import { trackAIToolPath } from "../../lib/ai/metrics";
import { PROXY_RULE_SYSTEM_PROMPT } from "../../lib/ai/prompts";
import { mapAIRuleToInternal } from "../../lib/ai/ruleMapper";
import { parseToolCallArgs } from "../../lib/ai/toolArgs";
import { RULE_GENERATION_TOOLS } from "../../lib/ai/tools";
import { Logger } from "../../lib/logger";
import { generateScriptFromRule } from "../../lib/scriptGenerator";
import { parseYAML, stringifyYAML, validateRuleSchema } from "../../lib/yamlParser";
import { useAIStore } from "../../stores/aiStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useScriptStore } from "../../stores/scriptStore";
import { useUIStore } from "../../stores/uiStore";
import type { Rule } from "../../types/rules";
import { Button } from "../common/Button";
import { AIRuleMode } from "./AIRuleAssistant/AIRuleMode";
import { parseAIResponse } from "./AIRuleAssistant/parseAIResponse";
import { ScriptMode } from "./AIRuleAssistant/ScriptMode";
import { YAMLEditorMode } from "./AIRuleAssistant/YAMLEditorMode";

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
  const { draftRulePrompt, setDraftRulePrompt } = useUIStore();

  const [mode, setMode] = useState<"ai" | "yaml" | "script">(() => {
    if (initialMode === "ai" && !aiSettings.enabled) return "yaml";
    return initialMode;
  });
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [detectedIntent, setDetectedIntent] = useState<"explain" | "rule" | "unknown">("unknown");
  const [preview, setPreview] = useState<Partial<Rule> | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);

  // Use smart auto-scroll hook for AI explanation
  const { scrollRef } = useAutoScroll({
    enabled: generating || !!explanation,
    pauseOnUserScroll: true,
    dependencies: [explanation],
  });

  // YAML Editor State
  const [yamlContent, setYamlContent] = useState("");
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);

  // Script Mode State
  const [scriptName, setScriptName] = useState("");
  const [scriptContent, setScriptContent] = useState("");
  const [disableOriginal, setDisableOriginal] = useState(true);
  const [enableScript, setEnableScript] = useState(true);

  const inferInitialIntent = (text: string): "explain" | "rule" => {
    // Keep explanation prompts from showing the form skeleton.
    if (/(解释|说明|分析|原理|原因|why|explain)/i.test(text)) {
      return "explain";
    }
    return "rule";
  };

  // Sync initial rule to YAML content when initialRule changes (especially for rule switching or opening)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only trigger sync when rule ID changes to avoid overwriting edits or AI results during form typing
  useEffect(() => {
    if (initialRule) {
      setYamlContent(stringifyYAML(initialRule));
    }
  }, [initialRule?.id]);

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
        Logger.error("Failed to generate script", e);
      }
    }
  }, [mode, initialRule, scriptContent]);

  // Sync mode when prop changes
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Handle auto-trigger from Command Center via draftRulePrompt
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally omitting handleGenerate to avoid loop
  useEffect(() => {
    if (draftRulePrompt) {
      if (draftRulePrompt !== "INITIAL_OPEN_ONLY") {
        setPrompt(draftRulePrompt);
        // Short delay to ensure UI is ready
        setTimeout(() => {
          handleGenerate(draftRulePrompt);
        }, 100);
      }
      // Clear the prompt from store so it only runs once
      setDraftRulePrompt(null);
    }
  }, [draftRulePrompt, setDraftRulePrompt]);

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

  const handleGenerate = async (overridePrompt?: string) => {
    const activePrompt = overridePrompt || prompt;
    if (!activePrompt || generating) return;
    const initialIntent = inferInitialIntent(activePrompt);
    setGenerating(true);
    setExplanation(""); // Prepare for streaming
    setPreview(null);
    setDetectedIntent(initialIntent);

    try {
      const { chatCompletionStream, chatCompletionWithTools } = useAIStore.getState();
      let fallbackDetail = "tool_empty";
      // Build fresh context including active rules
      const context = await buildAIContext({ budgetProfile: "rule_assistant" });
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
      let finalPrompt = activePrompt;
      if (yamlContent && yamlContent.trim() !== "") {
        // Truncate YAML context if too large (e.g. > 20KB) to prevent token overflow/lag
        let contextYaml = yamlContent;
        if (contextYaml.length > 20000) {
          contextYaml = `${contextYaml.slice(0, 20000)}\n...[YAML_TRUNCATED_FOR_AI_CONTEXT]`;
        }
        finalPrompt = `Current Rule YAML:\n${contextYaml}\n\nUser Request: ${activePrompt}`;
      }

      const userMsg = { role: "user" as const, content: finalPrompt };

      // Function-calling fast path: structured result first, legacy streaming fallback second.
      try {
        const toolResult = await chatCompletionWithTools(
          [systemMsg, userMsg],
          RULE_GENERATION_TOOLS,
          "auto",
          0,
          undefined,
          { includeContext: false },
        );

        const firstToolCall = toolResult.tool_calls?.[0];
        const parsedRuleArgs = parseToolCallArgs(firstToolCall, "generate_rule");
        if (parsedRuleArgs) {
          trackAIToolPath({ feature: "rule_assistant_generate", outcome: "tool_success" });
          const internalRule = mapAIRuleToInternal(parsedRuleArgs);
          setDetectedIntent("rule");
          setPreview(internalRule);
          setYamlErrors([]);
          setYamlContent(stringifyYAML(internalRule));
          setExplanation(null);
          return;
        }

        const parsedExplainArgs = parseToolCallArgs(firstToolCall, "explain_rule");
        if (parsedExplainArgs) {
          trackAIToolPath({ feature: "rule_assistant_generate", outcome: "tool_success" });
          const message =
            parsedExplainArgs.message || toolResult.content || t("rules.editor.ai.generate_fail");
          setDetectedIntent("explain");
          setYamlErrors([]);
          setPreview(null);
          setExplanation(message);
          return;
        }
      } catch (toolError) {
        // Keep backward compatibility: if structured mode fails, continue with legacy parsing path.
        fallbackDetail = "tool_error";
        console.warn("Rule function-calling failed, fallback to legacy stream mode", toolError);
        trackAIToolPath({
          feature: "rule_assistant_generate",
          outcome: "tool_error",
          detail: toolError instanceof Error ? toolError.message : "unknown_tool_error",
        });
      }

      trackAIToolPath({
        feature: "rule_assistant_generate",
        outcome: "fallback_stream",
        detail: fallbackDetail,
      });
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
        undefined,
        { includeContext: false },
      );

      let streamParseError: unknown = null;
      const parsedResult = parseAIResponse(fullResponse, { parseYAML });
      if (parsedResult.type === "message") {
        setYamlErrors([]);
        setExplanation(parsedResult.message);
        setPreview(null);
        return;
      }
      if (parsedResult.type === "rule") {
        const internalRule = mapAIRuleToInternal(parsedResult.ruleData);
        setPreview(internalRule);
        setYamlErrors([]);
        setYamlContent(stringifyYAML(internalRule));
        setExplanation(null);
        return;
      }
      streamParseError = parsedResult.parseError;

      // Final fallback: if we couldn't parse as a rule but it's clearly a rule intent
      if (detectedIntent === "rule" && !preview) {
        // Try to see if it's at least valid YAML or partially valid JSON
        // If so, put it in the YAML editor so user can fix it
        setYamlContent(fullResponse);
        setMode("yaml");
        setExplanation(null);
        const parseHint = `${t("rules.editor.ai.generate_fail")}: ${t("rules.editor.ai.parse_error_hint")}`;
        setYamlErrors([composeActionableMessage(parseHint, streamParseError)]);
      } else if (!preview) {
        setExplanation(fullResponse);
      }
    } catch (error) {
      Logger.error("AI Rule Generation failed", error);
      const errorInfo = classifyAIError(error);
      setYamlErrors([toUserActionableMessage(errorInfo)]);
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
    let message = t("rules.editor.convert_script_confirm_dynamic", {
      name: scriptName,
    });
    if (disableOriginal && initialRule?.id) {
      message += ` ${t("rules.editor.convert_script_confirm_disable_rule")}`;
    }
    if (enableScript) {
      message += ` ${t("rules.editor.convert_script_confirm_enable_script")}`;
      message += `\n\n${t("rules.editor.convert_script_confirm_restart")}`;
    }

    // Confirmation before proceeding
    useUIStore.getState().showConfirm({
      title: t("rules.editor.convert_script_title"),
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
          Logger.error("Failed to create script:", error);
          alert(`Failed to create script: ${error}`);
        }
      },
    });
  };

  const initialYaml = initialRule ? stringifyYAML(initialRule) : "";
  const canApplyYaml = !!initialRule && yamlContent !== initialYaml;

  const handleGenerateWithPrompt = (value: string) => {
    setPrompt(value);
    handleGenerate(value);
  };

  const handleEditPreviewYAML = () => {
    if (preview) {
      setYamlContent(stringifyYAML(preview));
      setMode("yaml");
    }
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
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all ${mode === "ai" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Sparkles className="w-3 h-3" />
                {t("rules.editor.ai.tab_ai")}
              </button>
            )}
            <button
              onClick={() => {
                // If we don't have a preview (AI result), sync current form state to YAML
                // otherwise keep the AI result in the YAML editor
                if (!preview && initialRule) {
                  setYamlContent(stringifyYAML(initialRule));
                }
                setMode("yaml");
              }}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all ${mode === "yaml" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Code className="w-3 h-3" />
              YAML
            </button>
            <button
              onClick={() => setMode("script")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all ${mode === "script" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <FileCode className="w-3 h-3" />
              {t("rules.editor.ai.tab_script")}
            </button>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <X className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>

        <div
          ref={scrollRef}
          className="px-6 py-4 space-y-4 overflow-y-auto max-h-[500px] scroll-smooth"
        >
          {mode === "ai" && aiSettings.enabled && (
            <AIRuleMode
              t={t}
              prompt={prompt}
              generating={generating}
              detectedIntent={detectedIntent}
              preview={preview}
              explanation={explanation}
              initialRule={initialRule}
              onPromptChange={setPrompt}
              onGenerate={() => handleGenerate()}
              onGenerateWithPrompt={handleGenerateWithPrompt}
              onEditPreviewYAML={handleEditPreviewYAML}
              onApplyPreview={() => preview && onApply(preview)}
            />
          )}

          {mode === "yaml" && (
            <YAMLEditorMode
              t={t}
              yamlContent={yamlContent}
              yamlErrors={yamlErrors}
              canReset={canApplyYaml}
              canApply={canApplyYaml}
              onChange={(val: string) => {
                setYamlContent(val);
                setYamlErrors([]);
              }}
              onBeautify={handleBeautify}
              onReset={handleResetYAML}
              onApply={handleApplyYAML}
            />
          )}

          {mode === "script" && scriptContent && (
            <ScriptMode
              t={t}
              scriptContent={scriptContent}
              disableOriginal={disableOriginal}
              enableScript={enableScript}
              initialRule={initialRule}
              onDisableOriginalChange={setDisableOriginal}
              onEnableScriptChange={setEnableScript}
              onCreateScript={handleCreateScript}
            />
          )}
        </div>
      </div>
    </div>
  );
}
