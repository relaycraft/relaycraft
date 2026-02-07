use crate::logging;
use crate::session::har_model::{
    HarContent, HarCreator, HarEntry, HarHeader, HarLog, HarLogContent, HarRequest, HarResponse,
    HarTimings,
};
use crate::session::model::Flow;
use chrono::{DateTime, TimeZone, Utc};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;

fn headers_to_har(headers: &HashMap<String, String>) -> Vec<HarHeader> {
    headers
        .iter()
        .map(|(k, v)| HarHeader {
            name: k.clone(),
            value: v.clone(),
        })
        .collect()
}

fn har_headers_to_map(headers: &Vec<HarHeader>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for h in headers {
        map.insert(h.name.clone(), h.value.clone());
    }
    map
}

pub fn flow_to_har_entry(flow: &Flow) -> HarEntry {
    let started_date_time = Utc
        .timestamp_millis_opt(flow.timestamp as i64)
        .unwrap()
        .to_rfc3339();

    HarEntry {
        startedDateTime: started_date_time,
        time: flow.duration.unwrap_or(0.0),
        request: HarRequest {
            method: flow.method.clone(),
            url: flow.url.clone(),
            httpVersion: "HTTP/1.1".to_string(), // Default logic
            cookies: vec![],                     // Not parsed detail yet
            headers: headers_to_har(&flow.request_headers),
            queryString: vec![], // Could parse URL query
            postData: None,      // Simplified for now
            headersSize: -1,
            bodySize: flow
                .request_body
                .as_ref()
                .map(|b| b.len() as i32)
                .unwrap_or(0),
        },
        response: HarResponse {
            status: flow.status_code,
            statusText: "".to_string(),
            httpVersion: "HTTP/1.1".to_string(),
            cookies: vec![],
            headers: headers_to_har(&flow.response_headers),
            content: HarContent {
                size: flow.size as i32,
                mimeType: flow.content_type.clone().unwrap_or("".to_string()),
                text: flow.response_body.clone(),
                encoding: flow.response_body_encoding.clone(),
            },
            redirectURL: "".to_string(),
            headersSize: -1,
            bodySize: flow
                .response_body
                .as_ref()
                .map(|b| b.len() as i32)
                .unwrap_or(0),
        },
        cache: serde_json::Value::Null,
        timings: HarTimings {
            send: 0.0,
            wait: flow.duration.unwrap_or(0.0),
            receive: 0.0,
        },
    }
}

pub fn har_entry_to_flow(entry: &HarEntry) -> Flow {
    let timestamp = DateTime::parse_from_rfc3339(&entry.startedDateTime)
        .map(|dt| dt.timestamp_millis() as f64)
        .unwrap_or(0.0);

    Flow {
        id: uuid::Uuid::new_v4().to_string(),
        method: entry.request.method.clone(),
        url: entry.request.url.clone(),
        host: url::Url::parse(&entry.request.url)
            .map(|u| u.host_str().unwrap_or("").to_string())
            .unwrap_or_default(),
        path: url::Url::parse(&entry.request.url)
            .map(|u| u.path().to_string())
            .unwrap_or_default(),
        status_code: entry.response.status,
        timestamp,
        request_headers: har_headers_to_map(&entry.request.headers),
        response_headers: har_headers_to_map(&entry.response.headers),
        request_body: entry.request.postData.as_ref().map(|pd| pd.text.clone()),
        response_body: entry.response.content.text.clone(),
        content_type: Some(entry.response.content.mimeType.clone()),
        size: entry.response.content.size as usize,
        duration: Some(entry.time),
        request_body_encoding: Some("text".to_string()), // Simplified
        response_body_encoding: entry.response.content.encoding.clone(),
        intercepted: Some(false),
        intercept_phase: None,

        // V2 Defaults for HAR import
        http_version: Some(entry.request.httpVersion.clone()),
        client_ip: None, // HAR files don't always track IPs standardly
        server_ip: None,
        error: None,
        timing: None, // Could parse HAR timings but keeping simple for now
        is_websocket: false,
        websocket_frames: None,
        body_truncated: false,
        matched_scripts: None,
        matched_rules: None,
        order: None,
    }
}

#[tauri::command]
pub async fn export_har(path: String, flows: Vec<Flow>) -> Result<(), String> {
    let entries: Vec<HarEntry> = flows.iter().map(flow_to_har_entry).collect();

    let har_log = HarLog {
        log: HarLogContent {
            version: "1.2".to_string(),
            creator: HarCreator {
                name: "RelayCraft".to_string(),
                version: "0.2.0".to_string(),
            },
            entries,
        },
    };

    let file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    let writer = BufWriter::new(file);
    serde_json::to_writer(writer, &har_log)
        .map_err(|e| format!("Failed to serialize HAR: {}", e))?;
    let _ = logging::write_domain_log("audit", &format!("Exported HAR to {}", path));
    Ok(())
}

#[tauri::command]
pub async fn import_har(path: String) -> Result<Vec<Flow>, String> {
    let file = File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = std::io::BufReader::new(file);
    let har_log: HarLog =
        serde_json::from_reader(reader).map_err(|e| format!("Failed to deserialize HAR: {}", e))?;

    let flows: Vec<Flow> = har_log.log.entries.iter().map(har_entry_to_flow).collect();
    let _ = logging::write_domain_log("audit", &format!("Imported HAR from {}", path));
    Ok(flows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flow_to_har_conversion() {
        let mut request_headers = HashMap::new();
        request_headers.insert("Host".into(), "example.com".into());

        let flow = Flow {
            id: "test".into(),
            method: "GET".into(),
            url: "https://example.com/api".into(),
            host: "example.com".into(),
            path: "/api".into(),
            status_code: 200,
            timestamp: 1700000000000.0,
            request_headers,
            response_headers: HashMap::new(),
            request_body: None,
            response_body: Some("hello".into()),
            content_type: Some("text/plain".into()),
            size: 5,
            duration: Some(150.0),
            ..Default::default()
        };

        let entry = flow_to_har_entry(&flow);
        assert_eq!(entry.request.method, "GET");
        assert_eq!(entry.response.status, 200);
        assert_eq!(entry.response.content.text, Some("hello".into()));

        let back_to_flow = har_entry_to_flow(&entry);
        assert_eq!(back_to_flow.method, "GET");
        assert_eq!(back_to_flow.url, "https://example.com/api");
        assert_eq!(back_to_flow.timestamp, 1700000000000.0);
    }
}
