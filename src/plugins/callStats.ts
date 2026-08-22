/**
 * Per-session plugin bridge call statistics, recorded by the Rust
 * `plugin_call` pipeline. Not persisted — counters reset on app restart.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ApiDomain } from "./contract";

/**
 * Aggregated counters for one (plugin, command) pair.
 * Field names match Rust's serde snake_case serialization.
 */
export interface PluginCallStat {
  plugin_id: string;
  /** Canonical command name (aliases are folded into it host-side). */
  command: string;
  api_surface: string;
  domain: ApiDomain;
  calls: number;
  /** Calls rejected by the permission gate. */
  denied: number;
  /** ISO-8601 timestamp of the most recent invocation. */
  last_called_at: string;
}

/** Fetch current-session call stats for all plugins. Not cached. */
export function getPluginCallStats(): Promise<PluginCallStat[]> {
  return invoke<PluginCallStat[]>("get_plugin_call_stats");
}
