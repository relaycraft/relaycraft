import { beforeEach, describe, expect, it, vi } from "vitest";

const chatCompletionWithTools = vi.fn();
const chatCompletion = vi.fn();
const chatCompletionStream = vi.fn();
const addMessage = vi.fn();
const mockAIState = {
  settings: { enabled: true, maxHistoryMessages: 2 },
  history: [] as Array<{ role: "user" | "assistant" | "system"; content: string }>,
};

vi.mock("../../stores/aiStore", () => ({
  useAIStore: {
    getState: () => ({
      settings: mockAIState.settings,
      chatCompletionWithTools,
      chatCompletion,
      chatCompletionStream,
      history: mockAIState.history,
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

vi.mock("./context", () => ({
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
    mockAIState.settings = { enabled: true, maxHistoryMessages: 2 };
    mockAIState.history = [];
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

  it("carries only the most recent turn for unrelated input, without older turns", async () => {
    mockAIState.history = [
      { role: "user", content: "帮我分析上一个 502 请求" },
      { role: "assistant", content: "可能是上游网关超时。" },
    ];
    chatCompletionStream.mockImplementationOnce(async (_messages, onChunk) => {
      onChunk("这是一个新问题，我按当前上下文独立回答。");
    });

    await dispatchCommand("今天星期几？");

    const streamMessages = chatCompletionStream.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(streamMessages.some((m) => m.content.includes("[Conversation Summary]"))).toBe(false);
    expect(streamMessages.some((m) => m.content.includes("帮我分析上一个 502 请求"))).toBe(true);
  });

  it("keeps exactly N recent turns and compresses overflow into summary", async () => {
    mockAIState.settings = { enabled: true, maxHistoryMessages: 2 };
    mockAIState.history = [
      { role: "user", content: "第1轮用户问题" },
      { role: "assistant", content: "第1轮助手回答" },
      { role: "user", content: "第2轮用户问题" },
      { role: "assistant", content: "第2轮助手回答" },
      { role: "user", content: "第3轮用户问题" },
      { role: "assistant", content: "第3轮助手回答" },
    ];
    chatCompletionWithTools.mockResolvedValueOnce({
      content: JSON.stringify({ intent: "CHAT", confidence: 0.9 }),
      tool_calls: null,
    });
    chatCompletionStream.mockImplementationOnce(async (_messages, onChunk) => {
      onChunk("已按限制轮次回答。");
    });

    await dispatchCommand("继续看第3轮这个问题");

    const streamMessages = chatCompletionStream.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(streamMessages.some((m) => m.content.includes("Earlier conversation summary"))).toBe(
      true,
    );
    expect(streamMessages.some((m) => m.content.includes("第1轮用户问题"))).toBe(true);
    expect(streamMessages.some((m) => m.content.includes("第2轮用户问题"))).toBe(true);
    expect(streamMessages.some((m) => m.content.includes("第3轮用户问题"))).toBe(true);
  });

  it("carries only the most recent turn when overlap is only generic words", async () => {
    mockAIState.history = [
      { role: "user", content: "帮我分析这个请求为什么 401" },
      { role: "assistant", content: "可能是鉴权 token 缺失。" },
    ];
    chatCompletionStream.mockImplementationOnce(async (_messages, onChunk) => {
      onChunk("按独立问题处理。");
    });

    await dispatchCommand("这个问题怎么处理");

    const streamMessages = chatCompletionStream.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(streamMessages.some((m) => m.content.includes("[Conversation Summary]"))).toBe(false);
    expect(streamMessages.some((m) => m.content.includes("帮我分析这个请求为什么 401"))).toBe(true);
  });

  it("carries context for short Chinese high-signal keywords without whitelist", async () => {
    mockAIState.history = [
      { role: "user", content: "登录鉴权超时是什么原因" },
      { role: "assistant", content: "可能是 token 失效或网关超时。" },
    ];
    chatCompletionStream.mockImplementationOnce(async (_messages, onChunk) => {
      onChunk("继续基于上一轮上下文分析。");
    });

    await dispatchCommand("鉴权超时怎么处理");

    const streamMessages = chatCompletionStream.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(streamMessages.some((m) => m.content.includes("new standalone topic"))).toBe(false);
    expect(streamMessages.some((m) => m.content.includes("登录鉴权超时是什么原因"))).toBe(true);
  });
});
