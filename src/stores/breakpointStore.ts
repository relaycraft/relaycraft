import { create } from "zustand";

interface Breakpoint {
  id: string;
  pattern: string;
  enabled: boolean;
}

interface BreakpointState {
  breakpoints: Breakpoint[];
  interceptedFlowIds: string[];

  addBreakpoint: (pattern: string) => void;
  removeBreakpoint: (id: string) => void;
  setIntercepted: (flowIds: string[]) => void;
}

export const useBreakpointStore = create<BreakpointState>((set) => ({
  breakpoints: [],
  interceptedFlowIds: [],

  addBreakpoint: (pattern) =>
    set((state) => ({
      breakpoints: [
        ...state.breakpoints,
        { id: Math.random().toString(36).substr(2, 9), pattern, enabled: true },
      ],
    })),

  removeBreakpoint: (id) =>
    set((state) => ({
      breakpoints: state.breakpoints.filter((b) => b.id !== id),
    })),

  setIntercepted: (flowIds) => set({ interceptedFlowIds: flowIds }),
}));
