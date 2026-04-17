import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIToolMessage, Tool } from "../types/ai";
import { sanitizeLoadedSettings, useAIStore } from "./aiStore";

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel<T> {
    onmessage?: (payload: T) => void;
  }

  return {
    invoke: vi.fn(),
    Channel: MockChannel,
  };
});

describe("aiStore tool-calling protocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAIStore.setState({
      context: null,
      loading: false,
      testingConnection: false,
      connectionStatus: "idle",
      connectionMessage: "",
      history: [],
    });
  });

  it("chatCompletionWithTools should return structured tool result", async () => {
    const mockResult = {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "generate_rule",
            arguments: '{"name":"Demo Rule"}',
          },
        },
      ],
    };
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

    const messages: AIToolMessage[] = [{ role: "user", content: "生成一个规则" }];
    const tools: Tool[] = [
      {
        type: "function",
        function: {
          name: "generate_rule",
          description: "生成规则",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
    ];

    const result = await useAIStore.getState().chatCompletionWithTools(messages, tools);

    expect(result).toEqual(mockResult);
    expect(invoke).toHaveBeenCalledWith("ai_chat_completion_with_tools", {
      messages,
      tools,
      toolChoice: null,
      temperature: null,
    });
  });

  it("chatCompletionStreamWithTools should keep tool message metadata", async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const messages: AIToolMessage[] = [
      {
        role: "assistant",
        content: "",
      },
      {
        role: "tool",
        name: "generate_rule",
        tool_call_id: "call_1",
        content: '{"ok":true}',
      },
    ];
    const tools: Tool[] = [];

    await useAIStore.getState().chatCompletionStreamWithTools(messages, tools, () => undefined);

    expect(invoke).toHaveBeenCalledWith(
      "ai_chat_completion_stream_with_tools",
      expect.objectContaining({
        messages,
        tools,
        toolChoice: null,
        temperature: null,
      }),
    );
  });
});

describe("aiStore settings migration", () => {
  it("keeps unknown provider config during sanitize to avoid destructive overwrite", () => {
    const loaded = sanitizeLoadedSettings({
      enabled: true,
      provider: "anthropic",
      profileId: "anthropic-default",
      adapterMode: "anthropic",
      apiKey: "",
      customEndpoint: "https://api.anthropic.com/v1",
      model: "claude-3-7-sonnet",
      maxTokens: 4096,
      temperature: 0.7,
      enableCaching: true,
      maxHistoryMessages: 10,
    });

    expect(loaded.provider).toBe("anthropic");
    expect(loaded.customEndpoint).toBe("https://api.anthropic.com/v1");
    expect(loaded.model).toBe("claude-3-7-sonnet");
  });
});
