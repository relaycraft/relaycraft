use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::ai::config::AIConfig;
use crate::logging;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct UpstreamProxyConfig {
    pub enabled: bool,
    pub url: String,
    pub bypass_domains: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub ssl_insecure: bool,
    pub proxy_port: u16,
    #[serde(default)]
    pub verbose_logging: bool,
    #[serde(default)]
    pub ai_config: AIConfig,
    #[serde(default)]
    pub enabled_plugins: Vec<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub upstream_proxy: UpstreamProxyConfig,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default = "default_true")]
    pub confirm_exit: bool,
    #[serde(default)]
    pub auto_start_proxy: bool,
    #[serde(default = "default_density")]
    pub display_density: String,
    #[serde(default = "default_registry_url")]
    pub plugin_registry_url: String,
    #[serde(default = "default_theme_registry_url")]
    pub theme_registry_url: String,
    #[serde(default)]
    pub cert_warning_ignored: bool,
    #[serde(default = "default_true")]
    pub enable_vibrancy: bool,
}

fn default_registry_url() -> String {
    "https://raw.githubusercontent.com/relaycraft/relaycraft-plugins/main/plugins.json".to_string()
}

fn default_theme_registry_url() -> String {
    "https://raw.githubusercontent.com/relaycraft/relaycraft-themes/main/themes.json".to_string()
}

fn default_language() -> String {
    "zh".to_string()
}

fn default_true() -> bool {
    true
}

fn default_density() -> String {
    "comfortable".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            ssl_insecure: false,
            proxy_port: 9090,
            verbose_logging: false,
            ai_config: AIConfig::default(),
            enabled_plugins: Vec::new(),
            language: default_language(),
            upstream_proxy: UpstreamProxyConfig::default(),
            always_on_top: false,
            confirm_exit: true,
            auto_start_proxy: false,
            display_density: default_density(),
            plugin_registry_url: default_registry_url(),
            theme_registry_url: default_theme_registry_url(),
            cert_warning_ignored: false,
            enable_vibrancy: true,
        }
    }
}

/// Get the application root directory
pub fn get_app_root_dir() -> Result<PathBuf, String> {
    // Check for portable mode directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            if exe_dir.join("portable").exists() {
                return Ok(exe_dir.to_path_buf());
            }
        }
    }

    // In Debug mode, keep using the executable directory (Portable/Dev experience)
    if cfg!(debug_assertions) {
        let exe_path =
            std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
        let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;
        return Ok(exe_dir.to_path_buf());
    }

    // Standard platform-specific user data directories
    #[cfg(target_os = "linux")]
    {
        let home =
            std::env::var("HOME").map_err(|_| "Failed to resolve HOME variable".to_string())?;
        let path = PathBuf::from(home).join(".config").join("relaycraft");
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        Ok(path)
    }

    #[cfg(target_os = "macos")]
    {
        let home =
            std::env::var("HOME").map_err(|_| "Failed to resolve HOME variable".to_string())?;

        // Dev override suffix
        let app_folder = if std::env::var("RELAYCRAFT_DEV").is_ok()
            || std::env::var("TAURI_ENV")
                .map(|v| v == "dev")
                .unwrap_or(false)
        {
            "RelayCraft Dev"
        } else {
            "relaycraft"
        };

        let path = PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(app_folder);
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        Ok(path)
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let path = PathBuf::from(appdata).join("relaycraft");
            if !path.exists() {
                let _ = fs::create_dir_all(&path);
            }
            return Ok(path);
        }
        // Fallback to exe dir if APPDATA missing (unlikely)
        let exe_path =
            std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
        let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;
        Ok(exe_dir.to_path_buf())
    }

    // Fallback for other OS
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let exe_path =
            std::env::current_exe().map_err(|e| format!("Failed to get exe path: {}", e))?;
        let exe_dir = exe_path.parent().ok_or("Failed to get exe directory")?;
        Ok(exe_dir.to_path_buf())
    }
}

/// Get the configuration directory: config/
pub fn get_config_dir() -> Result<PathBuf, String> {
    let root = get_app_root_dir()?;
    let config_dir = root.join("config");

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    Ok(config_dir)
}

/// Get data directory: data/ (Legacy name but fits new structure)
/// Generally specialized modules should use get_app_root_dir().join("data").join("subdir")
pub fn get_data_dir() -> Result<PathBuf, String> {
    let root = get_app_root_dir()?;
    let data_dir = root.join("data");

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }
    Ok(data_dir)
}

/// Get themes directory: data/themes
pub fn get_themes_dir() -> Result<PathBuf, String> {
    let data_dir = get_data_dir()?;
    let themes_dir = data_dir.join("themes");

    if !themes_dir.exists() {
        fs::create_dir_all(&themes_dir)
            .map_err(|e| format!("Failed to create themes directory: {}", e))?;
    }
    Ok(themes_dir)
}

fn get_config_path() -> Result<PathBuf, String> {
    Ok(get_config_dir()?.join("config.json"))
}

#[tauri::command]
pub fn save_config(mut config: AppConfig) -> Result<(), String> {
    let config_path = get_config_path()?;

    // Load old config to detect changes
    let old_config = load_config().unwrap_or_default();

    // Sanitize sensitive data before serialization/saving
    config.ai_config.api_key = String::new();

    // Compare JSON representations to find changes
    let new_json =
        serde_json::to_value(&config).map_err(|e| format!("Failed to serialize config: {}", e))?;
    let old_json = serde_json::to_value(&AppConfig {
        ai_config: crate::ai::config::AIConfig {
            api_key: String::new(),
            ..old_config.ai_config.clone()
        },
        ..old_config.clone()
    })
    .map_err(|e| format!("Failed to serialize old config: {}", e))?;

    // Helper to format JSON value concisely
    fn format_value(v: &serde_json::Value) -> String {
        match v {
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => format!("\"{}\"", s),
            serde_json::Value::Array(arr) => format!("[{} items]", arr.len()),
            serde_json::Value::Object(obj) => format!("{{{}}}", obj.len()),
            serde_json::Value::Null => "null".to_string(),
        }
    }

    let mut changes: Vec<String> = Vec::new();
    if let (Some(new_obj), Some(old_obj)) = (new_json.as_object(), old_json.as_object()) {
        for (key, new_val) in new_obj {
            if let Some(old_val) = old_obj.get(key) {
                if new_val != old_val {
                    changes.push(format!(
                        "{}: {} -> {}",
                        key,
                        format_value(old_val),
                        format_value(new_val)
                    ));
                }
            }
        }
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    // Log changes to audit
    if changes.is_empty() {
        let _ =
            logging::write_domain_log("audit", "Updated Application Configuration (no changes)");
    } else {
        let _ = logging::write_domain_log(
            "audit",
            &format!("Updated Configuration: {}", changes.join(", ")),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    let config_path = get_config_path()?;

    if !config_path.exists() {
        return Ok(AppConfig::default());
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;

    // Direct parse as AppConfig
    match serde_json::from_str::<AppConfig>(&content) {
        Ok(config) => Ok(config),
        Err(e) => {
            log::warn!("Failed to parse config.json, using defaults: {}", e);
            Ok(AppConfig::default())
        }
    }
}

#[tauri::command]
pub fn open_config_dir() -> Result<(), String> {
    let path = get_config_dir()?;
    open_directory(path)
}

#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
    let path = get_data_dir()?;
    open_directory(path)
}

#[tauri::command]
pub fn open_logs_dir() -> Result<(), String> {
    let root = get_app_root_dir()?;
    let path = root.join("logs");
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    open_directory(path)
}

fn open_directory(path: std::path::PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.proxy_port, 9090);
        assert_eq!(config.language, "zh");
        assert!(config.confirm_exit);
        assert!(config.enable_vibrancy);
    }

    #[test]
    fn test_config_serialization() {
        let mut config = AppConfig::default();
        config.proxy_port = 8888;
        config.ai_config.api_key = "secret_key".to_string();

        // Simulate save_config behavior
        config.ai_config.api_key = String::new();

        let json = serde_json::to_string(&config).unwrap();
        let decoded: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.proxy_port, 8888);
        assert_eq!(decoded.ai_config.api_key, "");
    }
}
