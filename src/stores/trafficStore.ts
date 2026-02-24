/**
 * Traffic Store - Memory Optimized
 *
 * FlowIndex: lightweight metadata always in memory
 * FlowDetail: full data loaded on demand with LRU cache (~95% memory reduction)
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { create } from "zustand";
import { fetchFlowDetail, getBackendPort } from "../lib/trafficMonitor";
import type { Flow, FlowIndex } from "../types";
import { useSessionStore } from "./sessionStore";

// ==================== Type Definitions ====================

interface TrafficStoreConfig {
  maxDetailCache: number; // Maximum cached details (default: 100)
  prefetchCount: number; // Prefetch count for visible area (default: 10)
}

interface TrafficStore {
  // ========== State ==========

  /** Flow indices - lightweight metadata for list display */
  indices: FlowIndex[];

  /** Detail cache - LRU cached full flow data */
  detailCache: Map<string, Flow>;
  cacheOrder: string[];

  /** Intercepted flows - full data for breakpoint modal */
  interceptedFlows: Map<string, Flow>;

  /** Currently selected flow */
  selectedFlow: Flow | null;
  selectedLoading: boolean;

  /** Active search filter text */
  filterText: string;
  setFilterText: (text: string) => void;

  /** Configuration */
  config: TrafficStoreConfig;

  // ========== Actions ==========

  /** Add indices (from polling) */
  addIndices: (indices: FlowIndex[]) => void;

  /** Add single index */
  addIndex: (index: FlowIndex) => void;

  /** Load flow detail (with caching) */
  loadDetail: (id: string, forceRefresh?: boolean) => Promise<Flow | null>;

  /** Prefetch details for visible area */
  prefetchDetails: (ids: string[]) => void;

  /** Select flow */
  selectFlow: (id: string | null) => void;

  /** Clear local state only (for switching sessions) */
  clearLocal: () => void;

  /** Clear all data (local + remote) */
  clearAll: (sessionId?: string) => void;

  /** Alias for clearAll (legacy compatibility) */
  clearFlows: () => void;

  /** Get flow IDs (for compatibility) */
  getFlowIds: () => string[];

  /** Update intercepted flow */
  updateInterceptedFlow: (id: string, flow: Flow | null) => void;

  /** Get intercepted flows as array */
  getInterceptedFlows: () => Flow[];
}

// ==================== Store Implementation ====================

export const useTrafficStore = create<TrafficStore>((set, get) => ({
  // ========== Initial State ==========
  indices: [],
  detailCache: new Map(),
  cacheOrder: [],
  interceptedFlows: new Map(),
  selectedFlow: null,
  selectedLoading: false,
  filterText: "",
  setFilterText: (filterText) => set({ filterText }),
  config: {
    maxDetailCache: 100,
    prefetchCount: 10,
  },

  // ========== Actions ==========

  addIndices: (newIndices) => {
    set((state) => {
      if (newIndices.length === 0) return state;

      const indicesMap = new Map(state.indices.map((i) => [i.id, i]));
      const hasNewItems = newIndices.some((idx) => !indicesMap.has(idx.id));

      // Update or add items
      newIndices.forEach((idx) => {
        indicesMap.set(idx.id, idx);
      });

      let updatedIndices: FlowIndex[];

      if (hasNewItems) {
        // Sort by msg_ts (ascending) when new items are added
        updatedIndices = Array.from(indicesMap.values()).sort(
          (a, b) => (a.msg_ts || 0) - (b.msg_ts || 0),
        );
      } else {
        // No new items, just return updated values
        updatedIndices = Array.from(indicesMap.values());
      }

      // No limit - let database handle storage, frontend keeps all indices in memory
      // This is acceptable because indices are lightweight (only metadata)

      return { indices: updatedIndices };
    });
  },

  addIndex: (index) => {
    get().addIndices([index]);
  },

  loadDetail: async (id, forceRefresh = false) => {
    const { detailCache, cacheOrder, config } = get();

    // Check cache (unless force refresh)
    if (!forceRefresh && detailCache.has(id)) {
      const cachedFlow = detailCache.get(id)!;
      // Don't cache WebSocket flows - they need to be refreshed to show new frames
      if (!cachedFlow._rc?.isWebsocket) {
        // Update LRU order
        set({
          cacheOrder: [...cacheOrder.filter((x) => x !== id), id],
        });
        return cachedFlow;
      }
    }

    // Load from backend
    set({ selectedLoading: true });
    try {
      const flow = await fetchFlowDetail(id);
      if (flow) {
        // Don't cache WebSocket flows - they are dynamic and need fresh data
        if (flow._rc?.isWebsocket) {
          return flow;
        }

        // Add to cache for non-WebSocket flows
        set((state) => {
          const newCache = new Map(state.detailCache);
          const newOrder = [...state.cacheOrder, id];

          // LRU eviction
          while (newOrder.length > config.maxDetailCache) {
            const oldest = newOrder.shift()!;
            newCache.delete(oldest);
          }

          newCache.set(id, flow);

          return {
            detailCache: newCache,
            cacheOrder: newOrder,
          };
        });

        return get().detailCache.get(id) || null;
      }
      return null;
    } finally {
      set({ selectedLoading: false });
    }
  },

  prefetchDetails: async (ids) => {
    const { detailCache, config } = get();

    // Only prefetch if not already cached
    const toPrefetch = ids.filter((id) => !detailCache.has(id)).slice(0, config.prefetchCount);

    for (const id of toPrefetch) {
      await get().loadDetail(id);
    }
  },

  selectFlow: async (id) => {
    if (!id) {
      set({ selectedFlow: null });
      return;
    }

    set({ selectedLoading: true });
    const flow = await get().loadDetail(id);

    set({
      selectedFlow: flow,
      selectedLoading: false,
    });
  },

  clearLocal: () => {
    set({
      indices: [],
      detailCache: new Map(),
      cacheOrder: [],
      interceptedFlows: new Map(),
      selectedFlow: null,
    });
  },

  clearAll: async (sessionId?: string) => {
    // Use current viewed session if ID not provided
    const targetId = sessionId || useSessionStore.getState().showSessionId;
    if (!targetId) return;

    const { dbSessions } = useSessionStore.getState();
    const sessionToClear = dbSessions.find((s) => s.id === targetId);
    const isHistorical = sessionToClear && sessionToClear.is_active === 0;

    // Clear frontend state
    get().clearLocal();

    // Also clear backend database (of the specified session)
    const port = getBackendPort();
    try {
      const response = await tauriFetch(`http://127.0.0.1:${port}/_relay/session/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: targetId }),
        cache: "no-store",
      });

      if (response.ok && isHistorical) {
        // If it was a historical session, it's now deleted on backend
        // We need to refresh the session list and switch view
        await useSessionStore.getState().deleteDbSession(targetId);
      } else {
        // Just refresh counts for active session
        await useSessionStore.getState().fetchDbSessions();
      }
    } catch (err) {
      console.error("Failed to clear backend session:", err);
    }
  },

  clearFlows: () => {
    get().clearAll();
  },

  getFlowIds: () => {
    return get().indices.map((i) => i.id);
  },

  updateInterceptedFlow: (id, flow) => {
    set((state) => {
      const newMap = new Map(state.interceptedFlows);
      if (flow) {
        newMap.set(id, flow);
      } else {
        newMap.delete(id);
      }
      return { interceptedFlows: newMap };
    });
  },

  getInterceptedFlows: () => {
    return Array.from(get().interceptedFlows.values());
  },
}));
