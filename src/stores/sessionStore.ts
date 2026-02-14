import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { Logger } from "../lib/logger";
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
      const response = await fetch(`http://127.0.0.1:${port}/_relay/sessions`, {
        cache: "no-store",
      });
      if (response.ok) {
        const sessions: DbSession[] = await response.json();
        const currentShowId = get().showSessionId;

        // If no current selection, don't auto-set it on initial load
        // This avoids showing a session ID when the traffic list is empty
        const newShowId = currentShowId || null;

        set({
          dbSessions: sessions,
          showSessionId: newShowId,
        });
      }
    } catch (error) {
      Logger.error("Failed to fetch sessions:", error);
    } finally {
      set({ loadingSessions: false });
    }
  },

  // Switch to a different database session (view only, backend continues writing to active session)
  switchDbSession: async (sessionId: string) => {
    set({ loading: true });
    try {
      const port = useSettingsStore.getState().config.proxy_port;

      // Load the session data for viewing
      const response = await fetch(
        `http://127.0.0.1:${port}/_relay/poll?session_id=${sessionId}&since=0`,
        {
          cache: "no-store",
        },
      );

      if (response.ok) {
        const data = await response.json();
        // Clear frontend data and load session indices
        // Use clearLocal instead of clearAll to avoid deleting backend data!
        useTrafficStore.getState().clearLocal();
        if (data.indices && data.indices.length > 0) {
          useTrafficStore.getState().addIndices(data.indices);
        }
        // Update which session we're viewing
        set({ showSessionId: sessionId });
        Logger.info(`Switched to view session: ${sessionId}`);
      }

      // Re-fetch session list to update counts
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
      const response = await fetch(`http://127.0.0.1:${port}/_relay/session/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId }),
        cache: "no-store",
      });

      if (response.ok) {
        // If we were viewing the deleted session, switch to the nearest one
        if (get().showSessionId === sessionId) {
          const sessions = get().dbSessions;
          const index = sessions.findIndex((s) => s.id === sessionId);
          // Try to find next session, or previous, or null
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

  saveSession: async (name, description) => {
    set({ loading: true });
    try {
      // Ask user for file path first
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

      // Calculate metadata from indices (lightweight)
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

      // Send metadata to backend and let it write directly to file
      const port = useSettingsStore.getState().config.proxy_port;
      const encodedPath = encodeURIComponent(path);
      const response = await fetch(
        `http://127.0.0.1:${port}/_relay/export_session?path=${encodedPath}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            description,
            metadata,
          }),
          cache: "no-store",
        },
      );

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
        flows: [], // Flows are in the file, not in memory
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
        const session = await invoke<Session>("load_session", { path });

        // Send flows to backend and update indices in frontend
        const port = useSettingsStore.getState().config.proxy_port;
        await fetch(`http://127.0.0.1:${port}/_relay/import_session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(session.flows),
          cache: "no-store",
        });

        // Convert flows to indices for frontend
        const indices = session.flows.map((f: any, idx: number) => ({
          id: f.id,
          seq: idx + 1,
          method: f.request?.method || "",
          url: f.request?.url || "",
          host: new URL(f.request?.url || "http://localhost").host,
          path: new URL(f.request?.url || "http://localhost").pathname,
          status: f.response?.status || 0,
          contentType: f.response?.content?.mimeType || "",
          startedDateTime: f.startedDateTime || new Date().toISOString(),
          time: f.time || 0,
          size: (f.request?.bodySize || 0) + (f.response?.bodySize || 0),
          hasError: !!f._rc?.error,
          hasRequestBody: (f.request?.bodySize || 0) > 0,
          hasResponseBody: (f.response?.bodySize || 0) > 0,
          isWebsocket: false,
          websocketFrameCount: 0,
          isIntercepted: false,
          hits: (f._rc?.hits || []).map((h: any) => ({
            id: h.id,
            name: h.name,
            type: h.type,
            status: h.status,
          })),
        }));

        useTrafficStore.getState().addIndices(indices);
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
      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const defaultFilename = `traffic-${timestamp}.har`;

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

      // Request backend to export HAR directly to file (avoids memory issues with large exports)
      const port = useSettingsStore.getState().config.proxy_port;
      const encodedPath = encodeURIComponent(path);
      const response = await fetch(
        `http://127.0.0.1:${port}/_relay/export_har?path=${encodedPath}`,
        {
          cache: "no-store",
        },
      );

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
        // Read HAR file content using Tauri fs plugin
        const harContent = await readTextFile(path);
        const harData = JSON.parse(harContent);

        // Send to backend for processing
        const port = useSettingsStore.getState().config.proxy_port;
        const response = await fetch(`http://127.0.0.1:${port}/_relay/import_har`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(harData),
          cache: "no-store",
        });

        if (response.ok) {
          const indices = await response.json();
          useTrafficStore.getState().addIndices(indices);
        }
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
