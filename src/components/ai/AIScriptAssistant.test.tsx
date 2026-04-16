import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIScriptAssistant } from "./AIScriptAssistant";

const { chatCompletionWithTools, chatCompletionStream, useUIStoreMock } = vi.hoisted(() => {
  const chatCompletionWithTools = vi.fn();
  const chatCompletionStream = vi.fn();
  const setDraftScriptPrompt = vi.fn();
  const useUIStoreMock = () => ({
    draftScriptPrompt: null,
    setDraftScriptPrompt,
  });
  (useUIStoreMock as any).getState = () => ({
    draftScriptPrompt: null,
    setDraftScriptPrompt,
  });
  return { chatCompletionWithTools, chatCompletionStream, useUIStoreMock };
});

vi.mock("../../stores/aiStore", () => ({
  useAIStore: {
    getState: () => ({
      chatCompletionWithTools,
      chatCompletionStream,
    }),
  },
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: useUIStoreMock,
}));

vi.mock("../../lib/ai/lang", () => ({
  getAILanguageInfo: () => ({ name: "Chinese", terminology: "RelayCraft, mitmproxy, Addon" }),
}));

vi.mock("../../hooks/useAutoScroll", () => ({
  useAutoScroll: () => ({ scrollRef: { current: null } }),
}));

vi.mock("./AIMarkdown", () => ({
  AIMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback || _key,
    }),
  };
});

describe("AIScriptAssistant function-calling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses generate_script tool result first and skips legacy stream", async () => {
    chatCompletionWithTools.mockResolvedValueOnce({
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "generate_script",
            arguments: JSON.stringify({
              code: "class Addon:\n    pass\n\naddons = [Addon()]",
            }),
          },
        },
      ],
    });

    const onApply = vi.fn();
    render(<AIScriptAssistant onApply={onApply} onClose={() => undefined} isCreateMode />);

    fireEvent.change(screen.getByPlaceholderText("scripts.editor.ai.placeholder"), {
      target: { value: "生成一个脚本" },
    });
    fireEvent.click(screen.getByTitle("common.generate"));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith("class Addon:\n    pass\n\naddons = [Addon()]");
    });
    expect(chatCompletionWithTools).toHaveBeenCalledOnce();
    expect(chatCompletionStream).not.toHaveBeenCalled();
  });
});
