/**
 * Shared utilities for AI context construction — summarization,
 * truncation, sanitization, and hashing.
 */

import type { Rule } from "../../../types/rules";

export const truncate = (val: string, limit: number = 200): string => {
  if (!val || val.length <= limit) return val;
  return `${val.substring(0, limit)}... [TRUNCATED ${val.length - limit} chars]`;
};

export const summarizeRule = (rule: Rule): { match: string; action: string } => {
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

const BLACKLISTED_HEADERS = ["cookie", "set-cookie", "authorization", "proxy-authorization"];

export const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    sanitized[k] = BLACKLISTED_HEADERS.includes(k.toLowerCase())
      ? "[SENSITIVE_REDACTED]"
      : truncate(v, 100);
  }
  return sanitized;
};

export const sanitizeHarHeaders = (
  headers: Array<{ name: string; value: string }> | undefined,
): Record<string, string> => {
  if (!headers) return {};
  const record: Record<string, string> = {};
  for (const h of headers) {
    record[h.name] = h.value;
  }
  return sanitizeHeaders(record);
};

export const hashString = (input: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const trimHeaderEntries = (
  headers: Record<string, string> | undefined,
  maxEntries: number,
): Record<string, string> | undefined => {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).slice(0, maxEntries));
};
