import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { create } from "zustand";
import { getBackendPort } from "../lib/traffic/portState";

export interface CaptureScope {
  include: string[];
  exclude: string[];
}

export interface RecentProcess {
  name: string;
  path?: string | null;
  pids?: number[];
  count?: number;
  lastSeen?: number;
}

interface CaptureScopeState {
  scope: CaptureScope;
  loaded: boolean;
  recentProcesses: RecentProcess[];
  load: () => Promise<void>;
  apply: (scope: CaptureScope) => Promise<CaptureScope>;
  loadRecentProcesses: () => Promise<void>;
}

const EMPTY_SCOPE: CaptureScope = { include: [], exclude: [] };

export const useCaptureScopeStore = create<CaptureScopeState>((set) => ({
  scope: EMPTY_SCOPE,
  loaded: false,
  recentProcesses: [],

  load: async () => {
    try {
      const scope = await invoke<CaptureScope>("get_capture_scope");
      set({ scope, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  apply: async (scope) => {
    try {
      const normalized = await invoke<CaptureScope>("set_capture_scope", { scope });
      set({ scope: normalized });
      return normalized;
    } catch (e) {
      // Host may have reverted its stored scope; resync so the UI never
      // displays a scope the engine isn't actually applying.
      try {
        const current = await invoke<CaptureScope>("get_capture_scope");
        set({ scope: current });
      } catch {
        /* keep previous display state */
      }
      throw e;
    }
  },

  loadRecentProcesses: async () => {
    try {
      const url = `http://127.0.0.1:${getBackendPort()}/_relay/processes`;
      const res = await tauriFetch(url, { method: "GET" });
      if (!res.ok) {
        set({ recentProcesses: [] });
        return;
      }
      const data = (await res.json()) as { processes?: RecentProcess[] };
      set({ recentProcesses: data.processes ?? [] });
    } catch {
      set({ recentProcesses: [] });
    }
  },
}));

export function isCaptureScopeEnabled(scope: CaptureScope): boolean {
  return scope.include.length > 0 || scope.exclude.length > 0;
}
