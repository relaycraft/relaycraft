import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { Logger } from "../lib/logger";

export interface ScriptInfo {
  name: string;
  enabled: boolean;
  path: string;
}

interface ScriptStore {
  version: number; // Incremented on any change, used for efficient subscription
  scripts: ScriptInfo[];
  selectedScript: string | null;
  loading: boolean;
  isCreating: boolean;
  draftScript: { name: string; content: string } | null;
  modifiedSinceStart: Set<string>; // Scripts modified since last engine start

  // Actions
  fetchScripts: () => Promise<void>;
  selectScript: (name: string | null) => void;
  setIsCreating: (isCreating: boolean) => void;
  setDraftScript: (draft: { name: string; content: string } | null) => void;
  clearModifiedSinceStart: () => void; // Called when engine restarts

  // Backend Operations
  getScriptContent: (name: string) => Promise<string>;
  saveScript: (name: string, content: string) => Promise<void>;
  deleteScript: (name: string) => Promise<void>;
  toggleScript: (name: string, enabled: boolean) => Promise<void>;
  renameScript: (oldName: string, newName: string) => Promise<void>;
  moveScript: (name: string, direction: "up" | "down") => Promise<void>;
}

export const useScriptStore = create<ScriptStore>((set, get) => ({
  version: 0,
  scripts: [],
  selectedScript: null,
  loading: false,
  isCreating: false,
  draftScript: null,
  modifiedSinceStart: new Set<string>(),

  setIsCreating: (isCreating) => set({ isCreating }),
  setDraftScript: (draft) =>
    set({
      draftScript: draft,
      selectedScript: draft ? null : get().selectedScript,
    }),

  clearModifiedSinceStart: () => set({ modifiedSinceStart: new Set<string>() }),

  fetchScripts: async () => {
    set({ loading: true });
    try {
      const scripts = await invoke<ScriptInfo[]>("list_scripts");
      set((state) => ({ version: state.version + 1, scripts }));
    } catch (error) {
      console.error("Failed to fetch scripts:", error);
    } finally {
      set({ loading: false });
    }
  },

  selectScript: (name: string | null) => {
    set({ selectedScript: name, draftScript: null });
  },

  getScriptContent: async (name: string) => {
    try {
      return await invoke<string>("get_script_content", { name });
    } catch (error) {
      console.error(`Failed to get script content for ${name}:`, error);
      throw error;
    }
  },

  saveScript: async (name: string, content: string) => {
    set({ loading: true });
    try {
      await invoke("save_script", { name, content });
      await get().fetchScripts();
      // If it was a draft being saved for the first time
      if (get().draftScript && get().draftScript?.name === name) {
        set({ draftScript: null, selectedScript: name });
      }
      // Mark as modified if engine is running and script is enabled
      const { useProxyStore } = await import("./proxyStore");
      const proxyState = useProxyStore.getState();
      const script = get().scripts.find((s) => s.name === name);
      if (proxyState.running && script?.enabled) {
        const newSet = new Set(get().modifiedSinceStart);
        newSet.add(name);
        set({ modifiedSinceStart: newSet });
      }
    } catch (error) {
      Logger.error(`Failed to save script ${name}:`, error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  renameScript: async (oldName: string, newName: string) => {
    set({ loading: true });
    try {
      // Mark as modified if engine is running and script was active
      const { useProxyStore } = await import("./proxyStore");
      const proxyState = useProxyStore.getState();
      const isScriptActive = proxyState.activeScripts.includes(oldName);

      await invoke("rename_script", { oldName, newName });

      if (proxyState.running && isScriptActive) {
        const newSet = new Set(get().modifiedSinceStart);
        newSet.add(oldName);
        newSet.add(newName);
        set({ modifiedSinceStart: newSet });
      }

      if (get().selectedScript === oldName) {
        set({ selectedScript: newName });
      }
      await get().fetchScripts();
    } catch (error) {
      console.error(`Failed to rename script ${oldName} to ${newName}:`, error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deleteScript: async (name: string) => {
    set({ loading: true });
    try {
      // Mark as modified if engine is running and script was active
      const { useProxyStore } = await import("./proxyStore");
      const proxyState = useProxyStore.getState();
      const isScriptActive = proxyState.activeScripts.includes(name);

      await invoke("delete_script", { name });

      if (proxyState.running && isScriptActive) {
        const newSet = new Set(get().modifiedSinceStart);
        newSet.add(name);
        set({ modifiedSinceStart: newSet });
      }

      if (get().selectedScript === name) {
        set({ selectedScript: null });
      }
      await get().fetchScripts();
    } catch (error) {
      Logger.error(`Failed to delete script ${name}:`, error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  toggleScript: async (name: string, enabled: boolean) => {
    // Optimistic update
    set((state) => ({
      version: state.version + 1,
      scripts: state.scripts.map((s) => (s.name === name ? { ...s, enabled } : s)),
    }));

    try {
      await invoke("set_script_enabled", { name, enabled });

      // Mark as modified if engine is running
      // (Any toggle while running requires restart to sync with backend state)
      const { useProxyStore } = await import("./proxyStore");
      const proxyState = useProxyStore.getState();
      if (proxyState.running) {
        const newSet = new Set(get().modifiedSinceStart);
        newSet.add(name);
        set({ modifiedSinceStart: newSet });
      }
    } catch (error) {
      console.error(`Failed to toggle script ${name}:`, error);
      // Revert on error
      await get().fetchScripts();
    }
  },

  moveScript: async (name: string, direction: "up" | "down") => {
    try {
      await invoke("move_script", { name, direction });
      await get().fetchScripts();
    } catch (error) {
      console.error(`Failed to move script ${name}:`, error);
    }
  },
}));
