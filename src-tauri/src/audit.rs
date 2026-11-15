//! Structured audit events written to `logs/audit.log` as JSONL.
//!
//! Every line is one JSON object (schema v1, camelCase):
//! `{ "v":1, "ts":"<RFC3339 local>", "actor":"user|plugin|mcp|ai|system",
//!    "actorId"?, "actorName"?, "action", "target"?,
//!    "result":"ok|denied|error|aborted", "detail"?, "meta"? }`
//!
//! `audit()` enqueues on the shared log writer with domain "audit", which
//! keeps the existing bounded-queue + 2s no-drop retry behaviour. The writer
//! emits the JSON payload as-is; `write_domain_log("audit", text)` callers
//! that bypass `audit()` are wrapped into a `system/note` event by
//! `ensure_audit_json` so every new line stays machine-readable.

use serde::Serialize;
use serde_json::json;

/// Schema version stamped on every event.
pub const AUDIT_SCHEMA_VERSION: u32 = 1;
/// Upper bound for `detail` text (chars).
const DETAIL_LIMIT: usize = 2000;
/// Lines scanned per audit.log generation when serving `get_audit_events`.
const AUDIT_SCAN_LINES: usize = 5000;
/// Rotated generations inspected after `audit.log` itself.
const AUDIT_MAX_ROTATIONS: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditActor {
    User,
    Plugin,
    Mcp,
    /// Reserved for host-initiated AI actions that are not user requests
    /// (e.g. background maintenance); `ai.request` events use user/plugin.
    #[allow(dead_code)]
    Ai,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditResult {
    Ok,
    Denied,
    Error,
    Aborted,
}

/// One audit event. Build with the actor constructors, chain the optional
/// fields, then hand to [`audit`].
#[derive(Debug, Clone)]
pub struct AuditEvent {
    actor: AuditActor,
    actor_id: Option<String>,
    actor_name: Option<String>,
    action: String,
    target: Option<String>,
    result: AuditResult,
    detail: Option<String>,
    meta: Option<serde_json::Value>,
}

impl AuditEvent {
    pub fn new(actor: AuditActor, action: impl Into<String>) -> Self {
        Self {
            actor,
            actor_id: None,
            actor_name: None,
            action: action.into(),
            target: None,
            result: AuditResult::Ok,
            detail: None,
            meta: None,
        }
    }

    /// Frontend-invoked user action.
    pub fn user(action: impl Into<String>) -> Self {
        Self::new(AuditActor::User, action)
    }

    /// Host-initiated / non-user action.
    pub fn system(action: impl Into<String>) -> Self {
        Self::new(AuditActor::System, action)
    }

    /// Plugin bridge call; `actor_id` is the plugin id, `actor_name` the
    /// manifest name when known.
    pub fn plugin(
        actor_id: impl Into<String>,
        actor_name: Option<String>,
        action: impl Into<String>,
    ) -> Self {
        let mut event = Self::new(AuditActor::Plugin, action).actor_id(actor_id);
        if let Some(name) = actor_name {
            event = event.actor_name(name);
        }
        event
    }

    /// MCP tool call; `actor_id` is the client name (or "unknown").
    pub fn mcp(actor_id: impl Into<String>, action: impl Into<String>) -> Self {
        Self::new(AuditActor::Mcp, action).actor_id(actor_id)
    }

    pub fn actor_id(mut self, actor_id: impl Into<String>) -> Self {
        self.actor_id = Some(actor_id.into());
        self
    }

    pub fn actor_name(mut self, actor_name: impl Into<String>) -> Self {
        self.actor_name = Some(actor_name.into());
        self
    }

    pub fn target(mut self, target: impl Into<String>) -> Self {
        self.target = Some(target.into());
        self
    }

    pub fn result(mut self, result: AuditResult) -> Self {
        self.result = result;
        self
    }

    /// Free-form detail, truncated to [`DETAIL_LIMIT`] chars.
    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        self.detail = Some(detail.chars().take(DETAIL_LIMIT).collect());
        self
    }

    /// Structured context; only objects are persisted.
    pub fn meta(mut self, meta: serde_json::Value) -> Self {
        if meta.is_object() {
            self.meta = Some(meta);
        }
        self
    }

    /// Serialize to the single JSONL line written to audit.log.
    pub fn to_line(&self) -> String {
        let ts = chrono::Local::now().to_rfc3339();
        let mut record = json!({
            "v": AUDIT_SCHEMA_VERSION,
            "ts": ts,
            "actor": self.actor,
            "action": self.action,
            "result": self.result,
        });
        let obj = record.as_object_mut().expect("audit record is an object");
        if let Some(actor_id) = &self.actor_id {
            obj.insert("actorId".to_string(), json!(actor_id));
        }
        if let Some(actor_name) = &self.actor_name {
            obj.insert("actorName".to_string(), json!(actor_name));
        }
        if let Some(target) = &self.target {
            obj.insert("target".to_string(), json!(target));
        }
        if let Some(detail) = &self.detail {
            obj.insert("detail".to_string(), json!(detail));
        }
        if let Some(meta) = &self.meta {
            obj.insert("meta".to_string(), meta.clone());
        }
        serde_json::to_string(&record).unwrap_or_else(|_| "{}".to_string())
    }
}

/// Enqueue an audit event on the shared writer (domain "audit").
/// Fire-and-forget like `write_domain_log`: failures are not propagated to
/// the caller because auditing must never break the audited operation.
pub fn audit(event: AuditEvent) {
    let _ = crate::logging::write_domain_log("audit", &event.to_line());
}

/// Guarantee an audit-domain payload is a single JSON object line. Anything
/// that does not already parse as a JSON object is wrapped as a `system`
/// "note" event so audit.log stays valid JSONL for legacy/plaintext callers.
pub(crate) fn ensure_audit_json(message: &str) -> String {
    let is_json_object = serde_json::from_str::<serde_json::Value>(message)
        .map(|v| v.is_object())
        .unwrap_or(false);
    if is_json_object {
        return message.to_string();
    }
    AuditEvent::system("note").detail(message).to_line()
}

// ── Reading events back (get_audit_events) ─────────────────────────────────

/// Frontend-facing view of one audit.log line — either a parsed JSON event
/// or a legacy/pre-JSONL line kept verbatim.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
    /// True for lines that are not JSON events (pre-JSONL audit.log content
    /// or anything that failed to parse).
    pub legacy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

fn json_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Parse one audit.log line. JSON objects become structured entries;
/// anything else (including malformed JSON) becomes a legacy row whose
/// timestamp is recovered from a leading "[YYYY-MM-DD HH:MM:SS]" prefix.
fn parse_audit_line(line: &str) -> AuditLogEntry {
    let trimmed = line.trim();
    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if value.is_object() {
                return AuditLogEntry {
                    ts: json_str(&value, "ts"),
                    actor: json_str(&value, "actor"),
                    actor_id: json_str(&value, "actorId"),
                    actor_name: json_str(&value, "actorName"),
                    action: json_str(&value, "action"),
                    target: json_str(&value, "target"),
                    result: json_str(&value, "result"),
                    detail: json_str(&value, "detail"),
                    meta: value.get("meta").filter(|m| m.is_object()).cloned(),
                    legacy: false,
                    raw: None,
                };
            }
        }
    }
    AuditLogEntry {
        ts: parse_legacy_ts(trimmed),
        legacy: true,
        raw: Some(trimmed.to_string()),
        ..AuditLogEntry::default()
    }
}

/// Recover "YYYY-MM-DD HH:MM:SS" from a leading "[...]" prefix used by the
/// pre-JSONL text format.
fn parse_legacy_ts(line: &str) -> Option<String> {
    let inner = line.strip_prefix('[')?;
    let end = inner.find(']')?;
    let ts = &inner[..end];
    let bytes = ts.as_bytes();
    let shaped = ts.len() == 19
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b' '
        && bytes[13] == b':'
        && bytes[16] == b':';
    shaped.then(|| ts.to_string())
}

/// actor: exact match on the event actor (legacy rows never match a
/// non-empty actor filter). query: case-insensitive substring over
/// action/target/detail/actorName/actorId — and `raw` for legacy rows.
fn entry_matches(entry: &AuditLogEntry, actor: Option<&str>, query: Option<&str>) -> bool {
    if let Some(actor) = actor {
        if entry.actor.as_deref() != Some(actor) {
            return false;
        }
    }
    if let Some(query) = query {
        let query = query.to_lowercase();
        let haystack = if entry.legacy {
            entry.raw.clone().unwrap_or_default()
        } else {
            [
                entry.action.as_deref(),
                entry.target.as_deref(),
                entry.detail.as_deref(),
                entry.actor_name.as_deref(),
                entry.actor_id.as_deref(),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ")
        };
        if !haystack.to_lowercase().contains(&query) {
            return false;
        }
    }
    true
}

/// Parse + filter `lines` (oldest→newest, as read from one file) and return
/// matching entries newest-first, capped at `limit`.
fn select_events(
    lines: &[String],
    limit: usize,
    actor: Option<&str>,
    query: Option<&str>,
) -> Vec<AuditLogEntry> {
    let mut entries: Vec<AuditLogEntry> = lines
        .iter()
        .map(|line| parse_audit_line(line))
        .filter(|entry| entry_matches(entry, actor, query))
        .collect();
    entries.reverse();
    entries.truncate(limit);
    entries
}

/// Tauri command backing the Security & Privacy activity log.
///
/// Reads the tail of `logs/audit.log` and continues into rotated
/// `audit.log.N` files while fewer than `limit` matches were found.
#[tauri::command]
pub fn get_audit_events(
    limit: Option<u32>,
    actor: Option<String>,
    query: Option<String>,
) -> Result<Vec<AuditLogEntry>, String> {
    let limit = limit.unwrap_or(200).clamp(1, 500) as usize;
    let actor = actor.filter(|a| !a.trim().is_empty());
    let query = query
        .map(|q| q.trim().to_lowercase())
        .filter(|q| !q.is_empty());

    let log_dir = crate::config::get_app_root_dir()?.join("logs");
    let audit_path = log_dir.join("audit.log");

    let mut events: Vec<AuditLogEntry> = Vec::new();
    for generation in 0..=AUDIT_MAX_ROTATIONS {
        let path = if generation == 0 {
            audit_path.clone()
        } else {
            crate::logging::rotated_path(&audit_path, generation)
        };
        if !path.exists() {
            continue;
        }
        let lines = crate::logging::read_last_n_lines(&path, AUDIT_SCAN_LINES)
            .map_err(|e| format!("Failed to read audit log: {}", e))?;
        // Older generations hold older events: append after what we have.
        events.extend(select_events(
            &lines,
            limit.saturating_sub(events.len()),
            actor.as_deref(),
            query.as_deref(),
        ));
        if events.len() >= limit {
            break;
        }
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_line(actor: &str, action: &str, detail: Option<&str>) -> String {
        AuditEvent::new(
            match actor {
                "plugin" => AuditActor::Plugin,
                "mcp" => AuditActor::Mcp,
                "ai" => AuditActor::Ai,
                "system" => AuditActor::System,
                _ => AuditActor::User,
            },
            action,
        )
        .detail(detail.unwrap_or(""))
        .to_line()
    }

    #[test]
    fn to_line_serializes_schema_v1_camel_case() {
        let line = AuditEvent::plugin("p1", Some("My Plugin".to_string()), "plugin.call")
            .target("storage_get")
            .result(AuditResult::Denied)
            .detail("nope")
            .meta(json!({"k": 1}))
            .to_line();
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["v"], 1);
        assert_eq!(value["actor"], "plugin");
        assert_eq!(value["actorId"], "p1");
        assert_eq!(value["actorName"], "My Plugin");
        assert_eq!(value["action"], "plugin.call");
        assert_eq!(value["target"], "storage_get");
        assert_eq!(value["result"], "denied");
        assert_eq!(value["detail"], "nope");
        assert_eq!(value["meta"]["k"], 1);
        assert!(value["ts"].as_str().unwrap().contains('T'));
        // Optional fields are omitted when unset.
        let minimal: serde_json::Value =
            serde_json::from_str(&AuditEvent::user("config.update").to_line()).unwrap();
        assert!(minimal.get("actorId").is_none());
        assert!(minimal.get("target").is_none());
        assert!(minimal.get("detail").is_none());
        assert!(minimal.get("meta").is_none());
        assert_eq!(minimal["result"], "ok");
    }

    #[test]
    fn detail_is_truncated_to_limit() {
        let long = "x".repeat(DETAIL_LIMIT + 100);
        let line = AuditEvent::user("config.update").detail(long).to_line();
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(
            value["detail"].as_str().unwrap().chars().count(),
            DETAIL_LIMIT
        );
    }

    #[test]
    fn ensure_audit_json_wraps_plaintext() {
        let wrapped = ensure_audit_json("Updated Configuration: proxy_port");
        let value: serde_json::Value = serde_json::from_str(&wrapped).unwrap();
        assert_eq!(value["actor"], "system");
        assert_eq!(value["action"], "note");
        assert_eq!(value["detail"], "Updated Configuration: proxy_port");
        // Already-JSON payloads pass through untouched.
        let json = "{\"v\":1,\"actor\":\"user\"}";
        assert_eq!(ensure_audit_json(json), json);
        // Malformed JSON is also wrapped.
        let bad = ensure_audit_json("{not json");
        assert!(serde_json::from_str::<serde_json::Value>(&bad).is_ok());
    }

    #[test]
    fn parse_mixed_json_and_legacy_lines() {
        let json_line = event_line("user", "config.update", Some("proxy_port: 9090"));
        let legacy_line = "[2025-01-02 03:04:05] [AUDIT] Updated Configuration: old";
        let malformed = "{broken json";
        let lines = vec![
            legacy_line.to_string(),
            json_line.clone(),
            malformed.to_string(),
        ];
        let entries = select_events(&lines, 10, None, None);
        // Newest first: malformed (last line) → json → legacy.
        assert_eq!(entries.len(), 3);
        assert!(entries[0].legacy);
        assert_eq!(entries[0].raw.as_deref(), Some(malformed));
        assert!(!entries[1].legacy);
        assert_eq!(entries[1].action.as_deref(), Some("config.update"));
        assert_eq!(entries[1].actor.as_deref(), Some("user"));
        assert!(entries[2].legacy);
        assert_eq!(entries[2].ts.as_deref(), Some("2025-01-02 03:04:05"));
    }

    #[test]
    fn filters_actor_and_query() {
        let lines = vec![
            event_line("user", "config.update", Some("proxy_port")),
            AuditEvent::plugin("p1", None, "plugin.call")
                .target("http_send")
                .to_line(),
            event_line("mcp", "mcp.create_rule", Some("map_local api.test")),
        ];
        // Actor filter is exact.
        let plugin_only = select_events(&lines, 10, Some("plugin"), None);
        assert_eq!(plugin_only.len(), 1);
        assert_eq!(plugin_only[0].actor_id.as_deref(), Some("p1"));
        // Query is case-insensitive across action/target/detail/actor fields.
        let by_action = select_events(&lines, 10, None, Some("CONFIG.UPDATE"));
        assert_eq!(by_action.len(), 1);
        let by_target = select_events(&lines, 10, None, Some("http_send"));
        assert_eq!(by_target.len(), 1);
        let by_actor_name = select_events(&lines, 10, None, Some("p1"));
        assert_eq!(by_actor_name.len(), 1);
        // Legacy rows are searchable via raw.
        let with_legacy =
            vec!["[2025-01-02 03:04:05] [AUDIT] Installed Plugin: old-one".to_string()];
        assert_eq!(
            select_events(&with_legacy, 10, None, Some("old-one")).len(),
            1
        );
        // Legacy rows never match an actor filter.
        assert!(select_events(&with_legacy, 10, Some("user"), None).is_empty());
    }

    #[test]
    fn select_events_respects_limit_newest_first() {
        let lines: Vec<String> = (0..10)
            .map(|i| event_line("user", "config.update", Some(&format!("n{i}"))))
            .collect();
        let entries = select_events(&lines, 3, None, None);
        assert_eq!(entries.len(), 3);
        // Newest = highest index first.
        assert_eq!(entries[0].detail.as_deref(), Some("n9"));
        assert_eq!(entries[2].detail.as_deref(), Some("n7"));
    }
}
