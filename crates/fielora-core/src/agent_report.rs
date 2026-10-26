//! Delivery projections over existing receipts, not a semantic verifier.
use crate::agent_work_state::CurrentWork;
use fielora_agent::AgentError;
use fielora_contracts::{AgentRunId, AgentToolCallView, AgentToolEffect, AgentToolStatus};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Basis {
    Inspection,
    Execution,
    Check,
    History,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EvidenceNote {
    pub tool_call_ids: Vec<String>,
    pub basis: Basis,
    pub subject: String,
    pub finding: String,
    pub limits: String,
}

pub(crate) fn schema() -> Value {
    json!({"type":"array","maxItems":8,"description":"Evidence-scoped delivery. For source/test reviews and action results, give concise notes linking the observed subject, concrete finding and limits to receipts. Use [] for answers with no tool-based findings. Keep summary to the direct answer; put coverage explanations here instead of repeating them. A test-source finding describes example inputs/assertions and what a pass WOULD support, not general algorithm/design correctness. For executed checks state actual cases/results and what remains untested. Subjects/findings/limits are your interpretations, not independently certified facts. The Harness checks basis and renders actual receipt/check state. report_evidence in current work lists admissible bases; notes do not require additional tools, plans or tests.","items":{"type":"object","properties":{
        "tool_call_ids":{"type":"array","minItems":1,"maxItems":8,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":128},"description":"Current-Run receipt IDs also present in evidence_tool_call_ids. Group only receipts with the same basis."},
        "basis":{"type":"string","enum":["inspection","execution","check","history"],"description":"Match report_evidence: inspection = reading/observing; execution = action receipt; check = an eligible check receipt (not necessarily passed or current); history = read_run_history. Reading test source is inspection, never check."},
        "subject":{"type":"string","minLength":1,"maxLength":240,"description":"Name the actual implementation/interface/file exercised or inspected, not a broad feature label. A copied test helper and application code are distinct subjects."},
        "finding":{"type":"string","minLength":1,"maxLength":1200,"description":"Concrete observation supported by these receipts: relevant input/action and observed/expected output. Reading source describes defined cases conditionally; do not report a new test run. Avoid replacing the actual cases with 'algorithm correct'."},
        "limits":{"type":"string","minLength":1,"maxLength":800,"description":"Material boundary of this finding: unexercised cases/interfaces, copied implementation, partial source/output or historical-only evidence. State what these particular observations do not establish. Do not invent missing user requirements or list irrelevant caveats."}
    },"required":["tool_call_ids","basis","subject","finding","limits"],"additionalProperties":false}})
}

fn clean(value: &str) -> String {
    fielora_agent::redact_output(&fielora_model::sanitize_agent_text(value))
        .trim()
        .to_owned()
}

fn bounded(value: &str) -> String {
    clean(value).chars().take(240).collect()
}

fn basis(tool: &AgentToolCallView) -> Basis {
    let receipt = tool.receipt.as_ref().unwrap_or(&Value::Null);
    if tool.name == "read_run_history" {
        Basis::History
    } else if matches!(
        tool.name.as_str(),
        "run_command" | "browser_verify" | "verify_skill"
    ) && receipt["verification_eligible"] == true
    {
        Basis::Check
    } else if tool.effect == AgentToolEffect::Observe
        || matches!(tool.name.as_str(), "web.search" | "web.fetch")
    {
        Basis::Inspection
    } else {
        Basis::Execution
    }
}

fn usable(tool: &AgentToolCallView) -> bool {
    tool.receipt.is_some()
        && !matches!(
            tool.name.as_str(),
            "finish_task"
                | "continue_task"
                | "work_plan"
                | "record_work_review"
                | "record_request_intent"
                | "request_user_input"
        )
}

fn fact(tool: &AgentToolCallView, current: &CurrentWork) -> Value {
    let receipt = tool.receipt.as_ref().unwrap_or(&Value::Null);
    let check = current
        .verification
        .checks
        .iter()
        .find(|c| c["tool_call_id"] == tool.id.0);
    let check_state = check.and_then(|c| c["state"].as_str()).or_else(|| {
        if basis(tool) != Basis::Check || tool.name == "run_command" {
            return None;
        }
        if tool.status != AgentToolStatus::Completed || !receipt["success"].is_boolean() {
            return Some("OUTCOME_UNKNOWN");
        }
        let fresh = if tool.name == "browser_verify" {
            crate::agent_browser_scope::fresh(receipt, current.verification.revision.as_deref())
        } else {
            current
                .verification
                .revision
                .as_deref()
                .is_some_and(|r| receipt["workspace_revision"] == r)
        };
        Some(if !fresh {
            "STALE"
        } else if receipt["success"] == true {
            "PASSED"
        } else {
            "FAILED"
        })
    });
    json!({"tool_call_id":tool.id,"tool":tool.name,"basis":basis(tool),"status":tool.status,
        "target":receipt["path"].as_str().or_else(|| tool.arguments["path"].as_str())
            .or_else(|| receipt["program"].as_str()).map(bounded),
        "command_arguments":(tool.name == "run_command").then(|| tool.arguments.get("argv"))
            .flatten().filter(|v| v.is_array() && v.to_string().len() <= 512).map(|v| clean(&v.to_string())),
        "output_truncated":receipt["stdout_truncated"].as_bool().zip(receipt["stderr_truncated"].as_bool()).map(|(out,err)|out || err),
        "source_sha256":receipt["sha256"].as_str().filter(|s| s.len()==64 && s.bytes().all(|b| b.is_ascii_hexdigit())),
        "source_truncated":receipt["truncated"].as_bool(),
        "success":receipt["success"].as_bool(),"exit_code":receipt["exit_code"].as_i64(),
        "check_state":check_state,
        "coverage":"RECORDED_OBSERVATION_ONLY","semantic_claims_verified":false})
}

/// Bounded context metadata. Never copy source/output bodies or model claims.
pub(crate) fn projection(tools: &[AgentToolCallView], current: &CurrentWork) -> Value {
    let eligible: Vec<_> = tools.iter().filter(|t| usable(t)).collect();
    json!({"receipts":eligible.iter().rev().take(12).map(|t| fact(t,current)).collect::<Vec<_>>(),
        "omitted_count":eligible.len().saturating_sub(12),
        "scope":"Receipt kinds and recorded check state only; subjects and inference coverage still require source-level judgment. No check_state is not proof of failure or a requirement to run a test."})
}

/// Validate mechanical provenance only. Never certify free-text entailment.
pub(crate) fn validate(
    notes: &mut [EvidenceNote],
    run_id: &AgentRunId,
    cited_ids: &[String],
    tools: &[AgentToolCallView],
    current: &CurrentWork,
) -> Result<Vec<Value>, AgentError> {
    let reject = |detail: String| AgentError::WorkGuidance {
        code: "AGENT_REPORT_EVIDENCE_INVALID",
        detail: format!(
            "{detail} Correct only evidence_notes using existing receipts. Do not repeat actions or tests to repair report formatting. This does not change required checks or grant completion."
        ),
    };
    if notes.len() > 8 {
        return Err(reject("At most 8 evidence notes are allowed.".into()));
    }
    let mut facts = Vec::new();
    for note in notes {
        for (value, max) in [
            (&mut note.subject, 240),
            (&mut note.finding, 1200),
            (&mut note.limits, 800),
        ] {
            *value = clean(value);
            if value.is_empty() || value.chars().count() > max {
                return Err(reject("Each note needs bounded nonempty subject, finding and limits matching the schema.".into()));
            }
        }
        if note.tool_call_ids.is_empty() || note.tool_call_ids.len() > 8 {
            return Err(reject(
                "Each note needs 1-8 current-Run evidence IDs.".into(),
            ));
        }
        let mut seen = std::collections::HashSet::new();
        let mut sources = Vec::new();
        for id in &note.tool_call_ids {
            let tool = tools
                .iter()
                .find(|t| t.id.0 == *id && &t.run_id == run_id && usable(t));
            let Some(tool) = tool.filter(|_| cited_ids.contains(id) && seen.insert(id)) else {
                return Err(reject("A note cites missing, duplicate, foreign or non-evidence receipts. Use IDs from evidence_tool_call_ids in this Run.".into()));
            };
            if basis(tool) != note.basis {
                return Err(reject(format!(
                    "Evidence basis mismatch: {}. Reading a test is inspection; only an executed eligible check is check. Historical observations are history, not current checks.",
                    fact(tool, current)
                )));
            }
            sources.push(fact(tool, current));
        }
        facts.push(json!({"receipts":sources,"semantic_claims_verified":false}));
    }
    Ok(facts)
}

pub(crate) fn render(summary: &str, notes: &[EvidenceNote], facts: &[Value]) -> String {
    let mut text = summary.to_owned();
    for (note, fact) in notes.iter().zip(facts) {
        let label = match note.basis {
            Basis::Inspection => "本轮读取或观察",
            Basis::Execution => "本轮操作回执",
            Basis::History => "历史记录，非本轮验证",
            Basis::Check => "本轮检查记录",
        };
        text.push_str(&format!(
            "\n\n{}（{}）\n\n{}\n\n范围：{}",
            note.subject, label, note.finding, note.limits
        ));
        // Facts come from accepted receipts, never the model's finding/limits.
        // Keep bounded identifiers in code spans so source names cannot become
        // links, markup or instructions in the delivery surface.
        let literal = |s: &str| format!("`{}`", s.replace('`', "'").replace(['\n', '\r'], " "));
        for receipt in fact["receipts"].as_array().into_iter().flatten() {
            let status = match receipt["status"].as_str() {
                Some("COMPLETED") => "已执行",
                Some("FAILED") => "执行失败",
                Some("DENIED") => "已拒绝",
                Some("CANCELLED") => "已取消",
                _ => "执行状态未确认",
            };
            let mut record = format!(
                "{} · {status}",
                literal(receipt["tool"].as_str().unwrap_or("unknown"))
            );
            if let Some(target) = receipt["target"].as_str() {
                record.push_str(&format!(" · {}", literal(target)));
            }
            if let Some(arguments) = receipt["command_arguments"].as_str() {
                record.push_str(&format!(" · 参数 {}", literal(arguments)));
            }
            if let Some(code) = receipt["exit_code"].as_i64() {
                record.push_str(&format!(" · 退出码 {code}"));
            }
            if receipt["source_truncated"] == true || receipt["output_truncated"] == true {
                record.push_str(" · 内容有截断");
            }
            text.push_str(&format!("\n\n工具记录：{record}。"));
        }
        if note.basis == Basis::Check {
            let states: Vec<_> = fact["receipts"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|r| match r["check_state"].as_str() {
                    Some("PASSED") => "通过（仅记录的检查）",
                    Some("FAILED") => "未通过",
                    Some("STALE" | "STALE_FAILED" | "INPUT_CHANGED_DURING_CHECK") => {
                        "输入已变化，不能作为当前通过"
                    }
                    Some("OUTCOME_UNKNOWN") => "结果未知",
                    _ => "未确认当前有效检查",
                })
                .collect();
            text.push_str(&format!("\n\n执行记录：{}。", states.join("；")));
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(id: &str, name: &str, effect: &str, receipt: Value) -> AgentToolCallView {
        serde_json::from_value(json!({"id":id,"run_id":"run","name":name,"effect":effect,
            "status":"COMPLETED","policy_decision":"ALLOW","arguments":{},"receipt":receipt,
            "error_code":null,"created_at":1,"updated_at":1}))
        .unwrap()
    }

    fn current() -> CurrentWork {
        CurrentWork {
            plan: None,
            verification: crate::agent_verification::Assessment {
                revision: Some("current".into()),
                ..Default::default()
            },
        }
    }

    fn note(id: &str, basis: Basis) -> EvidenceNote {
        EvidenceNote {
            tool_call_ids: vec![id.into()],
            basis,
            subject: "tests/example.js 的模拟函数".into(),
            finding: "源码包含搜索 milk 和 MILK 的断言；本轮只读取。".into(),
            limits: "即使通过，也只覆盖这些样例，未执行真实组件。".into(),
        }
    }

    #[test]
    fn source_and_history_cannot_impersonate_executed_checks() {
        for (name, expected) in [
            ("read_file", Basis::Inspection),
            ("read_run_history", Basis::History),
        ] {
            let tools = [tool(
                "read",
                name,
                "OBSERVE",
                json!({"kind":"FILE_READ","path":"tests/example.js","success":true,"verification_eligible":false}),
            )];
            let mut notes = [note("read", Basis::Check)];
            let error = validate(
                &mut notes,
                &AgentRunId::new("run"),
                &["read".into()],
                &tools,
                &current(),
            )
            .unwrap_err();
            assert_eq!(error.code(), "AGENT_REPORT_EVIDENCE_INVALID");
            assert!(
                error
                    .model_recovery_message()
                    .contains("Correct only evidence_notes")
            );
            notes[0].basis = expected;
            let facts = validate(
                &mut notes,
                &AgentRunId::new("run"),
                &["read".into()],
                &tools,
                &current(),
            )
            .unwrap();
            assert_eq!(facts[0]["receipts"][0]["check_state"], Value::Null);
            assert_eq!(facts[0]["semantic_claims_verified"], false);
            let delivered = render("只读分析完成。", &notes, &facts);
            assert!(delivered.contains(&notes[0].finding));
            assert!(delivered.contains(&notes[0].limits));
            assert!(!delivered.contains("执行记录：通过"));
        }
    }

    #[test]
    fn notes_cannot_bind_foreign_unlisted_duplicate_or_protocol_receipts() {
        let read = tool("read", "read_file", "OBSERVE", json!({"kind":"FILE_READ"}));
        for mode in ["foreign", "unlisted", "duplicate", "protocol", "missing"] {
            let mut tools = vec![read.clone()];
            let mut notes = vec![note("read", Basis::Inspection)];
            let mut cited = vec!["read".into()];
            match mode {
                "foreign" => tools[0].run_id = AgentRunId::new("other"),
                "unlisted" => cited.clear(),
                "duplicate" => notes[0].tool_call_ids.push("read".into()),
                "protocol" => tools[0].name = "finish_task".into(),
                _ => tools.clear(),
            }
            assert_eq!(
                validate(
                    &mut notes,
                    &AgentRunId::new("run"),
                    &cited,
                    &tools,
                    &current()
                )
                .unwrap_err()
                .code(),
                "AGENT_REPORT_EVIDENCE_INVALID",
                "{mode}"
            );
        }
    }

    #[test]
    fn check_delivery_uses_current_assessment_instead_of_model_success_labels() {
        let tools = [tool(
            "check",
            "run_command",
            "PROCESS",
            json!({"kind":"COMMAND","verification_eligible":true,"success":true,"exit_code":0,"workspace_revision":"old"}),
        )];
        for (state, label) in [
            ("PASSED", "通过（仅记录的检查）"),
            ("FAILED", "未通过"),
            ("STALE", "输入已变化，不能作为当前通过"),
            ("STALE_FAILED", "输入已变化，不能作为当前通过"),
        ] {
            let mut current = current();
            current
                .verification
                .checks
                .push(json!({"tool_call_id":"check","state":state}));
            let mut notes = [note("check", Basis::Check)];
            let facts = validate(
                &mut notes,
                &AgentRunId::new("run"),
                &["check".into()],
                &tools,
                &current,
            )
            .unwrap();
            let result = render("结果", &notes, &facts);
            assert!(result.contains(label), "{result}");
            if state != "PASSED" {
                assert!(!result.contains("执行记录：通过"));
            }
            assert!(!current.verification.passed());
        }
    }

    #[test]
    fn browser_check_freshness_is_scoped_and_execution_is_not_verification() {
        let mut browser = tool(
            "browser",
            "browser_verify",
            "OBSERVE",
            json!({"verification_eligible":true,"success":true,"workspace_revision":"old"}),
        );
        assert_eq!(fact(&browser, &current())["check_state"], "STALE");
        browser.receipt.as_mut().unwrap()["workspace_revision"] = json!("current");
        assert_eq!(fact(&browser, &current())["check_state"], "PASSED");
        browser.receipt.as_mut().unwrap()["success"] = json!(false);
        assert_eq!(fact(&browser, &current())["check_state"], "FAILED");
        let command = tool(
            "process",
            "run_command",
            "PROCESS",
            json!({"success":true,"exit_code":0,"verification_eligible":false}),
        );
        assert_eq!(basis(&command), Basis::Execution);
        assert_eq!(fact(&command, &current())["check_state"], Value::Null);
    }

    #[test]
    fn delivery_keeps_actual_command_status_separate_from_model_claims() {
        let mut command = tool(
            "check",
            "run_command",
            "PROCESS",
            json!({
                "program":"node", "exit_code":1, "success":false,
                "verification_eligible":false,"stdout_truncated":false,"stderr_truncated":true
            }),
        );
        command.arguments = json!({"program":"node","argv":["tests/actual.test.js"]});
        let mut notes = [note("check", Basis::Execution)];
        notes[0].finding = "Model claims success; this is not trusted status.".into();
        let facts = validate(
            &mut notes,
            &AgentRunId::new("run"),
            &["check".into()],
            &[command],
            &current(),
        )
        .unwrap();
        let text = render("Report", &notes, &facts);
        assert!(text.contains("退出码 1"));
        assert!(text.contains("tests/actual.test.js"));
        assert!(text.contains("内容有截断"));
        assert!(!text.contains("执行记录：通过"));
        assert_eq!(facts[0]["semantic_claims_verified"], false);
    }

    #[test]
    fn projection_is_bounded_metadata_and_legacy_delivery_stays_unchanged() {
        let tools:Vec<_>=(0..15).map(|i|tool(&i.to_string(),"read_file","OBSERVE",json!({"path":"file.js","truncated":true,"raw_output":"private source body","sha256":"not-a-valid-hash"}))).collect();
        let p = projection(&tools, &current());
        assert_eq!(p["omitted_count"], 3);
        assert_eq!(p["receipts"].as_array().unwrap().len(), 12);
        assert_eq!(p["receipts"][0]["source_truncated"], true);
        assert!(!p.to_string().contains("private source body"));
        assert!(!p.to_string().contains("not-a-valid-hash"));
        assert_eq!(
            render("Legacy or pure answer", &[], &[]),
            "Legacy or pure answer"
        );
    }
}
