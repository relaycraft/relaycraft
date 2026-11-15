pub mod engine;
pub mod monitor;
pub mod paths;
pub mod process;

pub use engine::*;
pub use monitor::*;
pub use process::*;

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

    // engine.start() is synchronous and can block for up to ~120s while it
    // polls for engine readiness; run it off the async runtime worker.
    let engine = state.engine.clone();
    tokio::task::spawn_blocking(move || engine.start(&app, &config))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_tauri_error())?;

    Ok("Proxy started".to_string())
}

#[tauri::command]
pub async fn stop_proxy(state: tauri::State<'_, ProxyState>) -> Result<String, String> {
    // engine.stop() blocks while waiting for process teardown; keep it off
    // the async runtime worker.
    let engine = state.engine.clone();
    tokio::task::spawn_blocking(move || engine.stop())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_tauri_error())?;

    Ok("Proxy stopped".to_string())
}

#[tauri::command]
pub async fn restart_proxy(
    app: AppHandle,
    state: tauri::State<'_, ProxyState>,
) -> Result<String, String> {
    // Load configuration
    let config = config::load_config()?;

    // Stop first, then start (this reloads scripts). Both engine calls are
    // synchronous and potentially long-blocking, so they run off the async
    // runtime worker.
    let engine = state.engine.clone();
    tokio::task::spawn_blocking(move || {
        engine.stop()?;
        engine.start(&app, &config)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_tauri_error())?;

    Ok("Proxy restarted".to_string())
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
    state.engine.set_active(active).map_err(|e| e.to_string())?;
    Ok(())
}

/// Current per-process capture scope (in-memory only, resets on app restart).
#[tauri::command]
pub async fn get_capture_scope(
    state: tauri::State<'_, ProxyState>,
) -> Result<CaptureScope, String> {
    Ok(state.engine.get_capture_scope())
}

/// Apply a new capture scope; returns the normalized value actually stored.
/// When the engine is running, waits for `/_relay/capture_scope` to confirm;
/// on failure the stored scope is reverted so host state always reflects
/// what the engine applies.
#[tauri::command]
pub async fn set_capture_scope(
    state: tauri::State<'_, ProxyState>,
    scope: CaptureScope,
) -> Result<CaptureScope, String> {
    let engine = state.engine.clone();
    let previous = engine.get_capture_scope();
    engine.set_capture_scope(scope).map_err(|e| e.to_string())?;

    if let Some(port) = engine.running_port() {
        let applied = engine.get_capture_scope();
        let url = format!("http://127.0.0.1:{}/_relay/capture_scope", port);
        let body = serde_json::to_string(&applied)
            .unwrap_or_else(|_| "{\"include\":[],\"exclude\":[]}".to_string());
        let result = crate::common::http::loopback_client()
            .post(&url)
            .header("Content-Type", "application/json")
            .body(body)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;
        let ok = matches!(result, Ok(ref resp) if resp.status().is_success());
        if !ok {
            let detail = match result {
                Ok(resp) => format!("HTTP {}", resp.status()),
                Err(e) => e.to_string(),
            };
            log::warn!(
                "Capture scope push to engine failed ({}); reverting",
                detail
            );
            let _ = engine.set_capture_scope(previous);
            return Err(format!(
                "Failed to apply capture scope to the running engine: {}",
                detail
            ));
        }
    }

    Ok(engine.get_capture_scope())
}

/// Check whether a local TCP port is free to bind (used by the share entry UI).
#[tauri::command]
pub fn check_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Prepare updater installation by aggressively releasing engine file locks.
/// Force-kills leftover engine processes as a fallback, matched by the exact
/// resolved engine binary path so unrelated processes are never touched.
#[tauri::command]
pub async fn prepare_update_install(
    app: AppHandle,
    state: tauri::State<'_, ProxyState>,
) -> Result<(), String> {
    let _ = state.engine.terminate();

    if let Ok(engine_path) = paths::get_engine_path(&app) {
        crate::common::process::kill_engine_processes_by_path(&engine_path);
    }

    // Give OS process teardown a brief moment before updater writes files.
    // Async sleep — must not block the runtime worker thread.
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct ProxyStatusResponse {
    pub running: bool,
    pub active: bool,
    pub active_scripts: Vec<String>,
}
