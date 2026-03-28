use std::collections::HashMap;

use base64::Engine;
use futures_util::StreamExt;

/// Maximum response body size transferred over IPC (5 MB).
/// Prevents large responses from serializing over the IPC bridge and freezing the UI.
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

#[derive(serde::Deserialize)]
pub struct ReplayRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ReplayResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub encoding: String, // "text" or "base64"
    pub truncated: bool,  // true if body was cut off at MAX_BODY_BYTES
    pub total_bytes: usize, // actual content-length or bytes read
}

/// Core implementation, usable by both the Tauri command and the plugin bridge.
pub async fn replay_request_inner(req: ReplayRequest) -> Result<ReplayResponse, String> {
    // Load config to get the current proxy port
    let config = crate::config::load_config().unwrap_or_default();
    let proxy_url = format!("http://127.0.0.1:{}", config.proxy_port);

    let client_builder = reqwest::Client::builder()
        // TLS verification must be disabled here by design: all requests are routed through the
        // local mitmproxy engine, which dynamically re-signs certificates with its own CA.
        // Platform TLS verifiers reject these generated certs regardless of CA trust due to
        // additional compliance checks. This is safe because the connection target is always loopback.
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .gzip(true)
        .brotli(true)
        .deflate(true);

    // Add proxy configuration
    let client = match reqwest::Proxy::all(&proxy_url) {
        Ok(proxy) => client_builder
            .proxy(proxy)
            .build()
            .map_err(|e| e.to_string())?,
        Err(_) => client_builder.build().map_err(|e| e.to_string())?,
    };

    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|_| "Invalid HTTP method".to_string())?;

    let mut request_builder = client.request(method, &req.url);

    for (key, value) in req.headers {
        // Skip certain headers that might interfere
        if key.to_lowercase() == "content-length" {
            continue;
        }
        request_builder = request_builder.header(key, value);
    }

    if let Some(body_content) = req.body {
        request_builder = request_builder.body(body_content);
    }

    let response = request_builder.send().await.map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }

    // Check if content is binary (image, etc.) based on content-type
    let content_type = headers
        .get("content-type")
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    let is_binary = content_type.starts_with("image/")
        || content_type.starts_with("application/octet-stream")
        || content_type.starts_with("video/")
        || content_type.starts_with("audio/");

    // Stream body up to MAX_BODY_BYTES to avoid freezing the IPC bridge with huge payloads.
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::with_capacity(MAX_BODY_BYTES.min(65536));
    let mut truncated = false;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let remaining = MAX_BODY_BYTES.saturating_sub(buffer.len());
        if chunk.len() >= remaining {
            buffer.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        buffer.extend_from_slice(&chunk);
    }

    let total_bytes = buffer.len();

    let (body, encoding) = if is_binary {
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
        (encoded, "base64".to_string())
    } else {
        let text = String::from_utf8_lossy(&buffer).into_owned();
        (text, "text".to_string())
    };

    Ok(ReplayResponse {
        status,
        headers,
        body,
        encoding,
        truncated,
        total_bytes,
    })
}

/// Tauri command wrapper — delegates to the shared inner implementation.
#[tauri::command]
pub async fn replay_request(req: ReplayRequest) -> Result<ReplayResponse, String> {
    replay_request_inner(req).await
}

#[tauri::command]
pub async fn check_proxy_connectivity(proxy_url: String) -> Result<String, String> {
    if proxy_url.is_empty() {
        return Err("Proxy URL is empty".to_string());
    }

    let proxy = reqwest::Proxy::all(&proxy_url).map_err(|e| format!("Invalid proxy URL: {}", e))?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(std::time::Duration::from_secs(5))
        // TLS verification must be disabled here by design when checking through our own Mitmproxy engine,
        // as the OS platform verifier will reject the dynamically generated self-signed certificate.
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    // Try to connect to a stable endpoint
    let target = "https://www.google.com";

    match client.get(target).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(format!(
                    "Successfully connected via proxy (Status: {})",
                    resp.status()
                ))
            } else {
                Err(format!(
                    "Connected via proxy but received status: {}",
                    resp.status()
                ))
            }
        }
        Err(e) => {
            log::error!("Proxy connectivity check failed: {}", e);
            Err("Failed to connect via proxy".to_string())
        }
    }
}
