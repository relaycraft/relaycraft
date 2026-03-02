//! HAR Export/Import Functions
//!
//! This module handles conversion between Flow and HAR format.
//! Since Flow is now HAR-compatible, conversion is straightforward.

use crate::logging;
use crate::session::har_model::{
    HarContent, HarCreator, HarEntry, HarHeader, HarLog, HarLogContent, HarRequest, HarResponse,
    HarTimings,
};
use crate::session::model::{Flow, FlowRequest, FlowResponse};
use std::fs::File;

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

// Note: HAR to Flow conversion (har_entry_to_flow) has been removed.
// HAR imports are now handled by the Python engine via /_relay/import_har_file
// which uses ijson streaming to avoid memory issues with large files.

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

// Note: import_har has been removed - HAR imports are now handled by the Python engine
// via /_relay/import_har_file which uses ijson streaming to avoid memory issues with large files.

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::model::{HarHeader, HarTimings, RcExtension};

    #[test]
    fn test_flow_to_har_conversion() {
        let flow = Flow {
            id: "test-id".to_string(),
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

        // Note: har_entry_to_flow has been removed - HAR imports are now handled by Python engine
    }

    #[test]
    fn test_multiple_headers_preserved() {
        let flow = Flow {
            id: "test".to_string(),
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
