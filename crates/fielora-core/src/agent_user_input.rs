//! Explicit clarification over existing Run/ToolCall/Conversation persistence.
use fielora_agent::{AgentError, ToolExecution, ToolExecutionSource, ToolSourceKind, ToolSpec};
use fielora_contracts::*;
use fielora_field::DomainError;
use fielora_storage::StorageHandle;
use serde::Deserialize;
use serde_json::{Value, json};

pub const TOOL: &str = "request_user_input";
pub const REQUIRED: &str = "AGENT_USER_INPUT_REQUIRED";
pub const GUIDANCE: &str = "When a required source, preference or fact is missing and cannot be established using the actual tools, call request_user_input with one concise, self-contained question. First address the latest user's message: it may be a counterquestion or correction, not the field value you expected. Inspect the actual capability catalog when capability is in question; do not confuse missing search tools with permission denial or claim all network access is impossible. If the blocker remains, use reason to explain the concrete limitation and why user input is still needed. Repeating the latest answered question requires this explanation. This visibly pauses the SAME unfinished task; do not pretend an installation succeeded or keep guessing repository URLs. Do not ask for secrets. Tool IDs are not OS commands. A source must come from the user or an actual observation, never an invented project namespace. A registered tool is not proof of authentication or successful execution.";

pub const QUESTION_MARKER: &str = "FIELORA_PREVIOUS_CLARIFICATION_QUESTION_V1\n";
pub const REPLY_MARKER: &str = "FIELORA_LATEST_USER_REPLY_V1\n";

pub fn catalog() -> ToolSpec {
    ToolSpec {
        definition: ModelToolDefinition {
            name: TOOL.into(),
            description: GUIDANCE.into(),
            input_schema: json!({"type":"object","properties":{"question":{"type":"string","minLength":1,"maxLength":2000},"reason":{"type":"string","minLength":1,"maxLength":2000,"description":"Address the user's latest reply and explain the remaining concrete blocker; required when re-asking the latest answered question. Shown to the user before the question."}},"required":["question"],"additionalProperties":false}),
        },
        effect: AgentToolEffect::Observe,
        source: ToolExecutionSource {
            capability_id: TOOL.into(),
            capability_version: "0.1.0".into(),
            source_kind: ToolSourceKind::Builtin,
            provider_id: "fielora.builtin".into(),
            provider_tool_name: TOOL.into(),
            protocol_version: None,
            transport: Some("HARNESS".into()),
        },
    }
}

pub fn record(
    storage: &StorageHandle,
    run: &AgentRunView,
    arguments: &Value,
) -> Result<ToolExecution, AgentError> {
    let input = context(storage, run).map_err(|_| AgentError::IoFailed)?;
    record_with_context(run, arguments, &input)
}

fn record_with_context(
    run: &AgentRunView,
    arguments: &Value,
    input: &Value,
) -> Result<ToolExecution, AgentError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {
        question: String,
        reason: Option<String>,
    }
    let args: Args =
        serde_json::from_value(arguments.clone()).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    let question =
        fielora_agent::redact_output(&fielora_model::sanitize_agent_text(&args.question));
    if question.trim().is_empty() || question.chars().count() > 2000 {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let reason = args.reason.map(|text| {
        fielora_agent::redact_output(&fielora_model::sanitize_agent_text(&text))
            .trim()
            .to_owned()
    });
    if reason
        .as_ref()
        .is_some_and(|s| s.is_empty() || s.chars().count() > 2000)
    {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let latest = latest_reply(input);
    let repeated = latest
        .and_then(|r| r["question"].as_str())
        .is_some_and(|previous| same_question(previous, &question));
    if repeated && reason.as_ref().is_none_or(|s| same_question(s, &question)) {
        return Err(AgentError::WorkGuidance {
            code: "AGENT_CLARIFICATION_REPEATED",
            detail: "The user already replied to this question. No new question was displayed and this Run is not waiting for input. Reconsider the latest user message and actual capabilities. Answer the counterquestion or use an available tool; if input is still necessary, call request_user_input with a reason explaining the concrete remaining blocker. Do not infer installation success or fabricate a source.".into(),
        });
    }
    Ok(ToolExecution { receipt:json!({"kind":"USER_INPUT_REQUEST","run_id":run.id,"question":question.trim(),"reason":reason,"responding_to_user_message_id":latest.map(|r| &r["source_user_message_id"]),"repeated_question":repeated,"verification_eligible":false,"task_complete":false}), observation:"The Harness will display this question and pause this unfinished Run. Wait for the user's explicitly submitted answer. Do not execute additional actions, infer an answer from elapsed time, or claim completion.".into() })
}

fn same_question(left: &str, right: &str) -> bool {
    left.split_whitespace().eq(right.split_whitespace())
}

pub fn latest_reply(input: &Value) -> Option<&Value> {
    input["accepted_answers"].as_array()?.last()
}

/// Identity and hashes only: do not duplicate reply bodies in telemetry.
pub fn manifest(input: &Value) -> Value {
    json!({"version":"USER_REPLY_CONTEXT_V1","older_answers_omitted":input["older_answers_omitted"],
        "replies":input["accepted_answers"].as_array().into_iter().flatten().map(|r| json!({
            "source_user_message_id":r["source_user_message_id"],"question_tool_call_id":r["question_tool_call_id"],
            "reply_sha256":crate::agent_turn_context::digest(r["answer"].as_str().unwrap_or_default()),
            "question_sha256":crate::agent_turn_context::digest(r["question"].as_str().unwrap_or_default())
        })).collect::<Vec<_>>()})
}

pub fn receipts(storage: &StorageHandle, run: &AgentRunView) -> Result<Vec<Value>, DomainError> {
    let mut cursor = None;
    let mut answers = Vec::new();
    loop {
        let events = storage.list_agent_events(ListAgentEventsRequest {
            run_id: run.id.clone(),
            after_sequence: cursor,
            limit: Some(500),
        })?;
        for event in &events {
            if event.kind == AgentEventKind::CheckpointCreated
                && event.payload["kind"] == "USER_INPUT_RECEIVED"
            {
                answers.push(event.payload.clone());
            }
        }
        if events.len() < 500 {
            return Ok(answers);
        }
        cursor = events.last().map(|e| e.sequence);
    }
}

pub fn pending(
    storage: &StorageHandle,
    run: &AgentRunView,
) -> Result<Option<AgentToolCallView>, DomainError> {
    let answers = receipts(storage, run)?;
    Ok(storage
        .list_agent_tool_calls(run.id.clone())?
        .into_iter()
        .rev()
        .find(|t| {
            t.name == TOOL
                && t.status == AgentToolStatus::Completed
                && t.receipt
                    .as_ref()
                    .is_some_and(|r| r["kind"] == "USER_INPUT_REQUEST" && r["run_id"] == run.id.0)
                && !answers.iter().any(|a| a["question_tool_call_id"] == t.id.0)
        }))
}

pub fn accept(
    storage: &StorageHandle,
    run: &AgentRunView,
    id: &MessageId,
) -> Result<Value, DomainError> {
    let existing = receipts(storage, run)?;
    let question = pending(storage, run)?;
    if question.is_none() {
        // Retry after an acknowledgement persisted but before resume completed.
        if run.error_code.as_deref() == Some(REQUIRED)
            && let Some(receipt) = existing.last().filter(|r| r["user_message_id"] == id.0)
        {
            return Ok(receipt.clone());
        }
        return Err(DomainError::Validation(
            "AGENT_USER_INPUT_NOT_REQUESTED".into(),
        ));
    }
    let question = question.unwrap();
    let answer = storage
        .list_conversation_messages(run.conversation_id.clone())?
        .into_iter()
        .find(|m| {
            m.id == *id
                && m.role == ConversationMessageRole::User
                && m.status == ConversationMessageStatus::Completed
                && m.created_at >= question.updated_at
                && !m.content.trim().is_empty()
                && m.content.chars().count() <= 32000
                && !existing.iter().any(|r| r["user_message_id"] == m.id.0)
        })
        .ok_or_else(|| DomainError::Validation("AGENT_USER_INPUT_INVALID".into()))?;
    Ok(
        json!({"kind":"USER_INPUT_RECEIVED","question_tool_call_id":question.id,"user_message_id":answer.id,"source":"EXPLICIT_USER_RESUME","task_complete":false,"verification_eligible":false}),
    )
}

pub fn context(storage: &StorageHandle, run: &AgentRunView) -> Result<Value, DomainError> {
    let accepted = receipts(storage, run)?;
    let messages = storage.list_conversation_messages(run.conversation_id.clone())?;
    let tools = storage.list_agent_tool_calls(run.id.clone())?;
    let pairs=accepted.iter().rev().take(8).rev().filter_map(|r| {
        let message=messages.iter().find(|m|r["user_message_id"]==m.id.0 && m.role==ConversationMessageRole::User && m.status==ConversationMessageStatus::Completed)?;
        let question=tools.iter().find(|t|r["question_tool_call_id"]==t.id.0 && t.name==TOOL)?.receipt.as_ref()?;
        Some(json!({"source_user_message_id":message.id,"question_tool_call_id":r["question_tool_call_id"],"question":question["question"],"reason":question["reason"],"answer":message.content}))
    }).collect::<Vec<_>>();
    Ok(
        json!({"accepted_answers":pairs,"older_answers_omitted":accepted.len().saturating_sub(8),"authority":"EXPLICIT_USER_CLARIFICATION_NOT_VERIFICATION"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run() -> AgentRunView {
        serde_json::from_value(json!({"id":"run","field_id":"project","conversation_id":"conversation",
            "provider_config_id":"provider","model_id":"fixture","task":"安装 skill","permission":"FULL_CONTROL",
            "status":"RUNNING","current_step":2,"max_steps":20,"next_sequence":8,"created_at":0,"updated_at":1})).unwrap()
    }

    #[test]
    fn repeated_question_needs_explanation_but_does_not_require_a_url_answer() {
        let run = run();
        let input = json!({"accepted_answers":[{"question":"请提供 来源。","answer":"这个你不可以联网搜索吗",
            "source_user_message_id":"reply","question_tool_call_id":"question"}],"older_answers_omitted":0});
        let question = json!({"question":"请提供\n来源。"});
        assert!(record_with_context(&run, &question, &json!({})).is_ok());
        for args in [
            question,
            json!({"question":"请提供 来源。","reason":"请提供 来源。"}),
        ] {
            assert_eq!(
                record_with_context(&run, &args, &input).unwrap_err().code(),
                "AGENT_CLARIFICATION_REPEATED"
            );
        }
        let receipt = record_with_context(&run, &json!({"question":"请提供 来源。","reason":"已检查实际目录：当前没有搜索服务，仍需链接。"}), &input).unwrap().receipt;
        assert_eq!(receipt["responding_to_user_message_id"], "reply");
        assert_eq!(receipt["repeated_question"], true);
        assert_eq!(receipt["task_complete"], false);
        assert_eq!(receipt["verification_eligible"], false);
        assert!(
            record_with_context(&run, &json!({"question":"要安装到哪个项目？"}), &input).is_ok()
        );
        for reason in ["".to_owned(), "x".repeat(2001)] {
            assert!(
                record_with_context(
                    &run,
                    &json!({"question":"请提供 来源。","reason":reason}),
                    &input
                )
                .is_err()
            );
        }
        let evidence = manifest(&input);
        assert_eq!(evidence["replies"][0]["source_user_message_id"], "reply");
        assert_eq!(
            evidence["replies"][0]["reply_sha256"],
            crate::agent_turn_context::digest("这个你不可以联网搜索吗")
        );
        assert!(!evidence.to_string().contains("联网"));
    }
}
