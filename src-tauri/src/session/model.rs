//! Flow Data Models - HAR 1.2 Compatible
//!
//! This module defines the core data structures for HTTP traffic.
//! All structures follow the HAR 1.2 specification with RelayCraft
//! extensions under the `_rc` namespace.

use serde::{Deserialize, Serialize};

// ==================== HAR 1.2 Standard Types ====================

/// HAR standard header
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HarHeader {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// HAR standard cookie
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HarCookie {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secure: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// HAR standard query string parameter
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HarQueryString {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// HAR standard post data
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HarPostData {
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<HarPostParam>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// HAR standard post data parameter
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HarPostParam {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// HAR standard content
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HarContent {
    pub size: i64,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compression: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// HAR standard timings (milliseconds)
/// -1 means not applicable
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HarTimings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connect: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub send: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receive: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

// ==================== RelayCraft Extensions ====================

/// RelayCraft extension - matched hit
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RcMatchedHit {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub hit_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<f64>,
}

/// RelayCraft extension - WebSocket frame
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RcWebSocketFrame {
    pub id: String,
    pub flow_id: String,
    pub seq: i32, // Frame sequence number for ordering
    #[serde(rename = "type")]
    pub frame_type: String,
    pub from_client: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    pub timestamp: f64,
    pub length: i64,
}

/// RelayCraft extension - intercept state
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RcIntercept {
    pub intercepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<f64>,
}

/// RelayCraft extension - error detail
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RcError {
    pub message: String,
    #[serde(rename = "type")]
    pub error_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

/// RelayCraft extension - parsed URL
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RcParsedUrl {
    pub scheme: String,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub path: String,
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fragment: Option<String>,
}

/// RelayCraft extension namespace
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RcExtension {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RcError>,
    pub is_websocket: bool,
    pub websocket_frame_count: i32,
    #[serde(default)]
    pub hits: Vec<RcMatchedHit>,
    pub intercept: RcIntercept,
    pub body_truncated: bool,
}

// ==================== Core Structures ====================

/// Flow request
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FlowRequest {
    pub method: String,
    pub url: String,
    pub http_version: String,

    // HAR arrays (preserve duplicates)
    pub headers: Vec<HarHeader>,
    pub cookies: Vec<HarCookie>,
    pub query_string: Vec<HarQueryString>,

    // Body
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_data: Option<HarPostData>,
    pub body_size: i64,
    pub headers_size: i64,

    // RelayCraft extension
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_url: Option<RcParsedUrl>,
}

/// Flow response
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FlowResponse {
    pub status: i32,
    pub status_text: String,
    pub http_version: String,

    // HAR arrays (preserve duplicates)
    pub headers: Vec<HarHeader>,
    pub cookies: Vec<HarCookie>,

    // Body
    pub content: HarContent,
    pub headers_size: i64,
    pub body_size: i64,
    pub redirect_url: String,
}

/// Complete Flow structure
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    // Identity
    pub id: String,

    // HAR standard fields
    pub started_date_time: String,
    pub time: f64,

    pub request: FlowRequest,
    pub response: FlowResponse,

    pub timings: HarTimings,
    pub cache: serde_json::Value,

    // RelayCraft extension
    #[serde(rename = "_rc")]
    pub rc: RcExtension,
}

// ==================== Session Types ====================

/// Session metadata
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub created_at: i64,
    pub duration: f64,
    pub flow_count: usize,
    pub size_bytes: usize,
    pub client_info: Option<String>,
    pub network_condition: Option<String>,
    pub view_state: Option<String>,
}

/// Session container
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub metadata: SessionMetadata,
    pub flows: Vec<Flow>,
}

// ==================== Helper Functions ====================

/// Convert timestamp (milliseconds) to ISO 8601 string
pub fn format_timestamp(ts: f64) -> String {
    use chrono::{TimeZone, Utc};

    if ts == 0.0 {
        return "".to_string();
    }

    Utc.timestamp_millis_opt(ts as i64)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flow_structure() {
        let flow = Flow {
            id: "test-id".to_string(),
            started_date_time: "2024-01-01T00:00:00Z".to_string(),
            time: 100.0,
            request: FlowRequest {
                method: "GET".to_string(),
                url: "https://example.com/test".to_string(),
                http_version: "HTTP/1.1".to_string(),
                headers: vec![HarHeader {
                    name: "Host".to_string(),
                    value: "example.com".to_string(),
                    comment: None,
                }],
                cookies: vec![],
                query_string: vec![],
                post_data: None,
                body_size: 0,
                headers_size: -1,
                parsed_url: None,
            },
            response: FlowResponse {
                status: 200,
                status_text: "OK".to_string(),
                http_version: "HTTP/1.1".to_string(),
                headers: vec![HarHeader {
                    name: "Content-Type".to_string(),
                    value: "application/json".to_string(),
                    comment: None,
                }],
                cookies: vec![],
                content: HarContent {
                    size: 1000,
                    mime_type: "application/json".to_string(),
                    text: None,
                    encoding: None,
                    compression: None,
                    comment: None,
                },
                headers_size: -1,
                body_size: 0,
                redirect_url: "".to_string(),
            },
            timings: HarTimings::default(),
            cache: serde_json::Value::Null,
            rc: RcExtension::default(),
        };

        assert_eq!(flow.id, "test-id");
        assert_eq!(flow.request.method, "GET");
        assert_eq!(flow.request.headers.len(), 1);
        assert_eq!(flow.request.headers[0].name, "Host");
        assert_eq!(flow.response.status, 200);
    }
}
