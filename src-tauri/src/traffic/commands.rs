use std::collections::HashMap;

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
}

#[tauri::command]
pub async fn replay_request(req: ReplayRequest) -> Result<ReplayResponse, String> {
    // Load config to get the current proxy port
    let config = crate::config::load_config().unwrap_or_default();
    let proxy_url = format!("http://127.0.0.1:{}", config.proxy_port);

    let client_builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
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

    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(ReplayResponse {
        status,
        headers,
        body,
    })
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
        .danger_accept_invalid_certs(true) // Corporate proxies often use self-signed certs
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
