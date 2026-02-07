use super::model::{Rule, RuleGroup};
use super::storage::{ImportResult, RuleStorage};
use crate::common::error::ToTauriError;
use std::path::Path;

/// Get rules directory path
#[tauri::command]
pub fn get_rules_dir_path() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    Ok(storage.base_dir.to_string_lossy().to_string())
}

/// Load all rules
#[tauri::command]
pub fn load_all_rules() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let response = storage.load_all().map_err(|e| e.to_tauri_error())?;

    serde_json::to_string(&response).map_err(|e| format!("Failed to serialize response: {}", e))
}

/// Save rule
#[tauri::command]
pub fn save_rule(rule_json: String, group_id: Option<String>) -> Result<(), String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let rule: Rule =
        serde_json::from_str(&rule_json).map_err(|e| format!("Failed to parse rule: {}", e))?;

    storage
        .save(&rule, group_id.as_deref())
        .map_err(|e| e.to_tauri_error())
}

/// Delete rule
#[tauri::command]
pub fn delete_rule(rule_id: String) -> Result<(), String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage.delete(&rule_id).map_err(|e| e.to_tauri_error())
}

/// Load groups
#[tauri::command]
pub fn load_groups() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let groups = storage.load_groups().map_err(|e| e.to_tauri_error())?;

    serde_json::to_string(&groups).map_err(|e| format!("Failed to serialize groups: {}", e))
}

/// Save groups
#[tauri::command]
pub fn save_groups(groups_json: String) -> Result<(), String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let groups: Vec<RuleGroup> =
        serde_json::from_str(&groups_json).map_err(|e| format!("Failed to parse groups: {}", e))?;

    storage.save_groups(&groups).map_err(|e| e.to_tauri_error())
}

/// Export rules bundle
#[tauri::command]
pub fn export_rules_bundle() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage.export_bundle().map_err(|e| e.to_tauri_error())
}

/// Import rules bundle
#[tauri::command]
pub fn import_rules_bundle(yaml_content: String) -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let count = storage
        .import_bundle(&yaml_content)
        .map_err(|e| e.to_tauri_error())?;

    Ok(format!("Imported {} rules", count))
}

/// Export rules to a ZIP file
#[tauri::command]
pub async fn export_rules_zip(save_path: String) -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .export_zip(Path::new(&save_path))
        .map_err(|e| e.to_tauri_error())?;

    Ok(format!("Successfully exported rules to {}", save_path))
}

/// Import rules from a ZIP file
#[tauri::command]
pub async fn import_rules_zip(zip_path: String) -> Result<ImportResult, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .import_zip(Path::new(&zip_path))
        .map_err(|e| e.to_tauri_error())
}
