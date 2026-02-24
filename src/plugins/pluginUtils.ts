/**
 * Sanitizes a plugin ID to be used as a valid i18n namespace.
 * Replaces dots with underscores to avoid i18next key confusion.
 */
export function sanitizeNamespace(id: string, customNamespace?: string): string {
  const rawNs = customNamespace || id;
  // Optimization: If namespace is 'translation', we don't sanitize it with underscores
  // as it's the core system namespace.
  return rawNs === "translation" ? "translation" : rawNs.replace(/\./g, "_");
}
