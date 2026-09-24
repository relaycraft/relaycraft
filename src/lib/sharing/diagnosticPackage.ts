/**
 * Metadata-only diagnostic package for a single HTTP flow.
 *
 * The package deliberately contains NO flow id, host, URL path/query,
 * headers, cookies, bodies, original timestamps, `_rc` extensions, rule
 * names, MIME types or local paths — only the coarse fields listed in
 * {@link DiagnosticPackageEntry}. The only free-form content is `note`,
 * which is user-entered text written verbatim; it may contain secrets and
 * is never sanitized, so callers must warn the user before saving.
 *
 * This module is pure: no I/O, no Tauri imports.
 */

import type { Flow } from "../../types";

export const DIAGNOSTIC_PACKAGE_KIND = "relaycraft-diagnostic";
export const DIAGNOSTIC_PACKAGE_VERSION = 1;
/** User note limit (characters). */
export const DIAGNOSTIC_NOTE_MAX_LENGTH = 2000;
/** Max file size accepted when opening a package (checked before parsing). */
export const DIAGNOSTIC_PACKAGE_MAX_BYTES = 64 * 1024;

export type DiagnosticScheme = "http" | "https" | "other";

export interface DiagnosticPackageEntry {
  method: string;
  status: number | null;
  scheme: DiagnosticScheme;
}

export interface DiagnosticPackage {
  kind: typeof DIAGNOSTIC_PACKAGE_KIND;
  version: typeof DIAGNOSTIC_PACKAGE_VERSION;
  createdAt: string;
  entries: DiagnosticPackageEntry[];
  note: string;
}

/** Stable machine-readable error codes, mapped to i18n keys by callers. */
export type DiagnosticPackageErrorCode =
  | "no_flow"
  | "unsupported_flow"
  | "note_too_long"
  | "file_too_large"
  | "invalid_json"
  | "invalid_package";

export class DiagnosticPackageError extends Error {
  readonly code: DiagnosticPackageErrorCode;

  constructor(code: DiagnosticPackageErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DiagnosticPackageError";
    this.code = code;
  }
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
/** The only method values a v1 package may contain: allowlist + "OTHER". */
const PARSE_METHODS = new Set<string>([...ALLOWED_METHODS, "OTHER"]);
const PACKAGE_KEYS = new Set(["kind", "version", "createdAt", "entries", "note"]);
const ENTRY_KEYS = new Set(["method", "status", "scheme"]);
const SCHEMES = new Set<DiagnosticScheme>(["http", "https", "other"]);

function normalizeMethod(raw: unknown): string {
  if (typeof raw !== "string") return "OTHER";
  const method = raw.trim().toUpperCase();
  return ALLOWED_METHODS.has(method) ? method : "OTHER";
}

function normalizeStatus(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= 100 && raw <= 599 ? raw : null;
}

function normalizeScheme(rawUrl: unknown): DiagnosticScheme {
  if (typeof rawUrl !== "string" || !rawUrl) return "other";
  try {
    const protocol = new URL(rawUrl).protocol.replace(/:$/, "").toLowerCase();
    return protocol === "http" || protocol === "https" ? protocol : "other";
  } catch {
    return "other";
  }
}

/**
 * Build a v1 diagnostic package from a freshly fetched flow.
 *
 * Throws `DiagnosticPackageError` when the flow is absent or is a
 * WebSocket/SSE flow (metadata-only export is intentionally limited to
 * plain HTTP), or when `note` exceeds {@link DIAGNOSTIC_NOTE_MAX_LENGTH}.
 */
export function buildDiagnosticPackage(
  flow: Pick<Flow, "request" | "response" | "_rc"> | null | undefined,
  note: string,
): DiagnosticPackage {
  if (!flow) {
    throw new DiagnosticPackageError("no_flow", "No flow selected");
  }
  if (flow._rc?.isWebsocket || flow._rc?.isSse) {
    throw new DiagnosticPackageError("unsupported_flow", "WebSocket/SSE flows are not supported");
  }
  if (typeof note !== "string") {
    throw new DiagnosticPackageError("invalid_package", "Note must be a string");
  }
  if (note.length > DIAGNOSTIC_NOTE_MAX_LENGTH) {
    throw new DiagnosticPackageError(
      "note_too_long",
      `Note exceeds ${DIAGNOSTIC_NOTE_MAX_LENGTH} characters`,
    );
  }

  return {
    kind: DIAGNOSTIC_PACKAGE_KIND,
    version: DIAGNOSTIC_PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    entries: [
      {
        method: normalizeMethod(flow.request?.method),
        status: normalizeStatus(flow.response?.status),
        scheme: normalizeScheme(flow.request?.url),
      },
    ],
    note,
  };
}

/** The exact bytes that will be written to disk — preview must show this. */
export function serializeDiagnosticPackage(pkg: DiagnosticPackage): string {
  return JSON.stringify(pkg, null, 2);
}

function fail(code: DiagnosticPackageErrorCode, message: string): never {
  throw new DiagnosticPackageError(code, message);
}

function requireKeys(obj: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail("invalid_package", `Unknown field: ${key}`);
    }
  }
}

/** Canonical ISO-8601 UTC form, e.g. "2024-01-01T00:00:00.000Z". */
function isCanonicalIsoUtc(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

/**
 * Strictly parse a diagnostic package from file text.
 *
 * Read-only validation: the result is never executed, replayed or applied.
 * Rejects wrong kind/version, unknown fields, wrong field types, over-long
 * notes, malformed timestamps, any entry count other than one, and files
 * larger than {@link DIAGNOSTIC_PACKAGE_MAX_BYTES}.
 *
 * Size is enforced twice by design: callers `stat()` the file and refuse
 * oversized files before reading, and this function re-checks the decoded
 * byte length before `JSON.parse` so a file that grew between stat and
 * read (TOCTOU) is still rejected.
 */
export function parseDiagnosticPackage(text: string): DiagnosticPackage {
  if (typeof text !== "string" || text.length === 0) {
    fail("invalid_json", "Empty diagnostic package");
  }
  if (new TextEncoder().encode(text).byteLength > DIAGNOSTIC_PACKAGE_MAX_BYTES) {
    fail("file_too_large", `Diagnostic package exceeds ${DIAGNOSTIC_PACKAGE_MAX_BYTES} bytes`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("invalid_json", "Diagnostic package is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("invalid_package", "Diagnostic package must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  requireKeys(obj, PACKAGE_KEYS);

  if (obj.kind !== DIAGNOSTIC_PACKAGE_KIND) {
    fail("invalid_package", "Not a RelayCraft diagnostic package");
  }
  if (obj.version !== DIAGNOSTIC_PACKAGE_VERSION) {
    fail("invalid_package", `Unsupported diagnostic package version: ${String(obj.version)}`);
  }
  if (typeof obj.createdAt !== "string" || !isCanonicalIsoUtc(obj.createdAt)) {
    fail("invalid_package", "createdAt must be a canonical ISO-8601 UTC timestamp");
  }
  if (typeof obj.note !== "string" || obj.note.length > DIAGNOSTIC_NOTE_MAX_LENGTH) {
    fail("invalid_package", "note is missing, not a string, or too long");
  }
  // The exporter emits exactly one entry per package.
  if (!Array.isArray(obj.entries) || obj.entries.length !== 1) {
    fail("invalid_package", "entries must contain exactly one entry");
  }

  const entries: DiagnosticPackageEntry[] = obj.entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail("invalid_package", "entry must be an object");
    }
    const e = entry as Record<string, unknown>;
    requireKeys(e, ENTRY_KEYS);
    if (typeof e.method !== "string" || !PARSE_METHODS.has(e.method)) {
      fail("invalid_package", "entry.method is not an allowed method value");
    }
    if (e.status !== null && normalizeStatus(e.status) === null) {
      fail("invalid_package", "entry.status must be an integer in 100..599 or null");
    }
    if (typeof e.scheme !== "string" || !SCHEMES.has(e.scheme as DiagnosticScheme)) {
      fail("invalid_package", "entry.scheme must be http, https or other");
    }
    return {
      method: e.method,
      status: e.status as number | null,
      scheme: e.scheme as DiagnosticScheme,
    };
  });

  return {
    kind: DIAGNOSTIC_PACKAGE_KIND,
    version: DIAGNOSTIC_PACKAGE_VERSION,
    createdAt: obj.createdAt,
    entries,
    note: obj.note,
  };
}
