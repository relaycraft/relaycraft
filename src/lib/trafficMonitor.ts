/**
 * Traffic Monitor - Memory Optimized
 *
 * Polls lightweight indices from Python backend and fetches
 * full flow details on demand.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useRuleStore } from "../stores/ruleStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTrafficStore } from "../stores/trafficStore";
import type { Flow, FlowIndex, RcMatchedHit } from "../types";
import { Logger } from "./logger";

let pollInterval: number | null = null;
let lastTimestamp = 0;
let isPolling = false;
let currentPort = 9090;
let sessionCreatedForAppStart = false; // Track if we created session for this app start

export function getBackendPort(): number {
  return currentPort;
}

export async function startTrafficMonitor(port: number = 9090) {
  if (pollInterval) {
    Logger.debug("Traffic monitor already running, stopping existing one...");
    clearInterval(pollInterval);
    pollInterval = null;
  }

  currentPort = port;
  Logger.debug(`Starting traffic monitor (polling on port ${port})...`);

  // Don't call clearAll() on startup! That was wiping the backend.
  // Only clear frontend state if this is the first time we're starting monitoring
  if (!sessionCreatedForAppStart) {
    sessionCreatedForAppStart = true;
    useTrafficStore.getState().clearLocal();
    lastTimestamp = 0;

    // Create session immediately (don't wait)
    try {
      const newSessionId = await createNewSession();
      if (newSessionId) {
        Logger.info(`Created new session: ${newSessionId}`);
      }
    } catch (err) {
      Logger.error("Failed to create new session on proxy start:", err);
    }
  }

  // Initial poll
  pollTraffic();

  // Poll every 500ms
  pollInterval = window.setInterval(pollTraffic, 500);
}

export function stopTrafficMonitor() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    Logger.debug("Traffic monitor stopped");
  }

  // Reset session flag so next start creates a new session
  sessionCreatedForAppStart = false;
}

/**
 * Final poll to capture any remaining data before shutdown
 * Call this before stopTrafficMonitor for clean shutdown
 */
export async function finalPollAndStop(): Promise<void> {
  // Do a final poll to capture any remaining data
  try {
    await pollTraffic();
    Logger.debug("Final poll completed");
  } catch (error) {
    Logger.error("Final poll error:", error);
  }

  // Small delay to ensure data is processed
  await new Promise((resolve) => setTimeout(resolve, 100));

  stopTrafficMonitor();
}

/**
 * Force update the poll timestamp (useful when switching sessions)
 */
export function setPollTimestamp(ts: number) {
  lastTimestamp = ts;
}

/**
 * Reset the session creation flag (called when app fully restarts)
 */
export function resetSessionFlag() {
  sessionCreatedForAppStart = false;
}

/**
 * Create a new session for this proxy start
 * Should be called once when proxy starts (not when app starts)
 * Note: Frontend data should be cleared BEFORE calling this function
 */
export async function createNewSession(): Promise<string | null> {
  try {
    const url = `http://127.0.0.1:${currentPort}/_relay/session/new`;
    const response = await tauriFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    if (response.ok) {
      const data = await response.json();
      const newSessionId = data.id;
      Logger.info(`Created new session: ${newSessionId}`);
      // Update sessionStore with the new session
      await useSessionStore.getState().fetchDbSessions();
      // Switch to the new session
      useSessionStore.setState({ showSessionId: newSessionId });
      return newSessionId;
    }
    Logger.error(`Failed to create new session: ${response.status}`);
    return null;
  } catch (error) {
    Logger.error("Error creating new session:", error);
    return null;
  }
}

/**
 * Fetch full flow detail from backend on demand
 */
export async function fetchFlowDetail(id: string): Promise<Flow | null> {
  try {
    const detailUrl = `http://127.0.0.1:${currentPort}/_relay/detail?id=${id}`;
    const response = await tauriFetch(detailUrl, {
      method: "GET",
      cache: "no-store", // Prevent WebView2 from caching response in memory
    });

    if (response.ok) {
      const flow = await response.json();
      return processFlowHits(flow);
    }
    if (response.status === 404) {
      Logger.warn(`Flow ${id} not found in backend buffer`);
      return null;
    }
    Logger.error(`Failed to fetch flow detail: ${response.status}`);
    return null;
  } catch (error) {
    Logger.error("Error fetching flow detail:", error);
    return null;
  }
}

/**
 * Process hits in flow data (enrich with rule names)
 */
function processFlowHits(flow: any): Flow {
  if (!(flow.hits && Array.isArray(flow.hits))) {
    return flow;
  }

  // Use ES module import (avoid circular dependency by getting state at runtime)
  const rules = useRuleStore.getState().rules;

  const processedHits: RcMatchedHit[] = flow.hits.map((hit: string | any) => {
    // Handle String Hits (Scripts or Legacy IDs)
    if (typeof hit === "string") {
      if (hit.startsWith("script:")) {
        const name = hit.substring(7);
        return { id: name, name, type: "script" };
      }

      const rule = rules.find((r: any) => r.id === hit);
      if (rule) {
        const type = rule.actions?.[0]?.type || "rule";
        return { id: rule.id, name: rule.name, type };
      }

      return { id: hit, name: "Unknown Rule", type: "unknown" };
    }

    // Handle Object Hits
    if (typeof hit === "object" && hit !== null) {
      const rule = rules.find((r: any) => r.id === hit.id);
      if (rule) {
        const type = rule.actions?.[0]?.type || "rule";
        return { ...hit, name: rule.name, type };
      }
      return hit;
    }

    return { id: "unknown", name: "Unknown", type: "unknown" };
  });

  return { ...flow, hits: processedHits };
}

async function pollTraffic() {
  if (isPolling) return;
  isPolling = true;

  try {
    // Always poll the current (writing) session
    // The frontend decides what to display based on showSessionId
    const pollUrl = `http://127.0.0.1:${currentPort}/_relay/poll`;

    const response = await tauriFetch(`${pollUrl}?since=${lastTimestamp}`, {
      method: "GET",
      cache: "no-store", // Prevent WebView2 from caching response in memory
    });

    if (response.ok) {
      const data = await response.json();

      if (data.server_ts) {
        // Handle lightweight indices
        if (data.indices && Array.isArray(data.indices) && data.indices.length > 0) {
          const indices: FlowIndex[] = data.indices.map((idx: any) => ({
            id: idx.id,
            msg_ts: idx.msg_ts || 0,
            method: idx.method,
            url: idx.url,
            host: idx.host,
            path: idx.path,
            status: idx.status,
            contentType: idx.contentType || "",
            startedDateTime: idx.startedDateTime,
            time: idx.time || 0,
            size: idx.size || 0,
            hasError: idx.hasError,
            hasRequestBody: idx.hasRequestBody,
            hasResponseBody: idx.hasResponseBody,
            isWebsocket: idx.isWebsocket,
            websocketFrameCount: idx.websocketFrameCount || 0,
            isIntercepted: idx.isIntercepted,
            // Include hit metadata for list display
            hits: (idx.hits || []).map((h: any) => ({
              id: h.id || "",
              name: h.name || "",
              type: h.type || "unknown",
              status: h.status,
            })),
          }));

          // Only update UI if we're viewing the current (writing) session
          const { dbSessions, showSessionId } = useSessionStore.getState();
          const writingSession = dbSessions.find((s) => s.is_active === 1);
          const isViewingCurrent = !writingSession || writingSession.id === showSessionId;

          if (isViewingCurrent) {
            useTrafficStore.getState().addIndices(indices);
          }
        }

        // Update timestamp
        lastTimestamp = data.server_ts;
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
        port: currentPort,
        url: `http://127.0.0.1:${currentPort}/_relay/poll`,
      });
    }
  } finally {
    isPolling = false;
  }
}
