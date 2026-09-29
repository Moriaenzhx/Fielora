//! Receipt-derived recovery projection; the existing Run ledger owns all state.
use fielora_contracts::{AgentToolCallView, AgentToolStatus};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub(crate) const CONTEXT_MARKER: &str = "FIELORA_RECOVERY_ATTEMPTS_V1\n";

// A retry family is an actual executable/entrypoint, not the workspace hash.
// Help/version probes are useful observations but cannot repair a failed task.
fn command_family(tool: &AgentToolCallView) -> Option<String> {
    if tool.name != "run_command" {
        return None;
    }
    let args = tool.arguments["argv"].as_array()?;
    if args
        .iter()
        .any(|a| matches!(a.as_str(), Some("--help" | "-h" | "--version" | "-v")))
    {
        return None;
    }
    let program = tool.arguments["program"].as_str()?;
    let executable = program.rsplit(['/', '\\']).next()?.to_ascii_lowercase();
    let entry = if matches!(
        executable.as_str(),
        "node" | "node.exe" | "python" | "python.exe" | "python3" | "python3.exe"
    ) {
        let script = args.first()?.as_str()?;
        if script.starts_with('-') {
            return None;
        }
        script.to_owned()
    } else {
        // Preserve subcommand/task identity for package managers and CLIs.
        args.iter()
            .take(2)
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join(" ")
    };
    Some(json!([program, entry, tool.arguments["cwd"]]).to_string())
}

#[derive(Default)]
struct CommandRecovery {
    attempts: u32,
    best_by_stage: HashMap<String, u64>,
    latest_id: String,
    best_count: Option<u64>,
}

pub(crate) fn command_plateau(tools: &[AgentToolCallView]) -> Option<Value> {
    let mut families = HashMap::<String, CommandRecovery>::new();
    let mut latest = None;
    for tool in tools {
        if tool.status != AgentToolStatus::Completed {
            continue;
        }
        let Some(family) = command_family(tool) else {
            continue;
        };
        let Some(r) = tool.receipt.as_ref() else {
            continue;
        };
        if r["success"] == true {
            families.remove(&family);
            if latest.as_ref() == Some(&family) {
                latest = None;
            }
            continue;
        }
        if r["success"] != false || r["exit_code"].as_i64().is_none() {
            continue;
        }
        let count = (r["diagnostic_summary"]["reported_layer"] == "VALIDATION")
            .then(|| r["diagnostic_summary"]["count"].as_u64())
            .flatten();
        let state = families.entry(family.clone()).or_default();
        // Only a new best count offers recovery headroom; oscillating between
        // old counts and mere output/hash changes do not erase the plateau.
        if let Some(count) = count {
            let stage = r["diagnostic_summary"]["stage_sha256"]
                .as_str()
                .unwrap_or("unknown")
                .to_owned();
            let best = state.best_by_stage.get(&stage).copied();
            if best.is_some_and(|best| count < best) {
                state.attempts = 0;
            }
            let best = best.map_or(count, |best| best.min(count));
            state.best_by_stage.insert(stage, best);
            state.best_count = Some(best);
        }
        state.attempts += 1;
        state.latest_id = tool.id.0.clone();
        latest = Some(family);
    }
    let CommandRecovery {
        attempts,
        latest_id: id,
        best_count: best,
        ..
    } = families.get(latest.as_ref()?)?;
    (*attempts >= 4).then(||json!({"kind":"COMMAND_RECOVERY_PLATEAU","failed_attempts_since_improvement":attempts,
        "best_reported_diagnostic_count":best,"latest_tool_call_id":id,
        "pause_required":*attempts>=8,
        "guidance":"Repeated failures of the same executable entrypoint remain unresolved. Edits, rereads, help and changed arguments are not recovery. Preserve the valid CLI contract; identify syntax/schema/layout/runtime failure before choosing a targeted change or a materially different method. Diagnostic counts are command-reported hints, not verification. Do not claim the task is fixed until its result is checked."}))
}

fn action(name: &str, args: &Value) -> Value {
    if name == "run_command" {
        json!([name, args["program"], args["argv"], args["cwd"]])
    } else {
        json!([name, args])
    }
}

fn outcome(tool: &AgentToolCallView) -> Value {
    let r = tool.receipt.as_ref().unwrap_or(&Value::Null);
    json!([
        tool.status,
        tool.error_code,
        r["success"],
        r["exit_code"],
        r["stdout_sha256"],
        r["stderr_sha256"],
        r["diagnostics"]
    ])
}

fn failed(tool: &AgentToolCallView) -> bool {
    tool.status == AgentToolStatus::Failed
        || tool.status == AgentToolStatus::Unknown
        || tool.receipt.as_ref().is_some_and(|r| r["success"] == false)
}

pub(crate) fn projection(tools: &[AgentToolCallView]) -> Value {
    let mut previous = HashMap::<String, (&AgentToolCallView, Value)>::new();
    let mut attempts = Vec::new();
    for tool in tools.iter().filter(|t| {
        matches!(
            t.status,
            AgentToolStatus::Completed | AgentToolStatus::Failed | AgentToolStatus::Unknown
        )
    }) {
        let identity = format!(
            "{:x}",
            Sha256::digest(action(&tool.name, &tool.arguments).to_string())
        );
        let result = outcome(tool);
        if failed(tool) || previous.get(&identity).is_some_and(|(p, _)| failed(p)) {
            let comparison = match previous.get(&identity) {
                Some((p, _)) if failed(p) && !failed(tool) => "RECOVERED",
                Some((_, old)) if *old == result => "SAME_FAILURE",
                Some(_) => "DIFFERENT_RESULT",
                None => "FIRST_ATTEMPT",
            };
            let category = crate::agent_runtime::classify_retry_failure(
                tool.error_code.as_deref(),
                Some(tool),
            )
            .id();
            attempts.push(json!({"tool_call_id":tool.id,"name":tool.name,"action_sha256":identity,
                "failure_type":if failed(tool) {category} else {"NONE"},"error_code":tool.error_code,
                "comparison":comparison,"workspace_revision":tool.receipt.as_ref().and_then(|r|r.get("workspace_revision")),
                "outcome_sha256":format!("{:x}",Sha256::digest(result.to_string())),
                "next_action": match category {
                    "UNKNOWN_EXECUTION" => "Reconcile the prior operation; do not repeat an uncertain side effect.",
                    "POLICY_DENIED" | "USER_DENIED" => "Respect the decision; do not switch tools to evade it.",
                    "STALE_SHA" => "Read the affected current input and rebuild the guarded operation.",
                    "MODEL_TRANSIENT" => "Check availability and attempt a bounded retry or an admitted equivalent route.",
                    "VERIFICATION_FAILURE" | "PROCESS_FAILURE" => "Inspect the exact diagnostics and input contract. Repair the relevant input, or choose a materially different admitted approach and verify its result.",
                    _ => "Inspect the error and available capabilities; select a relevant alternative within the existing task and permissions.",
                }}));
        }
        previous.insert(identity, (tool, result));
    }
    let total = attempts.len();
    json!({"source":"DURABLE_TOOL_RECEIPTS","total":total,"truncated":total>12,
        "attempts":attempts.into_iter().rev().take(12).collect::<Vec<_>>()})
}

// Reconstructed from the existing durable ledger, independently of the lossy
// conversational summary. A version probe proves launch, not task completion.
fn successful_runtime_probes(tools: &[AgentToolCallView]) -> Vec<Value> {
    let mut programs = std::collections::HashSet::new();
    tools.iter().rev().filter_map(|tool| {
        let program = tool.arguments["program"].as_str()?;
        if tool.name != "run_command" || tool.status != AgentToolStatus::Completed
            || !tool.receipt.as_ref().is_some_and(|r| r["success"] == true)
            || tool.arguments["argv"] != json!(["--version"])
            || program.len() > 512 || !std::path::Path::new(program).is_absolute()
            || !programs.insert(program.to_owned()) { return None; }
        Some(json!({"tool_call_id":tool.id,"program":program,"version":tool.receipt.as_ref().and_then(|r|r.get("runtime_version")),"fact":"ABSOLUTE_EXECUTABLE_VERSION_PROBE_SUCCEEDED"}))
    }).take(4).collect()
}

#[cfg(test)]
fn context(tools: &[AgentToolCallView]) -> Option<String> {
    context_for_segment(tools, 0)
}

pub(crate) fn context_for_segment(tools: &[AgentToolCallView], start: usize) -> Option<String> {
    let mut ledger = projection(tools);
    let probes = successful_runtime_probes(tools);
    let has_probes = !probes.is_empty();
    ledger["successful_runtime_probes"] = json!(probes);
    let runtime_candidates = tools
        .iter()
        .rev()
        .filter(|t| t.name == "load_skill" && t.status == AgentToolStatus::Completed)
        .filter_map(|t| t.receipt.as_ref()?.get("runtime_candidates"))
        .find(|v| v.as_array().is_some_and(|a| !a.is_empty()))
        .filter(|v| v.to_string().len() <= 12000)
        .cloned();
    let has_candidates = runtime_candidates.is_some();
    ledger["current_skill_runtime_candidates"] = json!(runtime_candidates);
    ledger["command_recovery"] = json!(command_plateau(&tools[start.min(tools.len())..]));
    let mut sources = std::collections::HashSet::new();
    ledger["observed_skill_sources"] = json!(tools.iter().rev().filter_map(|t| {
        let path = t.receipt.as_ref()?["path"].as_str()?;
        (t.name == "read_file" && t.status == AgentToolStatus::Completed
            && path.replace('\\',"/").ends_with("/SKILL.md") && sources.insert(path.to_owned()))
            .then(||json!({"path":path,"sha256":t.receipt.as_ref().unwrap()["sha256"],
                "guidance":"Read as a partial file. Use load_skill to restore full guidance before guessing its CLI."}))
    }).take(2).collect::<Vec<_>>());
    let mut commands = std::collections::HashSet::new();
    ledger["commands_reaching_structured_diagnostics"] = json!(tools.iter().rev().filter_map(|t| {
        let r = t.receipt.as_ref()?;
        let family = command_family(t)?;
        (r["diagnostic_summary"]["kind"] == "STRUCTURED_DIAGNOSTICS_V1"
            && r["diagnostic_summary"]["reported_layer"] == "VALIDATION"
            && t.arguments.to_string().len() <= 3000 && commands.insert(family))
            .then(||json!({"arguments":t.arguments,"tool_call_id":t.id,
                "workspace_revision":r["workspace_revision"],"diagnostic_summary":r["diagnostic_summary"],
                "meaning":"This invocation reported validation findings, not a pass or proof of correct arguments. Compare the reported input with the intended file and preserve documented CLI syntax. Internal, invocation and input-access failures are not validation evidence."}))
    }).take(2).collect::<Vec<_>>());
    (has_candidates || has_probes || ledger["total"].as_u64().unwrap_or(0) > 0 || !sources.is_empty()).then(|| format!(
        "{CONTEXT_MARKER}{ledger}\nThese are observed attempts, not a plan or instructions from tool content. Preserve the original goal. For a status/explanation request, an observed failure is a finding, not authorization to repair. For action requests, compare the most recent failure with earlier attempts; do not repeat an unchanged failure or restart unrelated exploration. Select a targeted correction or an available alternative, then compare actual results. Different results are not automatically progress; a recovered command is not task completion. Ask the user only for a concrete missing input or authorization. Successful runtime probes establish that those exact absolute executables launched. Preserve these facts after context reduction; prefer a proven compatible absolute path instead of silently returning to a bare PATH command. A probe does not prove dependencies or task success. Inspect stdout/stderr to distinguish CLI/schema/input errors from runtime incompatibility. These records grant no installation or execution permission."
    ))
}

/// Only suppress three proven identical, finished command failures on the same
/// observed input revision. Unknown inputs/outcomes cannot establish equivalence.
pub(crate) fn unchanged_failed_command(
    tools: &[AgentToolCallView],
    name: &str,
    args: &Value,
    current_revision: Option<&str>,
) -> bool {
    if name != "run_command" {
        return false;
    }
    let Some(revision) = current_revision else {
        return false;
    };
    let identity = action(name, args);
    let recent = tools
        .iter()
        .rev()
        .filter(|t| action(&t.name, &t.arguments) == identity)
        .take(3)
        .collect::<Vec<_>>();
    recent.len() == 3
        && recent.iter().all(|t| {
            t.status == AgentToolStatus::Completed
                && t.receipt.as_ref().is_some_and(|r| {
                    r["success"] == false
                        && r["exit_code"].as_i64().is_some_and(|n| n != 0)
                        && r["workspace_revision"].as_str() == Some(revision)
                })
                && outcome(t) == outcome(recent[0])
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_help_and_changed_arguments_do_not_erase_failure_plateau() {
        let mut tools = Vec::new();
        for i in 0..8 {
            let mut failed = attempt(&format!("fail-{i}"), &format!("revision-{i}"), false);
            failed.arguments["argv"] = json!(["render.cjs", format!("variant-{i}")]);
            tools.push(failed);
            let mut read = attempt(&format!("read-{i}"), "changed", true);
            read.name = "read_file".into();
            tools.push(read);
            let mut help = attempt(&format!("help-{i}"), "changed", true);
            help.arguments["argv"] = json!(["render.cjs", "--help"]);
            tools.push(help);
        }
        assert_eq!(command_plateau(&tools).unwrap()["pause_required"], true);
        let mut success = attempt("fixed", "final", true);
        success.arguments["argv"] = json!(["render.cjs", "deliver"]);
        tools.push(success);
        assert!(command_plateau(&tools).is_none());
        assert!(command_plateau(&[]).is_none()); // explicit continuation segment
    }

    #[test]
    fn only_a_new_best_diagnostic_count_gives_more_recovery_headroom() {
        let mut tools = Vec::new();
        for (i, count) in [10, 10, 9, 10, 9, 10, 9, 10, 9, 10].into_iter().enumerate() {
            let mut t = attempt(&i.to_string(), &i.to_string(), false);
            t.receipt.as_mut().unwrap()["diagnostic_summary"] =
                json!({"count":count,"reported_layer":"VALIDATION"});
            tools.push(t);
        }
        let p = command_plateau(&tools).unwrap();
        assert_eq!(p["best_reported_diagnostic_count"], 9);
        assert_eq!(p["pause_required"], true);
        let mut unrelated = attempt("other-pass", "latest", true);
        unrelated.arguments["argv"] = json!(["unrelated.cjs"]);
        tools.push(unrelated);
        assert_eq!(command_plateau(&tools).unwrap()["pause_required"], true);
    }

    #[test]
    fn recovery_compares_the_same_stage_and_explicit_resume_starts_fresh() {
        let mut tools = Vec::new();
        for (i, (stage, count)) in [
            ("schema", 1),
            ("layout", 20),
            ("layout", 19),
            ("layout", 19),
            ("layout", 19),
            ("layout", 19),
        ]
        .into_iter()
        .enumerate()
        {
            let mut t = attempt(&i.to_string(), "revision", false);
            t.receipt.as_mut().unwrap()["diagnostic_summary"] =
                json!({"count":count,"stage_sha256":stage,"reported_layer":"VALIDATION"});
            tools.push(t);
        }
        assert_eq!(
            command_plateau(&tools).unwrap()["failed_attempts_since_improvement"],
            4
        );
        let restored = context_for_segment(&tools, tools.len()).unwrap();
        assert!(restored.contains("\"command_recovery\":null"));
        assert!(restored.contains("FIRST_ATTEMPT")); // evidence retained
    }
    fn attempt(id: &str, revision: &str, success: bool) -> AgentToolCallView {
        serde_json::from_value(json!({"id":id,"run_id":"run","name":"run_command","effect":"PROCESS",
            "status":"COMPLETED","policy_decision":"ALLOW","arguments":{"program":"node","argv":["render.cjs"],"timeout_ms":1000},
            "receipt":{"success":success,"exit_code":if success {0} else {1},"stderr_sha256":if success {"empty"} else {"schema-error"},"workspace_revision":revision},"error_code":null,"created_at":1,"updated_at":2})).unwrap()
    }
    #[test]
    fn internal_errors_neither_endorse_the_cli_nor_reset_validation_progress() {
        let mut tools = Vec::new();
        for i in 0..8 {
            let mut t = attempt(&i.to_string(), "same", false);
            t.receipt.as_mut().unwrap()["diagnostic_summary"] = json!({"kind":"STRUCTURED_DIAGNOSTICS_V1","count":10-i,"stage_sha256":"render","reported_layer":"INTERNAL"});
            tools.push(t);
        }
        assert_eq!(command_plateau(&tools).unwrap()["pause_required"], true);
        let context = context(&tools).unwrap();
        assert!(context.contains("\"commands_reaching_structured_diagnostics\":[]"));
        tools[0].receipt.as_mut().unwrap()["diagnostic_summary"]["reported_layer"] =
            json!("VALIDATION");
        assert!(
            super::context(&tools)
                .unwrap()
                .contains("reported validation findings")
        );
    }
    #[test]
    fn fresh_skill_candidates_survive_without_a_previous_run_or_successful_probe() {
        let mut skill = attempt("skill", "v1", true);
        skill.name = "load_skill".into();
        skill.receipt = Some(
            json!({"kind":"SKILL_LOADED","runtime_candidates":[{"program":"node","versions_probed":false,"candidates":[{"program":"C:/installed/node.exe"}]}]}),
        );
        let context = context_for_segment(&[skill], 0).unwrap();
        assert!(context.contains("C:/installed/node.exe"));
        assert!(context.contains("\"versions_probed\":false"));
        assert!(!context.contains("ABSOLUTE_EXECUTABLE_VERSION_PROBE_SUCCEEDED"));
    }

    #[test]
    fn successful_absolute_probe_survives_later_failures_and_context_reduction() {
        let absolute = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut probe = attempt("probe", "v1", true);
        probe.arguments = json!({"program":absolute,"argv":["--version"]});
        let mut tools = vec![probe.clone()];
        assert!(
            context(&tools)
                .unwrap()
                .contains("ABSOLUTE_EXECUTABLE_VERSION_PROBE_SUCCEEDED")
        );
        for index in 0..40 {
            tools.push(attempt(&format!("failure-{index}"), "v1", false));
        }
        let probes = successful_runtime_probes(&tools);
        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0]["program"], absolute);
        assert!(
            context(&tools)
                .unwrap()
                .contains("successful_runtime_probes")
        );
        probe.receipt.as_mut().unwrap()["success"] = json!(false);
        assert!(successful_runtime_probes(&[probe.clone()]).is_empty());
        probe.receipt.as_mut().unwrap()["success"] = json!(true);
        probe.status = AgentToolStatus::Unknown;
        assert!(successful_runtime_probes(&[probe.clone()]).is_empty());
        probe.status = AgentToolStatus::Completed;
        probe.arguments["program"] = json!("node");
        assert!(successful_runtime_probes(&[probe]).is_empty());
    }

    #[test]
    fn repeated_failure_requires_real_change_and_compares_recovery() {
        let mut tools = vec![
            attempt("a", "v1", false),
            attempt("b", "v1", false),
            attempt("c", "v1", false),
        ];
        assert!(unchanged_failed_command(
            &tools,
            "run_command",
            &tools[0].arguments,
            Some("v1")
        ));
        let mut timeout_only = tools[0].arguments.clone();
        timeout_only["timeout_ms"] = json!(60000);
        assert!(unchanged_failed_command(
            &tools,
            "run_command",
            &timeout_only,
            Some("v1")
        ));
        assert!(!unchanged_failed_command(
            &tools,
            "run_command",
            &timeout_only,
            Some("v2")
        ));
        assert!(!unchanged_failed_command(
            &tools,
            "run_command",
            &timeout_only,
            None
        ));
        let alternate = json!({"program":"node","argv":["inspect-schema.cjs"]});
        assert!(!unchanged_failed_command(
            &tools,
            "run_command",
            &alternate,
            Some("v1")
        ));
        assert_eq!(
            projection(&tools)["attempts"][0]["comparison"],
            "SAME_FAILURE"
        );
        tools.push(attempt("d", "v2", true));
        assert_eq!(projection(&tools)["attempts"][0]["comparison"], "RECOVERED");
        assert!(!unchanged_failed_command(
            &tools,
            "run_command",
            &tools[0].arguments,
            Some("v2")
        ));
        tools.last_mut().unwrap().status = AgentToolStatus::Unknown;
        assert!(!unchanged_failed_command(
            &tools,
            "run_command",
            &tools[0].arguments,
            Some("v2")
        ));
    }
}
