use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCapabilities {
    pub chat: bool,
    pub stream: bool,
    pub tools: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIProviderProfile {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub adapter_mode: String,
    pub base_url: String,
    pub default_model: String,
    pub support_level: String,
    pub capabilities: ProfileCapabilities,
}

pub fn default_profiles() -> Vec<AIProviderProfile> {
    vec![
        AIProviderProfile {
            id: "openai-default".to_string(),
            provider_id: "openai".to_string(),
            label: "OpenAI".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            default_model: "gpt-5-mini".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "openrouter-default".to_string(),
            provider_id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            default_model: "google/gemini-3-flash-preview".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "deepseek-default".to_string(),
            provider_id: "deepseek".to_string(),
            label: "DeepSeek".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            default_model: "deepseek-chat".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "siliconflow-default".to_string(),
            provider_id: "siliconflow".to_string(),
            label: "SiliconFlow".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.siliconflow.cn/v1".to_string(),
            default_model: "Qwen/Qwen2.5-7B-Instruct".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "groq-default".to_string(),
            provider_id: "groq".to_string(),
            label: "Groq".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.groq.com/openai/v1".to_string(),
            default_model: "llama-3.3-70b-versatile".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "aliyun-default".to_string(),
            provider_id: "aliyun".to_string(),
            label: "Alibaba China".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            default_model: "qwen3.6-plus".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "aliyun-global".to_string(),
            provider_id: "aliyun".to_string(),
            label: "Alibaba Global".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".to_string(),
            default_model: "qwen3.6-plus".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "moonshot-cn".to_string(),
            provider_id: "moonshot".to_string(),
            label: "Moonshot China".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.moonshot.cn/v1".to_string(),
            default_model: "kimi-k2.5".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "moonshot-global".to_string(),
            provider_id: "moonshot".to_string(),
            label: "Moonshot Global".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.moonshot.ai/v1".to_string(),
            default_model: "kimi-k2.5".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "minimax-cn".to_string(),
            provider_id: "minimax".to_string(),
            label: "MiniMax China".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.minimaxi.com/v1".to_string(),
            default_model: "MiniMax-M2.7".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "minimax-global".to_string(),
            provider_id: "minimax".to_string(),
            label: "MiniMax Global".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.minimax.io/v1".to_string(),
            default_model: "MiniMax-M2.7".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "zhipu-cn".to_string(),
            provider_id: "zhipu".to_string(),
            label: "Zhipu China".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            default_model: "glm-5.1".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
        AIProviderProfile {
            id: "zhipu-global".to_string(),
            provider_id: "zhipu".to_string(),
            label: "Zhipu Global".to_string(),
            adapter_mode: "openai_compatible".to_string(),
            base_url: "https://api.z.ai/api/paas/v4".to_string(),
            default_model: "glm-5.1".to_string(),
            support_level: "verified".to_string(),
            capabilities: ProfileCapabilities {
                chat: true,
                stream: true,
                tools: true,
            },
        },
    ]
}

pub fn get_profile(profile_id: &str) -> Option<AIProviderProfile> {
    default_profiles()
        .into_iter()
        .find(|profile| profile.id == profile_id)
}

pub fn profile_belongs_to_provider(profile_id: &str, provider_id: &str) -> bool {
    get_profile(profile_id)
        .map(|profile| profile.provider_id == provider_id)
        .unwrap_or(false)
}

pub fn default_profile_for_provider(provider_id: &str) -> Option<AIProviderProfile> {
    let profiles = default_profiles();

    profiles
        .iter()
        .find(|profile| profile.provider_id == provider_id && profile.id.ends_with("-default"))
        .cloned()
        .or_else(|| {
            profiles
                .into_iter()
                .find(|profile| profile.provider_id == provider_id)
        })
}
