import { beforeEach, describe, expect, it, vi } from "vitest";

const chatCompletionWithTools = vi.fn();
const chatCompletion = vi.fn();
const chatCompletionStream = vi.fn();
const addMessage = vi.fn();

vi.mock("../../stores/aiStore", () => ({
  useAIStore: {
    getState: () => ({
      settings: { enabled: true },
      chatCompletionWithTools,
      chatCompletion,
      chatCompletionStream,
      history: [],
      addMessage,
    }),
  },
}));

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ config: { language: "zh" } }),
  },
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({ activeTab: "traffic" }),
  },
}));

vi.mock("./contextBuilder", () => ({
  buildAIContext: vi.fn().mockResolvedValue({}),
}));

vi.mock("./lang", () => ({
  getAILanguageInfo: () => ({
    name: "Chinese",
    terminology: "中文技术术语",
  }),
}));

vi.mock("./prompts", () => ({
  GLOBAL_COMMAND_SYSTEM_PROMPT: "LANG={{LANGUAGE}} TAB={{ACTIVE_TAB}} CTX={{CONTEXT}}",
  CHAT_RESPONSE_SYSTEM_PROMPT: "CHAT={{LANGUAGE}}",
  MITMPROXY_SYSTEM_PROMPT: "SCRIPT={{LANGUAGE}}",
}));

vi.mock("../logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { dispatchCommand } from "./dispatcher";

describe("dispatcher function calling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns local ai metrics report for /ai-metrics command", async () => {
    const action = await dispatchCommand("/ai-metrics");

    expect(action.intent).toBe("CHAT");
    expect(action.params?.message).toContain("AI Tool Metrics (local session)");
    expect(chatCompletionWithTools).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("uses tool-calling result as the primary intent source", async () => {
    chatCompletionWithTools.mockResolvedValueOnce({
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "detect_intent",
            arguments: JSON.stringify({
              intent: "NAVIGATE",
              params: { path: "/rules" },
              confidence: 0.98,
            }),
          },
        },
      ],
    });

    const action = await dispatchCommand("去规则页面");

    expect(action.intent).toBe("NAVIGATE");
    expect(action.params).toEqual({ path: "/rules" });
    expect(action.executionMode).toBe("confirm");
    expect(action.layer).toBe("guided_action");
    expect(chatCompletionWithTools).toHaveBeenCalledOnce();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("falls back to legacy JSON mode when tool-calling fails", async () => {
    chatCompletionWithTools.mockRejectedValueOnce(new Error("tool failed"));
    chatCompletion.mockResolvedValueOnce(
      JSON.stringify({
        intent: "CLEAR_TRAFFIC",
        confidence: 0.9,
      }),
    );

    const action = await dispatchCommand("清空抓包记录");

    expect(action.intent).toBe("CLEAR_TRAFFIC");
    expect(action.executionMode).toBe("confirm");
    expect(action.layer).toBe("guided_action");
    expect(chatCompletionWithTools).toHaveBeenCalledOnce();
    expect(chatCompletion).toHaveBeenCalledOnce();
  });

  it("treats explicit short commands as direct auto-executable actions", async () => {
    const action = await dispatchCommand("开始代理");

    expect(action.intent).toBe("TOGGLE_PROXY");
    expect(action.params).toEqual({ action: "start" });
    expect(action.executionMode).toBe("auto");
    expect(action.layer).toBe("direct_command");
    expect(chatCompletionWithTools).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("routes consultative questions to conversation flow without action tool dispatch", async () => {
    chatCompletionStream.mockImplementationOnce(async (_messages, onChunk) => {
      onChunk("先确认接口路径，再给出返回体模板。");
    });

    const action = await dispatchCommand("接口返回 401 是什么原因？要怎么处理？");

    expect(action.intent).toBe("CHAT");
    expect(action.executionMode).toBe("confirm");
    expect(action.layer).toBe("conversation");
    expect(chatCompletionWithTools).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(chatCompletionStream).toHaveBeenCalledOnce();
  });
});
