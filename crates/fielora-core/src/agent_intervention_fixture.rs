//! Deterministic provider substitute, reachable only through the E2E fixture gate.
use fielora_contracts::{AgentToolCallView, AgentToolStatus};
use fielora_model::{AgentModelMessage, AgentModelRequest, AgentModelToolCall, AgentModelTurn};
use serde_json::json;

pub fn turn(request: &AgentModelRequest, facts: &[AgentToolCallView], step: u32) -> AgentModelTurn {
    // Read the actual model input, not the admission ledger: a missing context
    // projection must result in the wrong file and fail the external assertion.
    let directed = request.messages.iter().any(|message| {
        matches!(message,
        AgentModelMessage::User(text) if text.starts_with(crate::agent_user_input::REPLY_MARKER)
            && text.contains("改为创建 new-direction.txt"))
    });
    let target = if directed {
        "new-direction.txt"
    } else {
        "old-direction.txt"
    };
    let wrote = facts.iter().any(|tool| {
        tool.name == "create_file"
            && tool.status == AgentToolStatus::Completed
            && tool.arguments["path"] == target
    });
    let verified = facts.iter().any(|tool| {
        tool.name == "run_command"
            && tool.status == AgentToolStatus::Completed
            && tool.receipt.as_ref().is_some_and(|r| r["success"] == true)
    });
    let call = if !wrote {
        Some((
            "create_file",
            json!({"path":target,"content":"verified direction\n"}),
        ))
    } else if !verified {
        Some((
            "run_command",
            json!({"program":"node","argv":["verify-direction.cjs",target],"timeout_ms":30000}),
        ))
    } else {
        None
    };
    AgentModelTurn {
        continuation: None,
        text: if call.is_some() {
            format!("正在处理 {target}。")
        } else {
            format!("已创建 {target}，并运行文件内容检查。")
        },
        tool_calls: call
            .map(|(name, arguments)| {
                vec![AgentModelToolCall {
                    id: format!("intervention-{step}"),
                    name: name.into(),
                    arguments,
                }]
            })
            .unwrap_or_default(),
        usage: None,
    }
}
