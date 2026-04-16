/**
 * Utility functions for processing AI-generated content.
 */

/**
 * Removes <think>...</think> blocks from AI output.
 * Handles both complete and unclosed tags (for streaming).
 */
export function stripThoughts(content: string): string {
  if (!content) return "";

  // Remove complete tags
  let result = content.replace(/<think>[\s\S]*?<\/think>/g, "");

  // Remove unclosed tags at the end (useful for streaming)
  result = result.replace(/<think>[\s\S]*$/g, "");

  return result.trim();
}

/**
 * Cleans AI result for use in input fields.
 * Strips thoughts and removes markdown code block markers.
 */
export function cleanAIResult(content: string): string {
  const withoutThoughts = stripThoughts(content);

  return withoutThoughts
    .replace(/^```[\w]*\n/, "") // Remove opening ```json or ```regex
    .replace(/\n```$/, "") // Remove closing ```
    .replace(/^`+|`+$/g, "") // Remove inline backticks
    .replace(/^regex\s*\n/i, "") // Remove common "regex" header followed by newline
    .replace(/^(filter|query|search|response|result|answer|output|pattern|regex):\s*/i, "") // Remove common labels safely
    .trim();
}

/**
 * Normalize generated filter query for known model mistakes.
 * This is intentionally conservative and only rewrites clearly supported patterns.
 */
export function normalizeFilterQuery(content: string): string {
  const cleaned = cleanAIResult(content);
  if (!cleaned) return "";

  const aliasMap: Record<string, string> = {
    host: "domain",
    d: "domain",
    s: "status",
    m: "method",
    t: "type",
    h: "header",
    rb: "reqbody",
    body: "resbody",
    src: "source",
    dur: "duration",
    sz: "size",
  };

  const out: string[] = [];
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const negative = token.startsWith("-") || token.startsWith("!");
    const body = negative ? token.slice(1) : token;
    const firstColon = body.indexOf(":");
    if (firstColon === -1) {
      out.push(token);
      continue;
    }

    const rawKey = body.slice(0, firstColon).toLowerCase();
    const value = body.slice(firstColon + 1).trim();
    if (!value) continue;

    const key = aliasMap[rawKey] || rawKey;
    const prefix = negative ? "-" : "";

    // Expand common status comma style to repeated tokens: status:4xx status:5xx
    if (key === "status" && value.includes(",")) {
      const values = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (values.length > 0) {
        for (const item of values) {
          out.push(`${prefix}${key}:${item}`);
        }
        continue;
      }
    }

    out.push(`${prefix}${key}:${value}`);
  }

  return out.join(" ").trim();
}
