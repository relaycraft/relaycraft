import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIAssistant } from "./AIAssistant";

const { chatCompletionWithTools, chatCompletionStream, useAIStoreMock, useUIStoreMock } =
  vi.hoisted(() => {
    const chatCompletionWithTools = vi.fn();
    const chatCompletionStream = vi.fn();
    const abortChat = vi.fn();
    const useAIStoreMock = () => ({
      chatCompletionStream,
      chatCompletionWithTools,
      abortChat,
      settings: { enabled: true },
    });
    const useUIStoreMock = () => ({});
    (useUIStoreMock as any).getState = () => ({ activeTab: "traffic" });
    return {
      chatCompletionWithTools,
      chatCompletionStream,
      useAIStoreMock,
      useUIStoreMock,
    };
  });

vi.mock("../../stores/aiStore", () => ({
  useAIStore: useAIStoreMock,
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: useUIStoreMock,
}));

vi.mock("../../lib/ai/lang", () => ({
  getAILanguageInfo: () => ({ name: "Chinese", terminology: "RelayCraft, mitmproxy, Addon" }),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback || key,
    }),
  };
});

vi.mock("../common/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./AIMarkdown", () => ({
  AIMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    span: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
      <span {...props}>{children}</span>
    ),
  },
}));

describe("AIAssistant filter function-calling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses generate_filter tool result before legacy stream mode", async () => {
    chatCompletionWithTools.mockResolvedValueOnce({
      content: null,
      tool_calls: [
        {
          id: "call_filter_1",
          type: "function",
          function: {
            name: "generate_filter",
            arguments: JSON.stringify({ filter: "status:404 method:POST" }),
          },
        },
      ],
    });

    const onGenerate = vi.fn();
    render(<AIAssistant mode="filter" onGenerate={onGenerate} />);

    fireEvent.click(screen.getAllByRole("button")[0]);

    const input = screen.getByPlaceholderText("ai.assistant.search.placeholder");
    fireEvent.change(input, { target: { value: "找出 post 的 404 请求" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(onGenerate).toHaveBeenCalledWith("status:404 method:POST");
    });
    expect(chatCompletionWithTools).toHaveBeenCalledOnce();
    expect(chatCompletionStream).not.toHaveBeenCalled();
  });

  it("uses generate_regex tool result before legacy stream mode", async () => {
    chatCompletionWithTools.mockResolvedValueOnce({
      content: null,
      tool_calls: [
        {
          id: "call_regex_1",
          type: "function",
          function: {
            name: "generate_regex",
            arguments: JSON.stringify({ pattern: "^/api/v1/" }),
          },
        },
      ],
    });

    const onGenerate = vi.fn();
    render(<AIAssistant mode="regex" onGenerate={onGenerate} />);

    fireEvent.click(screen.getAllByRole("button")[0]);
    const input = screen.getByPlaceholderText("ai.assistant.regex.placeholder");
    fireEvent.change(input, { target: { value: "匹配 v1 api 路径" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(onGenerate).toHaveBeenCalledWith("^/api/v1/");
    });
    expect(chatCompletionWithTools).toHaveBeenCalledOnce();
    expect(chatCompletionStream).not.toHaveBeenCalled();
  });

  it("uses explain_regex tool result before legacy stream explain mode", async () => {
    chatCompletionWithTools.mockResolvedValueOnce({
      content: null,
      tool_calls: [
        {
          id: "call_regex_explain_1",
          type: "function",
          function: {
            name: "explain_regex",
            arguments: JSON.stringify({ explanation: "Summary: matches /api prefix" }),
          },
        },
      ],
    });

    render(<AIAssistant mode="regex" value="^/api" onGenerate={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByText("ai.assistant.regex.explain_btn"));

    await waitFor(() => {
      expect(screen.getByText("Summary: matches /api prefix")).toBeTruthy();
    });
    expect(chatCompletionWithTools).toHaveBeenCalledOnce();
    expect(chatCompletionStream).not.toHaveBeenCalled();
  });
});
