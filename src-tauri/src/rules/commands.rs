use super::model::{Rule, RuleGroup};
use super::storage::{ImportResult, RuleStorage};
use crate::audit::{audit, AuditEvent, AuditResult};
use crate::common::error::ToTauriError;
use std::collections::HashMap;
use std::path::Path;

/// Get rules directory path
#[tauri::command]
pub fn get_rules_dir_path() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    Ok(storage.base_dir.to_string_lossy().to_string())
}

/// Load all rules
#[tauri::command]
pub fn load_all_rules() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let response = storage.load_all().map_err(|e| e.to_tauri_error())?;

    serde_json::to_string(&response).map_err(|e| format!("Failed to serialize response: {}", e))
}

/// Save rule
#[tauri::command]
pub fn save_rule(rule_json: String, group_id: Option<String>) -> Result<(), String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let rule: Rule =
        serde_json::from_str(&rule_json).map_err(|e| format!("Failed to parse rule: {}", e))?;

    // Resolve added-vs-updated for the audit detail (best effort).
    let existed = storage
        .load_all()
        .map(|response| response.rules.iter().any(|e| e.rule.id == rule.id))
        .unwrap_or(false);

    storage
        .save(&rule, group_id.as_deref())
        .map_err(|e| e.to_tauri_error())?;

    audit(
        AuditEvent::user("rules.save")
            .target(rule.id.clone())
            .detail(format!(
                "{} ({})",
                rule.name,
                if existed { "updated" } else { "added" }
            )),
    );
    Ok(())
}

/// Delete rule
#[tauri::command]
pub fn delete_rule(rule_id: String) -> Result<(), String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    // Resolve the rule name before deletion for the audit detail.
    let rule_name = storage.load_all().ok().and_then(|response| {
        response
            .rules
            .iter()
            .find(|e| e.rule.id == rule_id)
            .map(|e| e.rule.name.clone())
    });

    storage.delete(&rule_id).map_err(|e| e.to_tauri_error())?;

    let mut event = AuditEvent::user("rules.delete").target(rule_id);
    if let Some(name) = rule_name {
        event = event.detail(name);
    }
    audit(event);
    Ok(())
}

/// Load groups
#[tauri::command]
pub fn load_groups() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let groups = storage.load_groups().map_err(|e| e.to_tauri_error())?;

    serde_json::to_string(&groups).map_err(|e| format!("Failed to serialize groups: {}", e))
}

/// Save groups
#[tauri::command]
pub fn save_groups(groups_json: String) -> Result<(), String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let groups: Vec<RuleGroup> =
        serde_json::from_str(&groups_json).map_err(|e| format!("Failed to parse groups: {}", e))?;

    let old_groups = storage.load_groups().unwrap_or_default();

    storage
        .save_groups(&groups)
        .map_err(|e| e.to_tauri_error())?;

    let changed = count_group_changes(&old_groups, &groups);
    if changed > 0 {
        audit(
            AuditEvent::user("rules.groups.save").detail(format!("{} group(s) changed", changed)),
        );
    }
    Ok(())
}

/// Export rules bundle
#[tauri::command]
pub fn export_rules_bundle() -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage.export_bundle().map_err(|e| e.to_tauri_error())
}

/// Import rules bundle, returning per-rule success/failure details
#[tauri::command]
pub fn import_rules_bundle(yaml_content: String) -> Result<ImportResult, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;
    let result = storage
        .import_bundle(&yaml_content)
        .map_err(|e| e.to_tauri_error())?;
    audit_import_result("rules.import", &result);
    Ok(result)
}

/// Export rules to a ZIP file
#[tauri::command]
pub async fn export_rules_zip(save_path: String) -> Result<String, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    storage
        .export_zip(Path::new(&save_path))
        .map_err(|e| e.to_tauri_error())?;

    Ok(format!("Successfully exported rules to {}", save_path))
}

/// Import rules from a ZIP file
#[tauri::command]
pub async fn import_rules_zip(zip_path: String) -> Result<ImportResult, String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    let result = storage
        .import_zip(Path::new(&zip_path))
        .map_err(|e| e.to_tauri_error())?;
    audit_import_result("rules.import", &result);
    Ok(result)
}

fn audit_import_result(action: &str, result: &ImportResult) {
    let mut event = AuditEvent::user(action)
        .result(if result.success {
            AuditResult::Ok
        } else {
            AuditResult::Error
        })
        .meta(serde_json::json!({
            "imported": result.imported_count,
            "skipped": result.skipped_count,
            "failed": result.failed_rules.len(),
        }));
    if let Some(error) = &result.error {
        event = event.detail(error.clone());
    }
    audit(event);
}

/// One entry of the `save_all_rules` payload. Accepts both the camelCase
/// `groupId` the frontend sends and the legacy snake_case spelling.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRuleEntry {
    rule: Rule,
    #[serde(alias = "group_id")]
    group_id: String,
}

/// Save all rules and groups in a single batch operation
/// This is more efficient than calling save_rule multiple times
#[tauri::command]
pub async fn save_all_rules(rules_json: String, groups_json: String) -> Result<(), String> {
    let storage = RuleStorage::from_config().map_err(|e| e.to_tauri_error())?;

    // Parse rules with their group IDs
    let entries: Vec<SaveRuleEntry> =
        serde_json::from_str(&rules_json).map_err(|e| format!("Failed to parse rules: {}", e))?;

    // Parse groups
    let groups: Vec<RuleGroup> =
        serde_json::from_str(&groups_json).map_err(|e| format!("Failed to parse groups: {}", e))?;

    // Snapshot existing state once so the audit diff reflects what changed.
    let old_rules: HashMap<String, Rule> = storage
        .load_all()
        .map(|response| {
            response
                .rules
                .into_iter()
                .map(|entry| (entry.rule.id.clone(), entry.rule))
                .collect()
        })
        .unwrap_or_default();
    let old_groups = storage.load_groups().unwrap_or_default();

    // Save each rule
    for entry in &entries {
        storage
            .save(&entry.rule, Some(&entry.group_id))
            .map_err(|e| e.to_tauri_error())?;
    }

    // Save groups
    storage
        .save_groups(&groups)
        .map_err(|e| e.to_tauri_error())?;

    let new_rules: HashMap<String, Rule> = entries
        .iter()
        .map(|entry| (entry.rule.id.clone(), entry.rule.clone()))
        .collect();
    let mut diff = diff_rule_sets(&old_rules, &new_rules);
    diff.groups_changed = count_group_changes(&old_groups, &groups);
    if !diff.is_empty() {
        audit(AuditEvent::user("rules.save").detail(rules_diff_detail(&diff)));
    }

    Ok(())
}

// ── Audit diff helpers (pure) ──────────────────────────────────────────────

const DIFF_NAME_CAP: usize = 10;

#[derive(Debug, Default, PartialEq)]
struct RuleSetDiff {
    added: Vec<String>,
    updated: Vec<String>,
    /// "name: on→off" / "name: off→on" entries.
    toggled: Vec<String>,
    groups_changed: usize,
}

impl RuleSetDiff {
    fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.updated.is_empty()
            && self.toggled.is_empty()
            && self.groups_changed == 0
    }
}

/// Compare the previously stored rules (by id) with an incoming full set.
/// `execution.enabled` flips are reported as toggles, not content updates.
/// Rules present on disk but absent from the payload are NOT reported as
/// removed: `save_all_rules` never deletes files, so absence means "not
/// part of this save" (e.g. a rule created via MCP before the frontend
/// reloaded). Deletions are audited by `delete_rule`.
fn diff_rule_sets(old: &HashMap<String, Rule>, new: &HashMap<String, Rule>) -> RuleSetDiff {
    let mut diff = RuleSetDiff::default();
    for (id, new_rule) in new {
        match old.get(id) {
            None => diff.added.push(new_rule.name.clone()),
            Some(old_rule) => {
                if old_rule.execution.enabled != new_rule.execution.enabled {
                    diff.toggled.push(format!(
                        "{}: {}→{}",
                        new_rule.name,
                        if old_rule.execution.enabled {
                            "on"
                        } else {
                            "off"
                        },
                        if new_rule.execution.enabled {
                            "on"
                        } else {
                            "off"
                        },
                    ));
                }
                if rule_content_key(old_rule) != rule_content_key(new_rule) {
                    diff.updated.push(new_rule.name.clone());
                }
            }
        }
    }
    diff.added.sort();
    diff.updated.sort();
    diff.toggled.sort();
    diff
}

/// Serialized rule content with `execution.enabled` normalized so a pure
/// enable/disable flip is not double-reported as an update.
fn rule_content_key(rule: &Rule) -> serde_json::Value {
    let mut value = serde_json::to_value(rule).unwrap_or(serde_json::Value::Null);
    if let Some(execution) = value.get_mut("execution").and_then(|e| e.as_object_mut()) {
        execution.insert("enabled".to_string(), serde_json::Value::Bool(true));
    }
    value
}

/// Number of group definitions that were added, removed or modified.
fn count_group_changes(old: &[RuleGroup], new: &[RuleGroup]) -> usize {
    let mut count = 0;
    for group in new {
        match old.iter().find(|o| o.id == group.id) {
            None => count += 1,
            Some(old_group) => {
                if serde_json::to_value(old_group).ok() != serde_json::to_value(group).ok() {
                    count += 1;
                }
            }
        }
    }
    count
        + old
            .iter()
            .filter(|o| !new.iter().any(|n| n.id == o.id))
            .count()
}

fn capped_names(names: &[String]) -> String {
    if names.len() <= DIFF_NAME_CAP {
        names.join(", ")
    } else {
        format!(
            "{}, +{} more",
            names[..DIFF_NAME_CAP].join(", "),
            names.len() - DIFF_NAME_CAP
        )
    }
}

fn rules_diff_detail(diff: &RuleSetDiff) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !diff.added.is_empty() {
        parts.push(format!("added: {}", capped_names(&diff.added)));
    }
    if !diff.updated.is_empty() {
        parts.push(format!("updated: {}", capped_names(&diff.updated)));
    }
    if !diff.toggled.is_empty() {
        parts.push(format!("toggled: {}", capped_names(&diff.toggled)));
    }
    if diff.groups_changed > 0 {
        parts.push(format!("groups: {} changed", diff.groups_changed));
    }
    parts.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::model::{RuleExecution, RuleMatchConfig, RuleType};

    fn test_rule(id: &str, name: &str) -> Rule {
        Rule {
            id: id.to_string(),
            name: name.to_string(),
            r#type: RuleType::MapLocal,
            execution: RuleExecution {
                enabled: true,
                priority: 0,
                stop_on_match: None,
            },
            match_config: RuleMatchConfig {
                request: vec![],
                response: vec![],
            },
            actions: vec![],
            tags: None,
            metadata: None,
        }
    }

    fn map_of(rules: Vec<Rule>) -> HashMap<String, Rule> {
        rules.into_iter().map(|r| (r.id.clone(), r)).collect()
    }

    #[test]
    fn diff_detects_added_updated_and_toggled() {
        let mut updated = test_rule("r2", "Beta");
        updated.execution.priority = 5;
        let mut toggled = test_rule("r3", "Gamma");
        toggled.execution.enabled = false;

        let old = map_of(vec![
            test_rule("r1", "Alpha"),
            test_rule("r2", "Beta"),
            test_rule("r3", "Gamma"),
            test_rule("r4", "Delta"),
        ]);
        let new = map_of(vec![updated, toggled, test_rule("r5", "Epsilon")]);

        let diff = diff_rule_sets(&old, &new);
        assert_eq!(diff.added, vec!["Epsilon"]);
        // r1/r4 exist on disk but are absent from the payload — save_all_rules
        // does not delete them, so they must not be reported as removed.
        assert_eq!(diff.updated, vec!["Beta"]);
        assert_eq!(diff.toggled, vec!["Gamma: on→off"]);
        assert!(!diff.is_empty());
    }

    #[test]
    fn diff_rules_absent_from_payload_are_not_removals() {
        let old = map_of(vec![test_rule("r1", "Alpha"), test_rule("r2", "Beta")]);
        let new = map_of(vec![test_rule("r1", "Alpha")]);
        let diff = diff_rule_sets(&old, &new);
        assert!(diff.is_empty());
        assert_eq!(rules_diff_detail(&diff), "");
    }

    #[test]
    fn save_rule_entry_accepts_camel_and_snake_group_id() {
        // ruleStore.ts sends `groupId`; the legacy spelling must keep working.
        let rule = test_rule("r1", "Test");
        let camel: SaveRuleEntry = serde_json::from_value(serde_json::json!({
            "rule": rule,
            "groupId": "GroupA"
        }))
        .unwrap();
        assert_eq!(camel.group_id, "GroupA");
        let snake: SaveRuleEntry = serde_json::from_value(serde_json::json!({
            "rule": test_rule("r1", "Test"),
            "group_id": "GroupB"
        }))
        .unwrap();
        assert_eq!(snake.group_id, "GroupB");
    }

    #[test]
    fn diff_noop_produces_empty_diff() {
        let rules = map_of(vec![test_rule("r1", "Alpha")]);
        let diff = diff_rule_sets(&rules, &rules);
        assert!(diff.is_empty());
        assert_eq!(rules_diff_detail(&diff), "");
    }

    #[test]
    fn diff_toggled_only_is_not_an_update() {
        let mut flipped = test_rule("r1", "Alpha");
        flipped.execution.enabled = false;
        let old = map_of(vec![test_rule("r1", "Alpha")]);
        let new = map_of(vec![flipped]);
        let diff = diff_rule_sets(&old, &new);
        assert!(diff.updated.is_empty());
        assert_eq!(diff.toggled, vec!["Alpha: on→off"]);
    }

    #[test]
    fn diff_detail_truncates_at_ten_names() {
        let old = HashMap::new();
        let new = map_of(
            (0..12)
                .map(|i| test_rule(&format!("r{i}"), &format!("Rule {i:02}")))
                .collect(),
        );
        let diff = diff_rule_sets(&old, &new);
        let detail = rules_diff_detail(&diff);
        assert!(detail.contains("+2 more"));
        assert!(detail.starts_with("added: Rule 00"));
    }

    #[test]
    fn group_changes_counted_not_named() {
        let old = vec![RuleGroup {
            id: "g1".to_string(),
            name: "Old".to_string(),
            enabled: true,
            priority: 0,
            description: None,
        }];
        let new = vec![
            RuleGroup {
                id: "g1".to_string(),
                name: "New".to_string(),
                enabled: true,
                priority: 0,
                description: None,
            },
            RuleGroup {
                id: "g2".to_string(),
                name: "Added".to_string(),
                enabled: true,
                priority: 1,
                description: None,
            },
        ];
        assert_eq!(count_group_changes(&old, &new), 2);
        assert_eq!(count_group_changes(&old, &old), 0);
    }
}
