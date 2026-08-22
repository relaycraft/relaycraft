use serde::Serialize;

/// API domain of a bridge command.
///
/// Host-domain commands are engine-independent (storage, runtime info, AI,
/// stats, outbound HTTP). Engine-domain commands are backed by the current
/// proxy engine; the API shape is stable but the implementation layer
/// (`bridge/engine.rs`) is swapped when the engine changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiDomain {
    Host,
    Engine,
}

/// Declarative spec for a single `plugin_call` bridge command.
///
/// This registry is the single source of truth for the plugin bridge
/// contract. Every command dispatched by `plugin_call` must be registered
/// here; unregistered commands are rejected.
#[derive(Debug, Clone, Serialize)]
pub struct BridgeCommandSpec {
    /// Command name as received from the plugin, e.g. "traffic_list_flows".
    pub command: &'static str,
    /// API domain (host vs engine).
    pub domain: ApiDomain,
    /// Required manifest permission; `None` means no permission needed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission: Option<&'static str>,
    /// Frontend API surface this command backs, e.g. "traffic.listFlows".
    pub api_surface: &'static str,
    /// Whether invocations are written to the audit log.
    pub audited: bool,
    /// If set, this command is an alias of another registered command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias_of: Option<&'static str>,
}

/// Declarative spec for a host-emitted event that plugins may subscribe to
/// via `api.events.on(eventName, callback)`.
///
/// Together with `BRIDGE_COMMANDS`, `PLUGIN_EVENTS` makes the event channel
/// part of the plugin contract: an `app.emit` event visible to plugins must
/// be registered here; unregistered events are not guaranteed to be stable.
#[derive(Debug, Clone, Serialize)]
pub struct PluginEventSpec {
    /// Event name as emitted by the host, e.g. "rules-changed".
    pub event: &'static str,
    /// API domain (host vs engine).
    pub domain: ApiDomain,
    /// Human-readable description of the event payload.
    pub payload: &'static str,
    /// What the event means and when it is emitted.
    pub description: &'static str,
}

const fn event(
    event: &'static str,
    domain: ApiDomain,
    payload: &'static str,
    description: &'static str,
) -> PluginEventSpec {
    PluginEventSpec {
        event,
        domain,
        payload,
        description,
    }
}

const fn spec(
    command: &'static str,
    domain: ApiDomain,
    permission: Option<&'static str>,
    api_surface: &'static str,
    audited: bool,
    alias_of: Option<&'static str>,
) -> BridgeCommandSpec {
    BridgeCommandSpec {
        command,
        domain,
        permission,
        api_surface,
        audited,
        alias_of,
    }
}

/// All bridge commands, the single source of truth for the plugin contract.
pub const BRIDGE_COMMANDS: &[BridgeCommandSpec] = &[
    // ── host domain ──────────────────────────────────────────────────────────
    spec(
        "storage_get",
        ApiDomain::Host,
        Some("storage:read"),
        "storage.get",
        false,
        None,
    ),
    spec(
        "storage_set",
        ApiDomain::Host,
        Some("storage:write"),
        "storage.set",
        false,
        None,
    ),
    spec(
        "storage_delete",
        ApiDomain::Host,
        Some("storage:write"),
        "storage.delete",
        false,
        None,
    ),
    spec(
        "storage_list",
        ApiDomain::Host,
        Some("storage:read"),
        "storage.list",
        false,
        None,
    ),
    spec(
        "storage_clear",
        ApiDomain::Host,
        Some("storage:write"),
        "storage.clear",
        false,
        None,
    ),
    spec(
        "host_get_runtime",
        ApiDomain::Host,
        None,
        "host.getRuntime",
        false,
        None,
    ),
    spec(
        "ai_chat_completion",
        ApiDomain::Host,
        Some("ai:chat"),
        "ai.chat",
        true,
        None,
    ),
    spec(
        "get_process_stats",
        ApiDomain::Host,
        Some("stats:read"),
        "stats.getProcessStats",
        false,
        None,
    ),
    spec(
        "http_send",
        ApiDomain::Host,
        Some("network:outbound"),
        "http.send",
        false,
        None,
    ),
    // ── engine domain ────────────────────────────────────────────────────────
    spec(
        "get_proxy_status",
        ApiDomain::Engine,
        Some("proxy:read"),
        "proxy.getStatus",
        false,
        None,
    ),
    spec(
        "traffic_list_flows",
        ApiDomain::Engine,
        Some("traffic:read"),
        "traffic.listFlows",
        false,
        None,
    ),
    spec(
        "traffic_search_flows",
        ApiDomain::Engine,
        Some("traffic:read"),
        "traffic.listFlows",
        false,
        Some("traffic_list_flows"),
    ),
    spec(
        "traffic_get_flow",
        ApiDomain::Engine,
        Some("traffic:read"),
        "traffic.getFlow",
        false,
        None,
    ),
    spec(
        "rules_create_mock",
        ApiDomain::Engine,
        Some("rules:write"),
        "rules.createMock",
        false,
        None,
    ),
    spec(
        "rules_list",
        ApiDomain::Engine,
        Some("rules:read"),
        "rules.list",
        false,
        None,
    ),
    spec(
        "rules_get",
        ApiDomain::Engine,
        Some("rules:read"),
        "rules.get",
        false,
        None,
    ),
];

/// All host-emitted events a plugin may subscribe to, the single source of
/// truth for the plugin event contract alongside `BRIDGE_COMMANDS`.
pub const PLUGIN_EVENTS: &[PluginEventSpec] = &[
    // ── engine domain ────────────────────────────────────────────────────────
    event(
        "rules-changed",
        ApiDomain::Engine,
        "empty (notification only)",
        "Emitted when the active rule set changes; refetch rules to observe the new state.",
    ),
    event(
        "proxy-engine-crashed",
        ApiDomain::Engine,
        "string (error message)",
        "Emitted when the proxy engine process crashes.",
    ),
    // ── host domain ──────────────────────────────────────────────────────────
    event(
        "mcp-activity",
        ApiDomain::Host,
        "object (MCP activity record)",
        "Emitted when an MCP tool call is handled by the host.",
    ),
    event(
        "plugin-installed-from-file",
        ApiDomain::Host,
        "string (plugin id)",
        "Emitted when a plugin is successfully installed from a local file.",
    ),
    event(
        "plugin-install-failed-from-file",
        ApiDomain::Host,
        "string (error message)",
        "Emitted when installing a plugin from a local file fails.",
    ),
];

/// Look up a command spec by name. Unregistered commands return `None`.
pub fn find_command(command: &str) -> Option<&'static BridgeCommandSpec> {
    BRIDGE_COMMANDS.iter().find(|spec| spec.command == command)
}

/// Resolve an alias to its canonical command spec.
pub fn resolve_alias(spec: &'static BridgeCommandSpec) -> &'static BridgeCommandSpec {
    match spec.alias_of.and_then(find_command) {
        Some(canonical) => canonical,
        None => spec,
    }
}

/// Pure permission gate, testable without an AppHandle.
///
/// `spec` must be the canonical spec (use `resolve_alias` first).
/// Error message format is part of the plugin contract — the frontend
/// (`mapPluginAIError`) matches on it verbatim, so it must not change.
pub fn check_permission(spec: &BridgeCommandSpec, permissions: &[String]) -> Result<(), String> {
    match spec.permission {
        Some(required) if !permissions.iter().any(|p| p == required) => Err(format!(
            "Security Violation: Missing '{required}' permission"
        )),
        _ => Ok(()),
    }
}

/// Rejection error for commands that are not in the registry.
/// The wording is part of the plugin contract and must not change.
pub fn unregistered_command_error(command: &str) -> String {
    format!(
        "Security Violation: Command '{}' is not registered in the bridge or is restricted.",
        command
    )
}

/// `get_plugin_api_contract` Tauri command: returns the full plugin API
/// contract as `{ "commands": [...], "events": [...] }`. Contract metadata
/// for the host UI itself — no plugin permission required.
#[tauri::command]
pub fn get_plugin_api_contract() -> serde_json::Value {
    serde_json::json!({
        "commands": BRIDGE_COMMANDS,
        "events": PLUGIN_EVENTS,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Permissions that exist in the plugin manifest contract
    /// (`src/types/plugin.ts` PluginPermission).
    const KNOWN_PERMISSIONS: &[&str] = &[
        "proxy:read",
        "proxy:write",
        "fs:read_logs",
        "network:outbound",
        "ai:chat",
        "stats:read",
        "rules:write",
        "rules:read",
        "traffic:read",
        "storage:read",
        "storage:write",
    ];

    #[test]
    fn command_names_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for spec in BRIDGE_COMMANDS {
            assert!(
                seen.insert(spec.command),
                "duplicate bridge command: {}",
                spec.command
            );
        }
    }

    #[test]
    fn aliases_point_to_existing_commands() {
        for spec in BRIDGE_COMMANDS {
            if let Some(target) = spec.alias_of {
                assert!(
                    find_command(target).is_some(),
                    "alias {} points to unknown command {}",
                    spec.command,
                    target
                );
            }
        }
    }

    #[test]
    fn alias_is_not_itself_aliased() {
        for spec in BRIDGE_COMMANDS {
            if let Some(target) = spec.alias_of {
                let canonical = find_command(target).unwrap();
                assert!(
                    canonical.alias_of.is_none(),
                    "alias {} points to another alias {}",
                    spec.command,
                    target
                );
            }
        }
    }

    #[test]
    fn permissions_belong_to_known_set() {
        for spec in BRIDGE_COMMANDS {
            if let Some(permission) = spec.permission {
                assert!(
                    KNOWN_PERMISSIONS.contains(&permission),
                    "command {} uses unknown permission {}",
                    spec.command,
                    permission
                );
            }
        }
    }

    #[test]
    fn every_command_is_findable() {
        for spec in BRIDGE_COMMANDS {
            assert!(find_command(spec.command).is_some());
        }
        assert!(find_command("definitely_not_a_command").is_none());
    }

    #[test]
    fn unregistered_command_rejection_message() {
        let err = unregistered_command_error("evil_command");
        assert_eq!(
            err,
            "Security Violation: Command 'evil_command' is not registered in the bridge or is restricted."
        );
    }

    #[test]
    fn gate_rejects_missing_permission_with_contract_message() {
        let spec = find_command("storage_get").unwrap();
        let err = check_permission(spec, &[]).unwrap_err();
        assert_eq!(err, "Security Violation: Missing 'storage:read' permission");
    }

    #[test]
    fn gate_allows_when_permission_present() {
        let spec = find_command("storage_get").unwrap();
        let permissions = vec!["storage:read".to_string()];
        assert!(check_permission(spec, &permissions).is_ok());
    }

    #[test]
    fn gate_distinguishes_storage_read_write() {
        let read_spec = find_command("storage_get").unwrap();
        let write_spec = find_command("storage_set").unwrap();
        let read_only = vec!["storage:read".to_string()];
        assert!(check_permission(read_spec, &read_only).is_ok());
        let err = check_permission(write_spec, &read_only).unwrap_err();
        assert_eq!(
            err,
            "Security Violation: Missing 'storage:write' permission"
        );
    }

    #[test]
    fn storage_commands_have_no_allowlist_exception() {
        // The old STORAGE_PERMISSION_ALLOWLIST is gone: storage commands are
        // gated purely by manifest permissions.
        let spec = find_command("storage_clear").unwrap();
        let err = check_permission(spec, &[]).unwrap_err();
        assert_eq!(
            err,
            "Security Violation: Missing 'storage:write' permission"
        );
    }

    #[test]
    fn gate_allows_permissionless_command() {
        let spec = find_command("host_get_runtime").unwrap();
        assert!(check_permission(spec, &[]).is_ok());
    }

    #[test]
    fn resolve_alias_returns_canonical_spec() {
        let alias = find_command("traffic_search_flows").unwrap();
        let canonical = resolve_alias(alias);
        assert_eq!(canonical.command, "traffic_list_flows");
        assert_eq!(canonical.permission, Some("traffic:read"));
    }

    #[test]
    fn resolve_alias_passthrough_for_canonical_command() {
        let spec = find_command("traffic_list_flows").unwrap();
        assert_eq!(resolve_alias(spec).command, "traffic_list_flows");
    }

    #[test]
    fn ai_chat_completion_is_audited() {
        let spec = find_command("ai_chat_completion").unwrap();
        assert!(spec.audited);
        // Nothing else is audited today.
        let audited: Vec<_> = BRIDGE_COMMANDS.iter().filter(|s| s.audited).collect();
        assert_eq!(audited.len(), 1);
    }

    #[test]
    fn contract_command_serializes_to_json() {
        let value = get_plugin_api_contract();
        let entries = value["commands"]
            .as_array()
            .expect("contract commands is a JSON array");
        assert_eq!(entries.len(), BRIDGE_COMMANDS.len());
        let first = entries
            .iter()
            .find(|e| e["command"] == "traffic_search_flows")
            .unwrap();
        assert_eq!(first["domain"], "engine");
        assert_eq!(first["permission"], "traffic:read");
        assert_eq!(first["alias_of"], "traffic_list_flows");
        let host = entries
            .iter()
            .find(|e| e["command"] == "host_get_runtime")
            .unwrap();
        assert_eq!(host["domain"], "host");
        // Option fields are skipped when None.
        assert!(host.get("permission").is_none());
        assert!(host.get("alias_of").is_none());
    }

    #[test]
    fn event_names_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for spec in PLUGIN_EVENTS {
            assert!(
                seen.insert(spec.event),
                "duplicate plugin event: {}",
                spec.event
            );
        }
    }

    #[test]
    fn event_domains_are_valid() {
        // ApiDomain is an exhaustive enum, so validity means it serializes to
        // one of the two contract values.
        for spec in PLUGIN_EVENTS {
            let value = serde_json::to_value(spec).unwrap();
            let domain = value["domain"].as_str().unwrap();
            assert!(
                domain == "host" || domain == "engine",
                "event {} has invalid domain {}",
                spec.event,
                domain
            );
        }
    }

    #[test]
    fn contract_serializes_with_commands_and_events_keys() {
        let value = get_plugin_api_contract();
        let object = value.as_object().expect("contract is a JSON object");
        assert!(object.contains_key("commands"));
        assert!(object.contains_key("events"));
        assert_eq!(object.len(), 2);
        let events = value["events"].as_array().unwrap();
        assert_eq!(events.len(), PLUGIN_EVENTS.len());
        let rules_changed = events
            .iter()
            .find(|e| e["event"] == "rules-changed")
            .unwrap();
        assert_eq!(rules_changed["domain"], "engine");
        assert!(rules_changed["payload"].is_string());
        assert!(rules_changed["description"].is_string());
    }
}
