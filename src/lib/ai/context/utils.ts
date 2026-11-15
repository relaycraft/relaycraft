/**
 * Shared utilities for AI context construction — summarization,
 * truncation, sanitization, and hashing.
 */

import type { Rule, RuleAction } from "../../../types/rules";

export const truncate = (val: string, limit: number = 200): string => {
  if (!val || val.length <= limit) return val;
  return `${val.substring(0, limit)}... [TRUNCATED ${val.length - limit} chars]`;
};

/** Headers whose values are replaced before request data reaches the AI. */
export const SENSITIVE_HEADERS = [
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-xsrf-token",
];

const SENSITIVE_HEADER_SET = new Set(SENSITIVE_HEADERS);

/**
 * Query parameter names whose values are redacted from URLs sent to the AI.
 * Compared case-insensitively against the percent-decoded parameter name.
 */
export const SENSITIVE_QUERY_PARAMS = [
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "auth",
  "signature",
  "sig",
  "session",
  "sessionid",
];

const SENSITIVE_QUERY_PARAM_SET = new Set(SENSITIVE_QUERY_PARAMS);

/** Truncation limits applied to URLs and bodies in the AI context. */
export const URL_TRUNCATE_LIMIT = 300;
export const BODY_TRUNCATE_LIMIT = 500;

const REDACTED = "[REDACTED]";

/**
 * Redact userinfo credentials (`user:pass@`) inside the authority component.
 * The authority is the span after `scheme://` (or from the start for
 * scheme-less URLs) up to the first `/`, `?` or `#`. An `@` in the path or
 * query (e.g. `/users/@me`, `?email=a@b.com`) is left untouched.
 */
const redactUserinfo = (url: string): string => {
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(url);
  const authStart = schemeMatch ? schemeMatch[0].length : url.startsWith("//") ? 2 : 0;

  let authEnd = url.length;
  for (let i = authStart; i < url.length; i++) {
    const ch = url[i];
    if (ch === "/" || ch === "?" || ch === "#") {
      authEnd = i;
      break;
    }
  }

  const authority = url.slice(authStart, authEnd);
  const atIndex = authority.lastIndexOf("@");
  if (atIndex < 0) return url;

  return url.slice(0, authStart) + REDACTED + authority.slice(atIndex) + url.slice(authEnd);
};

/**
 * Replace values of sensitive query parameters with "[REDACTED]" and strip
 * userinfo credentials from the authority.
 * Operates on the raw string so malformed or relative URLs never throw and
 * unrelated encoding is preserved byte-for-byte.
 */
export const sanitizeUrl = (url: string): string => {
  if (!url) return url;

  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  const beforeQuery = redactUserinfo(
    queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
  );
  if (queryIndex < 0) return `${beforeQuery}${hash}`;

  const query = beforeHash.slice(queryIndex + 1);
  const sanitizedQuery = query
    .split("&")
    .map((pair) => {
      const eqIndex = pair.indexOf("=");
      const rawName = eqIndex >= 0 ? pair.slice(0, eqIndex) : pair;
      let name = rawName;
      try {
        name = decodeURIComponent(rawName);
      } catch {
        // Keep the raw name when it is not valid percent-encoding.
      }
      if (!SENSITIVE_QUERY_PARAM_SET.has(name.toLowerCase())) return pair;
      return `${rawName}=${REDACTED}`;
    })
    .join("&");

  return `${beforeQuery}?${sanitizedQuery}${hash}`;
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
          return `Map Local -> ${action.localPath || "Manual"}`;
        case "map_remote":
          return `Map Remote -> ${action.targetUrl}`;
        case "block_request":
          return "Block";
        case "rewrite_body":
          return `Rewrite Body (${action.target})`;
        case "rewrite_header":
          // RewriteHeaderAction has no `target` field; keep the legacy summary shape.
          return `Rewrite Header (${(action as { target?: string }).target})`;
        case "throttle":
          return "Throttle";
        default:
          return (action as RuleAction).type;
      }
    })
    .join(", ");

  return { match: matches, action: actions };
};

export const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    sanitized[k] = SENSITIVE_HEADER_SET.has(k.toLowerCase())
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
