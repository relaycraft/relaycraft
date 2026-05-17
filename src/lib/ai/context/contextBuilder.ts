/**
 * AI Context Builder — assembles a snapshot of application state for LLM consumption.
 *
 * Store reads, cache management, and context assembly are all here.
 * Utilities (truncation, hashing, budget) live in sibling modules.
 */

import { invoke } from "@tauri-apps/api/core";
import { version as APP_VERSION } from "../../../../package.json";
import { useMcpActivityStore } from "../../../stores/mcpActivityStore";
import { useProxyStore } from "../../../stores/proxyStore";
import { useRuleStore } from "../../../stores/ruleStore";
import { useScriptStore } from "../../../stores/scriptStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useTrafficStore } from "../../../stores/trafficStore";
import { useUIStore } from "../../../stores/uiStore";
import type { AIContext, AIContextOptions } from "../../../types/ai";
import {
  applyContextBudget,
  attachContextHash,
  CONTEXT_CACHE_TTL_MS,
  CONTEXT_MAX_CHARS_BY_PROFILE,
} from "./budget";
import { sanitizeHarHeaders, summarizeRule, truncate } from "./utils";

let contextCache: {
  key: string;
  expiresAt: number;
  context: AIContext;
} | null = null;

export const buildAIContext = async (options: AIContextOptions = {}): Promise<AIContext> => {
  const {
    includeLogs = false,
    includeHeaders = false,
    includeBody = false,
    maxTrafficCount = 5,
    budgetProfile = "default",
    maxChars,
  } = options;
  const resolvedMaxChars = maxChars ?? CONTEXT_MAX_CHARS_BY_PROFILE[budgetProfile];

  // 1. Read stores
  const ruleState = useRuleStore.getState();
  const { rules, selectedRule, draftRule, version: ruleVersion } = ruleState;
  const scriptState = useScriptStore.getState();
  const { scripts, version: scriptVersion } = scriptState;
  const { port } = useProxyStore.getState();
  const { config } = useSettingsStore.getState();
  const { indices, selectedFlow } = useTrafficStore.getState();
  const { activeTab } = useUIStore.getState();
  const { activities: mcpActivities } = useMcpActivityStore.getState();

  // 2. Check cache
  const cacheKey = JSON.stringify({
    includeLogs,
    includeHeaders,
    includeBody,
    maxTrafficCount,
    budgetProfile,
    resolvedMaxChars,
    activeTab,
    port,
    upstream: config.upstream_proxy?.enabled ? config.upstream_proxy.url : "",
    ruleVersion,
    scriptVersion,
    selectedRuleId: selectedRule?.id || null,
    draftRuleId: draftRule?.id || (draftRule as any)?._draftId || null,
    selectedFlowId: selectedFlow?.id || null,
    trafficCount: indices.length,
    trafficTail: indices.slice(-maxTrafficCount).map((idx) => [idx.id, idx.status]),
    mcpActivityCount: mcpActivities.length,
    mcpActivityTail: mcpActivities
      .slice(0, 10)
      .map((activity) => [
        activity.id,
        activity.phase,
        activity.status,
        activity.timestamp,
        activity.relatedFlowId || null,
        activity.relatedRuleId || null,
      ]),
  });
  const now = Date.now();
  if (contextCache && contextCache.key === cacheKey && contextCache.expiresAt > now) {
    return contextCache.context;
  }

  // 3. Build context
  const activeRules = rules
    .filter((r) => r.execution.enabled !== false)
    .map((r) => {
      const summary = summarizeRule(r);
      return {
        id: r.id,
        name: r.name,
        type: r.type as string,
        match: summary.match,
        actionSummary: summary.action,
      };
    });

  const activeScripts = scripts.filter((s) => s.enabled).map((s) => s.name);

  const recentTraffic = indices
    .slice(-maxTrafficCount)
    .map((idx) => ({
      id: idx.id,
      method: idx.method,
      url: truncate(idx.url, 150),
      status: idx.status,
    }))
    .reverse();

  const { trafficOverview } = buildTrafficOverview(indices, maxTrafficCount);

  let recentLogs: string[] = [];
  if (includeLogs) {
    try {
      recentLogs = await invoke("get_logs", { logName: "proxy", lines: 10 });
    } catch (_e) {
      recentLogs = ["Error fetching system logs."];
    }
  }

  const selectedItem = buildSelectedItem(
    selectedFlow,
    selectedRule,
    draftRule,
    activeTab,
    includeHeaders,
    includeBody,
  );

  const mcpActivitySummary = mcpActivities.slice(0, 15).map((a) => {
    let actionDesc = a.toolName;
    if (a.toolName === "create_rule") actionDesc = "Created rule";
    if (a.toolName === "toggle_rule") actionDesc = "Toggled rule";
    if (a.toolName === "delete_rule") actionDesc = "Deleted rule";
    if (a.toolName === "replay_request") actionDesc = "Replayed request";
    if (
      a.toolName.startsWith("list_") ||
      a.toolName.startsWith("get_") ||
      a.toolName.startsWith("search_")
    ) {
      actionDesc = `Read data via ${a.toolName}`;
    }

    let targetName = "";
    if (a.relatedRuleId) {
      const rule = useRuleStore.getState().rules.find((r) => r.id === a.relatedRuleId);
      if (rule) targetName = `"${rule.name}"`;
    }

    if (targetName && (a.toolName === "toggle_rule" || a.toolName === "delete_rule")) {
      actionDesc += ` ${targetName}`;
    }

    if (a.status === "error") {
      actionDesc += " (Failed)";
    }

    return {
      action: actionDesc,
      status: a.status,
      intent: a.intent,
      relatedFlowId: a.relatedFlowId,
      relatedRuleId: a.relatedRuleId,
    };
  });

  let summary = `System on port ${port}. Tab: ${activeTab}. `;
  summary += `Captured requests: ${indices.length}. `;
  if (config.upstream_proxy?.enabled) {
    summary += `Upstream: ${config.upstream_proxy.url}. `;
  }
  if (selectedFlow) summary += `Focused on: ${selectedFlow.request.url}. `;

  const context = applyContextBudget(
    {
      summary,
      activeRules,
      activeScripts,
      recentTraffic,
      trafficOverview,
      recentLogs,
      selectedItem,
      activeTab: activeTab || undefined,
      mcpActivitySummary: mcpActivitySummary.length > 0 ? mcpActivitySummary : undefined,
      system: {
        proxyPort: port,
        upstreamProxy: config.upstream_proxy?.enabled ? config.upstream_proxy.url : undefined,
        version: APP_VERSION,
      },
    },
    resolvedMaxChars,
  );

  const finalized = attachContextHash(context);
  contextCache = { key: cacheKey, expiresAt: now + CONTEXT_CACHE_TTL_MS, context: finalized };
  return finalized;
};

function buildTrafficOverview(indices: any[], sampleSize: number) {
  const totalRequests = indices.length;
  const errorCount = indices.filter((idx) => idx.hasError).length;
  const statusDistribution: Record<string, number> = {};
  const domainCounts: Record<string, { count: number; errorCount: number }> = {};

  for (const idx of indices) {
    const code = idx.status ?? 0;
    const bucket = code > 0 ? `${Math.floor(code / 100)}xx` : "other";
    statusDistribution[bucket] = (statusDistribution[bucket] ?? 0) + 1;

    const domain = (idx.host || "unknown").trim() || "unknown";
    if (!domainCounts[domain]) {
      domainCounts[domain] = { count: 0, errorCount: 0 };
    }
    domainCounts[domain].count += 1;
    if (idx.hasError) {
      domainCounts[domain].errorCount += 1;
    }
  }

  const topDomains = Object.entries(domainCounts)
    .map(([domain, metrics]) => ({ domain, count: metrics.count, errorCount: metrics.errorCount }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    trafficOverview: {
      totalRequests,
      errorCount,
      errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
      statusDistribution,
      topDomains,
      recentTrafficSampleSize: sampleSize,
    },
  };
}

function buildSelectedItem(
  selectedFlow: any,
  selectedRule: any,
  draftRule: any,
  activeTab: string,
  includeHeaders: boolean,
  includeBody: boolean,
): AIContext["selectedItem"] {
  if (selectedFlow) {
    return {
      type: "flow",
      id: selectedFlow.id,
      details: {
        method: selectedFlow.request.method,
        url: truncate(selectedFlow.request.url, 300),
        statusCode: selectedFlow.response.status,
        requestHeaders: includeHeaders
          ? sanitizeHarHeaders(selectedFlow.request.headers)
          : undefined,
        responseHeaders: includeHeaders
          ? sanitizeHarHeaders(selectedFlow.response.headers)
          : undefined,
        requestBody: includeBody
          ? truncate(selectedFlow.request.postData?.text || "", 500)
          : undefined,
        responseBody: includeBody
          ? truncate(selectedFlow.response.content.text || "", 500)
          : undefined,
      },
    };
  }
  if (activeTab === "rules" && (selectedRule || draftRule)) {
    const target = selectedRule || draftRule;
    if (target) {
      return {
        type: "rule",
        id: target.id || (target as any)._draftId || "draft",
        details: target,
      };
    }
  }
  return undefined;
}
