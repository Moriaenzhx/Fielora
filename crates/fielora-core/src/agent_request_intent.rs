//! Model-owned interpretation of the current request, never execution authority.
use fielora_agent::{AgentError, ToolExecution, ToolExecutionSource, ToolSourceKind, ToolSpec};
use fielora_contracts::{
    AgentRunId, AgentToolCallView, AgentToolEffect, AgentToolStatus, ModelToolDefinition,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const TOOL: &str = "record_request_intent";
pub const GUIDANCE: &str = "Use record_request_intent when the current request asks about actions rather than requesting them, or when completion guidance conflicts with the user's actual request. Cite the current user's wording and distinguish answer_only, action, and workspace_change. Interpret the whole request, including negation, quotation, corrections and mixed clauses. An explanation plus an explicit repair is workspace_change; a question about an earlier repair may be answer_only. This records your interpretation, not authorization or proof. Actual effects and unresolved outcomes still require evidence. Do not perform an unwanted edit to satisfy a lexical hint.";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Intent {
    AnswerOnly,
    Action,
    WorkspaceChange,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Args {
    intent: Intent,
    request_quote: String,
}

pub fn catalog() -> ToolSpec {
    ToolSpec {
        definition: ModelToolDefinition {
            name: TOOL.into(),
            description: GUIDANCE.into(),
            input_schema: json!({"type":"object","properties":{
                "intent":{"type":"string","enum":["answer_only","action","workspace_change"]},
                "request_quote":{"type":"string","minLength":1,"maxLength":2000,"description":"An exact quote from the CURRENT user request supporting the interpretation. Historical assistant text is not user intent."}
            },"required":["intent","request_quote"],"additionalProperties":false}),
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
    run_id: &AgentRunId,
    task: &str,
    arguments: &Value,
) -> Result<ToolExecution, AgentError> {
    let args: Args =
        serde_json::from_value(arguments.clone()).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    let quote = source_quote(task, &args.request_quote);
    let Some(quote) = quote else {
        return Err(AgentError::WorkGuidance { code:"AGENT_CURRENT_REQUEST_QUOTE_REQUIRED", detail:"Quote the current user's actual wording. No intent was recorded; historical text and paraphrases are not valid source quotes.".into() });
    };
    Ok(ToolExecution {
        receipt:json!({"kind":"CURRENT_REQUEST_INTERPRETATION","run_id":run_id,"request_sha256":crate::agent_turn_context::digest(task),"intent":args.intent,"request_quote":quote,"source":"MODEL_INTERPRETATION","verification_eligible":false,"grants_authority":false}),
        observation:"Interpretation recorded for this request only. It is not proof of semantic correctness, authorization, action completion or verification. Answer the current question using evidence; preserve explicit user corrections. Actual action attempts still retain their obligations.".into(),
    })
}

fn source_quote<'a>(task: &'a str, quote: &str) -> Option<&'a str> {
    fn normalized(c: char) -> char {
        match c {
            '“' | '”' => '"',
            '‘' | '’' => '\'',
            _ => c,
        }
    }
    let needle: Vec<_> = quote.chars().map(normalized).collect();
    if quote.trim().is_empty() || needle.len() > 2000 {
        return None;
    }
    let source: Vec<_> = task.char_indices().collect();
    let matched = source.windows(needle.len()).find(|slice| {
        slice
            .iter()
            .map(|(_, c)| normalized(*c))
            .eq(needle.iter().copied())
    })?;
    let (last, last_char) = matched.last()?;
    Some(&task[matched[0].0..last + last_char.len_utf8()])
}

pub fn latest(run_id: &AgentRunId, task: &str, tools: &[AgentToolCallView]) -> Option<Intent> {
    let digest = crate::agent_turn_context::digest(task);
    tools
        .iter()
        .rev()
        .filter(|t| {
            t.run_id == *run_id
                && t.name == TOOL
                && t.effect == AgentToolEffect::Observe
                && t.status == AgentToolStatus::Completed
        })
        .find_map(|t| {
            let r = t.receipt.as_ref()?;
            if r["kind"] != "CURRENT_REQUEST_INTERPRETATION"
                || r["run_id"] != run_id.0
                || r["request_sha256"] != digest
            {
                return None;
            }
            serde_json::from_value(r["intent"].clone()).ok()
        })
}

/// Interpretation refines hints, but cannot erase action attempts in this Run.
pub fn requirements(
    intent: Option<Intent>,
    tools: &[AgentToolCallView],
    action_hint: bool,
    change_hint: bool,
) -> (bool, bool) {
    let (action, change) = match intent {
        Some(Intent::AnswerOnly) => (false, false),
        Some(Intent::Action) => (true, false),
        Some(Intent::WorkspaceChange) => (true, true),
        None => (action_hint, change_hint),
    };
    let attempted_action = tools.iter().any(|t| t.effect != AgentToolEffect::Observe);
    let attempted_write = tools
        .iter()
        .any(|t| t.effect == AgentToolEffect::WorkspaceWrite);
    (action || attempted_action, change || attempted_write)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typographic_quotes_preserve_the_original_source_without_accepting_paraphrases() {
        let task = "请在当前项目里做一个我可以日常使用的“工作室项目与回款管理器”。";
        let result = record(
            &AgentRunId::new("current"),
            task,
            &json!({"intent":"workspace_change","request_quote":task.replace(['“','”'], "\"")}),
        )
        .unwrap();
        assert_eq!(result.receipt["request_quote"], task);
        assert_eq!(result.receipt["grants_authority"], false);
        for quote in [
            task.replace("日常", "每天"),
            task.replace("请在", "不要在"),
            "做一个\"回款管理器\"".into(),
        ] {
            assert!(source_quote(task, &quote).is_none());
        }
    }

    fn tool(task: &str, intent: &str) -> AgentToolCallView {
        let receipt = record(
            &AgentRunId::new("current"),
            task,
            &json!({"intent":intent,"request_quote":task}),
        )
        .unwrap()
        .receipt;
        serde_json::from_value(json!({"id":"interpretation","run_id":"current","name":TOOL,"effect":"OBSERVE","status":"COMPLETED","policy_decision":"ALLOW","arguments":{},"receipt":receipt,"created_at":0,"updated_at":0})).unwrap()
    }

    #[test]
    fn model_can_resolve_quoted_historical_and_negated_action_words_without_granting_authority() {
        for task in [
            "对啊 为什么你之前做的检查不是被红色划线标记（应隐藏/删除）这部分",
            "为什么之前删除了它？",
            "你说修改好了，依据是什么？",
            "Explain why the previous delete failed",
            "不要修改，我在问为什么需要重构",
        ] {
            let tools = [tool(task, "answer_only")];
            let restored: Vec<AgentToolCallView> =
                serde_json::from_value(serde_json::to_value(&tools).unwrap()).unwrap();
            let intent = latest(&AgentRunId::new("current"), task, &restored);
            assert_eq!(intent, Some(Intent::AnswerOnly));
            assert_eq!(requirements(intent, &restored, true, true), (false, false));
            let receipt = restored[0].receipt.as_ref().unwrap();
            assert_eq!(receipt["grants_authority"], false);
            assert_eq!(receipt["verification_eligible"], false);
            assert!(!crate::agent_work_state::has_completed_action(&restored));
        }
    }

    #[test]
    fn foreign_failed_or_changed_request_interpretations_are_not_restored() {
        let task = "为什么删除失败";
        let current = AgentRunId::new("current");
        for mutation in [
            "foreign",
            "digest",
            "status",
            "name",
            "effect",
            "receipt_run",
        ] {
            let mut t = tool(task, "answer_only");
            match mutation {
                "foreign" => t.run_id = AgentRunId::new("older"),
                "digest" => t.receipt.as_mut().unwrap()["request_sha256"] = json!("old"),
                "status" => t.status = AgentToolStatus::Failed,
                "name" => t.name = "read_file".into(),
                "effect" => t.effect = AgentToolEffect::WorkspaceWrite,
                _ => t.receipt.as_mut().unwrap()["run_id"] = json!("older"),
            }
            assert_eq!(latest(&current, task, &[t]), None, "{mutation}");
        }
        assert_eq!(
            latest(&current, "现在删除它", &[tool(task, "answer_only")]),
            None
        );
        for quote in ["", " ", "过去助手说删除完成"] {
            assert!(
                record(
                    &current,
                    task,
                    &json!({"intent":"answer_only","request_quote":quote})
                )
                .is_err()
            );
        }
        assert!(
            record(
                &current,
                task,
                &json!({"intent":"answer_only","request_quote":task,"grant_write":true})
            )
            .is_err()
        );
    }

    #[test]
    fn interpretation_does_not_erase_actual_effects_or_replace_action_evidence() {
        assert_eq!(
            requirements(Some(Intent::WorkspaceChange), &[], false, false),
            (true, true)
        );
        assert_eq!(
            requirements(Some(Intent::Action), &[], false, false),
            (true, false)
        );
        assert_eq!(requirements(None, &[], true, true), (true, true));
        for status in [
            AgentToolStatus::Proposed,
            AgentToolStatus::Completed,
            AgentToolStatus::Failed,
            AgentToolStatus::Unknown,
            AgentToolStatus::Denied,
        ] {
            let mut t = tool("修改它", "answer_only");
            t.name = "replace_text".into();
            t.effect = AgentToolEffect::WorkspaceWrite;
            t.status = status;
            assert_eq!(
                requirements(Some(Intent::AnswerOnly), &[t], false, false),
                (true, true)
            );
        }
    }
}
