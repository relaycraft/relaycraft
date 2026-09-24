//! Engine-domain bridge handlers: commands backed by the current proxy
//! engine (proxy status, traffic flows, rules). The API shape is part of the
//! plugin contract; when the engine implementation is swapped (2.0), only
//! this layer changes.

use tauri::{AppHandle, Emitter, Manager};

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

// ── proxy.getStatus ──────────────────────────────────────────────────────

pub async fn get_proxy_status(app: &AppHandle) -> Result<serde_json::Value, String> {
    let status = crate::proxy::get_proxy_status(app.state()).await?;
    Ok(serde_json::to_value(status).map_err(|e| e.to_string())?)
}

// ── traffic.listFlows (compat: traffic.searchFlows) ─────────────────────

pub async fn traffic_list_flows(args: serde_json::Value) -> Result<serde_json::Value, String> {
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
    fn default_flow_limit() -> usize {
        100
    }

    let args: ListFlowsArgs =
        serde_json::from_value(args).map_err(|e| format!("Invalid Args: {e}"))?;
    let limit = args.limit.min(1000);

    let engine_port = crate::config::load_config()
        .map(|c| c.proxy_port)
        .unwrap_or(9090);

    let mut url = format!("http://127.0.0.1:{engine_port}/_relay/poll?since=0");
    if let Some(ref sid) = args.session_id {
        url.push_str(&format!("&session_id={sid}"));
    }

    let client = crate::common::http::loopback_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Host Error: cannot reach proxy engine — {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Host Error: engine returned {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Host Error: failed to parse engine response — {e}"))?;

    let indices = body["indices"].as_array().cloned().unwrap_or_default();
    let method_filter = args.method.map(|s| s.to_uppercase());
    let host_filter = args.host.map(|s| s.to_lowercase());
    let status_filter = args.status;
    let url_filter = args.url_pattern;

    let filtered: Vec<&serde_json::Value> = indices
        .iter()
        .filter(|flow| {
            if let Some(ref m) = method_filter {
                if flow["method"].as_str().unwrap_or("").to_uppercase() != *m {
                    return false;
                }
            }
            if let Some(ref h) = host_filter {
                if !flow["host"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(h.as_str())
                {
                    return false;
                }
            }
            if let Some(ref pattern) = url_filter {
                if !flow["url"]
                    .as_str()
                    .unwrap_or("")
                    .contains(pattern.as_str())
                {
                    return false;
                }
            }
            if let Some(ref s) = status_filter {
                let code = flow["status"].as_u64().unwrap_or(0);
                if s.ends_with("xx") {
                    let prefix = s.chars().next().and_then(|c| c.to_digit(10)).unwrap_or(0) as u64;
                    if code / 100 != prefix {
                        return false;
                    }
                } else if let Ok(exact) = s.parse::<u64>() {
                    if code != exact {
                        return false;
                    }
                }
            }
            true
        })
        .collect();

    let total = filtered.len();
    let flows: Vec<serde_json::Value> = filtered
        .iter()
        .skip(args.offset)
        .take(limit)
        .map(|flow| {
            serde_json::json!({
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
            })
        })
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

pub async fn traffic_get_flow(args: &serde_json::Value) -> Result<serde_json::Value, String> {
    let id = args["id"].as_str().ok_or("Invalid Args: missing 'id'")?;
    let include_bodies = args["includeBodies"].as_bool().unwrap_or(false);
    let max_body_bytes = args["maxBodyBytes"]
        .as_u64()
        .map(|n| n as usize)
        .unwrap_or(128 * 1024)
        .min(2 * 1024 * 1024); // 128 KB default, hard cap 2 MB

    let engine_port = crate::config::load_config()
        .map(|c| c.proxy_port)
        .unwrap_or(9090);

    let url = format!("http://127.0.0.1:{engine_port}/_relay/detail?id={id}");
    let client = crate::common::http::loopback_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Host Error: cannot reach proxy engine — {e}"))?;

    if resp.status().as_u16() == 404 {
        return Err(format!("Host Error: flow '{}' not found", id));
    }
    if !resp.status().is_success() {
        return Err(format!("Host Error: engine returned {}", resp.status()));
    }

    let flow: serde_json::Value = resp
        .json()
        .await
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

// ── rules.createMock ─────────────────────────────────────────────────────

pub async fn rules_create_mock(
    app: &AppHandle,
    plugin_id: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
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

    let args: CreateMockArgs =
        serde_json::from_value(args).map_err(|e| format!("Invalid rules_create_mock args: {e}"))?;

    let rule_id = uuid::Uuid::new_v4().to_string();

    // Load existing rules for conflict resolution and priority calculation.
    let storage = crate::rules::storage::RuleStorage::from_config().map_err(|e| e.to_string())?;
    let mut next_priority: i32 = 10;
    let plugin_source = format!("plugin:{}", plugin_id);
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
            if let Some(entry) = existing
                .rules
                .iter()
                .find(|entry| entry.rule.id == existing_rule_id)
            {
                let existing_rule = &entry.rule;
                if existing_rule
                    .metadata
                    .as_ref()
                    .and_then(|m| m.source.as_deref())
                    != Some(&plugin_source)
                {
                    return Err(
                        "Security Violation: Cannot update mock rule owned by another source"
                            .to_string(),
                    );
                }
                if existing_rule.r#type != crate::rules::model::RuleType::MapLocal {
                    return Err(
                        "Only map_local mock rules can be updated via rules.createMock".to_string(),
                    );
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
            if args.rule_id.as_deref() == Some(r.id.as_str()) {
                continue;
            }
            if !r.execution.enabled {
                continue;
            }
            if r.r#type != crate::rules::model::RuleType::MapLocal {
                continue;
            }
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

pub async fn rules_list(args: serde_json::Value) -> Result<serde_json::Value, String> {
    use crate::rules::storage::RuleStorage;

    #[derive(serde::Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct RulesListFilter {
        enabled: Option<bool>,
        source: Option<String>,
        r#type: Option<String>,
    }

    let filter: RulesListFilter = serde_json::from_value(args).unwrap_or_default();

    let storage = RuleStorage::from_config().map_err(|e| e.to_string())?;
    let loaded = storage.load_all().map_err(|e| e.to_string())?;

    let rules: Vec<serde_json::Value> = loaded
        .rules
        .iter()
        .filter(|entry| {
            let r = &entry.rule;
            if let Some(enabled) = filter.enabled {
                if r.execution.enabled != enabled {
                    return false;
                }
            }
            if let Some(ref source) = filter.source {
                let rule_source = r
                    .metadata
                    .as_ref()
                    .and_then(|m| m.source.as_deref())
                    .unwrap_or("user");
                if rule_source != source {
                    return false;
                }
            }
            if let Some(ref type_str) = filter.r#type {
                let rule_type = serde_json::to_value(&r.r#type)
                    .ok()
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                    .unwrap_or_default();
                if &rule_type != type_str {
                    return false;
                }
            }
            true
        })
        .map(|entry| {
            let r = &entry.rule;
            let url_pattern = r
                .match_config
                .request
                .iter()
                .find(|a| a.atom_type == "url")
                .and_then(|a| a.value.as_ref()?.as_str().map(|s| s.to_string()))
                .unwrap_or_default();
            let source = r
                .metadata
                .as_ref()
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

pub async fn rules_get(args: &serde_json::Value) -> Result<serde_json::Value, String> {
    use crate::rules::storage::RuleStorage;

    let id = args["id"].as_str().ok_or("Invalid Args: missing 'id'")?;

    let storage = RuleStorage::from_config().map_err(|e| e.to_string())?;
    let loaded = storage.load_all().map_err(|e| e.to_string())?;

    let entry = loaded
        .rules
        .into_iter()
        .find(|e| e.rule.id == id)
        .ok_or_else(|| format!("Host Error: rule '{}' not found", id))?;

    Ok(serde_json::to_value(&entry.rule).map_err(|e| e.to_string())?)
}

// ── rules.disableMock ────────────────────────────────────────────────────

/// Disable exactly one plugin-owned Map Local rule in `storage`.
///
/// Returns `true` when the rule was actually disabled, `false` when it was
/// already disabled (idempotent no-op, no file write). All validation
/// happens before any write, so rejections never touch the rule store.
/// Split out so unit tests can drive the storage semantics with a `TempDir`
/// without a Tauri `AppHandle`.
fn disable_plugin_mock_rule(
    storage: &crate::rules::storage::RuleStorage,
    plugin_id: &str,
    rule_id: &str,
) -> Result<bool, String> {
    if rule_id.is_empty() {
        return Err("Invalid Args: 'ruleId' must be a non-empty string".to_string());
    }

    let plugin_source = format!("plugin:{}", plugin_id);
    let loaded = storage.load_all().map_err(|e| e.to_string())?;
    let matches: Vec<_> = loaded
        .rules
        .iter()
        .filter(|entry| entry.rule.id == rule_id)
        .collect();
    let entry = match matches.as_slice() {
        [] => return Err(format!("Host Error: mock rule '{}' not found", rule_id)),
        [entry] => entry,
        _ => {
            return Err(format!(
                "Host Error: ambiguous duplicate rule id '{}'",
                rule_id
            ))
        }
    };

    let rule = &entry.rule;
    if rule.metadata.as_ref().and_then(|m| m.source.as_deref()) != Some(plugin_source.as_str()) {
        return Err(
            "Security Violation: Cannot disable mock rule owned by another source".to_string(),
        );
    }
    if rule.r#type != crate::rules::model::RuleType::MapLocal {
        return Err("Only map_local mock rules can be disabled via rules.disableMock".to_string());
    }
    if !rule.execution.enabled {
        return Ok(false);
    }

    let mut disabled = rule.clone();
    disabled.execution.enabled = false;
    storage
        .save(&disabled, Some(&entry.group_id))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub async fn rules_disable_mock(
    app: &AppHandle,
    plugin_id: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DisableMockArgs {
        rule_id: String,
    }

    let args: DisableMockArgs = serde_json::from_value(args)
        .map_err(|e| format!("Invalid rules_disable_mock args: {e}"))?;
    let rule_id = args.rule_id.trim();

    let storage = crate::rules::storage::RuleStorage::from_config().map_err(|e| e.to_string())?;
    let changed = disable_plugin_mock_rule(&storage, plugin_id, rule_id)?;
    if changed {
        // Notify frontend so the Rules panel refreshes immediately.
        let _ = app.emit("rules-changed", ());
    }
    Ok(serde_json::Value::Null)
}

// ── rules.getOwnMock ─────────────────────────────────────────────────────

/// Narrow view of a plugin-owned Map Local mock, shaped so it can round-trip
/// through `rules.createMock`. Internal rule JSON, group paths, metadata and
/// other rules are never exposed.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnedMockData {
    rule_id: String,
    name: String,
    url_pattern: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
    response_body: String,
    status_code: u16,
    content_type: String,
    response_headers: std::collections::HashMap<String, String>,
    enabled: bool,
}

/// Read exactly one plugin-owned manual Map Local rule in `storage` and
/// return the narrow `OwnedMockData`. All validation happens before the
/// response is built; failures expose nothing beyond the error string.
fn get_plugin_own_mock(
    storage: &crate::rules::storage::RuleStorage,
    plugin_id: &str,
    rule_id: &str,
) -> Result<OwnedMockData, String> {
    use crate::rules::model::{RuleAction, RuleType};

    if rule_id.is_empty() {
        return Err("Invalid Args: 'ruleId' must be a non-empty string".to_string());
    }

    let plugin_source = format!("plugin:{}", plugin_id);
    let loaded = storage.load_all().map_err(|e| e.to_string())?;
    let matches: Vec<_> = loaded
        .rules
        .iter()
        .filter(|entry| entry.rule.id == rule_id)
        .collect();
    let entry = match matches.as_slice() {
        [] => return Err(format!("Host Error: mock rule '{}' not found", rule_id)),
        [entry] => entry,
        _ => {
            return Err(format!(
                "Host Error: ambiguous duplicate rule id '{}'",
                rule_id
            ))
        }
    };

    let rule = &entry.rule;
    if rule.metadata.as_ref().and_then(|m| m.source.as_deref()) != Some(plugin_source.as_str()) {
        return Err(
            "Security Violation: Cannot read mock rule owned by another source".to_string(),
        );
    }
    if rule.r#type != RuleType::MapLocal {
        return Err("Only map_local mock rules can be read via rules.getOwnMock".to_string());
    }
    let action = match rule.actions.as_slice() {
        [RuleAction::MapLocal(action)] => action,
        _ => {
            return Err(
                "Only rules with a single map_local action can be read via rules.getOwnMock"
                    .to_string(),
            )
        }
    };
    // File-backed map_local content cannot round-trip through createMock.
    if action.source.as_deref() != Some("manual") || action.local_path.is_some() {
        return Err("Only manual map_local mocks can be read via rules.getOwnMock".to_string());
    }

    // Match scope must be exactly what createMock emits: one wildcard url
    // atom plus at most one equals method atom. Extra atoms, response
    // matchers, keyed/inverted atoms, other atom types or match modes, and
    // a non-default stop_on_match cannot round-trip and would silently
    // broaden the mock on re-save.
    if rule.execution.stop_on_match.is_some() {
        return Err("Mock rule has a non-default stop_on_match".to_string());
    }
    if !rule.match_config.response.is_empty() {
        return Err("Mock rule has response match atoms".to_string());
    }
    let mut url_pattern: Option<String> = None;
    let mut method: Option<String> = None;
    for atom in &rule.match_config.request {
        if atom.key.is_some() || atom.invert.unwrap_or(false) {
            return Err("Mock rule has a keyed or inverted match atom".to_string());
        }
        let string_value = || {
            atom.value
                .as_ref()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .ok_or_else(|| format!("Mock rule {} atom value is not a string", atom.atom_type))
        };
        match (atom.atom_type.as_str(), atom.match_type.as_str()) {
            ("url", "wildcard") => {
                if url_pattern.is_some() {
                    return Err("Mock rule has duplicate url atoms".to_string());
                }
                url_pattern = Some(string_value()?);
            }
            ("method", "equals") => {
                if method.is_some() {
                    return Err("Mock rule has duplicate method atoms".to_string());
                }
                method = Some(string_value()?);
            }
            _ => {
                return Err(format!(
                    "Mock rule has unsupported match atom {}:{}",
                    atom.atom_type, atom.match_type
                ))
            }
        }
    }
    let url_pattern =
        url_pattern.ok_or_else(|| "Mock rule is missing a url match atom".to_string())?;

    let status_code = action.status_code.unwrap_or(200);
    if !(100..=599).contains(&status_code) || status_code > u16::MAX as u32 {
        return Err(format!("Mock rule has invalid status code {status_code}"));
    }

    let mut response_headers = std::collections::HashMap::new();
    if let Some(headers) = &action.headers {
        if !headers.request.is_empty() {
            // Request-side header ops cannot round-trip via createMock.
            return Err("Mock rule has request header operations".to_string());
        }
        for op in &headers.response {
            if op.operation != "set" {
                return Err("Mock rule has non-'set' response header operations".to_string());
            }
            if op.key.trim().is_empty() {
                return Err("Mock rule has an empty response header key".to_string());
            }
            if op.key.eq_ignore_ascii_case("content-type") {
                // createMock never emits a content-type op — dropping it
                // would silently change the mock's response headers.
                return Err("Mock rule has a content-type header operation".to_string());
            }
            let Some(value) = &op.value else {
                return Err("Mock rule has a 'set' header operation without value".to_string());
            };
            if response_headers
                .keys()
                .any(|k: &String| k.eq_ignore_ascii_case(&op.key))
            {
                return Err(format!("Mock rule has duplicate header key '{}'", op.key));
            }
            response_headers.insert(op.key.clone(), value.clone());
        }
    }

    Ok(OwnedMockData {
        rule_id: rule.id.clone(),
        name: rule.name.clone(),
        url_pattern,
        method,
        response_body: action.content.clone().unwrap_or_default(),
        status_code: status_code as u16,
        content_type: action
            .content_type
            .clone()
            .unwrap_or_else(|| "application/json".to_string()),
        response_headers,
        enabled: rule.execution.enabled,
    })
}

pub async fn rules_get_own_mock(
    plugin_id: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GetOwnMockArgs {
        rule_id: String,
    }

    let args: GetOwnMockArgs = serde_json::from_value(args)
        .map_err(|e| format!("Invalid rules_get_own_mock args: {e}"))?;
    let rule_id = args.rule_id.trim();

    let storage = crate::rules::storage::RuleStorage::from_config().map_err(|e| e.to_string())?;
    let mock = get_plugin_own_mock(&storage, plugin_id, rule_id)?;
    serde_json::to_value(mock).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::model::{
        HeaderConfig, HeaderOperation, MapLocalAction, MatchAtom, Rule, RuleAction, RuleExecution,
        RuleMatchConfig, RuleMetadata, RuleType,
    };
    use crate::rules::storage::RuleStorage;
    use tempfile::TempDir;

    fn temp_storage() -> (TempDir, RuleStorage) {
        let temp = TempDir::new().unwrap();
        let storage = RuleStorage::new(temp.path().to_path_buf()).unwrap();
        (temp, storage)
    }

    fn mock_rule(id: &str, source: Option<&str>, enabled: bool) -> Rule {
        Rule {
            id: id.to_string(),
            name: format!("rule-{}", id),
            r#type: RuleType::MapLocal,
            execution: RuleExecution {
                enabled,
                priority: 10,
                stop_on_match: None,
            },
            match_config: RuleMatchConfig {
                request: vec![MatchAtom {
                    atom_type: "url".to_string(),
                    match_type: "wildcard".to_string(),
                    key: None,
                    value: Some(serde_json::json!("https://example.com/api")),
                    invert: None,
                }],
                response: vec![],
            },
            actions: vec![RuleAction::MapLocal(MapLocalAction {
                source: Some("manual".to_string()),
                local_path: None,
                content: Some("{\"ok\":true}".to_string()),
                content_type: Some("application/json".to_string()),
                status_code: Some(200),
                headers: None,
            })],
            tags: None,
            metadata: source.map(|s| RuleMetadata {
                source: Some(s.to_string()),
                ai_intent: None,
            }),
        }
    }

    fn block_rule(id: &str, source: Option<&str>) -> Rule {
        let mut rule = mock_rule(id, source, true);
        rule.r#type = RuleType::BlockRequest;
        rule.actions = vec![RuleAction::BlockRequest];
        rule
    }

    #[test]
    fn disables_own_enabled_mock_and_preserves_group() {
        let (_temp, storage) = temp_storage();
        let rule = mock_rule("r1", Some("plugin:plug-a"), true);
        storage.save(&rule, Some("grp")).unwrap();

        let changed = disable_plugin_mock_rule(&storage, "plug-a", "r1").unwrap();
        assert!(changed);

        let loaded = storage.load_all().unwrap();
        assert_eq!(loaded.rules.len(), 1);
        let entry = &loaded.rules[0];
        assert_eq!(entry.group_id, "grp");
        let r = &entry.rule;
        assert!(!r.execution.enabled);
        // Everything else preserved.
        assert_eq!(r.id, "r1");
        assert_eq!(r.name, "rule-r1");
        assert_eq!(r.r#type, RuleType::MapLocal);
        assert_eq!(
            r.metadata.as_ref().unwrap().source.as_deref(),
            Some("plugin:plug-a")
        );
        match &r.actions[0] {
            RuleAction::MapLocal(action) => {
                assert_eq!(action.content.as_deref(), Some("{\"ok\":true}"));
                assert_eq!(action.status_code, Some(200));
            }
            other => panic!("expected map_local action, got {other:?}"),
        }
    }

    #[test]
    fn already_disabled_is_idempotent_noop() {
        let (_temp, storage) = temp_storage();
        let rule = mock_rule("r1", Some("plugin:plug-a"), false);
        storage.save(&rule, Some("grp")).unwrap();
        let path = storage.base_dir.join("grp").join("r1.yaml");
        let before = std::fs::read(&path).unwrap();

        let changed = disable_plugin_mock_rule(&storage, "plug-a", "r1").unwrap();
        assert!(!changed);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn rejects_rule_owned_by_another_plugin() {
        let (_temp, storage) = temp_storage();
        let rule = mock_rule("r1", Some("plugin:plug-b"), true);
        storage.save(&rule, None).unwrap();

        assert!(disable_plugin_mock_rule(&storage, "plug-a", "r1").is_err());
        // File untouched.
        let loaded = storage.load_all().unwrap();
        assert!(loaded.rules[0].rule.execution.enabled);
    }

    #[test]
    fn rejects_user_owned_rule() {
        let (_temp, storage) = temp_storage();
        let rule = mock_rule("r1", Some("user"), true);
        storage.save(&rule, None).unwrap();
        assert!(disable_plugin_mock_rule(&storage, "plug-a", "r1").is_err());

        // No metadata at all counts as user-owned too.
        let rule = mock_rule("r2", None, true);
        storage.save(&rule, None).unwrap();
        assert!(disable_plugin_mock_rule(&storage, "plug-a", "r2").is_err());
    }

    #[test]
    fn rejects_non_map_local_rule() {
        let (_temp, storage) = temp_storage();
        let rule = block_rule("b1", Some("plugin:plug-a"));
        storage.save(&rule, None).unwrap();

        assert!(disable_plugin_mock_rule(&storage, "plug-a", "b1").is_err());
        let loaded = storage.load_all().unwrap();
        assert!(loaded.rules[0].rule.execution.enabled);
    }

    #[test]
    fn rejects_unknown_and_empty_id() {
        let (_temp, storage) = temp_storage();
        assert!(disable_plugin_mock_rule(&storage, "plug-a", "nope").is_err());
        assert!(disable_plugin_mock_rule(&storage, "plug-a", "").is_err());
    }

    #[test]
    fn rejects_ambiguous_duplicate_ids() {
        let (_temp, storage) = temp_storage();
        let rule = mock_rule("dup", Some("plugin:plug-a"), true);
        storage.save(&rule, Some("grp-a")).unwrap();
        // Plant a second copy with the same id — `save` would move the file,
        // so write it directly to simulate a corrupted store.
        let dup_dir = storage.base_dir.join("grp-b");
        std::fs::create_dir_all(&dup_dir).unwrap();
        let yaml =
            serde_yaml::to_string(&crate::rules::storage::RuleFile { rule: rule.clone() }).unwrap();
        std::fs::write(dup_dir.join("dup.yaml"), yaml).unwrap();

        assert!(disable_plugin_mock_rule(&storage, "plug-a", "dup").is_err());
        let loaded = storage.load_all().unwrap();
        assert_eq!(loaded.rules.len(), 2);
        assert!(loaded.rules.iter().all(|e| e.rule.execution.enabled));
    }

    // ── rules.getOwnMock ─────────────────────────────────────────────────

    fn owned_mock(id: &str, source: Option<&str>, enabled: bool) -> Rule {
        let mut rule = mock_rule(id, source, enabled);
        rule.match_config.request.push(MatchAtom {
            atom_type: "method".to_string(),
            match_type: "equals".to_string(),
            key: None,
            value: Some(serde_json::json!("POST")),
            invert: None,
        });
        if let RuleAction::MapLocal(action) = &mut rule.actions[0] {
            action.status_code = Some(201);
            action.content_type = Some("text/plain".to_string());
            action.headers = Some(HeaderConfig {
                request: vec![],
                response: vec![HeaderOperation {
                    operation: "set".to_string(),
                    key: "X-Mock".to_string(),
                    value: Some("yes".to_string()),
                }],
            });
        }
        rule
    }

    #[test]
    fn reads_own_mock_with_roundtrip_fields() {
        let (_temp, storage) = temp_storage();
        storage
            .save(&owned_mock("m1", Some("plugin:plug-a"), true), Some("grp"))
            .unwrap();

        let mock = get_plugin_own_mock(&storage, "plug-a", "m1").unwrap();
        assert_eq!(mock.rule_id, "m1");
        assert_eq!(mock.name, "rule-m1");
        assert_eq!(mock.url_pattern, "https://example.com/api");
        assert_eq!(mock.method.as_deref(), Some("POST"));
        assert_eq!(mock.response_body, "{\"ok\":true}");
        assert_eq!(mock.status_code, 201);
        assert_eq!(mock.content_type, "text/plain");
        assert!(mock.enabled);
        assert_eq!(mock.response_headers.len(), 1);
        assert_eq!(mock.response_headers.get("X-Mock").unwrap(), "yes");

        // Serialized shape is the narrow whitelist only — no group path,
        // metadata/source, or internal rule fields.
        let value = serde_json::to_value(&mock).unwrap();
        let keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        for key in &keys {
            assert!(
                [
                    "ruleId",
                    "name",
                    "urlPattern",
                    "method",
                    "responseBody",
                    "statusCode",
                    "contentType",
                    "responseHeaders",
                    "enabled"
                ]
                .contains(key),
                "unexpected key in getOwnMock response: {key}"
            );
        }
        assert!(!value.to_string().contains("plugin:"));
        assert!(!value.to_string().contains("grp"));
    }

    #[test]
    fn reads_own_disabled_mock_and_defaults() {
        let (_temp, storage) = temp_storage();
        let mut rule = owned_mock("m2", Some("plugin:plug-a"), false);
        if let RuleAction::MapLocal(action) = &mut rule.actions[0] {
            action.status_code = None;
            action.content_type = None;
            action.content = None;
            action.headers = None;
        }
        rule.match_config
            .request
            .retain(|a| a.atom_type != "method");
        storage.save(&rule, None).unwrap();

        let mock = get_plugin_own_mock(&storage, "plug-a", "m2").unwrap();
        assert!(!mock.enabled);
        assert_eq!(mock.status_code, 200);
        assert_eq!(mock.content_type, "application/json");
        assert_eq!(mock.response_body, "");
        assert_eq!(mock.method, None);
        assert!(mock.response_headers.is_empty());
    }

    #[test]
    fn rejects_read_of_foreign_or_user_rules() {
        let (_temp, storage) = temp_storage();
        storage
            .save(&owned_mock("m1", Some("plugin:plug-b"), true), None)
            .unwrap();
        storage
            .save(&owned_mock("m2", Some("user"), true), None)
            .unwrap();
        storage.save(&owned_mock("m3", None, true), None).unwrap();

        assert!(get_plugin_own_mock(&storage, "plug-a", "m1").is_err());
        assert!(get_plugin_own_mock(&storage, "plug-a", "m2").is_err());
        assert!(get_plugin_own_mock(&storage, "plug-a", "m3").is_err());
    }

    #[test]
    fn rejects_read_of_non_map_local_and_file_backed_mock() {
        let (_temp, storage) = temp_storage();
        storage
            .save(&block_rule("b1", Some("plugin:plug-a")), None)
            .unwrap();

        let mut file_rule = mock_rule("f1", Some("plugin:plug-a"), true);
        if let RuleAction::MapLocal(action) = &mut file_rule.actions[0] {
            action.source = Some("file".to_string());
            action.local_path = Some("/tmp/x.json".to_string());
        }
        storage.save(&file_rule, None).unwrap();

        assert!(get_plugin_own_mock(&storage, "plug-a", "b1").is_err());
        assert!(get_plugin_own_mock(&storage, "plug-a", "f1").is_err());
    }

    #[test]
    fn rejects_read_of_unknown_duplicate_and_empty_ids() {
        let (_temp, storage) = temp_storage();
        let rule = owned_mock("dup", Some("plugin:plug-a"), true);
        storage.save(&rule, Some("grp-a")).unwrap();
        let dup_dir = storage.base_dir.join("grp-b");
        std::fs::create_dir_all(&dup_dir).unwrap();
        let yaml =
            serde_yaml::to_string(&crate::rules::storage::RuleFile { rule: rule.clone() }).unwrap();
        std::fs::write(dup_dir.join("dup.yaml"), yaml).unwrap();

        assert!(get_plugin_own_mock(&storage, "plug-a", "nope").is_err());
        assert!(get_plugin_own_mock(&storage, "plug-a", "dup").is_err());
        assert!(get_plugin_own_mock(&storage, "plug-a", "").is_err());
    }

    #[test]
    fn rejects_read_of_malformed_mock_details() {
        let (_temp, storage) = temp_storage();

        // Missing url atom.
        let mut no_url = mock_rule("n1", Some("plugin:plug-a"), true);
        no_url.match_config.request.clear();
        storage.save(&no_url, None).unwrap();
        assert!(get_plugin_own_mock(&storage, "plug-a", "n1").is_err());

        // Out-of-range status code.
        let mut bad_status = mock_rule("n2", Some("plugin:plug-a"), true);
        if let RuleAction::MapLocal(action) = &mut bad_status.actions[0] {
            action.status_code = Some(99);
        }
        storage.save(&bad_status, None).unwrap();
        assert!(get_plugin_own_mock(&storage, "plug-a", "n2").is_err());

        // Non-'set' header op — would silently change behavior if dropped.
        let mut bad_op = mock_rule("n3", Some("plugin:plug-a"), true);
        if let RuleAction::MapLocal(action) = &mut bad_op.actions[0] {
            action.headers = Some(HeaderConfig {
                request: vec![],
                response: vec![HeaderOperation {
                    operation: "remove".to_string(),
                    key: "X".to_string(),
                    value: None,
                }],
            });
        }
        storage.save(&bad_op, None).unwrap();
        assert!(get_plugin_own_mock(&storage, "plug-a", "n3").is_err());

        // Duplicate header keys — cannot be represented losslessly.
        let mut dup_header = mock_rule("n4", Some("plugin:plug-a"), true);
        if let RuleAction::MapLocal(action) = &mut dup_header.actions[0] {
            action.headers = Some(HeaderConfig {
                request: vec![],
                response: vec![
                    HeaderOperation {
                        operation: "set".to_string(),
                        key: "X-Dup".to_string(),
                        value: Some("1".to_string()),
                    },
                    HeaderOperation {
                        operation: "set".to_string(),
                        key: "x-dup".to_string(),
                        value: Some("2".to_string()),
                    },
                ],
            });
        }
        storage.save(&dup_header, None).unwrap();
        assert!(get_plugin_own_mock(&storage, "plug-a", "n4").is_err());

        // content-type op — createMock never emits one; dropping it would
        // silently change the response.
        let mut ct_op = mock_rule("n5", Some("plugin:plug-a"), true);
        if let RuleAction::MapLocal(action) = &mut ct_op.actions[0] {
            action.headers = Some(HeaderConfig {
                request: vec![],
                response: vec![HeaderOperation {
                    operation: "set".to_string(),
                    key: "Content-Type".to_string(),
                    value: Some("text/plain".to_string()),
                }],
            });
        }
        storage.save(&ct_op, None).unwrap();
        assert!(get_plugin_own_mock(&storage, "plug-a", "n5").is_err());

        // 'set' op without value — dropping it would lose behavior.
        let mut no_value = mock_rule("n6", Some("plugin:plug-a"), true);
        if let RuleAction::MapLocal(action) = &mut no_value.actions[0] {
            action.headers = Some(HeaderConfig {
                request: vec![],
                response: vec![HeaderOperation {
                    operation: "set".to_string(),
                    key: "X-Empty".to_string(),
                    value: None,
                }],
            });
        }
        storage.save(&no_value, None).unwrap();
        assert!(get_plugin_own_mock(&storage, "plug-a", "n6").is_err());

        // Empty header key.
        let mut empty_key = mock_rule("n7", Some("plugin:plug-a"), true);
        if let RuleAction::MapLocal(action) = &mut empty_key.actions[0] {
            action.headers = Some(HeaderConfig {
                request: vec![],
                response: vec![HeaderOperation {
                    operation: "set".to_string(),
                    key: "  ".to_string(),
                    value: Some("v".to_string()),
                }],
            });
        }
        storage.save(&empty_key, None).unwrap();
        assert!(get_plugin_own_mock(&storage, "plug-a", "n7").is_err());
    }

    #[test]
    fn rejects_read_of_non_roundtrippable_match_scope() {
        let (_temp, storage) = temp_storage();
        let mut n = 0;
        let mut plant = |rule: Rule| {
            n += 1;
            let mut r = rule;
            r.id = format!("s{n}");
            storage.save(&r, None).unwrap();
            r.id
        };

        // Extra atom type.
        let mut extra = mock_rule("x", Some("plugin:plug-a"), true);
        extra.match_config.request.push(MatchAtom {
            atom_type: "host".to_string(),
            match_type: "equals".to_string(),
            key: None,
            value: Some(serde_json::json!("example.com")),
            invert: None,
        });
        // Non-wildcard url match mode.
        let mut regex_url = mock_rule("x", Some("plugin:plug-a"), true);
        regex_url.match_config.request[0].match_type = "regex".to_string();
        // Non-equals method match mode.
        let mut contains_method = mock_rule("x", Some("plugin:plug-a"), true);
        contains_method.match_config.request.push(MatchAtom {
            atom_type: "method".to_string(),
            match_type: "contains".to_string(),
            key: None,
            value: Some(serde_json::json!("PO")),
            invert: None,
        });
        // Duplicate url atoms.
        let mut dup_url = mock_rule("x", Some("plugin:plug-a"), true);
        dup_url.match_config.request.push(MatchAtom {
            atom_type: "url".to_string(),
            match_type: "wildcard".to_string(),
            key: None,
            value: Some(serde_json::json!("https://other/x")),
            invert: None,
        });
        // Inverted atom.
        let mut inverted = mock_rule("x", Some("plugin:plug-a"), true);
        inverted.match_config.request[0].invert = Some(true);
        // Keyed atom.
        let mut keyed = mock_rule("x", Some("plugin:plug-a"), true);
        keyed.match_config.request[0].key = Some("k".to_string());
        // Response-side match atoms.
        let mut resp_match = mock_rule("x", Some("plugin:plug-a"), true);
        resp_match.match_config.response.push(MatchAtom {
            atom_type: "status".to_string(),
            match_type: "equals".to_string(),
            key: None,
            value: Some(serde_json::json!(200)),
            invert: None,
        });
        // Non-default stop_on_match.
        let mut stop = mock_rule("x", Some("plugin:plug-a"), true);
        stop.execution.stop_on_match = Some(true);

        for rule in [
            extra,
            regex_url,
            contains_method,
            dup_url,
            inverted,
            keyed,
            resp_match,
            stop,
        ] {
            let id = plant(rule);
            assert!(
                get_plugin_own_mock(&storage, "plug-a", &id).is_err(),
                "expected rejection for {id}"
            );
        }
    }
}
