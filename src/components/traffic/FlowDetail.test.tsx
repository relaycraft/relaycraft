import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowDetail } from "./FlowDetail";

const {
  chatCompletionStream,
  fetchSseEvents,
  loadDetail,
  setTrafficState,
  useAIStoreMock,
  useTrafficStoreMock,
} = vi.hoisted(() => {
  const chatCompletionStream = vi.fn();
  const fetchSseEvents = vi.fn();
  const loadDetail = vi.fn();

  const trafficState = {
    selectedFlow: { id: "flow-1" },
    loadDetail,
  };
  const setTrafficState = (partial: Partial<typeof trafficState>) => {
    Object.assign(trafficState, partial);
  };

  const useAIStoreMock = Object.assign(
    () => ({
      settings: { enabled: true },
    }),
    {
      getState: () => ({
        chatCompletionStream,
      }),
    },
  );

  const useTrafficStoreMock = Object.assign(() => ({}), {
    getState: () => trafficState,
    setState: vi.fn(),
  });

  return {
    chatCompletionStream,
    fetchSseEvents,
    loadDetail,
    setTrafficState,
    useAIStoreMock,
    useTrafficStoreMock,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../stores/aiStore", () => ({
  useAIStore: useAIStoreMock,
}));

vi.mock("../../stores/trafficStore", () => ({
  useTrafficStore: useTrafficStoreMock,
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: Object.assign(
    (selector?: (state: { isMac: boolean }) => unknown) =>
      selector ? selector({ isMac: true }) : { isMac: true },
    {
      getState: () => ({
        isMac: true,
        setActiveTab: vi.fn(),
      }),
    },
  ),
}));

vi.mock("../../stores/composerStore", () => ({
  useComposerStore: {
    getState: () => ({
      setComposerFromFlow: vi.fn(),
    }),
  },
}));

vi.mock("../../lib/trafficMonitor", () => ({
  fetchSseEvents,
}));

vi.mock("../../lib/ai/lang", () => ({
  getAILanguageInfo: () => ({
    name: "English",
    terminology: "RelayCraft",
    flow: {
      summary: "Summary",
      diagnostics: "Diagnostics",
      optimization: "Optimization",
    },
  }),
}));

vi.mock("../../hooks/useAutoScroll", () => ({
  useAutoScroll: () => ({ scrollRef: { current: null } }),
}));

vi.mock("../ai/AIMarkdown", () => ({
  AIMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("./BodyView", () => ({
  BodyView: ({ content }: { content?: string }) => <div>{content || "body-empty"}</div>,
}));

vi.mock("./HeadersView", () => ({
  HeadersView: () => <div>headers</div>,
}));

vi.mock("./WsResendDrawer", () => ({
  WsResendDrawer: () => null,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: any) => React.ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
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

function createBaseFlow() {
  return {
    id: "flow-1",
    time: 120,
    timings: {},
    request: {
      method: "GET",
      url: "https://example.com",
      headers: [],
      postData: undefined,
      httpVersion: "HTTP/1.1",
    },
    response: {
      status: 200,
      headers: [],
      content: {
        text: "response-body",
        encoding: "utf8",
      },
    },
    _rc: {
      isSse: false,
      isWebsocket: false,
      sseEvents: [],
      sseStreamOpen: false,
      websocketFrames: [],
      websocketFrameCount: 0,
      hits: [],
    },
  } as any;
}

describe("FlowDetail regression guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTrafficState({
      selectedFlow: { id: "flow-1" },
      loadDetail,
    });
    fetchSseEvents.mockResolvedValue({
      events: [],
      nextSeq: 0,
      streamOpen: true,
      droppedCount: 0,
    });
    chatCompletionStream.mockImplementation(async (_messages, onChunk) => {
      onChunk("analysis-chunk");
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls SSE events immediately and every 500ms", async () => {
    vi.useFakeTimers();
    const flow = createBaseFlow();
    flow._rc.isSse = true;

    render(<FlowDetail flow={flow} onClose={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSseEvents).toHaveBeenCalledTimes(1);
    expect(fetchSseEvents).toHaveBeenCalledWith("flow-1", 0, 200);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });

    expect(fetchSseEvents).toHaveBeenCalledTimes(2);
  });

  it("starts websocket refresh only on messages tab and stops after switching away", async () => {
    vi.useFakeTimers();
    const flow = createBaseFlow();
    flow._rc.isWebsocket = true;
    flow._rc.websocketFrameCount = 1;
    flow._rc.websocketFrames = [
      {
        id: "ws-1",
        fromClient: true,
        type: "text",
        content: "ping",
        length: 4,
        timestamp: Date.now(),
      },
    ];
    loadDetail.mockResolvedValue(flow);

    render(<FlowDetail flow={flow} onClose={vi.fn()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(loadDetail).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText("flow.tabs.messages"));
    });
    expect(screen.getByText("traffic.websocket.frames")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(loadDetail).toHaveBeenCalledWith("flow-1", true);
    const callsAfterMessages = loadDetail.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByText("flow.tabs.request"));
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(loadDetail.mock.calls.length).toBe(callsAfterMessages);
  });

  it("triggers AI analysis stream on button click", async () => {
    const flow = createBaseFlow();

    render(<FlowDetail flow={flow} onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("flow.analysis.btn"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(chatCompletionStream).toHaveBeenCalledTimes(1);
      expect(screen.getByText("analysis-chunk")).toBeInTheDocument();
    });
  });

  it("switches between request and response tabs", () => {
    const flow = createBaseFlow();

    render(<FlowDetail flow={flow} onClose={vi.fn()} />);

    expect(screen.getByText("flow.sections.request_headers")).toBeInTheDocument();

    fireEvent.click(screen.getByText("flow.tabs.response"));
    expect(screen.getByText("flow.sections.response_headers")).toBeInTheDocument();

    fireEvent.click(screen.getByText("flow.tabs.request"));
    expect(screen.getByText("flow.sections.request_headers")).toBeInTheDocument();
  });
});
