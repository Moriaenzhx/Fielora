//! Model-facing views over the existing Harness, never another executor.
use fielora_contracts::{AgentToolCallView, AgentToolStatus, ModelToolDefinition};
use fielora_model::{AgentModelMessage, AgentModelRequest, AgentModelToolCall};
use serde_json::{Value, json};
use std::collections::HashSet;

const CORE_TOOLS: &[&str] = &[
    "list_files",
    "read_file",
    "search_text",
    "stat_path",
    "git_read",
    "create_file",
    "write_file",
    "replace_text",
    "run_command",
    "capability_status",
    "web.search",
    "web.fetch",
    "environment.inspect",
    "list_skills",
    "load_skill",
    "work_plan",
    "request_user_input",
    "finish_task",
    "record_request_intent",
];

pub(crate) const GUIDANCE: &str = "Ordinary work follows action -> tool result -> next action. A failed check or resumed task does not require a separate review. Use the latest concrete result to repair or verify; reviews are optional hypotheses, not independent validation. Common coding and available web research tools are initially exposed. To use another capability, call capability_status with its exact tool_name or a relevant filter. Available tools returned on a filtered page are exposed next turn, within the bounded extension set; definitions always come from the current catalog. Page through remaining candidates only if needed. A catalog result is not an execution or a reachability check. Discovery never grants permission. replace_text/write_file and each apply_patches patch can omit expected_sha256 after a successful observation of that file in this Run; the Harness binds the observed version and still rejects concurrent changes. Do not calculate or copy hashes merely to edit. An explicitly supplied guard remains authoritative and is never repaired automatically.";
pub(crate) const ERROR_MARKER: &str = "[Current tool recovery]\n";

pub(crate) fn research_guidance(now_ms: i64) -> String {
    // Gregorian civil date from UTC days. No locale or subprocess dependency.
    let z = now_ms.div_euclid(86_400_000) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!(
        "\nCurrent host date (UTC): {year:04}-{month:02}-{day:02}. For current information and research, use admitted web.search to discover sources, then web.fetch to read important public pages without opening a browser. Search supports domain and publication-date filters; retrieval time is not publication time. Compare original sources, refine queries to resolve gaps, and cite observed URLs. A zero-result search calls for a different query; a service failure or rate limit is not evidence of no information. Do not repeat unchanged failed searches. Explain service limits and, when relevant, direct the user to Settings > Capabilities & extensions > Web search; never request API keys in chat. web.fetch does not search or render JavaScript. For dynamic pages use browser open/inspect with view=text. Use view=interactive only when controls are needed. A missing search API does not prevent authorized browser research, but never label direct page access as a search. Support each factual claim with an actually observed source; do not fill missing current policies from memory. Record retrieval dates from the current clock or source receipt, never invent them. Keep each source's URL, relevant findings and unresolved questions as work proceeds; navigation success is not research completion. For substantial code, build and verify coherent modules incrementally rather than emitting the entire application in one tool argument. Test actual implementation behavior: finding function names or localStorage keywords in source does not verify execution. For browser deliverables exercise real controls and reload persisted state before claiming those interactions passed."
    )
}

/// Definitions always come from the current catalog, never from old receipts.
/// Exact discovery and bounded filtered pages expose current definitions;
/// executing a candidate is a separate policy decision. Reconstructing this view
/// from receipts also covers restart.
pub(crate) fn select_tools(
    definitions: Vec<ModelToolDefinition>,
    facts: &[AgentToolCallView],
) -> Vec<ModelToolDefinition> {
    let mut exposed: HashSet<&str> = CORE_TOOLS.iter().copied().collect();
    // Bound the active extension set, leaving discovery itself always available.
    let mut extensions = 0;
    'facts: for fact in facts.iter().rev() {
        if fact.status != AgentToolStatus::Completed {
            continue;
        }
        let receipt = fact.receipt.as_ref().unwrap_or(&Value::Null);
        let names: Vec<&str> = if fact.name == "capability_status" {
            let exact = fact.arguments["tool_name"].as_str().filter(|name| {
                receipt["tool_detail"]["definition"]["name"].as_str() == Some(*name)
                    && receipt["tool_detail"]["facts"]["available"] == true
            });
            if let Some(name) = exact {
                vec![name]
            } else if fact.arguments["filter"].as_object().is_some_and(|f| {
                f.values()
                    .any(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
            }) && receipt["kind"] == "CAPABILITY_STATUS"
            {
                // Inventory summaries and pages not actually returned do not
                // expand the prompt. Receipts contain identities, not schemas.
                receipt["tool_catalog"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|item| {
                        item["available"] == true
                            && item["admission"] == "ADMITTED_TO_CURRENT_CATALOG"
                    })
                    .filter_map(|item| item["name"].as_str())
                    .take(12)
                    .collect()
            } else {
                vec![]
            }
        } else {
            // Keep already-used capabilities available on legacy Run resumes.
            vec![fact.name.as_str()]
        };
        for name in names {
            if !exposed.contains(name) && definitions.iter().any(|d| d.name == name) {
                exposed.insert(name);
                extensions += 1;
                if extensions == 12 {
                    break 'facts;
                }
            }
        }
    }
    definitions.into_iter().filter(|d| exposed.contains(d.name.as_str()))
        .map(|mut d| {
            let schema = match d.name.as_str() {
                "replace_text" | "write_file" => Some(&mut d.input_schema),
                "apply_patches" => Some(&mut d.input_schema["properties"]["patches"]["items"]),
                _ => None,
            };
            if let Some(schema) = schema {
                if let Some(required) = schema["required"].as_array_mut() {
                    required.retain(|field| field != "expected_sha256");
                }
                if d.name == "apply_patches" {
                    d.description = "Apply exact replacements or 1-based inclusive line edits across multiple files as one reviewed operation. patches must be a JSON array of objects, each with path and exactly one of replacements or line_edits. Bind a separate observed version for each file.".into();
                }
                d.description.push_str(" expected_sha256 is optional after observing this file in the current Run: Harness binds that observed version, never a fresh disk version. Explicit guards are checked unchanged.");
            }
            d
        }).collect()
}

/// Bind before proposal persistence, using only trusted builtin receipts. The
/// executor still performs its normal atomic hash check at execution time.
pub(crate) fn bind_observed_edit(call: &mut AgentModelToolCall, facts: &[AgentToolCallView]) {
    if !call.arguments.is_object() {
        return;
    }
    match call.name.as_str() {
        "replace_text" | "write_file" => bind_observed_path(&mut call.arguments, facts),
        "apply_patches" => {
            // Preserve root guard compatibility and its existing normalization
            // event. Never distribute an explicit root guard to multiple files.
            if call.arguments.get("expected_sha256").is_some() {
                return;
            }
            if let Some(patches) = call.arguments["patches"].as_array_mut() {
                for patch in patches {
                    bind_observed_path(patch, facts);
                }
            }
        }
        _ => {}
    }
}

fn bind_observed_path(arguments: &mut Value, facts: &[AgentToolCallView]) {
    if !arguments.is_object() || arguments.get("expected_sha256").is_some() {
        return;
    }
    let Some(path) = arguments["path"].as_str() else {
        return;
    };
    let path = path.strip_prefix("./").unwrap_or(path);
    let mut version = None;
    for fact in facts {
        if fact.status != AgentToolStatus::Completed {
            continue;
        }
        let r = fact.receipt.as_ref().unwrap_or(&Value::Null);
        let entries: Vec<&Value> = match (fact.name.as_str(), r["kind"].as_str()) {
            ("read_file", Some("FILE_READ" | "JSON_READ"))
            | ("write_file" | "replace_text" | "create_file" | "restore_file", Some(_)) => vec![r],
            ("apply_patches", Some(_)) => r["patches"]
                .as_array()
                .map(|a| a.iter().collect())
                .unwrap_or_default(),
            _ => vec![],
        };
        for entry in entries {
            if entry["path"]
                .as_str()
                .map(|p| p.strip_prefix("./").unwrap_or(p))
                == Some(path)
            {
                version = entry["after_sha256"]
                    .as_str()
                    .or_else(|| entry["sha256"].as_str());
            }
        }
        if matches!(fact.name.as_str(), "delete_file" | "move_file")
            && (r["path"].as_str() == Some(path) || r["from"].as_str() == Some(path))
        {
            version = None;
        }
    }
    if let Some(hash) =
        version.filter(|h| h.len() == 64 && h.bytes().all(|c| c.is_ascii_hexdigit()))
    {
        arguments["expected_sha256"] = json!(hash);
    }
}

// Local operational envelope, NOT a vendor context-window claim. Until the
// catalog supplies authoritative capacities, expose the estimate honestly.
const LOCAL_WINDOW_ESTIMATE: usize = 64 * 1024;
const PROTOCOL_RESERVE: usize = 2048;

fn message_cost(message: &AgentModelMessage) -> usize {
    crate::agent_work_state::message_bytes(message)
        + 128
        + match message {
            AgentModelMessage::UserMultimodal { images, .. } => images.len() * 4096,
            _ => 0,
        }
}

pub(crate) fn request_cost(request: &AgentModelRequest) -> usize {
    request.system.len()
        + serde_json::to_vec(&request.tools).map_or(0, |v| v.len())
        + request.messages.iter().map(message_cost).sum::<usize>()
}

pub(crate) fn compile_context(request: &mut AgentModelRequest, checkpoint: Value) -> Value {
    let source_sizes = |messages: &[AgentModelMessage]| {
        let sources = crate::agent_work_state::source_observations(messages, usize::MAX);
        (
            sources.len(),
            sources.iter().map(|s| s.to_string().len()).sum::<usize>(),
        )
    };
    let (observed_ranges, observed_bytes) = source_sizes(&request.messages);
    let before = request_cost(request);
    let input_limit = LOCAL_WINDOW_ESTIMATE
        .saturating_sub(request.max_output_tokens as usize)
        .saturating_sub(PROTOCOL_RESERVE)
        * 3;
    let fixed = request.system.len() + serde_json::to_vec(&request.tools).map_or(0, |v| v.len());
    // Target below the hard envelope to avoid recompressing after every read.
    let message_target = (input_limit * 3 / 4).saturating_sub(fixed);
    let message_limit = input_limit.saturating_sub(fixed);
    let message_overhead = request
        .messages
        .iter()
        .map(|message| message_cost(message) - crate::agent_work_state::message_bytes(message))
        .sum::<usize>();
    let threshold = message_limit.saturating_sub(message_overhead);
    let reduced = if before > input_limit || request.messages.len() > 112 {
        crate::agent_work_state::compact_transcript_budgeted(
            &mut request.messages,
            checkpoint,
            threshold,
            message_target,
            |_| {},
        )
    } else {
        None
    };
    crate::agent_work_state::refresh_command_output_projection(&mut request.messages);
    let after = request_cost(request);
    let (retained_ranges, retained_bytes) = source_sizes(&request.messages);
    json!({"kind":"CODING_CONTEXT_BUDGET_V1", "basis":"LOCAL_ESTIMATE_NOT_PROVIDER_CAPACITY",
        "bytes_per_estimated_token":3,"output_reserve_tokens":request.max_output_tokens,
        "protocol_reserve_tokens":PROTOCOL_RESERVE,"input_limit_bytes":input_limit,
        "fixed_bytes":fixed,"before_bytes":before,"after_bytes":after,
        "observed_source_ranges":observed_ranges,"observed_source_bytes":observed_bytes,
        "retained_source_ranges":retained_ranges,"retained_source_bytes":retained_bytes,
        "reduced":reduced.is_some(),"fits":after <= input_limit})
}

/// Deterministic model substitute, callable only behind the coordinator's
/// existing E2E + exact model gate. Actual files, checks and policy are real.
pub(crate) fn fixture(
    request: &AgentModelRequest,
    facts: &[AgentToolCallView],
) -> Result<fielora_model::AgentModelTurn, fielora_model::ModelError> {
    use fielora_model::{AgentModelTurn, ModelError};
    let call = |name: &str, arguments: Value| AgentModelTurn {
        continuation: None,
        text: String::new(),
        usage: None,
        tool_calls: vec![AgentModelToolCall {
            id: format!("coding-{}", facts.len()),
            name: name.into(),
            arguments,
        }],
    };
    if request.tools.len() <= 1 {
        return Err(ModelError::ProviderProtocolError);
    }
    let files = [
        "amount.py",
        "test_amount.py",
        "noise0.txt",
        "noise1.txt",
        "noise2.txt",
        "noise3.txt",
    ];
    if facts.len() < files.len() {
        return Ok(call(
            "read_file",
            json!({"path":files[facts.len()],"max_bytes":65536}),
        ));
    }
    if !request.tools.iter().any(|d| {
        d.name == "replace_text"
            && !d.input_schema["required"]
                .as_array()
                .unwrap()
                .contains(&json!("expected_sha256"))
    }) {
        return Err(ModelError::ProviderProtocolError);
    }
    let edited = facts
        .iter()
        .find(|f| f.name == "apply_patches" && f.status == AgentToolStatus::Completed);
    if edited.is_none() {
        let sources = serde_json::to_string(&crate::agent_work_state::source_observations(
            &request.messages,
            usize::MAX,
        ))
        .unwrap();
        if !sources.contains("SOURCE_IMPLEMENTATION_TAIL")
            || !sources.contains("SOURCE_ASSERTIONS_TAIL")
        {
            // Cold restore legitimately has metadata, not source bodies. Load
            // only the missing current file, never loop over the old noise.
            let path = if !sources.contains("SOURCE_IMPLEMENTATION_TAIL") {
                "amount.py"
            } else {
                "test_amount.py"
            };
            return Ok(call("read_file", json!({"path":path,"max_bytes":65536})));
        }
        if !facts.iter().any(|f| f.name == "capability_status") {
            if request.tools.iter().any(|d| d.name == "apply_patches") {
                return Err(ModelError::ProviderProtocolError);
            }
            return Ok(call(
                "capability_status",
                json!({"tool_name":"apply_patches"}),
            ));
        }
        let Some(batch_tool) = request.tools.iter().find(|d| d.name == "apply_patches") else {
            return Err(ModelError::ProviderProtocolError);
        };
        if batch_tool.input_schema["properties"]["patches"]["items"]["required"]
            .as_array()
            .unwrap()
            .contains(&json!("expected_sha256"))
        {
            return Err(ModelError::ProviderProtocolError);
        }
        let latest = facts.iter().rev().find(|f| f.name == "run_command");
        let observed = crate::agent_work_state::command_observations(&request.messages);
        let diagnostic = latest.and_then(|latest| {
            observed.iter().find(|output| {
                output["receipt"]["tool_call_id"].as_str() == Some(latest.id.0.as_str())
            })
        });
        if latest.is_none() || diagnostic.is_none() {
            if let Some(latest) = latest {
                // A cold resume has hashes but no body. Require the production
                // projection to say so, then reacquire this safe fixture check.
                let current = request.messages.iter().find_map(|m| match m {
                    AgentModelMessage::User(text) => text
                        .strip_prefix(crate::agent_work_state::CURRENT_WORK_MARKER)
                        .and_then(|s| {
                            serde_json::Deserializer::from_str(s)
                                .into_iter::<Value>()
                                .next()
                        })
                        .and_then(Result::ok),
                    _ => None,
                });
                if !current
                    .as_ref()
                    .and_then(|p| p["recent_checks"].as_array())
                    .is_some_and(|checks| {
                        checks.iter().any(|c| {
                            c["tool_call_id"].as_str() == Some(latest.id.0.as_str())
                                && c["output_context"] == "UNAVAILABLE"
                        })
                    })
                {
                    return Err(ModelError::ProviderProtocolError);
                }
            }
            return Ok(call(
                "run_command",
                json!({"program":"python3","argv":["-m","unittest","test_amount","-v"],"timeout_ms":10000}),
            ));
        }
        let diagnostic = diagnostic.unwrap();
        if diagnostic["receipt"]["exit_code"] != 1
            || !diagnostic["excerpt"]
                .as_str()
                .is_some_and(|s| s.contains("AssertionError: 12000 != 15000"))
        {
            return Err(ModelError::ProviderProtocolError);
        }
        return Ok(call(
            "apply_patches",
            json!({"patches":[{"path":"amount.py","replacements":[{"old_text":"return max(sum(owed), 0)","new_text":"return sum(max(value, 0) for value in owed)"}]}]}),
        ));
    }
    let passing = facts.iter().rev().find(|f| {
        f.name == "run_command" && f.receipt.as_ref().is_some_and(|r| r["success"] == true)
    });
    if passing.is_none() {
        return Ok(call(
            "run_command",
            json!({"program":"python3","argv":["-m","unittest","test_amount","-v"],"timeout_ms":10000}),
        ));
    }
    if !request.tools.iter().any(|d| d.name == "apply_patches") {
        return Err(ModelError::ProviderProtocolError);
    }
    Ok(call(
        "finish_task",
        json!({"outcome":"completed","remaining_work":[],"required_evidence":[],"intent":"workspace_change",
        "request_quote":"Fix the aggregation and run the assertion test.",
        "summary":"Aggregation repaired; isolated assertion passed.",
        "evidence_tool_call_ids":[edited.unwrap().id,passing.unwrap().id]}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_agent::{CommandCancellation, ToolExecutor, ToolRuntime, coding_tool_catalog};

    fn fact(name: &str, arguments: Value, receipt: Value) -> AgentToolCallView {
        serde_json::from_value(json!({"id":"observation","run_id":"run","name":name,
            "effect":"OBSERVE","status":"COMPLETED","policy_decision":"ALLOW",
            "arguments":arguments,"receipt":receipt,"created_at":0,"updated_at":0}))
        .unwrap()
    }
    fn definitions() -> Vec<ModelToolDefinition> {
        coding_tool_catalog()
            .into_iter()
            .map(|s| s.definition)
            .collect()
    }
    fn read_exchange(messages: &mut Vec<AgentModelMessage>, path: &str, body: &str) {
        messages.push(AgentModelMessage::Assistant {
            continuation: None,
            text: String::new(),
            tool_calls: vec![AgentModelToolCall {
                id: path.into(),
                name: "read_file".into(),
                arguments: json!({"path":path}),
            }],
        });
        messages.push(AgentModelMessage::ToolResult { call_id:path.into(), name:"read_file".into(), is_error:false,
            content:format!("Receipt (trusted execution metadata): {}\nObservation:\n{body}",
                json!({"kind":"FILE_READ","tool_call_id":path,"path":path,"sha256":"a".repeat(64),"byte_start":0,"byte_end":body.len()})) });
    }
    #[test]
    fn research_clock_is_real_utc_across_leap_days() {
        assert!(research_guidance(0).contains("1970-01-01"));
        assert!(research_guidance(951782400000).contains("2000-02-29"));
        assert!(research_guidance(1791730969861).contains("2026-10-11"));
    }

    fn request() -> AgentModelRequest {
        AgentModelRequest {
            model_id: "unknown-model".into(),
            system: "system".repeat(2000),
            tools: select_tools(definitions(), &[]),
            max_output_tokens: 6144,
            messages: vec![AgentModelMessage::User(
                "Keep the original files unchanged except the requested repair.".into(),
            )],
        }
    }

    #[test]
    fn default_catalog_is_smaller_and_exact_discovery_survives_restart_without_granting_access() {
        let catalog = definitions();
        let base = select_tools(catalog.clone(), &[]);
        assert!(base.len() <= 18);
        assert!(
            serde_json::to_vec(&base).unwrap().len()
                < serde_json::to_vec(&catalog).unwrap().len() / 2
        );
        assert!(!base.iter().any(|d| d.name == "apply_patches"));
        let discovered = fact(
            "capability_status",
            json!({"tool_name":"apply_patches"}),
            json!({"tool_detail":{"definition":{"name":"apply_patches"},"facts":{"available":true}}}),
        );
        let restored: Vec<AgentToolCallView> =
            serde_json::from_value(serde_json::to_value(vec![discovered.clone()]).unwrap())
                .unwrap();
        let expanded = select_tools(catalog.clone(), &restored);
        assert!(expanded.iter().any(|d| d.name == "apply_patches"));
        let projected = &expanded
            .iter()
            .find(|d| d.name == "apply_patches")
            .unwrap()
            .input_schema;
        assert_eq!(projected["properties"]["patches"]["type"], "array");
        assert_eq!(
            projected["properties"]["patches"]["items"]["required"],
            json!(["path"])
        );
        assert!(
            catalog
                .iter()
                .find(|d| d.name == "apply_patches")
                .unwrap()
                .input_schema["properties"]["patches"]["items"]["required"]
                .as_array()
                .unwrap()
                .contains(&json!("expected_sha256")),
            "Backend contract remains strict"
        );
        let revoked = catalog
            .into_iter()
            .filter(|d| d.name != "apply_patches")
            .collect();
        assert!(
            !select_tools(revoked, &restored)
                .iter()
                .any(|d| d.name == "apply_patches")
        );
        let mut failed = discovered;
        failed.status = AgentToolStatus::Failed;
        assert!(
            !select_tools(definitions(), &[failed])
                .iter()
                .any(|d| d.name == "apply_patches")
        );
    }

    #[test]
    fn filtered_discovery_exposes_returned_current_tools_after_restart_without_granting_access() {
        let mut catalog = definitions();
        catalog.extend(
            crate::agent_browser::catalog()
                .into_iter()
                .map(|t| t.definition),
        );
        let discovered = fact(
            "capability_status",
            json!({"filter":{"text":"browser"}}),
            json!({"kind":"CAPABILITY_STATUS","tool_catalog":[
                {"name":"browser_server","available":true,"admission":"ADMITTED_TO_CURRENT_CATALOG"},
                {"name":"browser","available":true,"admission":"ADMITTED_TO_CURRENT_CATALOG"},
                {"name":"browser_verify","available":false,"admission":"ADMITTED_TO_CURRENT_CATALOG"},
                {"name":"invented_tool","available":true,"admission":"ADMITTED_TO_CURRENT_CATALOG","definition":{"name":"invented_tool"}}
            ]}),
        );
        let restored: Vec<AgentToolCallView> =
            serde_json::from_value(serde_json::to_value(vec![discovered.clone()]).unwrap())
                .unwrap();
        let names = |facts: &[AgentToolCallView]| {
            select_tools(catalog.clone(), facts)
                .into_iter()
                .map(|t| t.name)
                .collect::<Vec<_>>()
        };
        let selected = names(&restored);
        assert!(
            selected.contains(&"browser".into()) && selected.contains(&"browser_server".into())
        );
        assert!(
            !selected.contains(&"browser_verify".into())
                && !selected.contains(&"invented_tool".into())
        );
        for arguments in [
            json!({}),
            json!({"filter":{}}),
            json!({"filter":{"text":" "}}),
        ] {
            let mut inventory = discovered.clone();
            inventory.arguments = arguments;
            assert!(!names(&[inventory]).contains(&"browser".into()));
        }
        let mut failed = discovered.clone();
        failed.status = AgentToolStatus::Failed;
        assert!(!names(&[failed]).contains(&"browser".into()));
        let mut wrong_kind = discovered;
        wrong_kind.receipt.as_mut().unwrap()["kind"] = json!("FILE_READ");
        assert!(!names(&[wrong_kind]).contains(&"browser".into()));
        catalog.retain(|t| t.name != "browser");
        assert!(
            !select_tools(catalog, &restored)
                .iter()
                .any(|t| t.name == "browser")
        );
    }

    #[test]
    fn filtered_extension_projection_is_bounded_and_unreturned_pages_stay_hidden() {
        let mut catalog = definitions();
        for i in 0..30 {
            catalog.push(ModelToolDefinition {
                name: format!("extra_{i}"),
                description: "fixture".into(),
                input_schema: json!({"type":"object"}),
            });
        }
        let receipt = json!({"kind":"CAPABILITY_STATUS","tool_catalog":(0..24).map(|i|json!({"name":format!("extra_{i}"),"available":true,"admission":"ADMITTED_TO_CURRENT_CATALOG"})).collect::<Vec<_>>()});
        let facts = vec![fact(
            "capability_status",
            json!({"filter":{"effect":"NETWORK"}}),
            receipt,
        )];
        let selected = select_tools(catalog, &facts);
        assert_eq!(
            selected
                .iter()
                .filter(|t| t.name.starts_with("extra_"))
                .count(),
            12
        );
        assert!(!selected.iter().any(|t| t.name == "extra_24"));
    }

    #[test]
    fn browser_selection_survives_compaction_with_its_complete_live_snapshot() {
        // Production workshop run: 44,688 fixed bytes, ~13 KB browser results,
        // pinned guidance after the tool exchange, and ~22 KB working sources.
        // At steps 126/134/138/142 the compiled request had zero tool messages.
        let mut request = request();
        let fixed = request.system.len() + serde_json::to_vec(&request.tools).unwrap().len();
        request.system.push_str(&"s".repeat(44688 - fixed));
        request.messages.push(AgentModelMessage::Assistant {
            continuation: None,
            text: "old conversation ".repeat(280),
            tool_calls: vec![],
        });
        request
            .messages
            .push(AgentModelMessage::User("original requirement ".repeat(400)));
        read_exchange(
            &mut request.messages,
            "index.html",
            &format!("{}WORKBENCH_TAIL", "x".repeat(16500)),
        );
        read_exchange(
            &mut request.messages,
            "research.md",
            &format!("{}RESEARCH_TAIL", "x".repeat(5400)),
        );
        let correction = format!(
            "CURRENT_USER_CONSTRAINT: preserve completed edits. {}",
            "h".repeat(20000)
        );
        for cycle in 0..3 {
            read_exchange(
                &mut request.messages,
                &format!("noise-{cycle}"),
                &"n".repeat(90000),
            );
            let id = format!("selection-{cycle}");
            let content = format!(
                "Receipt (trusted execution metadata): {}\nObservation:\n{}",
                json!({"kind":"BROWSER","status":"page_loaded","snapshot_id":format!("snapshot-{cycle}"),
                    "elements":[{"ref":"e33","role":"combobox","value":"资料研究"},
                                {"ref":"e34","role":"combobox","value":"空闲"},
                                {"ref":"e35","role":"button","name":"保存修改"}]}),
                "visible schedule ".repeat(750)
            );
            request.messages.push(AgentModelMessage::Assistant {
                continuation: None,
                text: "继续选择老师并保存".into(),
                tool_calls: vec![AgentModelToolCall {
                    id: id.clone(),
                    name: "browser".into(),
                    arguments: json!({"action":"select","ref":"e33","value":"资料研究"}),
                }],
            });
            request.messages.push(AgentModelMessage::ToolResult {
                call_id: id.clone(),
                name: "browser".into(),
                is_error: false,
                content: content.clone(),
            });
            // In the real loop, pinned user/Harness messages follow the tools.
            request
                .messages
                .push(AgentModelMessage::User(correction.clone()));
            let budget = compile_context(
                &mut request,
                json!({"model_assessment_unverified":"prior plan ".repeat(800)}),
            );
            assert_eq!(budget["reduced"], true);
            assert_eq!(budget["fits"], true, "{budget}");
            assert!(request.messages.iter().any(|m| matches!(m,
                AgentModelMessage::ToolResult {call_id, content:actual, ..} if call_id == &id && actual == &content)),
                "Latest live snapshot was replaced by a historical excerpt: {budget}");
            assert!(request.messages.iter().any(|m| matches!(m,
                AgentModelMessage::Assistant {tool_calls, ..} if tool_calls.iter().any(|c| c.id == id))));
            assert_eq!(
                request
                    .messages
                    .iter()
                    .filter(|m| matches!(m,
                AgentModelMessage::User(s) if s == &correction))
                    .count(),
                1
            );
            let sources = json!(crate::agent_work_state::source_observations(
                &request.messages,
                usize::MAX
            ))
            .to_string();
            assert!(
                sources.contains("WORKBENCH_TAIL") && sources.contains("RESEARCH_TAIL"),
                "{budget}"
            );
            assert_eq!(compile_context(&mut request, json!({}))["reduced"], false);
        }
    }

    #[test]
    fn assembled_budget_preserves_two_real_sized_files_and_the_user_correction() {
        let mut request = request();
        read_exchange(
            &mut request.messages,
            "implementation.py",
            &format!("{}\nIMPLEMENTATION_TAIL", "x".repeat(18467)),
        );
        read_exchange(
            &mut request.messages,
            "tests.py",
            &format!("{}\nASSERTIONS_TAIL", "x".repeat(18959)),
        );
        for i in 0..4 {
            read_exchange(
                &mut request.messages,
                &format!("noise{i}.txt"),
                &"z".repeat(60000),
            );
        }
        request.messages.push(AgentModelMessage::User(
            "Correction: preserve the database.".into(),
        ));
        let budget = compile_context(&mut request, json!({}));
        assert_eq!(budget["reduced"], true);
        assert_eq!(budget["fits"], true, "{budget}");
        assert_eq!(budget["output_reserve_tokens"], 6144);
        let actual = format!("{:?}", request.messages);
        assert!(actual.contains("IMPLEMENTATION_TAIL"));
        assert!(actual.contains("ASSERTIONS_TAIL"));
        assert!(actual.contains("Correction: preserve the database."));
        assert_eq!(
            budget["after_bytes"].as_u64().unwrap() as usize,
            request_cost(&request)
        );
        assert_eq!(
            compile_context(&mut request, json!({}))["reduced"],
            false,
            "No per-turn compression loop"
        );
    }

    #[test]
    fn resumed_history_pressure_keeps_working_sources_inside_the_same_envelope() {
        // Sizes follow the failed real resumed request. Earlier pressure tests
        // had one small user sentence, so they missed fixed-context starvation.
        let mut request = request();
        request.messages.clear();
        let fixed = request.system.len() + serde_json::to_vec(&request.tools).unwrap().len();
        request.system.push_str(&"s".repeat(32089 - fixed));
        for (i, bytes) in [
            6, 340, 269, 2146, 2262, 3307, 815, 1887, 1750, 1953, 1978, 4983,
        ]
        .into_iter()
        .enumerate()
        {
            let text = "h".repeat(bytes);
            request.messages.push(if i % 2 == 0 {
                AgentModelMessage::User(text)
            } else {
                AgentModelMessage::Assistant {
                    continuation: None,
                    text,
                    tool_calls: vec![],
                }
            });
        }
        for (marker, bytes) in [
            ("Task:\nPreserve the database and fix the detector.\n", 3000),
            (crate::agent_work_state::REPOSITORY_CONTEXT_MARKER, 18000),
            (
                "Fielora Project scope metadata (identity and historical data only):\n",
                859,
            ),
            (crate::agent_work_state::CURRENT_WORK_MARKER, 8682),
            (
                crate::agent_work_plan::RESUME_MARKER,
                crate::agent_work_plan::continuation_context().len(),
            ),
            (crate::agent_recovery::CONTEXT_MARKER, 7977),
            (crate::agent_work_state::DIAGNOSTIC_CONTEXT_MARKER, 6385),
            (
                crate::agent_turn_context::MARKER,
                15084
                    - crate::agent_turn_context::GUIDANCE.len()
                    - crate::agent_request_intent::GUIDANCE.len()
                    - crate::agent_user_input::GUIDANCE.len(),
            ),
        ] {
            request.messages.push(AgentModelMessage::User(format!(
                "{marker}{}",
                "h".repeat(bytes - marker.len())
            )));
        }
        let correction = "CURRENT_USER_CONSTRAINT: do not change production data.";
        request
            .messages
            .push(AgentModelMessage::User(correction.into()));
        read_exchange(&mut request.messages, "app.py", &"a".repeat(1673));
        read_exchange(&mut request.messages, "db.py", &"d".repeat(4860));
        read_exchange(
            &mut request.messages,
            "detector.py",
            &format!("{}DETECTOR_TAIL", "m".repeat(16549)),
        );
        read_exchange(
            &mut request.messages,
            "tests.py",
            &format!("{}ASSERTIONS_TAIL", "t".repeat(18925)),
        );
        for i in 0..3 {
            read_exchange(
                &mut request.messages,
                &format!("noise{i}"),
                &"n".repeat(60000),
            );
        }
        let budget = compile_context(
            &mut request,
            json!({"model_assessment_unverified":"historical hypothesis ".repeat(550)}),
        );
        assert_eq!(budget["reduced"], true);
        assert_eq!(budget["fits"], true);
        let sources = json!(crate::agent_work_state::source_observations(
            &request.messages,
            usize::MAX
        ))
        .to_string();
        assert!(
            sources.contains("DETECTOR_TAIL"),
            "Working source starved by pinned metadata: {budget}"
        );
        assert!(
            sources.contains("ASSERTIONS_TAIL"),
            "Second active file was lost: {budget}"
        );
        assert!(
            request
                .messages
                .iter()
                .any(|m| matches!(m, AgentModelMessage::User(s) if s == correction))
        );
        assert_eq!(compile_context(&mut request, json!({}))["reduced"], false);
        assert!(!request.messages.iter().any(|m| matches!(m, AgentModelMessage::User(s) if s.starts_with(crate::agent_work_state::REPOSITORY_CONTEXT_MARKER))));
        // Another long result must not turn the working set back into a
        // metadata-only checkpoint on a subsequent reduction.
        for cycle in 0..3 {
            read_exchange(
                &mut request.messages,
                &format!("later-noise-{cycle}"),
                &"z".repeat(60000),
            );
            let next = compile_context(
                &mut request,
                json!({"model_assessment_unverified":"historical hypothesis ".repeat(550)}),
            );
            assert_eq!(next["reduced"], true);
            assert_eq!(next["fits"], true);
            let sources = json!(crate::agent_work_state::source_observations(
                &request.messages,
                usize::MAX
            ))
            .to_string();
            assert!(
                sources.contains("DETECTOR_TAIL") && sources.contains("ASSERTIONS_TAIL"),
                "{next}"
            );
            assert!(
                request
                    .messages
                    .iter()
                    .any(|m| matches!(m, AgentModelMessage::User(s) if s == correction))
            );
        }
    }

    #[test]
    fn tool_schema_and_output_reserve_share_budget_and_oversized_user_is_never_dropped() {
        let mut small = request();
        let base = compile_context(&mut small, json!({}));
        small.max_output_tokens += 4096;
        small.tools[0].description.push_str(&"schema".repeat(3000));
        let bigger = compile_context(&mut small, json!({}));
        assert!(bigger["fixed_bytes"].as_u64() > base["fixed_bytes"].as_u64());
        assert!(bigger["input_limit_bytes"].as_u64() < base["input_limit_bytes"].as_u64());
        let user = "DO NOT DROP".repeat(30000);
        small.messages.push(AgentModelMessage::User(user.clone()));
        read_exchange(&mut small.messages, "a", "small");
        read_exchange(&mut small.messages, "b", "small");
        assert_eq!(compile_context(&mut small, json!({}))["fits"], false);
        assert!(
            small
                .messages
                .iter()
                .any(|m| matches!(m, AgentModelMessage::User(s) if s == &user))
        );
    }

    #[test]
    fn batch_edits_bind_each_observed_version_and_keep_atomic_conflict_protection() {
        let root = std::env::temp_dir().join(format!("fielora-batch-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&root).unwrap();
        for (path, body) in [("a.py", "first\n"), ("b.py", "second\n")] {
            std::fs::write(root.join(path), body).unwrap();
        }
        let runtime = ToolRuntime::new(&root, &root.join("artifacts")).unwrap();
        let cancel = CommandCancellation::default();
        let facts = ["a.py", "b.py"]
            .iter()
            .map(|path| {
                let args = json!({"path":path});
                let read = runtime.execute("read_file", &args, false, &cancel).unwrap();
                fact("read_file", args, read.receipt)
            })
            .collect::<Vec<_>>();
        // Production cold restore sees the same durable receipts, no raw bodies.
        let facts =
            serde_json::from_value::<Vec<AgentToolCallView>>(serde_json::to_value(facts).unwrap())
                .unwrap();
        let edit = || AgentModelToolCall {
            id: "batch".into(),
            name: "apply_patches".into(),
            arguments: json!({"patches":[
                {"path":"a.py","replacements":[{"old_text":"first","new_text":"fixed first"}]},
                {"path":"b.py","line_edits":[{"start_line":1,"end_line":1,"new_text":"fixed second"}]}
            ]}),
        };
        let mut bound = edit();
        bind_observed_edit(&mut bound, &facts);
        assert!(bound.arguments["patches"][0]["expected_sha256"].is_string());
        assert_ne!(
            bound.arguments["patches"][0]["expected_sha256"],
            bound.arguments["patches"][1]["expected_sha256"]
        );
        std::fs::write(root.join("b.py"), "external change\n").unwrap();
        let error = runtime
            .execute(&bound.name, &bound.arguments, true, &cancel)
            .unwrap_err();
        assert_eq!(error.code(), "AGENT_FILE_CHANGED");
        assert_eq!(
            std::fs::read_to_string(root.join("a.py")).unwrap(),
            "first\n",
            "Batch must not partially write"
        );
        std::fs::write(root.join("b.py"), "second\n").unwrap();
        runtime
            .execute(&bound.name, &bound.arguments, true, &cancel)
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("a.py")).unwrap(),
            "fixed first\n"
        );
        assert!(
            std::fs::read_to_string(root.join("b.py"))
                .unwrap()
                .starts_with("fixed second")
        );
        let mut explicit = edit();
        explicit.arguments["patches"][0]["expected_sha256"] = json!("b".repeat(64));
        bind_observed_edit(&mut explicit, &facts);
        assert_eq!(
            explicit.arguments["patches"][0]["expected_sha256"],
            "b".repeat(64)
        );
        let mut misplaced = edit();
        misplaced.arguments["expected_sha256"] = json!("b".repeat(64));
        let original = misplaced.arguments.clone();
        bind_observed_edit(&mut misplaced, &facts);
        assert_eq!(
            misplaced.arguments, original,
            "Ambiguous explicit root guard must not be overwritten or distributed"
        );
        let mut malformed = edit();
        malformed.arguments["patches"] = json!(malformed.arguments["patches"].to_string());
        let original = malformed.arguments.clone();
        bind_observed_edit(&mut malformed, &facts);
        assert_eq!(malformed.arguments, original);
        assert!(
            runtime
                .execute(&malformed.name, &malformed.arguments, true, &cancel)
                .is_err()
        );
        let mut unobserved = edit();
        bind_observed_edit(&mut unobserved, &[]);
        assert!(
            runtime
                .execute(&unobserved.name, &unobserved.arguments, true, &cancel)
                .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inferred_edit_guard_checks_the_real_file_and_never_repairs_explicit_or_unobserved_guards() {
        let root = std::env::temp_dir().join(format!("fielora-coding-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("file.txt");
        std::fs::write(&path, "before").unwrap();
        let runtime = ToolRuntime::new(&root, &root.join("artifacts")).unwrap();
        let cancel = CommandCancellation::default();
        let read = runtime
            .execute("read_file", &json!({"path":"file.txt"}), false, &cancel)
            .unwrap();
        let facts = vec![fact("read_file", json!({"path":"file.txt"}), read.receipt)];
        let edit = || AgentModelToolCall {
            id: "edit".into(),
            name: "replace_text".into(),
            arguments: json!({"path":"file.txt","old_text":"before","new_text":"after"}),
        };
        let mut bound = edit();
        bind_observed_edit(&mut bound, &facts);
        assert!(bound.arguments["expected_sha256"].is_string());
        runtime
            .execute(&bound.name, &bound.arguments, true, &cancel)
            .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after");
        std::fs::write(&path, "external change").unwrap();
        let error = runtime
            .execute(&bound.name, &bound.arguments, true, &cancel)
            .unwrap_err();
        assert_eq!(error.code(), "AGENT_FILE_CHANGED");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external change");
        let mut wrong = edit();
        wrong.arguments["expected_sha256"] = json!("b".repeat(64));
        bind_observed_edit(&mut wrong, &facts);
        assert_eq!(wrong.arguments["expected_sha256"], "b".repeat(64));
        let mut missing = edit();
        bind_observed_edit(&mut missing, &[]);
        assert!(missing.arguments.get("expected_sha256").is_none());
        assert!(
            runtime
                .execute(&missing.name, &missing.arguments, true, &cancel)
                .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
