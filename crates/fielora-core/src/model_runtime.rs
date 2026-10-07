//! Harness configuration projection and bounded, user-triggered compatibility checks.
use super::*;

pub fn prepare_send(
    runtime: &Runtime,
    params: PrepareProviderSendRequest,
) -> Result<(), DomainError> {
    let record = runtime
        .storage
        .get_provider_config(params.provider_config_id)?;
    if record.view.lifecycle_status != ProviderLifecycle::Active {
        return Err(DomainError::Validation("PROVIDER_DISABLED".into()));
    }
    let model = params
        .model_id
        .as_deref()
        .unwrap_or(&record.view.default_model);
    validate_text("model_id", model, 256)?;
    fielora_model::validate_provider_model(record.view.provider_kind, model)
        .map_err(|error| DomainError::Validation(error.code().into()))?;
    view(&runtime.storage, &record.view, model)?;
    // Existence metadata is insufficient: legacy entries may require interaction.
    // The same store used by start/resume performs only non-interactive migration.
    let _secret = runtime
        .credentials
        .read(&record.credential_ref)
        .map_err(|error| DomainError::Validation(error.user_code().into()))?;
    Ok(())
}

pub fn endpoint(provider: &ProviderConfigView) -> ProviderEndpoint {
    ProviderEndpoint {
        model_optimization: provider.model_optimization,
        kind: provider.provider_kind,
        base_url: provider.base_url.clone(),
    }
}
pub fn view(
    storage: &StorageHandle,
    provider: &ProviderConfigView,
    model: &str,
) -> Result<ModelRuntimeView, DomainError> {
    let endpoint = endpoint(provider);
    let stored = storage.model_runtime(
        provider.id.clone(),
        fielora_model::endpoint_identity(&endpoint),
        model.into(),
    )?;
    let effective_parameters =
        fielora_model::effective_parameters(&endpoint, model, &stored.settings)
            .map_err(|e| DomainError::Validation(e.code().into()))?;
    Ok(ModelRuntimeView {
        profile: fielora_model::resolve_profile(&endpoint, model),
        settings: stored.settings,
        revision: stored.revision,
        effective_parameters,
        validation: stored.validation.filter(|v| {
            v.profile_id == fielora_model::resolve_profile(&endpoint, model).profile_id
        }),
    })
}

pub fn start_validation(
    runtime: &mut Runtime,
    params: ProviderConfigRequest,
) -> Result<StartModelInvocationResult, DomainError> {
    let record = runtime
        .storage
        .get_provider_config(params.provider_config_id)?;
    if record.view.lifecycle_status != ProviderLifecycle::Active {
        return Err(DomainError::Validation("PROVIDER_DISABLED".into()));
    }
    let settings = view(&runtime.storage, &record.view, &record.view.default_model)?;
    let secret = runtime
        .credentials
        .read(&record.credential_ref)
        .map_err(|error| DomainError::Validation(error.user_code().into()))?;
    let id = ModelInvocationId::new(Uuid::now_v7().to_string());
    let cancellation = CancellationToken::new();
    let validation_key = format!("compatibility:{}", record.view.id.0);
    {
        let mut active = runtime.cancellations.lock().unwrap();
        if active.contains_key(&validation_key) {
            return Err(DomainError::Validation("MODEL_VALIDATION_RUNNING".into()));
        }
        active.insert(validation_key.clone(), cancellation.clone());
        active.insert(id.0.clone(), cancellation.clone());
    }
    let cancellations = runtime.cancellations.clone();
    let storage = runtime.storage.clone();
    let sender = runtime.event_sender.clone();
    let invocation_id = id.clone();
    runtime
        .async_runtime
        .as_ref()
        .expect("model runtime")
        .spawn(async move {
            let mut report = ModelCompatibilityReport {
                profile_id: settings.profile.profile_id.clone(),
                checks: [
                    "TEXT_STREAM",
                    "TOOL_CALL",
                    "ERROR_CORRECTION",
                    "TOOL_CONTINUATION",
                ]
                .into_iter()
                .map(|name| ModelCompatibilityCheck {
                    name: name.into(),
                    status: ModelCheckStatus::NotTested,
                    detail: "NOT_RUN".into(),
                })
                .collect(),
                settings: settings.settings.clone(),
                provider_revision: record.view.revision,
                checked_at: now_ms(),
            };
            let ep = endpoint(&record.view);
            // Four calls maximum, each capped at 1024 output tokens, 90 seconds for the entire check.
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(90),
                validate(
                    &ep,
                    &record.view.default_model,
                    &settings.settings,
                    secret.expose(),
                    cancellation.clone(),
                    &mut report,
                ),
            )
            .await;
            let error = match result {
                Ok(Ok(())) => None,
                Ok(Err(e)) => Some(e),
                Err(_) => Some(ModelError::ProviderUnavailable),
            };
            if let Some(error) = &error
                && let Some(check) = report
                    .checks
                    .iter_mut()
                    .find(|c| c.status == ModelCheckStatus::NotTested)
            {
                check.status = if *error == ModelError::InvocationCancelled {
                    ModelCheckStatus::Cancelled
                } else {
                    ModelCheckStatus::Failed
                };
                check.detail = error.code().into();
            }
            let saved = storage.save_model_validation(
                record.view.id,
                fielora_model::endpoint_identity(&ep),
                record.view.default_model,
                settings.revision,
                report,
            );
            let (kind, code) = if saved.is_err() {
                (
                    ModelInvocationEventKind::Failed,
                    Some("MODEL_VALIDATION_STALE"),
                )
            } else if let Some(e) = &error {
                (
                    if *e == ModelError::InvocationCancelled {
                        ModelInvocationEventKind::Cancelled
                    } else {
                        ModelInvocationEventKind::Failed
                    },
                    Some(e.code()),
                )
            } else {
                (ModelInvocationEventKind::Completed, None)
            };
            send_terminal(&sender, &id, kind, code);
            let mut active = cancellations.lock().unwrap();
            active.remove(&id.0);
            active.remove(&validation_key);
        });
    Ok(StartModelInvocationResult {
        invocation_id,
        context_package_id: ContextPackageId::new(Uuid::now_v7().to_string()),
    })
}

/// Pin settings within an execution segment; explicit resume adopts saved settings.
pub fn settings_for_run(
    storage: &StorageHandle,
    sender: &SyncSender<Value>,
    run: &AgentRunView,
    endpoint: &ProviderEndpoint,
) -> Result<ModelRuntimeSettings, ModelError> {
    let endpoint_fingerprint = format!(
        "{:x}",
        Sha256::digest(fielora_model::endpoint_identity(endpoint).as_bytes())
    );
    let mut cursor = 0;
    let mut snapshot = RuntimeSnapshot::default();
    loop {
        let events = storage
            .list_agent_events(ListAgentEventsRequest {
                run_id: run.id.clone(),
                after_sequence: Some(cursor),
                limit: Some(500),
            })
            .map_err(|_| ModelError::ProviderUnavailable)?;
        for event in &events {
            snapshot.observe(event.kind, event.sequence, &event.payload);
        }
        if events.len() < 500 {
            break;
        }
        cursor = events.last().unwrap().sequence;
    }
    if let Some(settings) = snapshot.settings(&endpoint_fingerprint, &run.model_id)? {
        return Ok(settings);
    }
    let provider = storage
        .get_provider_config(run.provider_config_id.clone())
        .map_err(|_| ModelError::ProviderUnavailable)?;
    if fielora_model::endpoint_identity(&self::endpoint(&provider.view))
        != fielora_model::endpoint_identity(endpoint)
    {
        return Err(ModelError::ConfigurationUnsupported);
    }
    let view = view(storage, &provider.view, &run.model_id)
        .map_err(|_| ModelError::ConfigurationUnsupported)?;
    // The values below are an allowlist of non-secret parameters, never a raw request.
    let payload = json!({"kind":"MODEL_RUNTIME_SETTINGS_V1","model_id":run.model_id,"endpoint_fingerprint":endpoint_fingerprint,"profile_id":view.profile.profile_id,"settings":view.settings,"effective_parameters":view.effective_parameters,"settings_revision":view.revision,"provider_revision":provider.view.revision,"resume_sequence":snapshot.resume_sequence});
    crate::agent_runtime::append_event(
        storage,
        sender,
        run.id.clone(),
        AgentEventKind::CheckpointCreated,
        payload,
        fielora_storage::AgentProjectionUpdate::default(),
    )
    .map_err(|_| ModelError::ProviderUnavailable)?;
    Ok(view.settings)
}

#[derive(Default)]
struct RuntimeSnapshot {
    resume_sequence: u64,
    latest: Option<(u64, Value)>,
}
impl RuntimeSnapshot {
    fn observe(&mut self, kind: AgentEventKind, sequence: u64, payload: &Value) {
        if kind == AgentEventKind::RunResumed
            && payload["reason"] == "USER_RESUME"
            && payload["restored_state"] != "WAITING_APPROVAL"
        {
            self.resume_sequence = sequence;
        }
        if kind == AgentEventKind::CheckpointCreated
            && payload["kind"] == "MODEL_RUNTIME_SETTINGS_V1"
        {
            self.latest = Some((sequence, payload.clone()));
        }
    }
    fn settings(
        &self,
        endpoint: &str,
        model: &str,
    ) -> Result<Option<ModelRuntimeSettings>, ModelError> {
        let Some((sequence, payload)) = &self.latest else {
            return Ok(None);
        };
        // Resume may change reasoning, never silently change the connection identity.
        if payload["endpoint_fingerprint"] != endpoint || payload["model_id"] != model {
            return Err(ModelError::ConfigurationUnsupported);
        }
        if *sequence < self.resume_sequence {
            return Ok(None);
        }
        serde_json::from_value(payload["settings"].clone())
            .map(Some)
            .map_err(|_| ModelError::ConfigurationUnsupported)
    }
}

async fn validate(
    endpoint: &ProviderEndpoint,
    model: &str,
    settings: &ModelRuntimeSettings,
    secret: &[u8],
    cancel: CancellationToken,
    report: &mut ModelCompatibilityReport,
) -> Result<(), ModelError> {
    ModelClient::new()?
        .with_settings(settings.clone())
        .check_compatibility(
            endpoint,
            model,
            secret,
            cancel,
            report,
            &format!("FIELORA_{}", Uuid::now_v7().simple()),
        )
        .await
}

#[cfg(test)]
mod resume_settings_tests {
    use super::*;
    fn pinned(reasoning: &str) -> Value {
        json!({"kind":"MODEL_RUNTIME_SETTINGS_V1","endpoint_fingerprint":"ep","model_id":"model",
            "settings":{"reasoning":reasoning,"max_output_tokens":4096}})
    }
    #[test]
    fn only_explicit_resume_refreshes_saved_settings_and_latest_snapshot_wins() {
        let mut s = RuntimeSnapshot::default();
        s.observe(AgentEventKind::CheckpointCreated, 1, &pinned("OFF"));
        assert_eq!(
            s.settings("ep", "model").unwrap().unwrap().reasoning,
            ReasoningMode::Off
        );
        s.observe(
            AgentEventKind::RunResumed,
            2,
            &json!({"reason":"APPROVAL_RESOLVED"}),
        );
        assert!(s.settings("ep", "model").unwrap().is_some());
        s.observe(
            AgentEventKind::RunResumed,
            3,
            &json!({"reason":"USER_RESUME","restored_state":"WAITING_APPROVAL"}),
        );
        assert!(s.settings("ep", "model").unwrap().is_some());
        s.observe(
            AgentEventKind::RunResumed,
            4,
            &json!({"reason":"USER_RESUME"}),
        );
        assert!(s.settings("ep", "model").unwrap().is_none());
        s.observe(AgentEventKind::CheckpointCreated, 5, &pinned("ON"));
        assert_eq!(
            s.settings("ep", "model").unwrap().unwrap().reasoning,
            ReasoningMode::On
        );
    }
    #[test]
    fn resume_does_not_allow_connection_identity_drift() {
        let mut s = RuntimeSnapshot::default();
        s.observe(AgentEventKind::CheckpointCreated, 1, &pinned("OFF"));
        s.observe(
            AgentEventKind::RunResumed,
            2,
            &json!({"reason":"USER_RESUME"}),
        );
        assert!(s.settings("other", "model").is_err());
        assert!(s.settings("ep", "other").is_err());
    }
}
