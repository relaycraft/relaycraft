import { useAIStore } from "../../stores/aiStore";
import type { CommandAction } from "../../stores/commandStore";
import { useComposerStore } from "../../stores/composerStore";
import { useProxyStore } from "../../stores/proxyStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useScriptStore } from "../../stores/scriptStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { type TabType, useUIStore } from "../../stores/uiStore";
import type { RuleType } from "../../types/rules";
import { DEFAULT_SCRIPT_TEMPLATE } from "../constants";
import { Logger } from "../logger";
import { getUniqueName } from "../utils";
import { getAILanguageInfo } from "./lang";
import { FILTER_ASSISTANT_SYSTEM_PROMPT } from "./prompts";
import { mapAIRuleToInternal } from "./ruleMapper";
import { parseToolCallArgs } from "./toolArgs";
import { FILTER_GENERATION_TOOLS } from "./tools/filterTools";
import { cleanAIResult, normalizeFilterQuery } from "./utils";

interface ExecuteCommandActionOptions {
  action: CommandAction;
  setIsOpen: (open: boolean) => void;
  setActiveTab: (tab: TabType) => void;
  setStreamingMessage: (message: string | null) => void;
  setExecuting: (executing: boolean) => void;
}

const mapPathToTab = (path: string): TabType | null => {
  const p = path.toLowerCase();
  if (p.includes("rule")) return "rules";
  if (p.includes("script")) return "scripts";
  if (p.includes("traffic") || p.includes("dashboard")) return "traffic";
  if (p.includes("composer")) return "composer";
  if (p.includes("setting")) return "settings";
  return null;
};

const inferDraftRuleType = (requirement: string): RuleType => {
  const text = requirement.toLowerCase();

  if (/(延迟|慢|限速|丢包|带宽|throttle|delay|latency|timeout|packet loss|bandwidth)/i.test(text)) {
    return "throttle";
  }
  if (/(拦截|阻断|屏蔽|拒绝|block|deny|forbid)/i.test(text)) {
    return "block_request";
  }
  if (/(请求头|响应头|header|cookie|authorization|token)/i.test(text)) {
    return "rewrite_header";
  }
  if (/(转发|重定向|代理到|转到|forward|redirect|upstream)/i.test(text)) {
    return "map_remote";
  }
  if (/(mock|模拟|本地文件|本地响应|假数据|固定返回)/i.test(text)) {
    return "map_local";
  }

  // Default to the first visible type in the editor, avoid forcing block by default.
  return "rewrite_body";
};

export async function executeCommandAction({
  action,
  setIsOpen,
  setActiveTab,
  setStreamingMessage,
  setExecuting,
}: ExecuteCommandActionOptions): Promise<void> {
  switch (action.intent) {
    case "NAVIGATE":
      if (action.params?.path) {
        const tab = mapPathToTab(action.params.path);
        if (tab) setActiveTab(tab);
      }
      setIsOpen(false);
      break;
    case "CREATE_RULE": {
      const { selectRule, setDraftRule } = useRuleStore.getState();
      selectRule(null);

      const requirement =
        action.params?.requirement || action.params?.description || action.params?.message || "";
      const inferredType = inferDraftRuleType(requirement);

      const defaultRule = mapAIRuleToInternal({ name: "Untitled Rule", type: inferredType });
      setDraftRule(defaultRule);

      if (requirement) {
        useUIStore.getState().setDraftRulePrompt(requirement);
      } else {
        useUIStore.getState().setDraftRulePrompt("INITIAL_OPEN_ONLY");
      }

      setActiveTab("rules");
      setIsOpen(false);
      break;
    }
    case "OPEN_SETTINGS":
      if (action.params?.category) {
        useUIStore.getState().setSettingsTab(action.params.category);
      }
      setActiveTab("settings");
      setIsOpen(false);
      break;
    case "CREATE_SCRIPT": {
      const existingNames = useScriptStore.getState().scripts.map((s) => s.name);
      const scriptName = action.params?.name
        ? getUniqueName(action.params.name, existingNames)
        : getUniqueName("Untitled Script.py", existingNames);

      const requirement =
        action.params?.requirement || action.params?.description || action.params?.message || "";

      useScriptStore
        .getState()
        .setDraftScript({ name: scriptName, content: DEFAULT_SCRIPT_TEMPLATE });

      if (requirement) {
        useUIStore.getState().setDraftScriptPrompt(requirement);
      } else {
        useUIStore.getState().setDraftScriptPrompt("INITIAL_OPEN_ONLY");
      }

      setActiveTab("scripts");
      setIsOpen(false);
      break;
    }
    case "CLEAR_TRAFFIC":
      useTrafficStore.getState().clearFlows();
      setIsOpen(false);
      break;
    case "FILTER_TRAFFIC": {
      const requirement =
        action.params?.requirement || action.params?.description || action.params?.message || "";

      if (requirement) {
        setExecuting(true);
        try {
          const { chatCompletion, chatCompletionWithTools } = useAIStore.getState();
          const langInfo = getAILanguageInfo();
          const systemMsg = {
            role: "system" as const,
            content: FILTER_ASSISTANT_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name)
              .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
              .replace(/{{ACTIVE_TAB}}/g, useUIStore.getState().activeTab)
              .replace(/{{CURRENT_FILTER}}/g, useTrafficStore.getState().filterText || "None"),
          };
          const userMsg = { role: "user" as const, content: requirement };
          let cleaned = "";
          try {
            const toolResult = await chatCompletionWithTools(
              [systemMsg, userMsg],
              FILTER_GENERATION_TOOLS,
              { type: "function", function: { name: "generate_filter" } },
              0,
            );
            const firstToolCall = toolResult.tool_calls?.[0];
            const parsedArgs = parseToolCallArgs(firstToolCall, "generate_filter");
            if (parsedArgs?.filter) {
              cleaned = normalizeFilterQuery(parsedArgs.filter);
            } else if (toolResult.content?.trim()) {
              cleaned = normalizeFilterQuery(toolResult.content);
            }
          } catch {
            const result = await chatCompletion([systemMsg, userMsg]);
            cleaned = normalizeFilterQuery(result);
          }

          if (!cleaned) {
            const result = await chatCompletion([systemMsg, userMsg]);
            cleaned = normalizeFilterQuery(cleanAIResult(result));
          }
          useUIStore.getState().setDraftTrafficFilter(cleaned);
        } catch (error) {
          Logger.error("Filter generation failed", error);
        } finally {
          setExecuting(false);
        }
      }

      setActiveTab("traffic");
      setIsOpen(false);
      break;
    }
    case "TOGGLE_PROXY":
      if (action.params?.action === "start") await useProxyStore.getState().startProxy();
      else if (action.params?.action === "stop") await useProxyStore.getState().stopProxy();
      setIsOpen(false);
      break;
    case "GENERATE_REQUEST":
      if (action.params) {
        const composer = useComposerStore.getState();
        if (action.params.method) composer.setMethod(action.params.method);
        if (action.params.url) composer.setUrl(action.params.url);
        if (action.params.headers) {
          composer.setHeaders(action.params.headers.map((h) => ({ ...h, enabled: true })));
        }
        if (action.params.body) composer.setBody(action.params.body);
        if (action.params.bodyType) composer.setBodyType(action.params.bodyType);
      }
      setActiveTab("composer");
      setIsOpen(false);
      break;
    case "CHAT":
      if (typeof action.params?.message === "string" && action.params.message.trim().length > 0) {
        setStreamingMessage(action.params.message);
      }
      break;
    default:
      break;
  }
}
