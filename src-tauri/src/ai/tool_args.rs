use crate::ai::client::ToolCall;
use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateFilterArgs {
    filter: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRegexArgs {
    pattern: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExplainRegexArgs {
    explanation: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateNameArgs {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateScriptArgs {
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RuleType {
    MapLocal,
    MapRemote,
    RewriteHeader,
    RewriteBody,
    Throttle,
    BlockRequest,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRuleMatchArgs {
    request: Vec<Value>,
    response: Option<Vec<Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerateRuleArgs {
    name: String,
    rule_type: RuleType,
    r#match: GenerateRuleMatchArgs,
    actions: Vec<Value>,
    enabled: Option<bool>,
    priority: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExplainRuleArgs {
    message: String,
}

#[derive(Debug, Clone, Copy)]
enum ValidationLabel {
    JsonParseFailed,
    MissingField,
    EmptyString,
    SchemaMismatch,
    NormalizedAndPassed,
}

impl ValidationLabel {
    fn as_str(self) -> &'static str {
        match self {
            Self::JsonParseFailed => "json_parse_failed",
            Self::MissingField => "missing_field",
            Self::EmptyString => "empty_string",
            Self::SchemaMismatch => "schema_mismatch",
            Self::NormalizedAndPassed => "normalized_and_passed",
        }
    }
}

fn tagged_error(tool_name: &str, label: ValidationLabel, detail: impl AsRef<str>) -> String {
    format!(
        "param_validation_failure:{}: invalid tool args for {}: {}",
        label.as_str(),
        tool_name,
        detail.as_ref()
    )
}

fn ensure_non_empty(value: &str, field: &str, tool_name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(tagged_error(
            tool_name,
            ValidationLabel::EmptyString,
            format!("field '{}' must be non-empty", field),
        ));
    }
    Ok(())
}

fn is_known_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "generate_filter"
            | "generate_regex"
            | "explain_regex"
            | "generate_name"
            | "generate_script"
            | "generate_rule"
            | "explain_rule"
    )
}

fn parse_raw_args(tool_name: &str, raw_arguments: &str) -> Result<Value, String> {
    if raw_arguments.trim().is_empty() {
        return Err(tagged_error(
            tool_name,
            ValidationLabel::MissingField,
            "arguments is empty",
        ));
    }

    serde_json::from_str::<Value>(raw_arguments)
        .map_err(|e| tagged_error(tool_name, ValidationLabel::JsonParseFailed, e.to_string()))
}

fn trim_string_values(value: &mut Value) -> bool {
    match value {
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed != raw {
                *raw = trimmed.to_string();
                return true;
            }
            false
        }
        Value::Array(arr) => {
            let mut changed = false;
            for item in arr {
                changed |= trim_string_values(item);
            }
            changed
        }
        Value::Object(map) => {
            let mut changed = false;
            for item in map.values_mut() {
                changed |= trim_string_values(item);
            }
            changed
        }
        _ => false,
    }
}

fn as_object_mut<'a>(
    tool_name: &str,
    value: &'a mut Value,
) -> Result<&'a mut Map<String, Value>, String> {
    value.as_object_mut().ok_or_else(|| {
        tagged_error(
            tool_name,
            ValidationLabel::SchemaMismatch,
            "arguments must be a JSON object",
        )
    })
}

fn apply_alias(obj: &mut Map<String, Value>, canonical: &str, aliases: &[&str]) -> bool {
    if obj.contains_key(canonical) {
        return false;
    }
    for alias in aliases {
        if let Some(value) = obj.remove(*alias) {
            obj.insert(canonical.to_string(), value);
            return true;
        }
    }
    false
}

fn inject_default(obj: &mut Map<String, Value>, key: &str, value: Value) -> bool {
    if obj.contains_key(key) {
        return false;
    }
    obj.insert(key.to_string(), value);
    true
}

fn normalize_args(tool_name: &str, raw_arguments: &str) -> Result<(Value, bool), String> {
    let mut args = parse_raw_args(tool_name, raw_arguments)?;
    let mut normalized = trim_string_values(&mut args);

    let obj = as_object_mut(tool_name, &mut args)?;
    normalized |= match tool_name {
        "generate_filter" => apply_alias(obj, "filter", &["query", "keyword", "text"]),
        "generate_regex" => apply_alias(obj, "pattern", &["regex"]),
        "explain_regex" => apply_alias(obj, "explanation", &["message", "explain"]),
        "generate_name" => apply_alias(obj, "name", &["title", "rule_name"]),
        "generate_script" => apply_alias(obj, "code", &["script", "content"]),
        "generate_rule" => {
            let mut changed = false;
            changed |= apply_alias(obj, "rule_type", &["ruleType", "type"]);
            changed |= apply_alias(obj, "match", &["matches"]);
            if !obj.contains_key("actions") {
                if let Some(single_action) = obj.remove("action") {
                    obj.insert("actions".to_string(), Value::Array(vec![single_action]));
                    changed = true;
                }
            }
            changed |= inject_default(obj, "enabled", Value::Bool(false));

            if let Some(match_value) = obj.get_mut("match") {
                if let Some(match_obj) = match_value.as_object_mut() {
                    changed |= apply_alias(match_obj, "request", &["requests", "req"]);
                    changed |= apply_alias(match_obj, "response", &["responses", "resp"]);
                    changed |= inject_default(match_obj, "response", Value::Array(Vec::new()));
                }
            }
            changed
        }
        "explain_rule" => apply_alias(obj, "message", &["explanation", "reason"]),
        _ => false,
    };

    Ok((args, normalized))
}

fn classify_deser_error(err: &serde_json::Error) -> ValidationLabel {
    let message = err.to_string();
    if message.contains("missing field") {
        ValidationLabel::MissingField
    } else {
        ValidationLabel::SchemaMismatch
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(
    tool_name: &str,
    normalized_args: Value,
) -> Result<T, String> {
    serde_json::from_value::<T>(normalized_args).map_err(|e| {
        let label = classify_deser_error(&e);
        tagged_error(tool_name, label, e.to_string())
    })
}

fn validate_and_normalize_tool_call(tool_call: &ToolCall) -> Result<ToolCall, String> {
    let tool_name = tool_call.function.name.as_str();
    if !is_known_tool(tool_name) {
        // Keep compatibility for tools that are not part of this schema set
        // (e.g. detect_intent). They are validated by their own call sites.
        return Ok(tool_call.clone());
    }

    let raw_arguments = tool_call.function.arguments.as_str();
    let (normalized_args, normalized) = normalize_args(tool_name, raw_arguments)?;

    match tool_name {
        "generate_filter" => {
            let parsed: GenerateFilterArgs = parse_args(tool_name, normalized_args.clone())?;
            ensure_non_empty(&parsed.filter, "filter", tool_name)?;
        }
        "generate_regex" => {
            let parsed: GenerateRegexArgs = parse_args(tool_name, normalized_args.clone())?;
            ensure_non_empty(&parsed.pattern, "pattern", tool_name)?;
        }
        "explain_regex" => {
            let parsed: ExplainRegexArgs = parse_args(tool_name, normalized_args.clone())?;
            ensure_non_empty(&parsed.explanation, "explanation", tool_name)?;
        }
        "generate_name" => {
            let parsed: GenerateNameArgs = parse_args(tool_name, normalized_args.clone())?;
            ensure_non_empty(&parsed.name, "name", tool_name)?;
        }
        "generate_script" => {
            let parsed: GenerateScriptArgs = parse_args(tool_name, normalized_args.clone())?;
            ensure_non_empty(&parsed.code, "code", tool_name)?;
        }
        "generate_rule" => {
            let parsed: GenerateRuleArgs = parse_args(tool_name, normalized_args.clone())?;
            ensure_non_empty(&parsed.name, "name", tool_name)?;

            let _ = parsed.rule_type;
            let _ = parsed.r#match.request.len();
            let _ = parsed.r#match.response.as_ref().map(Vec::len);
            let _ = parsed.actions.len();
            let _ = parsed.enabled;
            let _ = parsed.priority;
        }
        "explain_rule" => {
            let parsed: ExplainRuleArgs = parse_args(tool_name, normalized_args.clone())?;
            ensure_non_empty(&parsed.message, "message", tool_name)?;
        }
        _ => {}
    }

    if normalized {
        log::info!(
            "param_validation:{}: tool args for {} passed after normalization",
            ValidationLabel::NormalizedAndPassed.as_str(),
            tool_name
        );
    }

    let mut normalized_tool_call = tool_call.clone();
    normalized_tool_call.function.arguments =
        serde_json::to_string(&normalized_args).map_err(|e| {
            tagged_error(
                tool_name,
                ValidationLabel::SchemaMismatch,
                format!("failed to serialize normalized args: {}", e),
            )
        })?;

    Ok(normalized_tool_call)
}

pub fn normalize_and_validate_tool_calls(
    tool_calls: Option<&Vec<ToolCall>>,
) -> Result<Option<Vec<ToolCall>>, String> {
    let Some(tool_calls) = tool_calls else {
        return Ok(None);
    };

    let mut normalized_calls = Vec::with_capacity(tool_calls.len());
    for tool_call in tool_calls {
        normalized_calls.push(validate_and_normalize_tool_call(tool_call)?);
    }

    Ok(Some(normalized_calls))
}

#[allow(dead_code)]
pub fn validate_tool_calls(tool_calls: Option<&Vec<ToolCall>>) -> Result<(), String> {
    normalize_and_validate_tool_calls(tool_calls)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_and_validate_tool_calls, validate_tool_calls};
    use crate::ai::client::{FunctionCall, ToolCall};
    use serde_json::Value;

    fn make_tool_call(name: &str, arguments: &str) -> ToolCall {
        ToolCall {
            id: "call_1".to_string(),
            tool_type: "function".to_string(),
            function: FunctionCall {
                name: name.to_string(),
                arguments: arguments.to_string(),
            },
        }
    }

    #[test]
    fn validates_known_tool_args_successfully() {
        let tool_calls = vec![
            make_tool_call("generate_filter", r#"{"filter":"status:200"}"#),
            make_tool_call("generate_regex", r#"{"pattern":"^/api"}"#),
            make_tool_call("generate_name", r#"{"name":"Block Suspicious Requests"}"#),
            make_tool_call(
                "generate_rule",
                r#"{"name":"block bad","rule_type":"block_request","match":{"request":[]},"actions":[]}"#,
            ),
        ];

        let result = validate_tool_calls(Some(&tool_calls));
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_invalid_known_tool_args() {
        let tool_calls = vec![make_tool_call("generate_regex", r#"{"pattern":""}"#)];

        let result = validate_tool_calls(Some(&tool_calls));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains(
            "param_validation_failure:empty_string: invalid tool args for generate_regex"
        ));
    }

    #[test]
    fn accepts_normalized_alias_fields_for_known_tools() {
        let tool_calls = vec![
            make_tool_call("generate_regex", "{\"regex\":\"  ^/api  \"}"),
            make_tool_call(
                "generate_rule",
                r#"{"name":"  block bad  ","ruleType":"block_request","matches":{"requests":[]},"action":{"type":"block"}}"#,
            ),
        ];

        let result = validate_tool_calls(Some(&tool_calls));
        assert!(result.is_ok());
    }

    #[test]
    fn returns_normalized_tool_call_arguments_for_known_tools() {
        let tool_calls = vec![make_tool_call(
            "generate_rule",
            r#"{"name":"  block bad  ","ruleType":"block_request","matches":{"requests":[]},"action":{"type":"block"}}"#,
        )];

        let normalized = normalize_and_validate_tool_calls(Some(&tool_calls))
            .expect("normalize should succeed")
            .expect("tool_calls should be present");

        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].function.name, "generate_rule");
        let normalized_json: Value =
            serde_json::from_str(&normalized[0].function.arguments).expect("valid normalized args");
        let expected_json: Value = serde_json::json!({
            "name": "block bad",
            "rule_type": "block_request",
            "match": {
                "request": [],
                "response": [],
            },
            "actions": [{"type":"block"}],
            "enabled": false,
        });
        assert_eq!(normalized_json, expected_json);
    }

    #[test]
    fn tags_json_parse_failures() {
        let tool_calls = vec![make_tool_call("generate_regex", r#"{"pattern":"^/api""#)];
        let result = validate_tool_calls(Some(&tool_calls));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("json_parse_failed"));
    }

    #[test]
    fn tags_missing_field_failures() {
        let tool_calls = vec![make_tool_call("generate_filter", r#"{}"#)];
        let result = validate_tool_calls(Some(&tool_calls));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing_field"));
    }

    #[test]
    fn tags_schema_mismatch_failures_for_unknown_fields() {
        let tool_calls = vec![make_tool_call(
            "generate_regex",
            r#"{"pattern":"^/api","extra":"not_allowed"}"#,
        )];
        let result = validate_tool_calls(Some(&tool_calls));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("schema_mismatch"));
    }

    #[test]
    fn ignores_unknown_tools_for_compatibility() {
        let tool_calls = vec![make_tool_call("detect_intent", r#"{"intent":"NAVIGATE"}"#)];

        let result = validate_tool_calls(Some(&tool_calls));
        assert!(result.is_ok());
    }
}
