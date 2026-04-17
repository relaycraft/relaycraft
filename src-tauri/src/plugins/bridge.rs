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

#[derive(Debug, Deserialize)]
struct PluginAIMessageObject {
    role: String,
    content: String,
}

fn parse_plugin_ai_messages(args: serde_json::Value) -> Result<Vec<(String, String)>, String> {
    let serde_json::Value::Array(items) = args else {
        return Err(
            "Invalid AI messages: expected [[role, content], ...] or [{ role, content }, ...]"
                .to_string(),
        );
    };

    if items.is_empty() {
        return Ok(Vec::new());
    }

    let all_tuple_shape = items
        .iter()
        .all(|item| matches!(item, serde_json::Value::Array(arr) if arr.len() == 2));
    if all_tuple_shape {
        return serde_json::from_value::<Vec<(String, String)>>(serde_json::Value::Array(items))
            .map_err(|e| format!("Invalid AI messages: {}", e));
    }

    let all_object_shape = items
        .iter()
        .all(|item| matches!(item, serde_json::Value::Object(map) if map.contains_key("role") && map.contains_key("content")));
    if all_object_shape {
        return serde_json::from_value::<Vec<PluginAIMessageObject>>(serde_json::Value::Array(items))
            .map(|object_messages| {
                object_messages
                    .into_iter()
                    .map(|m| (m.role, m.content))
                    .collect()
            })
            .map_err(|e| format!("Invalid AI messages: {}", e));
    }

    Err(
        "Invalid AI messages: mixed/unsupported message shape. Use only [[role, content], ...] or [{ role, content }, ...]"
            .to_string(),
    )
}

/// Commands that require audit logging (security-sensitive operations)
const AUDITED_COMMANDS: &[&str] = &[
    "ai_chat_completion",  // AI API calls
    // Add more sensitive commands here as needed
];

fn truncate_utf8(input: &str, max_bytes: usize) -> (String, bool) {
    if input.len() <= max_bytes {
        return (input.to_string(), false);
    }
    let mut cut = max_bytes;
    while cut > 0 && !input.is_char_boundary(cut) {
        cut -= 1;
    }
    (input[..cut].to_string(), true)
}

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
        "get_proxy_status" => {
            if !permissions.contains(&"proxy:read".to_string()) {
                return Err("Security Violation: Missing 'proxy:read' permission".to_string());
            }
            let status = crate::proxy::get_proxy_status(app.state()).await?;
            Ok(serde_json::to_value(status).map_err(|e| e.to_string())?)
        }
        "ai_chat_completion" => {
            if !permissions.contains(&"ai:chat".to_string()) {
                return Err("Security Violation: Missing 'ai:chat' permission".to_string());
            }
            // Accept both tuple arrays and object arrays for compatibility:
            // [["user","hi"], ...] OR [{ role: "user", content: "hi" }, ...]
            let messages = parse_plugin_ai_messages(payload.args)?;

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
                rule_id: Option<String>,
                name: String,
                url_pattern: String,
                response_body: String,
                status_code: Option<u16>,
                content_type: Option<String>,
                response_headers: Option<std::collections::HashMap<String, String>>,
                method: Option<String>,
            }

            let args: CreateMockArgs = serde_json::from_value(payload.args)
                .map_err(|e| format!("Invalid rules_create_mock args: {e}"))?;

            let rule_id = uuid::Uuid::new_v4().to_string();

            // Load existing rules for conflict resolution and priority calculation.
            let storage = crate::rules::storage::RuleStorage::from_config()
                .map_err(|e| e.to_string())?;
            let mut next_priority: i32 = 10;
            let plugin_source = format!("plugin:{}", payload.plugin_id);
            let new_method = args.method.as_ref().map(|m| m.to_ascii_uppercase());
            let mut target_group_id: Option<String> = None;
            let mut rules_to_disable: Vec<(crate::rules::model::Rule, String)> = Vec::new();
            let mut target_rule_id = rule_id.clone();
            let mut target_priority: Option<i32> = None;
            if let Ok(existing) = storage.load_all() {
                // Compute next priority: max(existing) + 10
                next_priority = existing
                    .rules
                    .iter()
                    .map(|e| e.rule.execution.priority)
                    .max()
                    .map(|m| m + 10)
                    .unwrap_or(10);

                if let Some(existing_rule_id) = args.rule_id.as_deref() {
                    if let Some(entry) = existing.rules.iter().find(|entry| entry.rule.id == existing_rule_id) {
                        let existing_rule = &entry.rule;
                        if existing_rule.metadata.as_ref().and_then(|m| m.source.as_deref()) != Some(&plugin_source) {
                            return Err("Security Violation: Cannot update mock rule owned by another source".to_string());
                        }
                        if existing_rule.r#type != crate::rules::model::RuleType::MapLocal {
                            return Err("Only map_local mock rules can be updated via rules.createMock".to_string());
                        }
                        target_group_id = Some(entry.group_id.clone());
                        target_rule_id = existing_rule.id.clone();
                        target_priority = Some(existing_rule.execution.priority);
                    }
                }

                // Auto-disable existing enabled mock rules from the same plugin
                // whose match scope overlaps with the new rule (same URL + overlapping method scope),
                // so the new rule takes effect immediately without being shadowed.
                for entry in &existing.rules {
                    let r = &entry.rule;
                    if args.rule_id.as_deref() == Some(r.id.as_str()) { continue; }
                    if !r.execution.enabled { continue; }
                    if r.r#type != crate::rules::model::RuleType::MapLocal { continue; }
                    if r.metadata.as_ref().and_then(|m| m.source.as_deref()) != Some(&plugin_source) {
                        continue;
                    }
                    let same_url = r.match_config.request.iter().any(|atom| {
                        atom.atom_type == "url"
                            && atom.value.as_ref().map(|v| v.as_str()) == Some(Some(&args.url_pattern))
                    });
                    if !same_url {
                        continue;
                    }

                    // Method overlap rules:
                    // - New rule without method => overlaps all existing methods
                    // - Existing rule without method => overlaps any new method
                    // - Otherwise overlap only when methods are equal (case-insensitive)
                    let existing_methods: Option<std::collections::HashSet<String>> = r
                        .match_config
                        .request
                        .iter()
                        .find(|atom| atom.atom_type == "method")
                        .map(|atom| {
                            let mut set = std::collections::HashSet::new();
                            if let Some(val) = atom.value.as_ref() {
                                match val {
                                    serde_json::Value::String(s) => {
                                        set.insert(s.to_ascii_uppercase());
                                    }
                                    serde_json::Value::Array(arr) => {
                                        for item in arr {
                                            if let Some(s) = item.as_str() {
                                                set.insert(s.to_ascii_uppercase());
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            set
                        });
                    let method_overlaps = match (&new_method, &existing_methods) {
                        (None, _) => true,
                        (Some(_), None) => true,
                        (Some(m), Some(set)) => set.contains(m),
                    };
                    if method_overlaps {
                        let mut disabled = r.clone();
                        disabled.execution.enabled = false;
                        if target_group_id.is_none() {
                            target_group_id = Some(entry.group_id.clone());
                        }
                        rules_to_disable.push((disabled, entry.group_id.clone()));
                    }
                }
            }

            // URL match atom — use wildcard semantics so `*` patterns work as expected.
            let mut request_atoms = vec![crate::rules::model::MatchAtom {
                atom_type: "url".to_string(),
                match_type: "wildcard".to_string(),
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

            // Optional response header overrides for map_local action.
            // `content-type` is managed by `content_type` field above to avoid duplication.
            let response_header_ops: Vec<crate::rules::model::HeaderOperation> = args
                .response_headers
                .unwrap_or_default()
                .into_iter()
                .filter_map(|(key, value)| {
                    let trimmed_key = key.trim().to_string();
                    if trimmed_key.is_empty() || trimmed_key.eq_ignore_ascii_case("content-type") {
                        return None;
                    }
                    Some(crate::rules::model::HeaderOperation {
                        operation: "set".to_string(),
                        key: trimmed_key,
                        value: Some(value),
                    })
                })
                .collect();

            let mock_headers = if response_header_ops.is_empty() {
                None
            } else {
                Some(crate::rules::model::HeaderConfig {
                    request: vec![],
                    response: response_header_ops,
                })
            };

            let rule = crate::rules::model::Rule {
                id: target_rule_id.clone(),
                name: args.name,
                r#type: crate::rules::model::RuleType::MapLocal,
                execution: crate::rules::model::RuleExecution {
                    enabled: true,
                    priority: target_priority.unwrap_or(next_priority),
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
                        headers: mock_headers,
                    },
                )],
                tags: None,
                metadata: Some(crate::rules::model::RuleMetadata {
                    source: Some(plugin_source),
                    ai_intent: None,
                }),
            };

            for (disabled, group_id) in rules_to_disable {
                storage
                    .save(&disabled, Some(&group_id))
                    .map_err(|e| e.to_string())?;
            }

            storage
                .save(&rule, target_group_id.as_deref())
                .map_err(|e| e.to_string())?;

            // Notify frontend so the Rules panel refreshes immediately.
            let _ = app.emit("rules-changed", ());

            Ok(serde_json::to_value(target_rule_id).unwrap())
        }

        // ── rules.list ───────────────────────────────────────────────────────────
        "rules_list" => {
            if !permissions.contains(&"rules:read".to_string()) {
                return Err("Security Violation: Missing 'rules:read' permission".to_string());
            }
            use crate::rules::storage::RuleStorage;

            #[derive(serde::Deserialize, Default)]
            #[serde(rename_all = "camelCase")]
            struct RulesListFilter {
                enabled: Option<bool>,
                source: Option<String>,
                r#type: Option<String>,
            }

            let filter: RulesListFilter = serde_json::from_value(payload.args)
                .unwrap_or_default();

            let storage = RuleStorage::from_config().map_err(|e| e.to_string())?;
            let loaded = storage.load_all().map_err(|e| e.to_string())?;

            let rules: Vec<serde_json::Value> = loaded.rules.iter()
                .filter(|entry| {
                    let r = &entry.rule;
                    if let Some(enabled) = filter.enabled {
                        if r.execution.enabled != enabled { return false; }
                    }
                    if let Some(ref source) = filter.source {
                        let rule_source = r.metadata.as_ref()
                            .and_then(|m| m.source.as_deref())
                            .unwrap_or("user");
                        if rule_source != source { return false; }
                    }
                    if let Some(ref type_str) = filter.r#type {
                        let rule_type = serde_json::to_value(&r.r#type)
                            .ok()
                            .and_then(|v| v.as_str().map(|s| s.to_string()))
                            .unwrap_or_default();
                        if &rule_type != type_str { return false; }
                    }
                    true
                })
                .map(|entry| {
                    let r = &entry.rule;
                    let url_pattern = r.match_config.request.iter()
                        .find(|a| a.atom_type == "url")
                        .and_then(|a| a.value.as_ref()?.as_str().map(|s| s.to_string()))
                        .unwrap_or_default();
                    let source = r.metadata.as_ref()
                        .and_then(|m| m.source.as_deref())
                        .unwrap_or("user");
                    serde_json::json!({
                        "id": r.id,
                        "name": r.name,
                        "type": r.r#type,
                        "enabled": r.execution.enabled,
                        "priority": r.execution.priority,
                        "urlPattern": url_pattern,
                        "source": source,
                        "groupId": entry.group_id
                    })
                })
                .collect();

            Ok(serde_json::to_value(rules).unwrap())
        }

        // ── rules.get ────────────────────────────────────────────────────────────
        "rules_get" => {
            if !permissions.contains(&"rules:read".to_string()) {
                return Err("Security Violation: Missing 'rules:read' permission".to_string());
            }
            use crate::rules::storage::RuleStorage;

            let id = payload.args["id"].as_str()
                .ok_or("Invalid Args: missing 'id'")?;

            let storage = RuleStorage::from_config().map_err(|e| e.to_string())?;
            let loaded = storage.load_all().map_err(|e| e.to_string())?;

            let entry = loaded.rules.into_iter()
                .find(|e| e.rule.id == id)
                .ok_or_else(|| format!("Host Error: rule '{}' not found", id))?;

            Ok(serde_json::to_value(&entry.rule).map_err(|e| e.to_string())?)
        }

        // ── host.getRuntime ──────────────────────────────────────────────────────
        "host_get_runtime" => {
            // No permission required — only exposes non-sensitive runtime info.
            let config = crate::config::load_config().unwrap_or_default();
            let proxy_status = crate::proxy::get_proxy_status(app.state()).await?;
            let mcp_state = app.state::<crate::mcp::McpState>();
            let mcp_running = mcp_state.running.load(std::sync::atomic::Ordering::Relaxed);
            let mcp_port = *mcp_state.port.lock().unwrap();

            Ok(serde_json::json!({
                "proxyPort": config.proxy_port,
                "proxyRunning": proxy_status.running,
                "proxyActive": proxy_status.active,
                "mcpEnabled": config.mcp_config.enabled,
                "mcpRunning": mcp_running,
                "mcpPort": mcp_port,
            }))
        }

        // ── traffic.listFlows (compat: traffic.searchFlows) ─────────────────────
        "traffic_list_flows" | "traffic_search_flows" => {
            if !permissions.contains(&"traffic:read".to_string()) {
                return Err("Security Violation: Missing 'traffic:read' permission".to_string());
            }

            #[derive(serde::Deserialize, Default)]
            #[serde(rename_all = "camelCase")]
            struct ListFlowsArgs {
                session_id: Option<String>,
                method: Option<String>,
                host: Option<String>,
                url_pattern: Option<String>,
                status: Option<String>,
                #[serde(default)]
                offset: usize,
                #[serde(default = "default_flow_limit")]
                limit: usize,
            }
            fn default_flow_limit() -> usize { 100 }

            let args: ListFlowsArgs = serde_json::from_value(payload.args)
                .map_err(|e| format!("Invalid Args: {e}"))?;
            let limit = args.limit.min(1000);

            let engine_port = crate::config::load_config()
                .map(|c| c.proxy_port)
                .unwrap_or(9090);

            let mut url = format!("http://127.0.0.1:{engine_port}/_relay/poll?since=0");
            if let Some(ref sid) = args.session_id {
                url.push_str(&format!("&session_id={sid}"));
            }

            let client = reqwest::Client::new();
            let resp = client.get(&url).send().await
                .map_err(|e| format!("Host Error: cannot reach proxy engine — {e}"))?;

            if !resp.status().is_success() {
                return Err(format!("Host Error: engine returned {}", resp.status()));
            }

            let body: serde_json::Value = resp.json().await
                .map_err(|e| format!("Host Error: failed to parse engine response — {e}"))?;

            let indices = body["indices"].as_array().cloned().unwrap_or_default();
            let method_filter = args.method.map(|s| s.to_uppercase());
            let host_filter = args.host.map(|s| s.to_lowercase());
            let status_filter = args.status;
            let url_filter = args.url_pattern;

            let filtered: Vec<&serde_json::Value> = indices.iter()
                .filter(|flow| {
                    if let Some(ref m) = method_filter {
                        if flow["method"].as_str().unwrap_or("").to_uppercase() != *m {
                            return false;
                        }
                    }
                    if let Some(ref h) = host_filter {
                        if !flow["host"].as_str().unwrap_or("").to_lowercase().contains(h.as_str()) {
                            return false;
                        }
                    }
                    if let Some(ref pattern) = url_filter {
                        if !flow["url"].as_str().unwrap_or("").contains(pattern.as_str()) {
                            return false;
                        }
                    }
                    if let Some(ref s) = status_filter {
                        let code = flow["status"].as_u64().unwrap_or(0);
                        if s.ends_with("xx") {
                            let prefix = s.chars().next().and_then(|c| c.to_digit(10)).unwrap_or(0) as u64;
                            if code / 100 != prefix { return false; }
                        } else if let Ok(exact) = s.parse::<u64>() {
                            if code != exact { return false; }
                        }
                    }
                    true
                })
                .collect();

            let total = filtered.len();
            let flows: Vec<serde_json::Value> = filtered.iter()
                .skip(args.offset)
                .take(limit)
                .map(|flow| serde_json::json!({
                    "id": flow["id"],
                    "method": flow["method"],
                    "url": flow["url"],
                    "host": flow["host"],
                    "path": flow["path"],
                    "status": flow["status"],
                    "contentType": flow["contentType"],
                    "startedAt": flow["startedDateTime"],
                    "durationMs": flow["time"],
                    "sizeBytes": flow["size"],
                    "hasError": flow["hasError"],
                    "hasRequestBody": flow["hasRequestBody"],
                    "hasResponseBody": flow["hasResponseBody"],
                }))
                .collect();

            let has_more = args.offset.saturating_add(flows.len()) < total;
            Ok(serde_json::json!({
                "flows": flows,
                "total": total,
                "offset": args.offset,
                "limit": limit,
                "hasMore": has_more,
            }))
        }

        // ── traffic.getFlow ──────────────────────────────────────────────────────
        "traffic_get_flow" => {
            if !permissions.contains(&"traffic:read".to_string()) {
                return Err("Security Violation: Missing 'traffic:read' permission".to_string());
            }

            let id = payload.args["id"].as_str()
                .ok_or("Invalid Args: missing 'id'")?;
            let include_bodies = payload.args["includeBodies"].as_bool().unwrap_or(false);
            let max_body_bytes = payload.args["maxBodyBytes"]
                .as_u64()
                .map(|n| n as usize)
                .unwrap_or(128 * 1024)
                .min(2 * 1024 * 1024); // 128 KB default, hard cap 2 MB

            let engine_port = crate::config::load_config()
                .map(|c| c.proxy_port)
                .unwrap_or(9090);

            let url = format!("http://127.0.0.1:{engine_port}/_relay/detail?id={id}");
            let client = reqwest::Client::new();
            let resp = client.get(&url).send().await
                .map_err(|e| format!("Host Error: cannot reach proxy engine — {e}"))?;

            if resp.status().as_u16() == 404 {
                return Err(format!("Host Error: flow '{}' not found", id));
            }
            if !resp.status().is_success() {
                return Err(format!("Host Error: engine returned {}", resp.status()));
            }

            let flow: serde_json::Value = resp.json().await
                .map_err(|e| format!("Host Error: failed to parse flow — {e}"))?;

            let req = &flow["request"];
            let res = &flow["response"];

            let (req_body, req_body_truncated) = if include_bodies {
                let raw = req["postData"]["text"].as_str().unwrap_or("");
                let (text, truncated) = truncate_utf8(raw, max_body_bytes);
                (Some(text), truncated)
            } else {
                (None, false)
            };

            let (res_body, res_body_truncated) = if include_bodies {
                let raw = res["content"]["text"].as_str().unwrap_or("");
                let (text, truncated) = truncate_utf8(raw, max_body_bytes);
                (Some(text), truncated)
            } else {
                (None, false)
            };

            Ok(serde_json::json!({
                "id": id,
                "startedAt": flow["startedDateTime"],
                "durationMs": flow["time"],
                "request": {
                    "method": req["method"],
                    "url": req["url"],
                    "headers": req["headers"],
                    "queryString": req["queryString"],
                    "body": req_body,
                    "bodyTruncated": req_body_truncated,
                    "bodySize": req["bodySize"],
                },
                "response": {
                    "status": res["status"],
                    "statusText": res["statusText"],
                    "headers": res["headers"],
                    "body": res_body,
                    "bodyTruncated": res_body_truncated,
                    "bodySize": res["content"]["size"],
                    "mimeType": res["content"]["mimeType"],
                },
                "ruleHits": flow["_rc"]["hits"],
            }))
        }

        _ => Err(format!(
            "Security Violation: Command '{}' is not registered in the bridge or is restricted.",
            payload.command
        )),
    }
}
