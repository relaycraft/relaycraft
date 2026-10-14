import type { FlowIndex, FlowIndexHit } from "../../types";

/**
 * Merge a poll batch into an already time-ordered index list.
 *
 * The common case under load is "new rows are newer than everything we
 * have". That path appends the batch instead of copying and sorting the
 * whole window. An identical replay of rows already on screen returns the
 * same array so the list does not re-render.
 */

function hitKey(hit: FlowIndexHit): string {
  return `${hit.type}\0${hit.id}\0${hit.name}\0${hit.status ?? ""}`;
}

function hitsEqual(a: FlowIndexHit[] | undefined, b: FlowIndexHit[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (hitKey(left[i]) !== hitKey(right[i])) return false;
  }
  return true;
}

function flowIndexUnchanged(prev: FlowIndex, next: FlowIndex): boolean {
  return (
    prev.msg_ts === next.msg_ts &&
    prev.method === next.method &&
    prev.url === next.url &&
    prev.host === next.host &&
    prev.path === next.path &&
    prev.status === next.status &&
    prev.httpVersion === next.httpVersion &&
    prev.contentType === next.contentType &&
    prev.startedDateTime === next.startedDateTime &&
    prev.time === next.time &&
    prev.size === next.size &&
    prev.clientIp === next.clientIp &&
    prev.appName === next.appName &&
    prev.appDisplayName === next.appDisplayName &&
    prev.hasError === next.hasError &&
    prev.hasRequestBody === next.hasRequestBody &&
    prev.hasResponseBody === next.hasResponseBody &&
    prev.isWebsocket === next.isWebsocket &&
    prev.isSse === next.isSse &&
    prev.websocketFrameCount === next.websocketFrameCount &&
    prev.isIntercepted === next.isIntercepted &&
    hitsEqual(prev.hits, next.hits)
  );
}

function byTimestamp(a: FlowIndex, b: FlowIndex): number {
  return (a.msg_ts || 0) - (b.msg_ts || 0);
}

export function mergeFlowIndices(
  existing: FlowIndex[],
  incoming: FlowIndex[],
  maxIndices: number,
): FlowIndex[] {
  if (incoming.length === 0) return existing;

  const existingAt = new Map<string, number>();
  for (let i = 0; i < existing.length; i++) existingAt.set(existing[i].id, i);

  const replacements = new Map<string, FlowIndex>();
  const fresh = new Map<string, FlowIndex>();
  let reorder = false;
  const lastTs =
    existing.length > 0 ? existing[existing.length - 1].msg_ts || 0 : Number.NEGATIVE_INFINITY;

  for (const item of incoming) {
    const at = existingAt.get(item.id);
    if (at === undefined) {
      fresh.set(item.id, item);
      if ((item.msg_ts || 0) < lastTs) reorder = true;
      continue;
    }
    const prev = existing[at];
    if (flowIndexUnchanged(prev, item)) continue;
    replacements.set(item.id, item);
    if ((prev.msg_ts || 0) !== (item.msg_ts || 0)) reorder = true;
  }

  if (replacements.size === 0 && fresh.size === 0) return existing;

  let merged: FlowIndex[];
  if (!reorder) {
    merged =
      replacements.size === 0
        ? existing
        : existing.map((item) => replacements.get(item.id) ?? item);
    if (fresh.size > 0) {
      const appended = Array.from(fresh.values());
      if (appended.length > 1) appended.sort(byTimestamp);
      merged = merged.concat(appended);
    }
  } else {
    const byId = new Map<string, FlowIndex>();
    for (const item of existing) byId.set(item.id, replacements.get(item.id) ?? item);
    for (const item of fresh.values()) byId.set(item.id, item);
    merged = Array.from(byId.values()).sort(byTimestamp);
  }

  if (merged.length > maxIndices) {
    return merged.slice(merged.length - maxIndices);
  }
  return merged;
}
