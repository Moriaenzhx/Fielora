//! Isolated desktop acceptance; reached only by the explicit E2E model route.
use fielora_contracts::AgentToolCallView;
use fielora_model::{
    AgentModelMessage, AgentModelRequest, AgentModelToolCall, AgentModelTurn, ModelError,
};
use serde_json::{Value, json};

pub fn model(
    request: &AgentModelRequest,
    facts: &[AgentToolCallView],
) -> Result<AgentModelTurn, ModelError> {
    let call = |name: &str, arguments: Value| AgentModelTurn {
        continuation: None,
        text: String::new(),
        usage: None,
        tool_calls: vec![AgentModelToolCall {
            id: format!("native-{}", facts.len()),
            name: name.into(),
            arguments,
        }],
    };
    if facts.is_empty() {
        return Ok(call(
            "capability_status",
            json!({"filter":{"text":"computer"}}),
        ));
    }
    let tools: Vec<_> = facts.iter().filter(|t| t.name == "computer").collect();
    let Some(last) = tools.last() else {
        return Ok(call("computer", json!({"action":"status"})));
    };
    let page = request
        .messages
        .iter()
        .rev()
        .find_map(|message| {
            let AgentModelMessage::ToolResult { name, content, .. } = message else {
                return None;
            };
            if name != "computer" {
                return None;
            }
            let line = content
                .strip_prefix("Native desktop receipt: ")?
                .lines()
                .next()?;
            serde_json::from_str::<Value>(line).ok()
        })
        .or_else(|| last.receipt.clone())
        .ok_or(ModelError::ProviderProtocolError)?;
    let target = std::env::var("FIELORA_AGENT_COMPUTER_TARGET")
        .map_err(|_| ModelError::ProviderProtocolError)?;
    let pause = |reason: &str| {
        call(
            "request_user_input",
            json!({"question":"Native acceptance fixture stopped; inspect the recorded evidence.","reason":reason}),
        )
    };
    if facts.last().is_some_and(|tool| {
        tool.name == "request_user_input"
            && tool.arguments["reason"] == "FIXTURE_NATIVE_INPUT_COMPLETE"
    }) {
        return Ok(call(
            "computer",
            json!({"action":"click","app_id":target,"snapshot_id":last.receipt.as_ref().and_then(|receipt| receipt.get("snapshot_id")),"ref":last.arguments["ref"]}),
        ));
    }
    if page["success"] == false
        && page["error_code"] == "COMPUTER_STALE_SNAPSHOT"
        && tools.len() == 10
    {
        return Ok(pause("FIXTURE_NATIVE_STALE_REJECTED"));
    }
    if page["success"] == false {
        return Ok(pause(&format!(
            "FIXTURE_NATIVE_FAILED:{}",
            page["error_code"]
        )));
    }
    if tools.len() == 1 {
        return Ok(call(
            "computer",
            json!({"action":"observe","app_id":target}),
        ));
    }
    // Native content must have travelled through the ordinary model context.
    if !request.messages.iter().any(|m| matches!(m, AgentModelMessage::ToolResult { name, content, .. } if name == "computer" && content.contains("Native desktop receipt"))) {
        return Err(ModelError::ProviderProtocolError);
    }
    if tools.len() == 2 {
        return Ok(call(
            "computer",
            json!({"action":"activate","app_id":target}),
        ));
    }
    let elements = page["elements"]
        .as_array()
        .ok_or(ModelError::ProviderProtocolError)?;
    let label = if tools.len() == 8 {
        "Save test"
    } else {
        "Acceptance text"
    };
    let Some(element) = elements.iter().find(|e| e["label"] == label) else {
        return Ok(pause("FIXTURE_NATIVE_TARGET_NOT_OBSERVED"));
    };
    let mut args = json!({"app_id":target,"snapshot_id":page["snapshot_id"],"ref":element["ref"]});
    match tools.len() {
        3 | 8 => args["action"] = json!("click"),
        4 => {
            args["action"] = json!("type");
            args["text"] = json!("first native text");
        }
        5 => {
            args["action"] = json!("press");
            args["key"] = json!("cmd+a");
        }
        6 => {
            args["action"] = json!("type");
            args["text"] = json!("原生电脑控制验收：这是一段超过二十个字符的中文输入🧭");
        }
        7 => {
            args["action"] = json!("press");
            args["key"] = json!("tab");
        }
        _ => return Ok(pause("FIXTURE_NATIVE_INPUT_COMPLETE")),
    }
    Ok(call("computer", args))
}
