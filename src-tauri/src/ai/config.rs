use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIConfig {
    /// Whether AI features are enabled
    pub enabled: bool,

    /// Provider type: "openai", "custom"
    pub provider: String,

    /// Custom API endpoint (for local models)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_endpoint: Option<String>,

    /// API key (stored in keyring, not saved to config.json)
    #[serde(default)]
    pub api_key: String,

    /// Model name
    pub model: String,

    /// Maximum tokens for completion
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,

    /// Temperature (0.0 - 2.0)
    #[serde(default = "default_temperature")]
    pub temperature: f32,

    /// Enable response caching
    #[serde(default = "default_true")]
    pub enable_caching: bool,

    /// Maximum history messages for sliding window
    #[serde(default = "default_max_history_messages")]
    pub max_history_messages: u32,
}

fn default_max_tokens() -> u32 {
    4096
}
fn default_max_history_messages() -> u32 {
    10
}
fn default_temperature() -> f32 {
    0.7
}
fn default_true() -> bool {
    true
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: "openai".to_string(),
            custom_endpoint: None,
            api_key: String::new(),
            model: "gpt-4-turbo-preview".to_string(),
            max_tokens: 4096,
            temperature: 0.7,
            enable_caching: true,
            max_history_messages: 10,
        }
    }
}

impl AIConfig {
    /// Get the API endpoint based on provider
    pub fn get_endpoint(&self) -> String {
        // If custom endpoint is set, use it
        if let Some(endpoint) = &self.custom_endpoint {
            if !endpoint.is_empty() {
                return endpoint.clone();
            }
        }

        // Fallback defaults based on provider (for legacy/convenience)
        match self.provider.as_str() {
            "openai" => "https://api.openai.com/v1".to_string(),
            "openrouter" => "https://openrouter.ai/api/v1".to_string(),
            "deepseek" => "https://api.deepseek.com/v1".to_string(),
            "aliyun" => "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            "google" => "https://generativelanguage.googleapis.com/v1beta/openai".to_string(),
            "anthropic" => "https://api.anthropic.com/v1".to_string(),
            "moonshot" => "https://api.moonshot.cn/v1".to_string(),
            _ => "https://api.openai.com/v1".to_string(), // Final fallback
        }
    }

    /// Validate configuration
    pub fn validate(&self) -> Result<(), String> {
        // Validation is relaxed - allow saving even without API key
        // API key will be checked when actually using AI features
        Ok(())
    }
}
