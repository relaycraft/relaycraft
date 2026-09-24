/**
 * Import-source seam for rule imports.
 *
 * This is the registry/dispatch point between "a file or pasted blob" and
 * `ruleStore.importBundle` / `importRulesZip`. Only the two first-party
 * RelayCraft sources are routed today:
 *
 * - `relaycraft-json` — the app's own JSON bundle / raw bundle / legacy
 *   single-rule exports. `detectRuleImportSource` routes by file extension
 *   only; `prepareJsonRuleImport` is what actually verifies the content is
 *   a RelayCraft shape.
 * - `legacy-zip` — any `*.zip` file routed to the legacy Rust importer.
 *   Extension-based routing ONLY: detection inspects the filename, not the
 *   archive bytes, and makes no claim that the ZIP is a RelayCraft export,
 *   let alone a safe one.
 *
 * A future third-party adapter (e.g. a Postman/Insomnia converter) must be
 * registered here with its own fixture-backed parser; do not extend the
 * whitelists below to guess at foreign formats. Anything that is not a
 * RelayCraft shape is rejected so foreign JSON cannot masquerade as a
 * RelayCraft bundle.
 */

export type RuleImportSourceId = "relaycraft-json" | "legacy-zip";

export type RuleImportSourceDetection =
  | { status: "supported"; sourceId: RuleImportSourceId }
  | { status: "unsupported"; sourceId: null };

/**
 * Route a picked file to an import source by extension only.
 *
 * IMPORTANT: this performs no content inspection. `"supported"` here means
 * "we have a route for this extension", never "this file is a valid or safe
 * RelayCraft artifact" — `.json` content is verified by
 * `prepareJsonRuleImport`, and `.zip` content is handed to the legacy
 * importer unchecked.
 */
export function detectRuleImportSource(filename: string): RuleImportSourceDetection {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return { status: "supported", sourceId: "relaycraft-json" };
  if (lower.endsWith(".zip")) return { status: "supported", sourceId: "legacy-zip" };
  return { status: "unsupported", sourceId: null };
}

export type PrepareRuleImportReason = "invalid_json" | "unsupported_shape";

export type PrepareRuleImportResult =
  | { status: "ok"; sourceId: "relaycraft-json"; payload: string }
  | { status: "invalid"; sourceId: "relaycraft-json"; reason: PrepareRuleImportReason };

/** Top-level keys produced by ruleStore.exportBundle (the `{bundle: ...}` wrapper). */
const WRAPPER_KEYS = new Set(["version", "type", "timestamp", "bundle"]);
/** Keys allowed inside `bundle` and on a raw top-level `{rules, groups}` object. */
const BUNDLE_KEYS = new Set(["version", "type", "timestamp", "groups", "rules", "ruleGroups"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(obj).every((key) => allowed.has(key));
}

/**
 * Normalize pasted/loaded JSON text into the string `importBundle` expects.
 *
 * Accepted RelayCraft shapes (unchanged semantics):
 * - `{version, type, timestamp, bundle: {groups, rules, ruleGroups}}` — v2 export wrapper
 * - `{rules: [...], groups?, ruleGroups?}` — raw bundle
 * - `{match, actions, ...}` — legacy single rule, wrapped as `{rules: [rule], groups: []}`
 *
 * Returns a typed invalid result instead of throwing; performs no
 * persistence — callers decide whether to invoke the store.
 */
export function prepareJsonRuleImport(text: string): PrepareRuleImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: "invalid", sourceId: "relaycraft-json", reason: "invalid_json" };
  }

  if (!isPlainObject(data)) {
    return { status: "invalid", sourceId: "relaycraft-json", reason: "unsupported_shape" };
  }

  // v2 export wrapper: `{bundle: {...}}` with only known sibling keys.
  if ("bundle" in data) {
    const bundle = data.bundle;
    if (
      !(
        hasOnlyKeys(data, WRAPPER_KEYS) &&
        isPlainObject(bundle) &&
        hasOnlyKeys(bundle, BUNDLE_KEYS) &&
        Array.isArray(bundle.rules)
      )
    ) {
      return { status: "invalid", sourceId: "relaycraft-json", reason: "unsupported_shape" };
    }
    // Pass the bundle shape through unchanged so group/ruleGroups mapping
    // stays exactly as the store handles it today.
    return { status: "ok", sourceId: "relaycraft-json", payload: JSON.stringify(data) };
  }

  // Raw bundle: `{rules: [...], ...}` with only known keys.
  if (Array.isArray(data.rules)) {
    if (!hasOnlyKeys(data, BUNDLE_KEYS)) {
      return { status: "invalid", sourceId: "relaycraft-json", reason: "unsupported_shape" };
    }
    return { status: "ok", sourceId: "relaycraft-json", payload: JSON.stringify(data) };
  }

  // Legacy single rule: `{match, actions, ...}` — rule fields evolve with
  // the app, so the discriminator is the match+actions pair, not a key
  // whitelist. Wrapped into the raw-bundle shape the store already accepts.
  if ("match" in data && "actions" in data) {
    return {
      status: "ok",
      sourceId: "relaycraft-json",
      payload: JSON.stringify({ rules: [data], groups: [] }),
    };
  }

  return { status: "invalid", sourceId: "relaycraft-json", reason: "unsupported_shape" };
}
