/**
 * API Key Storage - File-based with XOR obfuscation.
 *
 * XOR is NOT encryption — goal is to avoid accidental exposure (e.g. screen sharing),
 * not protect against attackers with filesystem access.
 * Acceptable for a local dev tool; avoids OS keyring prompts.
 */
use std::error::Error;
use std::fs;
use std::path::PathBuf;

// Simple XOR key for obfuscation (not encryption, just masking)
const MASK_KEY: u8 = 0x5A;

fn get_secret_path(provider: &str) -> Result<PathBuf, Box<dyn Error>> {
    let data_dir =
        crate::config::get_data_dir().map_err(|e| format!("Failed to get data dir: {}", e))?;
    let secrets_dir = data_dir.join("secrets");

    // Create secrets directory if needed
    if !secrets_dir.exists() {
        std::fs::create_dir_all(&secrets_dir)?;
    }

    let filename = format!("{}.dat", provider);
    Ok(secrets_dir.join(filename))
}

fn mask_data(data: &str) -> Vec<u8> {
    data.bytes().map(|b| b ^ MASK_KEY).collect()
}

fn unmask_data(data: &[u8]) -> String {
    let bytes: Vec<u8> = data.iter().map(|b| b ^ MASK_KEY).collect();
    String::from_utf8(bytes).unwrap_or_default()
}

/// Store API key in local file (with XOR obfuscation)
pub fn store_api_key(provider: &str, key: &str) -> Result<(), Box<dyn Error>> {
    log::debug!(
        "[KeyStore] Storing API Key (Provider: {}, Key Len: {})",
        provider,
        key.len()
    );

    let path = get_secret_path(provider)?;
    let masked = mask_data(key);
    fs::write(&path, masked)?;
    log::info!(
        "[KeyStore] API Key stored successfully for provider: {}",
        provider
    );

    Ok(())
}

/// Retrieve API key from local file
pub fn retrieve_api_key(provider: &str) -> Result<String, Box<dyn Error>> {
    log::debug!("[KeyStore] Retrieving API Key (Provider: {})", provider);

    let path = get_secret_path(provider)?;
    if !path.exists() {
        return Err(format!("No API key found for provider: {}", provider).into());
    }

    let bytes = fs::read(&path)?;
    let key = unmask_data(&bytes);

    if key.is_empty() {
        return Err(format!("API key file is empty for provider: {}", provider).into());
    }

    log::debug!(
        "[KeyStore] API Key retrieved successfully for provider: {}",
        provider
    );
    Ok(key)
}

/// Delete API key file
#[allow(dead_code)]
pub fn delete_api_key(provider: &str) -> Result<(), Box<dyn Error>> {
    let path = get_secret_path(provider)?;
    if path.exists() {
        fs::remove_file(&path)?;
        log::info!("[KeyStore] API Key deleted for provider: {}", provider);
    }
    Ok(())
}

/// Check if API key exists
#[allow(dead_code)]
pub fn has_api_key(provider: &str) -> bool {
    get_secret_path(provider)
        .map(|p| p.exists())
        .unwrap_or(false)
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
