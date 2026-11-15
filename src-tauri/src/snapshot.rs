//! Config snapshot import/export — carries portable settings plus a plugin
//! manifest between machines without leaking secrets or silently opening
//! listeners. See `docs/config-snapshot-design.md`.
//!
//! Pipeline mirrors the safe rule import: `preview_config_snapshot`
//! (inspect + plan, zero writes) and `apply_config_snapshot` (re-runs
//! inspect + plan on the file — never trusts a serialized preview — then
//! commits through the atomic config.json write with byte-level rollback).
//!
//! Field classification (design §4): a field is machine-bound if applying
//! it opens a listener or is tied to this machine's security posture.
//! Secrets are excluded structurally — the exported `settings.ai` object
//! has no `api_key` slot — and a denylist strips smuggled secret keys from
//! hand-crafted files at inspect time.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use crate::ai::config::AIConfig;
use crate::config::{AppConfig, UpstreamProxyConfig};

const SNAPSHOT_KIND: &str = "config-snapshot";
const SNAPSHOT_VERSION: u32 = 1;

/// Portable settings keys allowed inside `settings` (design §4).
const PORTABLE_SETTINGS_KEYS: &[&str] = &[
    "language",
    "display_density",
    "always_on_top",
    "confirm_exit",
    "auto_start_proxy",
    "verbose_logging",
    "enable_vibrancy",
    "upstream_proxy",
    "plugin_registry_url",
    "theme_registry_url",
    "ai",
    "share_upstream_url",
];

/// Machine-bound keys allowed inside `machine_bound` — kept local unless
/// the user explicitly checks each one in the preview.
const MACHINE_BOUND_KEYS: &[&str] = &[
    "proxy_port",
    "mcp_enabled",
    "mcp_port",
    "share_enabled",
    "share_port",
    "share_listen_lan",
    "disable_gpu_acceleration",
    "ssl_insecure",
    "cert_warning_ignored",
];

/// Secret keys denied anywhere under `settings` (design §3). Compared on a
/// normalized form (lowercase, `_`/`-` stripped) so `apiKey`, `api_key`,
/// `API-KEY` all match.
const DENIED_SECRET_KEYS: &[&str] = &["apikey", "mcptoken", "token", "password"];

// ── Schema (design §3) ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigSnapshot {
    pub kind: String,
    pub version: u32,
    #[serde(default)]
    pub producer: Option<SnapshotProducer>,
    #[serde(default)]
    pub requires: Option<SnapshotRequires>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub settings: Map<String, Value>,
    #[serde(default)]
    pub machine_bound: Map<String, Value>,
    #[serde(default)]
    pub plugins: Vec<SnapshotPluginEntry>,
}

/// Informational provenance — not a signature, no trust decision is made
/// from it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotProducer {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotRequires {
    #[serde(default)]
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotPluginEntry {
    pub id: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub enabled: bool,
}

/// AI settings as written to a snapshot: every `AIConfig` field **except**
/// `api_key`, which is structurally absent. All fields optional so a
/// partial `ai` object in a hand-crafted file applies field-by-field
/// (absent/`null` keeps the current value).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnapshotAiSettings {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub adapter_mode: Option<String>,
    #[serde(default)]
    pub custom_endpoint: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub enable_caching: Option<bool>,
    #[serde(default)]
    pub max_history_messages: Option<u32>,
}

impl From<&AIConfig> for SnapshotAiSettings {
    fn from(config: &AIConfig) -> Self {
        Self {
            enabled: Some(config.enabled),
            provider: Some(config.provider.clone()),
            profile_id: config.profile_id.clone(),
            adapter_mode: config.adapter_mode.clone(),
            custom_endpoint: config.custom_endpoint.clone(),
            model: Some(config.model.clone()),
            max_tokens: Some(config.max_tokens),
            temperature: Some(config.temperature),
            enable_caching: Some(config.enable_caching),
            max_history_messages: Some(config.max_history_messages),
        }
    }
}

// ── Preview / result types returned to the frontend ─────────────────────

/// One installed plugin as the planner sees it — keeps the pure pipeline
/// free of `PluginInfo`/manifest coupling.
#[derive(Debug, Clone)]
pub struct InstalledPluginRef {
    pub id: String,
    pub version: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotSettingDiff {
    pub key: String,
    pub current: Value,
    pub incoming: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotMachineBoundEntry {
    pub key: String,
    pub current: Value,
    pub incoming: Value,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotPluginPlan {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotPreview {
    pub name: Option<String>,
    pub description: Option<String>,
    pub requires_host: Option<String>,
    pub host_version: String,
    /// False when `requires.host` does not cover this app version — the
    /// preview surfaces this as a blocking banner and apply refuses.
    pub host_compatible: bool,
    /// Settings keys whose value differs from current config.
    pub settings: Vec<SnapshotSettingDiff>,
    /// Allowed settings keys whose value already matches.
    pub unchanged_settings: usize,
    /// Allowed keys dropped because the value failed type validation.
    pub invalid_settings: Vec<String>,
    pub machine_bound: Vec<SnapshotMachineBoundEntry>,
    pub invalid_machine_bound: Vec<String>,
    /// Installed && snapshot-enabled && currently disabled → will enable.
    pub plugins_restore: Vec<SnapshotPluginPlan>,
    /// Not installed → listed, never auto-installed.
    pub plugins_missing: Vec<SnapshotPluginPlan>,
    /// Installed and enabled-state already matches the file.
    pub plugins_already_matching: Vec<SnapshotPluginPlan>,
    /// Installed and currently enabled but marked `enabled: false` in the
    /// snapshot — left enabled (union semantics never disables).
    pub plugins_not_restored: Vec<SnapshotPluginPlan>,
    /// Denylist hits removed from `settings` (dotted paths).
    pub ignored_secrets: Vec<String>,
    /// Keys not on either allowlist (dotted paths) — forward-compat noise
    /// from newer app versions or foreign files.
    pub ignored_unknown: Vec<String>,
    /// True when the incoming `upstream_proxy.url` embeds userinfo
    /// credentials — the preview flags them before apply.
    pub proxy_credentials: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotExportResult {
    pub path: String,
    pub settings_count: usize,
    pub plugin_count: usize,
    /// True when `upstream_proxy.url` embeds userinfo credentials — the UI
    /// warns before/after export; the file itself keeps them by design.
    pub includes_proxy_credentials: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotImportResult {
    pub applied_settings: usize,
    pub unchanged_settings: usize,
    pub skipped_settings: usize,
    pub applied_machine_bound: usize,
    /// Plugins newly enabled by this import (never disables, never
    /// installs).
    pub plugins_enabled: usize,
    pub missing_plugins: usize,
    /// True when the config write failed AND the byte restore also failed —
    /// config.json may be partially applied. Same flag contract as
    /// `commit_mock_rule_changes`.
    pub partial: bool,
    /// Set when the write itself failed (rollback outcome in `partial`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Phase A — inspect (pure, fs-free) ────────────────────────────────────

/// Output of inspect: allowlisted, type-validated values plus everything
/// that was ignored, for the preview to surface honestly.
#[derive(Debug, Clone)]
pub struct InspectedSnapshot {
    pub name: Option<String>,
    pub description: Option<String>,
    pub requires_host: Option<String>,
    pub host_version: String,
    pub host_compatible: bool,
    /// Allowlisted + secret-stripped + type-valid settings.
    pub settings: Map<String, Value>,
    /// Allowlisted + type-valid machine-bound entries.
    pub machine_bound: Map<String, Value>,
    pub invalid_settings: Vec<String>,
    pub invalid_machine_bound: Vec<String>,
    pub ignored_unknown: Vec<String>,
    pub ignored_secrets: Vec<String>,
    pub plugins: Vec<SnapshotPluginEntry>,
}

fn normalized_secret_key(key: &str) -> String {
    key.chars()
        .filter(|c| *c != '_' && *c != '-')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn is_denied_key(key: &str) -> bool {
    let normalized = normalized_secret_key(key);
    DENIED_SECRET_KEYS.contains(&normalized.as_str())
}

/// Remove denylisted keys anywhere under `map` (any depth, including
/// objects nested in arrays) and record their dotted paths.
fn strip_secret_keys(map: &mut Map<String, Value>, prefix: &str, found: &mut Vec<String>) {
    let keys: Vec<String> = map.keys().cloned().collect();
    for key in keys {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{}.{}", prefix, key)
        };
        if is_denied_key(&key) {
            map.remove(&key);
            found.push(path);
            continue;
        }
        match map.get_mut(&key) {
            Some(Value::Object(child)) => strip_secret_keys(child, &path, found),
            Some(Value::Array(items)) => {
                for (index, item) in items.iter_mut().enumerate() {
                    if let Value::Object(child) = item {
                        strip_secret_keys(child, &format!("{}.{}", path, index), found);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Whether `value` is acceptable for the portable setting `key` — checked
/// at inspect so the preview never promises a value apply would drop.
fn setting_value_valid(key: &str, value: &Value) -> bool {
    match key {
        "language"
        | "display_density"
        | "plugin_registry_url"
        | "theme_registry_url"
        | "share_upstream_url" => value.is_string(),
        "always_on_top" | "confirm_exit" | "auto_start_proxy" | "verbose_logging"
        | "enable_vibrancy" => value.is_boolean(),
        "upstream_proxy" => serde_json::from_value::<UpstreamProxyConfig>(value.clone()).is_ok(),
        "ai" => serde_json::from_value::<SnapshotAiSettings>(value.clone()).is_ok(),
        _ => false,
    }
}

fn machine_bound_value_valid(key: &str, value: &Value) -> bool {
    match key {
        "proxy_port" | "mcp_port" | "share_port" => value
            .as_u64()
            .map(|n| n <= u16::MAX as u64)
            .unwrap_or(false),
        "mcp_enabled"
        | "share_enabled"
        | "share_listen_lan"
        | "disable_gpu_acceleration"
        | "ssl_insecure"
        | "cert_warning_ignored" => value.is_boolean(),
        _ => false,
    }
}

/// `requires.host` SemVer range vs the running app version — same
/// fail-closed rule as plugin `engines.relaycraft` (invalid range ⇒
/// incompatible).
fn host_requirement_met(requirement: Option<&str>) -> bool {
    let Some(req) = requirement else {
        return true;
    };
    let (Ok(range), Ok(current)) = (
        semver::VersionReq::parse(req),
        semver::Version::parse(env!("CARGO_PKG_VERSION")),
    ) else {
        return false;
    };
    range.matches(&current)
}

/// Parse + validate the snapshot envelope and split `settings` /
/// `machine_bound` against the allowlists. Unknown top-level keys are
/// rejected by `deny_unknown_fields`; unknown keys *inside* the two maps
/// are ignored and flagged instead (forward compat).
pub fn inspect_snapshot(value: &Value) -> Result<InspectedSnapshot, String> {
    let snapshot: ConfigSnapshot = serde_json::from_value(value.clone())
        .map_err(|e| format!("Not a valid config snapshot: {}", e))?;

    if snapshot.kind != SNAPSHOT_KIND {
        return Err(format!(
            "Not a config snapshot (kind \"{}\")",
            snapshot.kind
        ));
    }
    if snapshot.version != SNAPSHOT_VERSION {
        return Err(format!(
            "Unsupported snapshot version {} (expected {})",
            snapshot.version, SNAPSHOT_VERSION
        ));
    }

    let requires_host = snapshot.requires.and_then(|r| r.host);
    let host_compatible = host_requirement_met(requires_host.as_deref());

    // Denylist runs before classification so smuggled secrets anywhere
    // under `settings` are stripped regardless of key position.
    let mut settings = snapshot.settings;
    let mut ignored_secrets = Vec::new();
    strip_secret_keys(&mut settings, "settings", &mut ignored_secrets);

    let mut allowed_settings = Map::new();
    let mut machine_bound = Map::new();
    let mut invalid_settings = Vec::new();
    let mut invalid_machine_bound = Vec::new();
    let mut ignored_unknown = Vec::new();

    for (key, value) in settings {
        if PORTABLE_SETTINGS_KEYS.contains(&key.as_str()) {
            if setting_value_valid(&key, &value) {
                allowed_settings.insert(key, value);
            } else {
                invalid_settings.push(format!("settings.{}", key));
            }
        } else {
            ignored_unknown.push(format!("settings.{}", key));
        }
    }

    for (key, value) in snapshot.machine_bound {
        if MACHINE_BOUND_KEYS.contains(&key.as_str()) {
            if machine_bound_value_valid(&key, &value) {
                machine_bound.insert(key, value);
            } else {
                invalid_machine_bound.push(format!("machine_bound.{}", key));
            }
        } else {
            ignored_unknown.push(format!("machine_bound.{}", key));
        }
    }

    Ok(InspectedSnapshot {
        name: snapshot.name,
        description: snapshot.description,
        requires_host,
        host_version: env!("CARGO_PKG_VERSION").to_string(),
        host_compatible,
        settings: allowed_settings,
        machine_bound,
        invalid_settings,
        invalid_machine_bound,
        ignored_unknown,
        ignored_secrets,
        plugins: snapshot.plugins,
    })
}

// ── Phase B — plan (pure, fs-free) ───────────────────────────────────────

fn current_setting_value(config: &AppConfig, key: &str) -> Value {
    match key {
        "language" => Value::String(config.language.clone()),
        "display_density" => Value::String(config.display_density.clone()),
        "always_on_top" => Value::Bool(config.always_on_top),
        "confirm_exit" => Value::Bool(config.confirm_exit),
        "auto_start_proxy" => Value::Bool(config.auto_start_proxy),
        "verbose_logging" => Value::Bool(config.verbose_logging),
        "enable_vibrancy" => Value::Bool(config.enable_vibrancy),
        "upstream_proxy" => serde_json::to_value(&config.upstream_proxy).unwrap_or(Value::Null),
        "plugin_registry_url" => Value::String(config.plugin_registry_url.clone()),
        "theme_registry_url" => Value::String(config.theme_registry_url.clone()),
        "ai" => {
            serde_json::to_value(SnapshotAiSettings::from(&config.ai_config)).unwrap_or(Value::Null)
        }
        "share_upstream_url" => Value::String(config.share.upstream_url.clone()),
        _ => Value::Null,
    }
}

fn current_machine_bound_value(config: &AppConfig, key: &str) -> Value {
    match key {
        "proxy_port" => Value::from(config.proxy_port),
        "mcp_enabled" => Value::Bool(config.mcp_config.enabled),
        "mcp_port" => Value::from(config.mcp_config.port),
        "share_enabled" => Value::Bool(config.share.enabled),
        "share_port" => Value::from(config.share.port),
        "share_listen_lan" => Value::Bool(config.share.listen_lan),
        "disable_gpu_acceleration" => Value::Bool(config.disable_gpu_acceleration),
        "ssl_insecure" => Value::Bool(config.ssl_insecure),
        "cert_warning_ignored" => Value::Bool(config.cert_warning_ignored),
        _ => Value::Null,
    }
}

/// Bucket one snapshot plugin entry against installed plugins.
/// Union-merge semantics: import may only *enable* what the file lists as
/// enabled and installed — never disables, never installs.
fn bucket_plugin(
    entry: &SnapshotPluginEntry,
    installed: Option<&InstalledPluginRef>,
) -> PluginBucket {
    match installed {
        None => PluginBucket::Missing,
        Some(local) if entry.enabled == local.enabled => PluginBucket::AlreadyMatching,
        Some(local) if entry.enabled && !local.enabled => PluginBucket::Restore,
        // entry.enabled == false && local.enabled == true
        Some(_) => PluginBucket::NotRestored,
    }
}

#[derive(Debug, PartialEq)]
enum PluginBucket {
    Restore,
    Missing,
    AlreadyMatching,
    NotRestored,
}

/// Diff an inspected snapshot against the live config + installed plugins.
/// Zero writes — the preview renders exactly this.
pub fn plan_import(
    inspected: &InspectedSnapshot,
    current: &AppConfig,
    installed: &[InstalledPluginRef],
) -> SnapshotPreview {
    let mut diffs = Vec::new();
    let mut unchanged = 0usize;
    for (key, incoming) in &inspected.settings {
        let current_value = current_setting_value(current, key);
        if &current_value == incoming {
            unchanged += 1;
        } else {
            diffs.push(SnapshotSettingDiff {
                key: key.clone(),
                current: current_value,
                incoming: incoming.clone(),
            });
        }
    }

    let machine_bound = inspected
        .machine_bound
        .iter()
        .map(|(key, incoming)| {
            let current_value = current_machine_bound_value(current, key);
            SnapshotMachineBoundEntry {
                key: key.clone(),
                changed: &current_value != incoming,
                current: current_value,
                incoming: incoming.clone(),
            }
        })
        .collect();

    let mut preview = SnapshotPreview {
        name: inspected.name.clone(),
        description: inspected.description.clone(),
        requires_host: inspected.requires_host.clone(),
        host_version: inspected.host_version.clone(),
        host_compatible: inspected.host_compatible,
        settings: diffs,
        unchanged_settings: unchanged,
        invalid_settings: inspected.invalid_settings.clone(),
        machine_bound,
        invalid_machine_bound: inspected.invalid_machine_bound.clone(),
        plugins_restore: Vec::new(),
        plugins_missing: Vec::new(),
        plugins_already_matching: Vec::new(),
        plugins_not_restored: Vec::new(),
        ignored_secrets: inspected.ignored_secrets.clone(),
        ignored_unknown: inspected.ignored_unknown.clone(),
        proxy_credentials: inspected
            .settings
            .get("upstream_proxy")
            .and_then(|proxy| proxy.get("url"))
            .and_then(|url| url.as_str())
            .map(upstream_url_has_credentials)
            .unwrap_or(false),
    };

    for entry in &inspected.plugins {
        let local = installed.iter().find(|p| p.id == entry.id);
        let plan = SnapshotPluginPlan {
            id: entry.id.clone(),
            version: entry
                .version
                .clone()
                .or_else(|| local.map(|p| p.version.clone())),
            enabled: entry.enabled,
        };
        match bucket_plugin(entry, local) {
            PluginBucket::Restore => preview.plugins_restore.push(plan),
            PluginBucket::Missing => preview.plugins_missing.push(plan),
            PluginBucket::AlreadyMatching => preview.plugins_already_matching.push(plan),
            PluginBucket::NotRestored => preview.plugins_not_restored.push(plan),
        }
    }

    preview
}

// ── Phase C — commit ─────────────────────────────────────────────────────

fn value_as_string(value: &Value) -> Result<String, String> {
    value
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "expected string".to_string())
}

/// Apply every `Some` field; absent/`null` keeps the current value.
/// `api_key` is structurally absent from `SnapshotAiSettings` — it is
/// never touched.
fn apply_ai_settings(target: &mut AIConfig, incoming: &SnapshotAiSettings) {
    if let Some(v) = incoming.enabled {
        target.enabled = v;
    }
    if let Some(v) = &incoming.provider {
        target.provider = v.clone();
    }
    if let Some(v) = &incoming.profile_id {
        target.profile_id = Some(v.clone());
    }
    if let Some(v) = &incoming.adapter_mode {
        target.adapter_mode = Some(v.clone());
    }
    if let Some(v) = &incoming.custom_endpoint {
        target.custom_endpoint = Some(v.clone());
    }
    if let Some(v) = &incoming.model {
        target.model = v.clone();
    }
    if let Some(v) = incoming.max_tokens {
        target.max_tokens = v;
    }
    if let Some(v) = incoming.temperature {
        target.temperature = v;
    }
    if let Some(v) = incoming.enable_caching {
        target.enable_caching = v;
    }
    if let Some(v) = incoming.max_history_messages {
        target.max_history_messages = v;
    }
}

fn apply_setting(config: &mut AppConfig, key: &str, value: &Value) -> Result<(), String> {
    match key {
        "language" => config.language = value_as_string(value)?,
        "display_density" => config.display_density = value_as_string(value)?,
        "always_on_top" => config.always_on_top = value.as_bool().unwrap_or(false),
        "confirm_exit" => config.confirm_exit = value.as_bool().unwrap_or(true),
        "auto_start_proxy" => config.auto_start_proxy = value.as_bool().unwrap_or(false),
        "verbose_logging" => config.verbose_logging = value.as_bool().unwrap_or(false),
        "enable_vibrancy" => config.enable_vibrancy = value.as_bool().unwrap_or(false),
        "upstream_proxy" => {
            config.upstream_proxy = serde_json::from_value(value.clone())
                .map_err(|e| format!("invalid upstream_proxy: {}", e))?;
        }
        "plugin_registry_url" => config.plugin_registry_url = value_as_string(value)?,
        "theme_registry_url" => config.theme_registry_url = value_as_string(value)?,
        "ai" => {
            let incoming: SnapshotAiSettings = serde_json::from_value(value.clone())
                .map_err(|e| format!("invalid ai settings: {}", e))?;
            apply_ai_settings(&mut config.ai_config, &incoming);
        }
        "share_upstream_url" => config.share.upstream_url = value_as_string(value)?,
        _ => return Err(format!("unknown settings key {}", key)),
    }
    Ok(())
}

fn apply_machine_bound_key(config: &mut AppConfig, key: &str, value: &Value) -> Result<(), String> {
    let port = |v: &Value| -> Result<u16, String> {
        v.as_u64()
            .and_then(|n| u16::try_from(n).ok())
            .ok_or_else(|| "expected port (0-65535)".to_string())
    };
    let flag = |v: &Value| -> Result<bool, String> {
        v.as_bool().ok_or_else(|| "expected bool".to_string())
    };
    match key {
        "proxy_port" => config.proxy_port = port(value)?,
        "mcp_enabled" => config.mcp_config.enabled = flag(value)?,
        "mcp_port" => config.mcp_config.port = port(value)?,
        "share_enabled" => config.share.enabled = flag(value)?,
        "share_port" => config.share.port = port(value)?,
        "share_listen_lan" => config.share.listen_lan = flag(value)?,
        "disable_gpu_acceleration" => config.disable_gpu_acceleration = flag(value)?,
        "ssl_insecure" => config.ssl_insecure = flag(value)?,
        "cert_warning_ignored" => config.cert_warning_ignored = flag(value)?,
        _ => return Err(format!("unknown machine-bound key {}", key)),
    }
    Ok(())
}

/// Apply an inspected snapshot onto a cloned config and persist it through
/// the injected writer. On write failure the byte-level `restore_fn` runs;
/// if rollback itself fails the result reports `partial` — the same
/// contract `commit_mock_rule_changes` documents (failure rollback, not a
/// transaction).
pub fn commit_import(
    inspected: &InspectedSnapshot,
    current: &AppConfig,
    installed: &[InstalledPluginRef],
    apply_machine_bound: &[String],
    write_fn: &mut dyn FnMut(&AppConfig) -> Result<(), String>,
    restore_fn: &mut dyn FnMut() -> Result<(), String>,
) -> SnapshotImportResult {
    let mut new_config = current.clone();

    let mut applied_settings = 0usize;
    let mut unchanged_settings = 0usize;
    let mut skipped_settings = 0usize;
    for (key, value) in &inspected.settings {
        match apply_setting(&mut new_config, key, value) {
            Ok(()) => {
                if &current_setting_value(current, key) == value {
                    unchanged_settings += 1;
                } else {
                    applied_settings += 1;
                }
            }
            Err(e) => {
                log::warn!("[Snapshot] skipped setting {}: {}", key, e);
                skipped_settings += 1;
            }
        }
    }

    // Machine-bound keys apply only when the user checked them in the
    // preview — there is no "apply all" path.
    let checked: BTreeSet<&str> = apply_machine_bound.iter().map(|s| s.as_str()).collect();
    let mut applied_machine_bound = 0usize;
    for key in checked {
        if let Some(value) = inspected.machine_bound.get(key) {
            match apply_machine_bound_key(&mut new_config, key, value) {
                Ok(()) => applied_machine_bound += 1,
                Err(e) => log::warn!("[Snapshot] skipped machine-bound {}: {}", key, e),
            }
        }
    }

    // enabled_plugins = current ∪ (snapshot-enabled ∩ installed).
    // Restore-what's-listed: never disable plugins the file doesn't list
    // (or lists as disabled), never auto-install missing ones.
    let mut plugins_enabled = 0usize;
    let mut missing_plugins = 0usize;
    for entry in &inspected.plugins {
        let is_installed = installed.iter().any(|p| p.id == entry.id);
        if !is_installed {
            missing_plugins += 1;
            continue;
        }
        if entry.enabled && !new_config.enabled_plugins.contains(&entry.id) {
            new_config.enabled_plugins.push(entry.id.clone());
            plugins_enabled += 1;
        }
    }

    if let Err(write_err) = write_fn(&new_config) {
        let base = SnapshotImportResult {
            applied_settings: 0,
            unchanged_settings: 0,
            skipped_settings: 0,
            applied_machine_bound: 0,
            plugins_enabled: 0,
            missing_plugins,
            partial: false,
            error: Some(write_err.clone()),
        };
        return match restore_fn() {
            Ok(()) => base,
            Err(rollback_err) => SnapshotImportResult {
                applied_settings,
                unchanged_settings,
                skipped_settings,
                applied_machine_bound,
                plugins_enabled,
                partial: true,
                error: Some(format!("{}; rollback failed: {}", write_err, rollback_err)),
                ..base
            },
        };
    }

    SnapshotImportResult {
        applied_settings,
        unchanged_settings,
        skipped_settings,
        applied_machine_bound,
        plugins_enabled,
        missing_plugins,
        partial: false,
        error: None,
    }
}

// ── Command plumbing (fs boundary) ───────────────────────────────────────

fn installed_plugins(config: &AppConfig) -> Result<Vec<InstalledPluginRef>, String> {
    let plugins_dir = crate::config::get_data_dir()?.join("plugins");
    let plugins = crate::plugins::discover_plugins(&plugins_dir, &config.enabled_plugins);
    Ok(plugins
        .into_iter()
        .map(|p| InstalledPluginRef {
            id: p.manifest.id,
            version: p.manifest.version,
            enabled: p.enabled,
        })
        .collect())
}

fn inspect_snapshot_file(path: &str) -> Result<InspectedSnapshot, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read snapshot: {}", e))?;
    let value: Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid snapshot JSON: {}", e))?;
    inspect_snapshot(&value)
}

/// True when the upstream proxy URL embeds userinfo credentials
/// (`user:pass@host`). Unparseable values fall back to an `@` scan so a
/// scheme-less `user:pass@host:port` is still caught.
fn upstream_url_has_credentials(raw: &str) -> bool {
    let raw = raw.trim();
    if raw.is_empty() {
        return false;
    }
    match url::Url::parse(raw) {
        Ok(parsed) => !parsed.username().is_empty() || parsed.password().is_some(),
        Err(_) => raw.contains('@'),
    }
}

/// Build the snapshot document from live config + installed plugins.
/// Returns the doc and whether the upstream proxy URL carries credentials.
pub fn build_snapshot(
    config: &AppConfig,
    installed: &[InstalledPluginRef],
    name: Option<String>,
) -> (ConfigSnapshot, bool) {
    let mut settings = Map::new();
    settings.insert(
        "language".to_string(),
        Value::String(config.language.clone()),
    );
    settings.insert(
        "display_density".to_string(),
        Value::String(config.display_density.clone()),
    );
    settings.insert(
        "always_on_top".to_string(),
        Value::Bool(config.always_on_top),
    );
    settings.insert("confirm_exit".to_string(), Value::Bool(config.confirm_exit));
    settings.insert(
        "auto_start_proxy".to_string(),
        Value::Bool(config.auto_start_proxy),
    );
    settings.insert(
        "verbose_logging".to_string(),
        Value::Bool(config.verbose_logging),
    );
    settings.insert(
        "enable_vibrancy".to_string(),
        Value::Bool(config.enable_vibrancy),
    );
    settings.insert(
        "upstream_proxy".to_string(),
        serde_json::to_value(&config.upstream_proxy).unwrap_or(Value::Null),
    );
    settings.insert(
        "plugin_registry_url".to_string(),
        Value::String(config.plugin_registry_url.clone()),
    );
    settings.insert(
        "theme_registry_url".to_string(),
        Value::String(config.theme_registry_url.clone()),
    );
    // `ai` is built field-by-field through SnapshotAiSettings — there is
    // no api_key slot to leak through.
    settings.insert(
        "ai".to_string(),
        serde_json::to_value(SnapshotAiSettings::from(&config.ai_config)).unwrap_or(Value::Null),
    );
    settings.insert(
        "share_upstream_url".to_string(),
        Value::String(config.share.upstream_url.clone()),
    );

    let mut machine_bound = Map::new();
    machine_bound.insert("proxy_port".to_string(), Value::from(config.proxy_port));
    machine_bound.insert(
        "mcp_enabled".to_string(),
        Value::Bool(config.mcp_config.enabled),
    );
    machine_bound.insert("mcp_port".to_string(), Value::from(config.mcp_config.port));
    machine_bound.insert(
        "share_enabled".to_string(),
        Value::Bool(config.share.enabled),
    );
    machine_bound.insert("share_port".to_string(), Value::from(config.share.port));
    machine_bound.insert(
        "share_listen_lan".to_string(),
        Value::Bool(config.share.listen_lan),
    );
    machine_bound.insert(
        "disable_gpu_acceleration".to_string(),
        Value::Bool(config.disable_gpu_acceleration),
    );
    machine_bound.insert("ssl_insecure".to_string(), Value::Bool(config.ssl_insecure));
    machine_bound.insert(
        "cert_warning_ignored".to_string(),
        Value::Bool(config.cert_warning_ignored),
    );

    let plugins = installed
        .iter()
        .map(|p| SnapshotPluginEntry {
            id: p.id.clone(),
            version: Some(p.version.clone()),
            enabled: p.enabled,
        })
        .collect();

    let includes_credentials = upstream_url_has_credentials(&config.upstream_proxy.url);

    (
        ConfigSnapshot {
            kind: SNAPSHOT_KIND.to_string(),
            version: SNAPSHOT_VERSION,
            producer: Some(SnapshotProducer {
                name: Some("relaycraft".to_string()),
                source: Some("official".to_string()),
                app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            }),
            requires: Some(SnapshotRequires {
                host: Some(format!(">={}", env!("CARGO_PKG_VERSION"))),
            }),
            created: Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            name,
            description: None,
            settings,
            machine_bound,
            plugins,
        },
        includes_credentials,
    )
}

#[tauri::command]
pub async fn export_config_snapshot(
    path: String,
    name: Option<String>,
) -> Result<SnapshotExportResult, String> {
    // Internal loader — the sanitized frontend copy is never the source;
    // secrets still cannot leak because the schema has no slot for them.
    let config = crate::config::load_config_internal().unwrap_or_default();
    let installed = installed_plugins(&config)?;
    let (snapshot, includes_proxy_credentials) = build_snapshot(&config, &installed, name);

    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;
    crate::config::write_file_atomic(&PathBuf::from(&path), json.as_bytes())?;

    let settings_count = snapshot.settings.len();
    let plugin_count = snapshot.plugins.len();
    crate::audit::audit(
        crate::audit::AuditEvent::user("snapshot.export").detail(format!(
            "settings: {}, plugins: {}, upstream_proxy_credentials: {}",
            settings_count, plugin_count, includes_proxy_credentials
        )),
    );

    Ok(SnapshotExportResult {
        path,
        settings_count,
        plugin_count,
        includes_proxy_credentials,
    })
}

#[tauri::command]
pub async fn preview_config_snapshot(path: String) -> Result<SnapshotPreview, String> {
    let inspected = inspect_snapshot_file(&path)?;
    let config = crate::config::load_config_internal().unwrap_or_default();
    let installed = installed_plugins(&config)?;
    Ok(plan_import(&inspected, &config, &installed))
}

#[tauri::command]
pub async fn apply_config_snapshot(
    path: String,
    apply_machine_bound: Vec<String>,
    state: tauri::State<'_, crate::ai::AIState>,
) -> Result<SnapshotImportResult, String> {
    // Re-validate the file — never trust a serialized preview.
    let inspected = match inspect_snapshot_file(&path) {
        Ok(inspected) => inspected,
        Err(e) => {
            crate::audit::audit(
                crate::audit::AuditEvent::user("snapshot.import.denied")
                    .result(crate::audit::AuditResult::Denied)
                    .detail(e.clone()),
            );
            return Err(e);
        }
    };

    if !inspected.host_compatible {
        let message = format!(
            "Snapshot requires relaycraft {}, current {}",
            inspected.requires_host.as_deref().unwrap_or("?"),
            inspected.host_version
        );
        crate::audit::audit(
            crate::audit::AuditEvent::user("snapshot.import.denied")
                .result(crate::audit::AuditResult::Denied)
                .detail(message.clone()),
        );
        return Err(message);
    }

    let current = crate::config::load_config_internal().unwrap_or_default();
    let installed = installed_plugins(&current)?;
    let config_path = crate::config::get_config_path()?;

    // Byte-level snapshot for rollback — the only file this commit touches.
    let prior_bytes = fs::read(&config_path).ok();
    let restore_path = config_path.clone();
    let result = commit_import(
        &inspected,
        &current,
        &installed,
        &apply_machine_bound,
        &mut |new_config| crate::config::write_config_atomic(&config_path, new_config),
        &mut || match &prior_bytes {
            Some(bytes) => crate::config::write_file_atomic(&restore_path, bytes),
            // No pre-existing config: a failed write left nothing to
            // restore — remove only if the commit path created a file.
            None => match fs::remove_file(&restore_path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            },
        },
    );

    let detail = match &result.error {
        Some(error) => format!("failed: {}", error),
        None => format!(
            "applied settings: {}, machine-bound: {}, plugins enabled: {}, missing plugins: {}",
            result.applied_settings,
            result.applied_machine_bound,
            result.plugins_enabled,
            result.missing_plugins
        ),
    };
    let mut event = crate::audit::AuditEvent::user("snapshot.import").detail(detail);
    if result.error.is_some() {
        event = event.result(crate::audit::AuditResult::Error);
    }
    if result.partial {
        event = event.meta(serde_json::json!({ "partial": true }));
    }
    crate::audit::audit(event);

    // Sync the cached AI runtime config so requests pick up the imported
    // provider/model/endpoint without a restart. The disk copy carries no
    // api_key — `apply_stored_api_key` merges the stored key at request
    // time. A poisoned lock only skips the refresh, never fails the
    // already-committed import.
    if result.error.is_none() {
        match state.config.lock() {
            Ok(mut guard) => {
                *guard = crate::config::load_config_internal()?.ai_config;
            }
            Err(e) => {
                log::warn!("[Snapshot] AI runtime config refresh skipped: {}", e);
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn installed(id: &str, version: &str, enabled: bool) -> InstalledPluginRef {
        InstalledPluginRef {
            id: id.to_string(),
            version: version.to_string(),
            enabled,
        }
    }

    fn snapshot_json(settings: Value, machine_bound: Value, plugins: Value) -> Value {
        json!({
            "kind": "config-snapshot",
            "version": 1,
            "producer": { "name": "relaycraft", "source": "official", "app_version": "1.6.2" },
            "requires": { "host": ">=1.0.0" },
            "created": "2026-11-01T00:00:00.000Z",
            "name": "Work machine setup",
            "settings": settings,
            "machine_bound": machine_bound,
            "plugins": plugins,
        })
    }

    fn ok_writer<'a>(
        sink: &'a mut Option<AppConfig>,
    ) -> impl FnMut(&AppConfig) -> Result<(), String> + 'a {
        move |cfg| {
            *sink = Some(cfg.clone());
            Ok(())
        }
    }

    // ── Envelope ─────────────────────────────────────────────────────────

    #[test]
    fn inspect_rejects_wrong_kind_and_version_and_unknown_top_level_key() {
        let mut wrong_kind = snapshot_json(json!({}), json!({}), json!([]));
        wrong_kind["kind"] = json!("rule-bundle");
        assert!(inspect_snapshot(&wrong_kind).is_err());

        let mut wrong_version = snapshot_json(json!({}), json!({}), json!([]));
        wrong_version["version"] = json!(2);
        assert!(inspect_snapshot(&wrong_version).is_err());

        // deny_unknown_fields on the top-level envelope
        let mut extra = snapshot_json(json!({}), json!({}), json!([]));
        extra["unexpected"] = json!(true);
        assert!(inspect_snapshot(&extra).is_err());
    }

    #[test]
    fn inspect_ignores_and_flags_unknown_inner_keys() {
        let file = snapshot_json(
            json!({ "language": "en", "future_field": 1 }),
            json!({ "proxy_port": 8866, "future_bound": true }),
            json!([]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        assert!(inspected.settings.contains_key("language"));
        assert!(!inspected.settings.contains_key("future_field"));
        assert!(inspected.machine_bound.contains_key("proxy_port"));
        assert_eq!(
            inspected.ignored_unknown,
            vec![
                "settings.future_field".to_string(),
                "machine_bound.future_bound".to_string()
            ]
        );
    }

    // ── Secrets ──────────────────────────────────────────────────────────

    #[test]
    fn inspect_strips_smuggled_secret_keys_anywhere_under_settings() {
        let file = snapshot_json(
            json!({
                "language": "en",
                "token": "smuggled-top-level",
                "ai": {
                    "enabled": true,
                    "apiKey": "sk-smuggled",
                    "model": "gpt-4o"
                },
                "upstream_proxy": {
                    "enabled": true,
                    "url": "http://proxy:8080",
                    "bypass_domains": "",
                    "PASSWORD": "nested-secret"
                }
            }),
            json!({}),
            json!([]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        // Secrets removed from the apply set…
        assert!(!inspected.settings.contains_key("token"));
        let ai = inspected.settings.get("ai").unwrap();
        assert!(ai.get("apiKey").is_none());
        assert!(ai.get("api_key").is_none());
        let upstream = inspected.settings.get("upstream_proxy").unwrap();
        assert!(upstream.get("PASSWORD").is_none());
        // …and reported for the preview.
        assert!(inspected
            .ignored_secrets
            .contains(&"settings.token".to_string()));
        assert!(inspected
            .ignored_secrets
            .contains(&"settings.ai.apiKey".to_string()));
        assert!(inspected
            .ignored_secrets
            .contains(&"settings.upstream_proxy.PASSWORD".to_string()));
        // Non-secret siblings survive.
        assert_eq!(ai.get("model"), Some(&json!("gpt-4o")));
    }

    #[test]
    fn exporter_output_contains_no_key_material() {
        let mut config = AppConfig::default();
        config.ai_config.api_key = "sk-live-secret".to_string();
        config.ai_config.enabled = true;
        let (snapshot, _) = build_snapshot(&config, &[], None);
        let json_out = serde_json::to_string_pretty(&snapshot).unwrap();

        assert!(!json_out.contains("sk-live-secret"));
        assert!(!json_out.contains("api_key"));
        assert!(!json_out.contains("apiKey"));
        assert!(!json_out.contains("mcp_token"));
        let ai = json_out.contains("\"ai\"");
        assert!(ai);
        // The exported ai object has no secret slot at all.
        let parsed: Value = serde_json::from_str(&json_out).unwrap();
        let ai_obj = parsed["settings"]["ai"].as_object().unwrap();
        for key in ai_obj.keys() {
            assert!(is_denied_key(key) == false, "denied key {} exported", key);
        }
        assert_eq!(parsed["settings"]["ai"]["provider"], json!("openai"));
    }

    #[test]
    fn exporter_reports_embedded_proxy_credentials() {
        let mut config = AppConfig::default();
        config.upstream_proxy.url = "http://user:pass@proxy.internal:8080".to_string();
        let (_, has_creds) = build_snapshot(&config, &[], None);
        assert!(has_creds);

        config.upstream_proxy.url = "http://proxy.internal:8080".to_string();
        let (_, has_creds) = build_snapshot(&config, &[], None);
        assert!(!has_creds);
    }

    // ── Plan ─────────────────────────────────────────────────────────────

    #[test]
    fn plan_diffs_settings_and_lists_machine_bound_unchecked() {
        let file = snapshot_json(
            json!({ "language": "en", "verbose_logging": true }),
            json!({ "proxy_port": 8866, "ssl_insecure": true }),
            json!([]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        let current = AppConfig::default(); // language zh, verbose false, port 9090
        let preview = plan_import(&inspected, &current, &[]);

        // language differs (zh → en), verbose_logging differs (false → true)
        assert_eq!(preview.settings.len(), 2);
        let lang = preview
            .settings
            .iter()
            .find(|d| d.key == "language")
            .unwrap();
        assert_eq!(lang.current, json!("zh"));
        assert_eq!(lang.incoming, json!("en"));
        assert_eq!(preview.unchanged_settings, 0);

        // Machine-bound entries are listed with current vs incoming — apply
        // is opt-in per key, so plan itself never mutates them.
        assert_eq!(preview.machine_bound.len(), 2);
        let port = preview
            .machine_bound
            .iter()
            .find(|e| e.key == "proxy_port")
            .unwrap();
        assert_eq!(port.current, json!(9090));
        assert_eq!(port.incoming, json!(8866));
        assert!(port.changed);
    }

    #[test]
    fn plan_buckets_plugins_restore_missing_matching_not_restored() {
        let file = snapshot_json(
            json!({}),
            json!({}),
            json!([
                { "id": "p.enable", "version": "1.0.0", "enabled": true },
                { "id": "p.missing", "version": "9.9.9", "enabled": true },
                { "id": "p.matching", "version": "1.0.0", "enabled": true },
                { "id": "p.disabled", "version": "1.0.0", "enabled": false }
            ]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        let installed = vec![
            installed("p.enable", "1.0.0", false),
            installed("p.matching", "1.0.0", true),
            installed("p.disabled", "1.0.0", true),
        ];
        let preview = plan_import(&inspected, &AppConfig::default(), &installed);

        assert_eq!(preview.plugins_restore[0].id, "p.enable");
        assert_eq!(preview.plugins_missing[0].id, "p.missing");
        assert_eq!(preview.plugins_already_matching[0].id, "p.matching");
        assert_eq!(preview.plugins_not_restored[0].id, "p.disabled");
    }

    // ── Commit ───────────────────────────────────────────────────────────

    #[test]
    fn commit_applies_settings_but_never_machine_bound_by_default() {
        let file = snapshot_json(
            json!({ "language": "en" }),
            json!({ "proxy_port": 8866, "share_enabled": true, "share_port": 1234 }),
            json!([]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        let current = AppConfig::default();
        let mut written = None;

        let result = commit_import(
            &inspected,
            &current,
            &[],
            &[], // nothing checked
            &mut ok_writer(&mut written),
            &mut || Ok(()),
        );

        assert!(result.error.is_none());
        let cfg = written.unwrap();
        assert_eq!(cfg.language, "en");
        // Listeners stay closed: ports/enables untouched without opt-in.
        assert_eq!(cfg.proxy_port, 9090);
        assert!(!cfg.share.enabled);
        assert_eq!(cfg.share.port, 9080);
        assert_eq!(result.applied_machine_bound, 0);
    }

    #[test]
    fn commit_applies_only_checked_machine_bound_keys() {
        let file = snapshot_json(
            json!({}),
            json!({ "proxy_port": 8866, "share_enabled": true }),
            json!([]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        let mut written = None;

        let result = commit_import(
            &inspected,
            &AppConfig::default(),
            &[],
            &["proxy_port".to_string()],
            &mut ok_writer(&mut written),
            &mut || Ok(()),
        );

        let cfg = written.unwrap();
        assert_eq!(cfg.proxy_port, 8866);
        assert!(!cfg.share.enabled); // unchecked — stays local
        assert_eq!(result.applied_machine_bound, 1);
    }

    #[test]
    fn commit_merge_never_disables_or_installs_plugins() {
        let file = snapshot_json(
            json!({}),
            json!({}),
            json!([
                { "id": "p.enable", "version": "1.0.0", "enabled": true },
                { "id": "p.missing", "version": "1.0.0", "enabled": true },
                { "id": "p.off", "version": "1.0.0", "enabled": false }
            ]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        let mut current = AppConfig::default();
        current.enabled_plugins = vec!["p.off".to_string(), "p.extra".to_string()];
        let installed = vec![
            installed("p.enable", "1.0.0", false),
            installed("p.off", "1.0.0", true),
        ];
        let mut written = None;

        let result = commit_import(
            &inspected,
            &current,
            &installed,
            &[],
            &mut ok_writer(&mut written),
            &mut || Ok(()),
        );

        let cfg = written.unwrap();
        // p.enable enabled; p.off stays enabled despite file saying
        // disabled; p.extra untouched; p.missing never auto-installed.
        assert!(cfg.enabled_plugins.contains(&"p.enable".to_string()));
        assert!(cfg.enabled_plugins.contains(&"p.off".to_string()));
        assert!(cfg.enabled_plugins.contains(&"p.extra".to_string()));
        assert!(!cfg.enabled_plugins.contains(&"p.missing".to_string()));
        assert_eq!(result.plugins_enabled, 1);
        assert_eq!(result.missing_plugins, 1);
    }

    #[test]
    fn commit_restores_bytes_when_write_fails() {
        let file = snapshot_json(json!({ "language": "en" }), json!({}), json!([]));
        let inspected = inspect_snapshot(&file).unwrap();
        let mut restored = false;

        let result = commit_import(
            &inspected,
            &AppConfig::default(),
            &[],
            &[],
            &mut |_| Err("disk full".to_string()),
            &mut || {
                restored = true;
                Ok(())
            },
        );

        assert!(restored, "byte restore must run on write failure");
        assert_eq!(result.error.as_deref(), Some("disk full"));
        assert!(!result.partial);
        assert_eq!(result.applied_settings, 0);
    }

    #[test]
    fn commit_reports_partial_when_rollback_fails() {
        let file = snapshot_json(json!({ "language": "en" }), json!({}), json!([]));
        let inspected = inspect_snapshot(&file).unwrap();

        let result = commit_import(
            &inspected,
            &AppConfig::default(),
            &[],
            &[],
            &mut |_| Err("disk full".to_string()),
            &mut || Err("restore io error".to_string()),
        );

        assert!(result.partial);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("rollback failed"));
    }

    #[test]
    fn commit_write_scrubs_legacy_plaintext_api_key() {
        // apply_config_snapshot commits a `load_config_internal` clone that
        // may still carry a legacy plaintext api_key; write_config_atomic
        // must scrub it on the way out, same as `save_config`.
        let mut config = AppConfig::default();
        config.ai_config.api_key = "sk-legacy-plaintext".to_string();
        config.ai_config.enabled = true;
        config.language = "en".to_string();
        config.proxy_port = 8866;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        crate::config::write_config_atomic(&path, &config).unwrap();

        // The caller's in-memory config is untouched — scrubbing applies to
        // the serialized copy only.
        assert_eq!(config.ai_config.api_key, "sk-legacy-plaintext");

        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("sk-legacy-plaintext"));
        let written: AppConfig = serde_json::from_str(&raw).unwrap();
        assert_eq!(written.ai_config.api_key, "");
        // Non-secret fields survive the round-trip.
        assert!(written.ai_config.enabled);
        assert_eq!(written.language, "en");
        assert_eq!(written.proxy_port, 8866);
    }

    // ── requires.host gate ───────────────────────────────────────────────

    #[test]
    fn requires_host_newer_than_app_blocks() {
        let mut file = snapshot_json(json!({}), json!({}), json!([]));
        file["requires"]["host"] = json!(">=999.0.0");
        let inspected = inspect_snapshot(&file).unwrap();
        assert!(!inspected.host_compatible);

        // An open floor covering this build is fine.
        let mut ok = snapshot_json(json!({}), json!({}), json!([]));
        ok["requires"]["host"] = json!(">=1.0.0");
        assert!(inspect_snapshot(&ok).unwrap().host_compatible);

        // Invalid ranges are fail-closed, same as plugin engines.
        let mut bad = snapshot_json(json!({}), json!({}), json!([]));
        bad["requires"]["host"] = json!("banana");
        assert!(!inspect_snapshot(&bad).unwrap().host_compatible);
    }

    // ── Re-validation (apply never trusts a preview) ─────────────────────

    #[test]
    fn reinspection_of_a_swapped_file_yields_a_different_plan() {
        // apply_config_snapshot re-runs inspect+plan on the file itself;
        // swapping the file between preview and apply changes the outcome.
        let file_a = snapshot_json(json!({ "language": "en" }), json!({}), json!([]));
        let file_b = snapshot_json(
            json!({ "language": "en" }),
            json!({ "proxy_port": 8866 }),
            json!([]),
        );
        let inspected_a = inspect_snapshot(&file_a).unwrap();
        let inspected_b = inspect_snapshot(&file_b).unwrap();
        assert!(inspected_a.machine_bound.is_empty());
        assert_eq!(
            inspected_b.machine_bound.get("proxy_port"),
            Some(&json!(8866))
        );
    }

    #[test]
    fn invalid_setting_values_are_flagged_not_applied() {
        let file = snapshot_json(
            json!({ "language": 42, "proxy_port": "not-here", "always_on_top": true }),
            json!({ "proxy_port": 70000, "ssl_insecure": "yes" }),
            json!([]),
        );
        let inspected = inspect_snapshot(&file).unwrap();
        assert!(inspected.settings.contains_key("always_on_top"));
        assert!(!inspected.settings.contains_key("language"));
        assert!(!inspected.machine_bound.contains_key("proxy_port"));
        assert_eq!(inspected.invalid_settings, vec!["settings.language"]);
        assert_eq!(
            inspected.invalid_machine_bound,
            vec!["machine_bound.proxy_port", "machine_bound.ssl_insecure"]
        );
    }
}
