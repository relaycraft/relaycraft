mod engine;
mod host;

use crate::common::sync::lock_unpoisoned;
use crate::config;
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
/// Audited commands record permission-gate denials and dispatch outcomes
/// (ok/error) as structured `plugin.call` audit events.
///
/// Error message wording (permission denials, unregistered commands) is
/// part of the plugin contract — the frontend matches on it verbatim.
/// Audit events are structured JSONL per `crate::audit`, not text the
/// frontend matches. Do not reword the error strings.
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

            let config = config::load_config_internal().unwrap_or_default();
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

    // 4. Permission Gatekeeper — table-driven via the registry spec.
    // Both outcomes are counted in the per-session call stats, keyed by the
    // canonical command name so aliases merge. Audited commands record the
    // denial before returning so rejected calls still leave an audit trail.
    let canonical = resolve_alias(spec);
    let permissions = plugin.manifest.permissions.as_deref().unwrap_or(&[]);
    let stats = app.state::<PluginCallStats>();
    if let Err(denial) = check_permission(canonical, permissions) {
        stats.record(&payload.plugin_id, canonical.command, true);
        if spec.audited {
            audit_plugin_call(
                &payload.plugin_id,
                &plugin.manifest.name,
                canonical.command,
                &payload.args,
                crate::audit::AuditResult::Denied,
                Some(&denial),
            );
        }
        return Err(denial);
    }
    stats.record(&payload.plugin_id, canonical.command, false);

    // Dispatch consumes `payload.args` in several arms; keep a copy for the
    // post-dispatch audit of security-sensitive commands.
    let audit_args = spec.audited.then(|| payload.args.clone());

    // 5. Dispatch to the domain handler, then record the outcome for
    // audited commands.
    let result = match spec.command {
        // ── host domain ──────────────────────────────────────────────────────
        "storage_get" => host::storage_get(&payload.plugin_id, &payload.args).await,
        "storage_set" => host::storage_set(&payload.plugin_id, &payload.args).await,
        "storage_delete" => host::storage_delete(&payload.plugin_id, &payload.args).await,
        "storage_list" => host::storage_list(&payload.plugin_id, &payload.args).await,
        "storage_clear" => host::storage_clear(&payload.plugin_id).await,
        "host_get_runtime" => host::host_get_runtime(&app).await,
        "ai_chat_completion" => {
            host::ai_chat_completion(&app, &payload.plugin_id, payload.args).await
        }
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
        "rules_disable_mock" => {
            engine::rules_disable_mock(&app, &payload.plugin_id, payload.args).await
        }
        "rules_get_own_mock" => engine::rules_get_own_mock(&payload.plugin_id, payload.args).await,
        // The registry guarantees every registered command has a dispatch arm.
        _ => Err(unregistered_command_error(&payload.command)),
    };

    if spec.audited {
        if let Some(args) = audit_args.as_ref() {
            match &result {
                Ok(_) => audit_plugin_call(
                    &payload.plugin_id,
                    &plugin.manifest.name,
                    canonical.command,
                    args,
                    crate::audit::AuditResult::Ok,
                    None,
                ),
                Err(e) => audit_plugin_call(
                    &payload.plugin_id,
                    &plugin.manifest.name,
                    canonical.command,
                    args,
                    crate::audit::AuditResult::Error,
                    Some(e),
                ),
            }
        }
    }
    result
}

/// Record one `plugin.call` audit event. `detail_override` carries the
/// denial/error text; successful calls only get a detail for `http_send`
/// (a sanitized request line — never headers or body).
fn audit_plugin_call(
    plugin_id: &str,
    plugin_name: &str,
    command: &str,
    args: &serde_json::Value,
    result: crate::audit::AuditResult,
    detail_override: Option<&str>,
) {
    let detail = detail_override.map(str::to_string).or_else(|| {
        if command == "http_send" {
            http_send_audit_detail(args)
        } else {
            None
        }
    });
    let mut event =
        crate::audit::AuditEvent::plugin(plugin_id, Some(plugin_name.to_string()), "plugin.call")
            .target(command)
            .result(result);
    if let Some(detail) = detail {
        event = event.detail(detail);
    }
    crate::audit::audit(event);
}

/// "GET https://api.example.com/v1/users" — method plus a sanitized URL for
/// `http_send` audit details. Query, fragment and userinfo are stripped so
/// request credentials never reach the audit log.
fn http_send_audit_detail(args: &serde_json::Value) -> Option<String> {
    let method = args.get("method").and_then(|v| v.as_str())?;
    let url = args.get("url").and_then(|v| v.as_str())?;
    let sanitized = sanitize_audit_url(url)?;
    Some(format!("{} {}", method.to_uppercase(), sanitized))
}

fn sanitize_audit_url(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_tail = trimmed
        .split(|c| c == '?' || c == '#')
        .next()
        .unwrap_or(trimmed);
    let (scheme, rest) = match without_tail.find("://") {
        Some(idx) => (&without_tail[..idx + 3], &without_tail[idx + 3..]),
        None => ("", without_tail),
    };
    let slash = rest.find('/');
    let (authority, path) = match slash {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    // Userinfo is the part before the last '@' inside the authority.
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    if host_port.is_empty() {
        return None;
    }
    Some(format!("{}{}{}", scheme, host_port, path))
}

#[cfg(test)]
mod tests {
    use super::{http_send_audit_detail, sanitize_audit_url};
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
        ("rules_disable_mock", ApiDomain::Engine),
        ("rules_get_own_mock", ApiDomain::Engine),
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

    #[test]
    fn http_send_audit_detail_strips_query_fragment_and_userinfo() {
        let args = serde_json::json!({
            "method": "post",
            "url": "https://user:secret@api.example.com:8443/v1/send?token=abc#frag",
            "headers": {"Authorization": "Bearer x"},
            "body": "secret-body"
        });
        assert_eq!(
            http_send_audit_detail(&args).as_deref(),
            Some("POST https://api.example.com:8443/v1/send")
        );
    }

    #[test]
    fn http_send_audit_detail_handles_schemeless_and_path_at() {
        let args =
            serde_json::json!({"method": "GET", "url": "user:pw@host.local:8080/users/@me?x=1"});
        assert_eq!(
            http_send_audit_detail(&args).as_deref(),
            Some("GET host.local:8080/users/@me")
        );
        // '@' inside the path is not userinfo.
        let args = serde_json::json!({"method": "GET", "url": "https://h.test/users/@me"});
        assert_eq!(
            http_send_audit_detail(&args).as_deref(),
            Some("GET https://h.test/users/@me")
        );
        // Missing fields produce no detail rather than a panic.
        assert!(http_send_audit_detail(&serde_json::json!({})).is_none());
    }
}
