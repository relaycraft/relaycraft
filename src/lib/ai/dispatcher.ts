import i18n from "../../i18n";
import { useAIStore } from "../../stores/aiStore";
import type { CommandAction, CommandRoutingLayer } from "../../stores/commandStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import type { AIContextBudgetProfile, AIContextOptions, AIMessage } from "../../types/ai";
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

const HISTORY_SUMMARY_MAX_CHARS = 900;

const truncateText = (text: string, max = 120): string => {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}...`;
};

const buildTurnsFromHistory = (history: AIMessage[]): AIMessage[][] => {
  const turns: AIMessage[][] = [];
  let currentTurn: AIMessage[] | null = null;

  for (const msg of history) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      if (currentTurn && currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
      continue;
    }
    if (!currentTurn) continue;
    currentTurn.push(msg);
  }

  if (currentTurn && currentTurn.length > 0) {
    turns.push(currentTurn);
  }
  return turns;
};

const flattenTurns = (turns: AIMessage[][]): AIMessage[] => turns.flat();

const extractKeywords = (text: string): Set<string> => {
  const latin = (text.toLowerCase().match(/[a-z0-9_]{3,}/g) || []).map((s) => s.trim());
  const cjkChunks = (text.match(/[\u4e00-\u9fff]{2,}/g) || []).map((s) => s.trim());
  const cjkNgrams = cjkChunks.flatMap((chunk) => {
    const grams: string[] = [];
    const maxGram = Math.min(4, chunk.length);
    for (let size = 2; size <= maxGram; size += 1) {
      for (let i = 0; i + size <= chunk.length; i += 1) {
        grams.push(chunk.slice(i, i + size));
      }
    }
    return grams;
  });
  return new Set([...latin, ...cjkNgrams].filter(Boolean));
};

const GENERIC_TOPIC_WORDS = new Set([
  "请求",
  "问题",
  "这个",
  "那个",
  "怎么",
  "如何",
  "分析",
  "处理",
  "结果",
  "情况",
  "接口",
  "response",
  "request",
  "issue",
  "error",
  "problem",
  "analyze",
]);

const isStrongKeyword = (keyword: string): boolean => {
  if (!keyword) return false;
  if (GENERIC_TOPIC_WORDS.has(keyword.toLowerCase())) return false;
  if (/[./:_-]/.test(keyword)) return true; // URL/path/domain-ish token
  if (/^\d{3,}$/.test(keyword)) return true; // status/error code-like token
  const hasCJK = /[\u4e00-\u9fff]/.test(keyword);
  // Language-aware threshold:
  // - CJK tokens are semantically denser, so 2+ chars are often high-signal.
  // - Latin tokens keep a stricter 4+ threshold to avoid noisy linking.
  if (hasCJK) return keyword.length >= 2;
  return keyword.length >= 4;
};

const getStrongKeywords = (text: string): Set<string> =>
  new Set([...extractKeywords(text)].filter((key) => isStrongKeyword(key)));

const shouldCarryRecentTurns = (input: string, turns: AIMessage[][]): boolean => {
  if (!turns.length) return false;
  const referentialPattern =
    /(上面|上述|刚才|之前|继续|接着|延续|previous|earlier|continue|follow[\s-]?up)/i;
  if (referentialPattern.test(input)) {
    return true;
  }

  const inputKeys = getStrongKeywords(input);
  if (!inputKeys.size) return false;

  const recentUserMsgs = turns
    .slice(-3)
    .map((turn) => turn.find((m) => m.role === "user")?.content || "");
  const recentKeys = new Set(recentUserMsgs.flatMap((msg) => [...getStrongKeywords(msg)]));
  let overlap = 0;
  for (const key of inputKeys) {
    if (recentKeys.has(key)) overlap += 1;
  }

  // Conservative carry rule:
  // - either at least two strong overlaps,
  // - or one strong overlap that accounts for most of short query semantics.
  if (overlap >= 2) return true;
  if (overlap === 1 && inputKeys.size <= 2) return true;
  return false;
};

const buildDroppedTurnsSummary = (droppedTurns: AIMessage[][]): string => {
  const sampledTurns = droppedTurns.slice(-8);
  const lines = sampledTurns.map((turn, idx) => {
    const user = turn.find((m) => m.role === "user")?.content || "";
    const assistant = turn.find((m) => m.role === "assistant")?.content || "";
    return `${idx + 1}. U: ${truncateText(user, 80)} | A: ${truncateText(assistant, 80)}`;
  });
  let summary = [
    `Earlier conversation summary (${droppedTurns.length} older turn(s) compressed):`,
    ...lines,
    "Use this only as background. Prioritize the latest user request.",
  ].join("\n");
  if (summary.length > HISTORY_SUMMARY_MAX_CHARS) {
    summary = truncateText(summary, HISTORY_SUMMARY_MAX_CHARS);
  }
  return summary;
};

const MIN_ALWAYS_CARRY_TURNS = 1;

const prepareHistoryForRequest = (
  history: AIMessage[],
  input: string,
  maxTurns: number,
): AIMessage[] => {
  if (maxTurns <= 0) return [];
  const turns = buildTurnsFromHistory(history);
  if (!turns.length) return [];

  const alwaysCarry = turns.slice(-Math.min(MIN_ALWAYS_CARRY_TURNS, maxTurns));
  const olderTurns = turns.slice(0, Math.max(0, turns.length - MIN_ALWAYS_CARRY_TURNS));

  const carryOlderTurns = olderTurns.length > 0 && shouldCarryRecentTurns(input, olderTurns);

  if (!carryOlderTurns) {
    return flattenTurns(alwaysCarry);
  }

  const olderBudget = Math.max(0, maxTurns - alwaysCarry.length);
  const boundedOlder = olderTurns.slice(-olderBudget);
  const droppedTurns = olderTurns.slice(0, Math.max(0, olderTurns.length - olderBudget));
  const prepared: AIMessage[] = [];

  if (droppedTurns.length > 0) {
    prepared.push({
      role: "assistant",
      content: `[Conversation Summary]\n${buildDroppedTurnsSummary(droppedTurns)}`,
    });
  }
  prepared.push(...flattenTurns(boundedOlder));
  prepared.push(...flattenTurns(alwaysCarry));
  return prepared;
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
