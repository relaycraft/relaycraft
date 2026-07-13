use std::collections::HashMap;

use super::model::GatewayRoute;
use super::storage::GatewayStorage;
use crate::common::error::ToTauriError;

#[tauri::command]
pub fn load_all_gateway_routes() -> Result<String, String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    let response = storage.load_all_routes().map_err(|e| e.to_tauri_error())?;
    serde_json::to_string(&response).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub fn save_gateway_route(route: GatewayRoute, group_id: String) -> Result<GatewayRoute, String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    storage
        .save_route(&route, &group_id)
        .map_err(|e| e.to_tauri_error())?;
    Ok(route)
}

#[tauri::command]
pub fn delete_gateway_route(route_id: String) -> Result<(), String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    storage
        .delete_route(&route_id)
        .map_err(|e| e.to_tauri_error())
}

#[tauri::command]
pub fn load_gateway_groups() -> Result<String, String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    let groups = storage.load_groups().map_err(|e| e.to_tauri_error())?;
    serde_json::to_string(&groups).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub fn save_gateway_groups(groups: Vec<super::model::GatewayGroup>) -> Result<(), String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    storage.save_groups(&groups).map_err(|e| e.to_tauri_error())
}

#[tauri::command]
pub fn load_gateway_env(profile: String) -> Result<HashMap<String, String>, String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    storage
        .load_env_profile(&profile)
        .map_err(|e| e.to_tauri_error())
}

#[tauri::command]
pub fn save_gateway_env(profile: String, vars: HashMap<String, String>) -> Result<(), String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    storage
        .save_env_profile(&profile, &vars)
        .map_err(|e| e.to_tauri_error())
}

#[tauri::command]
pub fn list_gateway_env_profiles() -> Result<Vec<String>, String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    storage.list_env_profiles().map_err(|e| e.to_tauri_error())
}

#[tauri::command]
pub fn get_gateway_dir_path() -> Result<String, String> {
    let storage = GatewayStorage::from_config().map_err(|e| e.to_tauri_error())?;
    Ok(storage.base_dir.to_string_lossy().to_string())
}
