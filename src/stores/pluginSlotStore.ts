import type React from "react";
import { create } from "zustand";

interface SlotRegistration {
  id: string;
  component: React.ComponentType<any>;
  pluginId: string;
}

interface PluginSlotStore {
  slots: Record<string, SlotRegistration[]>;
  registerComponent: (
    slotId: string,
    component: React.ComponentType<any>,
    pluginId: string,
  ) => void;
  unregisterPluginComponents: (pluginId: string) => void;
}

// Standard slots available for plugins
export const PLUGIN_SLOTS = {
  SIDEBAR_TOP: "sidebar-top",
  SIDEBAR_BOTTOM: "sidebar-bottom",
  STATUS_BAR_LEFT: "status-bar-left",
  STATUS_BAR_CENTER: "status-bar-center",
  STATUS_BAR_RIGHT: "status-bar-right",
  FLOW_DETAIL_TABS: "flow-detail-tabs",
  FLOW_DETAIL_ACTIONS: "flow-detail-actions",
} as const;

export type PluginSlotId = (typeof PLUGIN_SLOTS)[keyof typeof PLUGIN_SLOTS] | string;

export const usePluginSlotStore = create<PluginSlotStore>((set) => ({
  slots: {},

  registerComponent: (slotId, component, pluginId) => {
    set((state) => {
      const existing = state.slots[slotId] || [];
      // Prevent duplicate registration for the same plugin/slot
      if (existing.some((r) => r.pluginId === pluginId)) {
        return state;
      }
      return {
        slots: {
          ...state.slots,
          [slotId]: [...existing, { id: `${pluginId}-${slotId}`, component, pluginId }],
        },
      };
    });
  },

  unregisterPluginComponents: (pluginId) => {
    set((state) => {
      const newSlots = { ...state.slots };
      Object.keys(newSlots).forEach((slotId) => {
        newSlots[slotId] = newSlots[slotId].filter((r) => r.pluginId !== pluginId);
      });
      return { slots: newSlots };
    });
  },
}));
