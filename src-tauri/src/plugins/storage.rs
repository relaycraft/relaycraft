//! Plugin-scoped KV storage — internal module only, NOT exposed as Tauri commands.
//!
//! All functions receive `plugin_id` injected by `bridge.rs` from an already-verified
//! plugin_call payload. External code cannot forge a different plugin_id through the
//! bridge, so plugins are strictly sandboxed to their own directory.
//!
//! Layout on disk:
//!   {data_dir}/plugins_data/{plugin_id}/{key}.json

use std::path::PathBuf;

const MAX_KEY_LEN: usize = 128;

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

fn storage_dir(plugin_id: &str) -> Result<PathBuf, String> {
    let data_dir = crate::config::get_data_dir()?;
    Ok(data_dir.join("plugins_data").join(plugin_id))
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
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{}.json", key)), value).map_err(|e| e.to_string())
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
    let dir = storage_dir(plugin_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_key;

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
}
