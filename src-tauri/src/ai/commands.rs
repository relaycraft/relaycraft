use crate::ai::{crypto, AIClient, AIConfig, ChatCompletionChunk};
use futures_util::StreamExt;
use std::sync::Mutex;
use tauri::{ipc::Channel, State};

pub struct AIState {
    pub config: Mutex<AIConfig>,
}

#[tauri::command]
pub async fn load_ai_config(state: State<'_, AIState>) -> Result<AIConfig, String> {
    let mut config = state.config.lock().unwrap().clone();

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
    *state.config.lock().unwrap() = config.clone();

    // Persist to config.json
    let mut app_config = crate::config::load_config().unwrap_or_default();
    app_config.ai_config = config;
    crate::config::save_config(app_config)?;

    Ok(())
}

#[tauri::command]
pub async fn test_ai_connection(state: State<'_, AIState>) -> Result<String, String> {
    let mut config = state.config.lock().unwrap().clone();

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
    let mut config = state.config.lock().unwrap().clone();

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

    Ok(response.choices[0].message.content.clone())
}

#[tauri::command]
pub async fn ai_chat_completion_stream(
    messages: Vec<(String, String)>,
    temperature: Option<f32>,
    on_chunk: Channel<ChatCompletionChunk>,
    state: State<'_, AIState>,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();

    if let Ok(key) = crypto::retrieve_api_key(&config.provider) {
        config.api_key = key;
    }

    if !config.enabled {
        return Err("AI is not enabled".to_string());
    }

    let client = AIClient::new(config);
    let mut stream = client
        .chat_completion_stream(messages, temperature)
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
