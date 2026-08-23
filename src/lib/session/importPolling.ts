import { notify } from "../notify";

/**
 * Minimal session-store surface needed by import polling.
 * Structural (rather than importing sessionStore) so this lib module stays
 * dependency-free and sessionStore can call it without an import cycle.
 */
export interface ImportPollingSessionState {
  fetchDbSessions: () => Promise<void>;
  dbSessions: Array<{ id: string; metadata?: unknown }>;
  showSessionId: string | null;
  switchDbSession: (sessionId: string) => Promise<void>;
}

/**
 * Start polling session metadata during a background import.
 *
 * Polls every second, refreshing the session list and the traffic view.
 * On completion (or timeout after 600 polls / ~10 min), stops polling
 * and shows a notification.
 *
 * Returns a cleanup function that clears the interval.
 */
export function startImportPolling(
  getState: () => ImportPollingSessionState,
  sessionId: string,
  successMessage: string,
  errorMessage: string,
): () => void {
  let pollCount = 0;
  const maxPolls = 600;

  const interval = setInterval(async () => {
    const { fetchDbSessions, dbSessions, showSessionId, switchDbSession } = getState();

    await fetchDbSessions();
    const currentSess = dbSessions.find((s) => s.id === sessionId);

    let md: Record<string, any> = {};
    try {
      md =
        typeof currentSess?.metadata === "string"
          ? JSON.parse(currentSess.metadata)
          : currentSess?.metadata || {};
    } catch {}

    if (!currentSess || md.status !== "importing" || pollCount > maxPolls) {
      clearInterval(interval);

      if (showSessionId === sessionId) {
        await switchDbSession(sessionId);
      }

      if (md.status === "ready") {
        notify.success(successMessage);
      } else if (md.status === "error") {
        notify.error(`${errorMessage}: ${md.error_message || "Unknown error"}`);
      }
    } else {
      if (pollCount % 3 === 0 && showSessionId === sessionId) {
        await switchDbSession(sessionId);
      }
    }
    pollCount++;
  }, 1000);

  return () => clearInterval(interval);
}
