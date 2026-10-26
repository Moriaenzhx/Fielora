//! One bounded retry; later calls retain size recovery from the existing Run ledger.
//! Never repair arguments or treat a generation constraint as execution authority.
use fielora_contracts::{AgentEventKind, AgentEventView, AgentRunId, ListAgentEventsRequest};
use fielora_field::DomainError;
use fielora_model::{
    AgentModelRequest, ArgumentJsonCategory, ModelError, ResponseFailure, ResponseFailureStage,
};
use fielora_storage::StorageHandle;

const MARKER: &str = "FIELORA_TOOL_CALL_VALIDATION_FEEDBACK";
const LARGE_ARGUMENT_MARKER: &str = "FIELORA_LARGE_ARGUMENT_RECOVERY";
const LEGACY_LARGE_EOF_MARKER: &str = "FIELORA_INCOMPLETE_LARGE_ARGUMENT";
const REPAIR_WRITE_CHARS: u64 = 3000;
const SMALL_WRITE_GUIDANCE: &str = "FIELORA_LARGE_ARGUMENT_RECOVERY: A large tool argument in this Run failed JSON validation. For the remaining work in this Run, emit ONE small complete call, at most 3000 characters per content/new_text string. Build coherent modules incrementally using the available tools. A successful discovery, read or small write does not remove this generation constraint. Preserve completed work; keep unfinished functionality explicit and never resend the whole application or report a partial application as complete. This parser failure is not proof of a provider output limit.";
pub const GUIDANCE: &str = "The previous model response failed tool-call validation. No tool from that rejected response was executed. Previously completed tools and file writes remain valid; do not repeat them. Regenerate only the rejected next action with a complete call ID, an exact available tool name, and one valid JSON object for its arguments. Escape quotes, backslashes and newlines inside JSON strings; do not wrap arguments in Markdown or concatenate multiple JSON objects. For large source writes, use smaller independently valid calls or modules supported by the available tools, preserving the requested functionality. Do not truncate code, guess missing data, or claim that rejected work succeeded. Existing execution permissions, task scope and output budget are unchanged. Any temporary generation constraints are stated below.";

/// Constant-size projection of trusted, content-free parser facts. Replayed on
/// startup and refreshed incrementally; no new checkpoint or state owner.
#[derive(Default)]
pub struct RetainedRecovery {
    cursor: u64,
    pub large_argument_source_sequence: Option<u64>,
}

impl RetainedRecovery {
    pub fn refresh(
        &mut self,
        storage: &StorageHandle,
        run_id: &AgentRunId,
    ) -> Result<(), DomainError> {
        loop {
            let events = storage.list_agent_events(ListAgentEventsRequest {
                run_id: run_id.clone(),
                after_sequence: Some(self.cursor),
                limit: Some(500),
            })?;
            for event in &events {
                self.observe(event);
                self.cursor = event.sequence;
            }
            if events.len() < 500 {
                return Ok(());
            }
        }
    }

    fn observe(&mut self, event: &AgentEventView) {
        let payload = &event.payload;
        if (event.kind == AgentEventKind::ModelFailed
            || (event.kind == AgentEventKind::CheckpointCreated
                && payload["kind"] == "MODEL_RETRY"))
            && payload["error_code"] == "PROVIDER_INVALID_TOOL_CALL"
            && large_argument_diagnostics(&payload["response_diagnostics"])
        {
            self.large_argument_source_sequence = Some(event.sequence);
        }
    }

    pub fn apply(&self, request: &mut AgentModelRequest) {
        if self.large_argument_source_sequence.is_some() {
            apply_small_writes(request);
        }
    }
}

fn large_argument_diagnostics(d: &serde_json::Value) -> bool {
    d["failure_stage"] == "TOOL_ARGUMENTS_JSON"
        && matches!(
            d["argument_json_error"]["category"].as_str(),
            Some("EOF" | "SYNTAX")
        )
        && d["tool_argument_bytes"].as_u64().is_some_and(|n| n >= 8192)
}

fn apply_small_writes(request: &mut AgentModelRequest) {
    if !request.system.contains(LARGE_ARGUMENT_MARKER) {
        request.system.push('\n');
        request.system.push_str(SMALL_WRITE_GUIDANCE);
    }
    constrain_writes(request);
}

pub fn apply(request: &mut AgentModelRequest, error: &ModelError) -> bool {
    let ModelError::Response {
        failure: ResponseFailure::InvalidToolCall,
        diagnostics,
    } = error
    else {
        return false;
    };
    if request.system.contains(MARKER) {
        return false;
    }
    let detail = match diagnostics.failure_stage {
        Some(ResponseFailureStage::ToolCallId) => "The completed call had no usable ID.",
        Some(ResponseFailureStage::ToolCallName) => "The completed call had no usable tool name.",
        Some(ResponseFailureStage::ToolCallMissing) => {
            "The response ended with tool_calls but contained no call."
        }
        Some(ResponseFailureStage::ToolArgumentsObject) => {
            "The parsed arguments were not a JSON object."
        }
        Some(ResponseFailureStage::ToolArgumentsJson) => {
            "The assembled argument string could not be parsed as JSON."
        }
        _ => {
            "The call identity or assembled arguments were invalid; the precise legacy failure stage is unavailable."
        }
    };
    request
        .system
        .push_str(&format!("\n\n{MARKER}\n{detail}\n{GUIDANCE}"));
    if let Some(error) = &diagnostics.argument_json_error {
        request.system.push_str(&format!("\nJSON validation category {:?}, line {}, column {}; assembled argument bytes {}. These are parser facts, not proof of a provider output limit.", error.category, error.line, error.column, diagnostics.tool_argument_bytes));
        if matches!(
            error.category,
            ArgumentJsonCategory::Eof | ArgumentJsonCategory::Syntax
        ) && diagnostics.failure_stage == Some(ResponseFailureStage::ToolArgumentsJson)
            && diagnostics.tool_argument_bytes >= 8192
        {
            apply_small_writes(request);
        }
    }
    true
}

pub fn resume_guidance(
    error_code: Option<&str>,
    diagnostics: Option<&serde_json::Value>,
) -> Option<String> {
    let mut note = resume_note(error_code)?.to_owned();
    if let Some(d) = diagnostics
        && large_argument_diagnostics(d)
    {
        note.push('\n');
        note.push_str(SMALL_WRITE_GUIDANCE);
    }
    Some(note)
}

pub fn apply_retained_constraints(request: &mut AgentModelRequest) {
    if request.messages.iter().any(
        |m| matches!(m, fielora_model::AgentModelMessage::User(s) if s.contains(LARGE_ARGUMENT_MARKER) || s.contains(LEGACY_LARGE_EOF_MARKER)),
    ) {
        constrain_writes(request);
    }
}

/// A request-local generation constraint, never truncation or repair of output.
/// Reapply from the Run's parser facts, including after transcript reduction.
pub fn constrain_writes(request: &mut AgentModelRequest) {
    fn narrow(schema: &mut serde_json::Value) {
        if let Some(properties) = schema
            .get_mut("properties")
            .and_then(serde_json::Value::as_object_mut)
        {
            for (name, value) in properties {
                if matches!(name.as_str(), "content" | "new_text") && value["type"] == "string" {
                    let limit = value["maxLength"]
                        .as_u64()
                        .unwrap_or(u64::MAX)
                        .min(REPAIR_WRITE_CHARS);
                    value["maxLength"] = serde_json::json!(limit);
                }
                narrow(value);
            }
        }
        if let Some(items) = schema.get_mut("items") {
            narrow(items);
        }
    }
    for tool in &mut request.tools {
        if matches!(
            tool.name.as_str(),
            "create_file" | "write_file" | "replace_text" | "apply_patches"
        ) {
            narrow(&mut tool.input_schema);
        }
    }
}

pub fn resume_note(error_code: Option<&str>) -> Option<&'static str> {
    (error_code == Some("PROVIDER_INVALID_TOOL_CALL")).then_some(GUIDANCE)
}

// Reached only for explicitly named isolated E2E models with FIELORA_E2E=1.
// Wire decoding is separately covered by real local HTTP/SSE tests in Model.
pub fn fixture_turn(
    request: &AgentModelRequest,
    task: &str,
    facts: &[fielora_contracts::AgentToolCallView],
    always_invalid: bool,
) -> Result<fielora_model::AgentModelTurn, ModelError> {
    use fielora_contracts::AgentToolStatus;
    use fielora_model::{AgentModelToolCall, AgentModelTurn, ResponseDiagnostics};
    use serde_json::json;
    let completed = |name: &str| {
        facts
            .iter()
            .any(|t| t.name == name && t.status == AgentToolStatus::Completed)
    };
    let written = |path: &str| {
        facts.iter().any(|t| {
            t.name == "create_file"
                && t.arguments["path"] == path
                && t.status == AgentToolStatus::Completed
        })
    };
    let narrowed = request.system.contains(LARGE_ARGUMENT_MARKER)
        && request.tools.iter().any(|t| {
            t.name == "create_file"
                && t.input_schema["properties"]["content"]["maxLength"] == REPAIR_WRITE_CHARS
        });
    let (name, arguments) = if !completed("record_request_intent") {
        (
            "record_request_intent",
            json!({"intent":"workspace_change","request_quote":task}),
        )
    } else if !written("requirements.txt") {
        (
            "create_file",
            json!({"path":"requirements.txt","content":"Flask==3.0.0\n"}),
        )
    } else if !completed("read_file") {
        if always_invalid || !request.system.contains(LARGE_ARGUMENT_MARKER) {
            return Err(ModelError::Response {
                failure: ResponseFailure::InvalidToolCall,
                diagnostics: ResponseDiagnostics {
                    http_status: Some(200),
                    finish_reason: Some(fielora_model::FinishReason::ToolCalls),
                    event_count: 1100,
                    tool_call_count: 1,
                    tool_argument_bytes: 17_125,
                    failure_stage: Some(ResponseFailureStage::ToolArgumentsJson),
                    argument_json_error: Some(fielora_model::ArgumentJsonError {
                        category: if request.system.contains(MARKER) {
                            ArgumentJsonCategory::Syntax
                        } else {
                            ArgumentJsonCategory::Eof
                        },
                        line: 1,
                        column: 17_125,
                    }),
                    ..Default::default()
                }
                .into(),
            });
        }
        if !narrowed {
            return Err(ModelError::ProviderProtocolError);
        }
        // The real failure first recovered via discovery, then lost its size
        // constraint on the next turn. Exercise a non-writing recovery action.
        ("read_file", json!({"path":"requirements.txt"}))
    } else if !written("app.py") || !written("helper.py") {
        // Must inspect the actual next request, not infer recovery from facts.
        if !narrowed {
            return Err(ModelError::ProviderProtocolError);
        }
        (
            "create_file",
            json!({"path":if written("app.py") {"helper.py"} else {"app.py"},"content":"# Synthetic repaired tool call, not the business application.\nprint('repair verified')\n"}),
        )
    } else {
        (
            "request_user_input",
            json!({"question":"测试已收到有效的纠正调用。请检查隔离测试文件。","reason":"FIXTURE_TOOL_REPAIR_VERIFIED"}),
        )
    };
    Ok(AgentModelTurn {
        text: String::new(),
        continuation: None,
        usage: None,
        tool_calls: vec![AgentModelToolCall {
            id: format!("repair-fixture-{}", facts.len()),
            name: name.into(),
            arguments,
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_contracts::ModelToolDefinition;
    use fielora_model::{AgentModelMessage, ResponseDiagnostics};
    use serde_json::json;

    #[test]
    fn large_eof_retry_and_cold_resume_narrow_writes_without_changing_prior_work_or_budget() {
        let mut request = AgentModelRequest {
            model_id: "fixture".into(),
            system: "scope".into(),
            messages: vec![AgentModelMessage::User("keep existing files".into())],
            max_output_tokens: 6144,
            tools: vec![ModelToolDefinition {
                name: "create_file".into(),
                description: "create".into(),
                input_schema: json!({"type":"object","properties":{"content":{"type":"string","maxLength":100000}}}),
            }],
        };
        let error = ModelError::Response {
            failure: ResponseFailure::InvalidToolCall,
            diagnostics: ResponseDiagnostics {
                failure_stage: Some(ResponseFailureStage::ToolArgumentsJson),
                tool_argument_bytes: 19701,
                argument_json_error: Some(fielora_model::ArgumentJsonError {
                    category: ArgumentJsonCategory::Eof,
                    line: 1,
                    column: 19701,
                }),
                ..Default::default()
            }
            .into(),
        };
        let before = request.clone();
        assert!(apply(&mut request, &error));
        assert!(request.system.contains("19701"));
        assert!(request.system.contains(LARGE_ARGUMENT_MARKER));
        assert_eq!(
            request.tools[0].input_schema["properties"]["content"]["maxLength"],
            3000
        );
        assert_eq!(request.messages, before.messages);
        assert_eq!(request.max_output_tokens, before.max_output_tokens);
        assert!(!apply(&mut request, &error));
        let mut cold = before;
        cold.messages.push(AgentModelMessage::User(
            resume_guidance(
                Some("PROVIDER_INVALID_TOOL_CALL"),
                Some(
                    &json!({"failure_stage":"TOOL_ARGUMENTS_JSON","argument_json_error":{"category":"SYNTAX"},"tool_argument_bytes":19701}),
                ),
            )
            .unwrap(),
        ));
        apply_retained_constraints(&mut cold);
        assert_eq!(
            cold.tools[0].input_schema["properties"]["content"]["maxLength"],
            3000
        );
        assert!(resume_guidance(Some("PROVIDER_OUTPUT_LIMIT"), None).is_none());
    }

    fn parser_event(
        sequence: u64,
        kind: AgentEventKind,
        category: &str,
        bytes: u64,
    ) -> AgentEventView {
        AgentEventView {
            id: fielora_contracts::AgentEventId(format!("event-{sequence}")),
            run_id: AgentRunId("run".into()),
            sequence,
            schema_version: 1,
            kind,
            payload: json!({"kind":"MODEL_RETRY","error_code":"PROVIDER_INVALID_TOOL_CALL",
                "response_diagnostics":{"failure_stage":"TOOL_ARGUMENTS_JSON",
                    "argument_json_error":{"category":category},"tool_argument_bytes":bytes}}),
            created_at: 0,
        }
    }

    #[test]
    fn large_argument_recovery_survives_intervening_actions_empty_history_and_restart() {
        let mut recovery = RetainedRecovery::default();
        let first = parser_event(94, AgentEventKind::CheckpointCreated, "EOF", 18149);
        recovery.observe(&first);
        for sequence in 95..700 {
            // Neither successful model/tool calls nor an arbitrarily old
            // diagnostic in the durable ledger close the generation constraint.
            recovery.observe(&parser_event(
                sequence,
                AgentEventKind::ToolCompleted,
                "EOF",
                20000,
            ));
        }
        let last = parser_event(701, AgentEventKind::ModelFailed, "SYNTAX", 19473);
        recovery.observe(&last);
        let mut cold = RetainedRecovery::default();
        cold.observe(&first);
        cold.observe(&last);
        let original = AgentModelRequest {
            model_id: "unchanged".into(),
            system: "original scope".into(),
            messages: vec![],
            max_output_tokens: 6144,
            tools: vec![ModelToolDefinition {
                name: "apply_patches".into(),
                description: "batch".into(),
                input_schema: json!({"type":"object","properties":{"patches":{"type":"array","items":{"type":"object","properties":{
                    "new_text":{"type":"string","maxLength":2000},"content":{"type":"string"},"expected_sha256":{"type":"string","minLength":64}
                }}}}}),
            }],
        };
        let mut warm_request = original.clone();
        recovery.apply(&mut warm_request);
        let mut cold_request = original.clone();
        cold.apply(&mut cold_request);
        let same_request = |left: &AgentModelRequest, right: &AgentModelRequest| {
            assert_eq!(left.model_id, right.model_id);
            assert_eq!(left.system, right.system);
            assert_eq!(left.messages, right.messages);
            assert_eq!(left.tools, right.tools);
            assert_eq!(left.max_output_tokens, right.max_output_tokens);
        };
        same_request(&warm_request, &cold_request);
        assert_eq!(cold.large_argument_source_sequence, Some(701));
        let properties =
            &cold_request.tools[0].input_schema["properties"]["patches"]["items"]["properties"];
        assert_eq!(properties["new_text"]["maxLength"], 2000);
        assert_eq!(properties["content"]["maxLength"], 3000);
        assert_eq!(
            properties["expected_sha256"],
            original.tools[0].input_schema["properties"]["patches"]["items"]["properties"]["expected_sha256"]
        );
        assert_eq!(cold_request.messages, original.messages);
        assert_eq!(cold_request.model_id, original.model_id);
        assert_eq!(cold_request.max_output_tokens, original.max_output_tokens);
        cold.apply(&mut cold_request);
        same_request(&cold_request, &warm_request);
        let mut unrelated_run = original.clone();
        RetainedRecovery::default().apply(&mut unrelated_run);
        same_request(&unrelated_run, &original);
    }

    #[test]
    fn retained_size_recovery_requires_trusted_large_json_parse_failure() {
        let valid = parser_event(1, AgentEventKind::ModelFailed, "SYNTAX", 19473);
        let mut cases = vec![
            parser_event(1, AgentEventKind::ModelFailed, "EOF", 8191),
            parser_event(1, AgentEventKind::ModelFailed, "DATA", 19473),
            parser_event(1, AgentEventKind::AssistantNarrative, "EOF", 19473),
        ];
        for (key, value) in [
            ("error_code", "PROVIDER_OUTPUT_LIMIT"),
            ("error_code", "PROVIDER_RATE_LIMITED"),
        ] {
            let mut event = valid.clone();
            event.payload[key] = json!(value);
            cases.push(event);
        }
        let mut wrong_stage = valid.clone();
        wrong_stage.payload["response_diagnostics"]["failure_stage"] = json!("TOOL_CALL_NAME");
        cases.push(wrong_stage);
        for event in cases {
            let mut recovery = RetainedRecovery::default();
            recovery.observe(&event);
            assert_eq!(recovery.large_argument_source_sequence, None);
        }
    }

    #[test]
    fn repair_changes_only_system_feedback_once_not_history_tools_or_budget() {
        let mut request = AgentModelRequest {
            model_id: "any-provider".into(),
            system: "original safety and scope".into(),
            messages: vec![AgentModelMessage::User("original task".into())],
            tools: vec![ModelToolDefinition {
                name: "create_file".into(),
                description: "write a file".into(),
                input_schema: json!({"type":"object"}),
            }],
            max_output_tokens: 4096,
        };
        let before = request.clone();
        let error = ModelError::Response {
            failure: ResponseFailure::InvalidToolCall,
            diagnostics: ResponseDiagnostics {
                failure_stage: Some(ResponseFailureStage::ToolArgumentsJson),
                ..Default::default()
            }
            .into(),
        };
        assert!(apply(&mut request, &error));
        assert!(request.system.contains("could not be parsed as JSON"));
        assert!(
            request
                .system
                .contains("No tool from that rejected response was executed")
        );
        assert!(request.system.starts_with(&before.system));
        assert_eq!(request.messages, before.messages);
        assert_eq!(request.tools, before.tools);
        assert_eq!(request.max_output_tokens, before.max_output_tokens);
        assert_eq!(request.model_id, before.model_id);
        let system = request.system.clone();
        assert!(!apply(&mut request, &error));
        assert_eq!(request.system, system);
        assert!(resume_note(Some("PROVIDER_INVALID_TOOL_CALL")).is_some());
        assert!(resume_note(Some("PROVIDER_OUTPUT_LIMIT")).is_none());
        for failure in [
            ResponseFailure::OutputLimit,
            ResponseFailure::ContentFiltered,
            ResponseFailure::InterruptedStream,
        ] {
            assert!(!apply(
                &mut request,
                &ModelError::Response {
                    failure,
                    diagnostics: Default::default()
                }
            ));
        }
    }
}
