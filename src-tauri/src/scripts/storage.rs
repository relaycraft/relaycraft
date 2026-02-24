use super::model::{Manifest, ScriptEntry, ScriptInfo};
use crate::common::error::ScriptError;
// use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Script storage with dependency injection support
pub struct ScriptStorage {
    pub base_dir: PathBuf,
}

impl ScriptStorage {
    /// Create storage with custom directory
    pub fn new(base_dir: PathBuf) -> Result<Self, ScriptError> {
        if !base_dir.exists() {
            fs::create_dir_all(&base_dir)?;
        }
        Ok(Self { base_dir })
    }

    /// Create storage from app config
    pub fn from_config() -> Result<Self, ScriptError> {
        let data_dir = crate::config::get_data_dir().map_err(|e| ScriptError::NotFound(e))?;
        Self::new(data_dir.join("scripts"))
    }

    /// Get manifest path
    fn manifest_path(&self) -> PathBuf {
        self.base_dir.join("manifest.json")
    }

    /// Load manifest
    pub fn load_manifest(&self) -> Result<Manifest, ScriptError> {
        let path = self.manifest_path();
        if !path.exists() {
            return Ok(Manifest::default());
        }
        let content = fs::read_to_string(&path)?;

        match serde_json::from_str::<Manifest>(&content) {
            Ok(manifest) => Ok(manifest),
            Err(e) => {
                log::warn!("Failed to parse manifest: {}. Using default.", e);
                Ok(Manifest::default())
            }
        }
    }

    /// Save manifest
    pub fn save_manifest(&self, manifest: &Manifest) -> Result<(), ScriptError> {
        let path = self.manifest_path();
        let content = serde_json::to_string_pretty(manifest)
            .map_err(|e| ScriptError::Serialization(e.to_string()))?;
        fs::write(path, content)?;
        Ok(())
    }

    /// Sync scripts on disk with manifest and return full info
    pub fn list_scripts(&self) -> Result<Vec<ScriptInfo>, ScriptError> {
        let mut manifest = self.load_manifest()?;
        let mut scripts_on_disk = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("py") {
                    let name = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    scripts_on_disk.push(name);
                }
            }
        }

        let mut result = Vec::new();
        let mut manifest_changed = false;

        // 1. Add scripts from manifest that still exist on disk
        for entry in &manifest.scripts {
            if let Some(pos) = scripts_on_disk.iter().position(|name| name == &entry.name) {
                scripts_on_disk.remove(pos);
                result.push(ScriptInfo {
                    name: entry.name.clone(),
                    enabled: entry.enabled,
                    path: self
                        .base_dir
                        .join(&entry.name)
                        .to_string_lossy()
                        .to_string(),
                });
            } else {
                manifest_changed = true;
            }
        }

        // 2. Add new scripts found on disk
        for name in scripts_on_disk {
            result.push(ScriptInfo {
                name: name.clone(),
                enabled: false,
                path: self.base_dir.join(&name).to_string_lossy().to_string(),
            });
            manifest.scripts.push(ScriptEntry {
                name,
                enabled: false,
            });
            manifest_changed = true;
        }

        if manifest_changed {
            // Re-sync: only keep scripts that actually exist
            let base = &self.base_dir;
            manifest.scripts.retain(|s| base.join(&s.name).exists());
            self.save_manifest(&manifest)?;
        }

        Ok(result)
    }

    /// Get script content
    pub fn get_content(&self, name: &str) -> Result<String, ScriptError> {
        let path = self.base_dir.join(name);
        fs::read_to_string(path).map_err(|e| ScriptError::Io(e))
    }

    /// Save script content
    pub fn save_script(&self, name: &str, content: &str) -> Result<(), ScriptError> {
        let safe_name = name.replace("..", "").replace("/", "").replace("\\", "");
        let path = self.base_dir.join(&safe_name);

        fs::write(&path, content)?;

        let mut manifest = self.load_manifest()?;
        if !manifest.scripts.iter().any(|s| s.name == safe_name) {
            manifest.scripts.push(ScriptEntry {
                name: safe_name,
                enabled: false,
            });
            self.save_manifest(&manifest)?;
        }
        Ok(())
    }

    /// Delete script
    pub fn delete_script(&self, name: &str) -> Result<(), ScriptError> {
        let path = self.base_dir.join(name);
        if path.exists() {
            fs::remove_file(path)?;
        }

        let mut manifest = self.load_manifest()?;
        let len_before = manifest.scripts.len();
        manifest.scripts.retain(|s| s.name != name);
        if manifest.scripts.len() != len_before {
            self.save_manifest(&manifest)?;
        }
        Ok(())
    }

    /// Set script enabled
    pub fn set_enabled(&self, name: &str, enabled: bool) -> Result<(), ScriptError> {
        let mut manifest = self.load_manifest()?;
        if let Some(entry) = manifest.scripts.iter_mut().find(|s| s.name == name) {
            entry.enabled = enabled;
            self.save_manifest(&manifest)?;
            Ok(())
        } else {
            Err(ScriptError::NotFound(name.to_string()))
        }
    }

    /// Rename script
    pub fn rename_script(&self, old_name: &str, new_name: &str) -> Result<(), ScriptError> {
        let safe_new_name = new_name
            .replace("..", "")
            .replace("/", "")
            .replace("\\", "");
        let old_path = self.base_dir.join(old_name);
        let new_path = self.base_dir.join(&safe_new_name);

        if !old_path.exists() {
            return Err(ScriptError::NotFound(old_name.to_string()));
        }
        if new_path.exists() {
            return Err(ScriptError::Runtime(
                "Target script name already exists".into(),
            ));
        }

        fs::rename(&old_path, &new_path)?;

        let mut manifest = self.load_manifest()?;
        if let Some(entry) = manifest.scripts.iter_mut().find(|s| s.name == old_name) {
            entry.name = safe_new_name;
            self.save_manifest(&manifest)?;
        }
        Ok(())
    }

    /// Move script in manifest
    pub fn move_script(&self, name: &str, direction: &str) -> Result<Vec<ScriptInfo>, ScriptError> {
        let mut manifest = self.load_manifest()?;
        if let Some(pos) = manifest.scripts.iter().position(|s| s.name == name) {
            if direction == "up" && pos > 0 {
                manifest.scripts.swap(pos, pos - 1);
                self.save_manifest(&manifest)?;
            } else if direction == "down" && pos < manifest.scripts.len() - 1 {
                manifest.scripts.swap(pos, pos + 1);
                self.save_manifest(&manifest)?;
            }
        }
        self.list_scripts()
    }

    /// Get enabled script paths for proxy
    pub fn get_enabled_script_paths(&self) -> Result<Vec<PathBuf>, ScriptError> {
        let manifest = self.load_manifest()?;
        let mut paths = Vec::new();
        for entry in manifest.scripts {
            if entry.enabled {
                paths.push(self.base_dir.join(entry.name));
            }
        }
        Ok(paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_script_registration() {
        let temp = TempDir::new().unwrap();
        let storage = ScriptStorage::new(temp.path().to_path_buf()).unwrap();

        // Register a script
        storage.save_script("test.py", "print('hello')").unwrap();

        let scripts = storage.list_scripts().unwrap();
        assert_eq!(scripts.len(), 1);
        assert_eq!(scripts[0].name, "test.py");
        assert_eq!(scripts[0].enabled, false); // Default
    }

    #[test]
    fn test_script_enablement() {
        let temp = TempDir::new().unwrap();
        let storage = ScriptStorage::new(temp.path().to_path_buf()).unwrap();

        storage.save_script("test.py", "print('hello')").unwrap();
        storage.set_enabled("test.py", true).unwrap();

        let scripts = storage.list_scripts().unwrap();
        assert_eq!(scripts[0].enabled, true);

        let enabled_paths = storage.get_enabled_script_paths().unwrap();
        assert_eq!(enabled_paths.len(), 1);
        assert!(enabled_paths[0].ends_with("test.py"));
    }

    #[test]
    fn test_script_deletion() {
        let temp = TempDir::new().unwrap();
        let storage = ScriptStorage::new(temp.path().to_path_buf()).unwrap();

        storage.save_script("test.py", "print('hello')").unwrap();
        storage.delete_script("test.py").unwrap();

        let scripts = storage.list_scripts().unwrap();
        assert_eq!(scripts.len(), 0);
        assert!(!temp.path().join("test.py").exists());
    }
}
