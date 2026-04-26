import i18n from "../../i18n";
import { useAIStore } from "../../stores/aiStore";
import type { CommandAction, CommandRoutingLayer } from "../../stores/commandStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import type { AIContextBudgetProfile, AIContextOptions, AIMessage } from "../../types/ai";
import { Logger } from "../logger";
import { buildAIContext } from "./context";
import { classifyAIError } from "./errorClassifier";
import { prepareHistoryForRequest } from "./historyManager";
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
const extractJson = (text: string | null | undefined): CommandAction | null => {
  if (text == null || typeof text !== "string") return null;
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

const markActionRouting = (action: CommandAction, layer: CommandRoutingLayer): CommandAction => {
  return {
    ...action,
    layer,
    executionMode: layer === "direct_command" ? "auto" : "confirm",
  };
};

const normalizeAction = (action: CommandAction): CommandAction => {
  const normalizedIntent = (action.intent || "CHAT").toUpperCase();
  if (!VALID_INTENTS.includes(normalizedIntent as (typeof VALID_INTENTS)[number])) {
    return { ...action, intent: "CHAT" };
  }
  return { ...action, intent: normalizedIntent as CommandAction["intent"] };
};

const EXPLICIT_SHORT_COMMANDS: Record<string, CommandAction> = {
  清空抓包: { intent: "CLEAR_TRAFFIC", confidence: 1.0, explanation: "explicit_short_command" },
  清空流量: { intent: "CLEAR_TRAFFIC", confidence: 1.0, explanation: "explicit_short_command" },
  "clear traffic": {
    intent: "CLEAR_TRAFFIC",
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  "clear all": { intent: "CLEAR_TRAFFIC", confidence: 1.0, explanation: "explicit_short_command" },
  开始代理: {
    intent: "TOGGLE_PROXY",
    params: { action: "start" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  "start proxy": {
    intent: "TOGGLE_PROXY",
    params: { action: "start" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  停止代理: {
    intent: "TOGGLE_PROXY",
    params: { action: "stop" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  "stop proxy": {
    intent: "TOGGLE_PROXY",
    params: { action: "stop" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  打开规则: {
    intent: "NAVIGATE",
    params: { path: "/rules" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  "open rules": {
    intent: "NAVIGATE",
    params: { path: "/rules" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  打开脚本: {
    intent: "NAVIGATE",
    params: { path: "/scripts" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  "open scripts": {
    intent: "NAVIGATE",
    params: { path: "/scripts" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  打开流量: {
    intent: "NAVIGATE",
    params: { path: "/traffic" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
  "open traffic": {
    intent: "NAVIGATE",
    params: { path: "/traffic" },
    confidence: 1.0,
    explanation: "explicit_short_command",
  },
};

const isConsultativeQuery = (inputLower: string): boolean => {
  return /(怎么做|如何|怎么|步骤|建议|what should|how do i|how to|\?|？)/.test(inputLower);
};

const looksActionableCommand = (inputLower: string, rawInput: string): boolean => {
  if (rawInput.trim().startsWith("/")) return true;
  return /(创建|新建|生成|打开|进入|切到|跳转|清空|开始|停止|过滤|筛选|mock|create|generate|open|go to|navigate|clear|start|stop|filter)/i.test(
    inputLower,
  );
};

const extractActionFromToolResult = (
  result:
    | {
        content?: string | null;
        tool_calls?: { function: { arguments: string; name: string } }[] | null;
      }
    | null
    | undefined,
): CommandAction | null => {
  if (!result) return null;
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
function detectContextOptions(
  input: string,
  activeTab: string | undefined,
  budgetProfile: AIContextBudgetProfile = "command_center",
): AIContextOptions {
  const inputLower = input.toLowerCase();
  const options: AIContextOptions = {
    includeLogs: false,
    includeHeaders: false,
    includeBody: false,
    maxTrafficCount: 5,
    budgetProfile,
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

function matchLocalCommand(
  input: string,
  cleanInput: string,
  cleanInputLower: string,
  translate: (key: string, options?: any) => string,
): CommandAction | null {
  if (cleanInputLower === "/ai-metrics") {
    return {
      intent: "CHAT",
      params: { message: formatAIToolMetricsReport() },
      confidence: 1.0,
      explanation: "local_ai_metrics_report",
      layer: "conversation",
      executionMode: "confirm",
    };
  }

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
    return markActionRouting(STATIC_COMMANDS[cleanInputLower], "direct_command");
  }

  if (EXPLICIT_SHORT_COMMANDS[cleanInput]) {
    return markActionRouting(EXPLICIT_SHORT_COMMANDS[cleanInput], "direct_command");
  }

  if (EXPLICIT_SHORT_COMMANDS[cleanInputLower]) {
    return markActionRouting(EXPLICIT_SHORT_COMMANDS[cleanInputLower], "direct_command");
  }

  return null;
}

export async function dispatchCommand(
  input: string,
  context?: any,
  t?: (key: string, options?: any) => string,
  onChunk?: (content: string) => void,
  signal?: AbortSignal,
): Promise<CommandAction> {
  const language = useSettingsStore.getState().config.language;
  const translate =
    t ?? ((key: string, options?: Record<string, unknown>) => i18n.t(key, options) as string);
  const cleanInput = input.trim();
  const cleanInputLower = cleanInput.toLowerCase();

  const localMatch = matchLocalCommand(input, cleanInput, cleanInputLower, translate);
  if (localMatch) return localMatch;

  const { settings: aiSettings, history } = useAIStore.getState();
  if (!aiSettings.enabled) {
    return {
      intent: "CHAT",
      params: { message: translate("command_center.not_enabled_warning") },
      confidence: 1.0,
      layer: "conversation",
      executionMode: "confirm",
    };
  }

  if (
    isConsultativeQuery(cleanInputLower) &&
    !looksActionableCommand(cleanInputLower, cleanInput)
  ) {
    const chatAction = markActionRouting(
      {
        intent: "CHAT",
        params: { message: input },
        confidence: 0.95,
        explanation: "consultative_query",
      },
      "conversation",
    );
    return await runTwoStageChat(input, context, chatAction, language, translate, onChunk, signal);
  }

  const activeTab = useUIStore.getState().activeTab;
  const ctxOptions = detectContextOptions(input, activeTab, "command_center");
  const fullContext = await buildAIContext(ctxOptions);
  const contextString = JSON.stringify({ ...fullContext, ...context }, null, 2);

  const langInfo = getAILanguageInfo();
  const maxTurns = Math.max(0, aiSettings.maxHistoryMessages ?? 10);
  const preparedHistory = prepareHistoryForRequest(history, input, maxTurns);
  const intentSystemMsg: AIMessage = {
    role: "system" as const,
    content: GLOBAL_COMMAND_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name)
      .replace(/{{CONTEXT}}/g, contextString)
      .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
      .replace(/{{ACTIVE_TAB}}/g, activeTab),
  };

  const userMsg: AIMessage = { role: "user" as const, content: input };

  try {
    return await dispatchToAI(
      input,
      context,
      language,
      translate,
      onChunk,
      signal,
      intentSystemMsg,
      userMsg,
      preparedHistory,
    );
  } catch (error) {
    const errorInfo = classifyAIError(error);
    Logger.error("AI Recognition Failed", error);
    throw new Error(`${errorInfo.kind}: ${errorInfo.detail}`);
  }
}

async function dispatchToAI(
  input: string,
  context: any,
  _language: string,
  translate: (key: string) => string,
  onChunk: ((content: string) => void) | undefined,
  signal: AbortSignal | undefined,
  intentSystemMsg: AIMessage,
  userMsg: AIMessage,
  preparedHistory: AIMessage[],
): Promise<CommandAction> {
  const { chatCompletion, chatCompletionWithTools, addMessage } = useAIStore.getState();

  let action: CommandAction | null = null;
  let fallbackResponse = "";
  let fallbackReason = "tool_empty";

  try {
    const toolResult = await chatCompletionWithTools(
      [intentSystemMsg, ...preparedHistory, userMsg],
      COMMAND_DETECTION_TOOLS,
      { type: "function", function: { name: "detect_intent" } },
      0,
      signal,
      { includeContext: false },
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
    fallbackResponse = await chatCompletion(
      [intentSystemMsg, ...preparedHistory, userMsg],
      0,
      signal,
      { includeContext: false },
    );
    action = extractJson(fallbackResponse);
  }

  if (!action) {
    action = {
      intent: "CHAT",
      params: {
        message: fallbackResponse || translate("command_center.uncertain_intent_fallback"),
      },
      confidence: 0.5,
      explanation: "uncertain_intent",
    };
  }
  action = normalizeAction(action);
  action = markActionRouting(action, action.intent === "CHAT" ? "conversation" : "guided_action");

  if (action.intent === "CHAT") {
    return await runTwoStageChat(
      input,
      context,
      action,
      _language,
      translate,
      onChunk,
      signal,
      preparedHistory,
    );
  }

  addMessage("user", input);
  return action;
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
  preparedHistory?: AIMessage[],
): Promise<CommandAction> {
  const { chatCompletionStream, history, addMessage, settings } = useAIStore.getState();
  const maxTurns = Math.max(0, settings.maxHistoryMessages ?? 10);
  const effectiveHistory = preparedHistory ?? prepareHistoryForRequest(history, input, maxTurns);
  const activeTab = useUIStore.getState().activeTab;
  const isScriptIntent = action.intent === "CREATE_SCRIPT";
  const ctxOptions = detectContextOptions(
    input,
    activeTab,
    isScriptIntent ? "script_assistant" : "command_center",
  );
  const fullContext = await buildAIContext(ctxOptions);
  const contextString = JSON.stringify({ ...fullContext, ...context }, null, 2);

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
    [chatSystemMsg, ...effectiveHistory, userMsg],
    (chunk) => {
      fullChatResponse += chunk;
      if (onChunk) onChunk(chunk);
    },
    undefined,
    signal,
    { includeContext: false },
  );

  addMessage("user", input);
  addMessage("assistant", fullChatResponse);

  return {
    ...action,
    params: { ...action.params, message: fullChatResponse },
  };
}
