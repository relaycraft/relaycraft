/**
 * Session lifecycle — creating new sessions and tracking app-start state.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useSessionStore } from "../../stores/sessionStore";
import { Logger } from "../logger";
import { getBackendPort } from "./portState";

let sessionCreatedForAppStart = false;

export function resetSessionFlag() {
  sessionCreatedForAppStart = false;
}

export function isSessionCreated(): boolean {
  return sessionCreatedForAppStart;
}

export function markSessionCreated() {
  sessionCreatedForAppStart = true;
}

export async function createNewSession(): Promise<string | null> {
  try {
    const url = `http://127.0.0.1:${getBackendPort()}/_relay/session/new`;
    const response = await tauriFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (response.ok) {
      const data = await response.json();
      const newSessionId = data.id;
      Logger.info(`Created new session: ${newSessionId}`);
      await useSessionStore.getState().fetchDbSessions();
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
