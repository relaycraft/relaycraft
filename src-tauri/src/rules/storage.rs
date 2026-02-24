use super::model::{Rule, RuleGroup};
use crate::common::error::RuleError;
// use crate::config;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

/// Result of a bulk import operation
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub success: bool,
    pub imported_count: usize,
    pub skipped_count: usize,
    pub error: Option<String>,
}

/// Rule storage with dependency injection support
pub struct RuleStorage {
    pub base_dir: PathBuf,
}

impl RuleStorage {
    /// Create storage with custom directory
    pub fn new(base_dir: PathBuf) -> Result<Self, RuleError> {
        if !base_dir.exists() {
            fs::create_dir_all(&base_dir)?;
        }
        Ok(Self { base_dir })
    }

    /// Create storage from app config
    pub fn from_config() -> Result<Self, RuleError> {
        let data_dir = crate::config::get_data_dir().map_err(|e| RuleError::Invalid(e))?;
        Self::new(data_dir.join("rules"))
    }

    /// Get groups file path
    fn groups_file(&self) -> PathBuf {
        self.base_dir.join("groups.yaml")
    }

    /// Load all rules recursively
    pub fn load_all(&self) -> Result<LoadRulesResponse, RuleError> {
        let mut entries = Vec::new();
        let mut errors = Vec::new();

        for entry in WalkDir::new(&self.base_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) != Some("yaml") {
                continue;
            }

            if path.file_name().and_then(|s| s.to_str()) == Some("groups.yaml") {
                continue;
            }

            match self.load_rule_from_path(path) {
                Ok(entry) => entries.push(entry),
                Err(e) => errors.push(ParseError {
                    path: path.to_string_lossy().to_string(),
                    error: e.to_string(),
                }),
            }
        }

        Ok(LoadRulesResponse {
            rules: entries,
            errors,
        })
    }

    /// Load single rule from path
    fn load_rule_from_path(&self, path: &std::path::Path) -> Result<RuleEntry, RuleError> {
        let content = fs::read_to_string(path)?;
        let rule_file: RuleFile =
            serde_yaml::from_str(&content).map_err(|e| RuleError::Parse(e.to_string()))?;

        let group_id = self.extract_group_id(path);

        Ok(RuleEntry {
            group_id,
            rule: rule_file.rule,
        })
    }

    /// Extract group ID from file path
    fn extract_group_id(&self, path: &std::path::Path) -> String {
        path.strip_prefix(&self.base_dir)
            .ok()
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().replace("\\", "/"))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Default".to_string())
    }

    /// Save rule to storage
    pub fn save(&self, rule: &Rule, group_id: Option<&str>) -> Result<(), RuleError> {
        let group_id = group_id.unwrap_or("Default");
        let safe_path = group_id.replace("..", "").replace(":", "");
        let target_dir = self.base_dir.join(safe_path);

        if !target_dir.exists() {
            fs::create_dir_all(&target_dir)?;
        }

        // Remove old file if it exists elsewhere
        let file_name = format!("{}.yaml", rule.id);
        self.remove_old_file(&file_name, &target_dir)?;

        // Serialize and write
        let rule_file = RuleFile { rule: rule.clone() };
        let yaml_content = serde_yaml::to_string(&rule_file)
            .map_err(|e| RuleError::Serialization(e.to_string()))?;

        let file_path = target_dir.join(&file_name);
        fs::write(&file_path, yaml_content)?;

        log::info!("Saved rule {} to {:?}", rule.id, file_path);
        Ok(())
    }

    /// Remove old file if it exists elsewhere
    fn remove_old_file(&self, file_name: &str, exclude_dir: &PathBuf) -> Result<(), RuleError> {
        for entry in WalkDir::new(&self.base_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();
            if entry_path.is_file()
                && entry_path.file_name().and_then(|s| s.to_str()) == Some(file_name)
                && entry_path.parent() != Some(exclude_dir.as_path())
            {
                log::info!("Moving rule from {:?} to {:?}", entry_path, exclude_dir);
                fs::remove_file(entry_path)?;
            }
        }
        Ok(())
    }

    /// Delete rule by ID
    pub fn delete(&self, rule_id: &str) -> Result<(), RuleError> {
        let file_name = format!("{}.yaml", rule_id);
        let mut found = false;

        for entry in WalkDir::new(&self.base_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();
            if entry_path.is_file()
                && entry_path.file_name().and_then(|s| s.to_str()) == Some(&file_name)
            {
                fs::remove_file(entry_path)?;
                log::info!("Deleted rule file: {:?}", entry_path);
                found = true;
            }
        }

        if !found {
            log::warn!("Rule file {} not found for deletion", rule_id);
        }

        Ok(())
    }

    /// Load all groups
    pub fn load_groups(&self) -> Result<Vec<RuleGroup>, RuleError> {
        let groups_file = self.groups_file();

        if !groups_file.exists() {
            return Ok(vec![]);
        }

        let content = fs::read_to_string(&groups_file)?;
        let groups_file: GroupsFile =
            serde_yaml::from_str(&content).map_err(|e| RuleError::Parse(e.to_string()))?;

        Ok(groups_file.groups)
    }

    /// Save all groups
    pub fn save_groups(&self, groups: &[RuleGroup]) -> Result<(), RuleError> {
        let groups_file = GroupsFile {
            groups: groups.to_vec(),
        };

        let yaml_content = serde_yaml::to_string(&groups_file)
            .map_err(|e| RuleError::Serialization(e.to_string()))?;

        fs::write(self.groups_file(), yaml_content)?;
        log::info!("Saved groups to {:?}", self.groups_file());
        Ok(())
    }

    /// Export all rules as bundle
    pub fn export_bundle(&self) -> Result<String, RuleError> {
        let response = self.load_all()?;
        let groups = self.load_groups()?;

        let bundle = RuleBundle {
            version: "3.0".to_string(),
            groups,
            rules: response.rules,
        };

        serde_yaml::to_string(&bundle).map_err(|e| RuleError::Serialization(e.to_string()))
    }

    /// Import rules from bundle
    pub fn import_bundle(&self, yaml_content: &str) -> Result<usize, RuleError> {
        let bundle: RuleBundle =
            serde_yaml::from_str(yaml_content).map_err(|e| RuleError::Parse(e.to_string()))?;

        let mut imported_count = 0;

        for entry in bundle.rules {
            self.save(&entry.rule, Some(&entry.group_id))?;
            imported_count += 1;
        }

        if !bundle.groups.is_empty() {
            self.save_groups(&bundle.groups)?;
        }

        Ok(imported_count)
    }

    /// Export rules to a ZIP file
    pub fn export_zip(&self, save_path: &std::path::Path) -> Result<(), RuleError> {
        // Create ZIP file
        let file = File::create(save_path)?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);

        // Walk through rules directory
        for entry in WalkDir::new(&self.base_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let path = entry.path();
            let name = path
                .strip_prefix(&self.base_dir)
                .map_err(|e| RuleError::Invalid(format!("Failed to strip prefix: {}", e)))?;

            // Only include .yaml files
            if let Some(ext) = path.extension() {
                if ext == "yaml" || ext == "yml" {
                    let mut file_content = Vec::new();
                    let mut file = File::open(path)?;
                    file.read_to_end(&mut file_content)?;

                    zip.start_file(name.to_string_lossy().to_string(), options)
                        .map_err(|e| {
                            RuleError::Serialization(format!("Failed to start ZIP entry: {}", e))
                        })?;
                    zip.write_all(&file_content)?;
                }
            }
        }

        zip.finish()
            .map_err(|e| RuleError::Serialization(format!("Failed to finalize ZIP: {}", e)))?;

        Ok(())
    }

    /// Import rules from a ZIP file
    pub fn import_zip(&self, zip_path: &std::path::Path) -> Result<ImportResult, RuleError> {
        let file = File::open(zip_path)?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| RuleError::Parse(format!("Failed to read ZIP archive: {}", e)))?;

        let mut imported_count = 0;
        let mut skipped_count = 0;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| RuleError::Parse(format!("Failed to access ZIP entry: {}", e)))?;

            if file.is_dir() {
                continue;
            }

            let name = file.name().to_string();
            if name.contains("__MACOSX")
                || std::path::Path::new(&name)
                    .file_name()
                    .map(|s| s.to_string_lossy().starts_with('.'))
                    .unwrap_or(false)
            {
                continue;
            }

            let outpath = match file.enclosed_name() {
                Some(path) => self.base_dir.join(path),
                None => {
                    skipped_count += 1;
                    continue;
                }
            };

            if let Some(ext) = outpath.extension() {
                if ext != "yaml" && ext != "yml" {
                    skipped_count += 1;
                    continue;
                }
            } else {
                skipped_count += 1;
                continue;
            }

            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }

            let mut outfile = File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;

            if let Some(file_name) = outpath.file_name() {
                if file_name.to_string_lossy() == "groups.yaml" {
                    continue;
                }
            }
            imported_count += 1;
        }

        Ok(ImportResult {
            success: true,
            imported_count,
            skipped_count,
            error: None,
        })
    }
}

// Data structures
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleFile {
    pub rule: Rule,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GroupsFile {
    pub groups: Vec<RuleGroup>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleEntry {
    pub group_id: String,
    pub rule: Rule,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ParseError {
    pub path: String,
    pub error: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoadRulesResponse {
    pub rules: Vec<RuleEntry>,
    pub errors: Vec<ParseError>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleBundle {
    version: String,
    groups: Vec<RuleGroup>,
    rules: Vec<RuleEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::model::*;
    use tempfile::TempDir;

    #[test]
    fn test_save_and_load_rule() {
        let temp = TempDir::new().unwrap();
        let storage = RuleStorage::new(temp.path().to_path_buf()).unwrap();

        let rule = Rule {
            id: "test-rule".into(),
            name: "Test Rule".into(),
            r#type: RuleType::BlockRequest,
            execution: RuleExecution {
                enabled: true,
                priority: 10,
                stop_on_match: Some(true),
            },
            match_config: RuleMatchConfig {
                request: vec![],
                response: vec![],
            },
            actions: vec![RuleAction::BlockRequest],
            tags: None,
        };

        storage.save(&rule, None).unwrap();

        let response = storage.load_all().unwrap();
        assert_eq!(response.rules.len(), 1);
        assert_eq!(response.rules[0].rule.id, "test-rule");
    }

    #[test]
    fn test_group_management() {
        let temp = TempDir::new().unwrap();
        let storage = RuleStorage::new(temp.path().to_path_buf()).unwrap();

        let group = RuleGroup {
            id: "group-1".into(),
            name: "My Group".into(),
            enabled: true,
            priority: 5,
            description: None,
        };

        storage.save_groups(&[group]).unwrap();

        let groups = storage.load_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, "group-1");

        storage.save_groups(&[]).unwrap();
        let groups = storage.load_groups().unwrap();
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn test_bundle_export_import() {
        let temp = TempDir::new().unwrap();
        let storage = RuleStorage::new(temp.path().to_path_buf()).unwrap();

        // 1. Setup rule and group
        let rule = Rule {
            id: "r1".into(),
            name: "R1".into(),
            r#type: RuleType::BlockRequest,
            execution: RuleExecution {
                enabled: true,
                priority: 1,
                stop_on_match: None,
            },
            match_config: RuleMatchConfig {
                request: vec![],
                response: vec![],
            },
            actions: vec![],
            tags: None,
        };
        storage.save(&rule, None).unwrap();

        // 2. Export
        let bundle_json = storage.export_bundle().unwrap();

        // 3. Clear storage by creating a new one in another temp
        let temp2 = TempDir::new().unwrap();
        let storage2 = RuleStorage::new(temp2.path().to_path_buf()).unwrap();

        // 4. Import
        storage2.import_bundle(&bundle_json).unwrap();
        let response = storage2.load_all().unwrap();
        assert_eq!(response.rules.len(), 1);
        assert_eq!(response.rules[0].rule.id, "r1");
    }

    #[test]
    fn test_map_remote_headers_serialization() {
        let temp = TempDir::new().unwrap();
        let storage = RuleStorage::new(temp.path().to_path_buf()).unwrap();

        let action = RuleAction::MapRemote(MapRemoteAction {
            target_url: "https://example.com".into(),
            preserve_path: Some(true),
            headers: Some(HeaderConfig {
                request: vec![HeaderOperation {
                    operation: "set".into(),
                    key: "X-Test-Req".into(),
                    value: Some("1".into()),
                }],
                response: vec![HeaderOperation {
                    operation: "add".into(),
                    key: "X-Test-Res".into(),
                    value: Some("2".into()),
                }],
            }),
        });

        let rule = Rule {
            id: "map-remote-headers".into(),
            name: "Map Remote Headers".into(),
            r#type: RuleType::MapRemote,
            execution: RuleExecution {
                enabled: true,
                priority: 1,
                stop_on_match: None,
            },
            match_config: RuleMatchConfig {
                request: vec![],
                response: vec![],
            },
            actions: vec![action],
            tags: None,
        };

        storage.save(&rule, None).unwrap();

        let response = storage.load_all().unwrap();
        let loaded_rule = &response.rules[0].rule;

        if let RuleAction::MapRemote(mr) = &loaded_rule.actions[0] {
            assert_eq!(mr.target_url, "https://example.com");
            let headers = mr.headers.as_ref().unwrap();
            assert_eq!(headers.request.len(), 1);
            assert_eq!(headers.request[0].key, "X-Test-Req");
            assert_eq!(headers.response.len(), 1);
            assert_eq!(headers.response[0].key, "X-Test-Res");
        } else {
            panic!("Expected MapRemote action");
        }
    }
}
