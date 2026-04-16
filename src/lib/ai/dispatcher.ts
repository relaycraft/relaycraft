import { useAIStore } from "../../stores/aiStore";
import type { CommandAction } from "../../stores/commandStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import type { AIMessage } from "../../types/ai";
import { Logger } from "../logger";
import { buildAIContext } from "./contextBuilder";
import { classifyAIError } from "./errorClassifier";
import { getAILanguageInfo } from "./lang";
import { formatAIToolMetricsReport, trackAIToolPath } from "./metrics";
import {
  CHAT_RESPONSE_SYSTEM_PROMPT,
  GLOBAL_COMMAND_SYSTEM_PROMPT,
  MITMPROXY_SYSTEM_PROMPT,
} from "./prompts";
import { COMMAND_DETECTION_TOOLS } from "./tools";

/**
 * Robustly extracts a JSON object from a potentially messy string.
 */
const extractJson = (text: string): CommandAction | null => {
  const jsonStr = text.trim();
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    const candidate = jsonStr.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_e) {
      // fall through
    }
  }

  if (jsonStr.includes('"intent":') && !jsonStr.startsWith("{")) {
    try {
      return JSON.parse(`{${jsonStr}${jsonStr.endsWith("}") ? "" : "}"}`);
    } catch (_e) {
      // fall through
    }
  }

  return null;
};

const VALID_INTENTS = [
  "NAVIGATE",
  "CREATE_RULE",
  "CREATE_SCRIPT",
  "TOGGLE_PROXY",
  "OPEN_SETTINGS",
  "GENERATE_REQUEST",
  "CHAT",
  "CLEAR_TRAFFIC",
  "FILTER_TRAFFIC",
] as const;

const normalizeAction = (action: CommandAction): CommandAction => {
  const normalizedIntent = (action.intent || "CHAT").toUpperCase();
  if (!VALID_INTENTS.includes(normalizedIntent as (typeof VALID_INTENTS)[number])) {
    return { ...action, intent: "CHAT" };
  }
  return { ...action, intent: normalizedIntent as CommandAction["intent"] };
};

const extractActionFromToolResult = (result: {
  content?: string | null;
  tool_calls?: { function: { arguments: string; name: string } }[] | null;
}): CommandAction | null => {
  const firstToolCall = result.tool_calls?.[0];
  if (firstToolCall?.function?.arguments) {
    const parsed = extractJson(firstToolCall.function.arguments);
    if (parsed) return parsed;
  }

  if (result.content) {
    return extractJson(result.content);
  }

  return null;
};

/**
 * Lightweight detection of user intent to determine context depth.
 * Optimized to balance token usage and high-signal data.
 */
function detectContextOptions(input: string, activeTab: string | undefined): any {
  const inputLower = input.toLowerCase();
  const options: any = {
    includeLogs: false,
    includeHeaders: false,
    includeBody: false,
    maxTrafficCount: 5,
  };

  // Log-related keywords: Only fetch expensive logs if user asks for them
  if (inputLower.match(/log|日志|报错|错误|error|fatal|warn|挂了/)) {
    options.includeLogs = true;
  }

  // Heavy traffic analysis keywords
  if (inputLower.match(/header|头部|body|主体|内容|json|分析|analyze|content/)) {
    options.includeHeaders = true;
    // Deep content check: Only fetch body if specifically looking for data patterns
    if (inputLower.match(/body|内容|主体|json|是什么|查一下/)) {
      options.includeBody = true;
    }
  }

  // Traffic tab context: If we're looking at traffic, headers are usually safe and high-signal
  if (activeTab === "traffic" && !options.includeHeaders) {
    options.includeHeaders = true;
  }

  return options;
}

export async function dispatchCommand(
  input: string,
  context?: any,
  t?: (key: string, options?: any) => string,
  onChunk?: (content: string) => void,
  signal?: AbortSignal,
): Promise<CommandAction> {
  const language = useSettingsStore.getState().config.language;
  const translate = t || ((s: string) => s);
  const cleanInput = input.trim();
  const cleanInputLower = cleanInput.toLowerCase();

  if (cleanInputLower === "/ai-metrics") {
    return {
      intent: "CHAT",
      params: { message: formatAIToolMetricsReport() },
      confidence: 1.0,
      explanation: "local_ai_metrics_report",
    };
  }

  // 1. 本地指令匹配 (Slash Commands & Shortcuts)
  const STATIC_COMMANDS: Record<string, CommandAction> = {
    "/clear": {
      intent: "CLEAR_TRAFFIC",
      confidence: 1.0,
      explanation: translate("command_center.explanations.clear"),
    },
    "/start": {
      intent: "TOGGLE_PROXY",
      params: { action: "start" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.start"),
    },
    "/stop": {
      intent: "TOGGLE_PROXY",
      params: { action: "stop" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.stop"),
    },
    "/rules": {
      intent: "NAVIGATE",
      params: { path: "/rules" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.nav_rules"),
    },
    "/scripts": {
      intent: "NAVIGATE",
      params: { path: "/scripts" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.nav_scripts"),
    },
    "/settings": {
      intent: "NAVIGATE",
      params: { path: "/settings" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.nav_settings"),
    },
    "/traffic": {
      intent: "NAVIGATE",
      params: { path: "/traffic" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.nav_traffic"),
    },
    "/composer": {
      intent: "NAVIGATE",
      params: { path: "/composer" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.nav_composer"),
    },
    "/proxy": {
      intent: "OPEN_SETTINGS",
      params: { category: "network" },
      confidence: 1.0,
      explanation: translate("command_center.explanations.open_proxy"),
    },
    "/cert": {
      intent: "OPEN_SETTINGS",
      params: { category: "certificate" },
      confidence: 1.0,
    },
    "/certificate": {
      intent: "OPEN_SETTINGS",
      params: { category: "certificate" },
      confidence: 1.0,
    },
  };

  if (input.startsWith("/") && STATIC_COMMANDS[cleanInputLower]) {
    return STATIC_COMMANDS[cleanInputLower];
  }

  // 2. AI 是否启用检查
  const {
    settings: aiSettings,
    chatCompletion,
    chatCompletionWithTools,
    history,
    addMessage,
  } = useAIStore.getState();
  if (!aiSettings.enabled) {
    return {
      intent: "CHAT",
      params: { message: translate("command_center.not_enabled_warning") },
      confidence: 1.0,
    };
  }

  // 3. 构建上下文 (Scenario-Aware Context V3)
  const activeTab = useUIStore.getState().activeTab;
  const ctxOptions = detectContextOptions(input, activeTab);
  const fullContext = await buildAIContext(ctxOptions);
  const contextString = JSON.stringify({ ...fullContext, ...context }, null, 2);

  const langInfo = getAILanguageInfo();
  const intentSystemMsg: AIMessage = {
    role: "system" as const,
    content: GLOBAL_COMMAND_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name)
      .replace(/{{CONTEXT}}/g, contextString)
      .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
      .replace(/{{ACTIVE_TAB}}/g, activeTab),
  };

  const userMsg: AIMessage = { role: "user" as const, content: input };

  try {
    let action: CommandAction | null = null;
    let fallbackResponse = "";
    let fallbackReason = "tool_empty";

    try {
      const toolResult = await chatCompletionWithTools(
        [intentSystemMsg, ...history, userMsg],
        COMMAND_DETECTION_TOOLS,
        { type: "function", function: { name: "detect_intent" } },
        0,
        signal,
      );
      action = extractActionFromToolResult(toolResult);
      if (action) {
        trackAIToolPath({ feature: "command_dispatch", outcome: "tool_success" });
      } else {
        trackAIToolPath({
          feature: "command_dispatch",
          outcome: "tool_empty",
          detail: "tool_result_not_parsable",
        });
      }
    } catch (toolError) {
      const errorInfo = classifyAIError(toolError);
      Logger.warn("Intent tool-call failed, fallback to JSON mode", toolError);
      trackAIToolPath({
        feature: "command_dispatch",
        outcome: "tool_error",
        detail: `${errorInfo.kind}:${errorInfo.detail}`,
      });
      fallbackReason = errorInfo.kind;
    }

    if (!action) {
      trackAIToolPath({
        feature: "command_dispatch",
        outcome: "fallback_json",
        detail: fallbackReason,
      });
      fallbackResponse = await chatCompletion([intentSystemMsg, ...history, userMsg], 0, signal);
      action = extractJson(fallbackResponse);
    }

    if (!action) {
      action = {
        intent: "CHAT",
        params: { message: fallbackResponse || input },
        confidence: 0.5,
      };
    } else {
      action = normalizeAction(action);
    }

    // 两段式对话生成
    if (action.intent === "CHAT") {
      return await runTwoStageChat(input, context, action, language, translate, onChunk, signal);
    }

    addMessage("user", input);
    return action;
  } catch (error) {
    const errorInfo = classifyAIError(error);
    Logger.error("AI Recognition Failed", error);
    throw new Error(`${errorInfo.kind}: ${errorInfo.detail}`); // Propagate classified error to UI
  }
}

/**
 * Handles the second stage of AI interaction: streaming chat response.
 * Uses the same context-awareness logic but potentially deeper.
 */
async function runTwoStageChat(
  input: string,
  context: any,
  action: CommandAction,
  _language: string,
  _translate: (key: string) => string,
  onChunk?: (content: string) => void,
  signal?: AbortSignal,
): Promise<CommandAction> {
  const { chatCompletionStream, history, addMessage } = useAIStore.getState();
  const activeTab = useUIStore.getState().activeTab;
  const ctxOptions = detectContextOptions(input, activeTab);
  const fullContext = await buildAIContext(ctxOptions);
  const contextString = JSON.stringify({ ...fullContext, ...context }, null, 2);

  const isScriptIntent = action.intent === "CREATE_SCRIPT";
  const systemPrompt = isScriptIntent ? MITMPROXY_SYSTEM_PROMPT : CHAT_RESPONSE_SYSTEM_PROMPT;

  const langInfo = getAILanguageInfo();
  const chatSystemMsg: AIMessage = {
    role: "system" as const,
    content: systemPrompt
      .replace(/{{LANGUAGE}}/g, langInfo.name)
      .replace(/{{CONTEXT}}/g, contextString)
      .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
      .replace(/{{ACTIVE_TAB}}/g, activeTab),
  };

  const userMsg: AIMessage = { role: "user" as const, content: input };
  let fullChatResponse = "";

  await chatCompletionStream(
    [chatSystemMsg, ...history, userMsg],
    (chunk) => {
      fullChatResponse += chunk;
      if (onChunk) onChunk(chunk);
    },
    undefined,
    signal,
  );

  addMessage("user", input);
  addMessage("assistant", fullChatResponse);

  return {
    ...action,
    params: { ...action.params, message: fullChatResponse },
  };
}
