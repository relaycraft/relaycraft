use crate::logging;
use anyhow::{Context, Result as AnyResult};
use std::fs;
use std::path::{Path, PathBuf};

mod ca_generator;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;

use ca_generator::generate_ca;

// ---- Shared types ----

#[derive(serde::Serialize, serde::Deserialize, Default, Debug)]
pub struct DetailedCertInfo {
    pub exists: bool,
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub fingerprint: String,
}

/// Platform-specific certificate operations.
pub trait CertManager {
    fn open_cert_dir(&self, cert_dir: &Path) -> Result<(), String>;
    fn is_installed(&self, cert_path: &str) -> Result<bool, String>;
    fn install(&self, cert_path: &str) -> Result<(), String>;
    fn remove(&self) -> Result<(), String>;
    fn get_cert_info(&self, cert_path: &str) -> Result<DetailedCertInfo, String>;
}

#[cfg(target_os = "macos")]
fn platform() -> macos::MacOsCertManager {
    macos::MacOsCertManager
}

#[cfg(target_os = "windows")]
fn platform() -> windows::WindowsCertManager {
    windows::WindowsCertManager
}

#[cfg(target_os = "linux")]
fn platform() -> linux::LinuxCertManager {
    linux::LinuxCertManager
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform() -> UnsupportedCertManager {
    UnsupportedCertManager
}

/// No-op fallback for non-desktop targets (mobile / unknown OS).
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
struct UnsupportedCertManager;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
impl CertManager for UnsupportedCertManager {
    fn open_cert_dir(&self, _cert_dir: &Path) -> Result<(), String> {
        Err("Not supported on this platform".to_string())
    }

    fn is_installed(&self, _cert_path: &str) -> Result<bool, String> {
        Ok(false)
    }

    fn install(&self, _cert_path: &str) -> Result<(), String> {
        Err("MANUAL_STEP".to_string())
    }

    fn remove(&self) -> Result<(), String> {
        Err("MANUAL_STEP".to_string())
    }

    fn get_cert_info(&self, cert_path: &str) -> Result<DetailedCertInfo, String> {
        Ok(DetailedCertInfo {
            exists: Path::new(cert_path).exists(),
            ..Default::default()
        })
    }
}

// ---- Shared utilities ----

pub fn get_cert_dir() -> Result<PathBuf, String> {
    let root_dir = crate::config::get_app_root_dir()?;
    let cert_dir = root_dir.join("certs");
    if !cert_dir.exists() {
        let _ = fs::create_dir_all(&cert_dir);
    }
    Ok(cert_dir)
}

#[tauri::command]
pub fn get_cert_path() -> Result<String, String> {
    let cert_dir = get_cert_dir()?;
    let cert_path = cert_dir.join("relaycraft-ca-cert.pem");
    Ok(cert_path.to_string_lossy().to_string())
}

/// SHA-1 fingerprint of the local RelayCraft CA certificate.
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn local_cert_hash() -> Result<String, String> {
    use base64::prelude::*;
    use sha1::{Digest, Sha1};

    let cert_path = get_cert_path()?;
    let cert_content = fs::read_to_string(&cert_path)
        .map_err(|e| format!("Failed to read local cert: {}", e))?;

    let start_marker = "-----BEGIN CERTIFICATE-----";
    let end_marker = "-----END CERTIFICATE-----";
    if let (Some(start), Some(end)) = (cert_content.find(start_marker), cert_content.find(end_marker))
    {
        let base64_content = &cert_content[start + start_marker.len()..end].trim();
        let clean_base64: String = base64_content.chars().filter(|c| !c.is_whitespace()).collect();
        if let Ok(der_bytes) = BASE64_STANDARD.decode(&clean_base64) {
            let mut hasher = Sha1::new();
            hasher.update(&der_bytes);
            return Ok(hex::encode(hasher.finalize()).to_lowercase());
        }
    }
    Err("Invalid certificate format".to_string())
}

/// Parse certificate details via openssl (macOS / Linux).
#[cfg(not(target_os = "windows"))]
fn cert_info_via_openssl(cert_path: &str) -> Result<DetailedCertInfo, String> {
    use std::process::Command;

    let cmd_result = Command::new("openssl")
        .args(&[
            "x509",
            "-in",
            cert_path,
            "-noout",
            "-subject",
            "-issuer",
            "-dates",
            "-fingerprint",
            "-sha256",
        ])
        .output();

    let output = match cmd_result {
        Ok(out) => out,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Err("OpenSSL not found. Cannot parse certificate details.".to_string());
            }
            return Err(format!("Failed to run openssl: {}", e));
        }
    };

    let out_str = String::from_utf8_lossy(&output.stdout);
    let mut info = DetailedCertInfo {
        exists: true,
        ..Default::default()
    };
    for line in out_str.lines() {
        let line_lower = line.to_lowercase();
        if line_lower.starts_with("subject=") {
            info.subject = line[8..].trim().to_string();
        } else if line_lower.starts_with("issuer=") {
            info.issuer = line[7..].trim().to_string();
        } else if line_lower.starts_with("notbefore=") {
            info.not_before = line[10..].trim().to_string();
        } else if line_lower.starts_with("notafter=") {
            info.not_after = line[9..].trim().to_string();
        } else if line_lower.contains("fingerprint=") {
            if let Some(pos) = line.find('=') {
                info.fingerprint = line[pos + 1..].trim().to_string();
            }
        }
    }
    Ok(info)
}

pub fn ensure_ca_exists(cert_dir: &Path) -> AnyResult<()> {
    if !cert_dir.exists() {
        fs::create_dir_all(cert_dir).context("Failed to create certificate directory")?;
    }

    let ca_pem_path = cert_dir.join("mitmproxy-ca.pem");
    let ca_cert_path = cert_dir.join("mitmproxy-ca-cert.pem");
    let branded_pem_path = cert_dir.join("relaycraft-ca.pem");
    let branded_cert_path = cert_dir.join("relaycraft-ca-cert.pem");

    if !ca_pem_path.exists() || !branded_cert_path.exists() {
        log::info!("Generating RelayCraft CA certificate...");
        let (ca_cert, ca_key) = generate_ca().context("Failed to generate CA certificate")?;

        let combined = format!("{}\n{}", ca_key, ca_cert);

        fs::write(&ca_pem_path, &combined).context("Failed to write mitmproxy-ca.pem")?;
        fs::write(&ca_cert_path, &ca_cert).context("Failed to write mitmproxy-ca-cert.pem")?;

        fs::write(&branded_pem_path, &combined).context("Failed to write relaycraft-ca.pem")?;
        fs::write(&branded_cert_path, &ca_cert)
            .context("Failed to write relaycraft-ca-cert.pem")?;

        let ca_der = pem::parse(&ca_cert)
            .map_err(|e| anyhow::anyhow!("Failed to parse PEM for DER conversion: {}", e))?
            .into_contents();
        let branded_crt_path = cert_dir.join("relaycraft-ca-cert.crt");
        fs::write(&branded_crt_path, &ca_der).context("Failed to write relaycraft-ca-cert.crt")?;
    }

    let legacy_nested = cert_dir.join(".mitmproxy");
    if legacy_nested.exists() {
        let _ = fs::remove_dir_all(legacy_nested);
    }

    #[cfg(target_os = "windows")]
    {
        windows::hide_internal_files(&[
            ca_pem_path.to_string_lossy().to_string(),
            ca_cert_path.to_string_lossy().to_string(),
            branded_pem_path.to_string_lossy().to_string(),
        ]);
    }

    Ok(())
}

// ---- Tauri commands ----

#[tauri::command]
pub fn open_cert_dir() -> Result<(), String> {
    let cert_dir = get_cert_dir()?;

    if !cert_dir.exists() {
        fs::create_dir_all(&cert_dir).map_err(|e| format!("Failed to create cert directory: {}", e))?;
    }

    platform().open_cert_dir(&cert_dir)
}

#[tauri::command]
pub async fn check_cert_installed() -> Result<bool, String> {
    let cert_path = get_cert_path()?;
    platform().is_installed(&cert_path)
}

#[tauri::command]
pub async fn install_cert_automated() -> Result<(), String> {
    let _ = logging::write_domain_log("audit", "Triggered automated certificate installation");
    let cert_path = get_cert_path()?;
    platform().install(&cert_path)
}

#[tauri::command]
pub async fn remove_cert_automated() -> Result<(), String> {
    let _ = logging::write_domain_log("audit", "Triggered automated certificate removal");
    platform().remove()
}

#[tauri::command]
pub async fn regenerate_root_ca(_app: tauri::AppHandle) -> Result<(), String> {
    let cert_dir = get_cert_dir()?;

    if cert_dir.exists() {
        for entry in fs::read_dir(&cert_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with("mitmproxy-ca") || filename.starts_with("relaycraft-ca") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    ensure_ca_exists(&cert_dir).map_err(|e| e.to_string())?;

    let _ = logging::write_domain_log("audit", "Regenerated CA Root");

    Ok(())
}

#[tauri::command]
pub fn get_detailed_cert_info() -> Result<DetailedCertInfo, String> {
    let cert_path = get_cert_path()?;
    let exists = Path::new(&cert_path).exists();

    if !exists {
        return Ok(DetailedCertInfo {
            exists: false,
            ..Default::default()
        });
    }

    platform().get_cert_info(&cert_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_generate_ca() {
        let (cert, key) = generate_ca().expect("Failed to generate CA");
        assert!(cert.contains("BEGIN CERTIFICATE"));
        assert!(key.contains("BEGIN PRIVATE KEY") || key.contains("BEGIN EC PRIVATE KEY"));

        let parsed_pem = pem::parse(&cert).unwrap();
        let cert_bytes = parsed_pem.contents();
        let cert_str = String::from_utf8_lossy(cert_bytes);
        assert!(cert_str.contains("RelayCraft Root CA"));
    }

    #[test]
    fn test_generate_ca_properties() {
        let result = generate_ca();
        assert!(result.is_ok());
    }

    #[test]
    fn test_ensure_ca_exists() {
        let temp = TempDir::new().expect("Failed to create temp dir");
        let cert_dir = temp.path();

        ensure_ca_exists(cert_dir).expect("Failed to ensure CA exists");

        let files = [
            "mitmproxy-ca.pem",
            "mitmproxy-ca-cert.pem",
            "relaycraft-ca.pem",
            "relaycraft-ca-cert.pem",
        ];

        for file in &files {
            assert!(cert_dir.join(file).exists(), "Missing file: {}", file);
        }

        // Test idempotency
        let mtime_orig = fs::metadata(cert_dir.join("relaycraft-ca-cert.pem"))
            .unwrap()
            .modified()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        ensure_ca_exists(cert_dir).expect("Second call failed");
        let mtime_new = fs::metadata(cert_dir.join("relaycraft-ca-cert.pem"))
            .unwrap()
            .modified()
            .unwrap();

        assert_eq!(
            mtime_orig, mtime_new,
            "Files should not be overwritten if they exist"
        );
    }
}
