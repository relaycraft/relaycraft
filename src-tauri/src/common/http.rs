use crate::config;

/// Build a reqwest client for app-originated external HTTP (AI, plugin market,
/// registries). System proxy detection is disabled on purpose:
///
/// - Behavior must be predictable and identical across environments.
/// - If the user points the OS system proxy at RelayCraft itself, app requests
///   must never loop back into our own engine (where rules/breakpoints apply).
///
/// Instead, these requests follow the app's own upstream proxy setting
/// (Settings → Network → Upstream Proxy), including its bypass domains.
/// When no upstream proxy is configured, requests go direct.
pub fn app_client_builder() -> reqwest::ClientBuilder {
    let mut builder = reqwest::Client::builder().no_proxy();

    let upstream = config::load_config()
        .map(|c| c.upstream_proxy)
        .unwrap_or_default();

    if upstream.enabled && !upstream.url.trim().is_empty() {
        match reqwest::Proxy::all(upstream.url.trim()) {
            Ok(proxy) => {
                let bypass = upstream.bypass_domains.trim();
                let proxy = if bypass.is_empty() {
                    proxy
                } else {
                    proxy.no_proxy(reqwest::NoProxy::from_string(bypass))
                };
                builder = builder.proxy(proxy);
            }
            Err(e) => {
                log::warn!(
                    "Ignoring invalid upstream proxy URL for app HTTP client: {}",
                    e
                );
            }
        }
    }

    builder
}

/// Build a reqwest client for loopback engine-API calls. Always direct:
/// engine control traffic must not depend on NO_PROXY env setup and must
/// never be routed through any proxy.
pub fn loopback_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}
