//! Isolated fixture consuming the real compiled context and native browser.
use fielora_contracts::AgentToolCallView;
use fielora_model::{
    AgentModelMessage, AgentModelRequest, AgentModelToolCall, AgentModelTurn, ModelError,
};
use serde_json::{Value, json};

pub(crate) fn model(
    request: &AgentModelRequest,
    facts: &[AgentToolCallView],
) -> Result<AgentModelTurn, ModelError> {
    let result = request
        .messages
        .iter()
        .rev()
        .find_map(|message| match message {
            AgentModelMessage::ToolResult { name, content, .. }
                if name == "browser" || name == "browser_server" || name == "browser_verify" =>
            {
                let start = content.find('{')?;
                serde_json::Deserializer::from_str(&content[start..])
                    .into_iter::<Value>()
                    .next()?
                    .ok()
            }
            _ => None,
        })
        .unwrap_or(Value::Null);
    let current = request
        .messages
        .iter()
        .find_map(|message| match message {
            AgentModelMessage::User(text)
                if text.starts_with(crate::agent_work_state::CURRENT_WORK_MARKER) =>
            {
                serde_json::Deserializer::from_str(
                    text.strip_prefix(crate::agent_work_state::CURRENT_WORK_MARKER)?,
                )
                .into_iter::<Value>()
                .next()?
                .ok()
            }
            _ => None,
        })
        .unwrap_or(Value::Null);
    let fallback =
        std::env::var("FIELORA_BROWSER_SCOPE_FALLBACK").is_ok_and(|value| !value.is_empty());
    let finish_after_notes =
        std::env::var("FIELORA_BROWSER_SCOPE_FINISH_AFTER_NOTES").is_ok_and(|value| value == "1");
    let (name, args) = match facts.len() {
        0 => ("capability_status", json!({"filter":{"text":"browser"}})),
        1 => ("browser_server", json!({"action":"serve","directory":"."})),
        2 => (
            "browser_plan",
            json!({"url":result["url"],"cases":[{"id":"resources","requirement":"Rendered local JS, CSS and Markdown inputs are present"}]}),
        ),
        3 => {
            let url = current["browser_cases"]["url"].clone();
            ("browser", json!({"action":"open","url":url}))
        }
        4 => (
            "browser_verify",
            json!({"snapshot_id":result["snapshot_id"],"case_id":"resources","checks":[{"property":"contains","expected":"Local data ready"}]}),
        ),
        5 if fallback => {
            if result.get("verification_scope").is_some() || result["success"] != true {
                return Err(ModelError::ProviderProtocolError);
            }
            (
                "request_user_input",
                json!({"question":"未知依赖保守退回全局检查。","reason":"FIXTURE_STATIC_SCOPE_FALLBACK"}),
            )
        }
        5 => ("read_file", json!({"path":"README.md"})),
        6 => (
            "replace_text",
            json!({"path":"README.md","old_text":"Original notes","new_text":"Updated delivery notes"}),
        ),
        7 if finish_after_notes => {
            if current["browser_cases"]["cases"][0]["state"] != "PASSED" {
                return Err(ModelError::ProviderProtocolError);
            }
            (
                "finish_task",
                json!({"outcome":"completed","intent":"workspace_change",
                    "request_quote":"Update delivery notes without invalidating those inputs",
                    "summary":"Actual rendered resource checks remain current after updating independent delivery notes. Checked scope is limited to the recorded assertions.",
                    "remaining_work":[],
                    "evidence_tool_call_ids":[facts[4].id,facts[6].id],
                    "required_evidence":[{"kind":"browser",
                        "request_quote":"verify local JS, CSS and Markdown rendering",
                        "tool_call_ids":[facts[4].id]}]}),
            )
        }
        7 => {
            if current["browser_cases"]["cases"][0]["state"] != "PASSED" {
                return Err(ModelError::ProviderProtocolError);
            }
            ("read_file", json!({"path":"style.css"}))
        }
        8 => (
            "replace_text",
            json!({"path":"style.css","old_text":"color: green","new_text":"color: blue"}),
        ),
        9 => {
            if current["browser_cases"]["cases"][0]["state"] != "STALE" {
                return Err(ModelError::ProviderProtocolError);
            }
            (
                "request_user_input",
                json!({"question":"实际资源范围与文档独立性已核对。","reason":"FIXTURE_STATIC_SCOPE_VERIFIED"}),
            )
        }
        _ => return Err(ModelError::ProviderProtocolError),
    };
    Ok(AgentModelTurn {
        text: String::new(),
        continuation: None,
        usage: None,
        tool_calls: vec![AgentModelToolCall {
            id: format!("scope-{}", facts.len()),
            name: name.into(),
            arguments: args,
        }],
    })
}
