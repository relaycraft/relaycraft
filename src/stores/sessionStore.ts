import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { Logger } from "../lib/logger";
import type { Session, SessionMetadata } from "../types/session";
import { useTrafficStore } from "./trafficStore";

interface SessionStore {
  currentSession: Session | null;
  loading: boolean;

  saveSession: (name: string, description?: string) => Promise<void>;
  loadSession: () => Promise<void>;
  exportHar: () => Promise<void>;
  importHar: () => Promise<void>;
  closeSession: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  currentSession: null,
  loading: false,

  saveSession: async (name, description) => {
    set({ loading: true });
    try {
      const flows = useTrafficStore.getState().flows;

      // Calculate metadata
      const metadata: SessionMetadata = {
        createdAt: Date.now(),
        duration: flows.length > 0 ? flows[flows.length - 1].timestamp - flows[0].timestamp : 0,
        flowCount: flows.length,
        sizeBytes: flows.reduce((acc, f) => acc + f.size, 0),
        clientInfo: navigator.userAgent,
      };

      const session: Session = {
        id: crypto.randomUUID(),
        name,
        description,
        metadata,
        flows,
      };

      const path = await save({
        filters: [
          {
            name: "RelayCraft Session",
            extensions: ["relay"],
          },
        ],
        defaultPath: `${name}.relay`,
      });

      if (path) {
        await invoke("save_session", { path, session });
        set({ currentSession: session });
      }
    } catch (error) {
      Logger.error("Failed to save session:", error);
    } finally {
      set({ loading: false });
    }
  },

  loadSession: async () => {
    set({ loading: true });
    try {
      const path = await open({
        filters: [
          {
            name: "RelayCraft Session",
            extensions: ["relay", "json"],
          },
        ],
        multiple: false,
      });

      if (path && typeof path === "string") {
        const session = await invoke<Session>("load_session", { path });

        // Update Traffic Store
        useTrafficStore.getState().setFlows(session.flows);

        set({ currentSession: session });
      }
    } catch (error) {
      Logger.error("Failed to load session:", error);
    } finally {
      set({ loading: false });
    }
  },

  exportHar: async () => {
    set({ loading: true });
    try {
      const flows = useTrafficStore.getState().flows;
      const path = await save({
        filters: [
          {
            name: "HTTP Archive",
            extensions: ["har"],
          },
        ],
        defaultPath: "traffic.har",
      });

      if (path) {
        await invoke("export_har", { path, flows });
      }
    } catch (error) {
      console.error("Failed to export HAR:", error);
    } finally {
      set({ loading: false });
    }
  },

  importHar: async () => {
    set({ loading: true });
    try {
      const path = await open({
        filters: [
          {
            name: "HTTP Archive",
            extensions: ["har"],
          },
        ],
        multiple: false,
      });

      if (path && typeof path === "string") {
        const flows = await invoke<any[]>("import_har", { path });
        useTrafficStore.getState().addFlows(flows);
        // Note: Importing HAR doesn't create a "Session" yet, just loads flows
        set({ currentSession: null });
      }
    } catch (error) {
      console.error("Failed to import HAR:", error);
    } finally {
      set({ loading: false });
    }
  },

  closeSession: () => {
    set({ currentSession: null });
    useTrafficStore.getState().clearFlows();
  },
}));
