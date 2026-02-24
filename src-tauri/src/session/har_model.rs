use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct HarLog {
    pub log: HarLogContent,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct HarLogContent {
    pub version: String,
    pub creator: HarCreator,
    pub entries: Vec<HarEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HarCreator {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct HarEntry {
    pub startedDateTime: String,
    pub time: f64,
    pub request: HarRequest,
    pub response: HarResponse,
    pub cache: serde_json::Value,
    pub timings: HarTimings,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct HarRequest {
    pub method: String,
    pub url: String,
    #[serde(default = "default_http_version")]
    pub httpVersion: String,
    #[serde(default)]
    pub cookies: Vec<HarCookie>,
    #[serde(default)]
    pub headers: Vec<HarHeader>,
    #[serde(default)]
    pub queryString: Vec<HarQueryString>,
    pub postData: Option<HarPostData>,
    #[serde(default)]
    pub headersSize: i32,
    #[serde(default)]
    pub bodySize: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct HarResponse {
    pub status: i32,
    #[serde(default)]
    pub statusText: String,
    #[serde(default = "default_http_version")]
    pub httpVersion: String,
    #[serde(default)]
    pub cookies: Vec<HarCookie>,
    #[serde(default)]
    pub headers: Vec<HarHeader>,
    pub content: HarContent,
    #[serde(default)]
    pub redirectURL: String,
    #[serde(default)]
    pub headersSize: i32,
    #[serde(default)]
    pub bodySize: i32,
}

fn default_http_version() -> String {
    "HTTP/1.1".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HarCookie {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HarHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HarQueryString {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct HarPostData {
    pub mimeType: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct HarContent {
    pub size: i32,
    pub mimeType: String,
    pub text: Option<String>,
    pub encoding: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HarTimings {
    pub send: f64,
    pub wait: f64,
    pub receive: f64,
}
