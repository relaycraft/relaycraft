pub mod engine;
pub mod monitor;
pub mod paths;
pub mod process;

pub use engine::*;
pub use monitor::*;
pub use process::*;
// pub use paths::*;

use crate::common::error::ToTauriError;
use crate::config;
use tauri::AppHandle;

#[tauri::command]
pub async fn start_proxy(
    app: AppHandle,
    state: tauri::State<'_, ProxyState>,
) -> Result<String, String> {
    // Load configuration
    let config = config::load_config()?;

    state
        .engine
        .start(&app, &config)
        .map_err(|e| e.to_tauri_error())?;

    Ok("Proxy started".to_string())
}

#[tauri::command]
pub async fn stop_proxy(state: tauri::State<'_, ProxyState>) -> Result<String, String> {
    state.engine.stop().map_err(|e| e.to_tauri_error())?;

    Ok("Proxy stopped".to_string())
}

#[tauri::command]
pub async fn get_proxy_status(
    state: tauri::State<'_, ProxyState>,
) -> Result<ProxyStatusResponse, String> {
    let status = state.engine.get_status();

    Ok(ProxyStatusResponse {
        running: status.running,
        active: status.active,
        active_scripts: status.active_scripts,
    })
}

#[tauri::command]
pub async fn set_proxy_active(
    state: tauri::State<'_, ProxyState>,
    active: bool,
) -> Result<(), String> {
    state
        .engine
        .set_active(active)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ProxyStatusResponse {
    pub running: bool,
    pub active: bool,
    pub active_scripts: Vec<String>,
}
