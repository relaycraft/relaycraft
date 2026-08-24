/**
 * Normalize host-side plugin install errors so stage prefixes still match
 * after Tauri/JS wrap them as `Error: ...`.
 */
export function normalizeInstallErrorMessage(message: string): string {
  return message
    .trim()
    .replace(/^(error:\s*)+/i, "")
    .trim();
}

/**
 * Map a stage-tagged install error (`[manifest] ...`, `[archive] ...`,
 * `[filesystem] ...`) to a localized stage label plus the raw message.
 * Returns null when the error carries no stage prefix.
 */
export function stageAwareInstallMessage(
  errorMessage: string,
  translate: (key: string) => string,
): string | null {
  const normalized = normalizeInstallErrorMessage(errorMessage);
  const match = normalized.match(/^\[(manifest|archive|filesystem)\]/);
  if (!match) return null;
  return `${translate(`plugins.errors.installStage.${match[1]}`)}\n${normalized}`;
}
