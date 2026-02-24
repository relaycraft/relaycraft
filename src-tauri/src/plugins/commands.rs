use crate::config;
use crate::logging;
use crate::plugins::{config::PluginInfo, discover_plugins, PluginCache};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_plugins(app: AppHandle) -> Result<Vec<PluginInfo>, String> {
    let app_dir = config::get_data_dir()?;
    let plugins_dir = app_dir.join("plugins");

    let config = config::load_config().unwrap_or_default();
    let plugins = discover_plugins(&plugins_dir, &config.enabled_plugins);

    // Update cache
    let cache = app.state::<PluginCache>();
    let mut cached = cache.plugins.lock().unwrap();
    *cached = plugins.clone();

    Ok(plugins)
}

#[tauri::command]
pub async fn toggle_plugin(id: String, enabled: bool, _app: AppHandle) -> Result<(), String> {
    let mut config = config::load_config().unwrap_or_default();

    if enabled {
        if !config.enabled_plugins.contains(&id) {
            config.enabled_plugins.push(id.clone());
        }
    } else {
        config.enabled_plugins.retain(|x| x != &id);
    }

    config::save_config(config)?;

    log::info!("Toggling plugin {} to {}", id, enabled);
    let _ = logging::write_domain_log("audit", &format!("Toggled Plugin {}: {}", id, enabled));
    Ok(())
}

#[tauri::command]
pub async fn read_plugin_file(
    plugin_id: String,
    file_name: String,
    _app: AppHandle,
) -> Result<String, String> {
    let app_dir = config::get_data_dir()?;
    let plugins_dir = app_dir.join("plugins");

    // Use centralized resolution logic
    let plugin_path = crate::plugins::resolve_plugin_path(&plugins_dir, &plugin_id)
        .ok_or_else(|| format!("Plugin not found: {}", plugin_id))?;

    let file_path = plugin_path.join(file_name);

    if !file_path.exists() {
        return Err(format!("File not found: {:?}", file_path));
    }

    std::fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_plugin(id: String, _app: AppHandle) -> Result<(), String> {
    let app_dir = config::get_data_dir()?;
    let plugins_dir = app_dir.join("plugins");

    let plugin_dir = crate::plugins::resolve_plugin_path(&plugins_dir, &id)
        .ok_or_else(|| format!("Plugin not found: {}", id))?;

    // 1. Remove from config
    let mut config = config::load_config().unwrap_or_default();
    if config.enabled_plugins.contains(&id) {
        config.enabled_plugins.retain(|x| x != &id);
        config::save_config(config)?;
    }

    // 2. Remove directory
    if plugin_dir.exists() {
        std::fs::remove_dir_all(&plugin_dir)
            .map_err(|e| format!("Failed to remove plugin directory: {}", e))?;
    }

    log::info!("[Plugins] Uninstalled plugin: {}", id);
    let _ = logging::write_domain_log("audit", &format!("Uninstalled Plugin: {}", id));
    Ok(())
}
#[tauri::command]
pub async fn plugin_install_local_zip(path: String, _app: AppHandle) -> Result<String, String> {
    log::info!("[Plugins] Installing local zip from: {}", path);
    let zip_path = std::path::Path::new(&path);
    if !zip_path.exists() {
        return Err("File not found".to_string());
    }

    let app_root = config::get_app_root_dir()?;

    let id = crate::plugins::install_plugin_from_zip(zip_path, &app_root)?;

    let _ = logging::write_domain_log("audit", &format!("Installed Local Plugin/Theme: {}", id));

    Ok(id)
}

#[tauri::command]
pub async fn get_themes(
    _app: AppHandle,
) -> Result<Vec<crate::plugins::config::ThemeManifest>, String> {
    let themes_dir = config::get_themes_dir()?;
    Ok(crate::plugins::discover_themes(&themes_dir))
}

#[tauri::command]
pub async fn get_plugin_config(
    plugin_id: String,
    _app: AppHandle,
) -> Result<serde_json::Value, String> {
    let app_dir = config::get_data_dir()?;
    let plugins_dir = app_dir.join("plugins");
    let plugin_path = crate::plugins::resolve_plugin_path(&plugins_dir, &plugin_id)
        .ok_or_else(|| format!("Plugin not found: {}", plugin_id))?;

    let config_path = plugin_path.join("settings.json");

    if config_path.exists() {
        let content = std::fs::read_to_string(config_path).map_err(|e| e.to_string())?;
        let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(json)
    } else {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
pub async fn save_plugin_config(
    plugin_id: String,
    config: serde_json::Value,
    _app: AppHandle,
) -> Result<(), String> {
    let app_dir = config::get_data_dir()?;
    let plugins_dir = app_dir.join("plugins");
    let plugin_dir = crate::plugins::resolve_plugin_path(&plugins_dir, &plugin_id)
        .ok_or_else(|| format!("Plugin not found: {}", plugin_id))?;

    let config_path = plugin_dir.join("settings.json");
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;

    std::fs::write(config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn read_theme_file(
    theme_id: String,
    file_name: String,
    _app: AppHandle,
) -> Result<String, String> {
    // [SECURITY] 1. Extension Allowlist: Only allow reading CSS files
    if !file_name.to_lowercase().ends_with(".css") {
        log::warn!("[Security] Blocked access to non-CSS file: {}", file_name);
        return Err("Security Violation: Only .css files are allowed".to_string());
    }

    // [SECURITY] 2. Basic Path Sanitization: Prevent obvious directory traversal
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err("Security Violation: Invalid filename".to_string());
    }

    let themes_dir = config::get_themes_dir()?;

    // Resolve theme directory (name strictly matches ID)
    let theme_dir = themes_dir.join(&theme_id);

    // Verify theme directory exists
    if !theme_dir.exists() {
        return Err(format!("Theme not found: {}", theme_id));
    }

    let file_path = theme_dir.join(&file_name);

    // [SECURITY] 3. Canonical Path Traversal Prevention
    // Ensure the resolved file path is physically inside the theme directory
    let canonical_file = file_path
        .canonicalize()
        .map_err(|_| "File not found".to_string())?;
    let canonical_theme_root = theme_dir
        .canonicalize()
        .map_err(|_| "Invalid theme installation".to_string())?;

    if !canonical_file.starts_with(&canonical_theme_root) {
        log::warn!(
            "[Security] Path traversal attempt detected: {:?} -> {:?}",
            file_path,
            canonical_file
        );
        return Err("Security Violation: Access denied".to_string());
    }

    std::fs::read_to_string(canonical_file).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_theme(id: String, _app: AppHandle) -> Result<(), String> {
    // [SECURITY] Validate ID to prevent path traversal
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Security Violation: Invalid theme ID".to_string());
    }

    let themes_dir = config::get_themes_dir()?;
    let theme_dir = themes_dir.join(&id);

    if !theme_dir.exists() {
        return Err(format!("Theme not found: {}", id));
    }

    // [SECURITY] Double-check we are deleting a child of themes_dir
    if !theme_dir.starts_with(&themes_dir) {
        return Err("Security Violation: Invalid theme path".to_string());
    }

    std::fs::remove_dir_all(&theme_dir).map_err(|e| format!("Failed to remove theme: {}", e))?;

    log::info!("[Themes] Uninstalled theme: {}", id);
    let _ = logging::write_domain_log("audit", &format!("Uninstalled Theme: {}", id));
    Ok(())
}
