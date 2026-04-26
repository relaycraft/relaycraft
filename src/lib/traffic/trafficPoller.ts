/**
 * Traffic polling lifecycle — interval management, timestamp tracking,
 * and the core poll loop that fetches indices from the backend.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import i18n from "../../i18n";
import { useSessionStore } from "../../stores/sessionStore";
import { useTrafficStore } from "../../stores/trafficStore";
import type { FlowIndex } from "../../types";
import { Logger } from "../logger";
import { fetchFlowDetail } from "./flowService";
import { getBackendPort } from "./portState";

export { getBackendPort } from "./portState";

let pollInterval: number | null = null;
let lastTimestamp = 0;
let isPolling = false;

export function setPollTimestamp(ts: number) {
  lastTimestamp = ts;
}

export function hasActivePoll(): boolean {
  return pollInterval !== null;
}

export function clearPollInterval() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

export function startPollInterval() {
  pollInterval = window.setInterval(pollTraffic, 500);
}

export function resetTimestamp() {
  lastTimestamp = 0;
}

export async function pollTraffic(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const pollUrl = `http://127.0.0.1:${getBackendPort()}/_relay/poll`;
    const response = await tauriFetch(`${pollUrl}?since=${lastTimestamp}`, {
      method: "GET",
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();

      if (data.server_ts) {
        if (data.indices && Array.isArray(data.indices) && data.indices.length > 0) {
          const indices: FlowIndex[] = data.indices.map((idx: any) => ({
            id: idx.id,
            msg_ts: idx.msg_ts || 0,
            method: idx.method,
            url: idx.url,
            host: idx.host,
            path: idx.path,
            status: idx.status,
            httpVersion: idx.httpVersion || "",
            contentType: idx.contentType || "",
            startedDateTime: idx.startedDateTime,
            time: idx.time || 0,
            size: idx.size || 0,
            clientIp: idx.clientIp || "",
            appName: idx.appName || "",
            appDisplayName: idx.appDisplayName || "",
            hasError: idx.hasError,
            hasRequestBody: idx.hasRequestBody,
            hasResponseBody: idx.hasResponseBody,
            isWebsocket: idx.isWebsocket,
            isSse: idx.isSse === true,
            websocketFrameCount: idx.websocketFrameCount || 0,
            isIntercepted: idx.isIntercepted,
            hits: (idx.hits || []).map((h: any) => ({
              id: h.id || "",
              name: h.name || "",
              type: h.type || "unknown",
              status: h.status,
            })),
          }));

          const { dbSessions, showSessionId } = useSessionStore.getState();
          const writingSession = dbSessions.find((s) => s.is_active === 1);
          const isViewingCurrent = !writingSession || writingSession.id === showSessionId;

          if (isViewingCurrent) {
            useTrafficStore.getState().addIndices(indices);

            const interceptedIndices = indices.filter((idx) => idx.isIntercepted);
            for (const idx of interceptedIndices) {
              const existing = useTrafficStore.getState().interceptedFlows.get(idx.id);
              if (!existing) {
                const flow = await fetchFlowDetail(idx.id);
                if (flow) {
                  useTrafficStore.getState().updateInterceptedFlow(idx.id, flow);
                }
              }
            }
          }
        }

        lastTimestamp = data.server_ts;

        if (data.notifications && data.notifications.length > 0) {
          try {
            const { useNotificationStore } = await import("../../stores/notificationStore");
            for (const n of data.notifications) {
              useNotificationStore.getState().addNotification({
                title: i18n.t(n.title_key, n.params ?? {}) as string,
                message: i18n.t(n.message_key, n.params ?? {}) as string,
                type: n.type ?? "info",
                category: "system",
                priority: n.priority ?? "normal",
                source: "database",
              });
            }
          } catch (e) {
            Logger.error(`Failed to load notificationStore: ${e}`);
          }
        }
      }
    } else if (response.status === 500) {
      try {
        const errorData = await response.json();
        Logger.error("Polling 500 Error:", errorData);
      } catch {
        const text = await response.text();
        Logger.error("Polling 500 Error Body:", text);
      }
    } else {
      Logger.error(`Polling error: ${response.status}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!(errorMsg.includes("Load Failed") || errorMsg.includes("Connection refused"))) {
      Logger.error("Traffic Poll Failed:", {
        error: errorMsg,
        port: getBackendPort(),
        url: `http://127.0.0.1:${getBackendPort()}/_relay/poll`,
      });
    }
  } finally {
    isPolling = false;
  }
}
