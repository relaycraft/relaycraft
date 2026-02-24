use crate::config;
use crate::logging;
use crate::plugins::{resolve_plugin_path, PluginCache};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
pub struct PluginCallArgs {
    pub plugin_id: String,
    pub command: String,
    pub args: serde_json::Value,
}

#[tauri::command]
pub async fn plugin_call(
    payload: PluginCallArgs,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    // [AUDIT] Use system public logging for plugin bridge activity
    let _ = logging::write_domain_log(
        "audit",
        &format!(
            "[PluginBridge] Call from {}: {}",
            payload.plugin_id, payload.command
        ),
    );

    // 1. Verify Plugin installation and get manifest
    let app_dir = config::get_data_dir()?;
    let plugins_dir = app_dir.join("plugins");

    let _plugin_path = resolve_plugin_path(&plugins_dir, &payload.plugin_id)
        .ok_or_else(|| format!("Plugin not found: {}", payload.plugin_id))?;

    // 2. Get plugin manifest from cache (populate if empty)
    let cache = app.state::<PluginCache>();
    let plugin = {
        let cached = cache.plugins.lock().unwrap();

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
            let mut cached = cache.plugins.lock().unwrap();
            *cached = plugins;

            plugin
        }
    };

    let permissions = plugin.manifest.permissions.as_deref().unwrap_or(&[]);

    // 3. Permission Gatekeeper
    match payload.command.as_str() {
        "get_process_stats" => {
            if !permissions.contains(&"stats:read".to_string()) {
                return Err("Security Violation: Missing 'stats:read' permission".to_string());
            }
            let stats = crate::proxy::monitor::get_process_stats(app.state()).await?;
            Ok(serde_json::to_value(stats).map_err(|e| e.to_string())?)
        }
        "ai_chat_completion" => {
            if !permissions.contains(&"ai:chat".to_string()) {
                return Err("Security Violation: Missing 'ai:chat' permission".to_string());
            }
            // Parse messages from args: Vec<(String, String)>
            let messages: Vec<(String, String)> = serde_json::from_value(payload.args)
                .map_err(|e| format!("Invalid AI messages: {}", e))?;

            let response =
                crate::ai::commands::ai_chat_completion(messages, None, app.state()).await?;
            Ok(serde_json::to_value(response).map_err(|e| e.to_string())?)
        }
        _ => Err(format!(
            "Security Violation: Command '{}' is not registered in the bridge or is restricted.",
            payload.command
        )),
    }
}
