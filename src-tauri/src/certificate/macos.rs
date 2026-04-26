use super::CertManager;
use std::path::Path;
use std::process::Command;

pub struct MacOsCertManager;

impl CertManager for MacOsCertManager {
    fn open_cert_dir(&self, cert_dir: &Path) -> Result<(), String> {
        Command::new("open")
            .arg(cert_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
        Ok(())
    }

    fn is_installed(&self, cert_path: &str) -> Result<bool, String> {
        let cert_file = Path::new(cert_path);

        if cert_file.exists() {
            let verify_out = Command::new("security")
                .args(&[
                    "verify-cert",
                    "-p",
                    "ssl",
                    "-c",
                    &cert_file.to_string_lossy(),
                    "-L", // Local (non-network) certificate check
                ])
                .output();

            if let Ok(out) = verify_out {
                if out.status.success() {
                    return Ok(true);
                } else {
                    log::debug!(
                        "macOS Cert verify failed: {}",
                        String::from_utf8_lossy(&out.stderr)
                    );
                }
            }
        }

        Ok(false)
    }

    fn install(&self, cert_path: &str) -> Result<(), String> {
        let _ = Command::new("open")
            .arg(cert_path)
            .spawn()
            .map_err(|e| format!("Failed to open certificate: {}", e))?;

        // On macOS 15+, automated trust is often blocked in dev/bundle environments.
        // Opening the certificate file triggers Keychain Access for manual trust.
        Err("MANUAL_STEP".to_string())
    }

    fn remove(&self) -> Result<(), String> {
        let _ = Command::new("open")
            .arg("-b")
            .arg("com.apple.keychainaccess")
            .spawn();

        Err("MANUAL_STEP".to_string())
    }

    fn get_cert_info(&self, cert_path: &str) -> Result<super::DetailedCertInfo, String> {
        super::cert_info_via_openssl(cert_path)
    }
}
