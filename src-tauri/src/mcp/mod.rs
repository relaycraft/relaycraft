//! MCP Server — Model Context Protocol over HTTP
//!
//! Exposes RelayCraft traffic data to AI tools (Claude Desktop, Cursor, etc.)
//! via the MCP standard. Implements Streamable HTTP transport (POST /mcp).
//!
//! MVP Tools:
//!   - list_sessions  — list all recorded sessions
//!   - list_flows     — query flows in a session with filtering
//!   - get_flow       — full request/response detail for a single flow
//!   - search_flows   — keyword search across flow URLs

use axum::{Json, Router, extract::State, routing::post};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tower_http::cors::{Any, CorsLayer};

// ─── Tauri-managed state ────────────────────────────────────────────────────

pub struct McpState {
    pub running: Arc<AtomicBool>,
    /// Current listening port — std Mutex so it can be read from sync commands
    pub port: Arc<Mutex<u16>>,
    /// Shutdown channel — tokio Mutex since it's only accessed from async tasks
    pub shutdown_tx: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Arc::new(Mutex::new(7090)),
            shutdown_tx: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
}

// ─── Axum app state ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct ServerState {
    /// HTTP client for calling the Python engine API
    client: reqwest::Client,
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
    Json(req): Json<RpcRequest>,
) -> Json<RpcResponse> {
    let id = req.id.clone();
    match dispatch(&state, &req.method, &req.params).await {
        Ok(result) => Json(RpcResponse::ok(id, result)),
        Err(msg) => Json(RpcResponse::err(id, -32000, msg)),
    }
}

async fn dispatch(state: &ServerState, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "initialize" => Ok(handle_initialize()),
        "notifications/initialized" | "ping" => Ok(json!({})),
        "tools/list" => Ok(handle_tools_list()),
        "tools/call" => handle_tools_call(state, params).await,
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
        "instructions": "RelayCraft MCP Server gives you read-only access to HTTP traffic captured by the RelayCraft proxy. Use list_sessions to see available sessions, list_flows to browse requests, get_flow for full detail, and search_flows to find specific requests by keyword."
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
                "description": "Search HTTP flows by keyword. Matches against the full URL. Returns a filtered list of flows sorted by recency.",
                "inputSchema": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Keyword to search for in flow URLs."
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
            }
        ]
    })
}

// ─── tools/call ─────────────────────────────────────────────────────────────

async fn handle_tools_call(state: &ServerState, params: &Value) -> Result<Value, String> {
    let name = params["name"].as_str().ok_or("Missing tool name")?;
    let args = &params["arguments"];

    let engine_port = get_engine_port();

    match name {
        "list_sessions" => tool_list_sessions(state, engine_port).await,
        "list_flows" => tool_list_flows(state, engine_port, args).await,
        "get_flow" => tool_get_flow(state, engine_port, args).await,
        "search_flows" => tool_search_flows(state, engine_port, args).await,
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
    let query_lower = query.to_lowercase();
    let session_id = args["session_id"].as_str();
    let limit = args["limit"].as_u64().unwrap_or(20).min(50) as usize;

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

    let matches: Vec<Value> = indices
        .iter()
        .filter(|flow| {
            let url_str = flow["url"].as_str().unwrap_or("").to_lowercase();
            let host = flow["host"].as_str().unwrap_or("").to_lowercase();
            let path = flow["path"].as_str().unwrap_or("").to_lowercase();
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

// ─── Server lifecycle ────────────────────────────────────────────────────────

/// Start the MCP HTTP server. Replaces any existing running instance.
pub fn start(state: &McpState, mcp_port: u16, engine_port: u16) {
    // Signal existing server to stop
    let shutdown_tx = state.shutdown_tx.clone();
    let running = state.running.clone();
    let port_arc = state.port.clone();

    tauri::async_runtime::spawn(async move {
        // Send shutdown to any existing instance
        {
            let mut tx_lock = shutdown_tx.lock().await;
            if let Some(tx) = tx_lock.take() {
                let _ = tx.send(());
                // Brief pause for graceful shutdown
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

        if let Err(e) = run_server(mcp_port, rx, running.clone()).await {
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
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let server_state = ServerState { client };

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

#[tauri::command]
pub async fn apply_mcp_config(state: tauri::State<'_, McpState>) -> Result<(), String> {
    let config = crate::config::load_config().unwrap_or_default();
    if config.mcp_config.enabled {
        start(&state, config.mcp_config.port, config.proxy_port);
    } else {
        stop(&state);
    }
    Ok(())
}
