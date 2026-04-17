use super::config::AIConfig;
use super::error::AIError;
use crate::logging;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::pin::Pin;

type ChatChunkStream = Pin<Box<dyn futures_util::Stream<Item = Result<ChatCompletionChunk, AIError>> + Send>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDefinition,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum ToolChoice {
    Mode(String),
    Function(ToolChoiceFunctionChoice),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolChoiceFunctionChoice {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: ToolChoiceFunction,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolChoiceFunction {
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StreamingToolCall {
    pub index: usize,
    pub id: Option<String>,
    pub function: Option<StreamingFunctionCall>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StreamingFunctionCall {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Tool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<ToolChoice>,
}

fn drain_sse_events(buffer: &mut String) -> Vec<String> {
    let mut events = Vec::new();
    while let Some(idx) = buffer.find("\n\n") {
        let event = buffer[..idx].to_string();
        buffer.drain(..idx + 2);
        events.push(event);
    }
    events
}

fn parse_sse_event(event: &str) -> Result<Option<ChatCompletionChunk>, AIError> {
    let mut data_lines = Vec::new();
    for line in event.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(data) = trimmed.strip_prefix("data:") {
            let payload = data.trim_start();
            if payload == "[DONE]" {
                return Ok(None);
            }
            data_lines.push(payload);
        }
    }

    if data_lines.is_empty() {
        return Ok(None);
    }

    let payload = data_lines.join("\n");
    serde_json::from_str::<ChatCompletionChunk>(&payload).map(Some).map_err(|e| {
        log::debug!("Failed to parse SSE event payload: {}", payload);
        AIError::ParseError(format!("Failed to parse SSE event: {}", e))
    })
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ChatCompletionResponse {
    pub choices: Vec<Choice>,
    pub usage: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct Choice {
    pub message: ResponseMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ResponseMessage {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct Usage {
    pub prompt_tokens: Option<serde_json::Value>,
    pub completion_tokens: Option<serde_json::Value>,
    pub total_tokens: Option<serde_json::Value>,
}

fn value_to_u32(value: &serde_json::Value) -> Option<u32> {
    match value {
        serde_json::Value::Number(num) => {
            if let Some(v) = num.as_u64() {
                return u32::try_from(v).ok();
            }
            num.as_f64().and_then(|v| {
                if v.is_finite() && v >= 0.0 {
                    u32::try_from(v.round() as u64).ok()
                } else {
                    None
                }
            })
        }
        serde_json::Value::String(s) => s.parse::<u32>().ok(),
        _ => None,
    }
}

fn usage_tokens_from_response(
    raw_usage: Option<&serde_json::Value>,
    approx_prompt_tokens: u32,
    approx_completion_tokens: u32,
) -> (u32, u32, u32, &'static str) {
    let Some(raw_usage) = raw_usage else {
        let total = approx_prompt_tokens.saturating_add(approx_completion_tokens);
        return (
            approx_prompt_tokens,
            approx_completion_tokens,
            total,
            "estimated_chars_div_4",
        );
    };

    let raw = serde_json::from_value::<Usage>(raw_usage.clone()).ok();
    let prompt = raw
        .as_ref()
        .and_then(|u| u.prompt_tokens.as_ref())
        .and_then(value_to_u32)
        .or_else(|| raw_usage.get("input_tokens").and_then(value_to_u32));
    let completion = raw
        .as_ref()
        .and_then(|u| u.completion_tokens.as_ref())
        .and_then(value_to_u32)
        .or_else(|| raw_usage.get("output_tokens").and_then(value_to_u32));
    let total = raw
        .as_ref()
        .and_then(|u| u.total_tokens.as_ref())
        .and_then(value_to_u32);

    let prompt_tokens = prompt.unwrap_or(approx_prompt_tokens);
    let completion_tokens = completion.unwrap_or(approx_completion_tokens);
    let total_tokens = total.unwrap_or(prompt_tokens.saturating_add(completion_tokens));
    let usage_source = if prompt.is_some() && completion.is_some() && total.is_some() {
        "response"
    } else {
        "response_partial_fallback"
    };

    (prompt_tokens, completion_tokens, total_tokens, usage_source)
}

fn estimate_output_tokens(response: &ChatCompletionResponse) -> u32 {
    let output_chars: usize = response
        .choices
        .iter()
        .map(|choice| {
            let content_chars = choice.message.content.as_ref().map(|s| s.len()).unwrap_or(0);
            let tool_chars = choice
                .message
                .tool_calls
                .as_ref()
                .map(|calls| {
                    calls
                        .iter()
                        .map(|call| call.id.len() + call.function.name.len() + call.function.arguments.len())
                        .sum::<usize>()
                })
                .unwrap_or(0);
            content_chars + tool_chars
        })
        .sum();

    u32::try_from(output_chars / 4).unwrap_or(u32::MAX)
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
    pub tool_calls: Option<Vec<StreamingToolCall>>,
}

pub struct AIClient {
    client: Client,
    config: AIConfig,
}

impl AIClient {
    pub fn new(config: AIConfig) -> Self {
        // Use longer timeout for reasoning models that may take a while to respond
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120)) // 2 minutes total timeout
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client, config }
    }

    fn resolve_temperature(&self, temp_override: Option<f32>) -> f32 {
        let model_name = self.config.model.to_lowercase();
        let is_reasoning = model_name.contains("o1")
            || model_name.contains("o3")
            || model_name.contains("reasoner")
            || model_name.contains("k2.5");

        if is_reasoning {
            1.0
        } else {
            temp_override.unwrap_or(self.config.temperature)
        }
    }

    async fn do_chat_completion(
        &self,
        messages: Vec<ChatMessage>,
        tools: Option<Vec<Tool>>,
        tool_choice: Option<ToolChoice>,
        temp_override: Option<f32>,
    ) -> Result<ChatCompletionResponse, AIError> {
        let base_endpoint = self.config.get_endpoint();
        let base_endpoint = base_endpoint.trim_end_matches('/');
        let endpoint = format!("{}/chat/completions", base_endpoint);
        let temperature = self.resolve_temperature(temp_override);

        let request = ChatCompletionRequest {
            model: self.config.model.clone(),
            messages: messages.clone(),
            temperature,
            max_tokens: self.config.max_tokens,
            stream: false,
            tools: tools.clone(),
            tool_choice: tool_choice.clone(),
        };

        // Calculate approximate token count for audit logging
        let message_chars: usize = messages
            .iter()
            .map(|m| m.content.as_ref().map(|v| v.len()).unwrap_or(0))
            .sum();
        let approx_input_tokens = message_chars / 4; // Rough estimate: ~4 chars per token

        // Audit log: endpoint and token info
        let _ = logging::write_domain_log(
            "audit",
            &format!(
                "AI Request: endpoint={}, model={}, max_tokens={}, approx_input_tokens={}, tools_enabled={}",
                endpoint,
                self.config.model,
                self.config.max_tokens,
                approx_input_tokens,
                tools.is_some()
            ),
        );

        // Debug log: full request details (only when verbose logging is enabled)
        log::debug!(
            "AI Request Details: endpoint={}, model={}, temperature={}, max_tokens={}, messages_count={}",
            endpoint, self.config.model, temperature, self.config.max_tokens, messages.len()
        );
        for (idx, msg) in messages.iter().enumerate() {
            let content_length = msg.content.as_ref().map(|v| v.len()).unwrap_or(0);
            log::debug!(
                "  Message[{}]: role={}, content_length={}",
                idx, msg.role, content_length
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
        let response_body = response
            .json::<ChatCompletionResponse>()
            .await
            .map_err(|e| {
                log::error!("AI Parse Error: {}", e);
                AIError::ParseError(e.to_string())
            })?;

        let approx_prompt_tokens = u32::try_from(approx_input_tokens).unwrap_or(u32::MAX);
        let approx_completion_tokens = estimate_output_tokens(&response_body);
        let (prompt_tokens, completion_tokens, total_tokens, usage_source) = usage_tokens_from_response(
            response_body.usage.as_ref(),
            approx_prompt_tokens,
            approx_completion_tokens,
        );
        let _ = logging::write_domain_log(
            "audit",
            &format!(
                "AI Usage: endpoint={}, model={}, prompt_tokens={}, completion_tokens={}, total_tokens={}, usage_source={}",
                endpoint, self.config.model, prompt_tokens, completion_tokens, total_tokens, usage_source
            ),
        );

        Ok(response_body)
    }

    /// Generic chat completion
    pub async fn chat_completion(
        &self,
        messages: Vec<(String, String)>, // (role, content)
        temp_override: Option<f32>,
    ) -> Result<ChatCompletionResponse, AIError> {
        let chat_messages: Vec<ChatMessage> = messages
            .into_iter()
            .map(|(role, content)| ChatMessage {
                role,
                content: Some(content),
                name: None,
                tool_call_id: None,
            })
            .collect();

        self.do_chat_completion(chat_messages, None, None, temp_override)
            .await
    }

    pub async fn chat_completion_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<Tool>,
        tool_choice: Option<ToolChoice>,
        temp_override: Option<f32>,
    ) -> Result<ChatCompletionResponse, AIError> {
        self.do_chat_completion(messages, Some(tools), tool_choice, temp_override)
            .await
    }

    async fn do_chat_completion_stream(
        &self,
        messages: Vec<ChatMessage>,
        tools: Option<Vec<Tool>>,
        tool_choice: Option<ToolChoice>,
        temp_override: Option<f32>,
    ) -> Result<ChatChunkStream, AIError> {
        let base_endpoint = self.config.get_endpoint();
        let base_endpoint = base_endpoint.trim_end_matches('/');
        let endpoint = format!("{}/chat/completions", base_endpoint);
        let temperature = self.resolve_temperature(temp_override);

        // Calculate approximate token count for audit logging
        let message_chars: usize = messages
            .iter()
            .map(|m| m.content.as_ref().map(|v| v.len()).unwrap_or(0))
            .sum();
        let approx_input_tokens = message_chars / 4; // Rough estimate: ~4 chars per token

        // Audit log: endpoint and token info
        let _ = logging::write_domain_log(
            "audit",
            &format!(
                "AI Stream Request: endpoint={}, model={}, max_tokens={}, approx_input_tokens={}, tools_enabled={}",
                endpoint,
                self.config.model,
                self.config.max_tokens,
                approx_input_tokens,
                tools.is_some()
            ),
        );

        // Debug log: full request details (only when verbose logging is enabled)
        log::debug!(
            "AI Stream Request Details: endpoint={}, model={}, temperature={}, max_tokens={}, messages_count={}",
            endpoint, self.config.model, temperature, self.config.max_tokens, messages.len()
        );
        for (idx, msg) in messages.iter().enumerate() {
            let content_length = msg.content.as_ref().map(|v| v.len()).unwrap_or(0);
            log::debug!(
                "  Message[{}]: role={}, content_length={}",
                idx, msg.role, content_length
            );
        }

        let request = ChatCompletionRequest {
            model: self.config.model.clone(),
            messages,
            temperature,
            max_tokens: self.config.max_tokens,
            stream: true,
            tools,
            tool_choice,
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
        let parsed_stream = futures_util::stream::try_unfold(
            (stream, String::new(), VecDeque::<ChatCompletionChunk>::new()),
            |(mut stream, mut pending, mut queued)| async move {
                loop {
                    if let Some(chunk) = queued.pop_front() {
                        return Ok(Some((chunk, (stream, pending, queued))));
                    }

                    match stream.next().await {
                        Some(Ok(bytes)) => {
                            let text = String::from_utf8_lossy(&bytes)
                                .replace("\r\n", "\n")
                                .replace('\r', "\n");
                            pending.push_str(&text);

                            let events = drain_sse_events(&mut pending);
                            for event in events {
                                if let Some(parsed) = parse_sse_event(&event)? {
                                    queued.push_back(parsed);
                                }
                            }
                        }
                        Some(Err(e)) => {
                            log::error!("AI Stream bytes error: {}", e);
                            return Err(AIError::NetworkError(e.to_string()));
                        }
                        None => {
                            if !pending.trim().is_empty() {
                                if let Some(parsed) = parse_sse_event(&pending)? {
                                    queued.push_back(parsed);
                                }
                                pending.clear();
                                continue;
                            }
                            return Ok(None);
                        }
                    }
                }
            },
        );

        Ok(Box::pin(parsed_stream))
    }

    #[allow(dead_code)]
    pub async fn chat_completion_stream(
        &self,
        messages: Vec<(String, String)>,
        temp_override: Option<f32>,
    ) -> Result<ChatChunkStream, AIError> {
        let chat_messages: Vec<ChatMessage> = messages
            .into_iter()
            .map(|(role, content)| ChatMessage {
                role,
                content: Some(content),
                name: None,
                tool_call_id: None,
            })
            .collect();

        self.do_chat_completion_stream(chat_messages, None, None, temp_override)
            .await
    }

    pub async fn chat_completion_stream_with_tools(
        &self,
        messages: Vec<ChatMessage>,
        tools: Option<Vec<Tool>>,
        tool_choice: Option<ToolChoice>,
        temp_override: Option<f32>,
    ) -> Result<ChatChunkStream, AIError> {
        self.do_chat_completion_stream(messages, tools, tool_choice, temp_override)
            .await
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

        Ok(response.choices[0]
            .message
            .content
            .clone()
            .unwrap_or_default())
    }

    pub async fn test_stream_connection(&self) -> Result<String, AIError> {
        let messages = vec![(
            "user".to_string(),
            "Reply with exactly: stream ok".to_string(),
        )];

        let mut stream = self.chat_completion_stream(messages, None).await?;
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            let content = chunk
                .choices
                .first()
                .and_then(|choice| choice.delta.content.clone());
            if let Some(content) = content {
                if !content.trim().is_empty() {
                    return Ok(content);
                }
            }
        }

        Err(AIError::ParseError(
            "Stream ended without content chunk".to_string(),
        ))
    }

    pub async fn test_tools_connection(&self) -> Result<String, AIError> {
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: Some("Please call the tool once, then stop.".to_string()),
            name: None,
            tool_call_id: None,
        }];
        let tools = vec![Tool {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "ping".to_string(),
                description: "Connectivity probe tool".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "echo": { "type": "string" }
                    },
                    "required": ["echo"]
                }),
            },
        }];

        let response = self
            .chat_completion_with_tools(
                messages,
                tools,
                Some(ToolChoice::Mode("auto".to_string())),
                None,
            )
            .await?;

        extract_tools_probe_result(&response)
    }

}

fn extract_tools_probe_result(response: &ChatCompletionResponse) -> Result<String, AIError> {
    let choice = response
        .choices
        .first()
        .ok_or_else(|| AIError::ParseError("AI returned empty choices".to_string()))?;

    if let Some(tool_calls) = &choice.message.tool_calls {
        if let Some(tool_call) = tool_calls.first() {
            return Ok(format!("tool_call: {}", tool_call.function.name));
        }
    }

    let content = choice.message.content.clone().unwrap_or_default();
    Err(AIError::ParseError(format!(
        "Tools probe did not return tool_calls. assistant_content={}",
        content
    )))
}

#[cfg(test)]
mod tests {
    use super::{
        drain_sse_events, estimate_output_tokens, extract_tools_probe_result, parse_sse_event,
        usage_tokens_from_response, ChatCompletionRequest, ChatCompletionResponse, ChatMessage,
        Choice, FunctionCall, ResponseMessage, ToolCall, ToolChoice,
    };

    #[test]
    fn serializes_auto_tool_choice_as_string() {
        let request = ChatCompletionRequest {
            model: "gpt-4o-mini".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: Some("hello".to_string()),
                name: None,
                tool_call_id: None,
            }],
            temperature: 0.0,
            max_tokens: 256,
            stream: false,
            tools: None,
            tool_choice: Some(ToolChoice::Mode("auto".to_string())),
        };

        let serialized = serde_json::to_string(&request).expect("request should serialize");
        assert!(serialized.contains(r#""tool_choice":"auto""#));
    }

    #[test]
    fn drains_multiple_sse_events_from_single_chunk() {
        let mut buffer = "data: {\"choices\":[{\"delta\":{\"content\":\"A\",\"tool_calls\":null},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"B\",\"tool_calls\":null},\"finish_reason\":null}]}\n\n".to_string();
        let events = drain_sse_events(&mut buffer);
        assert_eq!(events.len(), 2);
        assert!(buffer.is_empty());
    }

    #[test]
    fn parses_sse_event_payload() {
        let event =
            "data: {\"choices\":[{\"delta\":{\"content\":\"hello\",\"tool_calls\":null},\"finish_reason\":null}]}";
        let parsed = parse_sse_event(event)
            .expect("event parse should succeed")
            .expect("chunk should exist");
        assert_eq!(parsed.choices.len(), 1);
        assert_eq!(parsed.choices[0].delta.content.as_deref(), Some("hello"));
    }

    #[test]
    fn tools_probe_requires_tool_calls() {
        let response = ChatCompletionResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    role: "assistant".to_string(),
                    content: Some("I cannot call tools here".to_string()),
                    tool_calls: None,
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: None,
        };

        let result = extract_tools_probe_result(&response);
        assert!(result.is_err());
    }

    #[test]
    fn tools_probe_succeeds_with_tool_calls() {
        let response = ChatCompletionResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    role: "assistant".to_string(),
                    content: None,
                    tool_calls: Some(vec![ToolCall {
                        id: "call_1".to_string(),
                        tool_type: "function".to_string(),
                        function: FunctionCall {
                            name: "ping".to_string(),
                            arguments: "{\"echo\":\"ok\"}".to_string(),
                        },
                    }]),
                },
                finish_reason: Some("tool_calls".to_string()),
            }],
            usage: None,
        };

        let result = extract_tools_probe_result(&response).expect("tools probe should succeed");
        assert_eq!(result, "tool_call: ping");
    }

    #[test]
    fn usage_prefers_response_usage_when_complete() {
        let usage = serde_json::json!({
            "prompt_tokens": 120,
            "completion_tokens": 45,
            "total_tokens": 165
        });
        let (prompt, completion, total, source) = usage_tokens_from_response(Some(&usage), 10, 3);
        assert_eq!(prompt, 120);
        assert_eq!(completion, 45);
        assert_eq!(total, 165);
        assert_eq!(source, "response");
    }

    #[test]
    fn usage_fallback_estimates_when_usage_missing() {
        let response = ChatCompletionResponse {
            choices: vec![Choice {
                message: ResponseMessage {
                    role: "assistant".to_string(),
                    content: Some("hello world".to_string()),
                    tool_calls: None,
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: None,
        };
        let approx_completion = estimate_output_tokens(&response);
        let (prompt, completion, total, source) =
            usage_tokens_from_response(response.usage.as_ref(), 9, approx_completion);
        assert_eq!(prompt, 9);
        assert_eq!(completion, approx_completion);
        assert_eq!(total, prompt + completion);
        assert_eq!(source, "estimated_chars_div_4");
    }
}
