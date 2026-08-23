//! In-memory per-session call statistics for the plugin bridge.
//!
//! Counts every registered `plugin_call` that reaches the permission gate —
//! both allowed calls and permission denials — keyed by
//! `(plugin_id, canonical_command)`. Not persisted; resets on app restart.

use crate::common::sync::lock_unpoisoned;
use crate::plugins::registry::{find_command, resolve_alias};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

/// Aggregated counters for one (plugin, command) pair.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CallStat {
    /// Calls that passed the permission gate.
    pub calls: u64,
    /// Calls denied by the permission gate.
    pub denied: u64,
    /// Last call time, same style as the app log timestamps.
    pub last_called_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginCallStatRow {
    pub plugin_id: String,
    pub command: String,
    pub calls: u64,
    pub denied: u64,
    pub last_called_at: String,
}

/// Tauri-managed state. `Mutex` mirrors `PluginCache`; call sites are short
/// and never hold the lock across an await.
#[derive(Debug, Default)]
pub struct PluginCallStats {
    inner: Mutex<HashMap<(String, String), CallStat>>,
}

impl PluginCallStats {
    /// Record one gated call. `command` must be the canonical command name
    /// (after `registry::resolve_alias`).
    pub fn record(&self, plugin_id: &str, command: &str, denied: bool) {
        let mut stats = lock_unpoisoned(&self.inner);
        let entry = stats
            .entry((plugin_id.to_string(), command.to_string()))
            .or_default();
        if denied {
            entry.denied += 1;
        } else {
            entry.calls += 1;
        }
        entry.last_called_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    }

    /// Snapshot all counters, sorted for a stable UI presentation.
    pub fn snapshot(&self) -> Vec<PluginCallStatRow> {
        let stats = lock_unpoisoned(&self.inner);
        let mut rows: Vec<PluginCallStatRow> = stats
            .iter()
            .map(|((plugin_id, command), stat)| PluginCallStatRow {
                plugin_id: plugin_id.clone(),
                command: command.clone(),
                calls: stat.calls,
                denied: stat.denied,
                last_called_at: stat.last_called_at.clone(),
            })
            .collect();
        rows.sort_by(|a, b| (&a.plugin_id, &a.command).cmp(&(&b.plugin_id, &b.command)));
        rows
    }
}

/// Per-call stats enriched with the registry contract (api_surface, domain)
/// of the canonical command. No plugin permission required — host UI data.
#[tauri::command]
pub fn get_plugin_call_stats(state: tauri::State<'_, PluginCallStats>) -> serde_json::Value {
    let rows: Vec<serde_json::Value> = state
        .snapshot()
        .into_iter()
        .map(|row| {
            let spec = find_command(&row.command).map(resolve_alias);
            serde_json::json!({
                "plugin_id": row.plugin_id,
                "command": row.command,
                "api_surface": spec.map(|s| s.api_surface),
                "domain": spec.map(|s| s.domain),
                "calls": row.calls,
                "denied": row.denied,
                "last_called_at": row.last_called_at,
            })
        })
        .collect();
    serde_json::Value::Array(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_counts_calls_and_denials() {
        let stats = PluginCallStats::default();
        stats.record("p1", "storage_get", false);
        stats.record("p1", "storage_get", false);
        stats.record("p1", "storage_get", true);

        let rows = stats.snapshot();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.plugin_id, "p1");
        assert_eq!(row.command, "storage_get");
        assert_eq!(row.calls, 2);
        assert_eq!(row.denied, 1);
        assert!(!row.last_called_at.is_empty());
    }

    #[test]
    fn record_is_keyed_per_plugin_and_command() {
        let stats = PluginCallStats::default();
        stats.record("p1", "storage_get", false);
        stats.record("p2", "storage_get", false);
        stats.record("p1", "storage_set", false);

        let rows = stats.snapshot();
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn alias_calls_merge_into_canonical_command() {
        let stats = PluginCallStats::default();
        // The bridge resolves aliases before recording; both of these land on
        // the canonical "traffic_list_flows" key.
        let alias = find_command("traffic_search_flows").unwrap();
        let canonical = resolve_alias(alias);
        stats.record("p1", canonical.command, false);
        stats.record("p1", "traffic_list_flows", false);

        let rows = stats.snapshot();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].command, "traffic_list_flows");
        assert_eq!(rows[0].calls, 2);
    }
}
