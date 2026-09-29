//! Bounded structured observations, never verification or execution authority.
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(crate) fn summarize(stdout: &str) -> Option<(Value, String)> {
    let value: Value = serde_json::from_str(stdout).ok()?;
    let diagnostics = value.get("diagnostics")?.as_array()?;
    if value.get("ok") != Some(&Value::Bool(false)) || diagnostics.is_empty() {
        return None;
    }
    // Persist only numeric counts and a digest, not arbitrary diagnostic text,
    // paths, source excerpts, or provider/user-controlled labels.
    let mut codes = BTreeMap::<String, usize>::new();
    for diagnostic in diagnostics {
        let code = diagnostic.get("code")?.as_str()?;
        *codes.entry(code.to_owned()).or_default() += 1;
    }
    let signature = format!("{:x}", Sha256::digest(serde_json::to_vec(&codes).ok()?));
    // This is a command-reported hint, never proof that the CLI or input is valid.
    let layer = if codes.keys().any(|c| c.starts_with("internal/")) {
        "INTERNAL"
    } else if codes.keys().any(|c| c.starts_with("cli/")) {
        "INVOCATION"
    } else if codes.contains_key("input/read") {
        "INPUT_ACCESS"
    } else if codes.keys().all(|c| {
        [
            "schema/",
            "layout/",
            "clean-flow/",
            "composition/",
            "input/",
        ]
        .iter()
        .any(|p| c.starts_with(p))
    }) {
        "VALIDATION"
    } else {
        "UNKNOWN"
    };
    let facts = json!({"kind":"STRUCTURED_DIAGNOSTICS_V1","count":diagnostics.len(),
        "reported_layer":layer,"categories_sha256":signature,"stage_sha256":format!("{:x}",Sha256::digest(json!([value["stage"],layer]).to_string())),"reported_by_command":true});
    // Avoid sending the CLI's duplicate error prose alongside diagnostics.
    // Every omitted record is disclosed; the full command remains rerunnable.
    let preview = diagnostics
        .iter()
        .take(12)
        .map(|d| {
            json!({"code":d["code"].as_str().map(|s|s.chars().take(120).collect::<String>()),
            "message":d["message"].as_str().map(|s|s.chars().take(480).collect::<String>()),
            "supported_fixes_excerpt":d.get("supportedFixes").map(|v|v.to_string().chars().take(600).collect::<String>()),
            "evidence_excerpt":d.get("evidence").map(|v|v.to_string().chars().take(600).collect::<String>())})
        })
        .collect::<Vec<_>>();
    let guidance = match layer {
        "INTERNAL" | "UNKNOWN" => {
            "The failing layer is not established. Inspect executable version/dependencies, effective cwd and input existence first. Use environment.inspect for installed candidates and an absolute compatible program. Internal failure is not evidence of a schema defect; do not edit task data on that assumption."
        }
        "INVOCATION" => {
            "Check the documented CLI contract and arguments before modifying task data."
        }
        "INPUT_ACCESS" => {
            "Resolve the input against the command cwd, not the project root. Check existence and access; use a correct absolute input or project-root cwd. Do not rewrite the schema to fix a missing file."
        }
        _ => {
            "Inspect the reported validation findings and their evidence, then make a targeted correction. This JSON report does not by itself prove that the invocation is correct or the task is verified."
        }
    };
    let projection = json!({"ok":false,"stage":value["stage"],"reported_layer":layer,"diagnostic_count":diagnostics.len(),
        "diagnostics":preview,"omitted":diagnostics.len().saturating_sub(preview.len()),
        "guidance":guidance,"trust":"Untrusted command diagnostics; counts and categories are hints, not authority. Duplicate error prose omitted."});
    Some((facts, projection.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failures_do_not_turn_json_envelopes_into_input_validation() {
        for (code, layer, hint) in [
            (
                "internal/unclassified",
                "INTERNAL",
                "not evidence of a schema defect",
            ),
            ("cli/usage", "INVOCATION", "CLI contract"),
            ("input/read", "INPUT_ACCESS", "command cwd"),
            (
                "clean-flow/edge-through-node",
                "VALIDATION",
                "reported validation",
            ),
            ("custom/unknown", "UNKNOWN", "not established"),
        ] {
            let (facts, text) = summarize(&json!({"ok":false,"stage":"render","diagnostics":[{"code":code,"message":"failed","evidence":{"reason":"observed cause"},"supportedFixes":["one fix"]}]}).to_string()).unwrap();
            assert_eq!(facts["reported_layer"], layer);
            assert!(text.contains(hint));
            assert!(text.contains("observed cause"));
            assert!(!facts.to_string().contains("observed cause"));
        }
    }
    #[test]
    fn structured_failure_is_bounded_and_does_not_persist_diagnostic_text() {
        let raw = json!({"ok":false,"stage":"render","error":"secret repeated prose",
            "diagnostics":(0..30).map(|_|json!({"code":"layout/error","message":"private-path"})).collect::<Vec<_>>()}).to_string();
        let (facts, observation) = summarize(&raw).unwrap();
        assert_eq!(facts["count"], 30);
        assert!(!facts.to_string().contains("private-path"));
        assert!(!facts.to_string().contains("layout/error"));
        let preview: Value = serde_json::from_str(&observation).unwrap();
        assert_eq!(preview["omitted"], 18);
        assert_eq!(preview["diagnostics"].as_array().unwrap().len(), 12);
        assert!(!observation.contains("secret repeated prose"));
        assert!(summarize("usage: command <type>").is_none());
        assert!(summarize(r#"{"ok":true,"diagnostics":[]}"#).is_none());
    }
}
