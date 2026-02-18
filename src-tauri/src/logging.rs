use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::panic;
use std::path::PathBuf;
use std::sync::{mpsc, Mutex};
use std::thread;

// Log entry structure
struct LogEntry {
    domain: String,
    message: String,
    timestamp: String,
}

lazy_static::lazy_static! {
    static ref LOG_TX: Mutex<Option<mpsc::Sender<LogEntry>>> = Mutex::new(None);
    static ref LOG_DIR_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
}

/// Initialize the log directory and start the background logger thread
pub fn init_log_dir(path: PathBuf) {
    // Store path for panic hook
    if let Ok(mut dir) = LOG_DIR_PATH.lock() {
        *dir = Some(path.clone());
    }

    // Create channel
    let (tx, rx) = mpsc::channel::<LogEntry>();

    // Store sender
    if let Ok(mut global_tx) = LOG_TX.lock() {
        *global_tx = Some(tx);
    }

    // Spawn background worker
    thread::spawn(move || {
        let mut file_cache: HashMap<String, File> = HashMap::new();
        let log_dir = path.join("logs");

        if !log_dir.exists() {
            let _ = std::fs::create_dir_all(&log_dir);
        }

        while let Ok(entry) = rx.recv() {
            let filename = match entry.domain.as_str() {
                "audit" => "audit.log",
                "script" => "script.log",
                "plugin" => "plugin.log",
                "crash" => "crash.log",
                "proxy" => "engine.log",
                _ => "custom.log",
            };

            let file_path = log_dir.join(filename);
            let file_key = filename.to_string();

            // Get or open file handle
            let file = file_cache.entry(file_key).or_insert_with(|| {
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&file_path)
                    .unwrap_or_else(|_| File::create(&file_path).unwrap()) // Fallback
            });

            // Standardize prefixing
            let domain_prefix = match entry.domain.as_str() {
                "audit" => "[AUDIT]",
                "script" => "[SCRIPT]",
                "plugin" => "[PLUGIN]",
                "crash" => "[CRASH]",
                _ => "",
            };

            let final_message =
                if !domain_prefix.is_empty() && !entry.message.contains(domain_prefix) {
                    format!("{} {}", domain_prefix, entry.message)
                } else {
                    entry.message
                };

            if let Err(e) = writeln!(file, "[{}] {}", entry.timestamp, final_message) {
                eprintln!("Failed to write log: {}", e);
                // If write fails, try to reopen next time (remove from cache)
                // Note: In a real implementation, we might want more robust error handling
            }
        }
    });
}

/// Setup panic hook to log crashes to crash.log
/// Note: Panic hook runs in the crashing thread, so we avoid using the channel
/// to ensure we can write even if the channel/logger thread is dead or deadlocked.
pub fn setup_panic_hook() {
    panic::set_hook(Box::new(|info| {
        let msg = format!(
            "{}\nBacktrace: {:?}\n",
            info,
            std::backtrace::Backtrace::capture()
        );
        eprintln!("{}", msg); // Always print to stderr

        // Direct file write for panics
        if let Ok(guard) = LOG_DIR_PATH.lock() {
            if let Some(ref dir) = *guard {
                let crash_file = dir.join("logs").join("crash.log");
                if let Some(parent) = crash_file.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                if let Ok(mut file) = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(crash_file)
                {
                    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                    let _ = writeln!(file, "[{}] {}", timestamp, msg);
                }
            }
        }
    }));
}

/// Queue a message to be written to a specialized domain log file
pub fn write_domain_log(domain: &str, message: &str) -> std::io::Result<()> {
    if let Ok(guard) = LOG_TX.lock() {
        if let Some(tx) = &*guard {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let _ = tx.send(LogEntry {
                domain: domain.to_string(),
                message: message.to_string(),
                timestamp,
            });
            return Ok(());
        }
    }
    // Fallback if logger not initialized (should rarely happen after startup)
    Err(std::io::Error::new(
        std::io::ErrorKind::Other,
        "Logger not initialized",
    ))
}

#[tauri::command]
pub fn log_domain_event(domain: String, message: String) {
    let _ = write_domain_log(&domain, &message);
}

#[tauri::command]
pub async fn get_logs(log_name: String, lines: usize) -> Result<Vec<String>, String> {
    let root_dir = crate::config::get_app_root_dir()?;
    let log_dir = root_dir.join("logs");
    let log_filename = match log_name.as_str() {
        "proxy" => "engine.log",
        "app" => "app.log",
        "audit" => "audit.log",
        "script" => "script.log",
        "plugin" => "plugin.log",
        "crash" => "crash.log",
        _ => return Err(format!("Unknown log name: {}", log_name)),
    };

    let log_path = log_dir.join(log_filename);

    if !log_path.exists() {
        return Ok(vec![format!("Log file {} not found.", log_filename)]);
    }

    let temp_dir = std::env::temp_dir();
    let temp_filename = format!(
        "{}_snap_{}.txt",
        log_filename,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let temp_path = temp_dir.join(temp_filename);

    let mut attempts = 0;
    while attempts < 3 {
        match std::fs::copy(&log_path, &temp_path) {
            Ok(_) => break,
            Err(_) => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }

    if !temp_path.exists() {
        return Ok(vec![format!("Could not read logs (File locked).")]);
    }

    let file = std::fs::File::open(&temp_path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    use std::io::BufRead;
    let mut all_lines = Vec::new();
    for line_result in reader.split(b'\n') {
        if let Ok(bytes) = line_result {
            all_lines.push(String::from_utf8_lossy(&bytes).into_owned());
        }
    }
    let _ = std::fs::remove_file(&temp_path);
    let count = all_lines.len();
    if count == 0 {
        return Ok(vec![]);
    }
    let skip = count.saturating_sub(lines);
    Ok(all_lines.into_iter().skip(skip).collect())
}
