import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { create } from "zustand";
import { Logger } from "../lib/logger";
import { setPollTimestamp } from "../lib/trafficMonitor";
import type { Session, SessionMetadata } from "../types/session";
import { useSettingsStore } from "./settingsStore";
import { useTrafficStore } from "./trafficStore";

// Database session type (from backend)
export interface DbSession {
  id: string;
  name: string;
  description?: string;
  created_at: number;
  updated_at: number;
  flow_count: number;
  total_size: number;
  is_active: number;
}

interface SessionStore {
  currentSession: Session | null;
  loading: boolean;
  // Database sessions
  dbSessions: DbSession[];
  showSessionId: string | null; // Which session to display (can be different from writing session)
  loadingSessions: boolean;

  saveSession: (name: string, description?: string) => Promise<void>;
  loadSession: () => Promise<void>;
  exportHar: () => Promise<void>;
  importHar: () => Promise<void>;
  closeSession: () => void;
  // Database session management
  fetchDbSessions: () => Promise<void>;
  switchDbSession: (sessionId: string) => Promise<void>;
  deleteDbSession: (sessionId: string) => Promise<void>;
  deleteAllDbSessions: () => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  currentSession: null,
  loading: false,
  // Database sessions
  dbSessions: [],
  showSessionId: null, // Initially null, will be set to writing session on first fetch
  loadingSessions: false,

  // Fetch database sessions from backend
  fetchDbSessions: async () => {
    // Only show loading for the very first fetch
    if (get().dbSessions.length === 0) {
      set({ loadingSessions: true });
    }
    try {
      const port = useSettingsStore.getState().config.proxy_port;
      const response = await tauriFetch(`http://127.0.0.1:${port}/_relay/sessions`, {
        cache: "no-store",
      });
      if (response.ok) {
        const sessions: DbSession[] = await response.json();

        // Only update state if data actually changed
        const currentSessions = get().dbSessions;
        const hasChanged = JSON.stringify(sessions) !== JSON.stringify(currentSessions);

        if (hasChanged) {
          const currentShowId = get().showSessionId;
          // If no current selection, don't auto-set it on initial load
          const newShowId = currentShowId || null;

          set({
            dbSessions: sessions,
            showSessionId: newShowId,
          });
        }
      }
    } catch (error) {
      Logger.error("Failed to fetch sessions:", error);
    } finally {
      // Only reset loading if it was actually loading
      if (get().loadingSessions) {
        set({ loadingSessions: false });
      }
    }
  },

  // Switch to a different database session (view only, backend continues writing to active session)
  switchDbSession: async (sessionId: string) => {
    set({ loading: true });
    try {
      const port = useSettingsStore.getState().config.proxy_port;

      // Load the session data for viewing
      const response = await tauriFetch(
        `http://127.0.0.1:${port}/_relay/poll?session_id=${sessionId}&since=0`,
        {
          cache: "no-store",
        },
      );

      if (response.ok) {
        const data = await response.json();
        // Clear frontend data and load session indices
        useTrafficStore.getState().clearLocal();
        if (data.indices && data.indices.length > 0) {
          useTrafficStore.getState().addIndices(data.indices);
        }
        // Update which session we're viewing
        set({ showSessionId: sessionId });

        // Reset poll monitor timestamp
        setPollTimestamp(0);

        Logger.info(`Switched to view session: ${sessionId}`);
      }

      // Re-fetch session list
      get().fetchDbSessions();
    } catch (error) {
      Logger.error("Failed to switch session:", error);
    } finally {
      set({ loading: false });
    }
  },

  // Delete a database session
  deleteDbSession: async (sessionId: string) => {
    try {
      const port = useSettingsStore.getState().config.proxy_port;
      const response = await tauriFetch(`http://127.0.0.1:${port}/_relay/session/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId }),
        cache: "no-store",
      });

      if (response.ok) {
        // Switch to nearest session if viewing the deleted one
        if (get().showSessionId === sessionId) {
          const sessions = get().dbSessions;
          const index = sessions.findIndex((s) => s.id === sessionId);
          // Find next, previous, or null session
          const nextSession = sessions[index + 1] || sessions[index - 1] || null;
          if (nextSession) {
            await get().switchDbSession(nextSession.id);
          } else {
            set({ showSessionId: null });
          }
        }

        // Remove from local list
        set((state) => ({
          dbSessions: state.dbSessions.filter((s) => s.id !== sessionId),
        }));
      }
    } catch (error) {
      Logger.error("Failed to delete session:", error);
    }
  },

  // Delete all historical sessions
  deleteAllDbSessions: async () => {
    set({ loadingSessions: true });
    try {
      const port = useSettingsStore.getState().config.proxy_port;
      Logger.info("Requesting clearance of all historical sessions...");
      const response = await tauriFetch(`http://127.0.0.1:${port}/_relay/sessions/delete_all`, {
        method: "POST",
        cache: "no-store",
      });

      if (response.ok) {
        const data = await response.json();
        Logger.info(`All historical sessions cleared. Count: ${data.count || 0}`);

        // Refresh session list
        await get().fetchDbSessions();

        // Switch to active session or ensure selection
        const sessions = get().dbSessions;
        const currentShowId = get().showSessionId;
        const stillExists = sessions.some((s) => s.id === currentShowId);

        if (!stillExists && sessions.length > 0) {
          // Find the active session, or just the first one
          const activeSession = sessions.find((s) => s.is_active === 1) || sessions[0];
          // Clear and re-poll traffic store
          await get().switchDbSession(activeSession.id);
        } else if (sessions.length === 0) {
          set({ showSessionId: null });
          useTrafficStore.getState().clearLocal();
        }

        const { notify } = await import("../lib/notify");
        // We can't use the hook here, so we'll import i18next directly
        const i18next = await import("i18next");
        notify.success(
          i18next.t("session.all_cleared", {
            defaultValue: "All historical sessions have been cleared",
          }),
        );
      } else {
        const errorText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errorText}`);
      }
    } catch (error) {
      Logger.error("Failed to clear historical sessions:", error);
      const { notify } = await import("../lib/notify");
      const i18next = await import("i18next");
      notify.error(
        i18next.t("session.clear_error", { defaultValue: "Failed to clear historical sessions" }),
      );
    } finally {
      set({ loadingSessions: false });
    }
  },

  saveSession: async (name, description) => {
    set({ loading: true });
    try {
      // Ask for file path
      const path = await save({
        filters: [
          {
            name: "RelayCraft Session",
            extensions: ["relay"],
          },
        ],
        defaultPath: `${name}.relay`,
      });

      if (!path) {
        set({ loading: false });
        return;
      }

      // Calculate metadata from indices
      const indices = useTrafficStore.getState().indices;
      const metadata: SessionMetadata = {
        createdAt: Date.now(),
        duration:
          indices.length > 0
            ? new Date(indices[indices.length - 1].startedDateTime).getTime() -
              new Date(indices[0].startedDateTime).getTime()
            : 0,
        flowCount: indices.length,
        sizeBytes: indices.reduce((acc, idx) => acc + (idx.size || 0), 0),
        clientInfo: navigator.userAgent,
      };

      // Send metadata to backend to write file
      const port = useSettingsStore.getState().config.proxy_port;
      const sessionId = get().showSessionId;
      const url = new URL(`http://127.0.0.1:${port}/_relay/export_session`);
      url.searchParams.append("path", path); // fetch handles encoding
      if (sessionId) {
        url.searchParams.append("session_id", sessionId);
      }

      const response = await tauriFetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name,
          description,
          metadata,
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to export session from backend");
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error("Export failed");
      }

      // Update current session
      const session: Session = {
        id: crypto.randomUUID(),
        name,
        description,
        metadata,
        flows: [], // Flows are not in memory
      };
      set({ currentSession: session });
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
        Logger.info(`Loading session from: ${path}`);

        const session = await invoke<Session>("load_session", { path });
        Logger.info(`Session loaded: ${session.id}, flows count: ${session.flows?.length || 0}`);

        // Send session data to backend
        const port = useSettingsStore.getState().config.proxy_port;
        Logger.info(`Sending flows to backend at port ${port}...`);

        const response = await tauriFetch(`http://127.0.0.1:${port}/_relay/import_session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: session.id,
            name: session.name,
            description: session.description,
            metadata: session.metadata,
            flows: session.flows,
          }),
          cache: "no-store",
        });

        Logger.info(`Import session response: ${response.status}`);

        if (response.ok) {
          const data = await response.json();
          const { session_id, indices } = data;

          Logger.info(
            `Session imported: session_id=${session_id}, indices count=${indices?.length || 0}`,
          );

          // Clear local state and set imported indices
          useTrafficStore.getState().clearLocal();
          useTrafficStore.getState().addIndices(indices);

          // Switch to the imported session (it's a historical session)
          if (session_id) {
            set({ showSessionId: session_id });
            await get().fetchDbSessions();
          }
        } else {
          const errorText = await response.text();
          Logger.error(`Session import failed: ${response.status} - ${errorText}`);
        }
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
      // Generate filename with timestamp
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const defaultFilename = `har-${year}-${month}-${day}-${hours}-${minutes}-${seconds}.har`;

      // Ask user for file path first
      const path = await save({
        filters: [
          {
            name: "HTTP Archive",
            extensions: ["har"],
          },
        ],
        defaultPath: defaultFilename,
      });

      if (!path) {
        set({ loading: false });
        return;
      }

      // Request backend to export HAR to file
      const port = useSettingsStore.getState().config.proxy_port;
      const sessionId = get().showSessionId;
      const url = new URL(`http://127.0.0.1:${port}/_relay/export_har`);
      url.searchParams.append("path", path);
      if (sessionId) {
        url.searchParams.append("session_id", sessionId);
      }

      const response = await tauriFetch(url.toString(), {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to export HAR from backend");
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error("Export failed");
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
        Logger.info(`Importing HAR from: ${path}`);

        // Read HAR file content
        const harContent = await readTextFile(path);
        const harData = JSON.parse(harContent);

        Logger.info(`HAR file parsed, entries count: ${harData?.log?.entries?.length || 0}`);

        // Send to backend for processing
        const port = useSettingsStore.getState().config.proxy_port;
        Logger.info(`Sending HAR to backend at port ${port}...`);

        const response = await tauriFetch(`http://127.0.0.1:${port}/_relay/import_har`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(harData),
          cache: "no-store",
        });

        Logger.info(`HAR import response status: ${response.status}`);

        if (response.ok) {
          const data = await response.json();
          const { session_id, indices } = data;

          Logger.info(
            `HAR imported: session_id=${session_id}, indices count=${indices?.length || 0}`,
          );

          // Add indices to traffic store (for immediate view)
          useTrafficStore.getState().addIndices(indices);

          // Update showSessionId to the new session
          if (session_id) {
            set({ showSessionId: session_id });
            // Refresh session list to include the newly created one
            await get().fetchDbSessions();
            Logger.info(`Imported HAR into new session: ${session_id}`);
          }
        } else {
          const errorText = await response.text();
          Logger.error(`HAR import failed: ${response.status} - ${errorText}`);
        }
      }
    } catch (error) {
      Logger.error("Failed to import HAR:", error);
    } finally {
      set({ loading: false });
    }
  },

  closeSession: () => {
    set({ currentSession: null });
    useTrafficStore.getState().clearFlows();
  },
}));
