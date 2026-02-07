use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub metadata: SessionMetadata,
    pub flows: Vec<Flow>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub created_at: i64,
    pub duration: f64,
    pub flow_count: usize,
    pub size_bytes: usize,
    pub client_info: Option<String>,
    pub network_condition: Option<String>,
    pub view_state: Option<String>, // JSON string for view settings
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub dns: Option<f64>,
    pub connect: Option<f64>,
    pub ssl: Option<f64>,
    pub ttfb: Option<f64>,
    pub total: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetail {
    pub message: String,
    pub error_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")] // Match TypeScript camelCase properties
pub struct Flow {
    pub id: String,
    pub order: Option<i32>,
    pub method: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub status_code: i32,
    pub timestamp: f64,
    pub request_headers: HashMap<String, String>,
    pub response_headers: HashMap<String, String>,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
    pub content_type: Option<String>,
    pub size: usize,
    pub duration: Option<f64>,
    pub request_body_encoding: Option<String>,
    pub response_body_encoding: Option<String>,
    pub matched_rules: Option<Vec<MatchedRule>>,
    pub intercepted: Option<bool>,
    pub intercept_phase: Option<String>,

    // V2 Fields
    pub http_version: Option<String>,
    pub client_ip: Option<String>,
    pub server_ip: Option<String>,
    pub error: Option<ErrorDetail>,
    pub timing: Option<Timing>,
    #[serde(default)]
    pub is_websocket: bool,
    pub websocket_frames: Option<Vec<WebSocketFrame>>,
    #[serde(default)]
    pub body_truncated: bool,
    pub matched_scripts: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketFrame {
    pub r#type: String, // text, binary, ping, pong, close
    pub from_client: bool,
    pub content: String,
    pub timestamp: f64,
    pub length: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchedRule {
    pub id: Option<String>,
    pub name: String,
    pub r#type: String, // 'type' is a reserved keyword in Rust
    pub status: Option<String>,
    pub message: Option<String>,
}
