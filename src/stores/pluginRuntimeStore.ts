import { create } from "zustand";

/**
 * Per-plugin UI load results for the current session, written by
 * `pluginLoader` and read by the plugin detail panel.
 */
export interface PluginLoadResult {
  status: "loaded" | "error";
  /** Error message when status is "error". */
  error?: string;
  /** Unix epoch millis of the last load attempt. */
  at: number;
}

interface PluginRuntimeStore {
  loadResults: Record<string, PluginLoadResult>;
  markLoaded: (id: string) => void;
  markError: (id: string, error: string) => void;
  clear: (id: string) => void;
  clearAll: () => void;
}

export const usePluginRuntimeStore = create<PluginRuntimeStore>((set) => ({
  loadResults: {},

  markLoaded: (id) =>
    set((state) => ({
      loadResults: {
        ...state.loadResults,
        [id]: { status: "loaded", at: Date.now() },
      },
    })),

  markError: (id, error) =>
    set((state) => ({
      loadResults: {
        ...state.loadResults,
        [id]: { status: "error", error, at: Date.now() },
      },
    })),

  clear: (id) =>
    set((state) => {
      if (!(id in state.loadResults)) return state;
      const loadResults = { ...state.loadResults };
      delete loadResults[id];
      return { loadResults };
    }),

  clearAll: () => set({ loadResults: {} }),
}));
