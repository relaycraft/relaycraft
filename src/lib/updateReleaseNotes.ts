function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeOneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * When the updater `body` is empty or only repeats the version (e.g. "Release v1.1.1"),
 * return null so the UI does not show a redundant notes block.
 */
export function getDisplayableUpdateNotes(
  body: string | undefined,
  version: string,
): string | null {
  const raw = (body ?? "").trim();
  if (!raw) return null;

  const v = version.trim().replace(/^v/i, "");
  const line = normalizeOneLine(raw.replace(/\*/g, "").replace(/_/g, ""));

  const redundantPatterns = [
    new RegExp(`^release\\s+v?${escapeReg(v)}$`, "i"),
    new RegExp(`^v?${escapeReg(v)}$`, "i"),
    new RegExp(`^version\\s+v?${escapeReg(v)}$`, "i"),
    new RegExp(`^relaycraft\\s+v?${escapeReg(v)}$`, "i"),
  ];

  if (redundantPatterns.some((re) => re.test(line))) return null;

  return raw;
}
