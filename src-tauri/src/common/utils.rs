use local_ip_address::local_ip;
use serde::Serialize;

#[derive(Serialize)]
pub struct RegexMatchResult {
    pub is_match: bool,
    pub captures: Vec<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SystemInfo {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub engine: String,
}

#[tauri::command]
pub fn get_local_ip() -> String {
    match local_ip() {
        Ok(ip) => ip.to_string(),
        Err(_) => "127.0.0.1".to_string(),
    }
}

#[tauri::command]
pub fn check_regex_match(pattern: String, test_string: String) -> RegexMatchResult {
    match regex::Regex::new(&pattern) {
        Ok(re) => {
            if let Some(caps) = re.captures(&test_string) {
                let captures = caps
                    .iter()
                    .skip(1) // Skip the full match (index 0)
                    .map(|m| m.map_or(String::new(), |m| m.as_str().to_string()))
                    .collect();
                RegexMatchResult {
                    is_match: true,
                    captures,
                    error: None,
                }
            } else {
                RegexMatchResult {
                    is_match: false,
                    captures: vec![],
                    error: None,
                }
            }
        }
        Err(e) => RegexMatchResult {
            is_match: false,
            captures: vec![],
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    let platform = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        _ => std::env::consts::OS,
    };

    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "ARM64",
        _ => std::env::consts::ARCH,
    };

    SystemInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: platform.to_string(),
        arch: arch.to_string(),
        engine: "mitmproxy 12.2.1".to_string(),
    }
}
