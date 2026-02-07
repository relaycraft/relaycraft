pub mod bridge;
pub mod commands;
pub mod config;
pub mod market;

use crate::plugins::config::PluginInfo;
use std::fs;
use std::path::{Path, PathBuf};

pub fn discover_plugins(plugins_dir: &Path, enabled_ids: &[String]) -> Vec<PluginInfo> {
    let mut plugins = Vec::new();

    if !plugins_dir.exists() {
        log::info!("[Plugins] Dir does not exist: {:?}", plugins_dir);
        let _ = fs::create_dir_all(plugins_dir);
        return plugins;
    }

    log::debug!("[Plugins] Discovering in: {:?}", plugins_dir);
    if let Ok(entries) = fs::read_dir(plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                log::debug!("[Plugins] Found directory: {:?}", path);
                if let Some(mut plugin) = load_plugin(&path) {
                    log::debug!("[Plugins] Loaded manifest for: {}", plugin.manifest.id);
                    plugin.enabled = enabled_ids.contains(&plugin.manifest.id);
                    plugins.push(plugin);
                } else {
                    log::warn!("[Plugins] Failed to load plugin at: {:?}", path);
                }
            }
        }
    }

    plugins
}

/// Resolves a plugin ID to its absolute directory path.
/// Handles cases where the folder name might differ from the manifest ID.
pub fn resolve_plugin_path(plugins_dir: &Path, plugin_id: &str) -> Option<PathBuf> {
    // 1. Fast path: Direct folder name match
    let direct_path = plugins_dir.join(plugin_id);
    if direct_path.exists() && direct_path.is_dir() {
        return Some(direct_path);
    }

    // 2. Slow path: Search all folders for matching ID in manifest
    if let Ok(entries) = fs::read_dir(plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(plugin) = load_plugin(&path) {
                    if plugin.manifest.id == plugin_id {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

fn load_plugin(path: &Path) -> Option<PluginInfo> {
    let yaml_path = path.join("plugin.yaml");
    let yml_path = path.join("plugin.yml");
    let json_path = path.join("plugin.json");

    let (manifest_path, is_yaml) = if yaml_path.exists() {
        (yaml_path, true)
    } else if yml_path.exists() {
        (yml_path, true)
    } else if json_path.exists() {
        (json_path, false)
    } else {
        log::debug!("[Plugins] Skipping {:?}: no plugin.yaml/json", path);
        return None;
    };

    let content = fs::read_to_string(&manifest_path).ok()?;
    let manifest: crate::plugins::config::PluginManifest = if is_yaml {
        match serde_yaml::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                log::error!(
                    "[Plugins] Failed to parse plugin YAML at {:?}: {}",
                    manifest_path,
                    e
                );
                return None;
            }
        }
    } else {
        match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                log::error!(
                    "[Plugins] Failed to parse plugin JSON at {:?}: {}",
                    manifest_path,
                    e
                );
                return None;
            }
        }
    };

    Some(PluginInfo {
        manifest,
        path: path.to_string_lossy().to_string(),
        enabled: false,
    })
}

pub fn discover_themes(themes_dir: &Path) -> Vec<crate::plugins::config::ThemeManifest> {
    let mut themes = Vec::new();

    if !themes_dir.exists() {
        let _ = fs::create_dir_all(themes_dir);
        return themes;
    }

    if let Ok(entries) = fs::read_dir(themes_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(theme) = load_theme(&path) {
                    themes.push(theme);
                }
            }
        }
    }

    themes
}

fn load_theme(path: &Path) -> Option<crate::plugins::config::ThemeManifest> {
    let yaml_path = path.join("theme.yaml");
    let yml_path = path.join("theme.yml");

    let path_to_load = if yaml_path.exists() {
        yaml_path
    } else if yml_path.exists() {
        yml_path
    } else {
        return None;
    };

    let content = fs::read_to_string(&path_to_load).ok()?;
    match serde_yaml::from_str::<crate::plugins::config::ThemeManifest>(&content) {
        Ok(mut t) => {
            t.path = Some(path.to_string_lossy().to_string());
            Some(t)
        }
        Err(e) => {
            log::error!(
                "[Themes] Failed to parse theme at {:?}: {}",
                path_to_load,
                e
            );
            None
        }
    }
}

pub fn get_enabled_plugin_scripts(plugins_dir: &Path, enabled_ids: &[String]) -> Vec<PathBuf> {
    let mut scripts = Vec::new();
    let plugins = discover_plugins(plugins_dir, enabled_ids);

    for plugin in plugins {
        if plugin.enabled {
            // Check new capabilities style first
            if let Some(caps) = &plugin.manifest.capabilities {
                if let Some(logic) = &caps.logic {
                    let script_path = Path::new(&plugin.path).join(&logic.entry);
                    if script_path.exists() {
                        scripts.push(script_path);
                        continue; // Logic found, move to next plugin
                    }
                }
            }

            // Fallback to legacy entry style
            if let Some(entry) = &plugin.manifest.entry {
                if let Some(python_entry) = &entry.python {
                    let script_path = Path::new(&plugin.path).join(python_entry);
                    if script_path.exists() {
                        scripts.push(script_path);
                    }
                }
            }
        }
    }

    scripts
}

/// Unzips a .rcplugin or .zip file and installs it as a plugin or theme.
/// Returns the installed ID.
pub fn install_plugin_from_zip(zip_path: &Path, app_dir: &Path) -> Result<String, String> {
    // 1. Open zip
    let file = fs::File::open(zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip archive: {}", e))?;

    // 2. We need to find manifest to know the ID and type
    let mut plugin_manifest_content = String::new();
    let mut theme_manifest_content = String::new();
    let mut is_theme = false;
    let mut is_yaml_plugin = false;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        if file.name().ends_with("plugin.json") {
            use std::io::Read;
            if file.size() > 1024 * 1024 {
                return Err("plugin.json is too large".to_string());
            }
            file.read_to_string(&mut plugin_manifest_content)
                .map_err(|e| e.to_string())?;
        } else if file.name().ends_with("plugin.yaml") || file.name().ends_with("plugin.yml") {
            use std::io::Read;
            if file.size() > 1024 * 1024 {
                return Err("plugin.yaml is too large".to_string());
            }
            file.read_to_string(&mut plugin_manifest_content)
                .map_err(|e| e.to_string())?;
            is_yaml_plugin = true;
        } else if file.name().ends_with("theme.yaml") || file.name().ends_with("theme.yml") {
            use std::io::Read;
            if file.size() > 1024 * 1024 {
                return Err("theme manifest is too large".to_string());
            }
            file.read_to_string(&mut theme_manifest_content)
                .map_err(|e| e.to_string())?;
            is_theme = true;
        }
    }

    let (id, target_root) = if is_theme {
        let manifest: crate::plugins::config::ThemeManifest =
            serde_yaml::from_str(&theme_manifest_content)
                .map_err(|e| format!("Invalid theme manifest: {}", e))?;
        (manifest.id, app_dir.join("data").join("themes"))
    } else {
        if plugin_manifest_content.is_empty() {
            return Err("Plugin zip must contain plugin.json or plugin.yaml".to_string());
        }
        let manifest: crate::plugins::config::PluginManifest = if is_yaml_plugin {
            serde_yaml::from_str(&plugin_manifest_content)
                .map_err(|e| format!("Invalid plugin.yaml: {}", e))?
        } else {
            serde_json::from_str(&plugin_manifest_content)
                .map_err(|e| format!("Invalid plugin.json: {}", e))?
        };
        (manifest.id, app_dir.join("data").join("plugins"))
    };

    // Ensure parents exist
    if !target_root.exists() {
        fs::create_dir_all(&target_root).map_err(|e| e.to_string())?;
    }

    let target_dir = target_root.join(&id);

    // 3. Extract to target directory
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => target_dir.join(path),
            None => continue,
        };

        if (*file.name()).ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    if is_theme {
        log::info!("[Themes] Installation successful: {}", id);
    } else {
        log::info!("[Plugins] Installation successful: {}", id);
    }

    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::config::PluginManifest;
    use tempfile::TempDir;

    fn create_mock_plugin(dir: &Path, id: &str, name: &str) {
        let plugin_dir = dir.join(id);
        fs::create_dir_all(&plugin_dir).unwrap();

        let manifest = PluginManifest {
            id: id.to_string(),
            name: name.to_string(),
            version: "1.0.0".to_string(),
            description: None,
            author: None,
            icon: None,
            homepage: None,
            license: None,
            min_app_version: None,
            entry: None,
            capabilities: None,
            permissions: None,
            settings_schema: None,
            locales: None,
            r#type: "plugin".to_string(),
        };

        let json = serde_json::to_string(&manifest).unwrap();
        fs::write(plugin_dir.join("plugin.json"), json).unwrap();
    }

    #[test]
    fn test_plugin_discovery() {
        let temp = TempDir::new().unwrap();
        let plugins_dir = temp.path();

        create_mock_plugin(plugins_dir, "p1", "Plugin 1");
        create_mock_plugin(plugins_dir, "p2", "Plugin 2");

        let discovered = discover_plugins(plugins_dir, &["p1".to_string()]);
        assert_eq!(discovered.len(), 2);

        let p1 = discovered.iter().find(|p| p.manifest.id == "p1").unwrap();
        assert!(p1.enabled);

        let p2 = discovered.iter().find(|p| p.manifest.id == "p2").unwrap();
        assert!(!p2.enabled);
    }

    #[test]
    fn test_resolve_plugin_path() {
        let temp = TempDir::new().unwrap();
        let plugins_dir = temp.path();

        // Case 1: Folder name matches ID
        create_mock_plugin(plugins_dir, "my-plugin", "My Plugin");
        let path = resolve_plugin_path(plugins_dir, "my-plugin").unwrap();
        assert!(path.ends_with("my-plugin"));

        // Case 2: Folder name DIFFERS from ID
        let weird_folder = plugins_dir.join("weird-name");
        fs::create_dir_all(&weird_folder).unwrap();
        let manifest = PluginManifest {
            id: "correct-id".to_string(),
            name: "My Plugin".to_string(),
            version: "1.0.0".to_string(),
            description: None,
            author: None,
            icon: None,
            homepage: None,
            license: None,
            min_app_version: None,
            entry: None,
            capabilities: None,
            permissions: None,
            settings_schema: None,
            locales: None,
            r#type: "plugin".to_string(),
        };
        fs::write(
            weird_folder.join("plugin.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        let path = resolve_plugin_path(plugins_dir, "correct-id").unwrap();
        assert!(path.ends_with("weird-name"));
    }
}
