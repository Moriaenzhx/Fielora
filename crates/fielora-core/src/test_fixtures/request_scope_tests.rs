use super::*;
use fielora_platform::{DeviceIdentity, PlatformPaths, WindowsCredentialStore};
use fielora_storage::StorageWorker;
use std::sync::mpsc;

#[tokio::test(flavor = "current_thread")]
async fn access_scope_blocks_approved_and_observe_dispatch_bypasses_and_finishes_from_receipt() {
    let root = std::env::temp_dir().join(format!("fielora-access-scope-{}", Uuid::now_v7()));
    let workspace = root.join("target");
    let reference = root.join("reference");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&reference).unwrap();
    std::fs::write(workspace.join("view.js"), "TARGET").unwrap();
    std::fs::write(reference.join("view.js"), "REFERENCE").unwrap();
    let paths = PlatformPaths::from_root(root.join("profile")).unwrap();
    let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
    let worker = StorageWorker::start(&paths.database, device, 1).unwrap();
    let storage = worker.handle();
    let project = storage
        .create_project(
            CreateProjectRequest {
                title: "scope".into(),
                goal: None,
                root_path: workspace.to_string_lossy().into_owned(),
            },
            2,
        )
        .unwrap();
    let provider = storage
        .create_provider_config(
            CreateProviderConfigRequest {
                model_optimization: None,
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
    storage
        .set_provider_credential_present(provider.id.clone(), true, 4)
        .unwrap();
    let conversation = storage
        .create_conversation(
            CreateConversationRequest {
                field_id: project.field_id.clone(),
                title: "scope".into(),
                provider_config_id: None,
                model_id: None,
            },
            5,
        )
        .unwrap();
    let task = format!("`{}` Can you read the project files?", reference.display());
    let message = storage
        .create_conversation_message(
            CreateConversationMessageRequest {
                conversation_id: conversation.id.clone(),
                role: ConversationMessageRole::User,
                content: task.clone(),
                status: ConversationMessageStatus::Completed,
                provider_config_id: None,
                model_id: None,
                invocation_id: None,
                references: vec![],
            },
            6,
        )
        .unwrap();
    let run = storage
        .create_agent_run(
            StartAgentRunRequest {
                resource_budget: None,
                field_id: project.field_id.clone(),
                conversation_id: conversation.id,
                user_message_id: Some(message.id),
                provider_config_id: provider.id,
                model_id: None,
                task,
                permission: AgentPermission::FullControl,
                max_steps: Some(8),
                attachments: None,
                active_work_surface: None,
            },
            7,
        )
        .unwrap()
        .run;
    let run = storage
        .append_agent_event(
            run.id.clone(),
            AgentEventKind::RunStarted,
            json!({}),
            AgentProjectionUpdate {
                status: Some(AgentRunStatus::Running),
                ..Default::default()
            },
            8,
        )
        .unwrap()
        .run;
    let (sender, _receiver) = mpsc::sync_channel(256);
    let coordinator = AgentCoordinator::new(
        storage.clone(),
        Arc::new(WindowsCredentialStore),
        sender,
        root.join("artifacts"),
        Handle::current(),
    );
    let prepared = PreparedRun {
        run,
        endpoint: ProviderEndpoint {
            model_optimization: true,
            kind: ProviderKind::Openai,
            base_url: None,
        },
        project_root: workspace.canonicalize().unwrap(),
        secret: SecretBytes::new(b"fixture".to_vec()),
    };
    let cancellation = ExecutionCancellation {
        model: CancellationToken::new(),
        command: CommandCancellation::default(),
        pause_requested: Arc::new(AtomicBool::new(false)),
    };
    let catalog = coordinator.available_tool_catalog().unwrap();
    for name in [
        "write_file",
        "replace_text",
        "run_command",
        "git_stage",
        "delegate_readonly",
        "work_plan",
    ] {
        let spec = catalog.iter().find(|s| s.definition.name == name).unwrap();
        let proposal = coordinator
            .propose_tool_call(
                &prepared.run,
                spec,
                AgentModelToolCall {
                    id: format!("test-{name}"),
                    name: name.into(),
                    arguments: json!({"path":"view.js","content":"BAD"}),
                },
                false,
            )
            .unwrap();
        assert_eq!(
            proposal.policy_decision,
            AgentPolicyDecision::Deny,
            "{name}"
        );
        // Simulate an old queued ALLOW or approved call. Execution must recheck.
        let mut forged = proposal.clone();
        forged.policy_decision = AgentPolicyDecision::Allow;
        let ToolDisposition::Executed(result) = coordinator
            .execute_tool(&prepared, forged, true, &cancellation)
            .await
        else {
            panic!("scope denial must not request approval");
        };
        assert!(!result.wrote_workspace);
        assert!(matches!(
            result.message,
            AgentModelMessage::ToolResult { is_error: true, .. }
        ));
        let persisted = storage
            .list_agent_tool_calls(prepared.run.id.clone())
            .unwrap();
        let denied = persisted.iter().find(|t| t.id == proposal.id).unwrap();
        assert_eq!(denied.status, AgentToolStatus::Denied);
        assert_eq!(
            denied.error_code.as_deref(),
            Some(crate::agent_request_scope::DENIED)
        );
    }
    let external = storage
        .create_agent_tool_call(
            prepared.run.id.clone(),
            "delegate_readonly".into(),
            AgentToolEffect::Observe,
            AgentPolicyDecision::Allow,
            json!({"task":"modify target"}),
            10,
        )
        .unwrap();
    assert!(matches!(
        coordinator
            .execute_observe_tool(&prepared, external, &cancellation)
            .await
            .unwrap(),
        AgentModelMessage::ToolResult { is_error: true, .. }
    ));
    assert_eq!(
        std::fs::read_to_string(workspace.join("view.js")).unwrap(),
        "TARGET"
    );
    // The target and reference have the same relative filename. Target access
    // must not establish reference access; failed calls must not count either.
    let spec = catalog
        .iter()
        .find(|s| s.definition.name == "read_file")
        .unwrap();
    for path in [
        "view.js".to_owned(),
        reference.join("missing.js").to_string_lossy().into_owned(),
        reference.join("view.js").to_string_lossy().into_owned(),
    ] {
        let tool = coordinator
            .propose_tool_call(
                &prepared.run,
                spec,
                AgentModelToolCall {
                    id: "read".into(),
                    name: "read_file".into(),
                    arguments: json!({"path":path}),
                },
                false,
            )
            .unwrap();
        let _ = coordinator
            .execute_tool(&prepared, tool, false, &cancellation)
            .await;
        let facts = storage
            .list_agent_tool_calls(prepared.run.id.clone())
            .unwrap();
        let accessed = crate::agent_request_scope::accessed_paths(
            std::slice::from_ref(&reference),
            &workspace,
            &facts,
        );
        assert_eq!(
            accessed.len(),
            usize::from(path == reference.join("view.js").to_string_lossy())
        );
    }
    cancellation.request_pause();
    assert!(coordinator.finish_access_question(&prepared, 1, false, &cancellation));
    assert_eq!(
        storage
            .get_agent_run(prepared.run.id.clone())
            .unwrap()
            .status,
        AgentRunStatus::Paused
    );
    storage
        .append_agent_event(
            prepared.run.id.clone(),
            AgentEventKind::RunResumed,
            json!({}),
            AgentProjectionUpdate {
                status: Some(AgentRunStatus::Running),
                ..Default::default()
            },
            now_ms(),
        )
        .unwrap();
    cancellation.pause_requested.store(false, Ordering::SeqCst);
    assert!(coordinator.finish_access_question(&prepared, 1, false, &cancellation));
    assert_eq!(
        storage
            .get_agent_run(prepared.run.id.clone())
            .unwrap()
            .status,
        AgentRunStatus::Completed
    );
    assert_eq!(
        std::fs::read_to_string(reference.join("view.js")).unwrap(),
        "REFERENCE"
    );
    drop(coordinator);
    drop(storage);
    worker.shutdown();
    assert!(root.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(root).unwrap();
}
