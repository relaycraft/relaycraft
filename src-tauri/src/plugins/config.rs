use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub license: Option<String>,
    pub min_app_version: Option<String>,
    pub entry: Option<PluginEntry>, // Legacy support
    pub capabilities: Option<PluginCapabilities>,
    pub permissions: Option<Vec<String>>,
    pub settings_schema: Option<HashMap<String, serde_json::Value>>,
    pub locales: Option<HashMap<String, HashMap<String, String>>>,
    #[serde(default = "default_plugin_type")]
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCapabilities {
    pub ui: Option<PluginUICapability>,
    // Python capability often implies a script entry
    pub logic: Option<PluginLogicCapability>,
    pub i18n: Option<PluginI18nCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginUICapability {
    pub entry: String,
    pub settings_schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginLogicCapability {
    pub entry: String, // Python script path
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginI18nCapability {
    pub locales: HashMap<String, String>,
    pub namespace: Option<String>,
}

fn default_plugin_type() -> String {
    "plugin".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub r#type: String, // 'light' or 'dark'
    pub colors: HashMap<String, String>,
    pub css: Option<String>,
    pub path: Option<String>,
    pub monaco: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginEntry {
    pub ui: Option<String>,
    pub python: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub path: String,
    pub enabled: bool,
}
