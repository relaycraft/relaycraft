mod engine;
mod host;

use crate::common::sync::lock_unpoisoned;
use crate::config;
use crate::logging;
use crate::plugins::registry::{
    check_permission, find_command, resolve_alias, unregistered_command_error,
};
use crate::plugins::stats::PluginCallStats;
use crate::plugins::{resolve_plugin_path, PluginCache};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
pub struct PluginCallArgs {
    pub plugin_id: String,
    pub command: String,
    pub args: serde_json::Value,
}

/// Unified bridge pipeline:
/// resolve plugin → manifest (with cache backfill) → registry lookup →
/// audit logging → table-driven permission gate → domain handler dispatch.
///
/// Audited commands are logged before the permission gate so that denied
/// calls still leave an audit trail (plugin misbehavior is exactly what the
/// audit log is for).
///
/// Error message wording (permission denials, unregistered commands, the
/// audit log format) is part of the plugin contract — the frontend matches
/// on it verbatim. Do not reword.
#[tauri::command]
pub async fn plugin_call(
    payload: PluginCallArgs,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    // 1. Verify Plugin installation and get manifest
    let app_dir = config::get_data_dir()?;
    let plugins_dir = app_dir.join("plugins");

    let _plugin_path = resolve_plugin_path(&plugins_dir, &payload.plugin_id)
        .ok_or_else(|| format!("Plugin not found: {}", payload.plugin_id))?;

    // 2. Get plugin manifest from cache (populate if empty)
    let cache = app.state::<PluginCache>();
    let plugin = {
        let cached = lock_unpoisoned(&cache.plugins);

        // Try to find in cache
        if let Some(p) = cached.iter().find(|p| p.manifest.id == payload.plugin_id) {
            p.clone()
        } else {
            // Cache is empty or missing this plugin, refresh
            // Drop the lock before refreshing
            drop(cached);

            let config = config::load_config().unwrap_or_default();
            let plugins = crate::plugins::discover_plugins(&plugins_dir, &config.enabled_plugins);
            let plugin = plugins
                .iter()
                .find(|p| p.manifest.id == payload.plugin_id)
                .ok_or_else(|| "Plugin manifest not found during bridge check".to_string())?
                .clone();

            // Update cache
            let mut cached = lock_unpoisoned(&cache.plugins);
            *cached = plugins;

            plugin
        }
    };

    // 3. Registry lookup — unregistered commands are rejected.
    let spec = find_command(&payload.command)
        .ok_or_else(|| unregistered_command_error(&payload.command))?;

    // 4. [AUDIT] Log security-sensitive commands before the gate so denied
    // calls are still audited. Use plugin name for clarity.
    if spec.audited {
        let plugin_name = &plugin.manifest.name;
        if let Err(e) = logging::write_domain_log(
            "audit",
            &format!("[PluginBridge] {} called {}", plugin_name, payload.command),
        ) {
            log::warn!("Failed to write plugin audit log: {e}");
        }
    }

    // 5. Permission Gatekeeper — table-driven via the registry spec.
    // Both outcomes are counted in the per-session call stats, keyed by the
    // canonical command name so aliases merge.
    let canonical = resolve_alias(spec);
    let permissions = plugin.manifest.permissions.as_deref().unwrap_or(&[]);
    let stats = app.state::<PluginCallStats>();
    if let Err(denial) = check_permission(canonical, permissions) {
        stats.record(&payload.plugin_id, canonical.command, true);
        return Err(denial);
    }
    stats.record(&payload.plugin_id, canonical.command, false);

    // 6. Dispatch to the domain handler.
    match spec.command {
        // ── host domain ──────────────────────────────────────────────────────
        "storage_get" => host::storage_get(&payload.plugin_id, &payload.args).await,
        "storage_set" => host::storage_set(&payload.plugin_id, &payload.args).await,
        "storage_delete" => host::storage_delete(&payload.plugin_id, &payload.args).await,
        "storage_list" => host::storage_list(&payload.plugin_id, &payload.args).await,
        "storage_clear" => host::storage_clear(&payload.plugin_id).await,
        "host_get_runtime" => host::host_get_runtime(&app).await,
        "ai_chat_completion" => host::ai_chat_completion(&app, payload.args).await,
        "get_process_stats" => host::get_process_stats(&app).await,
        "http_send" => host::http_send(payload.args).await,
        // ── engine domain ────────────────────────────────────────────────────
        "get_proxy_status" => engine::get_proxy_status(&app).await,
        "traffic_list_flows" | "traffic_search_flows" => {
            engine::traffic_list_flows(payload.args).await
        }
        "traffic_get_flow" => engine::traffic_get_flow(&payload.args).await,
        "rules_create_mock" => {
            engine::rules_create_mock(&app, &payload.plugin_id, payload.args).await
        }
        "rules_list" => engine::rules_list(payload.args).await,
        "rules_get" => engine::rules_get(&payload.args).await,
        // The registry guarantees every registered command has a dispatch arm.
        _ => Err(unregistered_command_error(&payload.command)),
    }
}

#[cfg(test)]
mod tests {
    use crate::plugins::registry::{find_command, ApiDomain};

    /// Every command dispatched above must have a registry spec, and vice
    /// versa. Handwritten mirror of the dispatch match; keep in sync.
    const DISPATCHED: &[(&str, ApiDomain)] = &[
        ("storage_get", ApiDomain::Host),
        ("storage_set", ApiDomain::Host),
        ("storage_delete", ApiDomain::Host),
        ("storage_list", ApiDomain::Host),
        ("storage_clear", ApiDomain::Host),
        ("host_get_runtime", ApiDomain::Host),
        ("ai_chat_completion", ApiDomain::Host),
        ("get_process_stats", ApiDomain::Host),
        ("http_send", ApiDomain::Host),
        ("get_proxy_status", ApiDomain::Engine),
        ("traffic_list_flows", ApiDomain::Engine),
        ("traffic_search_flows", ApiDomain::Engine),
        ("traffic_get_flow", ApiDomain::Engine),
        ("rules_create_mock", ApiDomain::Engine),
        ("rules_list", ApiDomain::Engine),
        ("rules_get", ApiDomain::Engine),
    ];

    #[test]
    fn every_dispatched_command_has_a_spec_in_the_right_domain() {
        let registered: Vec<&str> = crate::plugins::registry::BRIDGE_COMMANDS
            .iter()
            .map(|s| s.command)
            .collect();
        assert_eq!(
            registered.len(),
            DISPATCHED.len(),
            "registry and dispatch match are out of sync: {registered:?}"
        );
        for (command, domain) in DISPATCHED {
            let spec = find_command(command).expect("dispatched command must be registered");
            assert_eq!(
                &spec.domain, domain,
                "domain mismatch for {command}: registry vs dispatch"
            );
        }
    }
}
