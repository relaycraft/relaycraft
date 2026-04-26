use super::CertManager;
use std::fs;
use std::path::Path;
use std::process::Command;

pub struct LinuxCertManager;

impl CertManager for LinuxCertManager {
    fn open_cert_dir(&self, cert_dir: &Path) -> Result<(), String> {
        Command::new("xdg-open")
            .arg(cert_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
        Ok(())
    }

    fn is_installed(&self, _cert_path: &str) -> Result<bool, String> {
        let local_hash = super::local_cert_hash().unwrap_or_default().to_uppercase();
        if local_hash.is_empty() {
            return Ok(false);
        }

        let common_bundles = [
            "/etc/ssl/certs/ca-certificates.crt",         // Debian, Ubuntu, Gentoo, Arch
            "/etc/pki/tls/certs/ca-bundle.crt",           // RedHat, Fedora, CentOS
            "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", // Newer RHEL/Fedora
            "/etc/ssl/ca-bundle.pem",                     // OpenSUSE
        ];

        for bundle_path in &common_bundles {
            if let Ok(bundle) = fs::read_to_string(bundle_path) {
                let cert_path = super::get_cert_path()?;
                if let Ok(local_content) = fs::read_to_string(&cert_path) {
                    if bundle.contains(local_content.trim()) {
                        return Ok(true);
                    }
                }
            }
        }

        // Also check hashed directory /etc/ssl/certs
        let hashed_dir = "/etc/ssl/certs";
        if Path::new(hashed_dir).exists() {
            let possible_locations = [
                "/etc/ssl/certs/RelayCraft_CA.pem",
                "/usr/local/share/ca-certificates/RelayCraft_CA.crt",
                "/etc/pki/ca-trust/source/anchors/RelayCraft_CA.crt",
            ];
            for path in &possible_locations {
                if Path::new(path).exists() {
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }

    fn install(&self, cert_path: &str) -> Result<(), String> {
        let is_debian = Path::new("/usr/local/share/ca-certificates").exists();
        let is_rhel = Path::new("/etc/pki/ca-trust/source/anchors").exists();

        if is_debian {
            let dest = "/usr/local/share/ca-certificates/relaycraft-ca.crt";
            let is_root = unsafe { libc::geteuid() == 0 };

            if is_root {
                std::fs::copy(cert_path, dest).map_err(|e| e.to_string())?;
                Command::new("update-ca-certificates")
                    .output()
                    .map_err(|e| e.to_string())?;
            } else {
                let status = Command::new("pkexec")
                    .args([
                        "sh",
                        "-c",
                        &format!("cp '{}' '{}' && update-ca-certificates", cert_path, dest),
                    ])
                    .status()
                    .map_err(|e| format!("Failed to execute pkexec: {}", e))?;

                if !status.success() {
                    return Err("User cancelled authorization or installation failed".to_string());
                }
            }
        } else if is_rhel {
            let dest = "/etc/pki/ca-trust/source/anchors/relaycraft-ca.crt";
            let is_root = unsafe { libc::geteuid() == 0 };

            if is_root {
                std::fs::copy(cert_path, dest).map_err(|e| e.to_string())?;
                Command::new("update-ca-trust")
                    .output()
                    .map_err(|e| e.to_string())?;
            } else {
                let status = Command::new("pkexec")
                    .args([
                        "sh",
                        "-c",
                        &format!("cp '{}' '{}' && update-ca-trust", cert_path, dest),
                    ])
                    .status()
                    .map_err(|e| format!("Failed to execute pkexec: {}", e))?;

                if !status.success() {
                    return Err("User cancelled authorization or installation failed".to_string());
                }
            }
        } else {
            return Err("MANUAL_STEP".to_string());
        }
        Ok(())
    }

    fn remove(&self) -> Result<(), String> {
        let is_debian = Path::new("/usr/local/share/ca-certificates").exists();
        let is_rhel = Path::new("/etc/pki/ca-trust/source/anchors").exists();

        if is_debian {
            let target = "/usr/local/share/ca-certificates/relaycraft-ca.crt";
            if Path::new(target).exists() {
                let is_root = unsafe { libc::geteuid() == 0 };
                if is_root {
                    std::fs::remove_file(target).map_err(|e| e.to_string())?;
                    Command::new("update-ca-certificates")
                        .output()
                        .map_err(|e| e.to_string())?;
                } else {
                    let status = Command::new("pkexec")
                        .args([
                            "sh",
                            "-c",
                            &format!("rm -f '{}' && update-ca-certificates", target),
                        ])
                        .status()
                        .map_err(|e| e.to_string())?;
                    if !status.success() {
                        return Err("Certificate removal failed".to_string());
                    }
                }
            }
        } else if is_rhel {
            let target = "/etc/pki/ca-trust/source/anchors/relaycraft-ca.crt";
            if Path::new(target).exists() {
                let is_root = unsafe { libc::geteuid() == 0 };
                if is_root {
                    std::fs::remove_file(target).map_err(|e| e.to_string())?;
                    Command::new("update-ca-trust")
                        .output()
                        .map_err(|e| e.to_string())?;
                } else {
                    let status = Command::new("pkexec")
                        .args([
                            "sh",
                            "-c",
                            &format!("rm -f '{}' && update-ca-trust", target),
                        ])
                        .status()
                        .map_err(|e| e.to_string())?;
                    if !status.success() {
                        return Err("Certificate removal failed".to_string());
                    }
                }
            }
        }
        Ok(())
    }

    fn get_cert_info(&self, cert_path: &str) -> Result<super::DetailedCertInfo, String> {
        super::cert_info_via_openssl(cert_path)
    }
}
