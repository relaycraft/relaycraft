use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::panic;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

/// Max size of a single domain log file before it is rotated.
const MAX_LOG_FILE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
/// Rotated generations kept per log file (X.log.1 .. X.log.N).
const MAX_ROTATED_GENERATIONS: u32 = 3;
/// Bounded queue between log producers and the writer thread. Logs may be
/// dropped under pressure; they must never block callers or grow memory.
const LOG_CHANNEL_CAPACITY: usize = 10_000;
/// Cap for the panic-hook message appended to crash.log.
const MAX_PANIC_MESSAGE_BYTES: usize = 64 * 1024;

// Log entry structure
struct LogEntry {
    domain: String,
    message: String,
    timestamp: String,
}

static LOG_TX: Mutex<Option<mpsc::SyncSender<LogEntry>>> = Mutex::new(None);
static LOG_DIR_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static DROPPED_LOG_COUNT: AtomicU64 = AtomicU64::new(0);

/// Initialize the log directory and start the background logger thread
pub fn init_log_dir(path: PathBuf) {
    // Store path for panic hook
    if let Ok(mut dir) = LOG_DIR_PATH.lock() {
        *dir = Some(path.clone());
    }

    // Create bounded channel: when full, producers drop the new entry
    // (see write_domain_log) instead of blocking or growing memory.
    let (tx, rx) = mpsc::sync_channel::<LogEntry>(LOG_CHANNEL_CAPACITY);

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
            // Cached file handles plus the current size of each file, so the
            // size-based rotation check below costs no extra syscalls.
            let mut file_cache: HashMap<String, (File, u64)> = HashMap::new();
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

                let line = format!("[{}] {}\n", entry.timestamp, final_message);

                // Rotate before writing when this line would push the file past
                // the size cap. Rotation produces X.log.N files, which the
                // startup cleanup_old_logs pass then garbage-collects.
                let current_size = match file_cache.get(&file_key) {
                    Some((_, size)) => *size,
                    None => std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0),
                };
                if current_size > 0 && current_size + line.len() as u64 > MAX_LOG_FILE_BYTES {
                    // Close the handle before renaming the file underneath it.
                    file_cache.remove(&file_key);
                    if let Err(e) = rotate_log_file(&file_path, MAX_ROTATED_GENERATIONS) {
                        eprintln!("Failed to rotate log file {}: {}", file_path.display(), e);
                    }
                }

                // Get or open file handle
                let (file, size) = match file_cache.entry(file_key) {
                    std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
                    std::collections::hash_map::Entry::Vacant(e) => {
                        let result = OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&file_path)
                            .or_else(|_| File::create(&file_path));
                        match result {
                            Ok(f) => {
                                let size = f.metadata().map(|m| m.len()).unwrap_or(0);
                                e.insert((f, size))
                            }
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

                if let Err(e) = file.write_all(line.as_bytes()) {
                    eprintln!("Failed to write log: {}", e);
                    // If write fails, try to reopen next time
                } else {
                    *size += line.len() as u64;
                }
            }
        })
    {
        eprintln!("Failed to spawn log writer thread: {}", e);
    }
}

/// Rotate `path` to `path.1`, shifting existing generations up
/// (`.1`→`.2`, ...); the oldest generation beyond `max_generations` is
/// deleted. No-op when `path` does not exist.
fn rotate_log_file(path: &Path, max_generations: u32) -> std::io::Result<()> {
    if max_generations == 0 {
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        return Ok(());
    }
    let oldest = rotated_path(path, max_generations);
    if oldest.exists() {
        std::fs::remove_file(&oldest)?;
    }
    for gen in (1..max_generations).rev() {
        let from = rotated_path(path, gen);
        if from.exists() {
            std::fs::rename(&from, rotated_path(path, gen + 1))?;
        }
    }
    if path.exists() {
        std::fs::rename(path, rotated_path(path, 1))?;
    }
    Ok(())
}

/// `engine.log` + generation 2 → `engine.log.2`
fn rotated_path(path: &Path, generation: u32) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{}", generation));
    PathBuf::from(name)
}

/// Clean up old log files on startup
/// SAFETY: Only processes known log file types, never touches other files
fn cleanup_old_logs(log_dir: &std::path::Path) {
    if !log_dir.exists() {
        return;
    }

    // ONLY process these known log file types - whitelist approach for safety
    const KNOWN_LOG_TYPES: &[&str] = &[
        "audit", "script", "plugin", "crash", "engine", "app", "custom",
    ];

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
        let mut msg = format!(
            "{}\nBacktrace: {:?}\n",
            info,
            std::backtrace::Backtrace::capture()
        );
        // Cap the appended payload so a pathological backtrace cannot blow up
        // crash.log in a single write.
        if msg.len() > MAX_PANIC_MESSAGE_BYTES {
            let mut end = MAX_PANIC_MESSAGE_BYTES;
            while !msg.is_char_boundary(end) {
                end -= 1;
            }
            msg.truncate(end);
            msg.push_str("\n[truncated]\n");
        }
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

/// Queue a message to be written to a specialized domain log file.
///
/// The queue is bounded: when full (e.g. the writer thread is stalled on a
/// slow/full disk), the new entry is dropped and counted rather than
/// blocking the caller or growing memory. Logs are best-effort.
pub fn write_domain_log(domain: &str, message: &str) -> std::io::Result<()> {
    if let Ok(guard) = LOG_TX.lock() {
        if let Some(tx) = &*guard {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let entry = LogEntry {
                domain: domain.to_string(),
                message: message.to_string(),
                timestamp,
            };
            // Audit must not be silently dropped: retry try_send for a short
            // window. Other domains stay best-effort.
            if domain == "audit" {
                let deadline = std::time::Instant::now() + Duration::from_secs(2);
                let mut pending = entry;
                loop {
                    match tx.try_send(pending) {
                        Ok(()) => return Ok(()),
                        Err(mpsc::TrySendError::Disconnected(_)) => {
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::BrokenPipe,
                                "Log writer thread is gone",
                            ));
                        }
                        Err(mpsc::TrySendError::Full(returned)) => {
                            if std::time::Instant::now() >= deadline {
                                DROPPED_LOG_COUNT.fetch_add(1, Ordering::Relaxed);
                                return Err(std::io::Error::new(
                                    std::io::ErrorKind::TimedOut,
                                    "Audit log writer queue full",
                                ));
                            }
                            pending = returned;
                            thread::sleep(Duration::from_millis(10));
                        }
                    }
                }
            }

            return match tx.try_send(entry) {
                Ok(()) => Ok(()),
                Err(mpsc::TrySendError::Full(_)) => {
                    let dropped = DROPPED_LOG_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
                    // Log occasionally so a stalled writer is visible without
                    // flooding stderr.
                    if dropped == 1 || dropped % 1000 == 0 {
                        eprintln!(
                            "[Logging] writer queue full; dropped {} log entries so far",
                            dropped
                        );
                    }
                    Ok(())
                }
                Err(mpsc::TrySendError::Disconnected(_)) => Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "Log writer thread is gone",
                )),
            };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotate_shifts_generations_and_deletes_oldest() {
        let temp = tempfile::TempDir::new().unwrap();
        let log = temp.path().join("engine.log");
        std::fs::write(&log, "current").unwrap();
        std::fs::write(rotated_path(&log, 1), "gen1").unwrap();
        std::fs::write(rotated_path(&log, 2), "gen2").unwrap();
        std::fs::write(rotated_path(&log, 3), "gen3").unwrap();

        rotate_log_file(&log, 3).unwrap();

        assert!(!log.exists());
        assert_eq!(
            std::fs::read_to_string(rotated_path(&log, 1)).unwrap(),
            "current"
        );
        assert_eq!(
            std::fs::read_to_string(rotated_path(&log, 2)).unwrap(),
            "gen1"
        );
        assert_eq!(
            std::fs::read_to_string(rotated_path(&log, 3)).unwrap(),
            "gen2"
        );
        assert!(!rotated_path(&log, 4).exists());
    }

    #[test]
    fn rotate_fills_gaps_when_generations_are_missing() {
        let temp = tempfile::TempDir::new().unwrap();
        let log = temp.path().join("audit.log");
        std::fs::write(&log, "current").unwrap();
        // Only .2 exists — .1 missing must not break the shift.
        std::fs::write(rotated_path(&log, 2), "gen2").unwrap();

        rotate_log_file(&log, 3).unwrap();

        assert!(!log.exists());
        assert_eq!(
            std::fs::read_to_string(rotated_path(&log, 1)).unwrap(),
            "current"
        );
        assert!(!rotated_path(&log, 2).exists());
        assert_eq!(
            std::fs::read_to_string(rotated_path(&log, 3)).unwrap(),
            "gen2"
        );
    }

    #[test]
    fn rotate_is_noop_when_file_is_missing() {
        let temp = tempfile::TempDir::new().unwrap();
        let log = temp.path().join("missing.log");
        rotate_log_file(&log, 3).unwrap();
        assert!(!log.exists());
        assert!(!rotated_path(&log, 1).exists());
    }

    #[test]
    fn rotated_path_appends_generation_suffix() {
        let log = Path::new("/tmp/engine.log");
        assert_eq!(rotated_path(log, 1), PathBuf::from("/tmp/engine.log.1"));
    }
}
