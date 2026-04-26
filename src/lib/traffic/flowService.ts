/**
 * Flow detail fetching, content search, SSE polling, and WebSocket injection.
 * These are stateless utilities that depend only on the current backend port.
 */

import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import i18n from "../../i18n";
import { useRuleStore } from "../../stores/ruleStore";
import type { Flow, RcMatchedHit, SsePollResponse, WsResendRequest } from "../../types";
import { Logger } from "../logger";
import { getBackendPort } from "./portState";

export async function searchFlowContent(
  keyword: string,
  type: "response" | "request" | "header",
  sessionId?: string | null,
): Promise<{ matches: string[]; scanned: number }> {
  const url = `http://127.0.0.1:${getBackendPort()}/_relay/search`;
  const res = await tauriFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, type, session_id: sessionId ?? null }),
  });
  if (!res.ok) throw new Error(`Content search failed: ${res.status}`);
  return res.json();
}

export async function fetchFlowDetail(id: string): Promise<Flow | null> {
  try {
    const detailUrl = `http://127.0.0.1:${getBackendPort()}/_relay/detail?id=${id}`;
    const response = await tauriFetch(detailUrl, {
      method: "GET",
      cache: "no-store",
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

export async function wsInjectFrame(req: WsResendRequest): Promise<void> {
  try {
    await invoke("ws_inject_frame", { req });
  } catch (raw) {
    const msg = typeof raw === "string" ? raw : String(raw);
    throw new Error(translateWsInjectError(msg));
  }
}

export async function fetchSseEvents(
  flowId: string,
  sinceSeq: number,
  limit: number = 200,
): Promise<SsePollResponse | null> {
  try {
    const url = new URL(`http://127.0.0.1:${getBackendPort()}/_relay/sse`);
    url.searchParams.set("flow_id", flowId);
    url.searchParams.set("since_seq", String(Math.max(0, sinceSeq)));
    url.searchParams.set("limit", String(limit));

    const response = await tauriFetch(url.toString(), {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return response.json();
  } catch (error) {
    Logger.error("Error fetching SSE events:", error);
    return null;
  }
}

function processFlowHits(flow: any): Flow {
  if (!(flow.hits && Array.isArray(flow.hits))) {
    return flow;
  }

  const rules = useRuleStore.getState().rules;

  const processedHits: RcMatchedHit[] = flow.hits.map((hit: string | any) => {
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

const WS_INJECT_ERROR_CODES = new Set([
  "flow_not_found",
  "flow_closed",
  "invalid_payload",
  "engine_error",
]);

function translateWsInjectError(raw: string): string {
  const colonIdx = raw.indexOf(":");
  if (colonIdx > 0) {
    const code = raw.slice(0, colonIdx).trim();
    const detail = raw.slice(colonIdx + 1).trim();
    if (WS_INJECT_ERROR_CODES.has(code)) {
      const localized = i18n.t(`traffic.websocket.resend_error.${code}`);
      return detail ? `${localized} (${detail})` : localized;
    }
  }
  return raw || i18n.t("traffic.websocket.resend_error.engine_error");
}
