use crate::common::error::ToTauriError;
use crate::proxy::process::ProxyState;

#[derive(serde::Serialize)]
pub struct ProcessStats {
    pub memory_usage: u64,
    pub cpu_usage: f32,
    pub up_time: u64,
    pub rx_speed: u64,
    pub tx_speed: u64,
}

#[tauri::command]
pub async fn get_process_stats(
    state: tauri::State<'_, ProxyState>,
) -> Result<ProcessStats, String> {
    let mut sys = state.system.lock().unwrap();

    // Refresh network stats
    let mut networks = state.networks.lock().unwrap();
    networks.refresh(false);

    let mut current_rx = 0;
    let mut current_tx = 0;

    for (_interface_name, data) in networks.iter() {
        current_rx += data.received();
        current_tx += data.transmitted();
    }

    let mut last_rx_lock = state.last_rx.lock().unwrap();
    let mut last_tx_lock = state.last_tx.lock().unwrap();
    let mut last_update_lock = state.last_update.lock().unwrap();

    let now = std::time::Instant::now();
    let elapsed = now.duration_since(*last_update_lock).as_secs_f64();

    let mut rx_speed = 0;
    let mut tx_speed = 0;

    if elapsed > 0.1 {
        if *last_rx_lock > 0 {
            rx_speed = (((current_rx as f64 - *last_rx_lock as f64) / elapsed).max(0.0)) as u64;
        }
        if *last_tx_lock > 0 {
            tx_speed = (((current_tx as f64 - *last_tx_lock as f64) / elapsed).max(0.0)) as u64;
        }

        *last_rx_lock = current_rx;
        *last_tx_lock = current_tx;
        *last_update_lock = now;
    }

    let stats = state
        .engine
        .get_stats(&mut sys)
        .map_err(|e| e.to_tauri_error())?;

    Ok(ProcessStats {
        memory_usage: stats.memory_usage,
        cpu_usage: stats.cpu_usage,
        up_time: stats.up_time,
        rx_speed,
        tx_speed,
    })
}
