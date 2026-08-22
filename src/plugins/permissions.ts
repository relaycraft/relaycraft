/**
 * Plugin permission metadata — static frontend view over the permission strings
 * declared in plugin manifests and enforced by the Rust bridge registry
 * (`src-tauri/src/plugins/registry.rs`).
 *
 * i18n note: i18n.ts keeps i18next defaults, where ":" is the namespace
 * separator — permission ids like "proxy:read" cannot appear verbatim in keys.
 * Key segments therefore use underscores ("proxy_read"); see permissionKeySegment.
 */

import type { BridgeCommandSpec } from "./contract";

export type PermissionRisk = "low" | "medium" | "high";

export interface PermissionMeta {
  /** i18n key for the short permission label. */
  labelKey: string;
  /** i18n key for the description of what the permission allows. */
  descKey: string;
  risk: PermissionRisk;
}

/** Convert a manifest permission id to its i18n key segment. */
export function permissionKeySegment(permission: string): string {
  return permission.replace(/:/g, "_");
}

function meta(permission: string, risk: PermissionRisk): PermissionMeta {
  const segment = permissionKeySegment(permission);
  return {
    labelKey: `plugins.permissions.${segment}.label`,
    descKey: `plugins.permissions.${segment}.desc`,
    risk,
  };
}

/**
 * Metadata for all permissions known to the bridge registry.
 * Risk tiers: low = read-only, medium = writes / log access,
 * high = outbound network / AI / proxy mutation.
 */
export const PERMISSION_META: Record<string, PermissionMeta> = {
  "proxy:read": meta("proxy:read", "low"),
  "rules:read": meta("rules:read", "low"),
  "traffic:read": meta("traffic:read", "low"),
  "storage:read": meta("storage:read", "low"),
  "stats:read": meta("stats:read", "low"),
  "storage:write": meta("storage:write", "medium"),
  "rules:write": meta("rules:write", "medium"),
  "fs:read_logs": meta("fs:read_logs", "medium"),
  "network:outbound": meta("network:outbound", "high"),
  "ai:chat": meta("ai:chat", "high"),
  "proxy:write": meta("proxy:write", "high"),
};

/** Look up metadata for a permission id; unknown ids yield no entry. */
export function getPermissionMeta(permission: string): PermissionMeta | undefined {
  return PERMISSION_META[permission];
}

/**
 * Map each declared permission to the frontend API surfaces it unlocks,
 * resolved against the bridge contract. Alias commands are folded into their
 * canonical command (skipped here, since the canonical spec is listed too).
 * Unknown permissions are tolerated and map to an empty list.
 */
export function getPermissionUsage(
  permissions: string[],
  contract: BridgeCommandSpec[],
): Record<string, string[]> {
  const usage: Record<string, string[]> = {};
  for (const permission of permissions) {
    const surfaces: string[] = [];
    for (const spec of contract) {
      if (spec.permission !== permission) continue;
      if (spec.alias_of) continue;
      if (!surfaces.includes(spec.api_surface)) {
        surfaces.push(spec.api_surface);
      }
    }
    usage[permission] = surfaces;
  }
  return usage;
}
