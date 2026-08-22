//! Host-domain bridge handlers: engine-independent capabilities
//! (plugin KV storage, runtime info, AI, process stats, outbound HTTP).

use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
struct PluginAIMessageObject {
    role: String,
    content: String,
}

fn parse_plugin_ai_messages(args: serde_json::Value) -> Result<Vec<(String, String)>, String> {
    let serde_json::Value::Array(items) = args else {
        return Err(
            "Invalid AI messages: expected [[role, content], ...] or [{ role, content }, ...]"
                .to_string(),
        );
    };

    if items.is_empty() {
        return Ok(Vec::new());
    }

    let all_tuple_shape = items
        .iter()
        .all(|item| matches!(item, serde_json::Value::Array(arr) if arr.len() == 2));
    if all_tuple_shape {
        return serde_json::from_value::<Vec<(String, String)>>(serde_json::Value::Array(items))
            .map_err(|e| format!("Invalid AI messages: {}", e));
    }

    let all_object_shape = items
        .iter()
        .all(|item| matches!(item, serde_json::Value::Object(map) if map.contains_key("role") && map.contains_key("content")));
    if all_object_shape {
        return serde_json::from_value::<Vec<PluginAIMessageObject>>(serde_json::Value::Array(
            items,
        ))
        .map(|object_messages| {
            object_messages
                .into_iter()
                .map(|m| (m.role, m.content))
                .collect()
        })
        .map_err(|e| format!("Invalid AI messages: {}", e));
    }

    Err(
        "Invalid AI messages: mixed/unsupported message shape. Use only [[role, content], ...] or [{ role, content }, ...]"
            .to_string(),
    )
}

// ── storage ──────────────────────────────────────────────────────────────

pub async fn storage_get(
    plugin_id: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let key = args["key"].as_str().ok_or("storage_get: missing 'key'")?;
    let result = crate::plugins::storage::get(plugin_id, key).await?;
    Ok(serde_json::to_value(result).unwrap_or(serde_json::Value::Null))
}

pub async fn storage_set(
    plugin_id: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let key = args["key"].as_str().ok_or("storage_set: missing 'key'")?;
    let value = args["value"]
        .as_str()
        .ok_or("storage_set: missing 'value'")?
        .to_string();
    crate::plugins::storage::set(plugin_id, key, value).await?;
    Ok(serde_json::Value::Null)
}

pub async fn storage_delete(
    plugin_id: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let key = args["key"]
        .as_str()
        .ok_or("storage_delete: missing 'key'")?;
    crate::plugins::storage::delete(plugin_id, key).await?;
    Ok(serde_json::Value::Null)
}

pub async fn storage_list(
    plugin_id: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let prefix = args["prefix"].as_str();
    let result = crate::plugins::storage::list(plugin_id, prefix).await?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

pub async fn storage_clear(plugin_id: &str) -> Result<serde_json::Value, String> {
    crate::plugins::storage::clear(plugin_id).await?;
    Ok(serde_json::Value::Null)
}

// ── host.getRuntime ──────────────────────────────────────────────────────

pub async fn host_get_runtime(app: &AppHandle) -> Result<serde_json::Value, String> {
    // No permission required — only exposes non-sensitive runtime info.
    let config = crate::config::load_config().unwrap_or_default();
    let proxy_status = crate::proxy::get_proxy_status(app.state()).await?;
    let mcp_state = app.state::<crate::mcp::McpState>();
    let mcp_running = mcp_state.running.load(std::sync::atomic::Ordering::Relaxed);
    let mcp_port = *mcp_state.port.lock().expect("mcp port lock poisoned");

    Ok(serde_json::json!({
        "proxyPort": config.proxy_port,
        "proxyRunning": proxy_status.running,
        "proxyActive": proxy_status.active,
        "mcpEnabled": config.mcp_config.enabled,
        "mcpRunning": mcp_running,
        "mcpPort": mcp_port,
    }))
}

// ── ai.chat ──────────────────────────────────────────────────────────────

pub async fn ai_chat_completion(
    app: &AppHandle,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Accept both tuple arrays and object arrays for compatibility:
    // [["user","hi"], ...] OR [{ role: "user", content: "hi" }, ...]
    let messages = parse_plugin_ai_messages(args)?;

    let response = crate::ai::commands::ai_chat_completion(messages, None, app.state()).await?;
    Ok(serde_json::to_value(response).map_err(|e| e.to_string())?)
}

// ── stats.getProcessStats ────────────────────────────────────────────────

pub async fn get_process_stats(app: &AppHandle) -> Result<serde_json::Value, String> {
    let stats = crate::proxy::monitor::get_process_stats(app.state()).await?;
    Ok(serde_json::to_value(stats).map_err(|e| e.to_string())?)
}

// ── http.send ────────────────────────────────────────────────────────────

pub async fn http_send(args: serde_json::Value) -> Result<serde_json::Value, String> {
    #[derive(serde::Deserialize)]
    struct HttpSendArgs {
        method: String,
        url: String,
        headers: Option<std::collections::HashMap<String, String>>,
        body: Option<String>,
    }

    let args: HttpSendArgs =
        serde_json::from_value(args).map_err(|e| format!("Invalid http_send args: {e}"))?;

    let req = crate::traffic::commands::ReplayRequest {
        method: args.method,
        url: args.url,
        headers: args.headers.unwrap_or_default(),
        body: args.body,
    };
    let response = crate::traffic::commands::replay_request_inner(req).await?;
    serde_json::to_value(response).map_err(|e| e.to_string())
}
