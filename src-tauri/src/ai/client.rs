use super::config::AIConfig;
use super::error::AIError;
use crate::logging;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ChatCompletionResponse {
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct Choice {
    pub message: Message,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatCompletionChunk {
    pub choices: Vec<ChunkChoice>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChunkChoice {
    pub delta: ChunkDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChunkDelta {
    pub content: Option<String>,
}

pub struct AIClient {
    client: Client,
    config: AIConfig,
}

impl AIClient {
    pub fn new(config: AIConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, config }
    }

    /// Generic chat completion
    pub async fn chat_completion(
        &self,
        messages: Vec<(String, String)>, // (role, content)
        temp_override: Option<f32>,
    ) -> Result<ChatCompletionResponse, AIError> {
        let base_endpoint = self.config.get_endpoint();
        let base_endpoint = base_endpoint.trim_end_matches('/');
        let endpoint = format!("{}/chat/completions", base_endpoint);

        let chat_messages: Vec<ChatMessage> = messages
            .into_iter()
            .map(|(role, content)| ChatMessage { role, content })
            .collect();

        let model_name = self.config.model.to_lowercase();
        // Reasoning models (o1, o3, deepseek-reasoner, kimi k2.5) strictly require temperature 1.0
        let is_reasoning = model_name.contains("o1")
            || model_name.contains("o3")
            || model_name.contains("reasoner")
            || model_name.contains("k2.5");

        let temperature = if is_reasoning {
            1.0
        } else {
            temp_override.unwrap_or(self.config.temperature)
        };

        let request = ChatCompletionRequest {
            model: self.config.model.clone(),
            messages: chat_messages.clone(),
            temperature,
            max_tokens: self.config.max_tokens,
            stream: false,
        };

        // Calculate approximate token count for audit logging
        let message_chars: usize = chat_messages.iter().map(|m| m.content.len()).sum();
        let approx_input_tokens = message_chars / 4; // Rough estimate: ~4 chars per token

        // Audit log: endpoint and token info
        let _ = logging::write_domain_log(
            "audit",
            &format!(
                "AI Request: endpoint={}, model={}, max_tokens={}, approx_input_tokens={}",
                endpoint, self.config.model, self.config.max_tokens, approx_input_tokens
            ),
        );

        // Debug log: full request details (only when verbose logging is enabled)
        log::debug!(
            "AI Request Details: endpoint={}, model={}, temperature={}, max_tokens={}, messages_count={}",
            endpoint, self.config.model, temperature, self.config.max_tokens, chat_messages.len()
        );
        for (idx, msg) in chat_messages.iter().enumerate() {
            log::debug!(
                "  Message[{}]: role={}, content_length={}",
                idx, msg.role, msg.content.len()
            );
        }

        log::info!("Sending AI request to: {}", endpoint);

        let mut request_builder = self
            .client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .json(&request);

        if !self.config.api_key.is_empty() {
            request_builder =
                request_builder.header("Authorization", format!("Bearer {}", self.config.api_key));
        }

        let response = request_builder.send().await.map_err(|e| {
            log::error!("AI Network Error: {}", e);
            AIError::NetworkError(e.to_string())
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            log::error!("AI API Error ({}): {}", status, error_text);
            return Err(AIError::APIError(format!(
                "API Error ({}): {}",
                status, error_text
            )));
        }

        log::info!("AI request successful");
        response
            .json::<ChatCompletionResponse>()
            .await
            .map_err(|e| {
                log::error!("AI Parse Error: {}", e);
                AIError::ParseError(e.to_string())
            })
    }

    pub async fn chat_completion_stream(
        &self,
        messages: Vec<(String, String)>,
        temp_override: Option<f32>,
    ) -> Result<impl futures_util::Stream<Item = Result<ChatCompletionChunk, AIError>>, AIError>
    {
        let base_endpoint = self.config.get_endpoint();
        let base_endpoint = base_endpoint.trim_end_matches('/');
        let endpoint = format!("{}/chat/completions", base_endpoint);

        let chat_messages: Vec<ChatMessage> = messages
            .into_iter()
            .map(|(role, content)| ChatMessage { role, content })
            .collect();

        let model_name = self.config.model.to_lowercase();
        let is_reasoning = model_name.contains("o1")
            || model_name.contains("o3")
            || model_name.contains("reasoner")
            || model_name.contains("k2.5");

        let temperature = if is_reasoning {
            1.0
        } else {
            temp_override.unwrap_or(self.config.temperature)
        };

        // Calculate approximate token count for audit logging
        let message_chars: usize = chat_messages.iter().map(|m| m.content.len()).sum();
        let approx_input_tokens = message_chars / 4; // Rough estimate: ~4 chars per token

        // Audit log: endpoint and token info
        let _ = logging::write_domain_log(
            "audit",
            &format!(
                "AI Stream Request: endpoint={}, model={}, max_tokens={}, approx_input_tokens={}",
                endpoint, self.config.model, self.config.max_tokens, approx_input_tokens
            ),
        );

        // Debug log: full request details (only when verbose logging is enabled)
        log::debug!(
            "AI Stream Request Details: endpoint={}, model={}, temperature={}, max_tokens={}, messages_count={}",
            endpoint, self.config.model, temperature, self.config.max_tokens, chat_messages.len()
        );
        for (idx, msg) in chat_messages.iter().enumerate() {
            log::debug!(
                "  Message[{}]: role={}, content_length={}",
                idx, msg.role, msg.content.len()
            );
        }

        let request = ChatCompletionRequest {
            model: self.config.model.clone(),
            messages: chat_messages,
            temperature,
            max_tokens: self.config.max_tokens,
            stream: true,
        };

        let mut request_builder = self
            .client
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .json(&request);

        if !self.config.api_key.is_empty() {
            request_builder =
                request_builder.header("Authorization", format!("Bearer {}", self.config.api_key));
        }

        let response = request_builder.send().await.map_err(|e| {
            log::error!("AI Streaming Network Error: {}", e);
            AIError::NetworkError(e.to_string())
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::APIError(format!(
                "API Error ({}): {}",
                status, error_text
            )));
        }

        let stream = response.bytes_stream();
        let sse_stream = stream.map(|chunk_result| {
            chunk_result
                .map_err(|e| AIError::NetworkError(e.to_string()))
                .and_then(|bytes| {
                    let text = String::from_utf8_lossy(&bytes);
                    let mut result = Err(AIError::ParseError("No valid info".to_string()));

                    for line in text.lines() {
                        let line = line.trim();
                        if line.is_empty() || !line.starts_with("data: ") {
                            continue;
                        }

                        let data = line.trim_start_matches("data: ").trim();
                        if data == "[DONE]" {
                            continue;
                        }

                        if let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(data) {
                            result = Ok(chunk);
                            break;
                        }
                    }
                    result
                })
        });

        // Filter out errors that are just non-data lines
        let filtered_stream = sse_stream.filter(|res| match res {
            Err(AIError::ParseError(_)) => futures_util::future::ready(false),
            _ => futures_util::future::ready(true),
        });

        Ok(filtered_stream)
    }

    /// Test connection to AI service
    pub async fn test_connection(&self) -> Result<String, AIError> {
        let messages = vec![
            (
                "system".to_string(),
                "You are a helpful assistant.".to_string(),
            ),
            (
                "user".to_string(),
                "Say 'Connection successful!' if you can read this.".to_string(),
            ),
        ];

        let response = self.chat_completion(messages, None).await?;

        Ok(response.choices[0].message.content.clone())
    }
}
