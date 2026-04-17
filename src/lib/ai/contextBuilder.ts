import { invoke } from "@tauri-apps/api/core";
import { version as APP_VERSION } from "../../../package.json";
import { useProxyStore } from "../../stores/proxyStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useScriptStore } from "../../stores/scriptStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { useUIStore } from "../../stores/uiStore";
import type { AIContext, AIContextBudgetProfile, AIContextOptions } from "../../types/ai";
import type { Rule } from "../../types/rules";

const DEFAULT_CONTEXT_MAX_CHARS = 12_000;
const CONTEXT_CACHE_TTL_MS = 1_500;
const CONTEXT_MAX_CHARS_BY_PROFILE: Record<AIContextBudgetProfile, number> = {
  default: DEFAULT_CONTEXT_MAX_CHARS,
  command_center: 9_000,
  rule_assistant: 14_000,
  script_assistant: 13_000,
  store_snapshot: 8_000,
};

let contextCache: {
  key: string;
  expiresAt: number;
  context: AIContext;
} | null = null;

/**
 * Generates a human-readable summary of a single rule.
 */
const summarizeRule = (rule: Rule): { match: string; action: string } => {
  // Basic match summary
  const matches = rule.match.request
    .map((atom) => {
      if (atom.type === "url")
        return `${atom.matchType === "regex" ? "Regex" : "URL"}: ${atom.value}`;
      if (atom.type === "method") return `Method: ${atom.value}`;
      if (atom.type === "host") return `Host: ${atom.value}`;
      if (atom.type === "path") return `Path: ${atom.value}`;
      return `${atom.type}=${atom.value}`;
    })
    .join(" AND ");

  // Basic action summary
  const actions = rule.actions
    .map((action) => {
      switch (action.type) {
        case "map_local":
          return `Map Local -> ${(action as any).localPath || "Manual"}`;
        case "map_remote":
          return `Map Remote -> ${(action as any).targetUrl}`;
        case "block_request":
          return "Block";
        case "rewrite_body":
          return `Rewrite Body (${(action as any).target})`;
        case "rewrite_header":
          return `Rewrite Header (${(action as any).target})`;
        case "throttle":
          return "Throttle";
        default:
          return (action as any).type;
      }
    })
    .join(", ");

  return { match: matches, action: actions };
};

/**
 * Truncates strings with elite precision to preserve high-signal start/end.
 */
const truncate = (val: string, limit: number = 200): string => {
  if (!val || val.length <= limit) return val;
  return `${val.substring(0, limit)}... [TRUNCATED ${val.length - limit} chars]`;
};

/**
 * Strips sensitive/bulky headers to save tokens.
 */
const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const blacklist = ["cookie", "set-cookie", "authorization", "proxy-authorization"];
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (blacklist.includes(k.toLowerCase())) {
      sanitized[k] = "[SENSITIVE_REDACTED]";
    } else {
      sanitized[k] = truncate(v, 100);
    }
  }
  return sanitized;
};

/**
 * Converts HarHeader[] to Record<string, string> and sanitizes.
 */
const sanitizeHarHeaders = (
  headers: Array<{ name: string; value: string }> | undefined,
): Record<string, string> => {
  if (!headers) return {};
  const record: Record<string, string> = {};
  for (const h of headers) {
    // For duplicate headers, last value wins (acceptable for AI context)
    record[h.name] = h.value;
  }
  return sanitizeHeaders(record);
};

const estimateContextChars = (context: AIContext): number => JSON.stringify(context).length;

const hashString = (input: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const trimHeaderEntries = (
  headers: Record<string, string> | undefined,
  maxEntries: number,
): Record<string, string> | undefined => {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).slice(0, maxEntries));
};

const applyContextBudget = (context: AIContext, maxChars: number): AIContext => {
  if (estimateContextChars(context) <= maxChars) return context;

  const budgeted: AIContext = JSON.parse(JSON.stringify(context));

  // Lowest-priority payload first.
  if (budgeted.recentLogs?.length) {
    budgeted.recentLogs = [];
  }
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  if (budgeted.recentTraffic && budgeted.recentTraffic.length > 3) {
    budgeted.recentTraffic = budgeted.recentTraffic.slice(0, 3);
  }
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  if (budgeted.recentTraffic && budgeted.recentTraffic.length > 1) {
    budgeted.recentTraffic = budgeted.recentTraffic.slice(0, 1);
  }
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  budgeted.recentTraffic = [];
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  if (budgeted.activeRules.length > 30) {
    budgeted.activeRules = budgeted.activeRules.slice(0, 30);
  }
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  if (budgeted.activeRules.length > 10) {
    budgeted.activeRules = budgeted.activeRules.slice(0, 10);
  }
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  if (budgeted.activeRules.length > 5) {
    budgeted.activeRules = budgeted.activeRules.slice(0, 5);
  }
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  // Preserve selectedItem but trim heavy subfields if still oversized.
  if (budgeted.selectedItem?.type === "flow") {
    const details = budgeted.selectedItem.details || {};
    details.requestBody =
      typeof details.requestBody === "string" ? truncate(details.requestBody, 200) : undefined;
    details.responseBody =
      typeof details.responseBody === "string" ? truncate(details.responseBody, 200) : undefined;
    details.requestHeaders = trimHeaderEntries(details.requestHeaders, 12);
    details.responseHeaders = trimHeaderEntries(details.responseHeaders, 12);
    budgeted.selectedItem.details = details;
  }
  if (estimateContextChars(budgeted) <= maxChars) return budgeted;

  if (budgeted.summary.length > 800) {
    budgeted.summary = truncate(budgeted.summary, 800);
  }

  return budgeted;
};

const attachContextHash = (context: AIContext): AIContext => {
  const fingerprint = {
    summary: context.summary,
    selectedItem: context.selectedItem,
    activeRules: context.activeRules.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      match: r.match,
      actionSummary: r.actionSummary,
    })),
    activeScripts: context.activeScripts,
    activeTab: context.activeTab,
  };
  return {
    ...context,
    contextHash: hashString(JSON.stringify(fingerprint)),
  };
};

/**
 * Builds the AI Context snapshot from current stores.
 */
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

  // 1. Get Stores
  const ruleState = useRuleStore.getState();
  const { rules, selectedRule, draftRule, version: ruleVersion } = ruleState;
  const scriptState = useScriptStore.getState();
  const { scripts, version: scriptVersion } = scriptState;
  const { port } = useProxyStore.getState();
  const { config } = useSettingsStore.getState();
  const { indices, selectedFlow } = useTrafficStore.getState();
  const { activeTab } = useUIStore.getState();
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
    trafficTail: indices.slice(-maxTrafficCount).map((idx) => [idx.id, idx.status]),
  });
  const now = Date.now();
  if (contextCache && contextCache.key === cacheKey && contextCache.expiresAt > now) {
    return contextCache.context;
  }

  // 2. Filter Active Rules
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

  // 3. Filter Active Scripts
  const activeScripts = scripts.filter((s) => s.enabled).map((s) => s.name);

  // 4. Sample Recent Traffic (use indices for lightweight data)
  const recentTraffic = indices
    .slice(-maxTrafficCount)
    .map((idx) => ({
      id: idx.id,
      method: idx.method,
      url: truncate(idx.url, 150),
      status: idx.status,
    }))
    .reverse();

  // 5. Fetch Real Logs if requested
  let recentLogs: string[] = [];
  if (includeLogs) {
    try {
      // Fetch last 10 engine logs
      recentLogs = await invoke("get_logs", { logName: "proxy", lines: 10 });
    } catch (_e) {
      recentLogs = ["Error fetching system logs."];
    }
  }

  // 6. Focus Item Details (Deep Snapshot)
  let selectedItem: AIContext["selectedItem"];
  if (selectedFlow) {
    selectedItem = {
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
  } else if (activeTab === "rules" && (selectedRule || draftRule)) {
    const target = selectedRule || draftRule;
    if (target) {
      selectedItem = {
        type: "rule",
        id: target.id || (target as any)._draftId || "draft",
        details: target,
      };
    }
  }

  // 7. Generate Narrative Summary
  let summary = `System on port ${port}. Tab: ${activeTab}. `;
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
      recentLogs,
      selectedItem,
      activeTab: activeTab || undefined,
      system: {
        proxyPort: port,
        upstreamProxy: config.upstream_proxy?.enabled ? config.upstream_proxy.url : undefined,
        version: APP_VERSION,
      },
    },
    resolvedMaxChars,
  );
  const finalized = attachContextHash(context);
  contextCache = {
    key: cacheKey,
    expiresAt: now + CONTEXT_CACHE_TTL_MS,
    context: finalized,
  };
  return finalized;
};
