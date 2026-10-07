//! Bounded work scope and observed source evidence in the existing tool ledger.
//! Model interpretations are proposals, never verification or permission.
use fielora_agent::{
    AgentError, CommandCancellation, ToolExecution, ToolExecutionSource, ToolExecutor, ToolRuntime,
    ToolSourceKind, ToolSpec,
};
use fielora_contracts::{AgentToolCallView, AgentToolEffect, AgentToolStatus, ModelToolDefinition};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashSet;

pub fn catalog() -> ToolSpec {
    ToolSpec {
        definition: ModelToolDefinition {
            name: "work_plan".into(),
            description: "Optionally retain a compact working plan for a multi-step task. write_paths are intended scope, not a write allowlist or user authorization. Keep the original user requirement above this revisable hypothesis; do not fill dependencies of features you added by mistake. evidence is optional: cite a successful read_file tool_call_id, optionally a short quote or line_start/line_end. Do not copy line-number decoration or invent image descriptions as source quotes. Invalid references are reported as issues without rejecting the plan. No need to refile a plan to edit another relevant file. A plan cannot verify a result; use actual checks and browser_plan for rendered acceptance.".into(),
            input_schema: json!({"type":"object","properties":{
                "write_paths":{"type":"array","minItems":1,"maxItems":16,"items":{"type":"string","maxLength":256}},
                "preserve":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","maxLength":300}},
                "criteria":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"object","properties":{"id":{"type":"string","maxLength":80},"expected":{"type":"string","maxLength":300},
                    "result":{"type":"object","description":"Optional per-case result. Keep stable IDs. A passed result needs a successful current eligible verification receipt and relevant source/test/fixture input_paths. Shell exit 0 or printed PASS is insufficient. Omit unchanged results to retain them; changed inputs become stale. This records evidence, not proof of coverage or task completion.","properties":{
                        "outcome":{"type":"string","enum":["pending","passed","failed"]},"actual":{"type":"string","maxLength":600},
                        "tool_call_id":{"type":"string","maxLength":128},"input_paths":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"string","maxLength":256}}
                    },"required":["outcome","actual"],"additionalProperties":false}
                },"required":["id","expected"],"additionalProperties":false}},
                "evidence":{"type":"array","maxItems":6,"items":{"type":"object","properties":{"tool_call_id":{"type":"string"},"quote":{"type":"string","minLength":8,"maxLength":1000},"line_start":{"type":"integer","minimum":1},"line_end":{"type":"integer","minimum":1},"interpretation":{"type":"string","maxLength":300}},"required":["tool_call_id","interpretation"],"additionalProperties":false}},
                "next_step":{"type":"object","properties":{"kind":{"type":"string","enum":["inspect","edit","verify"]},"action":{"type":"string","maxLength":300}},"required":["kind","action"],"additionalProperties":false},
                "reason":{"type":"string","maxLength":600}
            },"required":["write_paths","preserve","criteria","next_step"],"additionalProperties":false}),
        },
        effect: AgentToolEffect::Observe,
        source: ToolExecutionSource { capability_id: "work_plan".into(), capability_version: "0.1.0".into(), source_kind: ToolSourceKind::Builtin, provider_id: "fielora.builtin".into(), provider_tool_name: "work_plan".into(), protocol_version: None, transport: Some("HARNESS".into()) },
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    write_paths: Vec<String>,
    preserve: Vec<String>,
    criteria: Vec<Criterion>,
    #[serde(default)]
    evidence: Vec<Evidence>,
    next_step: NextStep,
    reason: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Criterion {
    id: String,
    expected: String,
    #[serde(default)]
    result: Option<CheckResult>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CheckResult {
    outcome: String,
    actual: String,
    tool_call_id: Option<String>,
    #[serde(default)]
    input_paths: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Evidence {
    tool_call_id: String,
    quote: Option<String>,
    line_start: Option<usize>,
    line_end: Option<usize>,
    interpretation: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NextStep {
    kind: String,
    action: String,
}

fn bounded(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.len() <= max
}
fn relative(s: &str) -> bool {
    bounded(s, 256)
        && !s.contains([':', '*', '?', '\0', '\\'])
        && !s.starts_with('/')
        && s.split('/').all(|p| !matches!(p, "" | "." | ".."))
}

/// read_file decorates each delivered line. Match source text, not display chrome.
fn source_text(observation: &str) -> String {
    observation
        .lines()
        .map(|line| {
            line.split_once(" | ")
                .filter(|(prefix, _)| prefix.trim().parse::<usize>().is_ok())
                .map_or(line, |(_, source)| source)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn source_quote_matches(source: &str, quote: &str) -> bool {
    let quote = source_text(quote);
    // Tolerate indentation/CRLF copied from a numbered read, but retain all tokens.
    let normalized = |text: &str| text.lines().map(str::trim).collect::<Vec<_>>().join("\n");
    normalized(source).contains(&normalized(&quote))
}

pub fn latest(tools: &[AgentToolCallView]) -> Option<&AgentToolCallView> {
    tools
        .iter()
        .rev()
        .find(|t| t.name == "work_plan" && t.status == AgentToolStatus::Completed)
}
pub fn projection(tools: &[AgentToolCallView]) -> Option<Value> {
    latest(tools)
        .and_then(|t| t.receipt.as_ref())
        .and_then(|r| r.get("plan"))
        .cloned()
}

#[cfg(test)]
pub fn execute(
    runtime: &ToolRuntime,
    arguments: &Value,
    tools: &[AgentToolCallView],
    cancellation: &CommandCancellation,
) -> Result<ToolExecution, AgentError> {
    execute_checked(runtime, arguments, tools, cancellation, None)
}

pub fn execute_checked(
    runtime: &ToolRuntime,
    arguments: &Value,
    tools: &[AgentToolCallView],
    cancellation: &CommandCancellation,
    current_revision: Option<&str>,
) -> Result<ToolExecution, AgentError> {
    let plan: Plan =
        serde_json::from_value(arguments.clone()).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    let mut ids = HashSet::new();
    if plan.write_paths.is_empty()
        || plan.write_paths.len() > 16
        || plan.write_paths.iter().any(|p| !relative(p))
        || plan.preserve.is_empty()
        || plan.preserve.len() > 8
        || plan.preserve.iter().any(|s| !bounded(s, 900))
        || plan.criteria.is_empty()
        || plan.criteria.len() > 8
        || plan
            .criteria
            .iter()
            .any(|c| !bounded(&c.id, 80) || !bounded(&c.expected, 900) || !ids.insert(c.id.clone()))
        || plan.evidence.len() > 6
        || !matches!(plan.next_step.kind.as_str(), "inspect" | "edit" | "verify")
        || !bounded(&plan.next_step.action, 900)
        || plan.reason.as_ref().is_some_and(|r| !bounded(r, 1800))
    {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let mut facts = Vec::new();
    let mut issues = Vec::new();
    for evidence in &plan.evidence {
        if evidence
            .quote
            .as_ref()
            .is_some_and(|q| q.len() < 8 || !bounded(q, 3000))
            || !bounded(&evidence.interpretation, 900)
        {
            return Err(AgentError::ToolArgumentsInvalid);
        }
        let issue = |code, path: &Value, detail: &str| {
            json!({
                "code":code,"tool_call_id":evidence.tool_call_id,"path":path,"detail":detail,
                "interpretation":evidence.interpretation,"interpretation_verified":false
            })
        };
        let Some(source) = tools.iter().find(|t| {
            t.id.0 == evidence.tool_call_id
                && t.name == "read_file"
                && t.status == AgentToolStatus::Completed
        }) else {
            issues.push(issue("AGENT_WORK_EVIDENCE_REQUIRED", &Value::Null,
                "No successful read_file has this id. This claim is not a source fact. Omit optional evidence or cite an actual receipt; do not repeat the entire plan."));
            continue;
        };
        let path = &source.arguments["path"];
        let current = match runtime.execute("read_file", &source.arguments, false, cancellation) {
            Ok(current) => current,
            Err(error) if error.is_cancelled() => return Err(error),
            Err(error) => {
                issues.push(issue(error.code(), path, "Source could not be refreshed. The plan is retained as intent; this source is not confirmed."));
                continue;
            }
        };
        let original = source.receipt.as_ref().unwrap_or(&Value::Null);
        let refreshed = current.receipt["sha256"] != original["sha256"];
        let raw = source_text(&current.observation);
        let quote = if let Some(quote) = &evidence.quote {
            if !source_quote_matches(&raw, quote) {
                issues.push(issue(if refreshed { "AGENT_WORK_EVIDENCE_STALE" } else { "AGENT_WORK_QUOTE_MISMATCH" }, path,
                    "Claim not found in the refreshed source range. It is excluded from confirmed facts. Use the existing read lines or inspect this path only if needed for the actual fix; do not retry the same quote or infer a missing feature."));
                continue;
            }
            source_text(quote)
        } else {
            let first = current.receipt["line_start"].as_u64().unwrap_or(1) as usize;
            let last = current.receipt["observed_line_end"].as_u64().unwrap_or(0) as usize;
            let observed_last = original["observed_line_end"].as_u64().unwrap_or(0) as usize;
            let start = evidence.line_start.unwrap_or(first);
            let end = evidence.line_end.unwrap_or(last.min(observed_last));
            if start < first || end < start || end > last || end > observed_last {
                issues.push(issue("AGENT_WORK_EVIDENCE_RANGE_INVALID", path,
                    "Choose a line range actually delivered by this read_file receipt. The plan remains usable without this optional source."));
                continue;
            }
            // Lines moved by an edit cannot be silently attributed to the old read.
            if refreshed {
                issues.push(issue("AGENT_WORK_EVIDENCE_STALE", path,
                    "Line-only evidence changed since the original read. This reference is historical, not confirmed current evidence. No plan rewrite is required."));
                continue;
            }
            raw.lines()
                .skip(start - first)
                .take(end - start + 1)
                .collect::<Vec<_>>()
                .join("\n")
                .chars()
                .take(3000)
                .collect()
        };
        facts.push(
            json!({"tool_call_id":source.id,"path":path,"sha256":current.receipt["sha256"],
            "original_sha256":original["sha256"],"refreshed":refreshed,"quote":quote,
            "interpretation":evidence.interpretation,"interpretation_verified":false}),
        );
    }
    let mut projected = arguments.clone();
    projected["source_facts"] = json!(facts);
    projected["interpretations_verified"] = json!(false);
    projected["advisory"] = json!(true);
    projected["evidence_issues"] = json!(issues);
    projected.as_object_mut().unwrap().remove("evidence");
    let previous = projection(tools);
    for (index, criterion) in plan.criteria.iter().enumerate() {
        let target = &mut projected["criteria"][index];
        if let Some(result) = &criterion.result {
            if !matches!(result.outcome.as_str(), "pending" | "passed" | "failed")
                || !bounded(&result.actual, 1800)
                || result.input_paths.len() > 8
                || result.input_paths.iter().any(|p| !relative(p))
            {
                return Err(AgentError::ToolArgumentsInvalid);
            }
            let evidence = result
                .tool_call_id
                .as_ref()
                .and_then(|id| tools.iter().find(|t| t.id.0 == *id));
            let receipt = evidence.and_then(|t| t.receipt.as_ref());
            let eligible = evidence.is_some_and(|t| t.status == AgentToolStatus::Completed)
                && evidence.is_some_and(|t| {
                    matches!(
                        t.name.as_str(),
                        "run_command" | "browser_verify" | "verify_skill"
                    )
                })
                && receipt.is_some_and(|r| {
                    r["verification_eligible"] == true
                        && r["success"] == true
                        && current_revision.is_some()
                        && r["workspace_revision"].as_str() == current_revision
                });
            let mut hashes = serde_json::Map::new();
            for path in &result.input_paths {
                hashes.insert(path.clone(), input_hash(runtime, path, cancellation));
            }
            let issue = if result.outcome == "passed" && !eligible {
                Some("CURRENT_VERIFICATION_RECEIPT_REQUIRED")
            } else if result.outcome == "passed"
                && (hashes.is_empty() || hashes.values().any(Value::is_null))
            {
                Some("CHECK_INPUT_VERSION_REQUIRED")
            } else {
                None
            };
            target["check"] = json!({"status":if issue.is_some(){"pending"}else{&result.outcome},
                "actual":fielora_model::sanitize_agent_text(&result.actual),"tool_call_id":result.tool_call_id,
                "input_hashes":hashes,"issue":issue,"coverage_verified":false});
            target.as_object_mut().unwrap().remove("result");
        } else if let Some(old) = previous
            .as_ref()
            .and_then(|p| p["criteria"].as_array())
            .and_then(|cs| {
                cs.iter()
                    .find(|c| c["id"] == criterion.id && c["expected"] == criterion.expected)
            })
            && let Some(check) = old.get("check")
        {
            target["check"] = check.clone();
        }
    }
    refresh_checks(runtime, &mut projected, cancellation);
    Ok(ToolExecution {
        receipt: json!({"kind":"WORK_PLAN","plan":projected,"verification_eligible":false}),
        observation: format!(
            "Working intent recorded; {} source issue(s). Issues: {}. Inspect each criterion's check/status/issue in the receipt. Pending CURRENT_VERIFICATION_RECEIPT_REQUIRED means run a direct supported test runner with failing assertions (e.g. python -m unittest); shell-wrapped print scripts do not establish acceptance. Mutating tests need an isolated database/fixture and must preserve original inputs. Keep passed unchanged cases; run only pending/failed/stale cases. This plan is advisory, not a write allowlist, user requirement or verification. Do not retry planning merely to clear optional citations. Compare carried changes to the original user request and images; remove mistaken additions instead of inventing their missing dependencies.",
            issues.len(),
            json!(issues)
        ),
    })
}

fn input_hash(runtime: &ToolRuntime, path: &str, cancel: &CommandCancellation) -> Value {
    runtime
        .execute("stat_path", &json!({"path":path}), false, cancel)
        .ok()
        .and_then(|t| t.receipt["sha256"].as_str().map(|s| json!(s)))
        .unwrap_or(Value::Null)
}

fn refresh_checks(runtime: &ToolRuntime, plan: &mut Value, cancel: &CommandCancellation) {
    if let Some(criteria) = plan["criteria"].as_array_mut() {
        for criterion in criteria {
            let Some(check) = criterion.get_mut("check") else {
                continue;
            };
            if check["status"] != "passed" {
                continue;
            }
            let current = check["input_hashes"].as_object().is_some_and(|hashes| {
                !hashes.is_empty()
                    && hashes.iter().all(|(path, hash)| {
                        !hash.is_null() && input_hash(runtime, path, cancel) == *hash
                    })
            });
            if !current {
                check["status"] = json!("stale");
                check["issue"] = json!("INPUT_CHANGED_OR_UNAVAILABLE");
            }
        }
    }
}

/// Refresh only declared bounded dependencies; log changes outside these inputs
/// cannot erase other cases. Existing final verification remains authoritative.
pub fn current_projection(
    tools: &[AgentToolCallView],
    root: &std::path::Path,
    artifacts: &std::path::Path,
) -> Option<Value> {
    let mut plan = projection(tools)?;
    if let Ok(runtime) = ToolRuntime::new(root, artifacts) {
        refresh_checks(&runtime, &mut plan, &CommandCancellation::default());
    } else if let Some(criteria) = plan["criteria"].as_array_mut() {
        for c in criteria {
            if c["check"]["status"] == "passed" {
                c["check"]["status"] = json!("stale");
            }
        }
    }
    Some(plan)
}

/// Only called by the coordinator's explicit deterministic E2E model gate.
pub fn acceptance_fixture(
    request: &fielora_model::AgentModelRequest,
    tools: &[AgentToolCallView],
    resumed: bool,
) -> Result<fielora_model::AgentModelTurn, fielora_model::ModelError> {
    use fielora_model::{AgentModelMessage, AgentModelToolCall, AgentModelTurn, ModelError};
    let call = |name: &str, args: Value| {
        Ok(AgentModelTurn {
            continuation: None,
            text: String::new(),
            usage: None,
            tool_calls: vec![AgentModelToolCall {
                id: format!("cases-{}", tools.len()),
                name: name.into(),
                arguments: args,
            }],
        })
    };
    let plan = |check: usize, keep_input: bool| {
        let mut input = json!({"id":"input","expected":"Isolated import is idempotent and original CSV unchanged"});
        if !keep_input {
            input["result"] = json!({"outcome":"passed","actual":"Isolated SQLite assertions passed","tool_call_id":tools[check].id,
            "input_paths":["input.csv","test_acceptance.py"]});
        }
        json!({"write_paths":["source.txt"],"preserve":["Original input and real database"],"criteria":[
            {"id":"source","expected":"Current source is accepted by the targeted test","result":{"outcome":"passed","actual":"Source assertion passed","tool_call_id":tools[check].id,"input_paths":["source.txt","test_acceptance.py"]}},input],
            "next_step":{"kind":"verify","action":"Only test stale or pending cases"}})
    };
    match tools.len() {
        0 => call(
            "read_file",
            json!({"path":"contract-a.txt","line_end":600,"max_bytes":65536}),
        ),
        1 => call("read_file", json!({"path":"source.txt"})),
        2 => call(
            "run_command",
            json!({"program":"/usr/bin/python3","argv":["print_check.py"],"timeout_ms":5000}),
        ),
        3 => call("work_plan", plan(2, false)),
        4 => {
            if tools[3].receipt.as_ref().unwrap()["plan"]["criteria"][0]["check"]["status"]
                != "pending"
            {
                return Err(ModelError::ProviderProtocolError);
            }
            call(
                "run_command",
                json!({"program":"/usr/bin/python3","argv":["-B","-m","unittest","test_acceptance"],"timeout_ms":5000}),
            )
        }
        5 => call("work_plan", plan(4, false)),
        6 => {
            if tools[5].receipt.as_ref().unwrap()["plan"]["criteria"][0]["check"]["status"]
                != "passed"
            {
                return Err(ModelError::ProviderProtocolError);
            }
            call(
                "write_file",
                json!({"path":"source.txt","content":"two\n","expected_sha256":tools[1].receipt.as_ref().unwrap()["sha256"]}),
            )
        }
        7 if !resumed => Err(ModelError::ProviderUnavailable),
        7 => {
            let context = request
                .messages
                .iter()
                .find_map(|m| match m {
                    AgentModelMessage::User(s) if s.starts_with(CONTEXT_MARKER) => Some(s),
                    _ => None,
                })
                .ok_or(ModelError::ProviderProtocolError)?;
            if !context.contains("\"status\":\"stale\"")
                || !context.contains("\"status\":\"passed\"")
            {
                return Err(ModelError::ProviderProtocolError);
            }
            call(
                "run_command",
                json!({"program":"/usr/bin/python3","argv":["-B","-m","unittest","test_acceptance.Cases.test_source"],"timeout_ms":5000}),
            )
        }
        8 => call("work_plan", plan(7, true)),
        _ => call(
            "finish_task",
            json!({"outcome":"completed","intent":"action","request_quote":"执行隔离验证，保留原始输入。","summary":"隔离验收记录已恢复；只重验受影响的文件。","evidence_tool_call_ids":[tools[7].id]}),
        ),
    }
}

pub fn guard(
    runtime: &ToolRuntime,
    name: &str,
    arguments: &Value,
    tools: &[AgentToolCallView],
    ui_task: bool,
) -> Result<(), AgentError> {
    if !matches!(
        name,
        "replace_text" | "apply_patches" | "write_file" | "create_file" | "delete_file"
    ) {
        return Ok(());
    }
    let plan = latest(tools);
    let covered = plan
        .and_then(|p| p.arguments["write_paths"].as_array())
        .map(|paths| {
            paths
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    // The model's plan is not a permission boundary or an edit prerequisite.
    // Real write hashes and ordinary tool policy still run in the executor.
    let ui_path = |value: &Value| {
        value.as_str().is_some_and(|path| {
            let path = path.to_lowercase();
            path.contains("popup")
                || [".html", ".tsx", ".vue", ".svelte", ".css", ".scss"]
                    .iter()
                    .any(|ext| path.ends_with(ext))
        })
    };
    if ui_task
        || plan.is_some()
        || ui_path(&arguments["path"])
        || arguments["patches"]
            .as_array()
            .is_some_and(|patches| patches.iter().any(|patch| ui_path(&patch["path"])))
    {
        runtime.translation_impact(name, arguments, &covered)?;
    }
    Ok(())
}

pub const CONTEXT_MARKER: &str = "FIELORA_CURRENT_WORK_PLAN\n";

pub const RESUME_MARKER: &str = "FIELORA_RESUME_RECONCILIATION\n";

pub fn continuation_context(task: &str) -> String {
    format!(
        "{RESUME_MARKER}Resume the SAME user task: {task}\nReconcile before extending: compare the carried edits and plan with the original user request/reference images. Previously generated criteria and code additions are unverified hypotheses, not new user requirements. A prior 'continued' action does not endorse them. If a newly added field causes a missing-data dependency, first check whether the user requested that field; remove mistaken additions instead of filling invented dependencies. For an implementation request, inspect current changes and perform the narrow relevant acceptance check before broad discovery. For an explanation or review question, answer that question using relevant evidence; do not turn historical changes into renewed implementation or testing obligations. Preserve the recorded current-request interpretation unless the actual user wording warrants correcting it. Preserve user work and existing APIs. Old WORK_PLAN_REQUIRED, WORK_SCOPE_MISMATCH and evidence errors are historical; work_plan is now optional/advisory, so do not replay those planning loops. No extra approval or full plan rewrite is needed for an already-authorized relevant fix. Only actual current-result checks can support completion."
    )
}

/// Adversarial model substitute; called only under the existing E2E fixture gate.
pub fn fixture_call(step: u32, tools: &[AgentToolCallView]) -> Option<(&'static str, Value)> {
    let read = |path: &str| {
        tools
            .iter()
            .find(|t| t.name == "read_file" && t.arguments["path"] == path)
            .unwrap()
    };
    let edit = |path: &str, old: &str, new: &str| json!({"path":path,"expected_sha256":read(path).receipt.as_ref().unwrap()["sha256"],"replacements":[{"old_text":old,"new_text":new}]});
    let plan = || json!({"write_paths":["popup.html","i18n/cn.json"],"preserve":["Keep the existing action 135 bank loader and all API implementations"],"criteria":[{"id":"labels","expected":"Correct the three receipt labels; preserve the existing bank options and unrelated search label"}],"evidence":[{"tool_call_id":read("popup.html").id,"quote":"request({action:135})","interpretation":"The popup already owns bank loading; no new API needed"}],"next_step":{"kind":"edit","action":"Fix the local labels, then check the rendered popup"}});
    match step {
        1 => Some(("read_file", json!({"path":"popup.html"}))),
        2 => Some(("read_file", json!({"path":"i18n/cn.json"}))),
        3 => Some((
            "create_file",
            json!({"path":"scratch.txt","content":"local note"}),
        )),
        4 => Some(("work_plan", plan())),
        5 => Some((
            "replace_text",
            edit("i18n/cn.json", "搜索", "到账后剩余金额"),
        )),
        6 => Some((
            "git_read",
            json!({"operation":"diff","args":["--no-pager","diff","--stat"]}),
        )),
        7 => Some((
            "search_text",
            json!({"query":"bankAccount|开户行|BankAccount"}),
        )),
        8 => Some((
            "search_text",
            json!({"queries":["bankAccount","开户行","BankAccount"]}),
        )),
        9 => Some((
            "create_file",
            json!({"path":"another-note.txt","content":"scoped plans are advisory"}),
        )),
        10 => {
            let mut args = plan();
            args["evidence"][0]["quote"] = json!("there is no bank loader");
            Some(("work_plan", args))
        }
        11 => {
            let mut args = plan();
            args["write_paths"] = json!(["popup.html"]);
            args["reason"] = json!("Keep the shared key and API unchanged; correct local labels");
            Some(("work_plan", args))
        }
        12 => Some((
            "read_file",
            json!({"path":"popup.html","line_start":1,"line_end":1}),
        )),
        _ => None,
    }
}

#[cfg(test)]
pub fn context(tools: &[AgentToolCallView], wrote: bool, verified: bool) -> Option<String> {
    let plan = projection(tools)?;
    Some(context_from_plan(&plan, wrote, verified))
}

pub fn current_context(
    tools: &[AgentToolCallView],
    root: &std::path::Path,
    artifacts: &std::path::Path,
    wrote: bool,
    verified: bool,
) -> Option<String> {
    Some(context_from_plan(
        &current_projection(tools, root, artifacts)?,
        wrote,
        verified,
    ))
}

fn context_from_plan(plan: &Value, wrote: bool, verified: bool) -> String {
    let outstanding = plan["criteria"].as_array().is_some_and(|criteria| {
        criteria.iter().any(|criterion| {
            criterion
                .get("check")
                .is_some_and(|check| check["status"] != "passed")
        })
    });
    format!(
        "{CONTEXT_MARKER}{plan}\nThis retained plan is an ADVISORY MODEL HYPOTHESIS, including plans from older versions. It is not a write allowlist or user requirement. Source quotes describe code; interpretations remain tentative. The original user request and images take precedence. Do not complete dependencies of a mistakenly added field just because the current template or previous plan contains it. Reconcile current changes with the originally reported differences, then verify. No mandatory work_plan update is needed to change a relevant file. Preserve existing APIs unless the user requested otherwise. Current workspace changed={wrote}; current result verified={verified}. {}",
        if outstanding {
            "Acceptance is outstanding. Some retained cases are pending, failed or stale even if another check passed. Resolve those cases; retain unchanged passing cases. Do not claim all criteria passed."
        } else if wrote && !verified {
            "Acceptance is outstanding. Prepare or run the relevant check now; inspect only concrete prerequisites or a failed check's cause. More searches and Git diffs are not verification."
        } else if verified {
            "Current checks passed. Close out the scoped result; do not expand into adjacent features."
        } else {
            "Resolve the stated differences using the observed owners and smallest edit. Empty or malformed searches do not prove absence."
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn acceptance_cases_require_real_checks_and_survive_only_matching_inputs() {
        let root = std::env::temp_dir().join(format!("fielora-cases-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("app.py"), "original").unwrap();
        fs::write(root.join("test_app.py"), "assert actual == expected").unwrap();
        let runtime = ToolRuntime::new(&root, &root.join("artifacts")).unwrap();
        let cancel = CommandCancellation::default();
        let args = json!({"write_paths":["app.py"],"preserve":["input CSV and live database"],
            "criteria":[{"id":"import","expected":"Repeated import is idempotent","result":{
                "outcome":"passed","actual":"No duplicate IDs","tool_call_id":"check",
                "input_paths":["app.py","test_app.py"]}}],"next_step":{"kind":"verify","action":"Check pending restore case"}});
        let mut tools = vec![record(
            "check",
            "run_command",
            json!({"program":"python3","argv":["final_check.py"]}),
            json!({"success":true,"exit_code":0,"verification_eligible":false,"workspace_revision":"rev"}),
        )];
        let rejected = execute_checked(&runtime, &args, &tools, &cancel, Some("rev")).unwrap();
        assert_eq!(
            rejected.receipt["plan"]["criteria"][0]["check"]["status"],
            "pending"
        );
        assert_eq!(
            rejected.receipt["plan"]["criteria"][0]["check"]["issue"],
            "CURRENT_VERIFICATION_RECEIPT_REQUIRED"
        );
        tools[0].receipt.as_mut().unwrap()["verification_eligible"] = json!(true);
        let stale = execute_checked(&runtime, &args, &tools, &cancel, Some("new-rev")).unwrap();
        assert_eq!(
            stale.receipt["plan"]["criteria"][0]["check"]["status"],
            "pending"
        );
        let checked = execute_checked(&runtime, &args, &tools, &cancel, Some("rev")).unwrap();
        assert_eq!(checked.receipt["verification_eligible"], false);
        assert_eq!(
            checked.receipt["plan"]["criteria"][0]["check"]["status"],
            "passed"
        );
        tools.push(record("plan", "work_plan", args.clone(), checked.receipt));
        fs::write(root.join("server.log"), "unrelated startup log").unwrap();
        assert_eq!(
            current_projection(&tools, &root, &root.join("artifacts")).unwrap()["criteria"][0]["check"]
                ["status"],
            "passed"
        );
        let mut next = args.clone();
        next["criteria"][0]
            .as_object_mut()
            .unwrap()
            .remove("result");
        assert_eq!(
            execute_checked(&runtime, &next, &tools, &cancel, Some("rev"))
                .unwrap()
                .receipt["plan"]["criteria"][0]["check"]["status"],
            "passed"
        );
        fs::write(root.join("app.py"), "changed through another process").unwrap();
        assert_eq!(
            current_projection(&tools, &root, &root.join("artifacts")).unwrap()["criteria"][0]["check"]
                ["status"],
            "stale"
        );
        assert_eq!(
            execute_checked(&runtime, &next, &tools, &cancel, Some("rev"))
                .unwrap()
                .receipt["plan"]["criteria"][0]["check"]["status"],
            "stale"
        );
        next["criteria"][0]["expected"] = json!("A different requirement");
        assert!(
            execute_checked(&runtime, &next, &tools, &cancel, Some("rev"))
                .unwrap()
                .receipt["plan"]["criteria"][0]
                .get("check")
                .is_none()
        );
        fs::remove_dir_all(root).unwrap();
    }

    fn record(id: &str, name: &str, arguments: Value, receipt: Value) -> AgentToolCallView {
        serde_json::from_value(json!({"id":id,"run_id":"run","name":name,"effect":"OBSERVE","status":"COMPLETED","policy_decision":"ALLOW","arguments":arguments,"receipt":receipt,"error_code":null,"created_at":0,"updated_at":0})).unwrap()
    }

    #[test]
    fn numbered_multiline_reads_and_self_edits_do_not_create_a_plan_retry_loop() {
        let root =
            std::env::temp_dir().join(format!("fielora-plan-lines-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let original = "<section>\r\n    <label>已到账金额</label>\r\n    <span>{{paid}}</span>\r\n</section>\r\n";
        fs::write(root.join("popup.html"), original).unwrap();
        let runtime = ToolRuntime::new(&root, &root.join("artifacts")).unwrap();
        let cancel = CommandCancellation::default();
        let read_args = json!({"path":"popup.html","line_start":2,"line_end":4});
        let read = runtime
            .execute("read_file", &read_args, false, &cancel)
            .unwrap();
        let tools = vec![record("source", "read_file", read_args, read.receipt)];
        let mut args = json!({"write_paths":["popup.html"],"preserve":["Existing API"],"criteria":[{"id":"labels","expected":"Match reference labels"}],"next_step":{"kind":"verify","action":"Check current popup"},"evidence":[{"tool_call_id":"source","quote":"<label>已到账金额</label>\n<span>{{paid}}</span>","interpretation":"These are two source elements, not proof of rendered labels"}]});
        let plan = execute(&runtime, &args, &tools, &cancel).unwrap();
        assert_eq!(plan.receipt["plan"]["evidence_issues"], json!([]));
        assert_eq!(
            plan.receipt["plan"]["source_facts"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        // Line selection removes the need to manually reproduce a source quote.
        args["evidence"][0].as_object_mut().unwrap().remove("quote");
        args["evidence"][0]["line_start"] = json!(2);
        args["evidence"][0]["line_end"] = json!(3);
        let selected = execute(&runtime, &args, &tools, &cancel).unwrap();
        assert!(
            selected.receipt["plan"]["source_facts"][0]["quote"]
                .as_str()
                .unwrap()
                .contains("{{paid}}")
        );
        args["evidence"][0]["line_start"] = json!(1);
        assert_eq!(
            execute(&runtime, &args, &tools, &cancel).unwrap().receipt["plan"]["evidence_issues"]
                [0]["code"],
            "AGENT_WORK_EVIDENCE_RANGE_INVALID"
        );
        args["evidence"][0]["line_start"] = json!(2);
        // Changed line references are historical, not silently rebound to unrelated text.
        fs::write(
            root.join("popup.html"),
            original.replace("已到账金额", "客户抬头"),
        )
        .unwrap();
        let stale = execute(&runtime, &args, &tools, &cancel).unwrap();
        assert_eq!(stale.receipt["plan"]["source_facts"], json!([]));
        assert_eq!(
            stale.receipt["plan"]["evidence_issues"][0]["code"],
            "AGENT_WORK_EVIDENCE_STALE"
        );
        args["evidence"][0]["quote"] = json!("<label>已到账金额</label>");
        let missing = execute(&runtime, &args, &tools, &cancel).unwrap();
        assert_eq!(missing.receipt["plan"]["source_facts"], json!([]));
        assert_eq!(missing.receipt["verification_eligible"], false);
        args.as_object_mut().unwrap().remove("evidence");
        assert!(execute(&runtime, &args, &tools, &cancel).is_ok());
        let recovery = continuation_context("只修改截图中到账确认的错误字段，不改接口");
        assert!(recovery.starts_with(RESUME_MARKER));
        assert!(recovery.contains("只修改截图中到账确认的错误字段，不改接口"));
        assert!(recovery.contains("remove mistaken additions"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn source_evidence_scope_amendment_and_context_have_distinct_authority() {
        let root = std::env::temp_dir().join(format!("fielora-work-plan-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let artifacts = root.join("artifacts");
        fs::write(
            root.join("popup.js"),
            "function loadBanks() { return request({action:135}); }\n",
        )
        .unwrap();
        let runtime = ToolRuntime::new(&root, &artifacts).unwrap();
        let cancel = CommandCancellation::default();
        let read_args = json!({"path":"popup.js"});
        let read = runtime
            .execute("read_file", &read_args, false, &cancel)
            .unwrap();
        let mut tools = vec![record(
            "read-1",
            "read_file",
            read_args.clone(),
            read.receipt,
        )];
        let args = json!({"write_paths":["popup.js"],"preserve":["Existing bank request action 135"],"criteria":[{"id":"labels","expected":"Show receipt labels from reference"}],"evidence":[{"tool_call_id":"read-1","quote":"request({action:135})","interpretation":"The popup already loads bank options"}],"next_step":{"kind":"edit","action":"Correct local labels"}});
        let write = json!({"path":"popup.js"});
        guard(&runtime, "replace_text", &write, &tools, true).unwrap();
        let mut invalid = args.clone();
        invalid["evidence"][0]["quote"] = json!("invented missing API");
        let issue = execute(&runtime, &invalid, &tools, &cancel).unwrap();
        assert_eq!(
            issue.receipt["plan"]["evidence_issues"][0]["code"],
            "AGENT_WORK_QUOTE_MISMATCH"
        );
        assert_eq!(issue.receipt["plan"]["source_facts"], json!([]));
        invalid["evidence"][0]["tool_call_id"] = json!("invented");
        let issue = execute(&runtime, &invalid, &tools, &cancel).unwrap();
        assert_eq!(
            issue.receipt["plan"]["evidence_issues"][0]["code"],
            "AGENT_WORK_EVIDENCE_REQUIRED"
        );
        assert_eq!(issue.receipt["verification_eligible"], false);
        let plan = execute(&runtime, &args, &tools, &cancel).unwrap();
        assert_eq!(plan.receipt["verification_eligible"], false);
        tools.push(record("plan-1", "work_plan", args.clone(), plan.receipt));
        guard(&runtime, "replace_text", &write, &tools, true).unwrap();
        guard(
            &runtime,
            "replace_text",
            &json!({"path":"api.js"}),
            &tools,
            true,
        )
        .unwrap();
        let mut amended = args.clone();
        amended["write_paths"] = json!(["popup.js", "api.js"]);
        amended["reason"] = json!("New dependency discovered");
        execute(&runtime, &amended, &tools, &cancel).unwrap();
        fs::write(
            root.join("popup.js"),
            "function loadBanks() { return request({action:135}); } // newer\n",
        )
        .unwrap();
        let refreshed = execute(&runtime, &args, &tools, &cancel).unwrap();
        assert_eq!(
            refreshed.receipt["plan"]["source_facts"][0]["refreshed"],
            true
        );
        assert_eq!(refreshed.receipt["plan"]["evidence_issues"], json!([]));
        let stale_write = json!({"path":"popup.js","expected_sha256":tools[0].receipt.as_ref().unwrap()["sha256"],"old_text":"action:135","new_text":"action:999"});
        assert!(
            runtime
                .execute("replace_text", &stale_write, false, &cancel)
                .is_err(),
            "Advisory plan refresh must not bypass a stale write hash"
        );
        let read = runtime
            .execute("read_file", &read_args, false, &cancel)
            .unwrap();
        tools.push(record("read-2", "read_file", read_args, read.receipt));
        amended["evidence"][0]["tool_call_id"] = json!("read-2");
        execute(&runtime, &amended, &tools, &cancel).unwrap();
        // Old source facts are pinned separately from the bounded recent tail.
        for n in 0..20 {
            tools.push(record(
                &format!("later-{n}"),
                "read_file",
                json!({}),
                json!({}),
            ));
        }
        let checkpoint = crate::agent_work_state::WorkProgress::restored(&tools)
            .checkpoint(&tools, 24, true, false);
        assert!(checkpoint["work_plan"].to_string().contains("action:135"));
        assert_eq!(checkpoint["work_plan"]["interpretations_verified"], false);
        let retained = context(&tools, true, false).unwrap();
        assert!(retained.contains("Acceptance is outstanding"));
        assert!(retained.contains("interpretations remain tentative"));
        fs::remove_dir_all(root).unwrap();
    }
}
