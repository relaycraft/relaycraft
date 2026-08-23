import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationStore } from "../../stores/notificationStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { fetchFlowDetail } from "./flowService";
import {
  clearPollInterval,
  hasActivePoll,
  pollTraffic,
  resetTimestamp,
  setPollTimestamp,
  startPollInterval,
} from "./trafficPoller";

// Mock Tauri HTTP fetch
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

// File picker used by sessionStore (imported transitively)
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../i18n", () => ({
  default: {
    t: (key: string) => key,
    on: vi.fn(),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./flowService", () => ({
  fetchFlowDetail: vi.fn(),
}));

vi.mock("./portState", () => ({
  getBackendPort: vi.fn(() => 9091),
}));

const okResponse = (data: any) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const makeIndex = (overrides: Record<string, any> = {}) => ({
  id: "flow-1",
  msg_ts: 100,
  method: "GET",
  url: "https://example.com/api",
  host: "example.com",
  path: "/api",
  status: 200,
  ...overrides,
});

describe("trafficPoller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPollInterval();
    resetTimestamp();
    useTrafficStore.setState({
      indices: [],
      interceptedFlows: new Map(),
      selectedFlow: null,
    } as any);
    useSessionStore.setState({
      dbSessions: [],
      showSessionId: null,
      loadingSessions: false,
    } as any);
    useNotificationStore.setState({ notifications: [] } as any);
  });

  it("manages the poll interval lifecycle", () => {
    expect(hasActivePoll()).toBe(false);
    startPollInterval();
    expect(hasActivePoll()).toBe(true);
    clearPollInterval();
    expect(hasActivePoll()).toBe(false);
  });

  it("fetches indices and feeds them into the traffic store", async () => {
    (tauriFetch as any).mockResolvedValueOnce(
      okResponse({ server_ts: 500, indices: [makeIndex()] }),
    );

    await pollTraffic();

    expect(tauriFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9091/_relay/poll?since=0",
      expect.objectContaining({ method: "GET" }),
    );
    const indices = useTrafficStore.getState().indices;
    expect(indices).toHaveLength(1);
    expect(indices[0]).toMatchObject({
      id: "flow-1",
      method: "GET",
      url: "https://example.com/api",
      isSse: false,
      websocketFrameCount: 0,
    });
  });

  it("advances the poll timestamp from server_ts", async () => {
    (tauriFetch as any)
      .mockResolvedValueOnce(okResponse({ server_ts: 500, indices: [makeIndex()] }))
      .mockResolvedValueOnce(okResponse({ server_ts: 900, indices: [] }));

    await pollTraffic();
    await pollTraffic();

    expect((tauriFetch as any).mock.calls[1][0]).toContain("since=500");
  });

  it("setPollTimestamp overrides the since parameter", async () => {
    setPollTimestamp(777);
    (tauriFetch as any).mockResolvedValueOnce(okResponse({ server_ts: 800, indices: [] }));

    await pollTraffic();

    expect((tauriFetch as any).mock.calls[0][0]).toContain("since=777");
  });

  it("drops indices when viewing a historical (non-writing) session", async () => {
    useSessionStore.setState({
      dbSessions: [{ id: "writing", is_active: 1 } as any],
      showSessionId: "historical",
    } as any);
    (tauriFetch as any).mockResolvedValueOnce(
      okResponse({ server_ts: 500, indices: [makeIndex()] }),
    );

    await pollTraffic();

    expect(useTrafficStore.getState().indices).toHaveLength(0);
  });

  it("fetches detail for newly intercepted flows", async () => {
    const flow = { id: "flow-1", _rc: { isWebsocket: false } };
    (fetchFlowDetail as any).mockResolvedValueOnce(flow);
    (tauriFetch as any).mockResolvedValueOnce(
      okResponse({ server_ts: 500, indices: [makeIndex({ isIntercepted: true })] }),
    );

    await pollTraffic();

    expect(fetchFlowDetail).toHaveBeenCalledWith("flow-1");
    expect(useTrafficStore.getState().interceptedFlows.get("flow-1")).toEqual(flow);
  });

  it("dispatches backend notifications into the notification store", async () => {
    (tauriFetch as any).mockResolvedValueOnce(
      okResponse({
        server_ts: 500,
        indices: [],
        notifications: [{ title_key: "t.key", message_key: "m.key", type: "warning" }],
      }),
    );

    await pollTraffic();

    const notes = useNotificationStore.getState().notifications;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: "t.key", message: "m.key", type: "warning" });
  });

  it("ignores re-entrant calls while a poll is in flight", async () => {
    let resolveFetch: (value: any) => void;
    (tauriFetch as any).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = pollTraffic();
    const second = pollTraffic();
    resolveFetch!(okResponse({ server_ts: 1, indices: [] }));
    await Promise.all([first, second]);

    expect(tauriFetch).toHaveBeenCalledTimes(1);
  });

  it("recovers after a 500 response so later polls still run", async () => {
    (tauriFetch as any)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ err: "x" }) })
      .mockResolvedValueOnce(okResponse({ server_ts: 10, indices: [makeIndex()] }));

    await pollTraffic();
    await pollTraffic();

    expect(tauriFetch).toHaveBeenCalledTimes(2);
    expect(useTrafficStore.getState().indices).toHaveLength(1);
  });

  it("swallows network failures without corrupting state", async () => {
    (tauriFetch as any).mockRejectedValueOnce(new Error("Load Failed"));

    await expect(pollTraffic()).resolves.toBeUndefined();
    expect(useTrafficStore.getState().indices).toHaveLength(0);

    // Next poll still works
    (tauriFetch as any).mockResolvedValueOnce(okResponse({ server_ts: 5, indices: [] }));
    await pollTraffic();
    expect(tauriFetch).toHaveBeenCalledTimes(2);
  });
});
