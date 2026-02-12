/**
 * Traffic Store - Memory Optimized Implementation
 *
 * This store manages HTTP traffic data with memory optimization:
 * - FlowIndex: Lightweight metadata always in memory
 * - FlowDetail: Full data loaded on demand with LRU cache
 *
 * Memory savings: ~95% reduction for large traffic volumes
 * @see src/types/flow.ts for type definitions
 */

import { create } from "zustand";
import { fetchFlowDetail } from "../lib/trafficMonitor";
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

  /** Intercepted flows - full data for breakpoint modal */
  interceptedFlows: Map<string, Flow>;

  /** Currently selected flow */
  selectedFlow: Flow | null;
  selectedLoading: boolean;

  /** Configuration */
  config: TrafficStoreConfig;

  /** Next sequence number for new flows */
  nextSeq: number;

  // ========== Actions ==========

  /** Add indices (from polling) */
  addIndices: (indices: FlowIndex[]) => void;

  /** Add single index */
  addIndex: (index: FlowIndex) => void;

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
  config: {
    maxIndices: 10000,
    maxDetailCache: 100,
    prefetchCount: 10,
  },
  nextSeq: 1,

  // ========== Actions ==========

  addIndices: (newIndices) => {
    set((state) => {
      if (newIndices.length === 0) return state;

      const indicesMap = new Map(state.indices.map((i) => [i.id, i]));
      const existingCount = indicesMap.size;
      let currentSeq = state.nextSeq;

      // Separate updates from new items
      const newItems: FlowIndex[] = [];

      newIndices.forEach((idx) => {
        const existing = indicesMap.get(idx.id);
        if (existing) {
          // Update in place, preserve seq (no sort needed for updates)
          indicesMap.set(idx.id, { ...idx, seq: existing.seq });
        } else {
          // New item
          const seq = idx.seq || currentSeq;
          newItems.push({ ...idx, seq });
          currentSeq = Math.max(currentSeq, seq + 1);
        }
      });

      // If no new items, just update existing ones (no sort needed)
      if (newItems.length === 0) {
        return {
          indices: Array.from(indicesMap.values()),
          nextSeq: currentSeq,
        };
      }

      // Check if new items can be simply appended (most common case)
      // New items are in order if all their seq >= last existing seq
      const lastSeq = state.indices.length > 0 ? state.indices[state.indices.length - 1].seq : 0;
      const allInOrder = newItems.every((item) => item.seq >= lastSeq);

      let updatedIndices: FlowIndex[];

      if (allInOrder && existingCount > 0) {
        // Fast path: just append new items (they're already in order)
        // Add new items to map
        for (const item of newItems) indicesMap.set(item.id, item);
        updatedIndices = [...state.indices, ...newItems];
      } else {
        // Slow path: need full sort (rare, e.g., out-of-order seq from backend)
        for (const item of newItems) indicesMap.set(item.id, item);
        updatedIndices = Array.from(indicesMap.values()).sort((a, b) => a.seq - b.seq);
      }

      // Enforce limit
      if (updatedIndices.length > state.config.maxIndices) {
        updatedIndices = updatedIndices.slice(-state.config.maxIndices);
      }

      return {
        indices: updatedIndices,
        nextSeq: currentSeq,
      };
    });
  },

  addIndex: (index) => {
    get().addIndices([index]);
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

    // Load from backend
    set({ selectedLoading: true });
    try {
      const flow = await fetchFlowDetail(id);
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
      interceptedFlows: new Map(),
      selectedFlow: null,
      nextSeq: 1,
    });
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
