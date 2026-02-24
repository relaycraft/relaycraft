use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapLocalAction {
    pub source: Option<String>, // file, manual
    pub local_path: Option<String>,
    pub content: Option<String>,
    pub content_type: Option<String>,
    pub status_code: Option<u32>,
    pub headers: Option<HeaderConfig>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapRemoteAction {
    pub target_url: String,
    pub preserve_path: Option<bool>,
    pub headers: Option<HeaderConfig>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RewriteHeaderAction {
    pub headers: HeaderConfig,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeaderConfig {
    #[serde(default)]
    pub request: Vec<HeaderOperation>,
    #[serde(default)]
    pub response: Vec<HeaderOperation>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeaderOperation {
    pub operation: String, // add, set, remove
    pub key: String,
    pub value: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RewriteBodyAction {
    pub target: String, // request, response
    pub status_code: Option<u16>,
    pub content_type: Option<String>,
    pub set: Option<BodySetMode>,
    pub replace: Option<BodyReplaceMode>,
    pub regex_replace: Option<BodyReplaceMode>,
    pub json: Option<BodyJsonMode>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BodySetMode {
    pub content: String,
    pub status_code: Option<u16>,
    pub content_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BodyReplaceMode {
    pub pattern: String,
    pub replacement: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BodyJsonMode {
    pub modifications: Vec<JsonModification>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JsonModification {
    pub path: String,
    pub value: serde_json::Value,
    pub operation: String, // set, delete, append
    pub enabled: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThrottleAction {
    pub subtype: Option<String>,
    pub delay_ms: Option<u32>,
    pub packet_loss: Option<f32>,
    pub bandwidth_kbps: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuleAction {
    MapLocal(MapLocalAction),
    MapRemote(MapRemoteAction),
    RewriteHeader(RewriteHeaderAction),
    RewriteBody(RewriteBodyAction),
    Throttle(ThrottleAction),
    BlockRequest,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MatchAtom {
    #[serde(rename = "type")]
    pub atom_type: String,
    pub match_type: String,
    pub key: Option<String>,
    pub value: Option<serde_json::Value>,
    pub invert: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleExecution {
    pub enabled: bool,
    pub priority: i32,
    pub stop_on_match: Option<bool>,
    // times: Option<i32>, // Reserved for future
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleMatchConfig {
    #[serde(default)]
    pub request: Vec<MatchAtom>,
    #[serde(default)]
    pub response: Vec<MatchAtom>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RuleType {
    MapLocal,
    MapRemote,
    RewriteHeader,
    RewriteBody,
    Throttle,
    BlockRequest,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub r#type: RuleType, // Strict enum for validation
    pub execution: RuleExecution,
    #[serde(rename = "match")]
    pub match_config: RuleMatchConfig,
    pub actions: Vec<RuleAction>,
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleGroup {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub priority: i32,
    pub description: Option<String>,
}

// Rules storage logic is now handled in rules_yaml.rs
