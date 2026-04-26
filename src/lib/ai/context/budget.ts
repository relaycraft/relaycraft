/**
 * Context budget management — trims AIContext to fit within
 * character limits by progressively removing low-value fields.
 */

import type { AIContext, AIContextBudgetProfile } from "../../../types/ai";
import { hashString, trimHeaderEntries, truncate } from "./utils";

const DEFAULT_CONTEXT_MAX_CHARS = 12_000;

export const CONTEXT_MAX_CHARS_BY_PROFILE: Record<AIContextBudgetProfile, number> = {
  default: DEFAULT_CONTEXT_MAX_CHARS,
  command_center: 9_000,
  rule_assistant: 14_000,
  script_assistant: 13_000,
  store_snapshot: 8_000,
};

export const CONTEXT_CACHE_TTL_MS = 1_500;

const estimateContextChars = (context: AIContext): number => JSON.stringify(context).length;

export const applyContextBudget = (context: AIContext, maxChars: number): AIContext => {
  if (estimateContextChars(context) <= maxChars) return context;

  const budgeted: AIContext = JSON.parse(JSON.stringify(context));

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

  if (budgeted.trafficOverview && budgeted.trafficOverview.topDomains.length > 3) {
    budgeted.trafficOverview.topDomains = budgeted.trafficOverview.topDomains.slice(0, 3);
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

export const attachContextHash = (context: AIContext): AIContext => {
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
