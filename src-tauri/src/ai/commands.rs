use crate::ai::{
    crypto, AIClient, AIConfig, ChatCompletionChunk, ChatMessage, Tool, ToolChoice,
};
use crate::ai::tool_args::normalize_and_validate_tool_calls;
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{ipc::Channel, State};

pub struct AIState {
    pub config: Mutex<AIConfig>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCompletionResult {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<crate::ai::client::ToolCall>>,
}

fn build_tool_completion_result(
    choice: &crate::ai::client::Choice,
    normalized_tool_calls: Option<Vec<crate::ai::client::ToolCall>>,
) -> ToolCompletionResult {
    ToolCompletionResult {
        content: choice.message.content.clone(),
        tool_calls: normalized_tool_calls.or_else(|| choice.message.tool_calls.clone()),
    }
}

fn tuple_messages_to_chat_messages(messages: Vec<(String, String)>) -> Vec<ChatMessage> {
    messages
        .into_iter()
        .map(|(role, content)| ChatMessage {
            role,
            content: Some(content),
            name: None,
            tool_call_id: None,
        })
        .collect()
}

#[tauri::command]
pub async fn load_ai_config(state: State<'_, AIState>) -> Result<AIConfig, String> {
    let mut config = state
        .config
        .lock()
        .map_err(|e| format!("Config lock poisoned: {}", e))?
        .clone();

    // Load API key from local storage
    if let Ok(key) = crypto::retrieve_api_key(&config.provider) {
        config.api_key = key;
    }

    Ok(config)
}

#[tauri::command]
pub async fn get_api_key(provider: String) -> Result<String, String> {
    match crypto::retrieve_api_key(&provider) {
        Ok(key) => Ok(key),
        Err(_) => Ok(String::new()), // Return empty string if not found
    }
}

#[tauri::command]
pub async fn save_ai_config(config: AIConfig, state: State<'_, AIState>) -> Result<(), String> {
    log::info!(
        "Saving AI config. Provider: {}, API Key provided: {}",
        config.provider,
        !config.api_key.is_empty()
    );

    // Validate configuration
    config.validate().map_err(|e| e.to_string())?;

    // Store API key if provided
    if !config.api_key.is_empty() {
        log::info!("Storing API key in local storage...");
        crypto::store_api_key(&config.provider, &config.api_key).map_err(|e| {
            log::error!("Failed to store API key: {}", e);
            format!("Failed to store API key: {}", e)
        })?;
    }

    // Update in-memory state and persist
    *state
        .config
        .lock()
        .map_err(|e| format!("Config lock poisoned: {}", e))? = config.clone();

    // Persist to config.json
    let mut app_config = crate::config::load_config().unwrap_or_default();
    app_config.ai_config = config;
    crate::config::save_config(app_config)?;

    Ok(())
}

#[tauri::command]
pub async fn test_ai_connection(state: State<'_, AIState>) -> Result<String, String> {
    let mut config = state
        .config
        .lock()
        .map_err(|e| format!("Config lock poisoned: {}", e))?
        .clone();

    log::info!("Testing AI connection. Provider: {}", config.provider);

    // Load API key from local storage
    match crypto::retrieve_api_key(&config.provider) {
        Ok(key) => {
            log::info!(
                "Retrieved API key from local storage (length: {})",
                key.len()
            );
            config.api_key = key;
        }
        Err(e) => {
            log::info!("No API key found in local storage: {}", e);
        }
    }

    if !config.enabled {
        return Err("AI is not enabled".to_string());
    }

    // Key check mostly handled by client
    if config.api_key.is_empty() && config.provider != "custom" { // custom might not need key
    }

    let client = AIClient::new(config);

    log::info!("Executing AI test connection request...");
    match client.test_connection().await {
        Ok(msg) => {
            log::info!("AI Test Connection Successful: {}", msg);
            Ok(msg)
        }
        Err(e) => {
            log::error!("AI Test Connection Failed: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn ai_chat_completion(
    messages: Vec<(String, String)>,
    temperature: Option<f32>,
    state: State<'_, AIState>,
) -> Result<String, String> {
    let mut config = state
        .config
        .lock()
        .map_err(|e| format!("Config lock poisoned: {}", e))?
        .clone();

    // Load API key from local storage
    if let Ok(key) = crypto::retrieve_api_key(&config.provider) {
        config.api_key = key;
    }

    if !config.enabled {
        return Err("AI is not enabled".to_string());
    }

    let client = AIClient::new(config);

    let response = client
        .chat_completion(messages, temperature)
        .await
        .map_err(|e| e.to_string())?;

    Ok(response.choices[0]
        .message
        .content
        .clone()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn ai_chat_completion_with_tools(
    messages: Vec<ChatMessage>,
    tools: Vec<Tool>,
    tool_choice: Option<ToolChoice>,
    temperature: Option<f32>,
    state: State<'_, AIState>,
) -> Result<ToolCompletionResult, String> {
    let mut config = state
        .config
        .lock()
        .map_err(|e| format!("Config lock poisoned: {}", e))?
        .clone();

    if let Ok(key) = crypto::retrieve_api_key(&config.provider) {
        config.api_key = key;
    }

    if !config.enabled {
        return Err("AI is not enabled".to_string());
    }

    let client = AIClient::new(config);

    let response = client
        .chat_completion_with_tools(messages, tools, tool_choice, temperature)
        .await
        .map_err(|e| e.to_string())?;

    let Some(choice) = response.choices.first() else {
        return Err("AI returned empty choices".to_string());
    };

    let normalized_tool_calls = normalize_and_validate_tool_calls(choice.message.tool_calls.as_ref())?;

    Ok(build_tool_completion_result(choice, normalized_tool_calls))
}

#[tauri::command]
pub async fn ai_chat_completion_stream(
    messages: Vec<(String, String)>,
    temperature: Option<f32>,
    on_chunk: Channel<ChatCompletionChunk>,
    state: State<'_, AIState>,
) -> Result<(), String> {
    let mut config = state
        .config
        .lock()
        .map_err(|e| format!("Config lock poisoned: {}", e))?
        .clone();

    if let Ok(key) = crypto::retrieve_api_key(&config.provider) {
        config.api_key = key;
    }

    if !config.enabled {
        return Err("AI is not enabled".to_string());
    }

    let chat_messages = tuple_messages_to_chat_messages(messages);

    let client = AIClient::new(config);
    let mut stream = client
        .chat_completion_stream_with_tools(chat_messages, None, None, temperature)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                if let Err(_) = on_chunk.send(chunk) {
                    log::warn!("Frontend channel dropped, aborting stream generation.");
                    break;
                }
            }
            Err(e) => {
                log::error!("Streaming error: {}", e);
                return Err(e.to_string());
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_tool_completion_result, tuple_messages_to_chat_messages};
    use crate::ai::client::{Choice, FunctionCall, ResponseMessage, ToolCall};

    #[test]
    fn build_tool_completion_result_keeps_tool_metadata() {
        let choice = Choice {
            message: ResponseMessage {
                role: "assistant".to_string(),
                content: None,
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".to_string(),
                    tool_type: "function".to_string(),
                    function: FunctionCall {
                        name: "explain_rule".to_string(),
                        arguments: "{\"message\":\"cannot generate\"}".to_string(),
                    },
                }]),
            },
            finish_reason: Some("tool_calls".to_string()),
        };

        let result = build_tool_completion_result(&choice, None);
        let tool_calls = result.tool_calls.expect("tool_calls should exist");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].id, "call_1");
        assert_eq!(tool_calls[0].function.name, "explain_rule");
        assert_eq!(tool_calls[0].function.arguments, "{\"message\":\"cannot generate\"}");
    }

    #[test]
    fn build_tool_completion_result_prefers_normalized_tool_calls() {
        let choice = Choice {
            message: ResponseMessage {
                role: "assistant".to_string(),
                content: None,
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".to_string(),
                    tool_type: "function".to_string(),
                    function: FunctionCall {
                        name: "generate_rule".to_string(),
                        arguments: "{\"ruleType\":\"block_request\"}".to_string(),
                    },
                }]),
            },
            finish_reason: Some("tool_calls".to_string()),
        };

        let normalized = vec![ToolCall {
            id: "call_1".to_string(),
            tool_type: "function".to_string(),
            function: FunctionCall {
                name: "generate_rule".to_string(),
                arguments: "{\"rule_type\":\"block_request\"}".to_string(),
            },
        }];
        let result = build_tool_completion_result(&choice, Some(normalized));
        let tool_calls = result.tool_calls.expect("tool_calls should exist");
        assert_eq!(tool_calls[0].function.arguments, "{\"rule_type\":\"block_request\"}");
    }

    #[test]
    fn tuple_messages_to_chat_messages_fills_content_without_tool_metadata() {
        let converted = tuple_messages_to_chat_messages(vec![(
            "user".to_string(),
            "hello".to_string(),
        )]);
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].role, "user");
        assert_eq!(converted[0].content.as_deref(), Some("hello"));
        assert_eq!(converted[0].name, None);
        assert_eq!(converted[0].tool_call_id, None);
    }

    #[test]
    fn tool_messages_keep_name_and_tool_call_id_when_not_converted() {
        let original = crate::ai::client::ChatMessage {
            role: "tool".to_string(),
            content: Some("{\"ok\":true}".to_string()),
            name: Some("generate_rule".to_string()),
            tool_call_id: Some("call_1".to_string()),
        };

        assert_eq!(original.role, "tool");
        assert_eq!(original.name.as_deref(), Some("generate_rule"));
        assert_eq!(original.tool_call_id.as_deref(), Some("call_1"));
    }
}

#[tauri::command]
pub async fn ai_chat_completion_stream_with_tools(
    messages: Vec<ChatMessage>,
    tools: Option<Vec<Tool>>,
    tool_choice: Option<ToolChoice>,
    temperature: Option<f32>,
    on_chunk: Channel<ChatCompletionChunk>,
    state: State<'_, AIState>,
) -> Result<(), String> {
    let mut config = state
        .config
        .lock()
        .map_err(|e| format!("Config lock poisoned: {}", e))?
        .clone();

    if let Ok(key) = crypto::retrieve_api_key(&config.provider) {
        config.api_key = key;
    }

    if !config.enabled {
        return Err("AI is not enabled".to_string());
    }

    let client = AIClient::new(config);
    let mut stream = client
        .chat_completion_stream_with_tools(messages, tools, tool_choice, temperature)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                if let Err(_) = on_chunk.send(chunk) {
                    log::warn!("Frontend channel dropped, aborting stream generation.");
                    break;
                }
            }
            Err(e) => {
                log::error!("Streaming error: {}", e);
                return Err(e.to_string());
            }
        }
    }

    Ok(())
}
