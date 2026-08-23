import { open, save } from "@tauri-apps/plugin-dialog";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "../lib/notify";
import { startImportPolling } from "../lib/session/importPolling";
import { setPollTimestamp } from "../lib/traffic";
import { type DbSession, useSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settingsStore";
import { useTrafficStore } from "./trafficStore";

// Mock Tauri invoke (settingsStore actions persist via invoke)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock Tauri dialogs
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// Mock Tauri HTTP fetch
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

// Keep cross-store helpers inert
vi.mock("../lib/traffic", () => ({
  setPollTimestamp: vi.fn(),
  fetchFlowDetail: vi.fn(),
  getBackendPort: vi.fn(() => 9091),
}));

vi.mock("../lib/session/importPolling", () => ({
  startImportPolling: vi.fn(() => vi.fn()),
}));

vi.mock("../lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const okResponse = (data: any) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const makeSession = (id: string, overrides: Partial<DbSession> = {}): DbSession => ({
  id,
  name: id,
  created_at: 1,
  updated_at: 1,
  flow_count: 0,
  total_size: 0,
  is_active: 0,
  ...overrides,
});

describe("sessionStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      currentSession: null,
      loading: false,
      dbSessions: [],
      showSessionId: null,
      loadingSessions: false,
    });
    useSettingsStore.setState({
      config: { ...useSettingsStore.getState().config, proxy_port: 9090 },
    });
    useTrafficStore.setState({ indices: [], interceptedFlows: new Map() } as any);
  });

  describe("fetchDbSessions", () => {
    it("populates the session list without auto-selecting one", async () => {
      const sessions = [makeSession("s1"), makeSession("s2", { is_active: 1 })];
      (tauriFetch as any).mockResolvedValueOnce(okResponse(sessions));

      await useSessionStore.getState().fetchDbSessions();

      const state = useSessionStore.getState();
      expect(state.dbSessions).toEqual(sessions);
      expect(state.showSessionId).toBeNull();
      expect(state.loadingSessions).toBe(false);
    });

    it("skips the state update when the list is unchanged", async () => {
      const sessions = [makeSession("s1")];
      (tauriFetch as any).mockResolvedValue(okResponse(sessions));

      await useSessionStore.getState().fetchDbSessions();
      const first = useSessionStore.getState().dbSessions;
      await useSessionStore.getState().fetchDbSessions();
      const second = useSessionStore.getState().dbSessions;

      expect(second).toBe(first); // same reference — no re-render churn
    });

    it("keeps state intact when the backend is unreachable", async () => {
      (tauriFetch as any).mockRejectedValueOnce(new Error("Load Failed"));

      await useSessionStore.getState().fetchDbSessions();

      expect(useSessionStore.getState().dbSessions).toEqual([]);
      expect(useSessionStore.getState().loadingSessions).toBe(false);
    });
  });

  describe("switchDbSession", () => {
    it("clears local traffic, loads indices and advances the poll timestamp", async () => {
      useTrafficStore.setState({ indices: [{ id: "stale" } as any] } as any);
      (tauriFetch as any)
        .mockResolvedValueOnce(
          okResponse({ indices: [{ id: "live-1", msg_ts: 1 }], server_ts: 4242 }),
        )
        .mockResolvedValueOnce(okResponse([])); // trailing fetchDbSessions

      await useSessionStore.getState().switchDbSession("s1");

      expect(useTrafficStore.getState().indices).toEqual([{ id: "live-1", msg_ts: 1 }]);
      expect(useSessionStore.getState().showSessionId).toBe("s1");
      expect(setPollTimestamp).toHaveBeenCalledWith(4242);
      expect(useSessionStore.getState().loading).toBe(false);
    });
  });

  describe("deleteDbSession", () => {
    it("switches to the next session when deleting the viewed one", async () => {
      useSessionStore.setState({
        dbSessions: [makeSession("a"), makeSession("b"), makeSession("c")],
        showSessionId: "b",
      });
      (tauriFetch as any)
        .mockResolvedValueOnce(okResponse({})) // delete
        .mockResolvedValueOnce(okResponse({ indices: [], server_ts: 0 })) // switchDbSession poll
        .mockResolvedValueOnce(okResponse([makeSession("a"), makeSession("c")])); // fetchDbSessions

      await useSessionStore.getState().deleteDbSession("b");

      const state = useSessionStore.getState();
      expect(state.showSessionId).toBe("c");
      expect(state.dbSessions.map((s) => s.id)).toEqual(["a", "c"]);
    });

    it("clears the selection when deleting the last session", async () => {
      useSessionStore.setState({
        dbSessions: [makeSession("only")],
        showSessionId: "only",
      });
      (tauriFetch as any).mockResolvedValueOnce(okResponse({}));

      await useSessionStore.getState().deleteDbSession("only");

      expect(useSessionStore.getState().showSessionId).toBeNull();
      expect(useSessionStore.getState().dbSessions).toEqual([]);
    });

    it("keeps the current selection when deleting another session", async () => {
      useSessionStore.setState({
        dbSessions: [makeSession("a"), makeSession("b")],
        showSessionId: "a",
      });
      (tauriFetch as any).mockResolvedValueOnce(okResponse({}));

      await useSessionStore.getState().deleteDbSession("b");

      expect(useSessionStore.getState().showSessionId).toBe("a");
      expect(useSessionStore.getState().dbSessions.map((s) => s.id)).toEqual(["a"]);
    });
  });

  describe("deleteAllDbSessions", () => {
    it("clears everything and notifies on success", async () => {
      useSessionStore.setState({ showSessionId: "gone" });
      (tauriFetch as any)
        .mockResolvedValueOnce(okResponse({ count: 3 })) // delete_all
        .mockResolvedValueOnce(okResponse([])); // fetchDbSessions

      await useSessionStore.getState().deleteAllDbSessions();

      expect(useSessionStore.getState().showSessionId).toBeNull();
      expect(notify.success).toHaveBeenCalled();
      expect(useSessionStore.getState().loadingSessions).toBe(false);
    });

    it("notifies an error when the backend refuses", async () => {
      (tauriFetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "nope",
      });

      await useSessionStore.getState().deleteAllDbSessions();

      expect(notify.error).toHaveBeenCalled();
      expect(useSessionStore.getState().loadingSessions).toBe(false);
    });
  });

  describe("resetDatabase", () => {
    it("clears traffic state and refreshes the session list", async () => {
      useTrafficStore.setState({ indices: [{ id: "x" } as any] } as any);
      useSessionStore.setState({ showSessionId: "s1" });
      (tauriFetch as any)
        .mockResolvedValueOnce(okResponse({ cleared_active_flows: 1, deleted_sessions: 2 }))
        .mockResolvedValueOnce(okResponse([]));

      await useSessionStore.getState().resetDatabase();

      expect(useTrafficStore.getState().indices).toEqual([]);
      expect(useSessionStore.getState().showSessionId).toBeNull();
      expect(notify.success).toHaveBeenCalled();
    });
  });

  describe("saveSession", () => {
    it("computes session metadata from the current traffic indices", async () => {
      useTrafficStore.setState({
        indices: [
          { id: "1", startedDateTime: "2026-01-01T00:00:00.000Z", size: 100 },
          { id: "2", startedDateTime: "2026-01-01T00:01:00.000Z", size: 250 },
        ],
      } as any);
      useSessionStore.setState({ showSessionId: "s1" });
      (save as any).mockResolvedValueOnce("/tmp/demo.relay");
      (tauriFetch as any).mockResolvedValueOnce(okResponse({ success: true }));

      await useSessionStore.getState().saveSession("Demo", "desc");

      const [, fetchOptions] = (tauriFetch as any).mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.name).toBe("Demo");
      expect(body.metadata.flowCount).toBe(2);
      expect(body.metadata.sizeBytes).toBe(350);
      expect(body.metadata.duration).toBe(60_000);
      expect((tauriFetch as any).mock.calls[0][0]).toContain("session_id=s1");
      expect(useSessionStore.getState().currentSession?.name).toBe("Demo");
      expect(notify.success).toHaveBeenCalled();
    });

    it("aborts cleanly when the user cancels the save dialog", async () => {
      (save as any).mockResolvedValueOnce(null);

      await useSessionStore.getState().saveSession("Demo");

      expect(tauriFetch).not.toHaveBeenCalled();
      expect(useSessionStore.getState().loading).toBe(false);
      expect(useSessionStore.getState().currentSession).toBeNull();
    });
  });

  describe("exportHar", () => {
    it("requests a backend export with path and session id", async () => {
      useSessionStore.setState({ showSessionId: "s9" });
      (save as any).mockResolvedValueOnce("/tmp/out.har");
      (tauriFetch as any).mockResolvedValueOnce(okResponse({ success: true }));

      await useSessionStore.getState().exportHar();

      const url = (tauriFetch as any).mock.calls[0][0] as string;
      expect(url).toContain("/_relay/export_har");
      expect(url).toContain("path=%2Ftmp%2Fout.har");
      expect(url).toContain("session_id=s9");
      expect(notify.success).toHaveBeenCalled();
    });
  });

  describe("importHar", () => {
    it("starts import polling and switches to the new session", async () => {
      (open as any).mockResolvedValueOnce("/tmp/in.har");
      (tauriFetch as any)
        .mockResolvedValueOnce(okResponse({ session_id: "s-new", status: "importing" }))
        .mockResolvedValueOnce(okResponse([])); // fetchDbSessions

      await useSessionStore.getState().importHar();

      const [fetchUrl, fetchOptions] = (tauriFetch as any).mock.calls[0];
      expect(fetchUrl).toContain("/_relay/import_har_file");
      expect(JSON.parse(fetchOptions.body)).toEqual({ path: "/tmp/in.har" });
      expect(useSessionStore.getState().showSessionId).toBe("s-new");
      expect(startImportPolling).toHaveBeenCalledWith(
        expect.any(Function),
        "s-new",
        expect.any(String),
        expect.any(String),
      );
      expect(notify.success).toHaveBeenCalled();
    });

    it("does nothing when the dialog is cancelled", async () => {
      (open as any).mockResolvedValueOnce(null);

      await useSessionStore.getState().importHar();

      expect(tauriFetch).not.toHaveBeenCalled();
      expect(startImportPolling).not.toHaveBeenCalled();
      expect(useSessionStore.getState().loading).toBe(false);
    });
  });
});
