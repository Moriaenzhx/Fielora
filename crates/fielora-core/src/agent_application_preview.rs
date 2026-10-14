//! Local presentation only. Pixels never enter the tool ledger or model context.
use fielora_contracts::{
    AgentRunId, AgentRunStatus, AgentToolCallView, AgentToolStatus, ToolCallId,
};
use fielora_field::DomainError;
use fielora_platform::computer::ComputerTarget;
use fielora_storage::StorageHandle;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub run_id: AgentRunId,
    pub tool_call_id: ToolCallId,
    #[serde(default)]
    pub capture: bool,
}

fn unavailable(code: &str) -> Value {
    json!({"state":"UNAVAILABLE", "error_code":code})
}

fn active(status: AgentRunStatus) -> bool {
    matches!(
        status,
        AgentRunStatus::Running | AgentRunStatus::WaitingApproval
    )
}

fn bound_observation(
    tool: &AgentToolCallView,
    run_id: &AgentRunId,
) -> Option<(String, ComputerTarget)> {
    if tool.run_id != *run_id
        || tool.name != "computer"
        || tool.status != AgentToolStatus::Completed
    {
        return None;
    }
    let receipt = tool.receipt.as_ref()?;
    if receipt["kind"] != "COMPUTER"
        || receipt["success"] != true
        || !matches!(
            receipt["action"].as_str(),
            Some(
                "observe"
                    | "screenshot"
                    | "activate"
                    | "click"
                    | "type"
                    | "press"
                    | "scroll"
                    | "move"
                    | "drag"
            )
        )
    {
        return None;
    }
    let snapshot = receipt["snapshot_id"].as_str()?;
    if uuid::Uuid::parse_str(snapshot).is_err() {
        return None;
    }
    let target = serde_json::from_value(receipt["target"].clone()).ok()?;
    Some((snapshot.into(), target))
}

pub fn query(
    storage: &StorageHandle,
    session: &crate::agent_computer::Session,
    request: Request,
) -> Result<Value, DomainError> {
    if uuid::Uuid::parse_str(&request.run_id.0).is_err()
        || uuid::Uuid::parse_str(&request.tool_call_id.0).is_err()
    {
        return Err(DomainError::Validation(
            "COMPUTER_PREVIEW_INVALID_REQUEST".into(),
        ));
    }
    let run = storage.get_agent_run(request.run_id.clone())?;
    if !active(run.status) {
        return Ok(unavailable("COMPUTER_PREVIEW_RUN_INACTIVE"));
    }
    let tools = storage.list_agent_tool_calls(request.run_id.clone())?;
    let Some(tool) = tools.iter().find(|tool| tool.id == request.tool_call_id) else {
        return Ok(unavailable("COMPUTER_PREVIEW_RECEIPT_UNAVAILABLE"));
    };
    let Some((snapshot, target)) = bound_observation(tool, &request.run_id) else {
        return Ok(unavailable("COMPUTER_PREVIEW_RECEIPT_UNAVAILABLE"));
    };
    let value = crate::agent_computer::preview(
        session,
        &request.run_id.0,
        &snapshot,
        &target,
        request.capture,
    );
    // Capture is asynchronous native work. A stop/pause during it must not
    // publish a late image even though the initiating receipt was valid.
    if !active(storage.get_agent_run(request.run_id)?.status) {
        return Ok(unavailable("COMPUTER_PREVIEW_RUN_INACTIVE"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_contracts::{AgentPolicyDecision, AgentToolEffect};

    #[test]
    fn only_actual_same_run_native_observations_can_bind_a_preview() {
        let run = AgentRunId::new(uuid::Uuid::now_v7().to_string());
        let mut tool = AgentToolCallView {
            id: ToolCallId::new(uuid::Uuid::now_v7().to_string()),
            run_id: run.clone(),
            name: "computer".into(),
            effect: AgentToolEffect::Process,
            status: AgentToolStatus::Completed,
            policy_decision: AgentPolicyDecision::Allow,
            arguments: json!({"action":"observe", "app_id":"forged"}),
            receipt: Some(
                json!({"kind":"COMPUTER", "action":"observe", "success":true,
                "snapshot_id":uuid::Uuid::now_v7().to_string(), "target":{"app_id":"123", "pid":123,
                "name":"Native", "bundle_id":"test.native", "executable":"/native", "launch_identity":"one"}}),
            ),
            error_code: None,
            created_at: 1,
            updated_at: 2,
        };
        assert_eq!(bound_observation(&tool, &run).unwrap().1.app_id, "123");
        assert!(bound_observation(&tool, &AgentRunId::new("other")).is_none());
        for status in [
            AgentToolStatus::Proposed,
            AgentToolStatus::Running,
            AgentToolStatus::Failed,
            AgentToolStatus::Unknown,
        ] {
            tool.status = status;
            assert!(bound_observation(&tool, &run).is_none());
        }
        tool.status = AgentToolStatus::Completed;
        for action in ["status", ""] {
            tool.receipt.as_mut().unwrap()["action"] = json!(action);
            assert!(bound_observation(&tool, &run).is_none());
        }
        tool.receipt.as_mut().unwrap()["action"] = json!("observe");
        tool.receipt.as_mut().unwrap()["success"] = json!(false);
        assert!(bound_observation(&tool, &run).is_none());
        tool.receipt = None;
        assert!(bound_observation(&tool, &run).is_none());
        assert!(!active(AgentRunStatus::Paused));
        assert!(!active(AgentRunStatus::Completed));
        assert!(!active(AgentRunStatus::Cancelled));
        assert!(
            serde_json::from_value::<Request>(
                json!({"run_id":run, "tool_call_id":tool.id, "app_id":"123"})
            )
            .is_err()
        );
    }
}
