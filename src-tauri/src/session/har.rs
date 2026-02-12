//! HAR Export/Import Functions
//!
//! This module handles conversion between Flow and HAR format.
//! Since Flow is now HAR-compatible, conversion is straightforward.

use crate::logging;
use crate::session::har_model::{
    HarContent, HarCreator, HarEntry, HarHeader, HarLog, HarLogContent, HarRequest, HarResponse,
    HarTimings,
};
use crate::session::model::{Flow, FlowRequest, FlowResponse, RcExtension};
use std::fs::File;
use std::io::BufReader;
use url::Url;

// ==================== Flow to HAR ====================

/// Convert Flow to HAR Entry
///
/// Since Flow is now HAR-compatible, this is mostly a structural transformation.
pub fn flow_to_har_entry(flow: &Flow) -> HarEntry {
    HarEntry {
        startedDateTime: flow.started_date_time.clone(),
        time: flow.time,
        request: flow_request_to_har(&flow.request),
        response: flow_response_to_har(&flow.response),
        cache: flow.cache.clone(),
        timings: har_timings_from_flow(&flow.timings),
    }
}

fn flow_request_to_har(req: &FlowRequest) -> HarRequest {
    HarRequest {
        method: req.method.clone(),
        url: req.url.clone(),
        httpVersion: req.http_version.clone(),
        cookies: req.cookies.iter().map(|c| crate::session::har_model::HarCookie {
            name: c.name.clone(),
            value: c.value.clone(),
        }).collect(),
        headers: req.headers.iter().map(|h| HarHeader {
            name: h.name.clone(),
            value: h.value.clone(),
        }).collect(),
        queryString: req.query_string.iter().map(|q| crate::session::har_model::HarQueryString {
            name: q.name.clone(),
            value: q.value.clone(),
        }).collect(),
        postData: req.post_data.as_ref().map(|pd| crate::session::har_model::HarPostData {
            mimeType: pd.mime_type.clone(),
            text: pd.text.clone().unwrap_or_default(),
        }),
        headersSize: req.headers_size as i32,
        bodySize: req.body_size as i32,
    }
}

fn flow_response_to_har(res: &FlowResponse) -> HarResponse {
    HarResponse {
        status: res.status,
        statusText: res.status_text.clone(),
        httpVersion: res.http_version.clone(),
        cookies: res.cookies.iter().map(|c| crate::session::har_model::HarCookie {
            name: c.name.clone(),
            value: c.value.clone(),
        }).collect(),
        headers: res.headers.iter().map(|h| HarHeader {
            name: h.name.clone(),
            value: h.value.clone(),
        }).collect(),
        content: HarContent {
            size: res.content.size as i32,
            mimeType: res.content.mime_type.clone(),
            text: res.content.text.clone(),
            encoding: res.content.encoding.clone(),
        },
        redirectURL: res.redirect_url.clone(),
        headersSize: res.headers_size as i32,
        bodySize: res.body_size as i32,
    }
}

fn har_timings_from_flow(timings: &crate::session::model::HarTimings) -> HarTimings {
    HarTimings {
        send: timings.send.unwrap_or(-1.0),
        wait: timings.wait.unwrap_or(-1.0),
        receive: timings.receive.unwrap_or(-1.0),
    }
}

// ==================== HAR to Flow ====================

/// Convert HAR Entry to Flow
pub fn har_entry_to_flow(entry: &HarEntry) -> Flow {
    let parsed_url = Url::parse(&entry.request.url).ok();

    Flow {
        id: uuid::Uuid::new_v4().to_string(),
        seq: 0,
        started_date_time: entry.startedDateTime.clone(),
        time: entry.time,
        request: FlowRequest {
            method: entry.request.method.clone(),
            url: entry.request.url.clone(),
            http_version: entry.request.httpVersion.clone(),
            headers: entry.request.headers.iter().map(|h| crate::session::model::HarHeader {
                name: h.name.clone(),
                value: h.value.clone(),
                comment: None,
            }).collect(),
            cookies: entry.request.cookies.iter().map(|c| crate::session::model::HarCookie {
                name: c.name.clone(),
                value: c.value.clone(),
                ..Default::default()
            }).collect(),
            query_string: entry.request.queryString.iter().map(|q| crate::session::model::HarQueryString {
                name: q.name.clone(),
                value: q.value.clone(),
                comment: None,
            }).collect(),
            post_data: entry.request.postData.as_ref().map(|pd| crate::session::model::HarPostData {
                mime_type: pd.mimeType.clone(),
                text: Some(pd.text.clone()),
                comment: None,
                ..Default::default()
            }),
            body_size: entry.request.bodySize as i64,
            headers_size: entry.request.headersSize as i64,
            parsed_url: parsed_url.as_ref().map(|u| crate::session::model::RcParsedUrl {
                scheme: u.scheme().to_string(),
                host: u.host_str().unwrap_or("").to_string(),
                port: u.port(),
                path: u.path().to_string(),
                query: u.query().unwrap_or("").to_string(),
                fragment: u.fragment().map(|s| s.to_string()),
            }),
        },
        response: FlowResponse {
            status: entry.response.status,
            status_text: entry.response.statusText.clone(),
            http_version: entry.response.httpVersion.clone(),
            headers: entry.response.headers.iter().map(|h| crate::session::model::HarHeader {
                name: h.name.clone(),
                value: h.value.clone(),
                comment: None,
            }).collect(),
            cookies: entry.response.cookies.iter().map(|c| crate::session::model::HarCookie {
                name: c.name.clone(),
                value: c.value.clone(),
                ..Default::default()
            }).collect(),
            content: crate::session::model::HarContent {
                size: entry.response.content.size as i64,
                mime_type: entry.response.content.mimeType.clone(),
                text: entry.response.content.text.clone(),
                encoding: entry.response.content.encoding.clone(),
                compression: None,
                comment: None,
            },
            headers_size: entry.response.headersSize as i64,
            body_size: entry.response.bodySize as i64,
            redirect_url: entry.response.redirectURL.clone(),
        },
        timings: crate::session::model::HarTimings {
            send: Some(entry.timings.send),
            wait: Some(entry.timings.wait),
            receive: Some(entry.timings.receive),
            blocked: None,
            dns: None,
            connect: None,
            ssl: None,
            comment: None,
        },
        cache: entry.cache.clone(),
        rc: RcExtension {
            client_ip: None,
            server_ip: None,
            error: None,
            is_websocket: false,
            websocket_frame_count: 0,
            hits: vec![],
            intercept: crate::session::model::RcIntercept {
                intercepted: false,
                phase: None,
                modified_at: None,
            },
            body_truncated: false,
        },
    }
}

// ==================== Tauri Commands ====================

#[tauri::command]
pub async fn export_har(path: String, flows: Vec<Flow>) -> Result<(), String> {
    let entries: Vec<HarEntry> = flows.iter().map(flow_to_har_entry).collect();

    let har_log = HarLog {
        log: HarLogContent {
            version: "1.2".to_string(),
            creator: HarCreator {
                name: "RelayCraft".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            entries,
        },
    };

    let file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    let writer = std::io::BufWriter::new(file);
    serde_json::to_writer(writer, &har_log)
        .map_err(|e| format!("Failed to serialize HAR: {}", e))?;
    let _ = logging::write_domain_log("audit", &format!("Exported HAR to {}", path));
    Ok(())
}

#[tauri::command]
pub async fn import_har(path: String) -> Result<Vec<Flow>, String> {
    let file = File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = BufReader::new(file);
    let har_log: HarLog =
        serde_json::from_reader(reader).map_err(|e| format!("Failed to deserialize HAR: {}", e))?;

    let flows: Vec<Flow> = har_log.log.entries.iter().map(har_entry_to_flow).collect();
    let _ = logging::write_domain_log("audit", &format!("Imported HAR from {}", path));
    Ok(flows)
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::model::{HarHeader, HarTimings, RcExtension};

    #[test]
    fn test_flow_to_har_conversion() {
        let flow = Flow {
            id: "test-id".to_string(),
            seq: 1,
            started_date_time: "2024-01-01T00:00:00Z".to_string(),
            time: 150.0,
            request: FlowRequest {
                method: "GET".to_string(),
                url: "https://example.com/api".to_string(),
                http_version: "HTTP/1.1".to_string(),
                headers: vec![HarHeader {
                    name: "Host".to_string(),
                    value: "example.com".to_string(),
                    comment: None,
                }],
                cookies: vec![],
                query_string: vec![],
                post_data: None,
                body_size: 0,
                headers_size: -1,
                parsed_url: None,
            },
            response: FlowResponse {
                status: 200,
                status_text: "OK".to_string(),
                http_version: "HTTP/1.1".to_string(),
                headers: vec![],
                cookies: vec![],
                content: crate::session::model::HarContent {
                    size: 5,
                    mime_type: "text/plain".to_string(),
                    text: Some("hello".to_string()),
                    encoding: None,
                    compression: None,
                    comment: None,
                },
                headers_size: -1,
                body_size: 5,
                redirect_url: "".to_string(),
            },
            timings: HarTimings {
                wait: Some(100.0),
                receive: Some(50.0),
                ..Default::default()
            },
            cache: serde_json::Value::Null,
            rc: RcExtension::default(),
        };

        let entry = flow_to_har_entry(&flow);
        assert_eq!(entry.request.method, "GET");
        assert_eq!(entry.response.status, 200);
        assert_eq!(entry.response.content.text, Some("hello".to_string()));

        let back_to_flow = har_entry_to_flow(&entry);
        assert_eq!(back_to_flow.request.method, "GET");
        assert_eq!(back_to_flow.request.url, "https://example.com/api");
    }

    #[test]
    fn test_multiple_headers_preserved() {
        let flow = Flow {
            id: "test".to_string(),
            seq: 0,
            started_date_time: "2024-01-01T00:00:00Z".to_string(),
            time: 0.0,
            request: FlowRequest {
                method: "GET".to_string(),
                url: "https://example.com".to_string(),
                http_version: "HTTP/1.1".to_string(),
                headers: vec![
                    HarHeader { name: "Set-Cookie".to_string(), value: "a=1".to_string(), comment: None },
                    HarHeader { name: "Set-Cookie".to_string(), value: "b=2".to_string(), comment: None },
                ],
                cookies: vec![],
                query_string: vec![],
                post_data: None,
                body_size: 0,
                headers_size: -1,
                parsed_url: None,
            },
            response: FlowResponse::default(),
            timings: HarTimings::default(),
            cache: serde_json::Value::Null,
            rc: RcExtension::default(),
        };

        let entry = flow_to_har_entry(&flow);

        // Both Set-Cookie headers should be preserved
        let set_cookies: Vec<_> = entry.request.headers.iter()
            .filter(|h| h.name == "Set-Cookie")
            .collect();
        assert_eq!(set_cookies.len(), 2);
        assert_eq!(set_cookies[0].value, "a=1");
        assert_eq!(set_cookies[1].value, "b=2");
    }
}
