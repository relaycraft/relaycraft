//! Plugin-scoped KV storage — internal module only, NOT exposed as Tauri commands.
//!
//! All functions receive `plugin_id` injected by `bridge.rs` from an already-verified
//! plugin_call payload. External code cannot forge a different plugin_id through the
//! bridge, so plugins are strictly sandboxed to their own directory.
//!
//! Layout on disk:
//!   {data_dir}/plugins_data/{plugin_id}/{key}.json

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

const MAX_KEY_LEN: usize = 128;
/// Per-value size limit: 1 MB.
const MAX_VALUE_BYTES: usize = 1024 * 1024;
/// Per-plugin key count limit.
const MAX_KEYS_PER_PLUGIN: usize = 1000;
/// Per-plugin total storage limit: 50 MB.
const MAX_TOTAL_BYTES_PER_PLUGIN: u64 = 50 * 1024 * 1024;

/// Validate storage key: only ASCII alphanumeric, `-`, and `_` are allowed.
/// Returns an error rather than silently sanitizing to prevent two different keys
/// from mapping to the same filename (collision attack).
fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("Storage key cannot be empty".to_string());
    }
    if key.len() > MAX_KEY_LEN {
        return Err(format!("Storage key too long (max {} chars)", MAX_KEY_LEN));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "Invalid storage key '{}': only [a-zA-Z0-9-_] are allowed",
            key
        ));
    }
    Ok(())
}

fn storage_dir_in(data_dir: &std::path::Path, plugin_id: &str) -> PathBuf {
    data_dir.join("plugins_data").join(plugin_id)
}

fn storage_dir(plugin_id: &str) -> Result<PathBuf, String> {
    let data_dir = crate::config::get_data_dir()?;
    Ok(storage_dir_in(&data_dir, plugin_id))
}

/// Read a key. Returns `None` when the key does not exist.
pub async fn get(plugin_id: &str, key: &str) -> Result<Option<String>, String> {
    validate_key(key)?;
    let dir = storage_dir(plugin_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{}.json", key));
    if file.exists() {
        Ok(Some(
            std::fs::read_to_string(file).map_err(|e| e.to_string())?,
        ))
    } else {
        Ok(None)
    }
}

/// Write a key (overwrites if already exists).
pub async fn set(plugin_id: &str, key: &str, value: String) -> Result<(), String> {
    validate_key(key)?;
    let dir = storage_dir(plugin_id)?;
    set_in(&dir, key, &value)
}

fn dir_lock(dir: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let map = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .entry(dir.to_path_buf())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Write `key` under an explicit storage directory. Separated from `set` so
/// quota behavior can be tested against a temp dir.
fn set_in(dir: &Path, key: &str, value: &str) -> Result<(), String> {
    let lock = dir_lock(dir);
    let _serial = lock.lock().unwrap_or_else(|e| e.into_inner());

    if value.len() > MAX_VALUE_BYTES {
        return Err(format!(
            "Storage quota exceeded: value is {} bytes, limit is {} bytes (1 MB) per key",
            value.len(),
            MAX_VALUE_BYTES
        ));
    }

    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target_file = dir.join(format!("{}.json", key));

    // Snapshot current usage for the quota checks.
    let mut key_count = 0usize;
    let mut total_bytes = 0u64;
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        if entry.file_name().to_string_lossy().ends_with(".json") {
            key_count += 1;
            total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    let old_value_len = std::fs::metadata(&target_file)
        .map(|m| m.len())
        .unwrap_or(0);
    let replacing = target_file.exists();

    if !replacing && key_count >= MAX_KEYS_PER_PLUGIN {
        return Err(format!(
            "Storage quota exceeded: plugin already has {} keys (limit {})",
            key_count, MAX_KEYS_PER_PLUGIN
        ));
    }

    let new_total = total_bytes - old_value_len + value.len() as u64;
    if new_total > MAX_TOTAL_BYTES_PER_PLUGIN {
        return Err(format!(
            "Storage quota exceeded: plugin storage would grow to {} bytes (currently {} bytes, limit {} bytes / 50 MB)",
            new_total, total_bytes, MAX_TOTAL_BYTES_PER_PLUGIN
        ));
    }

    std::fs::write(target_file, value).map_err(|e| e.to_string())
}

/// Delete a single key. Silently succeeds when the key does not exist.
pub async fn delete(plugin_id: &str, key: &str) -> Result<(), String> {
    validate_key(key)?;
    let file = storage_dir(plugin_id)?.join(format!("{}.json", key));
    if file.exists() {
        std::fs::remove_file(file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// List all keys for this plugin, optionally filtered by a prefix.
/// Returns a sorted slice of key names (without `.json` suffix).
pub async fn list(plugin_id: &str, prefix: Option<&str>) -> Result<Vec<String>, String> {
    let dir = storage_dir(plugin_id)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let prefix = prefix.unwrap_or("");
    let mut keys = vec![];
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if let Some(key) = name.strip_suffix(".json") {
            if key.starts_with(prefix) {
                keys.push(key.to_string());
            }
        }
    }
    keys.sort();
    Ok(keys)
}

/// Remove all stored data for this plugin (used on uninstall or user reset).
pub async fn clear(plugin_id: &str) -> Result<(), String> {
    let data_dir = crate::config::get_data_dir()?;
    remove_plugin_data(&data_dir, plugin_id)
}

/// Remove the entire `{data_dir}/plugins_data/{plugin_id}` directory.
/// Idempotent: succeeds silently when the plugin has no stored data.
pub fn remove_plugin_data(data_dir: &std::path::Path, plugin_id: &str) -> Result<(), String> {
    let dir = storage_dir_in(data_dir, plugin_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        remove_plugin_data, set_in, validate_key, MAX_KEYS_PER_PLUGIN, MAX_TOTAL_BYTES_PER_PLUGIN,
    };

    #[test]
    fn valid_keys_pass() {
        assert!(validate_key("my-key").is_ok());
        assert!(validate_key("collection_abc123").is_ok());
        assert!(validate_key("A").is_ok());
    }

    #[test]
    fn invalid_keys_are_rejected() {
        assert!(validate_key("").is_err());
        assert!(validate_key("a/b").is_err());
        assert!(validate_key("a:b").is_err());
        assert!(validate_key("a b").is_err());
        assert!(validate_key(&"x".repeat(129)).is_err());
    }

    #[test]
    fn set_rejects_value_over_1mb() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path();
        let value = "x".repeat(1024 * 1024 + 1);
        let err = set_in(dir, "big", &value).unwrap_err();
        assert!(err.contains("quota exceeded"), "got: {}", err);
        assert!(err.contains("1 MB"), "got: {}", err);
        assert!(!dir.join("big.json").exists());

        // Exactly 1 MB is allowed.
        let ok_value = "x".repeat(1024 * 1024);
        set_in(dir, "big", &ok_value).unwrap();
    }

    #[test]
    fn set_rejects_beyond_key_count_limit() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path();
        for i in 0..MAX_KEYS_PER_PLUGIN {
            std::fs::write(dir.join(format!("key-{}.json", i)), "{}").unwrap();
        }

        // A new key beyond the limit is rejected with usage + limit in the message.
        let err = set_in(dir, "one-more", "{}").unwrap_err();
        assert!(err.contains("quota exceeded"), "got: {}", err);
        assert!(
            err.contains(&MAX_KEYS_PER_PLUGIN.to_string()),
            "got: {}",
            err
        );
        assert!(!dir.join("one-more.json").exists());

        // Overwriting an existing key stays allowed at the limit.
        set_in(dir, "key-0", "{\"updated\":true}").unwrap();
    }

    #[test]
    fn concurrent_sets_serialize_quota_check() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path().to_path_buf();
        // Leave 80 bytes of headroom under the 50 MB cap.
        let big = std::fs::File::create(dir.join("big.json")).unwrap();
        big.set_len(MAX_TOTAL_BYTES_PER_PLUGIN - 80).unwrap();

        let dir_a = dir.clone();
        let dir_b = dir.clone();
        let a = std::thread::spawn(move || set_in(&dir_a, "extra-a", &"x".repeat(80)));
        let b = std::thread::spawn(move || set_in(&dir_b, "extra-b", &"x".repeat(80)));
        let ra = a.join().expect("thread a");
        let rb = b.join().expect("thread b");

        let successes = [&ra, &rb].iter().filter(|r| r.is_ok()).count();
        assert_eq!(successes, 1, "a={ra:?} b={rb:?}");
        let extras = usize::from(dir.join("extra-a.json").exists())
            + usize::from(dir.join("extra-b.json").exists());
        assert_eq!(extras, 1);
    }

    #[test]
    fn set_rejects_beyond_total_size_limit() {
        let temp = tempfile::TempDir::new().unwrap();
        let dir = temp.path();
        // Pre-fill just under the 50 MB cap with a sparse file.
        let big = std::fs::File::create(dir.join("big.json")).unwrap();
        big.set_len(MAX_TOTAL_BYTES_PER_PLUGIN - 100).unwrap();

        let err = set_in(dir, "extra", &"x".repeat(1024)).unwrap_err();
        assert!(err.contains("quota exceeded"), "got: {}", err);
        assert!(err.contains("50 MB"), "got: {}", err);
        assert!(!dir.join("extra.json").exists());

        // Shrinking the large key frees budget and succeeds.
        set_in(dir, "big", "{}").unwrap();
        set_in(dir, "extra", &"x".repeat(1024)).unwrap();
    }

    #[test]
    fn remove_plugin_data_deletes_existing_directory() {
        let temp = tempfile::TempDir::new().unwrap();
        let data_dir = temp.path();
        let plugin_dir = data_dir.join("plugins_data").join("com.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("key.json"), "{}").unwrap();

        remove_plugin_data(data_dir, "com.example.test").unwrap();
        assert!(!plugin_dir.exists());
    }

    #[test]
    fn remove_plugin_data_is_idempotent_for_missing_directory() {
        let temp = tempfile::TempDir::new().unwrap();
        // No plugins_data directory at all — must succeed silently.
        remove_plugin_data(temp.path(), "com.example.absent").unwrap();
        // Twice for good measure.
        remove_plugin_data(temp.path(), "com.example.absent").unwrap();
    }
}
