//! AI usage recording and privacy-facing statistics.
//!
//! Every AI request passing through `AIClient` is recorded exactly once at
//! the egress point via `UsageGuard`. Records live in an in-memory ring
//! buffer (newest first, capped) for per-request inspection; only daily
//! token/request aggregates are persisted to `<data_dir>/ai_usage.json`.
//! Message contents are never persisted.

use super::client::{ChatCompletionChunk, ChatMessage, Tool};
use super::commands::AIState;
use super::config::AIConfig;
use super::crypto;
use crate::common::sync::lock_unpoisoned;
use crate::logging;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tauri::State;

const RECENT_LIMIT: usize = 50;
const RETAIN_DAYS: i64 = 30;
const MESSAGE_CONTENT_LIMIT: usize = 8000;
const ERROR_LIMIT: usize = 300;

/// Identifies which surface initiated an AI request, for attribution in
/// usage records and audit logs.
#[derive(Debug, Clone)]
pub enum AiCaller {
    App,
    Plugin(String),
    ConnectionTest,
}

impl AiCaller {
    pub fn label(&self) -> String {
        match self {
            Self::App => "app".to_string(),
            Self::Plugin(id) => format!("plugin:{id}"),
            Self::ConnectionTest => "connection_test".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageMessage {
    pub role: String,
    pub content: String,
    pub original_chars: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageRecord {
    pub id: String,
    pub timestamp_ms: i64,
    pub caller: String,
    pub provider: String,
    pub model: String,
    pub endpoint_host: String,
    pub stream: bool,
    pub tools: bool,
    pub tool_names: Vec<String>,
    pub status: String,
    pub duration_ms: u64,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub estimated: bool,
    pub error: Option<String>,
    pub messages: Vec<AiUsageMessage>,
}

impl AiUsageRecord {
    fn to_meta(&self) -> AiUsageRecentMeta {
        AiUsageRecentMeta {
            id: self.id.clone(),
            timestamp_ms: self.timestamp_ms,
            caller: self.caller.clone(),
            provider: self.provider.clone(),
            model: self.model.clone(),
            endpoint_host: self.endpoint_host.clone(),
            stream: self.stream,
            tools: self.tools,
            tool_names: self.tool_names.clone(),
            status: self.status.clone(),
            duration_ms: self.duration_ms,
            prompt_tokens: self.prompt_tokens,
            completion_tokens: self.completion_tokens,
            total_tokens: self.total_tokens,
            estimated: self.estimated,
            error: self.error.clone(),
            message_count: self.messages.len(),
            total_chars: self.messages.iter().map(|m| m.original_chars).sum(),
        }
    }
}

/// Record metadata without message payloads — what the recent-requests
/// list renders before a detail is expanded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageRecentMeta {
    pub id: String,
    pub timestamp_ms: i64,
    pub caller: String,
    pub provider: String,
    pub model: String,
    pub endpoint_host: String,
    pub stream: bool,
    pub tools: bool,
    pub tool_names: Vec<String>,
    pub status: String,
    pub duration_ms: u64,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub estimated: bool,
    pub error: Option<String>,
    pub message_count: usize,
    pub total_chars: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageDailyBucket {
    pub date: String,
    pub caller: String,
    pub model: String,
    pub requests: u64,
    pub errors: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub estimated_requests: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageSummary {
    pub daily: Vec<AiUsageDailyBucket>,
    pub recent: Vec<AiUsageRecentMeta>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyStatus {
    pub provider: String,
    pub has_key: bool,
    pub masked: String,
}

// ── On-disk daily aggregates ──────────────────────────────────────────────
// Shape: { "version": 1, "days": { "YYYY-MM-DD": { "<caller>\u{1f}<model>": {...} } } }

type UsageDays = BTreeMap<String, BTreeMap<String, DayBucket>>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct DayBucket {
    requests: u64,
    errors: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
    estimated_requests: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct UsageFile {
    version: u32,
    days: UsageDays,
}

struct UsageStore {
    /// Newest first; content-bearing records, memory only.
    recent: VecDeque<AiUsageRecord>,
    days: UsageDays,
    persist_path: Option<PathBuf>,
}

impl UsageStore {
    fn open(persist_path: Option<PathBuf>) -> Self {
        let days = persist_path
            .as_deref()
            .map(load_usage_file)
            .unwrap_or_default();
        Self {
            recent: VecDeque::new(),
            days,
            persist_path,
        }
    }

    fn record(&mut self, record: AiUsageRecord) {
        self.recent.push_front(record.clone());
        if self.recent.len() > RECENT_LIMIT {
            self.recent.pop_back();
        }

        let date = local_date(record.timestamp_ms);
        let key = bucket_key(&record.caller, &record.model);
        let bucket = self.days.entry(date).or_default().entry(key).or_default();
        bucket.requests += 1;
        if record.status == "error" {
            bucket.errors += 1;
        }
        bucket.prompt_tokens += u64::from(record.prompt_tokens);
        bucket.completion_tokens += u64::from(record.completion_tokens);
        bucket.total_tokens += u64::from(record.total_tokens);
        if record.estimated {
            bucket.estimated_requests += 1;
        }

        prune_days(&mut self.days);
        self.persist();
    }

    fn persist(&self) {
        let Some(path) = &self.persist_path else {
            return;
        };
        if let Err(e) = save_usage_file(path, &self.days) {
            log::warn!("Failed to persist AI usage stats: {}", e);
        }
    }

    fn summary(&self, days: u32) -> AiUsageSummary {
        let cutoff = summary_cutoff_date(days);
        let mut daily: Vec<AiUsageDailyBucket> = Vec::new();
        for (date, buckets) in &self.days {
            if date < &cutoff {
                continue;
            }
            for (key, bucket) in buckets {
                let (caller, model) = split_bucket_key(key);
                daily.push(AiUsageDailyBucket {
                    date: date.clone(),
                    caller: caller.to_string(),
                    model: model.to_string(),
                    requests: bucket.requests,
                    errors: bucket.errors,
                    prompt_tokens: bucket.prompt_tokens,
                    completion_tokens: bucket.completion_tokens,
                    total_tokens: bucket.total_tokens,
                    estimated_requests: bucket.estimated_requests,
                });
            }
        }
        daily.sort_by(|a, b| (&a.date, &a.caller, &a.model).cmp(&(&b.date, &b.caller, &b.model)));

        AiUsageSummary {
            daily,
            recent: self.recent.iter().map(AiUsageRecord::to_meta).collect(),
        }
    }

    fn clear(&mut self) {
        self.recent.clear();
        self.days.clear();
        if let Some(path) = &self.persist_path {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => log::warn!("Failed to delete AI usage file {:?}: {}", path, e),
            }
        }
    }
}

fn default_usage_path() -> Option<PathBuf> {
    crate::config::get_data_dir()
        .ok()
        .map(|dir| dir.join("ai_usage.json"))
}

static USAGE_STORE: LazyLock<Mutex<UsageStore>> =
    LazyLock::new(|| Mutex::new(UsageStore::open(default_usage_path())));

fn record_usage_request(record: AiUsageRecord) {
    let mut store = lock_unpoisoned(&USAGE_STORE);
    store.record(record);
}

fn local_date(timestamp_ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(timestamp_ms)
        .map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_default()
}

fn summary_cutoff_date(days: u32) -> String {
    let days = i64::from(days.clamp(1, 30));
    (chrono::Local::now() - chrono::Duration::days(days - 1))
        .format("%Y-%m-%d")
        .to_string()
}

fn bucket_key(caller: &str, model: &str) -> String {
    format!("{}\u{1f}{}", caller, model)
}

fn split_bucket_key(key: &str) -> (&str, &str) {
    key.split_once('\u{1f}').unwrap_or((key, ""))
}

fn prune_days(days: &mut UsageDays) {
    let cutoff = (chrono::Local::now() - chrono::Duration::days(RETAIN_DAYS - 1))
        .format("%Y-%m-%d")
        .to_string();
    days.retain(|date, _| date >= &cutoff);
}

fn load_usage_file(path: &Path) -> UsageDays {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("Failed to read AI usage file {:?}: {}", path, e);
            }
            return UsageDays::new();
        }
    };
    match serde_json::from_str::<UsageFile>(&content) {
        Ok(file) if file.version == 1 => file.days,
        Ok(file) => {
            log::warn!(
                "Unsupported AI usage file version {}, starting empty",
                file.version
            );
            UsageDays::new()
        }
        Err(e) => {
            log::warn!("Corrupt AI usage file {:?}: {}", path, e);
            UsageDays::new()
        }
    }
}

fn save_usage_file(path: &Path, days: &UsageDays) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = UsageFile {
        version: 1,
        days: days.clone(),
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, json)?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}

fn endpoint_host(endpoint: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    for candidate in [trimmed.to_string(), format!("http://{}", trimmed)] {
        if let Ok(url) = url::Url::parse(&candidate) {
            if let Some(host) = url.host_str() {
                return host.to_string();
            }
        }
    }
    String::new()
}

fn snapshot_messages(messages: &[ChatMessage]) -> Vec<AiUsageMessage> {
    messages
        .iter()
        .map(|message| {
            let content = message.content.clone().unwrap_or_default();
            let original_chars = content.chars().count();
            let truncated = original_chars > MESSAGE_CONTENT_LIMIT;
            AiUsageMessage {
                role: message.role.clone(),
                content: content.chars().take(MESSAGE_CONTENT_LIMIT).collect(),
                original_chars,
                truncated,
            }
        })
        .collect()
}

fn mask_api_key(key: &str) -> String {
    if key.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = key.chars().collect();
    if chars.len() < 12 {
        return "••••".to_string();
    }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{}…{}", head, tail)
}

/// Guard that records exactly one usage record per AI request. Created at
/// the start of a request; `record_success` / `record_error` /
/// `record_stream_end` finalize it explicitly, and `Drop` finalizes as
/// "aborted" when the request ends without an explicit outcome (e.g. the
/// frontend dropped a stream early).
pub struct UsageGuard {
    record: Option<AiUsageRecord>,
    started: Instant,
    output_chars: usize,
    approx_prompt_tokens: u32,
    audit_endpoint: Option<String>,
    record_fn: fn(AiUsageRecord),
    finalized: bool,
}

impl UsageGuard {
    pub fn new(
        caller: &AiCaller,
        config: &AIConfig,
        stream: bool,
        messages: &[ChatMessage],
        tools: Option<&[Tool]>,
    ) -> Self {
        Self::with_recorder(
            caller,
            config,
            stream,
            messages,
            tools,
            record_usage_request,
        )
    }

    #[cfg(test)]
    fn with_test_recorder(
        caller: &AiCaller,
        config: &AIConfig,
        stream: bool,
        messages: &[ChatMessage],
        tools: Option<&[Tool]>,
    ) -> Self {
        Self::with_recorder(caller, config, stream, messages, tools, test_record_sink)
    }

    fn with_recorder(
        caller: &AiCaller,
        config: &AIConfig,
        stream: bool,
        messages: &[ChatMessage],
        tools: Option<&[Tool]>,
        record_fn: fn(AiUsageRecord),
    ) -> Self {
        let message_chars: usize = messages
            .iter()
            .map(|m| m.content.as_ref().map(|v| v.len()).unwrap_or(0))
            .sum();
        let approx_prompt_tokens = u32::try_from(message_chars / 4).unwrap_or(u32::MAX);

        Self {
            record: Some(AiUsageRecord {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp_ms: chrono::Local::now().timestamp_millis(),
                caller: caller.label(),
                provider: config.provider.clone(),
                model: config.model.clone(),
                endpoint_host: endpoint_host(&config.get_endpoint()),
                stream,
                tools: tools.is_some(),
                tool_names: tools
                    .map(|list| list.iter().map(|tool| tool.function.name.clone()).collect())
                    .unwrap_or_default(),
                status: String::new(),
                duration_ms: 0,
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                estimated: true,
                error: None,
                messages: snapshot_messages(messages),
            }),
            started: Instant::now(),
            output_chars: 0,
            approx_prompt_tokens,
            audit_endpoint: None,
            record_fn,
            finalized: false,
        }
    }

    /// Enable the "AI Usage" audit line written when the guard finalizes.
    /// Only used on the streaming path, where the non-stream audit site
    /// does not exist.
    pub fn set_finish_audit_endpoint(&mut self, endpoint: String) {
        self.audit_endpoint = Some(endpoint);
    }

    /// Accumulate streamed output size (content + tool call fragments).
    pub fn observe_chunk(&mut self, chunk: &ChatCompletionChunk) {
        for choice in &chunk.choices {
            if let Some(content) = &choice.delta.content {
                self.output_chars += content.len();
            }
            if let Some(tool_calls) = &choice.delta.tool_calls {
                for call in tool_calls {
                    if let Some(id) = &call.id {
                        self.output_chars += id.len();
                    }
                    if let Some(function) = &call.function {
                        if let Some(name) = &function.name {
                            self.output_chars += name.len();
                        }
                        if let Some(arguments) = &function.arguments {
                            self.output_chars += arguments.len();
                        }
                    }
                }
            }
        }
    }

    pub fn record_success(
        &mut self,
        prompt_tokens: u32,
        completion_tokens: u32,
        total_tokens: u32,
        estimated: bool,
    ) {
        self.finish(
            "success",
            prompt_tokens,
            completion_tokens,
            total_tokens,
            estimated,
            None,
        );
    }

    /// Stream ran to completion; tokens are estimated from accumulated
    /// output chars (providers do not return stream usage here).
    pub fn record_stream_end(&mut self) {
        let completion_tokens = u32::try_from(self.output_chars / 4).unwrap_or(u32::MAX);
        let prompt_tokens = self.approx_prompt_tokens;
        self.record_success(
            prompt_tokens,
            completion_tokens,
            prompt_tokens.saturating_add(completion_tokens),
            true,
        );
    }

    pub fn record_error(&mut self, error: String) {
        let completion_tokens = u32::try_from(self.output_chars / 4).unwrap_or(u32::MAX);
        let prompt_tokens = self.approx_prompt_tokens;
        self.finish(
            "error",
            prompt_tokens,
            completion_tokens,
            prompt_tokens.saturating_add(completion_tokens),
            true,
            Some(error),
        );
    }

    fn finish(
        &mut self,
        status: &str,
        prompt_tokens: u32,
        completion_tokens: u32,
        total_tokens: u32,
        estimated: bool,
        error: Option<String>,
    ) {
        if self.finalized {
            return;
        }
        self.finalized = true;
        let Some(mut record) = self.record.take() else {
            return;
        };

        record.status = status.to_string();
        record.duration_ms = u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX);
        record.prompt_tokens = prompt_tokens;
        record.completion_tokens = completion_tokens;
        record.total_tokens = total_tokens;
        record.estimated = estimated;
        record.error = error.map(|e| e.chars().take(ERROR_LIMIT).collect());

        self.write_finish_audit(&record);
        (self.record_fn)(record);
    }

    fn write_finish_audit(&self, record: &AiUsageRecord) {
        let Some(endpoint) = &self.audit_endpoint else {
            return;
        };
        let usage_source = if record.estimated {
            "estimated_chars_div_4"
        } else {
            "response"
        };
        let _ = logging::write_domain_log(
            "audit",
            &format!(
                "AI Usage: endpoint={}, model={}, prompt_tokens={}, completion_tokens={}, total_tokens={}, usage_source={}, caller={}",
                endpoint,
                record.model,
                record.prompt_tokens,
                record.completion_tokens,
                record.total_tokens,
                usage_source,
                record.caller
            ),
        );
    }
}

impl Drop for UsageGuard {
    fn drop(&mut self) {
        if self.finalized {
            return;
        }
        let completion_tokens = u32::try_from(self.output_chars / 4).unwrap_or(u32::MAX);
        let prompt_tokens = self.approx_prompt_tokens;
        self.finish(
            "aborted",
            prompt_tokens,
            completion_tokens,
            prompt_tokens.saturating_add(completion_tokens),
            true,
            None,
        );
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_ai_usage_summary(days: u32) -> AiUsageSummary {
    let store = lock_unpoisoned(&USAGE_STORE);
    store.summary(days)
}

#[tauri::command]
pub fn get_ai_request_detail(id: String) -> Option<AiUsageRecord> {
    let store = lock_unpoisoned(&USAGE_STORE);
    store.recent.iter().find(|r| r.id == id).cloned()
}

#[tauri::command]
pub fn clear_ai_usage() -> Result<(), String> {
    lock_unpoisoned(&USAGE_STORE).clear();
    let _ = logging::write_domain_log("audit", "Cleared AI usage history");
    Ok(())
}

#[tauri::command]
pub fn get_ai_key_status(state: State<'_, AIState>) -> Result<AiKeyStatus, String> {
    let provider = lock_unpoisoned(&state.config).provider.clone();
    let key = crypto::retrieve_api_key(&provider).unwrap_or_default();
    Ok(AiKeyStatus {
        provider,
        has_key: !key.is_empty(),
        masked: mask_api_key(&key),
    })
}

#[cfg(test)]
static TEST_RECORDS: Mutex<Vec<AiUsageRecord>> = Mutex::new(Vec::new());

/// Serializes tests that share the `TEST_RECORDS` sink so parallel test
/// threads cannot drain each other's records.
#[cfg(test)]
static GUARD_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
fn guard_test_lock() -> std::sync::MutexGuard<'static, ()> {
    lock_unpoisoned(&GUARD_TEST_LOCK)
}

#[cfg(test)]
fn test_record_sink(record: AiUsageRecord) {
    lock_unpoisoned(&TEST_RECORDS).push(record);
}

#[cfg(test)]
fn test_messages(content: &str) -> Vec<ChatMessage> {
    vec![ChatMessage {
        role: "user".to_string(),
        content: Some(content.to_string()),
        name: None,
        tool_call_id: None,
    }]
}

#[cfg(test)]
fn test_config() -> AIConfig {
    AIConfig {
        provider: "openai".to_string(),
        model: "gpt-test".to_string(),
        custom_endpoint: Some("https://api.example.com/v1".to_string()),
        ..AIConfig::default()
    }
}

#[cfg(test)]
fn drain_test_records() -> Vec<AiUsageRecord> {
    std::mem::take(&mut *lock_unpoisoned(&TEST_RECORDS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::client::{
        ChunkChoice, ChunkDelta, FunctionDefinition, StreamingFunctionCall, StreamingToolCall,
    };

    fn record_with(
        caller: &str,
        model: &str,
        status: &str,
        estimated: bool,
        timestamp_ms: i64,
    ) -> AiUsageRecord {
        AiUsageRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp_ms,
            caller: caller.to_string(),
            provider: "openai".to_string(),
            model: model.to_string(),
            endpoint_host: "api.example.com".to_string(),
            stream: false,
            tools: false,
            tool_names: vec![],
            status: status.to_string(),
            duration_ms: 12,
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            estimated,
            error: None,
            messages: vec![],
        }
    }

    fn now_ms() -> i64 {
        chrono::Local::now().timestamp_millis()
    }

    fn days_ago_ms(days: i64) -> i64 {
        (chrono::Local::now() - chrono::Duration::days(days)).timestamp_millis()
    }

    #[test]
    fn aggregates_same_day_caller_model_and_separates_callers() {
        let mut store = UsageStore::open(None);
        store.record(record_with("app", "gpt-test", "success", false, now_ms()));
        store.record(record_with("app", "gpt-test", "error", true, now_ms()));
        store.record(record_with(
            "plugin:p1",
            "gpt-test",
            "success",
            false,
            now_ms(),
        ));

        let date = local_date(now_ms());
        let app_bucket = &store.days[&date][&bucket_key("app", "gpt-test")];
        assert_eq!(app_bucket.requests, 2);
        assert_eq!(app_bucket.errors, 1);
        assert_eq!(app_bucket.prompt_tokens, 20);
        assert_eq!(app_bucket.total_tokens, 30);
        assert_eq!(app_bucket.estimated_requests, 1);

        let plugin_bucket = &store.days[&date][&bucket_key("plugin:p1", "gpt-test")];
        assert_eq!(plugin_bucket.requests, 1);
        assert_eq!(plugin_bucket.errors, 0);
    }

    #[test]
    fn prunes_aggregates_older_than_30_days() {
        let mut store = UsageStore::open(None);
        store.record(record_with(
            "app",
            "gpt-test",
            "success",
            false,
            days_ago_ms(35),
        ));
        store.record(record_with("app", "gpt-test", "success", false, now_ms()));

        let old_date = local_date(days_ago_ms(35));
        assert!(!store.days.contains_key(&old_date));
        assert!(store.days.contains_key(&local_date(now_ms())));
    }

    #[test]
    fn ring_buffer_keeps_newest_50_first() {
        let mut store = UsageStore::open(None);
        let base = now_ms();
        for i in 0..60 {
            store.record(record_with("app", "gpt-test", "success", false, base + i));
        }
        assert_eq!(store.recent.len(), RECENT_LIMIT);
        // Newest first: last inserted (i = 59) is at the front.
        assert_eq!(store.recent[0].timestamp_ms, base + 59);
        assert_eq!(store.recent[RECENT_LIMIT - 1].timestamp_ms, base + 10);
    }

    #[test]
    fn message_content_is_truncated_with_flags() {
        let _guard = guard_test_lock();
        let _ = drain_test_records();
        let mut guard = UsageGuard::with_test_recorder(
            &AiCaller::App,
            &test_config(),
            false,
            &test_messages(&"x".repeat(MESSAGE_CONTENT_LIMIT + 100)),
            None,
        );
        guard.record_success(1, 1, 2, false);
        let records = drain_test_records();
        assert_eq!(records.len(), 1);
        let message = &records[0].messages[0];
        assert!(message.truncated);
        assert_eq!(message.original_chars, MESSAGE_CONTENT_LIMIT + 100);
        assert_eq!(message.content.chars().count(), MESSAGE_CONTENT_LIMIT);
    }

    #[test]
    fn guard_drop_records_aborted_exactly_once() {
        let _guard = guard_test_lock();
        let _ = drain_test_records();
        {
            let mut guard = UsageGuard::with_test_recorder(
                &AiCaller::App,
                &test_config(),
                true,
                &test_messages("hi"),
                None,
            );
            guard.observe_chunk(&ChatCompletionChunk {
                choices: vec![ChunkChoice {
                    delta: ChunkDelta {
                        content: Some("hello".to_string()),
                        tool_calls: None,
                    },
                    finish_reason: None,
                }],
            });
            // Dropped without explicit finish -> aborted.
        }
        let records = drain_test_records();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, "aborted");
        assert!(records[0].estimated);
        assert_eq!(records[0].completion_tokens, 1); // "hello" = 5 chars / 4

        // Explicit finish then drop -> still exactly one record.
        let mut guard = UsageGuard::with_test_recorder(
            &AiCaller::App,
            &test_config(),
            false,
            &test_messages("hi"),
            None,
        );
        guard.record_success(3, 4, 7, false);
        drop(guard);
        let records = drain_test_records();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, "success");
        assert!(!records[0].estimated);
        assert_eq!(records[0].prompt_tokens, 3);
    }

    #[test]
    fn guard_error_truncates_error_message() {
        let _guard = guard_test_lock();
        let _ = drain_test_records();
        let mut guard = UsageGuard::with_test_recorder(
            &AiCaller::ConnectionTest,
            &test_config(),
            false,
            &test_messages("hi"),
            None,
        );
        guard.record_error("e".repeat(ERROR_LIMIT + 50));
        let records = drain_test_records();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, "error");
        assert_eq!(
            records[0].error.as_ref().unwrap().chars().count(),
            ERROR_LIMIT
        );
        assert_eq!(records[0].caller, "connection_test");
    }

    #[test]
    fn persistence_round_trip_and_corrupt_recovery() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ai_usage.json");

        {
            let mut store = UsageStore::open(Some(path.clone()));
            store.record(record_with("app", "gpt-test", "success", false, now_ms()));
        }

        let reopened = UsageStore::open(Some(path.clone()));
        assert!(reopened.days.contains_key(&local_date(now_ms())));
        let summary = reopened.summary(7);
        assert_eq!(summary.daily.len(), 1);
        assert_eq!(summary.daily[0].requests, 1);

        fs::write(&path, "{ not json !!!").expect("write corrupt file");
        let recovered = UsageStore::open(Some(path.clone()));
        assert!(recovered.days.is_empty());
    }

    #[test]
    fn clear_empties_store_and_deletes_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ai_usage.json");
        let mut store = UsageStore::open(Some(path.clone()));
        store.record(record_with("app", "gpt-test", "success", false, now_ms()));
        assert!(path.exists());
        store.clear();
        assert!(store.recent.is_empty());
        assert!(store.days.is_empty());
        assert!(!path.exists());
    }

    #[test]
    fn masks_api_key() {
        assert_eq!(mask_api_key(""), "");
        assert_eq!(mask_api_key("short"), "••••");
        assert_eq!(mask_api_key("sk-1234567890abcd"), "sk-…abcd");
        // Exactly 12 chars still uses the long form.
        assert_eq!(mask_api_key("123456789012"), "123…9012");
    }

    #[test]
    fn endpoint_host_extracts_host_only() {
        assert_eq!(endpoint_host("https://api.openai.com/v1"), "api.openai.com");
        assert_eq!(endpoint_host("http://localhost:8080/v1/"), "localhost");
        assert_eq!(endpoint_host("localhost:11434/v1"), "localhost");
    }

    #[test]
    fn caller_labels() {
        assert_eq!(AiCaller::App.label(), "app");
        assert_eq!(AiCaller::Plugin("p1".to_string()).label(), "plugin:p1");
        assert_eq!(AiCaller::ConnectionTest.label(), "connection_test");
    }

    #[test]
    fn summary_respects_day_window() {
        let mut store = UsageStore::open(None);
        store.record(record_with(
            "app",
            "gpt-test",
            "success",
            false,
            days_ago_ms(10),
        ));
        store.record(record_with("app", "gpt-test", "success", false, now_ms()));
        let summary = store.summary(7);
        assert_eq!(summary.daily.len(), 1);
        assert_eq!(summary.daily[0].date, local_date(now_ms()));
    }

    #[test]
    fn stream_end_estimates_tokens_from_output_chars() {
        let _guard = guard_test_lock();
        let _ = drain_test_records();
        let mut guard = UsageGuard::with_test_recorder(
            &AiCaller::App,
            &test_config(),
            true,
            &test_messages("12345678"), // 8 chars -> 2 approx prompt tokens
            Some(&[Tool {
                tool_type: "function".to_string(),
                function: FunctionDefinition {
                    name: "ping".to_string(),
                    description: String::new(),
                    parameters: serde_json::json!({}),
                },
            }]),
        );
        guard.observe_chunk(&ChatCompletionChunk {
            choices: vec![ChunkChoice {
                delta: ChunkDelta {
                    content: Some("abcdefgh".to_string()), // 8 chars -> 2 tokens
                    tool_calls: Some(vec![StreamingToolCall {
                        index: 0,
                        id: Some("call_1".to_string()),
                        function: Some(StreamingFunctionCall {
                            name: Some("ping".to_string()),
                            arguments: Some("{}".to_string()),
                        }),
                    }]),
                },
                finish_reason: None,
            }],
        });
        guard.record_stream_end();
        let records = drain_test_records();
        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record.status, "success");
        assert!(record.stream);
        assert!(record.tools);
        assert_eq!(record.tool_names, vec!["ping".to_string()]);
        assert_eq!(record.prompt_tokens, 2);
        // output chars: 8 content + 6 id + 4 name + 2 args = 20 -> 5 tokens
        assert_eq!(record.completion_tokens, 5);
        assert_eq!(record.total_tokens, 7);
        assert!(record.estimated);
    }

    #[test]
    fn recent_meta_excludes_messages() {
        let mut store = UsageStore::open(None);
        let mut record = record_with("app", "gpt-test", "success", false, now_ms());
        record.messages = vec![AiUsageMessage {
            role: "user".to_string(),
            content: "secret".to_string(),
            original_chars: 6,
            truncated: false,
        }];
        store.record(record);
        let meta = store.recent[0].to_meta();
        assert_eq!(meta.message_count, 1);
        assert_eq!(meta.total_chars, 6);
        // Ensure no messages field leaks into the meta serialization.
        let json = serde_json::to_value(&meta).unwrap();
        assert!(json.get("messages").is_none());
    }
}
