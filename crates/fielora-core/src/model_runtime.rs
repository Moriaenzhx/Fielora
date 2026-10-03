//! Harness configuration projection and bounded, user-triggered compatibility checks.
use super::*;

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
        .map_err(|_| DomainError::Validation("CREDENTIAL_MISSING".into()))?;
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

/// Snapshot once in the existing Harness event ledger; resume keeps the same policy.
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
    loop {
        let events = storage
            .list_agent_events(ListAgentEventsRequest {
                run_id: run.id.clone(),
                after_sequence: Some(cursor),
                limit: Some(500),
            })
            .map_err(|_| ModelError::ProviderUnavailable)?;
        for event in &events {
            if event.kind == AgentEventKind::CheckpointCreated
                && event.payload["kind"] == "MODEL_RUNTIME_SETTINGS_V1"
            {
                if event.payload["endpoint_fingerprint"] != endpoint_fingerprint
                    || event.payload["model_id"] != run.model_id
                {
                    return Err(ModelError::ConfigurationUnsupported);
                }
                return serde_json::from_value(event.payload["settings"].clone())
                    .map_err(|_| ModelError::ConfigurationUnsupported);
            }
        }
        if events.len() < 500 {
            break;
        }
        cursor = events.last().unwrap().sequence;
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
    let payload = json!({"kind":"MODEL_RUNTIME_SETTINGS_V1","model_id":run.model_id,"endpoint_fingerprint":endpoint_fingerprint,"profile_id":view.profile.profile_id,"settings":view.settings,"effective_parameters":view.effective_parameters,"settings_revision":view.revision,"provider_revision":provider.view.revision});
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
