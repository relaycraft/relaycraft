import type { FlowRequest, HarHeader } from "../types";

function getHeaderValue(headers: HarHeader[] | undefined, name: string): string {
  if (!headers || headers.length === 0) return "";
  const lower = name.toLowerCase();
  const hit = headers.find((h) => h.name.toLowerCase() === lower);
  return (hit?.value || "").trim();
}

function stripControlChars(value: string): string {
  let cleaned = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) || 0;
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) continue;
    cleaned += ch;
  }
  return cleaned.trim();
}

function stripInvisibleFormattingChars(value: string): string {
  let cleaned = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) || 0;
    // Zero-width and bidi formatting chars can make text appear blank or scrambled.
    if (
      code === 0xfeff ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      continue;
    }
    cleaned += ch;
  }
  return cleaned.trim();
}

export function sanitizeUrlForDisplay(value: string): string {
  const cleaned = stripInvisibleFormattingChars(stripControlChars(value));
  const firstHttpIndex = cleaned.search(/https?:\/\//i);
  // Some telemetry requests prepend non-URL payload before the real URL.
  // For display stability, show content from the first HTTP(S) marker.
  if (firstHttpIndex > 0) {
    return cleaned.slice(firstHttpIndex).trim();
  }
  return cleaned;
}

export function getReadableUrlPreview(value: string, maxLength: number = 320): string {
  const cleaned = sanitizeUrlForDisplay(value);
  if (!cleaned) return "";

  // Telemetry URLs sometimes append large payload chunks using `|`.
  // Keep the first URL segment for stable, readable rendering.
  const firstSegment = cleaned.split("|", 1)[0]?.trim();
  const primarySegment = firstSegment && firstSegment.length > 0 ? firstSegment : cleaned;

  if (primarySegment.length <= maxLength) return primarySegment;
  return `${primarySegment.slice(0, maxLength)}...`;
}

function buildQueryFromPairs(request: Pick<FlowRequest, "queryString">): string {
  if (!request.queryString || request.queryString.length === 0) return "";
  const pairs = request.queryString
    .map((q) => {
      if (!q.name) return "";
      return q.value != null && q.value !== ""
        ? `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`
        : encodeURIComponent(q.name);
    })
    .filter(Boolean);
  return pairs.length > 0 ? pairs.join("&") : "";
}

/**
 * Resolve a display-safe URL for requests where backend url may be missing/dirty.
 */
export function resolveFlowRequestUrl(
  request: Pick<FlowRequest, "url" | "_parsedUrl" | "headers" | "queryString">,
): string {
  const raw = sanitizeUrlForDisplay(request.url || "");
  if (raw) return raw;

  const scheme =
    request._parsedUrl?.scheme ||
    getHeaderValue(request.headers, ":scheme") ||
    getHeaderValue(request.headers, "x-forwarded-proto") ||
    "http";
  const host =
    request._parsedUrl?.host ||
    getHeaderValue(request.headers, ":authority") ||
    getHeaderValue(request.headers, "host");
  const path = request._parsedUrl?.path || "";
  const query = request._parsedUrl?.query || buildQueryFromPairs(request);
  const queryPart = query ? (query.startsWith("?") ? query : `?${query}`) : "";

  if (host) {
    return sanitizeUrlForDisplay(`${scheme}://${host}${path}${queryPart}`);
  }
  if (path || queryPart) {
    return sanitizeUrlForDisplay(`${path}${queryPart}`);
  }
  return "";
}
