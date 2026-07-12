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

    // Clean up old logs on startup (safe: only removes known log file types)
    let logs_path = path.join("logs");
    cleanup_old_logs(&logs_path);

    // Spawn background worker
    if let Err(e) = thread::Builder::new()
        .name("rc-log-writer".into())
        .spawn(move || {
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
                let file = match file_cache.entry(file_key) {
                    std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
                    std::collections::hash_map::Entry::Vacant(e) => {
                        let result = OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&file_path)
                            .or_else(|_| File::create(&file_path));
                        match result {
                            Ok(f) => e.insert(f),
                            Err(err) => {
                                eprintln!(
                                    "Failed to open log file {}: {}",
                                    file_path.display(),
                                    err
                                );
                                continue;
                            }
                        }
                    }
                };

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
                    // If write fails, try to reopen next time
                }
            }
        })
    {
        eprintln!("Failed to spawn log writer thread: {}", e);
    }
}

/// Clean up old log files on startup
/// SAFETY: Only processes known log file types, never touches other files
fn cleanup_old_logs(log_dir: &std::path::Path) {
    if !log_dir.exists() {
        return;
    }

    // ONLY process these known log file types - whitelist approach for safety
    const KNOWN_LOG_TYPES: &[&str] = &["audit", "script", "plugin", "crash", "engine", "app"];

    const MAX_FILES_PER_TYPE: usize = 5; // Keep 5 most recent files per log type

    for log_type in KNOWN_LOG_TYPES {
        // Find all files matching this log type (e.g., audit.log, audit.log.1, etc.)
        let mut files: Vec<std::path::PathBuf> = Vec::new();

        if let Ok(entries) = std::fs::read_dir(log_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    // Strict matching: only match "X.log" or "X.log.N" where X is the log type
                    let is_match = filename == format!("{}.log", log_type)
                        || filename.starts_with(&format!("{}.log.", log_type));

                    if is_match {
                        files.push(path);
                    }
                }
            }
        }

        if files.len() <= MAX_FILES_PER_TYPE {
            continue; // No cleanup needed
        }

        // Sort by modification time (newest first)
        files.sort_by(|a, b| {
            let time_a = std::fs::metadata(a)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let time_b = std::fs::metadata(b)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            time_b.cmp(&time_a)
        });

        // Remove oldest files beyond the limit
        for old_file in files.iter().skip(MAX_FILES_PER_TYPE) {
            // Extra safety: verify it's still a valid log file before deletion
            if let Some(filename) = old_file.file_name().and_then(|n| n.to_str()) {
                if filename.starts_with(&format!("{}.", log_type)) && filename.contains(".log") {
                    if let Err(e) = std::fs::remove_file(old_file) {
                        eprintln!("[LogCleanup] Failed to remove {:?}: {}", old_file, e);
                    } else {
                        eprintln!("[LogCleanup] Removed old log: {}", filename);
                    }
                }
            }
        }
    }
    // Note: We do NOT truncate files - too risky. Just remove old rotated files.
}

/// Setup panic hook to log crashes to crash.log
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
    // Fallback if logger not initialized
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

    // Read only the tail of the file to avoid reading the entire file
    let result = tokio::task::spawn_blocking(move || read_last_n_lines(&log_path, lines))
        .await
        .map_err(|e| e.to_string())?;

    result.map_err(|e| e.to_string())
}

/// Read the last `n` lines from a file by seeking backwards in chunks.
/// Avoids reading the entire file, making it fast even for very large logs.
fn read_last_n_lines(path: &std::path::Path, n: usize) -> std::io::Result<Vec<String>> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path)?;
    let file_size = file.metadata()?.len() as usize;

    if file_size == 0 || n == 0 {
        return Ok(vec![]);
    }

    const CHUNK_SIZE: usize = 8192;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut lines_count = 0usize;
    let mut pos = file_size;
    let mut fragments: Vec<Vec<u8>> = vec![];

    // Read backwards in chunks until we have at least n lines or hit the beginning
    while pos > 0 && lines_count <= n {
        let read_size = CHUNK_SIZE.min(pos);
        pos -= read_size;
        file.seek(SeekFrom::Start(pos as u64))?;
        file.read_exact(&mut buf[..read_size])?;
        for &byte in &buf[..read_size] {
            if byte == b'\n' {
                lines_count += 1;
            }
        }
        fragments.push(buf[..read_size].to_vec());
    }

    // Reassemble in forward order
    let mut full = Vec::with_capacity(fragments.len() * CHUNK_SIZE);
    for frag in fragments.iter().rev() {
        full.extend_from_slice(frag);
    }

    let text = String::from_utf8_lossy(&full);
    let mut all_lines: Vec<String> = text.split('\n').map(|s| s.to_string()).collect();

    // Remove trailing empty string from trailing newline
    if all_lines.last().map_or(false, |l| l.is_empty()) {
        all_lines.pop();
    }

    let start = all_lines.len().saturating_sub(n);
    Ok(all_lines[start..].to_vec())
}
