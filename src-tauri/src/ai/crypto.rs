use keyring::Entry;
use std::error::Error;
use std::fs;
use std::path::PathBuf;

const SERVICE_NAME: &str = "com.beta.relaycraft";
const API_KEY_NAME: &str = "ai_api_key";

// Simple XOR key for obfuscation (not encryption, just masking)
const MASK_KEY: u8 = 0x5A;

fn get_secret_path(provider: Option<&str>) -> Result<PathBuf, Box<dyn Error>> {
    let dir =
        crate::config::get_data_dir().map_err(|e| format!("Failed to get data dir: {}", e))?;
    let filename = if let Some(p) = provider {
        format!("secrets_{}.dat", p)
    } else {
        "secrets.dat".to_string()
    };
    Ok(dir.join(filename))
}

fn mask_data(data: &str) -> Vec<u8> {
    data.bytes().map(|b| b ^ MASK_KEY).collect()
}

fn unmask_data(data: &[u8]) -> String {
    let bytes: Vec<u8> = data.iter().map(|b| b ^ MASK_KEY).collect();
    String::from_utf8(bytes).unwrap_or_default()
}

fn get_key_name(provider: &str) -> String {
    if provider == "openai" {
        // Legacy compatibility: use old key name for openai to avoid breaking existing users
        API_KEY_NAME.to_string()
    } else {
        format!("{}_{}", API_KEY_NAME, provider)
    }
}

/// Store API key securely in OS keyring (with file fallback)
pub fn store_api_key(provider: &str, key: &str) -> Result<(), Box<dyn Error>> {
    let key_name = get_key_name(provider);

    log::debug!(
        "[KeyStore] Storing API Key (Service: {}, Provider: {}, Key Len: {})",
        SERVICE_NAME,
        provider,
        key.len()
    );

    // 1. Try Keyring
    let entry_res = Entry::new(SERVICE_NAME, &key_name);
    match entry_res {
        Ok(entry) => {
            if let Err(e) = entry.set_password(key) {
                log::error!("Keyring set_password failed: {}", e);
            } else {
                log::info!("Keyring store success");
            }
        }
        Err(e) => log::error!("Keyring entry creation failed: {}", e),
    }

    // 2. Always save to local file as fallback (obfuscated)
    if let Ok(path) = get_secret_path(Some(provider)) {
        let masked = mask_data(key);
        if let Err(e) = fs::write(&path, masked) {
            log::error!("Failed to write fallback secret file: {}", e);
        } else {
            log::debug!("[KeyStore] File Fallback Write: SUCCESS");
        }
    }

    Ok(())
}

/// Retrieve API key from OS keyring (or file fallback)
pub fn retrieve_api_key(provider: &str) -> Result<String, Box<dyn Error>> {
    let key_name = get_key_name(provider);
    log::debug!(
        "[KeyStore] Retrieving API Key (Service: {}, Provider: {})",
        SERVICE_NAME,
        provider
    );

    // 1. Try Keyring first
    let entry = Entry::new(SERVICE_NAME, &key_name);
    if let Ok(ent) = entry {
        if let Ok(pwd) = ent.get_password() {
            log::debug!("[KeyStore] Keyring Retrieve: SUCCESS");
            return Ok(pwd);
        }
    }

    // 2. Try Fallback File (Provider specific)
    if let Ok(path) = get_secret_path(Some(provider)) {
        if path.exists() {
            if let Ok(bytes) = fs::read(&path) {
                let key = unmask_data(&bytes);
                if !key.is_empty() {
                    return Ok(key);
                }
            }
        }
    }

    // 3. Fallback for OpenAI: Try loading legacy secrets.dat if specific failed
    if provider == "openai" {
        if let Ok(path) = get_secret_path(None) {
            if path.exists() {
                if let Ok(bytes) = fs::read(&path) {
                    let key = unmask_data(&bytes);
                    if !key.is_empty() {
                        return Ok(key);
                    }
                }
            }
        }
    }

    Err(format!("No API key found for provider: {}", provider).into())
}

/// Delete API key from OS keyring
pub fn _delete_api_key() -> Result<(), Box<dyn Error>> {
    let entry = Entry::new(SERVICE_NAME, API_KEY_NAME)?;
    entry.delete_credential()?;
    Ok(())
}

/// Check if API key exists in keyring
pub fn _has_api_key() -> bool {
    Entry::new(SERVICE_NAME, API_KEY_NAME)
        .and_then(|e| e.get_password())
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_unmask_logic() {
        let original = "sk-1234567890abcdef";
        let masked = mask_data(original);
        assert_ne!(original.as_bytes(), masked.as_slice());

        let unmasked = unmask_data(&masked);
        assert_eq!(original, unmasked);
    }

    #[test]
    fn test_mask_idempotency() {
        let original = "another-key";
        let masked1 = mask_data(original);
        let masked2 = mask_data(original);
        assert_eq!(masked1, masked2);
    }
}
