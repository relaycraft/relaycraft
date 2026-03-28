import type { ComponentType } from "react";
import { create } from "zustand";

/**
 * A lightweight summary of the flow passed to plugin context menu callbacks.
 * Intentionally minimal — full flow details stay internal to the host.
 * This type is also exported from src/types/plugin.ts for plugin authors.
 */
export interface TrafficFlowSummary {
  method: string;
  url: string;
  /** Flat header map (first value wins on duplicate names). */
  headers: Record<string, string>;
  body: string | null;
}

export interface PluginContextMenuEntry {
  pluginId: string;
  itemId: string;
  label: string | (() => string);
  icon?: ComponentType<{ className?: string }>;
  /** When returning false the menu item is hidden for this flow. */
  when?: (flow: TrafficFlowSummary) => boolean;
  onClick: (flow: TrafficFlowSummary) => void;
}

interface PluginContextMenuStore {
  items: PluginContextMenuEntry[];
  /**
   * Register a context menu entry.
   * Returns an unregister function — call it when the plugin unloads.
   */
  register: (entry: PluginContextMenuEntry) => () => void;
  /** Remove all context menu entries registered by a given plugin. */
  unregisterPlugin: (pluginId: string) => void;
}

export const usePluginContextMenuStore = create<PluginContextMenuStore>((set) => ({
  items: [],
  register: (entry) => {
    set((s) => ({ items: [...s.items, entry] }));
    return () =>
      set((s) => ({
        items: s.items.filter((i) => !(i.pluginId === entry.pluginId && i.itemId === entry.itemId)),
      }));
  },
  unregisterPlugin: (pluginId) => {
    set((s) => ({ items: s.items.filter((i) => i.pluginId !== pluginId) }));
  },
}));
