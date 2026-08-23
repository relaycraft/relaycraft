pub mod bridge;
pub mod commands;
pub mod config;
pub mod market;
pub mod registry;
pub mod stats;
pub mod storage;

use crate::plugins::config::{PluginCompatibility, PluginInfo, PluginManifest};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Cache for plugin manifests to avoid repeated filesystem scanning
pub struct PluginCache {
    pub plugins: Mutex<Vec<PluginInfo>>,
}

impl Default for PluginCache {
    fn default() -> Self {
        Self {
            plugins: Mutex::new(Vec::new()),
        }
    }
}

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

/// Evaluate a manifest's `engines.relaycraft` SemVer range against the
/// current app version. No requirement means compatible; an invalid range is
/// fail-closed (incompatible, with the parse error as the reason).
/// `min_app_version` is deprecated and ignored here.
pub fn check_compatibility(manifest: &PluginManifest) -> PluginCompatibility {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let requirement = manifest
        .engines
        .as_ref()
        .and_then(|engines| engines.get("relaycraft"))
        .cloned();

    let Some(req) = requirement else {
        return PluginCompatibility {
            requirement: None,
            current,
            compatible: true,
            reason: None,
        };
    };

    let range = match semver::VersionReq::parse(&req) {
        Ok(range) => range,
        Err(e) => {
            return PluginCompatibility {
                requirement: Some(req),
                current,
                compatible: false,
                reason: Some(format!("invalid version requirement: {}", e)),
            };
        }
    };

    let current_version = match semver::Version::parse(&current) {
        Ok(version) => version,
        Err(e) => {
            return PluginCompatibility {
                requirement: Some(req),
                current,
                compatible: false,
                reason: Some(format!("failed to parse app version: {}", e)),
            };
        }
    };

    if range.matches(&current_version) {
        PluginCompatibility {
            requirement: Some(req),
            current,
            compatible: true,
            reason: None,
        }
    } else {
        PluginCompatibility {
            requirement: Some(req.clone()),
            current: current.clone(),
            compatible: false,
            reason: Some(format!("requires relaycraft {}, current {}", req, current)),
        }
    }
}

/// Permissions a plugin manifest may declare. Keep in sync with
/// `KNOWN_PERMISSIONS` in `registry.rs` tests, `PluginPermission` in
/// `src/types/plugin.ts`, and `scripts/validate-plugin-manifest.mjs`.
pub(crate) const KNOWN_PERMISSIONS: &[&str] = &[
    "proxy:read",
    "proxy:write",
    "fs:read_logs",
    "network:outbound",
    "ai:chat",
    "stats:read",
    "rules:write",
    "rules:read",
    "traffic:read",
    "storage:read",
    "storage:write",
];

/// Lenient reverse-domain id: at least two dot-separated segments, first
/// segment starts with a letter, segments contain [A-Za-z0-9_-].
/// Mirrors ID_PATTERN in `scripts/validate-plugin-manifest.mjs`.
fn is_valid_plugin_id(id: &str) -> bool {
    let mut segments = id.split('.');
    let first = match segments.next() {
        Some(segment) => segment,
        None => return false,
    };
    let valid_segment = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    };
    if !first
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
        || !valid_segment(first)
    {
        return false;
    }
    let mut count = 1;
    for segment in segments {
        if !valid_segment(segment) {
            return false;
        }
        count += 1;
    }
    count >= 2
}

/// SemVer shape: MAJOR.MINOR.PATCH with optional `-prerelease` / `+build`.
/// Mirrors SEMVER_PATTERN in `scripts/validate-plugin-manifest.mjs`.
fn is_valid_semver_shape(version: &str) -> bool {
    let valid_suffix = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    };
    let head = match version.split_once('+') {
        Some((head, build)) => {
            if !valid_suffix(build) {
                return false;
            }
            head
        }
        None => version,
    };
    let core = match head.split_once('-') {
        Some((core, prerelease)) => {
            if !valid_suffix(prerelease) {
                return false;
            }
            core
        }
        None => head,
    };
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// Validate a plugin manifest at install time (theme manifests are not
/// covered). Rules mirror `scripts/validate-plugin-manifest.mjs`.
/// All errors carry the `[manifest]` stage prefix so the frontend can
/// classify them.
pub fn validate_plugin_manifest(manifest: &PluginManifest) -> Result<(), String> {
    let id = manifest.id.trim();
    if id.is_empty() {
        return Err("[manifest] missing required field \"id\"".to_string());
    }
    if !is_valid_plugin_id(id) {
        return Err(format!(
            "[manifest] id \"{}\" is not a valid reverse-domain id (expected something like \"com.example.plugin\")",
            manifest.id
        ));
    }
    if manifest.name.trim().is_empty() {
        return Err("[manifest] missing required field \"name\"".to_string());
    }
    let version = manifest.version.trim();
    if version.is_empty() {
        return Err("[manifest] missing required field \"version\"".to_string());
    }
    if !is_valid_semver_shape(version) {
        return Err(format!(
            "[manifest] version \"{}\" is not a valid SemVer string",
            manifest.version
        ));
    }
    if let Some(permissions) = &manifest.permissions {
        for permission in permissions {
            if !KNOWN_PERMISSIONS.contains(&permission.as_str()) {
                return Err(format!(
                    "[manifest] unknown permission \"{}\". Valid values: {}",
                    permission,
                    KNOWN_PERMISSIONS.join(", ")
                ));
            }
        }
    }
    Ok(())
}

/// After extraction to the staging directory, verify that a declared
/// `capabilities.ui.entry` file actually exists in the staged payload.
fn validate_staged_ui_entry(staging_dir: &Path, manifest: &PluginManifest) -> Result<(), String> {
    if let Some(entry) = manifest
        .capabilities
        .as_ref()
        .and_then(|caps| caps.ui.as_ref())
        .map(|ui| &ui.entry)
    {
        if !staging_dir.join(entry).is_file() {
            return Err(format!(
                "[manifest] capabilities.ui.entry points to a missing file: {}",
                entry
            ));
        }
    }
    Ok(())
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

    let compatibility = check_compatibility(&manifest);
    Some(PluginInfo {
        manifest,
        path: path.to_string_lossy().to_string(),
        enabled: false,
        compatibility,
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
    let file =
        fs::File::open(zip_path).map_err(|e| format!("[archive] Failed to open zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("[archive] Invalid zip archive: {}", e))?;

    // 2. We need to find manifest to know the ID and type
    let mut plugin_manifest_content = String::new();
    let mut theme_manifest_content = String::new();
    let mut is_theme = false;
    let mut is_yaml_plugin = false;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("[archive] Failed to read zip entry: {}", e))?;
        if file.name().ends_with("plugin.json") {
            use std::io::Read;
            if file.size() > 1024 * 1024 {
                return Err("[manifest] plugin.json is too large".to_string());
            }
            file.read_to_string(&mut plugin_manifest_content)
                .map_err(|e| format!("[manifest] Failed to read plugin.json: {}", e))?;
        } else if file.name().ends_with("plugin.yaml") || file.name().ends_with("plugin.yml") {
            use std::io::Read;
            if file.size() > 1024 * 1024 {
                return Err("[manifest] plugin.yaml is too large".to_string());
            }
            file.read_to_string(&mut plugin_manifest_content)
                .map_err(|e| format!("[manifest] Failed to read plugin.yaml: {}", e))?;
            is_yaml_plugin = true;
        } else if file.name().ends_with("theme.yaml") || file.name().ends_with("theme.yml") {
            use std::io::Read;
            if file.size() > 1024 * 1024 {
                return Err("[manifest] theme manifest is too large".to_string());
            }
            file.read_to_string(&mut theme_manifest_content)
                .map_err(|e| format!("[manifest] Failed to read theme manifest: {}", e))?;
            is_theme = true;
        }
    }

    let (id, target_root, plugin_manifest) = if is_theme {
        let manifest: crate::plugins::config::ThemeManifest =
            serde_yaml::from_str(&theme_manifest_content)
                .map_err(|e| format!("[manifest] Invalid theme manifest: {}", e))?;
        (manifest.id, app_dir.join("data").join("themes"), None)
    } else {
        if plugin_manifest_content.is_empty() {
            return Err(
                "[manifest] Plugin zip must contain plugin.json or plugin.yaml".to_string(),
            );
        }
        let manifest: crate::plugins::config::PluginManifest = if is_yaml_plugin {
            serde_yaml::from_str(&plugin_manifest_content)
                .map_err(|e| format!("[manifest] Invalid plugin.yaml: {}", e))?
        } else {
            serde_json::from_str(&plugin_manifest_content)
                .map_err(|e| format!("[manifest] Invalid plugin.json: {}", e))?
        };
        // Manifest contract validation (id / name / version / permissions).
        // File-level checks (e.g. capabilities.ui.entry) run against the
        // staging directory after extraction.
        validate_plugin_manifest(&manifest)?;
        let id = manifest.id.clone();
        (id, app_dir.join("data").join("plugins"), Some(manifest))
    };

    // Ensure parents exist
    if !target_root.exists() {
        fs::create_dir_all(&target_root)
            .map_err(|e| format!("[filesystem] Failed to create plugin directory: {}", e))?;
    }

    let target_dir = target_root.join(&id);
    let staging_dir = target_root.join(format!(".{}.staging", id));
    let backup_dir = target_root.join(format!(".{}.bak", id));

    // 3. Extract to staging directory first (atomic replace pattern)
    //    Old version stays intact until extraction fully succeeds.
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)
            .map_err(|e| format!("[filesystem] Failed to clean staging directory: {}", e))?;
    }
    fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("[filesystem] Failed to create staging directory: {}", e))?;

    // 100 MB total extraction limit to prevent zip-bomb attacks.
    const MAX_EXTRACT_BYTES: u64 = 100 * 1024 * 1024;
    // Chunk size for streaming copy (64 KB).
    const CHUNK: usize = 64 * 1024;
    let mut total_extracted: u64 = 0;

    // Helper: clean up staging and return an error.
    let abort = |msg: &str| -> Result<String, String> {
        let _ = fs::remove_dir_all(&staging_dir);
        Err(msg.to_string())
    };

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("[archive] Failed to read zip entry: {}", e))?;
        let outpath = match file.enclosed_name() {
            Some(path) => staging_dir.join(path),
            None => continue,
        };

        if (*file.name()).ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("[filesystem] Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("[filesystem] Failed to create directory: {}", e))?;
                }
            }

            // Pre-check: reject the entry before opening if its reported size
            // alone would breach the budget. This avoids any disk write for
            // obviously oversized entries.
            let reported = file.size();
            if total_extracted + reported > MAX_EXTRACT_BYTES {
                return abort("[archive] Plugin archive exceeds 100 MB extraction limit");
            }

            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("[filesystem] Failed to create file: {}", e))?;

            // Chunked copy: enforce the limit during the actual write stream so
            // that a compressed entry whose true size exceeds its reported size
            // (or whose reported size is 0) cannot exhaust disk before we notice.
            let mut buf = vec![0u8; CHUNK];
            loop {
                use std::io::Read;
                let n = file
                    .read(&mut buf)
                    .map_err(|e| format!("[archive] Failed to read zip entry: {}", e))?;
                if n == 0 {
                    break;
                }
                total_extracted += n as u64;
                if total_extracted > MAX_EXTRACT_BYTES {
                    return abort("[archive] Plugin archive exceeds 100 MB extraction limit");
                }
                use std::io::Write;
                outfile
                    .write_all(&buf[..n])
                    .map_err(|e| format!("[filesystem] Failed to write file: {}", e))?;
            }
        }
    }

    // 3b. Manifest-declared UI entry must exist in the staged payload
    //     (checked after extraction, before the atomic replace).
    if let Some(manifest) = &plugin_manifest {
        if let Err(e) = validate_staged_ui_entry(&staging_dir, manifest) {
            return abort(&e);
        }
    }

    // 4. Atomic replace: backup old → rename staging → cleanup backup
    if target_dir.exists() {
        // Remove stale backup first
        if backup_dir.exists() {
            let _ = fs::remove_dir_all(&backup_dir);
        }
        fs::rename(&target_dir, &backup_dir).map_err(|e| {
            let _ = fs::remove_dir_all(&staging_dir);
            format!("[filesystem] Failed to backup existing plugin: {}", e)
        })?;
    }
    fs::rename(&staging_dir, &target_dir).map_err(|e| {
        // Attempt rollback: restore backup
        if backup_dir.exists() {
            let _ = fs::rename(&backup_dir, &target_dir);
        }
        format!("[filesystem] Failed to activate new plugin version: {}", e)
    })?;
    // Clean up backup on success
    if backup_dir.exists() {
        let _ = fs::remove_dir_all(&backup_dir);
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
    use std::collections::HashMap;
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
            engines: None,
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
            engines: None,
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

    fn mock_manifest_with_engines(engines: Option<HashMap<String, String>>) -> PluginManifest {
        PluginManifest {
            id: "compat-test".to_string(),
            name: "Compat Test".to_string(),
            version: "1.0.0".to_string(),
            description: None,
            author: None,
            icon: None,
            homepage: None,
            license: None,
            min_app_version: None,
            engines,
            entry: None,
            capabilities: None,
            permissions: None,
            settings_schema: None,
            locales: None,
            r#type: "plugin".to_string(),
        }
    }

    #[test]
    fn test_compatibility_no_requirement_is_compatible() {
        let compat = check_compatibility(&mock_manifest_with_engines(None));
        assert!(compat.compatible);
        assert_eq!(compat.requirement, None);
        assert_eq!(compat.reason, None);
        assert_eq!(compat.current, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn test_compatibility_satisfied_range() {
        let mut engines = HashMap::new();
        engines.insert("relaycraft".to_string(), ">=1.0.0".to_string());
        let compat = check_compatibility(&mock_manifest_with_engines(Some(engines)));
        assert!(compat.compatible);
        assert_eq!(compat.requirement.as_deref(), Some(">=1.0.0"));
        assert_eq!(compat.reason, None);
    }

    #[test]
    fn test_compatibility_unsatisfied_range() {
        let mut engines = HashMap::new();
        engines.insert("relaycraft".to_string(), ">=2.0.0".to_string());
        let compat = check_compatibility(&mock_manifest_with_engines(Some(engines)));
        assert!(!compat.compatible);
        let reason = compat.reason.expect("incompatible must carry a reason");
        assert!(reason.contains(">=2.0.0"));
        assert!(reason.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn test_compatibility_invalid_range_is_fail_closed() {
        let mut engines = HashMap::new();
        engines.insert("relaycraft".to_string(), ">=".to_string());
        let compat = check_compatibility(&mock_manifest_with_engines(Some(engines)));
        assert!(!compat.compatible);
        let reason = compat.reason.expect("invalid range must carry a reason");
        assert!(reason.contains("invalid version requirement"));
    }

    fn mock_valid_manifest() -> PluginManifest {
        PluginManifest {
            id: "com.example.test".to_string(),
            name: "Test Plugin".to_string(),
            version: "1.0.0".to_string(),
            description: None,
            author: None,
            icon: None,
            homepage: None,
            license: None,
            min_app_version: None,
            engines: None,
            entry: None,
            capabilities: None,
            permissions: None,
            settings_schema: None,
            locales: None,
            r#type: "plugin".to_string(),
        }
    }

    #[test]
    fn test_validate_manifest_valid_passes() {
        let mut manifest = mock_valid_manifest();
        assert!(validate_plugin_manifest(&manifest).is_ok());

        manifest.version = "0.2.1-beta.1+build.5".to_string();
        manifest.permissions = Some(vec!["proxy:read".to_string(), "storage:write".to_string()]);
        assert!(validate_plugin_manifest(&manifest).is_ok());
    }

    #[test]
    fn test_validate_manifest_missing_name() {
        let mut manifest = mock_valid_manifest();
        manifest.name = "  ".to_string();
        let err = validate_plugin_manifest(&manifest).unwrap_err();
        assert!(err.starts_with("[manifest]"), "got: {}", err);
        assert!(err.contains("name"), "got: {}", err);
    }

    #[test]
    fn test_validate_manifest_bad_id() {
        for bad_id in ["", "plugin", "1com.example", "com..example", "com/example"] {
            let mut manifest = mock_valid_manifest();
            manifest.id = bad_id.to_string();
            let err = validate_plugin_manifest(&manifest).unwrap_err();
            assert!(
                err.starts_with("[manifest]"),
                "id {:?} should fail with [manifest] prefix, got: {}",
                bad_id,
                err
            );
        }
    }

    #[test]
    fn test_validate_manifest_bad_version() {
        for bad_version in ["", "1.0", "v1.0.0", "1.0.0.0", "1.x.0"] {
            let mut manifest = mock_valid_manifest();
            manifest.version = bad_version.to_string();
            let err = validate_plugin_manifest(&manifest).unwrap_err();
            assert!(
                err.starts_with("[manifest]"),
                "version {:?} should fail with [manifest] prefix, got: {}",
                bad_version,
                err
            );
        }
    }

    #[test]
    fn test_validate_manifest_unknown_permission() {
        let mut manifest = mock_valid_manifest();
        manifest.permissions = Some(vec!["traffic:read".to_string(), "root:all".to_string()]);
        let err = validate_plugin_manifest(&manifest).unwrap_err();
        assert!(err.starts_with("[manifest]"), "got: {}", err);
        assert!(err.contains("root:all"), "got: {}", err);
    }

    #[test]
    fn test_validate_staged_ui_entry() {
        let temp = TempDir::new().unwrap();
        let staging = temp.path();

        let mut manifest = mock_valid_manifest();
        manifest.capabilities = Some(crate::plugins::config::PluginCapabilities {
            ui: Some(crate::plugins::config::PluginUICapability {
                entry: "index.js".to_string(),
                settings_schema: None,
            }),
            logic: None,
            i18n: None,
        });

        // Missing entry file → error with [manifest] prefix
        let err = validate_staged_ui_entry(staging, &manifest).unwrap_err();
        assert!(err.starts_with("[manifest]"), "got: {}", err);
        assert!(err.contains("index.js"), "got: {}", err);

        // Entry file present → ok
        fs::write(staging.join("index.js"), "console.log(1)").unwrap();
        assert!(validate_staged_ui_entry(staging, &manifest).is_ok());

        // No UI capability declared → always ok
        manifest.capabilities = None;
        assert!(validate_staged_ui_entry(staging, &manifest).is_ok());
    }
}
