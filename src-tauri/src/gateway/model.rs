use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRoute {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)] // group = dir name at storage level; exposed for frontend
    pub group: String,
    pub r#match: RouteMatchConfig,
    pub upstream: UpstreamTarget,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RouteMatchConfig {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default)]
    pub headers: Vec<HeaderMatch>,
    #[serde(default)]
    pub methods: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeaderMatch {
    pub name: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamTarget {
    pub url: String,
    #[serde(default)]
    pub strip_prefix: String,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GatewayGroup {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub priority: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EnvProfile {
    #[serde(flatten)]
    pub vars: std::collections::HashMap<String, String>,
}

fn default_enabled() -> bool {
    true
}

fn default_timeout() -> u32 {
    30000
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoadRoutesResponse {
    pub routes: Vec<GatewayRoute>,
    pub groups: Vec<GatewayGroup>,
}
