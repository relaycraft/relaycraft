/**
 * Traffic Store - HAR-Compatible Implementation
 *
 * This store manages HTTP traffic data with memory optimization:
 * - FlowIndex: Lightweight metadata always in memory
 * - FlowDetail: Full data loaded on demand with LRU cache
 *
 * @see src/types/flow.ts for type definitions
 */

import { create } from "zustand";
import type { Flow, FlowIndex } from "../types";

// ==================== Type Definitions ====================

interface TrafficStoreConfig {
  maxIndices: number; // Maximum flow indices in memory (default: 10000)
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

  /** All flows (full data) */
  flows: Flow[];

  /** Currently selected flow */
  selectedFlow: Flow | null;
  selectedLoading: boolean;

  /** Configuration */
  config: TrafficStoreConfig;

  /** Next sequence number for new flows */
  nextSeq: number;

  // ========== Actions ==========

  /** Add flow */
  addFlow: (flow: Flow) => void;

  /** Add multiple flows */
  addFlows: (flows: Flow[]) => void;

  /** Load flow detail (with caching) */
  loadDetail: (id: string) => Promise<Flow | null>;

  /** Prefetch details for visible area */
  prefetchDetails: (ids: string[]) => void;

  /** Select flow */
  selectFlow: (id: string | null) => void;

  /** Clear all data */
  clearAll: () => void;

  /** Alias for clearAll */
  clearFlows: () => void;

  /** Set all flows */
  setFlows: (flows: Flow[]) => void;
}

// ==================== Helper Functions ====================

/**
 * Convert Flow to FlowIndex
 */
function flowToIndex(flow: Flow): FlowIndex {
  const url = new URL(flow.request.url);
  return {
    id: flow.id,
    seq: flow.seq,
    method: flow.request.method,
    url: flow.request.url,
    host: flow.request._parsedUrl?.host || url.host,
    path: flow.request._parsedUrl?.path || url.pathname,
    status: flow.response.status,
    contentType: flow.response.content.mimeType,
    startedDateTime: flow.startedDateTime,
    time: flow.time,
    size: flow.response.content.size,
    hasError: !!flow._rc.error,
    hasRequestBody: !!flow.request.postData?.text,
    hasResponseBody: !!flow.response.content.text,
    isWebsocket: flow._rc.isWebsocket,
    websocketFrameCount: flow._rc.websocketFrameCount,
    hitCount: flow._rc.hits.length,
  };
}

// ==================== Store Implementation ====================

export const useTrafficStore = create<TrafficStore>((set, get) => ({
  // ========== Initial State ==========
  indices: [],
  detailCache: new Map(),
  cacheOrder: [],
  flows: [],
  selectedFlow: null,
  selectedLoading: false,
  config: {
    maxIndices: 10000,
    maxDetailCache: 100,
    prefetchCount: 10,
  },
  nextSeq: 1,

  // ========== Actions ==========

  addFlow: (flow) => {
    const index = flowToIndex(flow);
    set((state) => {
      const existingIndex = state.flows.findIndex((f) => f.id === flow.id);
      if (existingIndex >= 0) {
        // Update existing - preserve the original seq
        const existingSeq = state.flows[existingIndex].seq;
        const newFlows = [...state.flows];
        newFlows[existingIndex] = { ...flow, seq: existingSeq };

        const newIndices = [...state.indices];
        const idxIndex = newIndices.findIndex((i) => i.id === flow.id);
        if (idxIndex >= 0) {
          newIndices[idxIndex] = { ...index, seq: existingSeq };
        }

        return {
          flows: newFlows,
          indices: newIndices,
          selectedFlow:
            state.selectedFlow?.id === flow.id ? { ...flow, seq: existingSeq } : state.selectedFlow,
        };
      }

      // Add new
      const newFlow = { ...flow, seq: state.nextSeq };
      const newFlows = [...state.flows, newFlow];
      const newIndices = [...state.indices, { ...index, seq: state.nextSeq }];

      // Enforce limit
      if (newFlows.length > state.config.maxIndices + 100) {
        return {
          flows: newFlows.slice(-state.config.maxIndices),
          indices: newIndices.slice(-state.config.maxIndices),
          nextSeq: state.nextSeq + 1,
        };
      }

      return {
        flows: newFlows,
        indices: newIndices,
        nextSeq: state.nextSeq + 1,
      };
    });
  },

  addFlows: (newFlowsList) => {
    set((state) => {
      const flowsMap = new Map(state.flows.map((f) => [f.id, f]));
      const indicesMap = new Map(state.indices.map((i) => [i.id, i]));
      let currentSeq = state.nextSeq;

      newFlowsList.forEach((flow) => {
        const index = flowToIndex(flow);
        const existing = flowsMap.get(flow.id);
        if (existing) {
          // Preserve the original seq when updating
          flowsMap.set(flow.id, { ...existing, ...flow, seq: existing.seq });
          indicesMap.set(flow.id, { ...index, seq: existing.seq });
        } else {
          flowsMap.set(flow.id, { ...flow, seq: currentSeq });
          indicesMap.set(flow.id, { ...index, seq: currentSeq });
          currentSeq++;
        }
      });

      let updatedFlows = Array.from(flowsMap.values()).sort((a, b) => a.seq - b.seq);
      let updatedIndices = Array.from(indicesMap.values()).sort((a, b) => a.seq - b.seq);

      // Enforce limit
      if (updatedFlows.length > state.config.maxIndices) {
        updatedFlows = updatedFlows.slice(-state.config.maxIndices);
        updatedIndices = updatedIndices.slice(-state.config.maxIndices);
      }

      return {
        flows: updatedFlows,
        indices: updatedIndices,
        nextSeq: currentSeq,
      };
    });
  },

  loadDetail: async (id) => {
    const { detailCache, cacheOrder, config } = get();

    // Check cache
    if (detailCache.has(id)) {
      // Update LRU order
      set({
        cacheOrder: [...cacheOrder.filter((x) => x !== id), id],
      });
      return detailCache.get(id)!;
    }

    // Load from flows
    set({ selectedLoading: true });
    try {
      const flow = get().flows.find((f) => f.id === id);
      if (flow) {
        // Add to cache
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

  clearAll: () => {
    set({
      indices: [],
      detailCache: new Map(),
      cacheOrder: [],
      flows: [],
      selectedFlow: null,
      nextSeq: 1,
    });
  },

  clearFlows: () => {
    get().clearAll();
  },

  setFlows: (newFlows) => {
    set(() => {
      let maxSeq = 0;

      const parsedFlows = newFlows.map((f, i) => {
        const seq = f.seq || i + 1;
        if (seq > maxSeq) maxSeq = seq;

        return {
          flow: { ...f, seq },
          index: flowToIndex({ ...f, seq }),
        };
      });

      return {
        flows: parsedFlows.map((p) => p.flow),
        indices: parsedFlows.map((p) => p.index),
        selectedFlow: null,
        nextSeq: maxSeq + 1,
      };
    });
  },
}));
