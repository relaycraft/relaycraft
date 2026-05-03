import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFlowDetail } from "../lib/traffic";
import { useTrafficStore } from "./trafficStore";

// Mock Tauri HTTP fetch
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

// Mock traffic module
vi.mock("../lib/traffic", () => ({
  fetchFlowDetail: vi.fn(),
  getBackendPort: vi.fn(() => 9091),
}));

// Mock sessionStore since trafficStore uses it for `clearAll`
vi.mock("./sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      showSessionId: "session-1",
      dbSessions: [{ id: "session-1", is_active: 1 }],
      fetchDbSessions: vi.fn(),
      deleteDbSession: vi.fn(),
    }),
  },
}));

describe("trafficStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTrafficStore.setState({
      indices: [],
      detailCache: new Map(),
      cacheOrder: [],
      interceptedFlows: new Map(),
      selectedFlow: null,
      selectedLoading: false,
      filterText: "",
      config: { maxDetailCache: 2, prefetchCount: 2 }, // Small cache for testing eviction
    });
  });

  it("should add indices and sort them by msg_ts", () => {
    const store = useTrafficStore.getState();
    const index1 = { id: "1", method: "GET", url: "http://test1.com", msg_ts: 100 } as any;
    const index2 = { id: "2", method: "POST", url: "http://test2.com", msg_ts: 200 } as any;
    const index3 = { id: "3", method: "PUT", url: "http://test3.com", msg_ts: 50 } as any; // earliest

    store.addIndices([index1, index2]);
    expect(useTrafficStore.getState().indices).toEqual([index1, index2]);

    store.addIndex(index3);
    // Should be sorted 3, 1, 2
    expect(useTrafficStore.getState().indices).toEqual([index3, index1, index2]);
  });

  it("should update intercepted flows", () => {
    const store = useTrafficStore.getState();
    const mockFlow = { id: "flow-1", request: { url: "test.com" } } as any;

    store.updateInterceptedFlow("flow-1", mockFlow);
    expect(useTrafficStore.getState().interceptedFlows.size).toBe(1);
    expect(useTrafficStore.getState().getInterceptedFlows()).toEqual([mockFlow]);

    // Remove
    store.updateInterceptedFlow("flow-1", null);
    expect(useTrafficStore.getState().interceptedFlows.size).toBe(0);
  });

  it("should load flow detail and cache it with LRU eviction", async () => {
    const store = useTrafficStore.getState();
    const flowA = { id: "A", _rc: { isWebsocket: false } } as any;
    const flowB = { id: "B", _rc: { isWebsocket: false } } as any;
    const flowC = { id: "C", _rc: { isWebsocket: false } } as any;

    (fetchFlowDetail as any)
      .mockResolvedValueOnce(flowA)
      .mockResolvedValueOnce(flowB)
      .mockResolvedValueOnce(flowC);

    // Load A
    await store.loadDetail("A");
    expect(useTrafficStore.getState().detailCache.has("A")).toBe(true);
    expect(useTrafficStore.getState().cacheOrder).toEqual(["A"]);

    // Load B
    await store.loadDetail("B");
    expect(useTrafficStore.getState().detailCache.has("A")).toBe(true);
    expect(useTrafficStore.getState().detailCache.has("B")).toBe(true);
    expect(useTrafficStore.getState().cacheOrder).toEqual(["A", "B"]);

    // Load C -> Should evict A because maxDetailCache is 2
    await store.loadDetail("C");
    expect(useTrafficStore.getState().detailCache.has("A")).toBe(false); // Evicted!
    expect(useTrafficStore.getState().detailCache.has("B")).toBe(true);
    expect(useTrafficStore.getState().detailCache.has("C")).toBe(true);
    expect(useTrafficStore.getState().cacheOrder).toEqual(["B", "C"]);

    // Reload B from cache (should update LRU order but not fetch)
    await store.loadDetail("B");
    expect(fetchFlowDetail).toHaveBeenCalledTimes(3); // No new fetch
    expect(useTrafficStore.getState().cacheOrder).toEqual(["C", "B"]); // B became most recently used
  });

  it("should not cache websocket flows", async () => {
    const store = useTrafficStore.getState();
    const wsFlow = { id: "ws-1", _rc: { isWebsocket: true } } as any;

    (fetchFlowDetail as any).mockResolvedValueOnce(wsFlow);

    const result = await store.loadDetail("ws-1");
    expect(result).toEqual(wsFlow);
    expect(useTrafficStore.getState().detailCache.has("ws-1")).toBe(false); // Not cached
  });

  it("should select flow", async () => {
    const flowA = { id: "A", _rc: { isWebsocket: false } } as any;
    (fetchFlowDetail as any).mockResolvedValueOnce(flowA);

    await useTrafficStore.getState().selectFlow("A");

    expect(useTrafficStore.getState().selectedFlow).toEqual(flowA);

    await useTrafficStore.getState().selectFlow(null);
    expect(useTrafficStore.getState().selectedFlow).toBeNull();
  });
});
