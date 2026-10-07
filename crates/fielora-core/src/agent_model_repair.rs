//! One bounded retry gets validation feedback, never repaired arguments to execute.
use fielora_model::{AgentModelRequest, ModelError, ResponseFailure, ResponseFailureStage};

const MARKER: &str = "FIELORA_TOOL_CALL_VALIDATION_FEEDBACK";
pub const GUIDANCE: &str = "The previous model response failed tool-call validation. No tool from that rejected response was executed. Previously completed tools and file writes remain valid; do not repeat them. Regenerate only the rejected next action with a complete call ID, an exact available tool name, and one valid JSON object for its arguments. Escape quotes, backslashes and newlines inside JSON strings; do not wrap arguments in Markdown or concatenate multiple JSON objects. For large source writes, use smaller independently valid calls or modules supported by the available tools, preserving the requested functionality. Do not truncate code, guess missing data, or claim that rejected work succeeded. Existing permissions, tool schemas, task scope and output budget are unchanged.";

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
    true
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
    } else if !written("app.py") {
        if always_invalid || !request.system.contains(MARKER) {
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
                        category: fielora_model::ArgumentJsonCategory::Syntax,
                        line: 1,
                        column: 900,
                    }),
                    ..Default::default()
                },
            });
        }
        (
            "create_file",
            json!({"path":"app.py","content":"# Synthetic repaired tool call, not the business application.\nprint('repair verified')\n"}),
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
            },
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
