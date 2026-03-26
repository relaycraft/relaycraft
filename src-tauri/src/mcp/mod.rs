//! MCP Server — Model Context Protocol over HTTP
//!
//! Exposes RelayCraft traffic data to AI tools (Claude Desktop, Cursor, etc.)
//! via the MCP standard. Implements Streamable HTTP transport (POST /mcp).
//!
//! Read-only Tools (Phase 1):
//!   - list_sessions  — list all recorded sessions
//!   - list_flows     — query flows in a session with filtering
//!   - get_flow       — full request/response detail for a single flow
//!   - search_flows   — keyword search across flow URLs
//!
//! Read Tools (Phase 2, no auth required):
//!   - get_session_stats — aggregate stats for current session
//!   - list_rules        — list all proxy rules
//!
//! Write Tools (Phase 2, require Bearer token auth):
//!   - create_rule       — create a proxy rule (all 6 types)
//!   - delete_rule       — delete a rule by ID
//!   - toggle_rule       — enable or disable a rule
//!   - replay_request    — replay a captured request through the proxy

use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::Emitter;
use tower_http::cors::{Any, CorsLayer};

// ─── Token management ────────────────────────────────────────────────────────

/// Loads the existing MCP token from disk, or generates and persists a new one.
/// The token file is stored at `{config_dir}/mcp-token` with 0600 permissions on Unix.
pub fn generate_or_load_token() -> String {
    let token_path = match crate::config::get_config_dir() {
        Ok(dir) => dir.join("mcp-token"),
        Err(_) => {
            log::warn!("MCP: cannot resolve config dir, token will not persist");
            return format!("rc_{}", uuid::Uuid::new_v4().simple());
        }
    };

    // Reuse existing token
    if let Ok(existing) = std::fs::read_to_string(&token_path) {
        let t = existing.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }

    // Generate a new token
    let token = format!("rc_{}", uuid::Uuid::new_v4().simple());
    if let Err(e) = std::fs::write(&token_path, &token) {
        log::warn!("MCP: failed to persist token: {}", e);
    } else {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&token_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = std::fs::set_permissions(&token_path, perms);
            }
        }
        log::info!("MCP: generated new token and stored at {:?}", token_path);
    }

    token
}

// ─── Tauri-managed state ────────────────────────────────────────────────────

pub struct McpState {
    pub running: Arc<AtomicBool>,
    /// Current listening port — std Mutex so it can be read from sync commands
    pub port: Arc<Mutex<u16>>,
    /// Bearer token required for tools/call (write operations)
    pub token: Arc<Mutex<String>>,
    /// Shutdown channel — tokio Mutex since it's only accessed from async tasks
    pub shutdown_tx: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    /// App handle stored after first start; enables write tools to emit frontend events
    pub app: Arc<Mutex<Option<tauri::AppHandle>>>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Arc::new(Mutex::new(7090)),
            token: Arc::new(Mutex::new(generate_or_load_token())),
            shutdown_tx: Arc::new(tokio::sync::Mutex::new(None)),
            app: Arc::new(Mutex::new(None)),
        }
    }
}

// ─── Axum app state ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct ServerState {
    /// HTTP client for calling the Python engine API
    client: reqwest::Client,
    /// Expected Bearer token for tools/call authentication
    token: String,
    /// App handle — used to emit events to the frontend after write operations
    app: tauri::AppHandle,
}

// ─── JSON-RPC 2.0 types ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RpcRequest {
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct RpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

impl RpcResponse {
    fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }

    fn err(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError { code, message: message.into() }),
        }
    }
}

// ─── Tool result helpers ─────────────────────────────────────────────────────

fn text_result(text: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": text.into() }] })
}

fn error_result(text: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": text.into() }], "isError": true })
}

// ─── MCP protocol handler ────────────────────────────────────────────────────

async fn handle_mcp(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(req): Json<RpcRequest>,
) -> Json<RpcResponse> {
    let id = req.id.clone();

    // Extract auth header once; passed down to tools/call for per-tool checks.
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    match dispatch(&state, &req.method, &req.params, &auth_header).await {
        Ok(result) => Json(RpcResponse::ok(id, result)),
        Err(msg) => Json(RpcResponse::err(id, -32000, msg)),
    }
}

/// Write tools that require a valid Bearer token.
const WRITE_TOOLS: &[&str] = &["create_rule", "delete_rule", "toggle_rule", "replay_request"];

async fn dispatch(state: &ServerState, method: &str, params: &Value, auth: &str) -> Result<Value, String> {
    match method {
        "initialize" => Ok(handle_initialize()),
        "notifications/initialized" | "ping" => Ok(json!({})),
        "tools/list" => Ok(handle_tools_list()),
        "tools/call" => handle_tools_call(state, params, auth).await,
        _ => Err(format!("Method not found: {method}")),
    }
}

// ─── initialize ─────────────────────────────────────────────────────────────

fn handle_initialize() -> Value {
    json!({
        "protocolVersion": "2024-11-05",
        "capabilities": { "tools": {} },
        "serverInfo": {
            "name": "relaycraft",
            "version": env!("CARGO_PKG_VERSION")
        },
        "instructions": "RelayCraft MCP Server lets you read and manipulate HTTP/HTTPS traffic captured by the RelayCraft proxy.\n\nRead tools (no auth required): list_sessions, list_flows, get_flow, search_flows, get_session_stats.\n\nWrite tools (require Bearer token in Authorization header): create_rule, replay_request.\n\nTypical workflow:\n1. Call get_session_stats() to understand the current traffic at a glance.\n2. Call list_flows() with filters (status, domain, method) to find relevant requests.\n3. Call get_flow(id) to inspect the full request/response.\n4. Call create_rule() to immediately add a proxy rule (mock, rewrite, redirect, block).\n5. Call replay_request(flow_id) to resend a request through the proxy and verify the fix.\n\nAll write operations take effect immediately and are visible in the RelayCraft UI."
    })
}

// ─── tools/list ──────────────────────────────────────────────────────────────

fn handle_tools_list() -> Value {
    json!({
        "tools": [
            {
                "name": "list_sessions",
                "description": "List all recorded debugging sessions. Returns session IDs, names, timestamps, and flow counts. Use this first to discover available data before querying flows.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "list_flows",
                "description": "Query HTTP flows (requests/responses) within a session. Returns lightweight metadata for each flow. Supports filtering by HTTP method, status code, domain, and more. Use get_flow to retrieve the full request/response body for a specific flow.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "session_id": {
                            "type": "string",
                            "description": "Session ID to query. Omit to use the current active session."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of flows to return. Default 50, max 200.",
                            "default": 50,
                            "maximum": 200
                        },
                        "method": {
                            "type": "string",
                            "description": "Filter by HTTP method, e.g. GET, POST, PUT."
                        },
                        "status": {
                            "type": "string",
                            "description": "Filter by status code or range: exact number like 404, or range like 4xx, 5xx."
                        },
                        "domain": {
                            "type": "string",
                            "description": "Filter by domain (substring match), e.g. 'api.example.com'."
                        },
                        "has_error": {
                            "type": "boolean",
                            "description": "If true, only return flows that have errors."
                        },
                        "content_type": {
                            "type": "string",
                            "description": "Filter by response content type substring, e.g. 'json', 'html'."
                        }
                    }
                }
            },
            {
                "name": "get_flow",
                "description": "Get the complete detail of a single HTTP flow including full request and response headers and body. Response bodies larger than 100KB are truncated.",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Flow ID obtained from list_flows or search_flows."
                        }
                    }
                }
            },
            {
                "name": "search_flows",
                "description": "Search HTTP flows by keyword. By default searches the URL. Use search_in to search request/response bodies or headers instead.",
                "inputSchema": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Keyword to search for."
                        },
                        "search_in": {
                            "type": "string",
                            "enum": ["url", "response_body", "request_body", "header"],
                            "description": "Where to search. 'url' (default): match URL/host/path. 'response_body': scan response bodies. 'request_body': scan request bodies. 'header': scan request and response header names/values.",
                            "default": "url"
                        },
                        "case_sensitive": {
                            "type": "boolean",
                            "description": "Case-sensitive match. Default false.",
                            "default": false
                        },
                        "session_id": {
                            "type": "string",
                            "description": "Session ID to search within. Omit to search the current active session."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum results to return. Default 20, max 50.",
                            "default": 20,
                            "maximum": 50
                        }
                    }
                }
            },
            {
                "name": "replay_request",
                "description": "Replay a previously captured HTTP request through the RelayCraft proxy port. The replayed request will appear in the traffic list so you can inspect the response with get_flow. You can optionally override the URL, method, headers, or body before sending.",
                "inputSchema": {
                    "type": "object",
                    "required": ["flow_id"],
                    "properties": {
                        "flow_id": {
                            "type": "string",
                            "description": "ID of the flow to replay, obtained from list_flows or search_flows."
                        },
                        "modifications": {
                            "type": "object",
                            "description": "Optional overrides to apply before sending.",
                            "properties": {
                                "url": {
                                    "type": "string",
                                    "description": "Override the full request URL, including scheme, host, path, and query string. e.g. https://api.example.com/v2/users?id=2"
                                },
                                "method": {
                                    "type": "string",
                                    "description": "Override the HTTP method."
                                },
                                "headers": {
                                    "type": "object",
                                    "description": "Key-value pairs to set/override in the request headers."
                                },
                                "body": {
                                    "type": "string",
                                    "description": "Replacement request body."
                                }
                            }
                        }
                    }
                }
            },
            {
                "name": "create_rule",
                "description": "Create a proxy rule that immediately takes effect. Use simple parameters — no need to know the internal rule format.\n\nExamples:\n\nMock an endpoint:\n{\"type\":\"map_local\",\"name\":\"Mock user API\",\"url_pattern\":\"api.example.com/user\",\"mock_body\":\"{\\\"id\\\":1,\\\"name\\\":\\\"Test\\\"}\",\"mock_status\":200,\"intent\":\"Frontend test before backend is ready\"}\n\nRedirect to local server:\n{\"type\":\"map_remote\",\"name\":\"Redirect to dev\",\"url_pattern\":\"api.example.com\",\"target_url\":\"http://localhost:3000\",\"intent\":\"Test against local dev server\"}\n\nReplace entire response body (set mode):\n{\"type\":\"rewrite_body\",\"name\":\"Override response\",\"url_pattern\":\"api.example.com/orders\",\"rewrite_mode\":\"set\",\"rewrite_content\":\"{\\\"status\\\":\\\"ok\\\"}\",\"rewrite_target\":\"response\",\"intent\":\"Override error response to reproduce a bug\"}\n\nFind and replace text in response body (replace mode):\n{\"type\":\"rewrite_body\",\"name\":\"Replace env flag\",\"url_pattern\":\"api.example.com/config\",\"rewrite_mode\":\"replace\",\"rewrite_pattern\":\"\\\"env\\\":\\\"production\\\"\",\"rewrite_replacement\":\"\\\"env\\\":\\\"staging\\\"\",\"intent\":\"Switch environment flag in response\"}\n\nRegex replace in response body:\n{\"type\":\"rewrite_body\",\"name\":\"Redact phone numbers\",\"url_pattern\":\"api.example.com/users\",\"rewrite_mode\":\"regex_replace\",\"rewrite_pattern\":\"\\\\d{3}-\\\\d{4}-\\\\d{4}\",\"rewrite_replacement\":\"***-****-****\",\"intent\":\"Redact phone numbers\"}\n\nChange response status code only:\n{\"type\":\"rewrite_body\",\"name\":\"Force 200\",\"url_pattern\":\"api.example.com/health\",\"rewrite_mode\":\"status_code\",\"rewrite_status\":200,\"intent\":\"Make health check always pass\"}\n\nAdd a header:\n{\"type\":\"rewrite_header\",\"name\":\"Add debug header\",\"url_pattern\":\"api.example.com\",\"header_phase\":\"request\",\"header_operation\":\"set\",\"header_name\":\"X-Debug\",\"header_value\":\"true\",\"intent\":\"Enable verbose server logging\"}\n\nBlock a request:\n{\"type\":\"block_request\",\"name\":\"Block analytics\",\"url_pattern\":\"analytics.example.com\",\"intent\":\"Remove analytics noise during debugging\"}",
                "inputSchema": {
                    "type": "object",
                    "required": ["type", "name", "url_pattern"],
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["map_local", "map_remote", "rewrite_header", "rewrite_body", "throttle", "block_request"],
                            "description": "Rule type."
                        },
                        "name": { "type": "string", "description": "Short descriptive name shown in the Rules panel." },
                        "url_pattern": { "type": "string", "description": "Substring to match in the URL, e.g. 'api.example.com/users' or just 'example.com'." },
                        "method": { "type": "string", "description": "Optional HTTP method filter, e.g. GET, POST." },
                        "mock_body": { "type": "string", "description": "[map_local] Response body to return." },
                        "mock_content_type": { "type": "string", "description": "[map_local] Content-Type header. Default: application/json." },
                        "mock_status": { "type": "integer", "description": "[map_local] HTTP status code. Default: 200." },
                        "target_url": { "type": "string", "description": "[map_remote] URL to redirect matching requests to, e.g. http://localhost:3000." },
                        "rewrite_mode": { "type": "string", "description": "[rewrite_body] Mode: 'set' (replace entire body, default), 'replace' (text find/replace), 'regex_replace' (regex find/replace), 'status_code' (change status only)." },
                        "rewrite_content": { "type": "string", "description": "[rewrite_body set] New body content to set." },
                        "rewrite_pattern": { "type": "string", "description": "[rewrite_body replace/regex_replace] Text or regex pattern to find." },
                        "rewrite_replacement": { "type": "string", "description": "[rewrite_body replace/regex_replace] Replacement string." },
                        "rewrite_status": { "type": "integer", "description": "[rewrite_body status_code] New HTTP status code." },
                        "rewrite_content_type": { "type": "string", "description": "[rewrite_body] Override Content-Type header in the rewritten response." },
                        "rewrite_target": { "type": "string", "description": "[rewrite_body] 'request' or 'response'. Default: response." },
                        "header_phase": { "type": "string", "description": "[rewrite_header] 'request' or 'response'. Default: response." },
                        "header_operation": { "type": "string", "description": "[rewrite_header] 'add', 'set', or 'remove'. Default: set." },
                        "header_name": { "type": "string", "description": "[rewrite_header] Header name to add/set/remove." },
                        "header_value": { "type": "string", "description": "[rewrite_header] Header value (omit for remove operation)." },
                        "bandwidth_kbps": { "type": "integer", "description": "[throttle] Bandwidth limit in KB/s." },
                        "delay_ms": { "type": "integer", "description": "[throttle] Added latency in milliseconds." },
                        "intent": { "type": "string", "description": "Brief explanation shown next to the rule in the UI." }
                    }
                }
            },
            {
                "name": "get_session_stats",
                "description": "Get aggregate statistics for a session: total flows, error rate, top domains, status code distribution, and slowest requests. Use this to build a quick global picture before diving into individual flows.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "session_id": {
                            "type": "string",
                            "description": "Session ID to summarise. Omit to use the current active session."
                        }
                    }
                }
            },
            {
                "name": "list_rules",
                "description": "List all proxy rules with their ID, name, type, URL pattern, and enabled status. Call this before delete_rule or toggle_rule to find the rule ID you want to act on.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "delete_rule",
                "description": "Delete a proxy rule by ID. Use list_rules first to find the rule ID. Returns the deleted rule's name and source so you can confirm the right rule was removed.",
                "inputSchema": {
                    "type": "object",
                    "required": ["rule_id"],
                    "properties": {
                        "rule_id": { "type": "string", "description": "ID of the rule to delete." }
                    }
                }
            },
            {
                "name": "toggle_rule",
                "description": "Enable or disable a proxy rule without deleting it. Useful for temporarily bypassing a rule to compare behaviour with and without it.",
                "inputSchema": {
                    "type": "object",
                    "required": ["rule_id", "enabled"],
                    "properties": {
                        "rule_id": { "type": "string", "description": "ID of the rule to toggle." },
                        "enabled": { "type": "boolean", "description": "true to enable, false to disable." }
                    }
                }
            }
        ]
    })
}

// ─── tools/call ─────────────────────────────────────────────────────────────

async fn handle_tools_call(state: &ServerState, params: &Value, auth: &str) -> Result<Value, String> {
    let name = params["name"].as_str().ok_or("Missing tool name")?;
    let args = &params["arguments"];

    // Write tools require a valid Bearer token; read tools are open.
    if WRITE_TOOLS.contains(&name) {
        let expected = format!("Bearer {}", state.token);
        if auth != expected {
            return Ok(error_result(
                "Unauthorized: this tool requires a Bearer token. \
                 Copy it from RelayCraft Settings → Integrations → MCP Server."
                    .to_string(),
            ));
        }
    }

    let engine_port = get_engine_port();

    match name {
        "list_sessions" => tool_list_sessions(state, engine_port).await,
        "list_flows" => tool_list_flows(state, engine_port, args).await,
        "get_flow" => tool_get_flow(state, engine_port, args).await,
        "search_flows" => tool_search_flows(state, engine_port, args).await,
        "get_session_stats" => tool_get_session_stats(state, engine_port, args).await,
        "create_rule" => tool_create_rule(state, args).await,
        "replay_request" => tool_replay_request(state, engine_port, args).await,
        "list_rules" => tool_list_rules(state).await,
        "delete_rule" => tool_delete_rule(state, args).await,
        "toggle_rule" => tool_toggle_rule(state, args).await,
        _ => Ok(error_result(format!("Unknown tool: {name}"))),
    }
}

/// Read the current proxy port from config (engine listens on this port).
fn get_engine_port() -> u16 {
    crate::config::load_config()
        .map(|c| c.proxy_port)
        .unwrap_or(9090)
}

// ─── Tool: list_sessions ─────────────────────────────────────────────────────

async fn tool_list_sessions(state: &ServerState, engine_port: u16) -> Result<Value, String> {
    let url = format!("http://127.0.0.1:{engine_port}/_relay/sessions");
    let resp = state.client.get(&url).send().await.map_err(|e| {
        format!("Cannot reach RelayCraft engine at port {engine_port}. Is the proxy running? Error: {e}")
    })?;

    if !resp.status().is_success() {
        return Ok(error_result(format!(
            "Engine returned status {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        )));
    }

    let sessions: Value = resp.json().await.map_err(|e| format!("Failed to parse sessions: {e}"))?;

    // Normalize: engine may return a list or an object with a sessions key
    let list = if sessions.is_array() {
        sessions.clone()
    } else {
        sessions.get("sessions").cloned().unwrap_or(json!([]))
    };

    let count = list.as_array().map(|a| a.len()).unwrap_or(0);
    let text = format!(
        "Found {count} session(s):\n\n{}",
        serde_json::to_string_pretty(&list).unwrap_or_default()
    );

    Ok(text_result(text))
}

// ─── Tool: list_flows ────────────────────────────────────────────────────────

async fn tool_list_flows(state: &ServerState, engine_port: u16, args: &Value) -> Result<Value, String> {
    let session_id = args["session_id"].as_str();
    let limit = args["limit"].as_u64().unwrap_or(50).min(200) as usize;
    let method_filter = args["method"].as_str().map(|s| s.to_uppercase());
    let status_filter = args["status"].as_str().map(|s| s.to_lowercase());
    let domain_filter = args["domain"].as_str().map(|s| s.to_lowercase());
    let has_error_filter = args["has_error"].as_bool();
    let content_type_filter = args["content_type"].as_str().map(|s| s.to_lowercase());

    let mut url = format!("http://127.0.0.1:{engine_port}/_relay/poll?since=0");
    if let Some(sid) = session_id {
        url.push_str(&format!("&session_id={sid}"));
    }

    let resp = state.client.get(&url).send().await.map_err(|e| {
        format!("Cannot reach RelayCraft engine at port {engine_port}. Is the proxy running? Error: {e}")
    })?;

    if !resp.status().is_success() {
        return Ok(error_result(format!(
            "Engine returned status {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        )));
    }

    let body: Value = resp.json().await.map_err(|e| format!("Failed to parse flows: {e}"))?;
    let indices = body["indices"].as_array().cloned().unwrap_or_default();

    // Apply filters
    let filtered: Vec<&Value> = indices
        .iter()
        .filter(|flow| {
            // method filter
            if let Some(ref m) = method_filter {
                if flow["method"].as_str().unwrap_or("").to_uppercase() != *m {
                    return false;
                }
            }
            // status filter (supports "4xx", "5xx", or exact number)
            if let Some(ref s) = status_filter {
                let code = flow["status"].as_u64().unwrap_or(0);
                if s.ends_with("xx") {
                    let prefix = s.chars().next().unwrap_or('0').to_digit(10).unwrap_or(0) as u64;
                    if code / 100 != prefix {
                        return false;
                    }
                } else if let Ok(exact) = s.parse::<u64>() {
                    if code != exact {
                        return false;
                    }
                }
            }
            // domain filter
            if let Some(ref d) = domain_filter {
                if !flow["host"].as_str().unwrap_or("").to_lowercase().contains(d.as_str()) {
                    return false;
                }
            }
            // has_error filter
            if let Some(only_errors) = has_error_filter {
                let flow_has_error = flow["hasError"].as_bool().unwrap_or(false);
                if only_errors && !flow_has_error {
                    return false;
                }
            }
            // content_type filter
            if let Some(ref ct) = content_type_filter {
                if !flow["contentType"].as_str().unwrap_or("").to_lowercase().contains(ct.as_str()) {
                    return false;
                }
            }
            true
        })
        .take(limit)
        .collect();

    let total_before_limit = indices
        .iter()
        .filter(|flow| {
            if let Some(ref m) = method_filter {
                if flow["method"].as_str().unwrap_or("").to_uppercase() != *m {
                    return false;
                }
            }
            true // simplified re-count not needed for UX
        })
        .count();
    let _ = total_before_limit; // used only for display

    // Build a clean output list
    let output: Vec<Value> = filtered
        .iter()
        .map(|flow| {
            json!({
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
                "isWebsocket": flow["isWebsocket"]
            })
        })
        .collect();

    let text = format!(
        "Returned {} flow(s) (total in session: {}):\n\n{}",
        output.len(),
        indices.len(),
        serde_json::to_string_pretty(&output).unwrap_or_default()
    );

    Ok(text_result(text))
}

// ─── Tool: get_flow ──────────────────────────────────────────────────────────

const MAX_BODY_BYTES: usize = 100 * 1024; // 100 KB

async fn tool_get_flow(state: &ServerState, engine_port: u16, args: &Value) -> Result<Value, String> {
    let id = args["id"].as_str().ok_or("Missing required argument: id")?;

    let url = format!("http://127.0.0.1:{engine_port}/_relay/detail?id={id}");
    let resp = state.client.get(&url).send().await.map_err(|e| {
        format!("Cannot reach RelayCraft engine at port {engine_port}. Error: {e}")
    })?;

    if resp.status().as_u16() == 404 {
        return Ok(error_result(format!("Flow '{id}' not found. It may have been evicted from the engine buffer.")));
    }

    if !resp.status().is_success() {
        return Ok(error_result(format!(
            "Engine returned status {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        )));
    }

    let mut flow: Value = resp.json().await.map_err(|e| format!("Failed to parse flow: {e}"))?;

    // Truncate oversized response body to stay AI-context-friendly
    let mut body_truncated = false;
    if let Some(body_text) = flow["response"]["content"]["text"].as_str() {
        if body_text.len() > MAX_BODY_BYTES {
            let truncated = &body_text[..MAX_BODY_BYTES];
            flow["response"]["content"]["text"] = json!(truncated);
            body_truncated = true;
        }
    }
    // Same for request body
    if let Some(body_text) = flow["request"]["postData"]["text"].as_str() {
        if body_text.len() > MAX_BODY_BYTES {
            let truncated = &body_text[..MAX_BODY_BYTES];
            flow["request"]["postData"]["text"] = json!(truncated);
        }
    }

    // Build a clean, AI-readable output
    let req = &flow["request"];
    let res = &flow["response"];
    let timings = &flow["timings"];
    let rc = &flow["_rc"];

    let mut output = json!({
        "id": id,
        "startedAt": flow["startedDateTime"],
        "durationMs": flow["time"],
        "request": {
            "method": req["method"],
            "url": req["url"],
            "httpVersion": req["httpVersion"],
            "headers": req["headers"],
            "queryString": req["queryString"],
            "bodySize": req["bodySize"]
        },
        "response": {
            "status": res["status"],
            "statusText": res["statusText"],
            "headers": res["headers"],
            "bodySize": res["bodySize"],
            "contentType": res["content"]["mimeType"]
        },
        "timings": timings
    });

    // Include bodies only when present
    if let Some(text) = req["postData"]["text"].as_str() {
        if !text.is_empty() {
            output["request"]["body"] = json!(text);
            output["request"]["bodyMimeType"] = req["postData"]["mimeType"].clone();
        }
    }
    if let Some(text) = res["content"]["text"].as_str() {
        if !text.is_empty() {
            output["response"]["body"] = json!(text);
            if res["content"]["encoding"].as_str() == Some("base64") {
                output["response"]["bodyEncoding"] = json!("base64");
            }
        }
    }
    if body_truncated {
        output["response"]["bodyTruncated"] = json!(true);
        output["response"]["bodyTruncatedAt"] = json!("100KB");
    }

    // Include error info if present
    if let Some(err) = rc["error"].as_object() {
        if !err.is_empty() {
            output["error"] = rc["error"].clone();
        }
    }

    Ok(text_result(serde_json::to_string_pretty(&output).unwrap_or_default()))
}

// ─── Tool: search_flows ──────────────────────────────────────────────────────

async fn tool_search_flows(state: &ServerState, engine_port: u16, args: &Value) -> Result<Value, String> {
    let query = args["query"].as_str().ok_or("Missing required argument: query")?;
    let session_id = args["session_id"].as_str();
    let limit = args["limit"].as_u64().unwrap_or(20).min(50) as usize;
    let search_in = args["search_in"].as_str().unwrap_or("url");
    let case_sensitive = args["case_sensitive"].as_bool().unwrap_or(false);

    // Deep search: body or header — delegate to /_relay/search
    if search_in != "url" {
        let search_type = match search_in {
            "response_body" => "response",
            "request_body"  => "request",
            "header"        => "header",
            other           => return Ok(error_result(format!("Unknown search_in value: '{other}'"))),
        };

        let search_url = format!("http://127.0.0.1:{engine_port}/_relay/search");
        let payload = json!({
            "keyword": query,
            "type": search_type,
            "session_id": session_id,
            "case_sensitive": case_sensitive,
        });
        let resp = state.client.post(&search_url).json(&payload).send().await
            .map_err(|e| format!("Cannot reach RelayCraft engine: {e}"))?;
        if !resp.status().is_success() {
            return Ok(error_result(format!("Engine returned status {}", resp.status())));
        }
        let result: Value = resp.json().await.map_err(|e| format!("Failed to parse search result: {e}"))?;
        let matched_ids: Vec<&str> = result["matches"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        let scanned = result["scanned"].as_u64().unwrap_or(0);

        if matched_ids.is_empty() {
            return Ok(text_result(format!(
                "No flows found matching '{query}' in {search_in} (scanned {scanned} flow(s))."
            )));
        }

        // Fetch index to enrich matched IDs with metadata
        let mut poll_url = format!("http://127.0.0.1:{engine_port}/_relay/poll?since=0");
        if let Some(sid) = session_id {
            poll_url.push_str(&format!("&session_id={sid}"));
        }
        let poll_resp = state.client.get(&poll_url).send().await
            .map_err(|e| format!("Cannot reach engine: {e}"))?;
        let poll_body: Value = poll_resp.json().await.map_err(|e| format!("Failed to parse flows: {e}"))?;
        let indices = poll_body["indices"].as_array().cloned().unwrap_or_default();

        let total_matched = matched_ids.len();
        let matches: Vec<Value> = indices.iter()
            .filter(|f| matched_ids.contains(&f["id"].as_str().unwrap_or("")))
            .take(limit)
            .map(|flow| json!({
                "id": flow["id"],
                "method": flow["method"],
                "url": flow["url"],
                "status": flow["status"],
                "contentType": flow["contentType"],
                "startedAt": flow["startedDateTime"],
                "durationMs": flow["time"],
                "hasError": flow["hasError"]
            }))
            .collect();

        let showing = matches.len();
        let summary = if total_matched > showing {
            format!("Found {total_matched} total, showing {showing} (scanned {scanned} flow(s)).")
        } else {
            format!("Found {total_matched} match(es) (scanned {scanned} flow(s)).")
        };
        return Ok(text_result(format!(
            "{summary} Query: '{query}' in {search_in}\n\n{}",
            serde_json::to_string_pretty(&matches).unwrap_or_default()
        )));
    }

    // URL search (default)
    let query_lower = if case_sensitive { query.to_string() } else { query.to_lowercase() };
    let mut poll_url = format!("http://127.0.0.1:{engine_port}/_relay/poll?since=0");
    if let Some(sid) = session_id {
        poll_url.push_str(&format!("&session_id={sid}"));
    }

    let resp = state.client.get(&poll_url).send().await.map_err(|e| {
        format!("Cannot reach RelayCraft engine at port {engine_port}. Is the proxy running? Error: {e}")
    })?;

    if !resp.status().is_success() {
        return Ok(error_result(format!(
            "Engine returned status {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        )));
    }

    let body: Value = resp.json().await.map_err(|e| format!("Failed to parse flows: {e}"))?;
    let indices = body["indices"].as_array().cloned().unwrap_or_default();

    let matches: Vec<Value> = indices
        .iter()
        .filter(|flow| {
            let normalize = |s: &str| if case_sensitive { s.to_string() } else { s.to_lowercase() };
            let url_str = normalize(flow["url"].as_str().unwrap_or(""));
            let host = normalize(flow["host"].as_str().unwrap_or(""));
            let path = normalize(flow["path"].as_str().unwrap_or(""));
            url_str.contains(&query_lower)
                || host.contains(&query_lower)
                || path.contains(&query_lower)
        })
        .take(limit)
        .map(|flow| {
            json!({
                "id": flow["id"],
                "method": flow["method"],
                "url": flow["url"],
                "status": flow["status"],
                "contentType": flow["contentType"],
                "startedAt": flow["startedDateTime"],
                "durationMs": flow["time"],
                "hasError": flow["hasError"]
            })
        })
        .collect();

    let text = if matches.is_empty() {
        format!("No flows found matching '{query}' in {} total flow(s).", indices.len())
    } else {
        format!(
            "Found {} match(es) for '{}' in {} total flow(s):\n\n{}",
            matches.len(),
            query,
            indices.len(),
            serde_json::to_string_pretty(&matches).unwrap_or_default()
        )
    };

    Ok(text_result(text))
}

// ─── Tool: get_session_stats ──────────────────────────────────────────────────

async fn tool_get_session_stats(state: &ServerState, engine_port: u16, args: &Value) -> Result<Value, String> {
    let session_id = args["session_id"].as_str();

    let mut url = format!("http://127.0.0.1:{engine_port}/_relay/poll?since=0");
    if let Some(sid) = session_id {
        url.push_str(&format!("&session_id={sid}"));
    }

    let resp = state.client.get(&url).send().await.map_err(|e| {
        format!("Cannot reach RelayCraft engine at port {engine_port}. Is the proxy running? Error: {e}")
    })?;

    if !resp.status().is_success() {
        return Ok(error_result(format!("Engine returned status {}", resp.status())));
    }

    let body: Value = resp.json().await.map_err(|e| format!("Failed to parse flows: {e}"))?;
    let indices = body["indices"].as_array().cloned().unwrap_or_default();

    let total = indices.len();
    if total == 0 {
        return Ok(text_result("No flows recorded in this session yet."));
    }

    let error_count = indices.iter().filter(|f| f["hasError"].as_bool().unwrap_or(false)).count();
    let error_rate = error_count as f64 / total as f64;

    // Status distribution
    let mut dist: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for flow in &indices {
        let code = flow["status"].as_u64().unwrap_or(0);
        let bucket = if code == 0 { "other".to_string() } else { format!("{}xx", code / 100) };
        *dist.entry(bucket).or_insert(0) += 1;
    }

    // Top domains (by count)
    let mut domain_counts: std::collections::HashMap<String, (usize, usize)> = std::collections::HashMap::new();
    for flow in &indices {
        let host = flow["host"].as_str().unwrap_or("unknown").to_string();
        let entry = domain_counts.entry(host).or_insert((0, 0));
        entry.0 += 1;
        if flow["hasError"].as_bool().unwrap_or(false) { entry.1 += 1; }
    }
    let mut top_domains: Vec<Value> = domain_counts.iter()
        .map(|(domain, (count, errors))| json!({
            "domain": domain, "count": count, "errorCount": errors
        }))
        .collect();
    top_domains.sort_by(|a, b| b["count"].as_u64().cmp(&a["count"].as_u64()));
    top_domains.truncate(5);

    // Slowest flows
    let mut sorted = indices.clone();
    sorted.sort_by(|a, b| {
        b["time"].as_f64().unwrap_or(0.0)
            .partial_cmp(&a["time"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let slowest: Vec<Value> = sorted.iter().take(3)
        .map(|f| json!({ "id": f["id"], "url": f["url"], "durationMs": f["time"] }))
        .collect();

    let stats = json!({
        "totalFlows": total,
        "errorRate": (error_rate * 100.0).round() / 100.0,
        "errorCount": error_count,
        "statusDistribution": dist,
        "topDomains": top_domains,
        "slowestFlows": slowest
    });

    Ok(text_result(format!(
        "Session stats ({} flows, {:.1}% errors):\n\n{}",
        total,
        error_rate * 100.0,
        serde_json::to_string_pretty(&stats).unwrap_or_default()
    )))
}

// ─── Tool: replay_request ────────────────────────────────────────────────────

async fn tool_replay_request(state: &ServerState, engine_port: u16, args: &Value) -> Result<Value, String> {
    let flow_id = args["flow_id"].as_str().ok_or("Missing required argument: flow_id")?;
    let mods = &args["modifications"];

    // 1. Fetch the original flow
    let detail_url = format!("http://127.0.0.1:{engine_port}/_relay/detail?id={flow_id}");
    let resp = state.client.get(&detail_url).send().await.map_err(|e| {
        format!("Cannot reach engine at port {engine_port}: {e}")
    })?;
    if resp.status().as_u16() == 404 {
        return Ok(error_result(format!("Flow '{flow_id}' not found.")));
    }
    if !resp.status().is_success() {
        return Ok(error_result(format!("Engine returned status {}", resp.status())));
    }
    let flow: Value = resp.json().await.map_err(|e| format!("Failed to parse flow: {e}"))?;

    // 2. Extract request fields, apply modifications
    let method_str = mods["method"].as_str()
        .unwrap_or_else(|| flow["request"]["method"].as_str().unwrap_or("GET"));
    let url = mods["url"].as_str()
        .unwrap_or_else(|| flow["request"]["url"].as_str().unwrap_or(""));
    if url.is_empty() {
        return Ok(error_result("Flow has no URL — cannot replay."));
    }
    let body = if !mods["body"].is_null() {
        mods["body"].as_str().map(|s| s.to_string())
    } else {
        flow["request"]["postData"]["text"].as_str().map(|s| s.to_string())
    };

    // Build headers: start from original, apply overrides
    let proxy_port = crate::config::load_config().map(|c| c.proxy_port).unwrap_or(9090);
    let proxy_url = format!("http://127.0.0.1:{proxy_port}");

    // 3. Build a client that routes through the proxy (so the request is captured)
    let proxy_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .proxy(reqwest::Proxy::all(&proxy_url).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| e.to_string())?;

    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|_| format!("Invalid HTTP method: {method_str}"))?;
    let mut req_builder = proxy_client.request(method, url);

    // Apply original headers
    if let Some(headers_arr) = flow["request"]["headers"].as_array() {
        for h in headers_arr {
            let name = h["name"].as_str().unwrap_or("");
            let value = h["value"].as_str().unwrap_or("");
            // Skip headers that interfere with the proxy
            if name.eq_ignore_ascii_case("content-length") { continue; }
            req_builder = req_builder.header(name, value);
        }
    }
    // Apply header overrides
    if let Some(override_map) = mods["headers"].as_object() {
        for (k, v) in override_map {
            if let Some(val) = v.as_str() {
                req_builder = req_builder.header(k.as_str(), val);
            }
        }
    }
    if let Some(b) = body {
        req_builder = req_builder.body(b);
    }

    // 4. Send
    let start = std::time::Instant::now();
    let response = req_builder.send().await.map_err(|e| {
        format!("Replay request failed: {e}. Ensure the proxy engine is running.")
    })?;
    let duration_ms = start.elapsed().as_millis();
    let status = response.status().as_u16();
    let _body_text = response.text().await.unwrap_or_default();

    Ok(text_result(format!(
        "Replayed {method_str} {url}\n\nStatus: {status}\nDuration: {duration_ms}ms\n\nThe request was captured through the proxy and is now visible in RelayCraft's traffic list. Use list_flows to find it and get_flow to inspect the full response."
    )))
}

// ─── Tool: create_rule ───────────────────────────────────────────────────────

async fn tool_create_rule(state: &ServerState, args: &Value) -> Result<Value, String> {
    use crate::rules::{model::Rule, storage::RuleStorage};

    let rule_type = args["type"].as_str().ok_or("Missing required argument: type")?;
    let name = args["name"].as_str().ok_or("Missing required argument: name")?;
    let url_pattern = args["url_pattern"].as_str().ok_or("Missing required argument: url_pattern")?;
    let method = args["method"].as_str();
    let intent = args["intent"].as_str().unwrap_or("");

    // Build match atoms
    let mut request_matchers = vec![
        json!({"type": "url", "matchType": "contains", "value": url_pattern})
    ];
    if let Some(m) = method {
        request_matchers.push(json!({"type": "method", "matchType": "exact", "value": [m.to_uppercase()]}));
    }

    // Build the action array from simplified params
    let actions = match rule_type {
        "map_local" => {
            let body = args["mock_body"].as_str().unwrap_or("");
            let ct = args["mock_content_type"].as_str().unwrap_or("application/json");
            let status = args["mock_status"].as_u64().unwrap_or(200) as u32;
            json!([{"type": "map_local", "source": "manual", "content": body, "contentType": ct, "statusCode": status}])
        }
        "map_remote" => {
            let target = args["target_url"].as_str()
                .ok_or("map_remote requires target_url")?;
            json!([{"type": "map_remote", "targetUrl": target, "preservePath": true}])
        }
        "rewrite_body" => {
            let target = args["rewrite_target"].as_str().unwrap_or("response");
            let ct = args["rewrite_content_type"].as_str();
            let mode = args["rewrite_mode"].as_str().unwrap_or_else(|| {
                if args["rewrite_pattern"].is_string() { "replace" } else { "set" }
            });
            let mut action = json!({"type": "rewrite_body", "target": target});
            if let Some(ct_val) = ct {
                action["contentType"] = json!(ct_val);
            }
            match mode {
                "set" => {
                    let content = args["rewrite_content"].as_str()
                        .ok_or("rewrite_body set mode requires rewrite_content")?;
                    action["set"] = json!({"content": content});
                }
                "replace" => {
                    let pattern = args["rewrite_pattern"].as_str()
                        .ok_or("rewrite_body replace mode requires rewrite_pattern")?;
                    let replacement = args["rewrite_replacement"].as_str().unwrap_or("");
                    action["replace"] = json!({"pattern": pattern, "replacement": replacement});
                }
                "regex_replace" => {
                    let pattern = args["rewrite_pattern"].as_str()
                        .ok_or("rewrite_body regex_replace mode requires rewrite_pattern")?;
                    let replacement = args["rewrite_replacement"].as_str().unwrap_or("");
                    action["regexReplace"] = json!({"pattern": pattern, "replacement": replacement});
                }
                "status_code" => {
                    let status = args["rewrite_status"].as_u64()
                        .ok_or("rewrite_body status_code mode requires rewrite_status")?;
                    action["statusCode"] = json!(status);
                }
                _ => return Ok(error_result(format!(
                    "Unknown rewrite_mode '{mode}'. Valid modes: set, replace, regex_replace, status_code"
                ))),
            }
            json!([action])
        }
        "rewrite_header" => {
            let header_name = args["header_name"].as_str()
                .ok_or("rewrite_header requires header_name")?;
            let operation = args["header_operation"].as_str().unwrap_or("set");
            let value = args["header_value"].as_str();
            let phase = args["header_phase"].as_str().unwrap_or("response");
            let op = json!({"operation": operation, "key": header_name, "value": value});
            let headers = if phase == "request" {
                json!({"request": [op], "response": []})
            } else {
                json!({"request": [], "response": [op]})
            };
            json!([{"type": "rewrite_header", "headers": headers}])
        }
        "throttle" => {
            let bw = args["bandwidth_kbps"].as_u64();
            let delay = args["delay_ms"].as_u64();
            json!([{"type": "throttle", "bandwidthKbps": bw, "delayMs": delay}])
        }
        "block_request" => json!([{"type": "block_request"}]),
        _ => return Ok(error_result(format!(
            "Unknown rule type: '{rule_type}'. Valid types: map_local, map_remote, rewrite_header, rewrite_body, throttle, block_request"
        ))),
    };

    let rule_id = uuid::Uuid::new_v4().to_string();
    let rule_value = json!({
        "id": rule_id,
        "name": name,
        "type": rule_type,
        "execution": { "enabled": true, "priority": 1, "stopOnMatch": true },
        "match": { "request": request_matchers, "response": [] },
        "actions": actions,
        "metadata": {
            "source": "ai_mcp",
            "aiIntent": if intent.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(intent.to_string()) }
        }
    });

    let rule: Rule = serde_json::from_value(rule_value)
        .map_err(|e| format!("Failed to build rule: {e}"))?;

    RuleStorage::from_config()
        .map_err(|e| format!("Cannot access rules storage: {e}"))?
        .save(&rule, None)
        .map_err(|e| format!("Failed to save rule: {e}"))?;

    let _ = state.app.emit("rules-changed", ());

    log::info!("MCP: created rule '{}' (id: {}, type: {})", name, rule_id, rule_type);

    Ok(text_result(format!(
        "Rule '{name}' created (type: {rule_type}, id: {rule_id}).\nThe rule is now active and visible in the RelayCraft Rules panel."
    )))
}

// ─── Tool: list_rules ────────────────────────────────────────────────────────

async fn tool_list_rules(_state: &ServerState) -> Result<Value, String> {
    use crate::rules::storage::RuleStorage;

    let storage = RuleStorage::from_config()
        .map_err(|e| format!("Cannot access rules storage: {e}"))?;
    let loaded = storage.load_all()
        .map_err(|e| format!("Failed to load rules: {e}"))?;

    let rules: Vec<Value> = loaded.rules.iter().map(|entry| {
        let rule = &entry.rule;
        // Extract the first URL match pattern for display
        let url_pattern = rule.match_config.request.iter()
            .find(|a| a.atom_type == "url")
            .and_then(|a| a.value.as_ref()?.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let source = rule.metadata.as_ref()
            .and_then(|m| m.source.as_deref())
            .unwrap_or("user");
        json!({
            "id": rule.id,
            "name": rule.name,
            "type": rule.r#type,
            "url_pattern": url_pattern,
            "enabled": rule.execution.enabled,
            "source": source,
            "group": entry.group_id
        })
    }).collect();

    Ok(text_result(serde_json::to_string_pretty(&rules).unwrap_or_default()))
}

// ─── Tool: delete_rule ───────────────────────────────────────────────────────

async fn tool_delete_rule(state: &ServerState, args: &Value) -> Result<Value, String> {
    use crate::rules::storage::RuleStorage;

    let rule_id = args["rule_id"].as_str().ok_or("Missing required argument: rule_id")?;

    let storage = RuleStorage::from_config()
        .map_err(|e| format!("Cannot access rules storage: {e}"))?;

    // Load first so we can return the rule's name/source in the response
    let loaded = storage.load_all()
        .map_err(|e| format!("Failed to load rules: {e}"))?;
    let entry = loaded.rules.iter().find(|e| e.rule.id == rule_id)
        .ok_or_else(|| format!("Rule not found: {rule_id}"))?;
    let rule_name = entry.rule.name.clone();
    let source = entry.rule.metadata.as_ref()
        .and_then(|m| m.source.as_deref())
        .unwrap_or("user")
        .to_string();

    storage.delete(rule_id)
        .map_err(|e| format!("Failed to delete rule: {e}"))?;

    let _ = state.app.emit("rules-changed", ());

    log::info!("MCP: deleted rule '{}' (id: {}, source: {})", rule_name, rule_id, source);

    Ok(text_result(format!(
        "Deleted rule '{rule_name}' (id: {rule_id}, source: {source})."
    )))
}

// ─── Tool: toggle_rule ───────────────────────────────────────────────────────

async fn tool_toggle_rule(state: &ServerState, args: &Value) -> Result<Value, String> {
    use crate::rules::storage::RuleStorage;

    let rule_id = args["rule_id"].as_str().ok_or("Missing required argument: rule_id")?;
    let enabled = args["enabled"].as_bool().ok_or("Missing required argument: enabled")?;

    let storage = RuleStorage::from_config()
        .map_err(|e| format!("Cannot access rules storage: {e}"))?;
    let loaded = storage.load_all()
        .map_err(|e| format!("Failed to load rules: {e}"))?;
    let entry = loaded.rules.iter().find(|e| e.rule.id == rule_id)
        .ok_or_else(|| format!("Rule not found: {rule_id}"))?;

    let mut rule = entry.rule.clone();
    rule.execution.enabled = enabled;

    storage.save(&rule, Some(&entry.group_id))
        .map_err(|e| format!("Failed to save rule: {e}"))?;

    let _ = state.app.emit("rules-changed", ());

    let status = if enabled { "enabled" } else { "disabled" };
    log::info!("MCP: {} rule '{}' (id: {})", status, rule.name, rule_id);

    Ok(text_result(format!("Rule '{}' is now {status}.", rule.name)))
}

// ─── Server lifecycle ────────────────────────────────────────────────────────

/// Start the MCP HTTP server. Replaces any existing running instance.
pub fn start(state: &McpState, mcp_port: u16, engine_port: u16, app: tauri::AppHandle) {
    // Store the AppHandle so write tools can emit events to the frontend
    if let Ok(mut guard) = state.app.lock() {
        *guard = Some(app.clone());
    }
    let shutdown_tx = state.shutdown_tx.clone();
    let running = state.running.clone();
    let port_arc = state.port.clone();
    let token = state.token.lock().map(|t| t.clone()).unwrap_or_default();

    tauri::async_runtime::spawn(async move {
        // Send shutdown to any existing instance
        {
            let mut tx_lock = shutdown_tx.lock().await;
            if let Some(tx) = tx_lock.take() {
                let _ = tx.send(());
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }

        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        {
            let mut tx_lock = shutdown_tx.lock().await;
            *tx_lock = Some(tx);
        }
        if let Ok(mut p) = port_arc.lock() {
            *p = mcp_port;
        }
        running.store(true, Ordering::SeqCst);

        log::info!("MCP Server starting on port {mcp_port} (engine port: {engine_port})");

        if let Err(e) = run_server(mcp_port, token, app, rx, running.clone()).await {
            log::error!("MCP Server exited with error: {e}");
        }

        running.store(false, Ordering::SeqCst);
        log::info!("MCP Server stopped");
    });
}

/// Stop the MCP server if running.
pub fn stop(state: &McpState) {
    let shutdown_tx = state.shutdown_tx.clone();
    let running = state.running.clone();

    tauri::async_runtime::spawn(async move {
        let mut tx_lock = shutdown_tx.lock().await;
        if let Some(tx) = tx_lock.take() {
            let _ = tx.send(());
        }
        running.store(false, Ordering::SeqCst);
    });
}

async fn run_server(
    port: u16,
    token: String,
    app: tauri::AppHandle,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let server_state = ServerState { client, token, app };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/mcp", post(handle_mcp))
        .layer(cors)
        .with_state(server_state);

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind MCP Server to {addr}: {e}"))?;

    log::info!("MCP Server listening on http://{addr}/mcp");

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
            running.store(false, Ordering::SeqCst);
        })
        .await
        .map_err(|e| e.to_string())
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct McpStatus {
    pub running: bool,
    pub port: u16,
}

#[tauri::command]
pub fn get_mcp_status(state: tauri::State<'_, McpState>) -> McpStatus {
    let port = state.port.lock().map(|p| *p).unwrap_or(7090);
    McpStatus {
        running: state.running.load(Ordering::SeqCst),
        port,
    }
}

/// Returns the Bearer token that MCP clients must include in tools/call requests.
#[tauri::command]
pub fn get_mcp_token(state: tauri::State<'_, McpState>) -> String {
    state.token.lock().map(|t| t.clone()).unwrap_or_default()
}

#[tauri::command]
pub async fn apply_mcp_config(
    state: tauri::State<'_, McpState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let config = crate::config::load_config().unwrap_or_default();
    if config.mcp_config.enabled {
        start(&state, config.mcp_config.port, config.proxy_port, app);
    } else {
        stop(&state);
    }
    Ok(())
}
