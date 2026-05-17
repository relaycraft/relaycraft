import { create } from "zustand";

export interface McpActivity {
  id: string;
  timestamp: number;
  toolName: string;
  phase: "started" | "completed" | "failed";
  durationMs?: number;
  status: "success" | "error" | "unauthorized";
  argumentSummary?: string;
  resultSummary?: string;
  relatedFlowId?: string;
  relatedRuleId?: string;
  intent?: string;
  errorMessage?: string;
  clientName?: string; // e.g. "Cursor", "Claude Desktop"
}

interface McpActivityStore {
  activities: McpActivity[];
  maxActivities: number;
  addActivity: (activity: McpActivity) => void;
  clearActivities: () => void;
}

export const useMcpActivityStore = create<McpActivityStore>((set) => ({
  activities: [],
  maxActivities: 100, // Keep last 100 activities

  addActivity: (activity) => {
    set((state) => {
      // Find if we already have an activity with this ID (e.g. started -> completed)
      const existingIndex = state.activities.findIndex((a) => a.id === activity.id);

      let newActivities: McpActivity[];
      if (existingIndex >= 0) {
        // Update existing
        newActivities = [...state.activities];
        newActivities[existingIndex] = { ...newActivities[existingIndex], ...activity };
      } else {
        // Add new to the beginning
        newActivities = [activity, ...state.activities];
      }

      // Limit array size
      if (newActivities.length > state.maxActivities) {
        newActivities = newActivities.slice(0, state.maxActivities);
      }

      return { activities: newActivities };
    });
  },

  clearActivities: () => set({ activities: [] }),
}));
