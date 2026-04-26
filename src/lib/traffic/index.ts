/**
 * Traffic Monitor — orchestration layer.
 *
 * Composes the polling, session, and flow-service modules into the
 * public API consumed by stores and components.
 */

import { useTrafficStore } from "../../stores/trafficStore";
import { Logger } from "../logger";
import { setBackendPort } from "./portState";
import {
  createNewSession,
  isSessionCreated,
  markSessionCreated,
  resetSessionFlag,
} from "./sessionManager";
import {
  clearPollInterval,
  hasActivePoll,
  pollTraffic,
  resetTimestamp,
  setPollTimestamp,
  startPollInterval,
} from "./trafficPoller";

export { fetchFlowDetail, fetchSseEvents, searchFlowContent, wsInjectFrame } from "./flowService";
export { getBackendPort } from "./portState";
export { createNewSession, resetSessionFlag, setPollTimestamp };

export async function startTrafficMonitor(port: number = 9090) {
  if (hasActivePoll()) {
    Logger.debug("Traffic monitor already running, stopping existing one...");
    clearPollInterval();
  }

  setBackendPort(port);
  Logger.debug(`Starting traffic monitor (polling on port ${port})...`);

  if (!isSessionCreated()) {
    markSessionCreated();
    useTrafficStore.getState().clearLocal();
    resetTimestamp();

    try {
      const newSessionId = await createNewSession();
      if (newSessionId) {
        Logger.info(`Created new session: ${newSessionId}`);
      }
    } catch (err) {
      Logger.error("Failed to create new session on proxy start:", err);
    }
  }

  pollTraffic();
  startPollInterval();
}

export function stopTrafficMonitor() {
  clearPollInterval();
  Logger.debug("Traffic monitor stopped");
}

export async function finalPollAndStop(): Promise<void> {
  try {
    await pollTraffic();
    Logger.debug("Final poll completed");
  } catch (error) {
    Logger.error("Final poll error:", error);
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  stopTrafficMonitor();
}
