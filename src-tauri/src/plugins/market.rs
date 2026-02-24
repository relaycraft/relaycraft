use crate::config::get_data_dir;
use crate::logging;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::command;

// Removed hardcoded REGISTRY_URL in favor of AppConfig.plugin_registry_url

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistryPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    // Market JSON has "url" for metadata and "downloadUrl" for the zip/rctheme

    // Metadata url
    pub url: Option<String>,

    // Actual package download url
    #[serde(alias = "downloadUrl", rename = "downloadUrl")]
    pub download_url: String,

    #[serde(alias = "download_count", rename = "downloadCount")]
    pub download_count: Option<u32>,
    #[serde(alias = "previewUrl", rename = "thumbnailUrl")]
    pub thumbnail_url: Option<String>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub locales: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistryIndex {
    pub version: String,
    pub plugins: Vec<RegistryPlugin>,
}

const REGISTRY_CACHE_DIR: &str = "market";

#[command]
pub async fn plugin_market_fetch(market_type: String) -> Result<RegistryIndex, String> {
    let config = crate::config::load_config().map_err(|e| e.to_string())?;

    // Determine URL and Cache File based on type
    let (registry_url, cache_filename) = if market_type == "theme" {
        (&config.theme_registry_url, "themes.json")
    } else {
        (&config.plugin_registry_url, "plugins.json")
    };

    let client = Client::new();
    let resp = client
        .get(registry_url)
        .header("User-Agent", "RelayCraft")
        .send()
        .await
        .map_err(|e| format!("Failed to request registry from {}: {}", registry_url, e))?;

    let index = resp
        .json::<RegistryIndex>()
        .await
        .map_err(|e| format!("Failed to parse registry JSON: {}", e))?;

    // Save to cache
    if let Ok(data_dir) = get_data_dir() {
        let market_dir = data_dir.join(REGISTRY_CACHE_DIR);
        if !market_dir.exists() {
            let _ = fs::create_dir_all(&market_dir);
        }
        let cache_path = market_dir.join(cache_filename);
        if let Ok(json) = serde_json::to_string_pretty(&index) {
            let _ = fs::write(cache_path, json);
        }
    }

    Ok(index)
}

#[command]
pub async fn plugin_market_load_cache(market_type: String) -> Result<RegistryIndex, String> {
    let data_dir = get_data_dir().map_err(|e| e.to_string())?;
    let cache_filename = if market_type == "theme" {
        "themes.json"
    } else {
        "plugins.json"
    };
    let cache_path = data_dir.join(REGISTRY_CACHE_DIR).join(cache_filename);

    if !cache_path.exists() {
        return Err("Cache not found".to_string());
    }

    let content = fs::read_to_string(cache_path).map_err(|e| e.to_string())?;
    let index = serde_json::from_str::<RegistryIndex>(&content).map_err(|e| e.to_string())?;

    Ok(index)
}

#[command]
pub async fn plugin_market_install(url: String) -> Result<String, String> {
    log::info!("[Market] Request to install from: {}", url);

    // 1. Download the plugin bundle (.rcplugin/.zip) to a temp file
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::USER_AGENT,
        reqwest::header::HeaderValue::from_static("RelayCraft"),
    );
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // Longer timeout for large files
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    log::info!("[Market] Downloading plugin bundle...");
    let resp = client
        .get(&url) // Frontend passes actual url string
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: {} from {}", resp.status(), url));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read body: {}", e))?;

    // Create temp file
    let temp_dir = std::env::temp_dir();
    let temp_file_path = temp_dir.join(format!("relaycraft_plugin_{}.zip", uuid::Uuid::new_v4()));

    fs::write(&temp_file_path, bytes).map_err(|e| format!("Failed to save temp file: {}", e))?;

    log::info!("[Market] Downloaded to {:?}", temp_file_path);

    // 2. Install using shared logic
    let app_root = crate::config::get_app_root_dir()?;
    let result = crate::plugins::install_plugin_from_zip(&temp_file_path, &app_root);

    // 3. Cleanup
    let _ = fs::remove_file(&temp_file_path);

    match result {
        Ok(id) => {
            let _ = logging::write_domain_log(
                "audit",
                &format!("Installed Plugin from Market: {}", id),
            );
            Ok(id)
        }
        Err(e) => Err(format!("Installation failed: {}", e)),
    }
}
