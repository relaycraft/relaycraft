/**
 * Helpers for the structured audit.log JSONL format (schema v1).
 * Shared by the LogViewer audit tab and pure/unit-tested here.
 */

/**
 * Render one raw audit.log line as readable text:
 * `[ts] actor(actorName|actorId) action target · result · detail`.
 * Non-JSON lines (legacy text format) are returned unchanged.
 */
export function formatAuditLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return line;

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return line;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return line;
  }
  const record = value as Record<string, unknown>;
  // Legacy wrapper events only carry {actor:"system",action:"note",detail}.
  const str = (key: string) => {
    const v = record[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };

  const ts = str("ts");
  const actor = str("actor") ?? "system";
  const actorLabel = str("actorName") ?? str("actorId");
  const actorPart = actorLabel ? `${actor}(${actorLabel})` : actor;
  const action = str("action");
  const target = str("target");
  const result = str("result");
  const detail = str("detail");

  const head = [ts ? `[${ts}]` : undefined, actorPart, action, target].filter(Boolean).join(" ");
  const tail = [result, detail].filter(Boolean).join(" · ");
  if (!tail) return head || line;
  return head ? `${head} · ${tail}` : tail;
}
