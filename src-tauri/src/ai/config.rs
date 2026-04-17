use serde::{Deserialize, Serialize};
use super::profiles;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIConfig {
    /// Whether AI features are enabled
    pub enabled: bool,

    /// Provider type: "openai", "custom"
    pub provider: String,

    /// Provider profile id (new path for profile-based config)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,

    /// Adapter mode (e.g. openai_compatible)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_mode: Option<String>,

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
            profile_id: Some("openai-default".to_string()),
            adapter_mode: Some("openai_compatible".to_string()),
            custom_endpoint: None,
            api_key: String::new(),
            model: "gpt-5-mini".to_string(),
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

        if let Some(profile_id) = &self.profile_id {
            if let Some(profile) = profiles::get_profile(profile_id) {
                if profile.provider_id == self.provider {
                    return profile.base_url;
                }
                log::warn!(
                    "AI profile/provider mismatch in endpoint resolution: provider={}, profile_id={}, profile_provider={}. Falling back to provider endpoint.",
                    self.provider,
                    profile_id,
                    profile.provider_id
                );
            }
        }

        // Fallback defaults based on provider (for legacy/convenience)
        match self.provider.as_str() {
            "openai" => "https://api.openai.com/v1".to_string(),
            "openrouter" => "https://openrouter.ai/api/v1".to_string(),
            "deepseek" => "https://api.deepseek.com/v1".to_string(),
            "siliconflow" => "https://api.siliconflow.cn/v1".to_string(),
            "groq" => "https://api.groq.com/openai/v1".to_string(),
            "aliyun" => "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            "moonshot" => "https://api.moonshot.cn/v1".to_string(),
            "minimax" => "https://api.minimax.io/v1".to_string(),
            "zhipu" => "https://open.bigmodel.cn/api/paas/v4".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AIConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.provider, "openai");
        assert_eq!(config.profile_id.as_deref(), Some("openai-default"));
        assert_eq!(config.model, "gpt-5-mini");
        assert_eq!(config.max_tokens, 4096);
        assert!(config.enable_caching);
    }

    #[test]
    fn test_get_endpoint_with_custom() {
        let mut config = AIConfig::default();
        config.profile_id = None;
        config.custom_endpoint = Some("https://my-custom-ai.dev/v1".to_string());
        
        assert_eq!(config.get_endpoint(), "https://my-custom-ai.dev/v1");
        
        // Empty custom string should fallback
        config.custom_endpoint = Some("".to_string());
        assert_eq!(config.get_endpoint(), "https://api.openai.com/v1");
    }

    #[test]
    fn test_get_endpoint_with_profile() {
        let mut config = AIConfig::default();
        config.provider = "zhipu".to_string();
        config.custom_endpoint = None;
        config.profile_id = Some("zhipu-cn".to_string());
        assert_eq!(config.get_endpoint(), "https://open.bigmodel.cn/api/paas/v4");
    }

    #[test]
    fn test_get_endpoint_ignores_mismatched_profile_provider() {
        let mut config = AIConfig::default();
        config.provider = "groq".to_string();
        config.custom_endpoint = None;
        config.profile_id = Some("zhipu-cn".to_string());
        assert_eq!(config.get_endpoint(), "https://api.groq.com/openai/v1");
    }

    #[test]
    fn test_get_endpoint_provider_fallbacks() {
        let mut config = AIConfig::default();
        config.custom_endpoint = None; // Ensure fallback path
        config.profile_id = None;

        let cases = vec![
            ("openai", "https://api.openai.com/v1"),
            ("openrouter", "https://openrouter.ai/api/v1"),
            ("deepseek", "https://api.deepseek.com/v1"),
            ("siliconflow", "https://api.siliconflow.cn/v1"),
            ("groq", "https://api.groq.com/openai/v1"),
            ("aliyun", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
            ("moonshot", "https://api.moonshot.cn/v1"),
            ("minimax", "https://api.minimax.io/v1"),
            ("zhipu", "https://open.bigmodel.cn/api/paas/v4"),
            ("unknown_provider", "https://api.openai.com/v1"), // fallback
        ];

        for (provider, expected) in cases {
            config.provider = provider.to_string();
            assert_eq!(
                config.get_endpoint(),
                expected,
                "Failed for provider: {}",
                provider
            );
        }
    }
}
