use crate::common::error::ToTauriError;
use crate::logging;
use crate::scripts::model::ScriptInfo;
use crate::scripts::storage::ScriptStorage;

#[tauri::command]
pub fn list_scripts() -> Result<Vec<ScriptInfo>, String> {
    let storage = ScriptStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage.list_scripts().map_err(|e| e.to_tauri_error())
}

#[tauri::command]
pub fn get_script_content(name: String) -> Result<String, String> {
    let storage = ScriptStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage.get_content(&name).map_err(|e| e.to_tauri_error())
}

#[tauri::command]
pub fn save_script(name: String, content: String) -> Result<(), String> {
    let storage = ScriptStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .save_script(&name, &content)
        .map_err(|e| e.to_tauri_error())?;

    let _ = logging::write_domain_log("audit", &format!("Saved script: {}", name));
    Ok(())
}

#[tauri::command]
pub fn delete_script(name: String) -> Result<(), String> {
    let storage = ScriptStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .delete_script(&name)
        .map_err(|e| e.to_tauri_error())?;

    let _ = logging::write_domain_log("audit", &format!("Deleted script: {}", name));
    Ok(())
}

#[tauri::command]
pub fn set_script_enabled(name: String, enabled: bool) -> Result<(), String> {
    let storage = ScriptStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .set_enabled(&name, enabled)
        .map_err(|e| e.to_tauri_error())?;

    let _ = logging::write_domain_log("audit", &format!("Set script {} active: {}", name, enabled));
    Ok(())
}

#[tauri::command]
pub fn rename_script(old_name: String, new_name: String) -> Result<(), String> {
    let storage = ScriptStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .rename_script(&old_name, &new_name)
        .map_err(|e| e.to_tauri_error())?;

    let _ = logging::write_domain_log(
        "audit",
        &format!("Renamed script {} to {}", old_name, new_name),
    );
    Ok(())
}

#[tauri::command]
pub fn move_script(name: String, direction: String) -> Result<Vec<ScriptInfo>, String> {
    let storage = ScriptStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .move_script(&name, &direction)
        .map_err(|e| e.to_tauri_error())
}
