use crate::logging;
use crate::session::model::Session;
use std::fs::File;
use std::io::BufWriter;

pub mod har;
pub mod har_model;
pub mod model;

#[tauri::command]
pub async fn save_session(path: String, session: Session) -> Result<(), String> {
    let file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    let writer = BufWriter::new(file);
    serde_json::to_writer(writer, &session)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;
    let _ = logging::write_domain_log("audit", &format!("Saved Session to {}", path));
    Ok(())
}
