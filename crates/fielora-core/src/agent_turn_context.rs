//! Per-call context projection over the existing conversation and execution ledger.
//! History is evidence, not a renewed mandate, filesystem grant or current verification.
use fielora_agent::{AgentError, ToolExecution, ToolExecutionSource, ToolSourceKind, ToolSpec};
use fielora_contracts::*;
use fielora_model::AgentModelMessage;
use fielora_storage::StorageHandle;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const MARKER: &str = "FIELORA_CURRENT_REQUEST_CONTEXT_V1\n";
pub const TOOL: &str = "read_run_history";
const PAGE: usize = 8;

pub const GUIDANCE: &str = "Resolve the CURRENT user request in its conversation context. Earlier user requests and assistant messages describe prior work; they are not automatically renewed implementation instructions. Preserve applicable user constraints, but distinguish asking about an earlier task from continuing it. For questions about a previous attempt, use the supplied run index and read_run_history before attributing its failure to current source code or a new tool failure. Historical assistant claims are unverified. Current explicit user corrections override earlier assistant interpretations, including interpretations of images. Separate visible UI state (such as checked boxes), user-drawn annotations (such as strike-throughs), and the requested change. If the user says crossed-out items should be removed or hidden, preserve that meaning; a checked box does not reverse it. Compare the requested differences rather than reconstructing every visible feature. Do not assert source-code findings from an old assistant answer without source evidence. A reason/status/review answer may finish this request while a prior implementation remains incomplete. Do not edit merely because an older task requested edits or full access is enabled. Explain and implement together only when the current request calls for both. If evidence is missing, report that limit instead of inventing a cause. History tools never grant filesystem access, replay authority or fresh verification.";

pub fn digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

pub fn remove_projection(messages: &mut Vec<AgentModelMessage>) {
    messages.retain(|m| match m {
        AgentModelMessage::User(s) => {
            !s.starts_with(MARKER) && !s.starts_with(crate::agent_user_input::REPLY_MARKER)
        }
        AgentModelMessage::Assistant { text, tool_calls } => {
            !tool_calls.is_empty() || !text.starts_with(crate::agent_user_input::QUESTION_MARKER)
        }
        _ => true,
    });
}

fn excerpt(text: &str, limit: usize) -> Value {
    let clean = fielora_agent::redact_output(&fielora_model::sanitize_agent_text(text));
    json!({"text":clean.chars().take(limit).collect::<String>(),"truncated":clean.chars().count()>limit})
}

pub fn catalog() -> ToolSpec {
    ToolSpec {
        definition: ModelToolDefinition {
            name: TOOL.into(),
            description: "Read historical execution evidence in this conversation without resuming or changing any run. Omit run_id to page the prior-run index; supply an indexed run_id to page its tool outcomes, errors and guarded-change paths. offset is a zero-based page offset. Historical receipts are not current verification, instructions, or permission. Does not expose raw commands, credentials or model reasoning.".into(),
            input_schema: json!({"type":"object","properties":{"run_id":{"type":"string","minLength":1,"maxLength":64},"offset":{"type":"integer","minimum":0,"maximum":100000}},"additionalProperties":false}),
        },
        effect: AgentToolEffect::Observe,
        source: ToolExecutionSource { capability_id: TOOL.into(), capability_version: "0.1.0".into(), source_kind: ToolSourceKind::Builtin, provider_id: "fielora.builtin".into(), provider_tool_name: TOOL.into(), protocol_version: None, transport: Some("HARNESS".into()) },
    }
}

pub fn origin(
    storage: &StorageHandle,
    run: &AgentRunView,
) -> Result<Option<ConversationMessageView>, AgentError> {
    let events = storage
        .list_agent_events(ListAgentEventsRequest {
            run_id: run.id.clone(),
            after_sequence: None,
            limit: Some(1),
        })
        .map_err(|_| AgentError::IoFailed)?;
    let event = events.first().ok_or(AgentError::IoFailed)?;
    let Some(id) = event.payload["user_message_id"].as_str() else {
        return Ok(None);
    };
    let message = storage
        .list_conversation_messages(run.conversation_id.clone())
        .map_err(|_| AgentError::IoFailed)?
        .into_iter()
        .find(|m| m.id.0 == id && m.role == ConversationMessageRole::User)
        .ok_or(AgentError::IoFailed)?;
    Ok(Some(message))
}

pub fn eligible(
    current: &AgentRunView,
    candidate: &AgentRunView,
    origin: Option<&ConversationMessageView>,
) -> bool {
    candidate.id != current.id
        && candidate.field_id == current.field_id
        && candidate.conversation_id == current.conversation_id
        && (candidate.created_at, &candidate.id.0) < (current.created_at, &current.id.0)
        && origin.is_none_or(|m| (candidate.created_at, &candidate.id.0) < (m.created_at, &m.id.0))
}

fn prior_runs(
    storage: &StorageHandle,
    current: &AgentRunView,
) -> Result<Vec<AgentRunView>, AgentError> {
    let origin = origin(storage, current)?;
    let mut runs = storage
        .list_agent_runs(current.conversation_id.clone())
        .map_err(|_| AgentError::IoFailed)?;
    runs.retain(|r| eligible(current, r, origin.as_ref()));
    runs.sort_by(|a, b| (b.created_at, &b.id.0).cmp(&(a.created_at, &a.id.0)));
    Ok(runs)
}

fn run_summary(run: &AgentRunView) -> Value {
    json!({"run_id":run.id,"original_request":excerpt(&run.task,400),"status":run.status,
        "error_code":run.error_code,"created_at":run.created_at,"updated_at":run.updated_at,
        "model_id":run.model_id,"historical_only":true})
}

pub struct TurnContext {
    pub origin: Option<ConversationMessageView>,
    pub history: Vec<ConversationMessageView>,
    pub index: Value,
    pub omitted_messages: usize,
}

impl TurnContext {
    pub fn load(storage: &StorageHandle, current: &AgentRunView) -> Result<Self, AgentError> {
        let origin = origin(storage, current)?;
        let mut history = storage
            .list_conversation_messages(current.conversation_id.clone())
            .map_err(|_| AgentError::IoFailed)?;
        history.retain(|m| {
            m.status == ConversationMessageStatus::Completed
                && match &origin {
                    Some(o) => (m.created_at, &m.id.0) < (o.created_at, &o.id.0),
                    None => m.created_at < current.created_at,
                }
        });
        let omitted_messages = history.len().saturating_sub(12);
        history.drain(..omitted_messages);
        let runs = prior_runs(storage, current)?;
        let index = json!({"runs":runs.iter().take(PAGE).map(run_summary).collect::<Vec<_>>(),"total":runs.len(),"next_offset":(runs.len()>PAGE).then_some(PAGE)});
        Ok(Self {
            origin,
            history,
            index,
            omitted_messages,
        })
    }

    pub fn refresh(
        &self,
        messages: &mut Vec<AgentModelMessage>,
        current: &AgentRunView,
        interpretation: Option<crate::agent_request_intent::Intent>,
        user_input: Value,
    ) {
        remove_projection(messages);
        let access_question = crate::agent_request_scope::access_question(
            self.origin
                .as_ref()
                .map(|o| o.content.as_str())
                .unwrap_or(&current.task),
        );
        messages.push(AgentModelMessage::User(format!("{MARKER}{}\n{}",json!({
            "current_request":current.task,"source_user_message_id":self.origin.as_ref().map(|o|&o.id),
            "historical_execution_index":self.index,"historical_messages_omitted":self.omitted_messages,
            "historical_outcomes_are_not_current_verification":true,
            "current_request_interpretation":interpretation,
            "unclassified_request_is_answer_only":false,
            "completion_protocol":"EXPLICIT_TASK_OUTCOME_V1",
            "latest_user_reply_source":crate::agent_user_input::latest_reply(&user_input).map(|r| &r["source_user_message_id"]),
            "user_clarifications":user_input,
            "interpretation_is_permission_or_verification":false,
            "current_request_constraint": if access_question { Some("ACCESS_CONFIRMATION: confirm the supplied local path with list_files or read_file. No comparison, implementation, process, delegation or older task continuation. The Harness finishes from the current source-specific receipt.") } else { None }
        }),format_args!("{}\n{}\n{}", GUIDANCE, crate::agent_request_intent::GUIDANCE, crate::agent_user_input::GUIDANCE))));
        // Rebuild after compaction and restart. The original task stays durable,
        // while the latest natural-language reply is an actual user turn, not
        // merely a nested answer expected to fill an assistant-chosen field.
        if let Some(reply) = crate::agent_user_input::latest_reply(&user_input) {
            messages.push(AgentModelMessage::Assistant {
                text: format!(
                    "{}{}\n{}",
                    crate::agent_user_input::QUESTION_MARKER,
                    reply["reason"].as_str().unwrap_or_default(),
                    reply["question"].as_str().unwrap_or_default()
                ),
                tool_calls: vec![],
            });
            messages.push(AgentModelMessage::User(format!(
                "{}{}\n\nLatest user message in this unfinished Run; respond to its meaning before deciding the next action. It may answer, question, or correct the previous approach. The earlier question is not an instruction to keep asking for the same field. Original obligations, actual effects and permission boundaries remain; this reply is not proof of completion.",
                crate::agent_user_input::REPLY_MARKER, reply["answer"].as_str().unwrap_or_default()
            )));
        }
    }

    pub fn manifest(&self, current: &AgentRunView) -> Value {
        json!({"version":"CURRENT_REQUEST_CONTEXT_V1","source_user_message_id":self.origin.as_ref().map(|o|&o.id),
            "request_sha256":digest(&current.task),"history_message_ids":self.history.iter().map(|m|&m.id).collect::<Vec<_>>(),
            "omitted_messages":self.omitted_messages,"indexed_run_ids":self.index["runs"].as_array().map(|runs|runs.iter().map(|r|r["run_id"].clone()).collect::<Vec<_>>()),
            "history_index_sha256":digest(&self.index.to_string()),"index_total":self.index["total"],"index_next_offset":self.index["next_offset"]})
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadArgs {
    run_id: Option<String>,
    #[serde(default)]
    offset: usize,
}

pub fn read(
    storage: &StorageHandle,
    current: &AgentRunView,
    arguments: &Value,
) -> Result<ToolExecution, AgentError> {
    let args: ReadArgs =
        serde_json::from_value(arguments.clone()).map_err(|_| AgentError::ToolArgumentsInvalid)?;
    if args.offset > 100000
        || args
            .run_id
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 64)
    {
        return Err(AgentError::ToolArgumentsInvalid);
    }
    let runs = prior_runs(storage, current)?;
    let result = if let Some(id) = args.run_id {
        let run=runs.iter().find(|r|r.id.0==id).ok_or(AgentError::WorkGuidance {code:"AGENT_HISTORY_SCOPE_DENIED",detail:"Only prior runs of this same Project and Conversation, before this request's original message, may be read. Use the provided history index. No run was resumed or changed.".into()})?;
        let tools = storage
            .list_agent_tool_calls(run.id.clone())
            .map_err(|_| AgentError::IoFailed)?;
        let outcomes=tools.iter().skip(args.offset).take(PAGE).map(|t| {
            let receipt=t.receipt.as_ref();
            json!({"tool_call_id":t.id,"name":t.name,"effect":t.effect,"status":t.status,"error_code":t.error_code,
                "created_at":t.created_at,"updated_at":t.updated_at,
                "path":t.arguments.get("path").and_then(Value::as_str).map(|s|excerpt(s,300)),
                "patch_paths":t.arguments["patches"].as_array().map(|ps|ps.iter().take(16).filter_map(|p|p["path"].as_str()).map(|s|excerpt(s,300)).collect::<Vec<_>>()),
                "receipt_kind":receipt.and_then(|r|r["kind"].as_str()).map(|s|excerpt(s,80)),"success":receipt.and_then(|r|r["success"].as_bool()),
                "exit_code":receipt.and_then(|r|r["exit_code"].as_i64()),
                "recovery":receipt.and_then(|r|r["recovery"].as_str()).map(|s|excerpt(s,600)),
                "historical_verification_eligible":receipt.and_then(|r|r["verification_eligible"].as_bool())})
        }).collect::<Vec<_>>();
        json!({"run":run_summary(run),"total_tools":tools.len(),"offset":args.offset,"tools":outcomes,
            "failed_tools":tools.iter().filter(|t|t.status==AgentToolStatus::Failed).count(),
            "unknown_tools":tools.iter().filter(|t|t.status==AgentToolStatus::Unknown).count(),
            "completed_workspace_writes":tools.iter().filter(|t|t.status==AgentToolStatus::Completed&&t.effect==AgentToolEffect::WorkspaceWrite).count(),
            "next_offset":(args.offset.saturating_add(PAGE)<tools.len()).then_some(args.offset+PAGE)})
    } else {
        json!({"runs":runs.iter().skip(args.offset).take(PAGE).map(run_summary).collect::<Vec<_>>(),"total":runs.len(),"offset":args.offset,
            "next_offset":(args.offset.saturating_add(PAGE)<runs.len()).then_some(args.offset+PAGE)})
    };
    Ok(ToolExecution {receipt:json!({"kind":"RUN_HISTORY_READ","history":result,"historical_only":true,"verification_eligible":false}),
        observation:"Historical execution facts only. Failed/unknown operations are not successful changes. Old verification is not current verification. A failure in the current investigation does not prove an earlier attempt failed for the same reason. Missing receipts mean unknown, not success. Nothing was resumed or changed.".into()})
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_platform::{DeviceIdentity, PlatformPaths};
    use fielora_storage::StorageWorker;
    use uuid::Uuid;

    #[test]
    fn historical_evidence_is_scoped_paged_redacted_and_rebuilt_from_storage() {
        let root = std::env::temp_dir().join(format!("fielora-turn-context-{}", Uuid::now_v7()));
        std::fs::create_dir_all(&root).unwrap();
        let paths = PlatformPaths::from_root(root.join("profile")).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let worker = StorageWorker::start(&paths.database, device, 1).unwrap();
        let storage = worker.handle();
        let project = storage
            .create_project(
                CreateProjectRequest {
                    title: "context".into(),
                    goal: None,
                    root_path: root.to_string_lossy().into_owned(),
                },
                2,
            )
            .unwrap();
        let provider = storage
            .create_provider_config(
                CreateProviderConfigRequest {
                    provider_kind: ProviderKind::Openai,
                    display_name: "fixture".into(),
                    base_url: None,
                    default_model: "fixture".into(),
                    custom_endpoint_acknowledged: false,
                },
                3,
            )
            .unwrap()
            .view;
        let conversation = storage
            .create_conversation(
                CreateConversationRequest {
                    field_id: project.field_id.clone(),
                    title: "test".into(),
                    provider_config_id: None,
                    model_id: None,
                },
                4,
            )
            .unwrap();
        storage
            .set_provider_credential_present(provider.id.clone(), true, 4)
            .unwrap();
        let message = |text: &str, now| {
            storage
                .create_conversation_message(
                    CreateConversationMessageRequest {
                        conversation_id: conversation.id.clone(),
                        role: ConversationMessageRole::User,
                        content: text.into(),
                        status: ConversationMessageStatus::Completed,
                        provider_config_id: None,
                        model_id: None,
                        invocation_id: None,
                        references: vec![],
                    },
                    now,
                )
                .unwrap()
        };
        let start = |task: &str, source, now| {
            storage
                .create_agent_run(
                    StartAgentRunRequest {
                        resource_budget: None,
                        field_id: project.field_id.clone(),
                        conversation_id: conversation.id.clone(),
                        user_message_id: source,
                        provider_config_id: provider.id.clone(),
                        model_id: None,
                        task: task.into(),
                        permission: AgentPermission::FullControl,
                        max_steps: Some(10),
                        attachments: None,
                        active_work_surface: None,
                    },
                    now,
                )
                .unwrap()
                .run
        };
        for i in 0..15 {
            message(&format!("historical instruction {i}"), 5 + i);
        }
        let mut prior = vec![];
        for i in 0..10 {
            prior.push(start("older implementation", None, 30 + i));
        }
        let previous = prior.last().unwrap();
        for i in 0..10 {
            let t = storage
                .create_agent_tool_call(
                    previous.id.clone(),
                    "replace_text".into(),
                    AgentToolEffect::WorkspaceWrite,
                    AgentPolicyDecision::Allow,
                    json!({"path":"settings.js","old_text":"PRIVATE_ARGUMENT_SENTINEL"}),
                    40 + i,
                )
                .unwrap();
            storage
                .update_agent_tool_call(t.id.clone(), AgentToolStatus::Running, None, None, 50 + i)
                .unwrap();
            storage.update_agent_tool_call(t.id,AgentToolStatus::Failed,Some(json!({"kind":"WRITE_ERROR","recovery":"token=PRIVATE_SECRET_SENTINEL","stdout":"PRIVATE_OUTPUT_SENTINEL"})),Some("AGENT_TEXT_MATCH_FAILED".into()),60+i).unwrap();
        }
        let source = message("为什么这次没有改成功", 80);
        // A delayed start must not import later conversation messages or runs.
        let future = start("later request", None, 90);
        message("FUTURE_MESSAGE_SENTINEL", 95);
        let current = start("为什么这次没有改成功", Some(source.id.clone()), 100);
        let context = TurnContext::load(&storage, &current).unwrap();
        assert_eq!(context.origin.as_ref().unwrap().id, source.id);
        assert_eq!(context.history.len(), 12);
        assert_eq!(context.omitted_messages, 3);
        assert!(!context.history.iter().any(|m| m.content.contains("FUTURE")));
        assert_eq!(context.index["total"], 10);
        assert_eq!(context.index["next_offset"], 8);
        assert_eq!(
            read(&storage, &current, &json!({"offset":8}))
                .unwrap()
                .receipt["history"]["runs"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let first = read(&storage, &current, &json!({"run_id":previous.id}))
            .unwrap()
            .receipt;
        assert_eq!(first["history"]["failed_tools"], 10);
        assert_eq!(first["history"]["completed_workspace_writes"], 0);
        assert_eq!(first["history"]["tools"].as_array().unwrap().len(), 8);
        assert_eq!(first["verification_eligible"], false);
        assert!(!first.to_string().contains("PRIVATE_"));
        assert_eq!(
            read(
                &storage,
                &current,
                &json!({"run_id":previous.id,"offset":8})
            )
            .unwrap()
            .receipt["history"]["tools"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        for id in [&current.id, &future.id, &AgentRunId::new("foreign")] {
            assert_eq!(
                read(&storage, &current, &json!({"run_id":id}))
                    .unwrap_err()
                    .code(),
                "AGENT_HISTORY_SCOPE_DENIED"
            );
        }
        for args in [
            json!({"offset":-1}),
            json!({"offset":100001}),
            json!({"project_id":"foreign"}),
        ] {
            assert!(read(&storage, &current, &args).is_err());
        }
        let mut foreign = previous.clone();
        foreign.field_id = FieldId::new("foreign");
        assert!(!eligible(&current, &foreign, Some(&source)));
        foreign = previous.clone();
        foreign.conversation_id = ConversationId::new("foreign");
        assert!(!eligible(&current, &foreign, Some(&source)));
        let mut messages = vec![AgentModelMessage::User("Task:\ncurrent".into())];
        context.refresh(&mut messages, &current, None, json!({}));
        context.refresh(&mut messages, &current, None, json!({}));
        assert_eq!(messages.len(), 2);
        assert!(
            matches!(messages.last(),Some(AgentModelMessage::User(t)) if t.contains("为什么这次没有改成功"))
        );
        remove_projection(&mut messages);
        assert_eq!(messages.len(), 1);
        let reply = json!({"accepted_answers":[{"source_user_message_id":"accepted-reply",
            "question_tool_call_id":"question","question":"请提供来源。","answer":"这个你不可以联网搜索吗"}]});
        for _ in 0..3 {
            context.refresh(&mut messages, &current, None, reply.clone());
            assert_eq!(messages.len(), 4);
            assert!(
                matches!(&messages[2],AgentModelMessage::Assistant {text,tool_calls} if text.starts_with(crate::agent_user_input::QUESTION_MARKER) && tool_calls.is_empty())
            );
            assert!(
                matches!(messages.last(),Some(AgentModelMessage::User(text)) if text.starts_with(crate::agent_user_input::REPLY_MARKER) && text.contains("这个你不可以联网搜索吗"))
            );
        }
        // The ordinary compaction cycle removes generated projections first,
        // reduces old observations, then reprojects the accepted user reply.
        remove_projection(&mut messages);
        for i in 0..4 {
            messages.push(AgentModelMessage::Assistant {
                text: String::new(),
                tool_calls: vec![fielora_model::AgentModelToolCall {
                    id: format!("call-{i}"),
                    name: "read_file".into(),
                    arguments: json!({"path":"file"}),
                }],
            });
            messages.push(AgentModelMessage::ToolResult {
                call_id: format!("call-{i}"),
                name: "read_file".into(),
                content: "old observation ".repeat(1000),
                is_error: false,
            });
        }
        assert!(
            crate::agent_work_state::compact_transcript_to(&mut messages, json!({}), 1000, 3000)
                .is_some()
        );
        context.refresh(&mut messages, &current, None, reply);
        assert!(
            matches!(messages.last(),Some(AgentModelMessage::User(text)) if text.contains("这个你不可以联网搜索吗"))
        );
        assert_eq!(messages.iter().filter(|m| matches!(m,AgentModelMessage::User(s) if s.starts_with(crate::agent_user_input::REPLY_MARKER))).count(),1);
        let manifest = context.manifest(&current);
        assert!(!manifest.to_string().contains("为什么"));
        drop(storage);
        worker.shutdown();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let worker = StorageWorker::start(&paths.database, device, 101).unwrap();
        assert_eq!(
            TurnContext::load(&worker.handle(), &current)
                .unwrap()
                .manifest(&current),
            manifest
        );
        worker.shutdown();
        std::fs::remove_dir_all(root).unwrap();
    }
}
