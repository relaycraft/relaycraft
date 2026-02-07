use crate::logging;
use anyhow::{Context, Result as AnyResult};
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose,
    PKCS_ECDSA_P256_SHA256,
};
use std::fs;
use std::path::{Path, PathBuf};
use time::{Duration, OffsetDateTime};

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

#[tauri::command]
pub fn open_cert_dir() -> Result<(), String> {
    let cert_dir = get_cert_dir()?;

    if !cert_dir.exists() {
        fs::create_dir_all(&cert_dir)
            .map_err(|e| format!("Failed to create cert directory: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(cert_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(cert_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(cert_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn check_cert_installed() -> Result<bool, String> {
    // Helper to get local certificate hash
    fn get_local_cert_hash() -> Result<String, String> {
        use base64::prelude::*;
        use sha1::{Digest, Sha1};
        let cert_path = get_cert_path()?;
        let cert_content = fs::read_to_string(&cert_path)
            .map_err(|e| format!("Failed to read local cert: {}", e))?;

        // Extract base64 content between BEGIN and END markers
        let start_marker = "-----BEGIN CERTIFICATE-----";
        let end_marker = "-----END CERTIFICATE-----";

        if let (Some(start), Some(end)) = (
            cert_content.find(start_marker),
            cert_content.find(end_marker),
        ) {
            let base64_content = &cert_content[start + start_marker.len()..end].trim();
            // Remove newlines
            let clean_base64: String = base64_content
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();

            if let Ok(der_bytes) = base64::prelude::BASE64_STANDARD.decode(&clean_base64) {
                let mut hasher = Sha1::new();
                hasher.update(&der_bytes);
                let result = hasher.finalize();
                return Ok(hex::encode(result).to_lowercase());
            }
        }
        Err("Invalid certificate format".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let local_hash = get_local_cert_hash().unwrap_or_default();
        if local_hash.is_empty() {
            return Ok(false);
        }

        // PowerShell command to check for specific hash in Trusted Root
        let ps_cmd = format!(
            "Get-ChildItem Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\Root | Where-Object {{ $_.Thumbprint -eq '{}' }}",
            local_hash
        );

        let ps_out = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_cmd])
            .creation_flags(0x08000000)
            .output();

        if let Ok(out) = ps_out {
            // If stdout has content, we found the matching certificate
            return Ok(!out.stdout.is_empty());
        }

        Ok(false)
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Verify specific certificate file against system trust settings
        let cert_path = get_cert_path().unwrap_or_default();
        let cert_file = std::path::Path::new(&cert_path);

        if cert_file.exists() {
            // 'security verify-cert' checks if the certificate is trusted for the specified policy
            // We remove '-l' (leaf) check as we are verifying a Root CA.
            // '-p ssl' ensures it's specifically trusted for SSL/TLS.
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

    #[cfg(target_os = "linux")]
    {
        // For Linux, common practice is to check if the fingerprint exists in the merged bundle
        let local_hash = get_local_cert_hash().unwrap_or_default().to_uppercase();
        if local_hash.is_empty() {
            return Ok(false);
        }

        let common_bundles = [
            "/etc/ssl/certs/ca-certificates.crt", // Debian, Ubuntu, Gentoo, Arch
            "/etc/pki/tls/certs/ca-bundle.crt",   // RedHat, Fedora, CentOS
            "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", // Newer RHEL/Fedora
            "/etc/ssl/ca-bundle.pem",             // OpenSUSE
        ];

        for bundle_path in common_bundles {
            if let Ok(bundle) = fs::read_to_string(bundle_path) {
                // If it matches exactly or is in the bundle, we are good.
                // MITM certificates usually append to these files.
                // We check for the fingerprint if it's there? Actually searching for hash inside PEM is hard.
                // Most reliable is checking if the filename exists in /etc/ssl/certs or if content is in bundle.
                let cert_path = get_cert_path()?;
                if let Ok(local_content) = fs::read_to_string(&cert_path) {
                    if bundle.contains(&local_content.trim()) {
                        return Ok(true);
                    }
                }
            }
        }

        // Also check hashed directory /etc/ssl/certs (usually contains symlinks named <hash>.0)
        // Note: hashing is done by 'c_rehash' or 'update-ca-certificates'
        // This is a last resort check.
        let hashed_dir = "/etc/ssl/certs";
        if Path::new(hashed_dir).exists() {
            // In Linux, the hash used for symlinks is usually the subject hash (not SHA1 thumbprint)
            // For simplicity, if we find any RelayCraft file in common locations, we return true.
            let possible_locations = [
                "/etc/ssl/certs/RelayCraft_CA.pem",
                "/usr/local/share/ca-certificates/RelayCraft_CA.crt",
                "/etc/pki/ca-trust/source/anchors/RelayCraft_CA.crt",
            ];
            for path in possible_locations {
                if Path::new(path).exists() {
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub async fn install_cert_automated() -> Result<(), String> {
    let cert_path = get_cert_path()?;

    // Windows implementation using certutil
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // Use Start-Process with -Verb RunAs to trigger UAC
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!("Start-Process certutil -ArgumentList '-addstore -f Root \"{}\"' -Verb RunAs -Wait", cert_path)
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .map_err(|e| format!("Failed to trigger cert installation: {}", e))?;

        if !output.status.success() {
            return Err("证书安装操作被取消或失败".to_string());
        }
    }

    // macOS implementation: Pivot to manual trust due to macOS 15 TCC restrictions
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // On macOS 15+, automated trust is often blocked in dev/bundle environments.
        // We open the certificate file which triggers Keychain Access.
        let _ = Command::new("open")
            .arg(&cert_path)
            .spawn()
            .map_err(|e| format!("Failed to open certificate: {}", e))?;

        // Return a specific error string that the frontend can catch to show the guide
        return Err("MANUAL_STEP".to_string());
    }

    let _ = logging::write_domain_log("audit", "Triggered automated certificate installation");
    Ok(())
}

#[tauri::command]
pub async fn remove_cert_automated() -> Result<(), String> {
    // Windows implementation using certutil
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Start-Process powershell -ArgumentList '-NoProfile -Command \"Get-ChildItem Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -match \\\"RelayCraft\\\" } | Remove-Item\"' -Verb RunAs -Wait",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .map_err(|e| format!("Failed to trigger cert removal: {}", e))?;

        if !output.status.success() {
            return Err("证书卸载操作被取消或失败".to_string());
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // On macOS 15, we use the Bundle ID to open Keychain Access reliably.
        let _ = Command::new("open")
            .arg("-b")
            .arg("com.apple.keychainaccess")
            .spawn();

        return Err("MANUAL_STEP".to_string());
    }

    let _ = logging::write_domain_log("audit", "Triggered automated certificate removal");
    Ok(())
}

#[tauri::command]
pub async fn regenerate_root_ca(_app: tauri::AppHandle) -> Result<(), String> {
    let cert_dir = get_cert_dir()?;

    if cert_dir.exists() {
        // Delete all mitmproxy-ca* files
        for entry in fs::read_dir(&cert_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with("mitmproxy-ca") || filename.starts_with("relaycraft-ca") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    // Generate new CA directly
    ensure_ca_exists(&cert_dir).map_err(|e| e.to_string())?;

    let _ = logging::write_domain_log("audit", "Regenerated CA Root");

    Ok(())
}

pub fn ensure_ca_exists(cert_dir: &Path) -> AnyResult<()> {
    if !cert_dir.exists() {
        fs::create_dir_all(cert_dir).context("Failed to create certificate directory")?;
    }

    // When MITMPROXY_CONFDIR is set to cert_dir, mitmproxy expects files DIRECTLY in this directory.
    // It looks for mitmproxy-ca.pem (private key + cert) and mitmproxy-ca-cert.pem (cert only).

    // Internal names (required by mitmproxy)
    let ca_pem_path = cert_dir.join("mitmproxy-ca.pem");
    let ca_cert_path = cert_dir.join("mitmproxy-ca-cert.pem");

    // Branded names (for user installation/recognition)
    let branded_pem_path = cert_dir.join("relaycraft-ca.pem");
    let branded_cert_path = cert_dir.join("relaycraft-ca-cert.pem");

    // Regenerate if any key file is missing
    if !ca_pem_path.exists() || !branded_cert_path.exists() {
        log::info!("Generating RelayCraft CA certificate...");
        let (ca_cert, ca_key) = generate_ca().context("Failed to generate CA certificate")?;

        // 1. Generate Combined PEM (Key + Cert)
        // mitmproxy documentation shows Private Key followed by Certificate
        let combined = format!("{}\n{}", ca_key, ca_cert);

        // Write internal files (for mitmproxy usage)
        fs::write(&ca_pem_path, &combined).context("Failed to write mitmproxy-ca.pem")?;
        fs::write(&ca_cert_path, &ca_cert).context("Failed to write mitmproxy-ca-cert.pem")?;

        // Write branded files (for user installation)
        fs::write(&branded_pem_path, &combined).context("Failed to write relaycraft-ca.pem")?;
        fs::write(&branded_cert_path, &ca_cert)
            .context("Failed to write relaycraft-ca-cert.pem")?;

        // 2. Generate and Write .crt (DER binary format)
        // This is the standard for Windows and many mobile device installers
        // 2. Generate and Write .crt (DER binary format)
        // This is the standard for Windows and many mobile device installers
        let ca_der = pem::parse(&ca_cert)
            .map_err(|e| anyhow::anyhow!("Failed to parse PEM for DER conversion: {}", e))?
            .into_contents();
        let branded_crt_path = cert_dir.join("relaycraft-ca-cert.crt");
        fs::write(&branded_crt_path, &ca_der).context("Failed to write relaycraft-ca-cert.crt")?;
    }

    // Clean up legacy nested directories if they exist
    let legacy_nested = cert_dir.join(".mitmproxy");
    if legacy_nested.exists() {
        let _ = fs::remove_dir_all(legacy_nested);
    }

    // Hide internal files on Windows to keep folder clean for users
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let internal_files = [
            ca_pem_path.to_string_lossy().to_string(),
            ca_cert_path.to_string_lossy().to_string(),
            branded_pem_path.to_string_lossy().to_string(), // Hide private key
        ];

        for file in internal_files {
            let _ = std::process::Command::new("attrib")
                .args(["+h", &file])
                .creation_flags(0x08000000)
                .status();
        }
    }

    Ok(())
}

fn generate_ca() -> AnyResult<(String, String)> {
    let mut params = CertificateParams::default();

    // Customize certificate info
    let mut dn = DistinguishedName::new();
    // Updated Name to be more professional
    dn.push(DnType::CommonName, "RelayCraft Root CA");
    dn.push(DnType::OrganizationName, "RelayCraft");
    dn.push(DnType::OrganizationalUnitName, "RelayCraft Team");
    params.distinguished_name = dn;

    // Set as CA
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);

    // Key usages for CA
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];

    // Set Extended Key Usages (Server Auth + Client Auth + Code Signing if needed)
    // This helps with "Friendly Name" or "Intended Purposes" in Windows CertMgr
    params.extended_key_usages = vec![
        rcgen::ExtendedKeyUsagePurpose::ServerAuth,
        rcgen::ExtendedKeyUsagePurpose::ClientAuth,
        rcgen::ExtendedKeyUsagePurpose::CodeSigning,
        rcgen::ExtendedKeyUsagePurpose::EmailProtection,
    ];

    let key_pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)?;

    // Set validity to 10 years (3650 days)
    let now = OffsetDateTime::now_utc();
    params.not_before = now;
    params.not_after = now + Duration::days(3650);

    let cert = params.self_signed(&key_pair)?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    Ok((cert_pem, key_pem))
}

#[tauri::command]
pub fn get_detailed_cert_info() -> Result<DetailedCertInfo, String> {
    let cert_path = get_cert_path()?;
    let exists = std::path::Path::new(&cert_path).exists();

    if !exists {
        return Ok(DetailedCertInfo {
            exists: false,
            ..Default::default()
        });
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // Use PowerShell to load the cert object via .NET and output JSON
        // This avoids all localization and parsing issues with certutil
        let ps_script = format!(
            "$p = '{}'; if (Test-Path $p) {{ $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($p); $obj = @{{ exists=$true; subject=$c.Subject; issuer=$c.Issuer; not_before=$c.NotBefore.ToString('yyyy-MM-dd HH:mm:ss'); not_after=$c.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'); fingerprint=[BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData)) -replace '-', ':' }}; $obj | ConvertTo-Json -Compress }} else {{ echo '{{\"exists\":false}}' }}",
            cert_path
        );

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .map_err(|e| format!("运行 PowerShell 失败: {}", e))?;

        let out_str = String::from_utf8_lossy(&output.stdout);

        // Parse the JSON output
        match serde_json::from_str::<DetailedCertInfo>(&out_str) {
            Ok(info) => Ok(info),
            Err(e) => {
                // Return default if parsing fails (e.g. file not found logic above returning partial json)
                if out_str.contains("exists\":false") {
                    return Ok(DetailedCertInfo {
                        exists: false,
                        ..Default::default()
                    });
                }
                Err(format!("解析证书信息失败: {} (Output: {})", e, out_str))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Use openssl to parse cert details (Default for macOS/Linux)
        use std::process::Command;
        let cmd_result = Command::new("openssl")
            .args(&[
                "x509",
                "-in",
                &cert_path,
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
                    return Err("系统中未安装 OpenSSL，无法解析证书详情。".to_string());
                }
                return Err(format!("运行 openssl 失败: {}", e));
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
        return Ok(info);
    }
}

#[derive(serde::Serialize, serde::Deserialize, Default, Debug)]
pub struct DetailedCertInfo {
    pub exists: bool,
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub fingerprint: String,
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

        // Verify CN is updated
        // Note: PEM content is base64 encoded, checking for raw string "RelayCraft Root CA" inside PEM
        // isn't reliable without decoding, but we can decode it to check
        let parsed_pem = pem::parse(&cert).unwrap();
        let cert_bytes = parsed_pem.contents();
        let cert_str = String::from_utf8_lossy(&cert_bytes);
        // Basic check to see if the CN string is present in the DER binary (it should be)
        assert!(cert_str.contains("RelayCraft Root CA"));
    }

    #[test]
    fn test_generate_ca_properties() {
        // Use rcgen/x509 parser if available, or just check generation success
        // Since we don't have a parser dep in test, we assume generate_ca succeeds with new params
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
