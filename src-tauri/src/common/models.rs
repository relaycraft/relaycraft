use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[allow(dead_code)]
pub struct Metadata {
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for Metadata {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            created_at: now,
            updated_at: now,
            extra: HashMap::new(),
        }
    }
}

impl Metadata {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self::default()
    }

    #[allow(dead_code)]
    pub fn update(&mut self) {
        self.updated_at = chrono::Utc::now().timestamp_millis();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct VersionedContainer<T> {
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    pub version: String,
    pub metadata: Metadata,
    pub data: T,
}

impl<T> VersionedContainer<T> {
    #[allow(dead_code)]
    pub fn new(version: &str, data: T) -> Self {
        Self {
            schema: None,
            version: version.to_string(),
            metadata: Metadata::new(),
            data,
        }
    }

    #[allow(dead_code)]
    pub fn with_schema(mut self, schema: &str) -> Self {
        self.schema = Some(schema.to_string());
        self
    }
}
