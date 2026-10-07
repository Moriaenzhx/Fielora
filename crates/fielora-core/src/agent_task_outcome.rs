//! Typed terminal proposals; only the Harness projects an accepted outcome.
use crate::agent_request_intent::{self, Intent};
use fielora_agent::{AgentError, ToolExecution, ToolExecutionSource, ToolSourceKind, ToolSpec};
use fielora_contracts::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const TOOL: &str = "finish_task";
pub const REQUIRED: &str = "AGENT_TASK_OUTCOME_REQUIRED";
pub const BLOCKED: &str = "AGENT_TASK_BLOCKED";
pub const GUIDANCE: &str = "General task outcome protocol: plain text is progress, never a completion signal. Continue using admitted tools while work remains. To finish, call finish_task ALONE with completed, an interpretation of the CURRENT request, an exact user quote, a substantive result and current-run tool_call_ids supporting action/verification claims. For a pure explanation use answer_only; knowledge answers need no artificial tool use. A read-only status question can complete with a negative finding: cite the actual observation/check even when success=false and explain its result or limits. A failed observation supports only the observed failure, not an unobserved target state. Completing that answer does not pass the check, complete a historical installation or authorize repairs. 'Can you install/fix/do X for me?' normally requests action, not a tutorial. Asking for a required URL, file, preference or permission is NOT completion: call request_user_input and wait in the SAME Run. If existing capabilities cannot proceed, inspect the admitted capability catalog and relevant allowed alternatives, then use blocked with evidence and a specific actionable reason. Missing web.search/web.fetch or an installer UI does not prove the admitted browser cannot research HTTP(S) sources. Never invent sources, bypass network/command/archive policy, or claim every route is impossible without evidence. A terminal proposal and a tool's success flag are not semantic proof; the Harness checks actual effects, unknown outcomes and fresh verification. Never downgrade an unfinished action to answer_only just because information is missing.";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Completed,
    Blocked,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub outcome: Outcome,
    pub intent: Intent,
    pub request_quote: String,
    pub summary: String,
    pub evidence_tool_call_ids: Vec<String>,
}

pub fn catalog() -> ToolSpec {
    ToolSpec {
        definition: ModelToolDefinition {
            name: TOOL.into(),
            description: GUIDANCE.into(),
            input_schema: json!({"type":"object","properties":{
                "outcome":{"type":"string","enum":["completed","blocked"]},
                "intent":{"type":"string","enum":["answer_only","action","workspace_change"]},
                "request_quote":{"type":"string","minLength":1,"maxLength":2000},
                "summary":{"type":"string","minLength":1,"maxLength":16000,"description":"User-visible final answer or specific remaining blocker. Required questions belong in request_user_input."},
                "evidence_tool_call_ids":{"type":"array","maxItems":64,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":128},"description":"Current Run's durable tool_call_id values, not provider call IDs. Empty is allowed only for a pure answer without effects."}
            },"required":["outcome","intent","request_quote","summary","evidence_tool_call_ids"],"additionalProperties":false}),
        },
        effect: AgentToolEffect::Observe,
        source: ToolExecutionSource {
            capability_id: TOOL.into(),
            capability_version: "1".into(),
            source_kind: ToolSourceKind::Builtin,
            provider_id: "fielora.builtin".into(),
            provider_tool_name: TOOL.into(),
            protocol_version: None,
            transport: Some("HARNESS".into()),
        },
    }
}

fn reject(code: &'static str, detail: &str) -> AgentError {
    AgentError::WorkGuidance {
        code,
        detail: detail.into(),
    }
}

fn successful(tool: &AgentToolCallView) -> bool {
    tool.status == AgentToolStatus::Completed
        && tool.receipt.as_ref().is_some_and(|r| {
            // An owned service can be alive after the tool call completes.
            // Its null exit code is not a failed command, nor is it verification.
            let live_service = tool.name == "browser_server"
                && r["kind"] == "BROWSER"
                && r["success"] == true
                && r["status"] == "RUNNING"
                && matches!(r["action"].as_str(), Some("server-start" | "server-status"));
            r["success"] != false
                && r.get("exit_code")
                    .is_none_or(|c| c.as_i64() == Some(0) || (c.is_null() && live_service))
        })
}

/// Rejected endings reset only when effects/check evidence changes. Observing
/// the same file or changing an intent/summary is not repairing the blocker.
#[derive(Default)]
pub struct RejectedOutcomes {
    last_evidence: Option<String>,
    count: u32,
}

impl RejectedOutcomes {
    pub fn reject(&mut self, facts: &[AgentToolCallView]) -> u32 {
        let evidence = facts
            .iter()
            .filter(|t| {
                t.name != TOOL
                    && ((matches!(
                        t.effect,
                        AgentToolEffect::WorkspaceWrite
                            | AgentToolEffect::Destructive
                            | AgentToolEffect::Network
                    ) && t.status == AgentToolStatus::Completed)
                        || t.receipt
                            .as_ref()
                            .is_some_and(|r| r["verification_eligible"] == true)
                        || t.name == "verify_skill"
                        || t.name == "browser_verify")
                    && t.receipt.is_some()
            })
            .map(|t| {
                let r = t.receipt.as_ref().unwrap();
                crate::agent_turn_context::digest(
                    &json!([
                        t.name,
                        t.status,
                        t.arguments,
                        r["after_sha256"],
                        r["bundle_sha256"],
                        r["success"],
                        r["stdout_sha256"],
                        r["exit_code"],
                        r["diagnostics"]
                    ])
                    .to_string(),
                )
            })
            .collect::<std::collections::BTreeSet<_>>();
        let key = serde_json::to_string(&evidence).unwrap_or_default();
        self.count = if self.last_evidence.as_ref() == Some(&key) {
            self.count.saturating_add(1)
        } else {
            1
        };
        self.last_evidence = Some(key);
        self.count
    }
}

fn verification_recovery(facts: &[AgentToolCallView]) -> String {
    let current_writes = facts.iter().filter(|t| t.effect == AgentToolEffect::WorkspaceWrite)
        .rev().take(16).map(|t| json!({"tool_call_id":t.id,"run_id":t.run_id,"name":t.name,"path":t.arguments["path"],"status":t.status,"after_sha256":t.receipt.as_ref().map(|r|&r["after_sha256"])})).collect::<Vec<_>>();
    let checks = facts.iter().filter(|t| t.receipt.as_ref().is_some_and(|r| r["verification_eligible"] == true))
        .rev().take(8).map(|t| json!({"tool_call_id":t.id,"name":t.name,"status":t.status,"success":t.receipt.as_ref().map(|r|&r["success"])})).collect::<Vec<_>>();
    format!(
        "Fresh verification is missing or failed for the CURRENT Run. Current writes: {}. Recorded checks: {}. Use run_command with the direct supported runner for a targeted assertion-based test (for Python: interpreter -m unittest/pytest), or browser_plan/browser_verify for requested rendered behavior; use verify_skill for Skill bundles. Plain python -c, print scripts, curl and server status do not create verification receipts even with exit 0. Assert the expected behavior using isolated test data; do not merely rename or wrap a print script. read_file/stat_path/list_files/git_read only observe. Retain per-case results with optional work_plan and recheck affected cases. Do not attribute these writes to historical Runs, retry an unchanged finish, downgrade intent, or commit Git to bypass verification.",
        json!(current_writes),
        json!(checks)
    )
}

/// Facts are read by the Harness, never supplied by the Model.
pub fn record(
    run: &AgentRunView,
    arguments: &Value,
    facts: &[AgentToolCallView],
    verified: bool,
    unread_references: bool,
) -> Result<ToolExecution, AgentError> {
    let mut p: Proposal =
        serde_json::from_value(arguments.clone()).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    p.summary = fielora_agent::redact_output(&fielora_model::sanitize_agent_text(&p.summary))
        .trim()
        .into();
    if p.request_quote.trim().is_empty()
        || p.request_quote.chars().count() > 2000
        || !run.task.contains(&p.request_quote)
        || p.summary.is_empty()
        || p.summary.chars().count() > 16000
        || p.evidence_tool_call_ids.len() > 64
    {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let mut evidence = Vec::new();
    for id in &p.evidence_tool_call_ids {
        if id.is_empty()
            || id.len() > 128
            || evidence.iter().any(|t: &&AgentToolCallView| t.id.0 == *id)
        {
            return Err(AgentError::ToolArgumentsInvalid);
        }
        let t = facts.iter().find(|t| t.id.0 == *id && t.run_id == run.id && t.name != TOOL && t.receipt.is_some())
            .ok_or_else(|| reject("AGENT_OUTCOME_EVIDENCE_INVALID", "Use actual durable tool_call_id values from this Run. Missing, foreign, self-referential or receipt-free evidence cannot support an outcome."))?;
        evidence.push(t);
    }
    if p.outcome == Outcome::Blocked {
        if evidence.is_empty()
            || evidence.iter().any(|t| {
                !matches!(
                    t.status,
                    AgentToolStatus::Completed | AgentToolStatus::Failed | AgentToolStatus::Denied
                )
            })
        {
            return Err(reject(
                "AGENT_BLOCKER_EVIDENCE_REQUIRED",
                "First inspect the current capabilities or actual failure. A missing source should use request_user_input. A claim of inability without current observations is not a supported blocker.",
            ));
        }
    } else {
        if facts.iter().any(|t| t.status == AgentToolStatus::Unknown) {
            return Err(reject(
                "AGENT_RECOVERY_REQUIRED",
                "Reconcile unknown outcomes before claiming completion; do not replay effects blindly.",
            ));
        }
        if unread_references {
            return Err(reject(
                "AGENT_REFERENCE_READ_REQUIRED",
                "Read explicitly supplied references before completing this task.",
            ));
        }
        let (action, change) =
            agent_request_intent::requirements(Some(p.intent), facts, false, false);
        let browser_acceptance = facts
            .iter()
            .any(|t| matches!(t.name.as_str(), "browser_plan" | "browser_verify"));
        // A negative finding can answer a question without establishing a
        // successful action. Actual effects and acceptance obligations still
        // prevent relabeling unfinished work as a read-only report.
        let observation_report =
            p.intent == Intent::AnswerOnly && !action && !change && !browser_acceptance;
        if evidence.iter().any(|t| {
            !successful(t)
                && !(observation_report
                    && t.effect == AgentToolEffect::Observe
                    && matches!(
                        t.status,
                        AgentToolStatus::Completed
                            | AgentToolStatus::Failed
                            | AgentToolStatus::Denied
                    ))
        }) {
            return Err(reject(
                "AGENT_OUTCOME_EVIDENCE_INVALID",
                &format!(
                    "These cited receipts do not establish successful actions: {}. Inspect each status/success/exit_code, then cite the actual successful recovery/check. Failed or denied actions are not success evidence. A running managed service's null exit code is valid service-state evidence, never business verification. Negative observations support answer_only reports only without action or acceptance obligations; do not claim unverified work succeeded.",
                    json!(
                        evidence
                            .iter()
                            .filter(|t| !successful(t))
                            .take(8)
                            .map(|t| json!({
                                "tool_call_id":t.id,"name":t.name,"status":t.status,
                                "success":t.receipt.as_ref().map(|r| &r["success"]),
                                "exit_code":t.receipt.as_ref().map(|r| &r["exit_code"])
                            }))
                            .collect::<Vec<_>>()
                    )
                ),
            ));
        }
        if (change || browser_acceptance) && !verified {
            return Err(reject(
                "AGENT_VERIFICATION_REQUIRED",
                &verification_recovery(facts),
            ));
        }
        if action
            && !evidence
                .iter()
                .any(|t| successful(t) && t.effect != AgentToolEffect::Observe)
        {
            return Err(reject(
                "AGENT_ACTION_REQUIRED",
                "The requested action has no successful current-run evidence. Perform the action, request genuinely missing input, or report an evidenced blocker; do not relabel an installation as answer_only.",
            ));
        }
        // An earlier explicit action interpretation cannot silently disappear.
        if p.intent == Intent::AnswerOnly
            && agent_request_intent::latest(&run.id, &run.task, facts)
                .is_some_and(|i| i != Intent::AnswerOnly)
        {
            return Err(reject(
                "AGENT_OUTCOME_INTENT_CONFLICT",
                "The current request was recorded as action. If the user actually changed it, record the corrected interpretation with source first; missing information is not an answer-only request.",
            ));
        }
    }
    Ok(ToolExecution {
        receipt: json!({"kind":"TASK_OUTCOME_PROPOSAL_V1","run_id":run.id,"request_sha256":crate::agent_turn_context::digest(&run.task),"proposal":p,"verification_passed":verified,"verification_eligible":false,"task_complete":false,"semantic_understanding_verified":false}),
        observation: "Outcome proposal validated against current facts. Only the Harness can now apply the Run transition; this tool receipt is not itself task completion or permission.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run() -> AgentRunView {
        serde_json::from_value(json!({"id":"run","field_id":"project","conversation_id":"conversation",
            "provider_config_id":"provider","model_id":"fixture","task":"需要你安装一下archify的skill 你可以自己去安装吗",
            "permission":"FULL_CONTROL","status":"RUNNING","current_step":1,"max_steps":20,"next_sequence":1,"created_at":0,"updated_at":0})).unwrap()
    }
    fn args(outcome: &str, intent: &str, evidence: Value) -> Value {
        json!({"outcome":outcome,"intent":intent,"request_quote":run().task,"summary":"Outcome fixture.","evidence_tool_call_ids":evidence})
    }
    fn fact(id: &str, effect: &str, status: &str, receipt: Value) -> AgentToolCallView {
        serde_json::from_value(json!({"id":id,"run_id":"run","name":"fixture","effect":effect,"status":status,
            "policy_decision":"ALLOW","arguments":{},"receipt":receipt,"created_at":0,"updated_at":0})).unwrap()
    }
    #[test]
    fn live_service_is_success_evidence_but_never_substitutes_for_verification() {
        let mut service = fact(
            "server",
            "PROCESS",
            "COMPLETED",
            json!({
                "kind":"BROWSER","action":"server-status","success":true,
                "status":"RUNNING","exit_code":null,"verification_eligible":false
            }),
        );
        service.name = "browser_server".into();
        let write = fact(
            "write",
            "WORKSPACE_WRITE",
            "COMPLETED",
            json!({"success":true}),
        );
        let proposal = args("completed", "workspace_change", json!(["write", "server"]));
        for action in ["server-start", "server-status"] {
            service.receipt.as_mut().unwrap()["action"] = json!(action);
            let facts = [write.clone(), service.clone()];
            assert_eq!(
                record(&run(), &proposal, &facts, false, false)
                    .unwrap_err()
                    .code(),
                "AGENT_VERIFICATION_REQUIRED"
            );
            assert!(record(&run(), &proposal, &facts, true, false).is_ok());
            assert_eq!(
                service.receipt.as_ref().unwrap()["verification_eligible"],
                false
            );
        }
        for (name, status, success, exit, action) in [
            ("run_command", "RUNNING", true, Value::Null, "server-status"),
            (
                "browser_server",
                "FAILED",
                true,
                Value::Null,
                "server-status",
            ),
            (
                "browser_server",
                "RUNNING",
                false,
                Value::Null,
                "server-status",
            ),
            ("browser_server", "RUNNING", true, json!(1), "server-status"),
            (
                "browser_server",
                "RUNNING",
                true,
                json!("0"),
                "server-status",
            ),
            ("browser_server", "RUNNING", true, Value::Null, "unknown"),
        ] {
            let mut invalid = service.clone();
            invalid.name = name.into();
            let r = invalid.receipt.as_mut().unwrap();
            r["status"] = json!(status);
            r["success"] = json!(success);
            r["exit_code"] = exit;
            r["action"] = json!(action);
            assert_eq!(
                record(&run(), &proposal, &[write.clone(), invalid], true, false)
                    .unwrap_err()
                    .code(),
                "AGENT_OUTCOME_EVIDENCE_INVALID"
            );
        }
    }
    #[test]
    fn negative_observations_can_complete_a_status_answer_without_passing_the_check() {
        let mut current = run();
        current.task = "现在有装好archify这个skill吗".into();
        let proposal = json!({"outcome":"completed","intent":"answer_only",
            "request_quote":current.task,"summary":"尚未完整安装：入口存在，资源缺失。",
            "evidence_tool_call_ids":["check"]});
        for status in ["COMPLETED", "FAILED", "DENIED"] {
            let mut check = fact(
                "check",
                "OBSERVE",
                status,
                json!({"success":false,"verification_eligible":true,"diagnostics":[{"code":"SKILL_RESOURCE_MISSING","path":"bin/main.mjs"}]}),
            );
            check.name = "verify_skill".into();
            let receipt = record(
                &current,
                &proposal,
                std::slice::from_ref(&check),
                false,
                false,
            )
            .unwrap()
            .receipt;
            assert_eq!(receipt["verification_passed"], false);
            assert_eq!(receipt["task_complete"], false);
            assert_eq!(receipt["semantic_understanding_verified"], false);
            assert_eq!(check.receipt.as_ref().unwrap()["success"], false);
        }
        for status in ["PROPOSED", "RUNNING", "WAITING_APPROVAL", "UNKNOWN"] {
            let check = fact("check", "OBSERVE", status, json!({"success":false}));
            assert!(record(&current, &proposal, &[check], false, false).is_err());
        }
    }

    #[test]
    fn negative_observation_reporting_cannot_discharge_action_or_acceptance_obligations() {
        let current = run();
        let check = fact("check", "OBSERVE", "COMPLETED", json!({"success":false}));
        let answer = args("completed", "answer_only", json!(["check"]));
        for intent in ["action", "workspace_change"] {
            assert!(
                record(
                    &current,
                    &args("completed", intent, json!(["check"])),
                    std::slice::from_ref(&check),
                    false,
                    false
                )
                .is_err()
            );
        }
        for effect in ["WORKSPACE_WRITE", "PROCESS", "NETWORK", "DESTRUCTIVE"] {
            for status in ["COMPLETED", "FAILED", "DENIED", "UNKNOWN"] {
                let action = fact("effect", effect, status, json!({"success":false}));
                assert!(
                    record(&current, &answer, &[check.clone(), action], false, false).is_err(),
                    "{effect}/{status}"
                );
            }
        }
        for name in ["browser_plan", "browser_verify"] {
            let mut check = check.clone();
            check.name = name.into();
            assert!(record(&current, &answer, &[check], false, false).is_err());
        }
        assert_eq!(
            record(&current, &answer, std::slice::from_ref(&check), false, true)
                .unwrap_err()
                .code(),
            "AGENT_REFERENCE_READ_REQUIRED"
        );
        let mut interpretation = fact(
            "intent",
            "OBSERVE",
            "COMPLETED",
            agent_request_intent::record(
                &current.id,
                &current.task,
                &json!({"intent":"action","request_quote":current.task}),
            )
            .unwrap()
            .receipt,
        );
        interpretation.name = agent_request_intent::TOOL.into();
        assert_eq!(
            record(
                &current,
                &answer,
                &[check.clone(), interpretation],
                false,
                false
            )
            .unwrap_err()
            .code(),
            "AGENT_OUTCOME_INTENT_CONFLICT"
        );
        let mut foreign = check.clone();
        foreign.run_id = AgentRunId::new("historical");
        assert_eq!(
            record(&current, &answer, &[foreign], false, false)
                .unwrap_err()
                .code(),
            "AGENT_OUTCOME_EVIDENCE_INVALID"
        );
        let mut empty = check;
        empty.receipt = None;
        assert!(record(&current, &answer, &[empty], false, false).is_err());
    }

    #[test]
    fn observations_and_relabeling_do_not_reset_rejected_outcomes() {
        let mut rejected = RejectedOutcomes::default();
        let mut facts = vec![fact(
            "write",
            "WORKSPACE_WRITE",
            "COMPLETED",
            json!({"after_sha256":"one"}),
        )];
        assert_eq!(rejected.reject(&facts), 1);
        for name in [
            "read_file",
            "stat_path",
            "git_read",
            "record_request_intent",
        ] {
            let mut t = fact(
                name,
                "OBSERVE",
                "COMPLETED",
                json!({"sha256":"one","intent":"answer_only"}),
            );
            t.name = name.into();
            facts.push(t);
        }
        assert_eq!(rejected.reject(&facts), 2);
        facts.push(facts.last().unwrap().clone());
        assert_eq!(rejected.reject(&facts), 3);
        facts.push(fact(
            "repair",
            "WORKSPACE_WRITE",
            "COMPLETED",
            json!({"after_sha256":"two"}),
        ));
        assert_eq!(rejected.reject(&facts), 1);
        let detail = verification_recovery(&facts);
        assert!(
            detail.contains("CURRENT Run")
                && detail.contains("run_command")
                && detail.contains("read_file")
        );
    }
    #[test]
    fn typed_outcomes_do_not_turn_missing_or_failed_work_into_success() {
        let run = run();
        assert_eq!(
            record(
                &run,
                &args("completed", "action", json!([])),
                &[],
                false,
                false
            )
            .unwrap_err()
            .code(),
            "AGENT_ACTION_REQUIRED"
        );
        assert_eq!(
            record(
                &run,
                &args("blocked", "action", json!([])),
                &[],
                false,
                false
            )
            .unwrap_err()
            .code(),
            "AGENT_BLOCKER_EVIDENCE_REQUIRED"
        );
        assert!(
            record(
                &run,
                &args("completed", "answer_only", json!([])),
                &[],
                false,
                false
            )
            .is_ok()
        );
        let write = fact(
            "write",
            "WORKSPACE_WRITE",
            "COMPLETED",
            json!({"success":true}),
        );
        let verify = fact(
            "check",
            "PROCESS",
            "COMPLETED",
            json!({"exit_code":0,"verification_eligible":true}),
        );
        let facts = vec![write, verify];
        let complete = args("completed", "workspace_change", json!(["write", "check"]));
        assert_eq!(
            record(&run, &complete, &facts, false, false)
                .unwrap_err()
                .code(),
            "AGENT_VERIFICATION_REQUIRED"
        );
        assert!(record(&run, &complete, &facts, true, false).is_ok());
        assert_eq!(
            record(&run, &complete, &facts, true, true)
                .unwrap_err()
                .code(),
            "AGENT_REFERENCE_READ_REQUIRED"
        );
        for status in ["FAILED", "DENIED", "UNKNOWN"] {
            let f = fact(
                "bad",
                "PROCESS",
                status,
                json!({"success":false,"exit_code":1}),
            );
            assert!(
                record(
                    &run,
                    &args("completed", "action", json!(["bad"])),
                    &[f],
                    true,
                    false
                )
                .is_err()
            );
        }
        let unknown = fact("unknown", "NETWORK", "UNKNOWN", json!({}));
        assert_eq!(
            record(
                &run,
                &args("completed", "answer_only", json!([])),
                &[unknown],
                false,
                false
            )
            .unwrap_err()
            .code(),
            "AGENT_RECOVERY_REQUIRED"
        );
        let failed_write = fact(
            "write",
            "WORKSPACE_WRITE",
            "FAILED",
            json!({"success":false}),
        );
        assert_eq!(
            record(
                &run,
                &args("completed", "answer_only", json!([])),
                &[failed_write],
                false,
                false
            )
            .unwrap_err()
            .code(),
            "AGENT_VERIFICATION_REQUIRED"
        );
        let mut browser = fact("browser-plan", "OBSERVE", "COMPLETED", json!({}));
        browser.name = "browser_plan".into();
        let answer = args("completed", "answer_only", json!(["browser-plan"]));
        assert_eq!(
            record(&run, &answer, &[browser.clone()], false, false)
                .unwrap_err()
                .code(),
            "AGENT_VERIFICATION_REQUIRED"
        );
        assert!(record(&run, &answer, &[browser], true, false).is_ok());
    }
    #[test]
    fn outcome_evidence_is_current_scoped_and_not_a_self_grant() {
        let run = run();
        let mut f = fact(
            "capability",
            "OBSERVE",
            "COMPLETED",
            json!({"web_research":{"status":"UNSUPPORTED_CAPABILITY"}}),
        );
        let blocked = args("blocked", "action", json!(["capability"]));
        let receipt = record(&run, &blocked, &[f.clone()], false, false)
            .unwrap()
            .receipt;
        assert_eq!(receipt["task_complete"], false);
        assert_eq!(receipt["verification_eligible"], false);
        assert_eq!(receipt["semantic_understanding_verified"], false);
        for evidence in [json!(["missing"]), json!(["capability", "capability"])] {
            assert!(
                record(
                    &run,
                    &args("blocked", "action", evidence),
                    &[f.clone()],
                    false,
                    false
                )
                .is_err()
            );
        }
        f.run_id = AgentRunId::new("foreign");
        assert_eq!(
            record(&run, &blocked, &[f], false, false)
                .unwrap_err()
                .code(),
            "AGENT_OUTCOME_EVIDENCE_INVALID"
        );
        let mut invalid = args("completed", "answer_only", json!([]));
        invalid["grant_authority"] = json!(true);
        assert!(record(&run, &invalid, &[], false, false).is_err());
        invalid = args("completed", "answer_only", json!([]));
        invalid["request_quote"] = json!("unrelated");
        assert!(record(&run, &invalid, &[], false, false).is_err());
        invalid = args("completed", "answer_only", json!([]));
        invalid["summary"] = json!(" ");
        assert!(record(&run, &invalid, &[], false, false).is_err());
    }
}
