import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";

export interface Breakpoint {
  id: string;
  pattern: string;
  matchType: "contains" | "exact" | "regex";
  breakOnRequest: boolean;
  breakOnResponse: boolean;
  enabled: boolean;
}

interface BreakpointState {
  breakpoints: Breakpoint[];
  interceptedFlowIds: string[];

  addBreakpoint: (bp: Omit<Breakpoint, "id" | "enabled">) => Promise<void>;
  removeBreakpoint: (id: string) => Promise<void>;
  toggleBreakpoint: (id: string) => void;
  clearBreakpoints: () => Promise<void>;
  setIntercepted: (flowIds: string[]) => void;
}

export const useBreakpointStore = create<BreakpointState>((set) => ({
  breakpoints: [],
  interceptedFlowIds: [],

  addBreakpoint: async (bp) => {
    const newBreakpoint: Breakpoint = {
      ...bp,
      id: crypto.randomUUID(),
      enabled: true,
    };

    try {
      const { config } = useSettingsStore.getState();
      await fetch(`http://127.0.0.1:${config.proxy_port}/_relay/breakpoints`, {
        method: "POST",
        body: JSON.stringify({
          action: "add",
          rule: {
            id: newBreakpoint.id,
            pattern: newBreakpoint.pattern,
            matchType: newBreakpoint.matchType,
            breakOnRequest: newBreakpoint.breakOnRequest,
            breakOnResponse: newBreakpoint.breakOnResponse,
            enabled: true,
          },
        }),
        cache: "no-store",
      });
    } catch (e) {
      console.error("Failed to add breakpoint to backend", e);
    }

    set((state) => ({
      breakpoints: [...state.breakpoints, newBreakpoint],
    }));
  },

  removeBreakpoint: async (id) => {
    try {
      const { config } = useSettingsStore.getState();
      await fetch(`http://127.0.0.1:${config.proxy_port}/_relay/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "remove", id }),
        cache: "no-store",
      });
    } catch (e) {
      console.error("Failed to remove breakpoint from backend", e);
    }

    set((state) => ({
      breakpoints: state.breakpoints.filter((b) => b.id !== id),
    }));
  },

  toggleBreakpoint: (id) => {
    set((state) => ({
      breakpoints: state.breakpoints.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b)),
    }));
  },

  clearBreakpoints: async () => {
    try {
      const { config } = useSettingsStore.getState();
      await fetch(`http://127.0.0.1:${config.proxy_port}/_relay/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "clear" }),
        cache: "no-store",
      });
    } catch (e) {
      console.error("Failed to clear breakpoints from backend", e);
    }

    set({ breakpoints: [] });
  },

  setIntercepted: (flowIds) => set({ interceptedFlowIds: flowIds }),
}));
