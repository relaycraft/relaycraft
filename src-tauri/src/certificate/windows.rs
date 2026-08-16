use super::CertManager;
use std::path::Path;
use std::process::Command;

pub struct WindowsCertManager;

/// Hide files via Windows `attrib` command (keeps cert folder tidy for users).
pub(super) fn hide_internal_files(paths: &[String]) {
    use std::os::windows::process::CommandExt;
    for file in paths {
        let _ = Command::new("attrib")
            .args(["+h", file])
            .creation_flags(0x08000000)
            .status();
    }
}

/// Known locations for a usable PowerShell, tried in order. The absolute
/// System32 path is tried first so cert operations keep working on systems
/// where the OS PATH is broken (issue #93: "program not found").
fn powershell_candidates() -> [&'static str; 3] {
    [
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "powershell.exe",
        "pwsh.exe",
    ]
}

/// Run a PowerShell script through the first available PowerShell binary.
fn run_powershell(args: &[&str]) -> Result<std::process::Output, String> {
    use std::os::windows::process::CommandExt;

    let mut last_err = None;
    for exe in powershell_candidates() {
        match Command::new(exe)
            .args(args)
            .creation_flags(0x08000000)
            .output()
        {
            Ok(out) => return Ok(out),
            Err(e) => last_err = Some(e),
        }
    }
    Err(format!(
        "PowerShell is not available on this system ({}). Please reinstall PowerShell or add \"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\\" to the system PATH.",
        last_err.map(|e| e.to_string()).unwrap_or_default()
    ))
}

impl CertManager for WindowsCertManager {
    fn open_cert_dir(&self, cert_dir: &Path) -> Result<(), String> {
        Command::new("explorer")
            .arg(cert_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
        Ok(())
    }

    fn is_installed(&self, _cert_path: &str) -> Result<bool, String> {
        let local_hash = super::local_cert_hash().unwrap_or_default();
        if local_hash.is_empty() {
            return Ok(false);
        }

        let ps_cmd = format!(
            "Get-ChildItem Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\Root | Where-Object {{ $_.Thumbprint -eq '{}' }}",
            local_hash
        );

        let ps_out = run_powershell(&["-NoProfile", "-Command", &ps_cmd]);

        if let Ok(out) = ps_out {
            return Ok(!out.stdout.is_empty());
        }

        Ok(false)
    }

    fn install(&self, cert_path: &str) -> Result<(), String> {
        let output = run_powershell(&[
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process certutil -ArgumentList '-addstore -f Root \"{}\"' -Verb RunAs -Wait",
                cert_path
            ),
        ])?;

        if !output.status.success() {
            return Err("Certificate installation was cancelled or failed".to_string());
        }
        Ok(())
    }

    fn remove(&self) -> Result<(), String> {
        let output = run_powershell(&[
            "-NoProfile",
            "-Command",
            "Start-Process powershell -ArgumentList '-NoProfile -Command \"Get-ChildItem Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -match \\\"RelayCraft\\\" } | Remove-Item\"' -Verb RunAs -Wait",
        ])?;

        if !output.status.success() {
            return Err("Certificate removal was cancelled or failed".to_string());
        }
        Ok(())
    }

    fn get_cert_info(&self, cert_path: &str) -> Result<super::DetailedCertInfo, String> {
        let ps_script = format!(
            "$p = '{}'; if (Test-Path $p) {{ $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($p); $obj = @{{ exists=$true; subject=$c.Subject; issuer=$c.Issuer; not_before=$c.NotBefore.ToString('yyyy-MM-dd HH:mm:ss'); not_after=$c.NotAfter.ToString('yyyy-MM-dd HH:mm:ss'); fingerprint=[BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData)) -replace '-', ':' }}; $obj | ConvertTo-Json -Compress }} else {{ echo '{{\"exists\":false}}' }}",
            cert_path
        );

        let output = run_powershell(&["-NoProfile", "-Command", &ps_script])?;

        let out_str = String::from_utf8_lossy(&output.stdout);

        match serde_json::from_str::<super::DetailedCertInfo>(&out_str) {
            Ok(info) => Ok(info),
            Err(e) => {
                if out_str.contains("exists\":false") {
                    return Ok(super::DetailedCertInfo {
                        exists: false,
                        ..Default::default()
                    });
                }
                Err(format!(
                    "Failed to parse certificate info: {} (Output: {})",
                    e, out_str
                ))
            }
        }
    }
}
