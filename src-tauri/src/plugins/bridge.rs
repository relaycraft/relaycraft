use crate::config;
use crate::logging;
use crate::plugins::{resolve_plugin_path, PluginCache};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Deserialize)]
pub struct PluginCallArgs {
    pub plugin_id: String,
    pub command: String,
    pub args: serde_json::Value,
}

/// Commands that require audit logging (security-sensitive operations)
const AUDITED_COMMANDS: &[&str] = &[
    "ai_chat_completion",  // AI API calls
    // Add more sensitive commands here as needed
];

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

    // [AUDIT] Only log security-sensitive commands, use plugin name for clarity
    if AUDITED_COMMANDS.contains(&payload.command.as_str()) {
        let plugin_name = &plugin.manifest.name;
        let _ = logging::write_domain_log(
            "audit",
            &format!(
                "[PluginBridge] {} called {}",
                plugin_name, payload.command
            ),
        );
    }

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
        // ── http.send ────────────────────────────────────────────────────────────
        "http_send" => {
            if !permissions.contains(&"network:outbound".to_string()) {
                return Err(
                    "Security Violation: Missing 'network:outbound' permission".to_string(),
                );
            }

            #[derive(serde::Deserialize)]
            struct HttpSendArgs {
                method: String,
                url: String,
                headers: Option<std::collections::HashMap<String, String>>,
                body: Option<String>,
            }

            let args: HttpSendArgs = serde_json::from_value(payload.args)
                .map_err(|e| format!("Invalid http_send args: {e}"))?;

            let req = crate::traffic::commands::ReplayRequest {
                method: args.method,
                url: args.url,
                headers: args.headers.unwrap_or_default(),
                body: args.body,
            };
            let response = crate::traffic::commands::replay_request_inner(req).await?;
            serde_json::to_value(response).map_err(|e| e.to_string())
        }

        // ── storage ──────────────────────────────────────────────────────────────
        "storage_get" => {
            let key = payload.args["key"]
                .as_str()
                .ok_or("storage_get: missing 'key'")?;
            let result =
                crate::plugins::storage::get(&payload.plugin_id, key).await?;
            Ok(serde_json::to_value(result).unwrap_or(serde_json::Value::Null))
        }
        "storage_set" => {
            let key = payload.args["key"]
                .as_str()
                .ok_or("storage_set: missing 'key'")?;
            let value = payload.args["value"]
                .as_str()
                .ok_or("storage_set: missing 'value'")?
                .to_string();
            crate::plugins::storage::set(&payload.plugin_id, key, value).await?;
            Ok(serde_json::Value::Null)
        }
        "storage_delete" => {
            let key = payload.args["key"]
                .as_str()
                .ok_or("storage_delete: missing 'key'")?;
            crate::plugins::storage::delete(&payload.plugin_id, key).await?;
            Ok(serde_json::Value::Null)
        }
        "storage_list" => {
            let prefix = payload.args["prefix"].as_str();
            let result =
                crate::plugins::storage::list(&payload.plugin_id, prefix).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "storage_clear" => {
            crate::plugins::storage::clear(&payload.plugin_id).await?;
            Ok(serde_json::Value::Null)
        }

        // ── rules.createMock ─────────────────────────────────────────────────────
        "rules_create_mock" => {
            if !permissions.contains(&"rules:write".to_string()) {
                return Err(
                    "Security Violation: Missing 'rules:write' permission".to_string(),
                );
            }

            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct CreateMockArgs {
                name: String,
                url_pattern: String,
                response_body: String,
                status_code: Option<u16>,
                content_type: Option<String>,
                method: Option<String>,
            }

            let args: CreateMockArgs = serde_json::from_value(payload.args)
                .map_err(|e| format!("Invalid rules_create_mock args: {e}"))?;

            let rule_id = uuid::Uuid::new_v4().to_string();

            // URL match atom — "contains" semantics so patterns like `/api/users` work broadly.
            let mut request_atoms = vec![crate::rules::model::MatchAtom {
                atom_type: "url".to_string(),
                match_type: "contains".to_string(),
                key: None,
                value: Some(serde_json::Value::String(args.url_pattern)),
                invert: None,
            }];

            // Optional method filter.
            if let Some(method) = args.method {
                request_atoms.push(crate::rules::model::MatchAtom {
                    atom_type: "method".to_string(),
                    match_type: "equals".to_string(),
                    key: None,
                    value: Some(serde_json::Value::String(method)),
                    invert: None,
                });
            }

            let rule = crate::rules::model::Rule {
                id: rule_id.clone(),
                name: args.name,
                r#type: crate::rules::model::RuleType::MapLocal,
                execution: crate::rules::model::RuleExecution {
                    enabled: true,
                    priority: 50,
                    stop_on_match: None,
                },
                match_config: crate::rules::model::RuleMatchConfig {
                    request: request_atoms,
                    response: vec![],
                },
                actions: vec![crate::rules::model::RuleAction::MapLocal(
                    crate::rules::model::MapLocalAction {
                        source: Some("manual".to_string()),
                        local_path: None,
                        content: Some(args.response_body),
                        content_type: Some(
                            args.content_type
                                .unwrap_or_else(|| "application/json".to_string()),
                        ),
                        status_code: Some(args.status_code.unwrap_or(200) as u32),
                        headers: None,
                    },
                )],
                tags: None,
                metadata: Some(crate::rules::model::RuleMetadata {
                    source: Some(format!("plugin:{}", payload.plugin_id)),
                    ai_intent: None,
                }),
            };

            crate::rules::storage::RuleStorage::from_config()
                .map_err(|e| e.to_string())?
                .save(&rule, None)
                .map_err(|e| e.to_string())?;

            // Notify frontend so the Rules panel refreshes immediately.
            let _ = app.emit("rules-changed", ());

            Ok(serde_json::to_value(rule_id).unwrap())
        }

        _ => Err(format!(
            "Security Violation: Command '{}' is not registered in the bridge or is restricted.",
            payload.command
        )),
    }
}
