/**
 * Config snapshot types — mirror the backend `snapshot.rs` response
 * structs (snake_case, matching the snapshot file schema itself).
 * See docs/config-snapshot-design.md.
 */

/** One changed portable setting: current vs incoming JSON value. */
export interface SnapshotSettingDiff {
  key: string;
  current: unknown;
  incoming: unknown;
}

/** Machine-bound field shown for opt-in; `changed` flags value drift. */
export interface SnapshotMachineBoundEntry {
  key: string;
  current: unknown;
  incoming: unknown;
  changed: boolean;
}

export interface SnapshotPluginPlan {
  id: string;
  version?: string;
  enabled: boolean;
}

export interface SnapshotPreview {
  name?: string | null;
  description?: string | null;
  requires_host?: string | null;
  host_version: string;
  /** False → snapshot requires a newer app; apply is blocked. */
  host_compatible: boolean;
  settings: SnapshotSettingDiff[];
  unchanged_settings: number;
  invalid_settings: string[];
  machine_bound: SnapshotMachineBoundEntry[];
  invalid_machine_bound: string[];
  /** Installed && snapshot-enabled && currently disabled. */
  plugins_restore: SnapshotPluginPlan[];
  /** Listed in the file but not installed — never auto-installed. */
  plugins_missing: SnapshotPluginPlan[];
  /** Installed and enabled-state already matches. */
  plugins_already_matching: SnapshotPluginPlan[];
  /** Installed+enabled locally but disabled in the file — left enabled. */
  plugins_not_restored: SnapshotPluginPlan[];
  /** Denylisted secret keys stripped from `settings` (dotted paths). */
  ignored_secrets: string[];
  /** Non-allowlisted keys ignored for forward compatibility. */
  ignored_unknown: string[];
  /** Incoming `upstream_proxy.url` embeds userinfo — flagged before apply. */
  proxy_credentials: boolean;
}

export interface SnapshotImportResult {
  applied_settings: number;
  unchanged_settings: number;
  skipped_settings: number;
  applied_machine_bound: number;
  plugins_enabled: number;
  missing_plugins: number;
  /** Write failed AND byte restore failed — config may be partial. */
  partial: boolean;
  /** Set when the config write failed (rollback outcome in `partial`). */
  error?: string | null;
  /** True when an applied value only takes effect after an engine/app restart. */
  restart_required: boolean;
}

export interface SnapshotExportResult {
  path: string;
  settings_count: number;
  plugin_count: number;
  /** `upstream_proxy.url` embeds userinfo — surfaced as a UI warning. */
  includes_proxy_credentials: boolean;
}
