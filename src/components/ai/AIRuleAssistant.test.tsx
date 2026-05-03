import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIRuleAssistant } from "./AIRuleAssistant";

const { chatCompletionWithTools, chatCompletionStream, useAIStoreMock, useUIStoreMock } =
  vi.hoisted(() => {
    const chatCompletionWithTools = vi.fn();
    const chatCompletionStream = vi.fn();
    const useAIStoreMock = Object.assign(
      () => ({
        settings: { enabled: true },
      }),
      {
        getState: () => ({
          chatCompletionWithTools,
          chatCompletionStream,
        }),
      },
    );

    const useUIStoreMock = () => ({
      draftRulePrompt: null,
      setDraftRulePrompt: vi.fn(),
    });
    (useUIStoreMock as any).getState = () => ({
      showConfirm: vi.fn(),
      setActiveTab: vi.fn(),
      draftRulePrompt: null,
      setDraftRulePrompt: vi.fn(),
    });

    return { chatCompletionWithTools, chatCompletionStream, useAIStoreMock, useUIStoreMock };
  });

vi.mock("../../stores/aiStore", () => ({
  useAIStore: useAIStoreMock,
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: useUIStoreMock,
}));

vi.mock("../../stores/scriptStore", () => ({
  useScriptStore: () => ({
    saveScript: vi.fn(),
    toggleScript: vi.fn(),
  }),
}));

vi.mock("../../stores/ruleStore", () => ({
  useRuleStore: () => ({
    updateRule: vi.fn(),
  }),
}));

vi.mock("../../lib/ai/context", () => ({
  buildAIContext: vi.fn().mockResolvedValue({
    summary: "ctx",
    activeRules: [],
    activeScripts: [],
    system: { proxyPort: 9090, version: "test" },
  }),
}));

vi.mock("../../lib/ai/lang", () => ({
  getAILanguageInfo: () => ({ name: "Chinese", terminology: "RelayCraft" }),
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
      t: (key: string) => key,
    }),
  };
});

describe("AIRuleAssistant context injection contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatCompletionWithTools.mockRejectedValueOnce(new Error("tool failed"));
    chatCompletionStream.mockImplementationOnce(async (_messages, onChunk) => {
      onChunk('{"message":"ok"}');
    });
  });

  it("disables store context auto-injection when manually embedding context", async () => {
    render(
      <AIRuleAssistant
        onApply={vi.fn()}
        onClose={vi.fn()}
        initialMode="ai"
        initialRule={{ id: "rule_1", name: "rule" } as any}
      />,
    );

    fireEvent.click(screen.getByText("rules.editor.ai.chip_explain"));

    await waitFor(() => {
      expect(chatCompletionWithTools).toHaveBeenCalled();
      expect(chatCompletionStream).toHaveBeenCalled();
    });

    expect(chatCompletionWithTools).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      "auto",
      0,
      undefined,
      { includeContext: false },
    );
    expect(chatCompletionStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function),
      0,
      undefined,
      { includeContext: false },
    );
  });
});
