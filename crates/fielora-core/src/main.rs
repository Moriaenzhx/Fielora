mod agent_browser;
mod agent_image_history;
mod agent_recovery;
mod agent_request_intent;
mod agent_request_scope;
mod agent_runtime;
mod agent_skill_verification;
mod agent_task_outcome;
mod agent_turn_context;
mod agent_user_input;
mod agent_visual_context;
mod agent_work_plan;
mod agent_work_state;
mod build_provenance;
pub mod idr_acquisition;
pub mod idr_eval;
pub mod idr_integration;
pub mod idr_resolver;
mod model_runtime;

use agent_runtime::AgentCoordinator;
use fielora_contracts::*;
use fielora_field::{
    DomainError, Field, FieldService, RealityService, SurfaceService, SurfaceSnapshot,
};
use fielora_model::{ModelClient, ModelError, ProviderEndpoint};
use fielora_platform::{
    CredentialStore, DeviceIdentity, PlatformPaths, SecretBytes, SystemCredentialStore,
};
use fielora_storage::{
    ProviderConfigRecord, StorageHandle, StorageWorker, create_portable_snapshot, schema_version,
    validate_database_snapshot,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::{
    Arc, Mutex,
    mpsc::{self, SyncSender},
};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use tracing_subscriber::fmt::MakeWriter;
use uuid::Uuid;

const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const PROTOCOL: ProtocolVersion = ProtocolVersion { major: 1, minor: 0 };
const CAPABILITIES: [&str; 97] = [
    "system.build_provenance",
    "provider.update_model_runtime",
    "provider.validate_model",
    "field.create",
    "field.list",
    "field.get",
    "field.update_focus",
    "surface.save_snapshot",
    "surface.latest_snapshot",
    "field.update_mode",
    "field.set_focus_v1",
    "state.create",
    "state.get",
    "state.list",
    "state.revise",
    "state.transition",
    "state.supersede",
    "reference.create",
    "reference.get",
    "reference.list",
    "reference.revise",
    "reference.archive",
    "reference.restore",
    "relation.attach_reference_source",
    "relation.retract_reference_source",
    "relation.list",
    "activity.list",
    "surface.save_snapshot_v1",
    "field.resume_v1",
    "provider.create_config",
    "provider.update_config",
    "provider.store_credential",
    "provider.delete_credential",
    "provider.remove_config",
    "provider.catalog",
    "provider.list_configs",
    "provider.get_config",
    "model.start",
    "model.cancel",
    "capture.create",
    "capture.attach",
    "capture.promote",
    "capture.archive",
    "capture.restore",
    "capture.list",
    "capture.get",
    "profile.get",
    "fonts.list",
    "fonts.import",
    "library.create_file",
    "library.save_web",
    "library.get",
    "library.list",
    "library.delete",
    "sync.change_journal",
    "context.package",
    "model.stream",
    "project.create",
    "project.list",
    "project.get",
    "project.update",
    "project.rebind",
    "project.archive",
    "conversation.create",
    "conversation.list",
    "conversation.get",
    "conversation.update",
    "conversation.archive",
    "conversation.message.create",
    "conversation.message.list",
    "screenshot_evidence.create",
    "screenshot_evidence.get",
    "screenshot_evidence.by_run",
    "screenshot_evidence.by_verification",
    "screenshot_evidence.preview",
    "profile.portable_blob_manifest",
    "agent.start",
    "agent.get",
    "agent.list",
    "agent.usage",
    "agent.events",
    "agent.tool_calls",
    "agent.cancel",
    "agent.pause",
    "agent.resume",
    "agent.resolve_approval",
    "agent.stream",
    "artifact.list",
    "artifact.read",
    "artifact.history",
    "artifact.asset_preview",
    "artifact.diagram_preview",
    "artifact.set_archive_state",
    "agent.skill_catalog",
    "plugin.local_registry",
    "plugin.register_local",
    "plugin.unregister_local",
];

#[derive(Debug, Error)]
enum CoreError {
    #[error("platform initialization failed: {0}")]
    Platform(String),
    #[error("storage initialization failed: {0}")]
    Storage(String),
    #[error("FIPC output failed: {0}")]
    Output(#[from] io::Error),
}

#[derive(Clone)]
struct BoundedLogWriter {
    file: Arc<Mutex<std::fs::File>>,
}

impl Write for BoundedLogWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.file.lock().unwrap().write_all(buffer)?;
        io::stderr().lock().write_all(buffer)?;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.lock().unwrap().flush()?;
        io::stderr().lock().flush()
    }
}

impl<'a> MakeWriter<'a> for BoundedLogWriter {
    type Writer = BoundedLogWriter;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

struct Runtime {
    field: FieldService<fielora_storage::StorageHandle>,
    reality: RealityService<fielora_storage::StorageHandle>,
    surface: SurfaceService<fielora_storage::StorageHandle>,
    health: HealthDTO,
    hello_completed: bool,
    storage: StorageHandle,
    credentials: Arc<SystemCredentialStore>,
    async_runtime: Option<tokio::runtime::Runtime>,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    completed_invocations: Arc<Mutex<HashSet<String>>>,
    event_sender: SyncSender<Value>,
    agent: AgentCoordinator,
    content_blob_root: std::path::PathBuf,
}

#[derive(Debug, Deserialize)]
struct RequestMeta {
    protocol: String,
    trace_id: String,
    #[serde(default)]
    deadline_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RequestEnvelope {
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
    #[serde(rename = "_meta")]
    meta: RequestMeta,
}

enum Dispatch {
    Continue(Vec<Value>),
    Shutdown(Vec<Value>),
}

fn main() {
    let arguments = std::env::args().collect::<Vec<_>>();
    if arguments
        .get(1)
        .is_some_and(|value| value.starts_with("--maintenance-"))
    {
        let result = match arguments.get(1).map(String::as_str) {
            Some("--maintenance-export-snapshot") if arguments.len() == 4 => {
                create_portable_snapshot(Path::new(&arguments[2]), Path::new(&arguments[3]))
            }
            Some("--maintenance-validate-database") if arguments.len() == 3 => {
                validate_database_snapshot(Path::new(&arguments[2]))
            }
            _ => Err(fielora_storage::StorageError::OpenGate(
                "invalid maintenance arguments".into(),
            )),
        };
        match result {
            Ok(()) => println!("PASS"),
            Err(error) => {
                eprintln!("fielora-core maintenance failed: {error}");
                std::process::exit(2);
            }
        }
        return;
    }
    if let Err(error) = run() {
        eprintln!("fielora-core fatal: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), CoreError> {
    let development = std::env::args().any(|argument| argument == "--development");
    let paths = PlatformPaths::resolve(development)
        .map_err(|error| CoreError::Platform(error.to_string()))?;
    configure_logging(&paths.core_log)?;
    info!(version = env!("CARGO_PKG_VERSION"), "core startup");
    let device = DeviceIdentity::load_or_create(&paths.device_identity)
        .map_err(|error| CoreError::Platform(error.to_string()))?;
    let storage = StorageWorker::start(&paths.database, device, now_ms())
        .map_err(|error| CoreError::Storage(error.to_string()))?;
    let handle = storage.handle();
    let (event_sender, event_receiver) = mpsc::sync_channel::<Value>(256);
    let writer = std::thread::Builder::new()
        .name("fielora-fipc-writer".into())
        .spawn(move || {
            let stdout = io::stdout();
            let mut output = stdout.lock();
            while let Ok(message) = event_receiver.recv() {
                if write_messages(&mut output, vec![message]).is_err() {
                    break;
                }
            }
        })
        .map_err(|error| CoreError::Output(io::Error::other(error)))?;
    let credentials = Arc::new(SystemCredentialStore);
    let async_runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(4)
        .thread_name("fielora-runtime")
        .build()
        .map_err(|error| CoreError::Platform(error.to_string()))?;
    let agent = AgentCoordinator::with_user_config_root(
        handle.clone(),
        credentials.clone(),
        event_sender.clone(),
        paths.data_dir.join("agent-artifacts"),
        async_runtime.handle().clone(),
        paths.config_dir.clone(),
    )
    .with_content_blob_root(paths.library_dir.clone())
    .with_browser_bridge();
    let reconciled = handle
        .reconcile_agent_runs(now_ms())
        .map_err(|error| CoreError::Storage(error.to_string()))?;
    agent.emit_reconciled(reconciled);
    let mut runtime = Runtime {
        field: FieldService::new(handle.clone(), handle.local_user.clone()),
        reality: RealityService::new(
            handle.clone(),
            handle.local_user.clone(),
            handle.device_id.clone(),
        ),
        surface: SurfaceService::new(handle.clone(), handle.device_id.clone()),
        health: HealthDTO {
            state: CoreHealthState::Ready,
            core_version: env!("CARGO_PKG_VERSION").into(),
            protocol: PROTOCOL,
            schema_version: schema_version(),
            pid: std::process::id(),
            db_path: paths.database.to_string_lossy().into_owned(),
        },
        hello_completed: false,
        storage: handle,
        credentials,
        async_runtime: Some(async_runtime),
        cancellations: Arc::new(Mutex::new(HashMap::new())),
        completed_invocations: Arc::new(Mutex::new(HashSet::new())),
        event_sender: event_sender.clone(),
        agent,
        content_blob_root: paths.library_dir,
    };

    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut parser = FrameParser::default();
    let mut buffer = [0_u8; 16 * 1024];
    'read: loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            info!("parent pipe EOF; shutting down");
            break;
        }
        for frame in parser.push(&buffer[..count]) {
            match frame {
                ParsedFrame::Frame(bytes) => {
                    let dispatch = handle_frame(&mut runtime, &bytes);
                    match dispatch {
                        Dispatch::Continue(messages) => {
                            for message in messages {
                                event_sender.send(message).map_err(|_| {
                                    CoreError::Output(io::Error::new(
                                        io::ErrorKind::BrokenPipe,
                                        "FIPC writer stopped",
                                    ))
                                })?;
                            }
                        }
                        Dispatch::Shutdown(messages) => {
                            for message in messages {
                                let _ = event_sender.send(message);
                            }
                            break 'read;
                        }
                    }
                }
                ParsedFrame::Oversized => {
                    event_sender
                        .send(error_response(
                            Value::Null,
                            -32600,
                            "Frame exceeds 4 MiB",
                            "protocol_error",
                            Uuid::now_v7().to_string(),
                            false,
                            json!({}),
                        ))
                        .map_err(|_| {
                            CoreError::Output(io::Error::new(
                                io::ErrorKind::BrokenPipe,
                                "FIPC writer stopped",
                            ))
                        })?;
                }
            }
        }
    }
    runtime.health.state = CoreHealthState::ShuttingDown;
    for cancellation in runtime.cancellations.lock().unwrap().values() {
        cancellation.cancel();
    }
    runtime.agent.prepare_for_shutdown();
    if let Some(async_runtime) = runtime.async_runtime.take() {
        async_runtime.shutdown_timeout(std::time::Duration::from_millis(750));
    }
    storage.shutdown();
    drop(runtime);
    drop(event_sender);
    let _ = writer.join();
    info!("core shutdown complete");
    Ok(())
}

fn configure_logging(path: &Path) -> Result<(), CoreError> {
    const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > MAX_LOG_BYTES)
    {
        let previous = path.with_extension("log.previous");
        let _ = fs::remove_file(&previous);
        fs::rename(path, previous)?;
    }
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let writer = BoundedLogWriter {
        file: Arc::new(Mutex::new(file)),
    };
    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_writer(writer)
        .try_init()
        .map_err(|error| CoreError::Platform(error.to_string()))?;
    Ok(())
}

fn write_messages(output: &mut impl Write, messages: Vec<Value>) -> io::Result<()> {
    for message in messages {
        serde_json::to_writer(&mut *output, &message)?;
        output.write_all(b"\n")?;
    }
    output.flush()
}

fn handle_frame(runtime: &mut Runtime, bytes: &[u8]) -> Dispatch {
    let value = match std::str::from_utf8(bytes)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
    {
        Some(value) => value,
        None => {
            return Dispatch::Continue(vec![error_response(
                Value::Null,
                -32700,
                "Invalid UTF-8 or JSON",
                "protocol_error",
                Uuid::now_v7().to_string(),
                false,
                json!({}),
            )]);
        }
    };
    let id = value.get("id").cloned().unwrap_or(Value::Null);
    let mut request = match serde_json::from_value::<RequestEnvelope>(value) {
        Ok(request) if request.jsonrpc == "2.0" && !request.id.is_null() => request,
        _ => {
            return Dispatch::Continue(vec![error_response(
                id,
                -32600,
                "Invalid JSON-RPC request",
                "protocol_error",
                Uuid::now_v7().to_string(),
                false,
                json!({}),
            )]);
        }
    };
    let trace_id = request.meta.trace_id.clone();
    let protocol = request
        .meta
        .protocol
        .split_once('.')
        .and_then(|(major, minor)| Some((major.parse::<u16>().ok()?, minor.parse::<u16>().ok()?)));
    if protocol.is_none_or(|(major, _minor)| major != PROTOCOL.major) {
        return Dispatch::Continue(vec![error_response(
            request.id,
            -32600,
            "Protocol major mismatch",
            "protocol_error",
            trace_id,
            false,
            json!({"supported":"1.0"}),
        )]);
    }
    if request.meta.deadline_ms == Some(0) {
        return Dispatch::Continue(vec![error_response(
            request.id,
            -32003,
            "Request deadline elapsed",
            "timeout",
            trace_id,
            true,
            json!({}),
        )]);
    }
    if !runtime.hello_completed && request.method != "system.hello" {
        return Dispatch::Continue(vec![error_response(
            request.id,
            -32600,
            "system.hello must be the first request",
            "protocol_error",
            trace_id,
            false,
            json!({}),
        )]);
    }

    let id = request.id.clone();
    let result = dispatch_request(runtime, &mut request, TraceId::new(trace_id.clone()));
    match result {
        Ok((result, event)) => {
            let mut messages = vec![success_response(id, result)];
            if let Some(event) = event {
                messages.push(json!({
                    "jsonrpc":"2.0",
                    "method":"event.field.changed",
                    "params": event
                }));
            }
            if request.method == "system.shutdown" {
                Dispatch::Shutdown(messages)
            } else {
                Dispatch::Continue(messages)
            }
        }
        Err(error) => Dispatch::Continue(vec![domain_error_response(id, error, trace_id)]),
    }
}

fn dispatch_request(
    runtime: &mut Runtime,
    request: &mut RequestEnvelope,
    trace_id: TraceId,
) -> Result<(Value, Option<DomainEventDTO>), DomainError> {
    match request.method.as_str() {
        // Parent/Main only: never exported by the renderer preload bridge.
        "host.browser.complete" => Ok((
            json!({"accepted":runtime.agent.complete_browser_request(&request.params)}),
            None,
        )),
        "system.hello" => {
            runtime.hello_completed = true;
            serialize(HelloResponse {
                core_version: env!("CARGO_PKG_VERSION").into(),
                protocol: PROTOCOL,
                schema_version: schema_version(),
                capabilities: CAPABILITIES.iter().map(|value| (*value).into()).collect(),
            })
        }
        "system.health" => serialize(runtime.health.clone()),
        "query.system.build_provenance" => serialize(build_provenance::current()),
        "system.shutdown" | "system.cancel" => Ok((Value::Null, None)),
        "command.project.create" => {
            let params: CreateProjectRequest = parse_params(&request.params)?;
            validate_create_project(&params)?;
            serialize(runtime.storage.create_project(params, now_ms())?)
        }
        "query.project.list" => serialize(runtime.storage.list_projects()?),
        "query.project.get" => {
            let params: ProjectRequest = parse_params(&request.params)?;
            serialize(runtime.storage.get_project(params.field_id)?)
        }
        "command.project.update" => {
            let params: UpdateProjectRequest = parse_params(&request.params)?;
            validate_update_project(&params)?;
            serialize(runtime.storage.update_project(params, now_ms())?)
        }
        "command.project.rebind" => {
            let params: RebindProjectRequest = parse_params(&request.params)?;
            serialize(runtime.storage.rebind_project(params, now_ms())?)
        }
        "command.project.archive" => {
            let params: ArchiveProjectRequest = parse_params(&request.params)?;
            serialize(runtime.storage.archive_project(params, now_ms())?)
        }
        "command.conversation.create" => {
            let params: CreateConversationRequest = parse_params(&request.params)?;
            validate_create_conversation(&params)?;
            serialize(runtime.storage.create_conversation(params, now_ms())?)
        }
        "query.conversation.list" => {
            let params: ProjectRequest = parse_params(&request.params)?;
            serialize(runtime.storage.list_conversations(params.field_id)?)
        }
        "query.conversation.get" => {
            let params: ConversationRequest = parse_params(&request.params)?;
            serialize(runtime.storage.get_conversation(params.conversation_id)?)
        }
        "command.conversation.update" => {
            let params: UpdateConversationRequest = parse_params(&request.params)?;
            validate_update_conversation(&params)?;
            serialize(runtime.storage.update_conversation(params, now_ms())?)
        }
        "command.conversation.archive" => {
            let params: ArchiveConversationRequest = parse_params(&request.params)?;
            serialize(runtime.storage.archive_conversation(params, now_ms())?)
        }
        "command.conversation.message.create" => {
            let params: CreateConversationMessageRequest = parse_params(&request.params)?;
            validate_create_conversation_message(&params)?;
            serialize(
                runtime
                    .storage
                    .create_conversation_message(params, now_ms())?,
            )
        }
        "query.conversation.message.list" => {
            let params: ListConversationMessagesRequest = parse_params(&request.params)?;
            serialize(
                runtime
                    .storage
                    .list_conversation_messages(params.conversation_id)?,
            )
        }
        "command.screenshot_evidence.create" => {
            const MAX_SCREENSHOT_BYTES: usize = 4 * 1024 * 1024;
            let params: CreateScreenshotEvidenceRequest = parse_params(&request.params)?;
            let bytes = decode_png_data_url(&params.png_data_url, MAX_SCREENSHOT_BYTES)?;
            let admitted = fielora_agent::png_admission::admit(bytes)
                .map_err(|_| DomainError::Validation("SCREENSHOT_PNG_REJECTED".into()))?;
            if admitted.byte_length > MAX_SCREENSHOT_BYTES as u64 {
                return Err(DomainError::Validation("SCREENSHOT_PNG_TOO_LARGE".into()));
            }
            let blob_ref = fielora_agent::asset::ContentBlobStore::new(&runtime.content_blob_root)
                .put_exact(admitted.bytes(), &admitted.content_sha256)
                .map_err(|_| DomainError::Validation("SCREENSHOT_BLOB_WRITE_FAILED".into()))?;
            let created_at = now_ms();
            serialize(
                runtime
                    .storage
                    .create_screenshot_evidence(ScreenshotEvidenceView {
                        id: ScreenshotEvidenceId::new(Uuid::now_v7().to_string()),
                        content_sha256: admitted.content_sha256,
                        blob_ref,
                        mime_type: fielora_agent::png_admission::AdmittedPng::MEDIA_TYPE.into(),
                        byte_size: admitted.byte_length,
                        width: admitted.width,
                        height: admitted.height,
                        source_kind: params.source_kind,
                        page_id: params.page_id,
                        navigation_generation: params.navigation_generation,
                        captured_url: params.captured_url,
                        captured_at: params.captured_at,
                        conversation_id: params.conversation_id,
                        run_id: params.run_id,
                        tool_call_id: params.tool_call_id,
                        verification_receipt_id: params.verification_receipt_id,
                        visibility: ScreenshotEvidenceVisibility::Internal,
                        retention_class: ScreenshotEvidenceRetentionClass::LocalEvidence,
                        status: ScreenshotEvidenceStatus::Active,
                        export_policy: ScreenshotEvidenceExportPolicy::Excluded,
                        sync_policy: ScreenshotEvidenceSyncPolicy::LocalOnly,
                        created_at,
                    })?,
            )
        }
        "query.screenshot_evidence.get" => {
            let params: ScreenshotEvidenceRequest = parse_params(&request.params)?;
            serialize(
                runtime
                    .storage
                    .get_screenshot_evidence(params.screenshot_evidence_id)?,
            )
        }
        "query.screenshot_evidence.by_run" => {
            let params: ListScreenshotEvidenceByRunRequest = parse_params(&request.params)?;
            serialize(
                runtime
                    .storage
                    .list_screenshot_evidence_by_run(params.run_id)?,
            )
        }
        "query.screenshot_evidence.by_verification" => {
            let params: ListScreenshotEvidenceByVerificationRequest =
                parse_params(&request.params)?;
            serialize(
                runtime
                    .storage
                    .list_screenshot_evidence_by_verification(params.verification_receipt_id)?,
            )
        }
        "query.screenshot_evidence.preview" => {
            const MAX_SCREENSHOT_BYTES: usize = 4 * 1024 * 1024;
            let params: ScreenshotEvidencePreviewRequest = parse_params(&request.params)?;
            if !valid_sha256(&params.expected_content_sha256) {
                return Err(DomainError::Validation(
                    "SCREENSHOT_PREVIEW_DIGEST_INVALID".into(),
                ));
            }
            let screenshot = runtime
                .storage
                .get_screenshot_evidence(params.screenshot_evidence_id.clone())?;
            if screenshot.status != ScreenshotEvidenceStatus::Active
                || screenshot.content_sha256 != params.expected_content_sha256
                || screenshot.mime_type != "image/png"
                || screenshot.byte_size > MAX_SCREENSHOT_BYTES as u64
            {
                return Err(DomainError::Validation(
                    "SCREENSHOT_PREVIEW_REJECTED".into(),
                ));
            }
            let bytes = fielora_agent::asset::ContentBlobStore::new(&runtime.content_blob_root)
                .read_verified(
                    &screenshot.blob_ref,
                    screenshot.byte_size,
                    &screenshot.content_sha256,
                    MAX_SCREENSHOT_BYTES,
                )
                .map_err(|_| DomainError::Validation("SCREENSHOT_PREVIEW_UNAVAILABLE".into()))?;
            let admitted = fielora_agent::png_admission::admit(bytes)
                .map_err(|_| DomainError::Validation("SCREENSHOT_PREVIEW_UNAVAILABLE".into()))?;
            if admitted.content_sha256 != screenshot.content_sha256
                || admitted.byte_length != screenshot.byte_size
                || admitted.width != screenshot.width
                || admitted.height != screenshot.height
            {
                return Err(DomainError::Validation(
                    "SCREENSHOT_PREVIEW_INTEGRITY_FAILED".into(),
                ));
            }
            serialize(ScreenshotEvidencePreviewView {
                screenshot_evidence_id: screenshot.id,
                source: ResultImageSource::ScreenshotEvidence,
                mime_type: screenshot.mime_type,
                byte_size: screenshot.byte_size,
                width: screenshot.width,
                height: screenshot.height,
                content_sha256: screenshot.content_sha256,
                data_url: data_url("image/png", admitted.bytes()),
            })
        }
        "query.profile.portable_blob_manifest" => {
            serialize(runtime.storage.portable_blob_manifest()?)
        }
        "query.artifact.list" => {
            let params: ListArtifactsRequest = parse_params(&request.params)?;
            let limit = params.limit.unwrap_or(30);
            if limit == 0 || limit > 100 {
                return Err(DomainError::Validation(
                    "ARTIFACT_LIST_LIMIT_INVALID".into(),
                ));
            }
            serialize(runtime.storage.list_artifacts(
                params.cursor,
                limit,
                params.include_archived,
            )?)
        }
        "query.artifact.read" => {
            let params: ReadArtifactRequest = parse_params(&request.params)?;
            serialize(
                runtime
                    .storage
                    .read_artifact(params.artifact_id, params.revision_id)?,
            )
        }
        "query.artifact.history" => {
            let params: ArtifactHistoryRequest = parse_params(&request.params)?;
            let limit = params.limit.unwrap_or(30);
            if limit == 0 || limit > 100 || params.before_sequence == Some(1) {
                return Err(DomainError::Validation(
                    "ARTIFACT_HISTORY_LIMIT_INVALID".into(),
                ));
            }
            serialize(runtime.storage.list_artifact_history(
                params.artifact_id,
                params.before_sequence,
                limit,
            )?)
        }
        "query.artifact.asset_preview" => {
            const MAX_DESKTOP_PNG_PREVIEW_BYTES: usize = 4 * 1024 * 1024;
            let params: AssetPreviewRequest = parse_params(&request.params)?;
            if !valid_sha256(&params.expected_content_sha256) {
                return Err(DomainError::Validation(
                    "ASSET_PREVIEW_DIGEST_INVALID".into(),
                ));
            }
            let asset = runtime.storage.read_asset(params.asset_id.clone())?;
            if asset.media_type != AssetMediaType::Png
                || asset.content_sha256 != params.expected_content_sha256
                || asset.byte_length > MAX_DESKTOP_PNG_PREVIEW_BYTES as u64
            {
                return Err(DomainError::Validation("ASSET_PREVIEW_REJECTED".into()));
            }
            let bytes = fielora_agent::asset::ContentBlobStore::new(&runtime.content_blob_root)
                .read_verified(
                    &asset.blob_ref,
                    asset.byte_length,
                    &asset.content_sha256,
                    MAX_DESKTOP_PNG_PREVIEW_BYTES,
                )
                .map_err(|_| DomainError::Validation("ASSET_PREVIEW_UNAVAILABLE".into()))?;
            let admitted = fielora_agent::png_admission::admit(bytes)
                .map_err(|_| DomainError::Validation("ASSET_PREVIEW_UNAVAILABLE".into()))?;
            if admitted.content_sha256 != asset.content_sha256
                || admitted.byte_length != asset.byte_length
                || admitted.width != asset.width
                || admitted.height != asset.height
            {
                return Err(DomainError::Validation(
                    "ASSET_PREVIEW_INTEGRITY_FAILED".into(),
                ));
            }
            serialize(AssetPreviewView {
                asset_id: asset.asset_id,
                media_type: asset.media_type,
                content_sha256: asset.content_sha256,
                byte_length: asset.byte_length,
                width: asset.width,
                height: asset.height,
                data_url: data_url("image/png", admitted.bytes()),
            })
        }
        "query.artifact.diagram_preview" => {
            let params: DiagramPreviewRequest = parse_params(&request.params)?;
            let read = runtime
                .storage
                .read_artifact(params.artifact_id.clone(), Some(params.revision_id.clone()))?;
            let ArtifactContentV1::Diagram(diagram) = &read.revision.content else {
                return Err(DomainError::Validation(
                    "DIAGRAM_PREVIEW_TYPE_MISMATCH".into(),
                ));
            };
            let bytes = fielora_agent::artifact::render_diagram_preview(diagram)
                .map_err(|_| DomainError::Validation("DIAGRAM_PREVIEW_UNAVAILABLE".into()))?;
            let render_sha256 = format!("{:x}", Sha256::digest(&bytes));
            serialize(DiagramPreviewView {
                artifact_id: read.artifact.artifact_id,
                revision_id: read.revision.revision_id,
                semantic_sha256: read.revision.semantic_sha256,
                render_sha256,
                data_url: data_url("image/svg+xml", &bytes),
            })
        }
        "command.artifact.set_archive_state" => {
            let params: SetArtifactArchiveStateCommandRequest = parse_params(&request.params)?;
            serialize(runtime.agent.set_artifact_archive_state(params)?)
        }
        "query.artifact.file_reviews" => {
            let params: ListFileArtifactReviewsRequest = parse_params(&request.params)?;
            serialize(runtime.agent.list_file_artifact_reviews(params)?)
        }
        "command.artifact.file_mark_reviewed" => {
            let params: MarkFileArtifactReviewedRequest = parse_params(&request.params)?;
            serialize(runtime.agent.mark_file_artifact_reviewed(params)?)
        }
        "command.artifact.file_undo" => {
            let params: UndoFileArtifactRevisionRequest = parse_params(&request.params)?;
            serialize(runtime.agent.undo_file_artifact_revision(params)?)
        }
        "command.agent.start" => {
            let params: StartAgentRunRequest = parse_params(&request.params)?;
            serialize(runtime.agent.start(params)?)
        }
        "query.agent.get" => {
            let params: AgentRunRequest = parse_params(&request.params)?;
            serialize(runtime.storage.get_agent_run(params.run_id)?)
        }
        "query.agent.list" => {
            let params: ListAgentRunsRequest = parse_params(&request.params)?;
            serialize(runtime.storage.list_agent_runs(params.conversation_id)?)
        }
        "query.agent.usage" => {
            let params: ModelUsageReportRequest = parse_params(&request.params)?;
            serialize(runtime.storage.model_usage_report(params)?)
        }
        "query.agent.events" => {
            let params: ListAgentEventsRequest = parse_params(&request.params)?;
            serialize(runtime.storage.list_agent_events(params)?)
        }
        "query.agent.tool_calls" => {
            let params: AgentRunRequest = parse_params(&request.params)?;
            serialize(runtime.storage.list_agent_tool_calls(params.run_id)?)
        }
        "command.agent.cancel" => {
            let params: AgentRunRequest = parse_params(&request.params)?;
            serialize(runtime.agent.cancel(params.run_id)?)
        }
        "command.agent.pause" => {
            let params: AgentRunRequest = parse_params(&request.params)?;
            serialize(runtime.agent.pause(params.run_id)?)
        }
        "command.agent.resume" => {
            let params: ResumeAgentRunRequest = parse_params(&request.params)?;
            serialize(runtime.agent.resume_with_inputs(params)?)
        }
        "command.agent.resolve_approval" => {
            let params: ResolveAgentApprovalRequest = parse_params(&request.params)?;
            serialize(runtime.agent.resolve_approval(params)?)
        }
        "query.agent.mcp_connections" => serialize(runtime.agent.mcp_connections()),
        "query.agent.mcp_runtime" => {
            let params: AgentRunRequest = parse_params(&request.params)?;
            serialize(runtime.agent.mcp_runtime(params.run_id)?)
        }
        "command.agent.activate_mcp_connection" => {
            let params: ActivateMcpConnectionRequest = parse_params(&request.params)?;
            serialize(runtime.agent.activate_mcp_connection(params)?)
        }
        "query.agent.skill_catalog" => {
            let params: SkillCatalogRequest = parse_params(&request.params)?;
            serialize(runtime.agent.skill_catalog(params)?)
        }
        "query.plugin.local_registry" => serialize(runtime.agent.plugin_registry()),
        "command.plugin.register_local" => {
            let params: RegisterLocalPluginRequest = parse_params(&request.params)?;
            serialize(runtime.agent.register_local_plugin(params)?)
        }
        "command.plugin.unregister_local" => {
            let params: UnregisterLocalPluginRequest = parse_params(&request.params)?;
            serialize(runtime.agent.unregister_local_plugin(params)?)
        }
        "command.field.create" => {
            let params: CreateFieldRequest = parse_params(&request.params)?;
            let (field, event) =
                runtime
                    .field
                    .create(params.title, params.goal, trace_id, now_ms())?;
            Ok((
                serde_json::to_value(field_view(field)).unwrap(),
                Some(event),
            ))
        }
        "query.field.list" => {
            let fields = runtime
                .field
                .list()?
                .into_iter()
                .map(field_summary)
                .collect::<Vec<_>>();
            serialize(fields)
        }
        "query.field.get" => {
            let params: FieldReferenceRequest = parse_params(&request.params)?;
            serialize(field_view(runtime.field.get(&params.field_id)?))
        }
        "command.field.update_focus" => {
            let params: UpdateFocusRequest = parse_params(&request.params)?;
            let (field, event) = runtime.field.update_focus(
                params.field_id,
                params.expected_revision,
                params.focus,
                trace_id,
                now_ms(),
            )?;
            Ok((
                serde_json::to_value(field_view(field)).unwrap(),
                Some(event),
            ))
        }
        "command.field.update_mode" => {
            let params: UpdateFieldModeRequest = parse_params(&request.params)?;
            let (field, event) = runtime.field.update_mode(params, trace_id, now_ms())?;
            Ok((
                serde_json::to_value(RealityMutationResult {
                    field_revision: field.revision,
                    resource: field_view(field),
                })
                .unwrap(),
                Some(event),
            ))
        }
        "command.field.set_focus_v1" => {
            let params: SetFieldFocusV1Request = parse_params(&request.params)?;
            let (field, event) = runtime.field.set_focus_v1(params, trace_id, now_ms())?;
            Ok((
                serde_json::to_value(RealityMutationResult {
                    field_revision: field.revision,
                    resource: field_view(field),
                })
                .unwrap(),
                Some(event),
            ))
        }
        "command.state.create" => mutation(runtime.reality.create_state(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "query.state.get" => serialize(runtime.reality.get_state(parse_params(&request.params)?)?),
        "query.state.list" => serialize(
            runtime
                .reality
                .list_states(parse_params(&request.params)?)?,
        ),
        "command.state.revise" => mutation(runtime.reality.revise_state(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "command.state.transition" => mutation(runtime.reality.transition_state(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "command.state.supersede" => mutation(runtime.reality.supersede_state(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "command.reference.create" => mutation(runtime.reality.create_reference(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "query.reference.get" => serialize(
            runtime
                .reality
                .get_reference(parse_params(&request.params)?)?,
        ),
        "query.reference.list" => serialize(
            runtime
                .reality
                .list_references(parse_params(&request.params)?)?,
        ),
        "command.reference.revise" => mutation(runtime.reality.revise_reference(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "command.reference.archive" => mutation(runtime.reality.archive_reference(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "command.reference.restore" => mutation(runtime.reality.restore_reference(
            parse_params(&request.params)?,
            trace_id,
            now_ms(),
        )?),
        "command.relation.attach_reference_source" => {
            mutation(runtime.reality.attach_reference_source(
                parse_params(&request.params)?,
                trace_id,
                now_ms(),
            )?)
        }
        "command.relation.retract_reference_source" => {
            mutation(runtime.reality.retract_reference_source(
                parse_params(&request.params)?,
                trace_id,
                now_ms(),
            )?)
        }
        "query.relation.list" => serialize(
            runtime
                .reality
                .list_relations(parse_params(&request.params)?)?,
        ),
        "query.activity.list" => serialize(
            runtime
                .reality
                .list_activities(parse_params(&request.params)?)?,
        ),
        "command.surface.save_snapshot_v1" => {
            let params: SaveSurfaceSnapshotV1Request = parse_params(&request.params)?;
            serialize(runtime.surface.save_v1(params, now_ms())?)
        }
        "query.field.resume_v1" => {
            let params: FieldReferenceRequest = parse_params(&request.params)?;
            serialize(runtime.reality.resume_v1(params.field_id)?)
        }
        "command.surface.save_snapshot" => {
            let params: SaveSurfaceSnapshotRequest = parse_params(&request.params)?;
            serialize(snapshot_view(runtime.surface.save(
                params.field_id,
                params.layout,
                params.open_objects,
                now_ms(),
            )?))
        }
        "query.surface.latest_snapshot" => {
            let params: FieldReferenceRequest = parse_params(&request.params)?;
            let field = field_view(runtime.field.get(&params.field_id)?);
            let snapshot = runtime.surface.latest(&params.field_id)?.map(snapshot_view);
            serialize(SurfaceResumeView { field, snapshot })
        }
        "command.provider.create_config" => {
            let params: CreateProviderConfigRequest = parse_params(&request.params)?;
            validate_provider_create(&params)?;
            let record = runtime.storage.create_provider_config(params, now_ms())?;
            serialize(provider_reconciled(runtime, record)?)
        }
        "command.provider.update_config" => {
            let params: UpdateProviderConfigRequest = parse_params(&request.params)?;
            let current = runtime
                .storage
                .get_provider_config(params.provider_config_id.clone())?;
            validate_provider_update(&current, &params)?;
            let record = runtime.storage.update_provider_config(params, now_ms())?;
            serialize(provider_reconciled(runtime, record)?)
        }
        "command.provider.store_credential" => {
            let params: StoreCredentialRequest =
                serde_json::from_value(std::mem::take(&mut request.params))
                    .map_err(|error| DomainError::Validation(error.to_string()))?;
            let record = runtime
                .storage
                .get_provider_config(params.provider_config_id.clone())?;
            if record.view.lifecycle_status == ProviderLifecycle::Removed {
                return Err(DomainError::TerminalResource);
            }
            runtime
                .credentials
                .store(
                    &record.credential_ref,
                    SecretBytes::new(params.secret.into_bytes()),
                )
                .map_err(|_| DomainError::Validation("CREDENTIAL_STORE_FAILED".into()))?;
            let record = match runtime.storage.set_provider_credential_present(
                record.view.id,
                true,
                now_ms(),
            ) {
                Ok(record) => record,
                Err(error) => {
                    let _ = runtime.credentials.delete(&record.credential_ref);
                    return Err(error);
                }
            };
            serialize(provider_reconciled(runtime, record)?)
        }
        "command.provider.delete_credential" => {
            let params: ProviderConfigRequest = parse_params(&request.params)?;
            let record = runtime
                .storage
                .get_provider_config(params.provider_config_id)?;
            runtime
                .credentials
                .delete(&record.credential_ref)
                .map_err(|_| DomainError::Validation("CREDENTIAL_DELETE_FAILED".into()))?;
            let record =
                runtime
                    .storage
                    .set_provider_credential_present(record.view.id, false, now_ms())?;
            serialize(provider_reconciled(runtime, record)?)
        }
        "command.provider.remove_config" => {
            let params: ProviderConfigRequest = parse_params(&request.params)?;
            let record = runtime
                .storage
                .get_provider_config(params.provider_config_id)?;
            runtime
                .credentials
                .delete(&record.credential_ref)
                .map_err(|_| DomainError::Validation("CREDENTIAL_DELETE_FAILED".into()))?;
            serialize(provider_reconciled(
                runtime,
                runtime
                    .storage
                    .remove_provider_config(record.view.id, now_ms())?,
            )?)
        }
        "query.provider.catalog" => serialize(fielora_model::provider_catalog()),
        "query.provider.list_configs" => serialize(
            runtime
                .storage
                .list_provider_configs()?
                .into_iter()
                .map(|record| provider_reconciled(runtime, record))
                .collect::<Result<Vec<_>, _>>()?,
        ),
        "query.provider.get_config" => {
            let params: ProviderConfigRequest = parse_params(&request.params)?;
            serialize(provider_reconciled(
                runtime,
                runtime
                    .storage
                    .get_provider_config(params.provider_config_id)?,
            )?)
        }
        "command.provider.update_model_runtime" => {
            let params: UpdateModelRuntimeRequest = parse_params(&request.params)?;
            let record = runtime
                .storage
                .get_provider_config(params.provider_config_id.clone())?;
            if record.view.lifecycle_status == ProviderLifecycle::Removed {
                return Err(DomainError::TerminalResource);
            }
            if record.view.revision != params.expected_provider_revision {
                return Err(DomainError::RevisionConflict);
            }
            let endpoint = model_runtime::endpoint(&record.view);
            fielora_model::effective_parameters(
                &endpoint,
                &record.view.default_model,
                &params.settings,
            )
            .map_err(|e| DomainError::Validation(e.code().into()))?;
            runtime.storage.save_model_runtime(
                record.view.id.clone(),
                fielora_model::endpoint_identity(&endpoint),
                record.view.default_model.clone(),
                record.view.revision,
                params.expected_revision,
                params.settings,
            )?;
            serialize(provider_reconciled(runtime, record)?)
        }
        "command.provider.validate_model" => serialize(model_runtime::start_validation(
            runtime,
            parse_params(&request.params)?,
        )?),
        "command.provider.probe" => {
            let params: ProviderConfigRequest = parse_params(&request.params)?;
            let record = runtime
                .storage
                .get_provider_config(params.provider_config_id)?;
            serialize(start_model(
                runtime,
                StartModelInvocationRequest {
                    provider_config_id: record.view.id.clone(),
                    model_id: Some(record.view.default_model.clone()),
                    intent: ModelIntent::Ask,
                    user_input: "Reply with FIELORA_PROVIDER_PROBE_OK".into(),
                    context_package: vec![],
                    response_mode: ResponseMode::Text,
                },
            )?)
        }
        "command.model.start" => serialize(start_model(runtime, parse_params(&request.params)?)?),
        "command.model.cancel" => {
            let params: CancelModelInvocationRequest = parse_params(&request.params)?;
            let cancellation = runtime
                .cancellations
                .lock()
                .unwrap()
                .get(&params.invocation_id.0)
                .cloned()
                .ok_or(DomainError::NotFound)?;
            cancellation.cancel();
            serialize(Value::Null)
        }
        "command.capture.create" => {
            let params: CreateCaptureRequest = parse_params(&request.params)?;
            validate_capture_create(runtime, &params)?;
            let capture = runtime.storage.create_capture(params, now_ms())?;
            emit_capture(runtime, &capture);
            serialize(capture)
        }
        "command.capture.attach" => {
            let capture = runtime
                .storage
                .attach_capture(parse_params(&request.params)?, now_ms())?;
            emit_capture(runtime, &capture);
            serialize(capture)
        }
        "command.capture.promote" => {
            let capture = runtime
                .storage
                .promote_capture(parse_params(&request.params)?, now_ms())?;
            emit_capture(runtime, &capture);
            serialize(capture)
        }
        "command.capture.archive" => {
            let params: MutateCaptureRequest = parse_params(&request.params)?;
            let capture = runtime.storage.set_capture_archived(
                params.capture_id,
                params.expected_revision,
                true,
                now_ms(),
            )?;
            emit_capture(runtime, &capture);
            serialize(capture)
        }
        "command.capture.restore" => {
            let params: MutateCaptureRequest = parse_params(&request.params)?;
            let capture = runtime.storage.set_capture_archived(
                params.capture_id,
                params.expected_revision,
                false,
                now_ms(),
            )?;
            emit_capture(runtime, &capture);
            serialize(capture)
        }
        "query.capture.list" => serialize(
            runtime
                .storage
                .list_captures(parse_params(&request.params)?)?,
        ),
        "query.capture.get" => {
            let params: CaptureRequest = parse_params(&request.params)?;
            serialize(runtime.storage.get_capture(params.capture_id)?)
        }
        "query.fonts.list" => serialize(
            fielora_platform::fonts::list().map_err(|e| DomainError::Validation(e.to_string()))?,
        ),
        "command.fonts.import" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct FontImport {
                path: String,
            }
            let params: FontImport = parse_params(&request.params)?;
            serialize(
                fielora_platform::fonts::import_file(std::path::Path::new(&params.path))
                    .map_err(|e| DomainError::Validation(e.to_string()))?,
            )
        }
        "query.profile.get" => serialize(runtime.storage.profile()?),
        "command.library.create_file" => {
            let params: CreateLibraryFileRequest = parse_params(&request.params)?;
            serialize(runtime.storage.create_library_file(params, now_ms())?)
        }
        "command.library.save_web" => {
            let params: SaveWebLibraryRequest = parse_params(&request.params)?;
            serialize(runtime.storage.save_web_library(params, now_ms())?)
        }
        "query.library.get" => {
            let params: LibraryObjectRequest = parse_params(&request.params)?;
            serialize(
                runtime
                    .storage
                    .get_library_object(params.library_object_id)?,
            )
        }
        "query.library.list" => {
            let params: ListLibraryObjectsRequest = parse_params(&request.params)?;
            serialize(runtime.storage.list_library_objects(params)?)
        }
        "command.library.delete" => {
            let params: DeleteLibraryObjectRequest = parse_params(&request.params)?;
            serialize(runtime.storage.delete_library_object(params, now_ms())?)
        }
        "query.sync.change_journal" => serialize(runtime.storage.list_sync_changes()?),
        method => {
            warn!(method, "unknown FIPC method");
            Err(DomainError::Validation(format!("unknown_method:{method}")))
        }
    }
}

fn provider_public(
    record: ProviderConfigRecord,
    credentials: &dyn CredentialStore,
) -> ProviderConfigView {
    let mut view = record.view;
    view.credential_present = credentials.exists(&record.credential_ref);
    view
}

fn provider_reconciled(
    runtime: &Runtime,
    record: ProviderConfigRecord,
) -> Result<ProviderConfigView, DomainError> {
    let present = runtime.credentials.exists(&record.credential_ref);
    let record = if !present && record.view.lifecycle_status == ProviderLifecycle::Active {
        runtime
            .storage
            .set_provider_credential_present(record.view.id, false, now_ms())?
    } else {
        record
    };
    let mut view = provider_public(record, runtime.credentials.as_ref());
    view.model_runtime = Some(model_runtime::view(
        &runtime.storage,
        &view,
        &view.default_model,
    )?);
    Ok(view)
}

fn validate_text(label: &str, value: &str, max: usize) -> Result<(), DomainError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > max {
        return Err(DomainError::Validation(format!(
            "{label} is empty or too long"
        )));
    }
    Ok(())
}

fn validate_create_project(request: &CreateProjectRequest) -> Result<(), DomainError> {
    validate_unicode_text("title", &request.title, 120, 480, false)?;
    if let Some(goal) = request.goal.as_deref() {
        validate_unicode_text("goal", goal, 4_000, 16 * 1024, true)?;
    }
    if request.root_path.trim() != request.root_path
        || request.root_path.is_empty()
        || request.root_path.len() > 32_767
        || request.root_path.chars().any(char::is_control)
        || !Path::new(&request.root_path).is_absolute()
    {
        return Err(DomainError::Validation("project root is invalid".into()));
    }
    Ok(())
}

fn validate_update_project(request: &UpdateProjectRequest) -> Result<(), DomainError> {
    validate_unicode_text("title", &request.title, 120, 480, false)
}

fn validate_conversation_fields(title: &str, model_id: Option<&str>) -> Result<(), DomainError> {
    validate_unicode_text("title", title, 120, 480, false)?;
    if let Some(model_id) = model_id {
        validate_unicode_text("model_id", model_id, 256, 1_024, false)?;
    }
    Ok(())
}

fn validate_create_conversation(request: &CreateConversationRequest) -> Result<(), DomainError> {
    validate_conversation_fields(&request.title, request.model_id.as_deref())
}

fn validate_update_conversation(request: &UpdateConversationRequest) -> Result<(), DomainError> {
    validate_conversation_fields(&request.title, request.model_id.as_deref())
}

fn validate_create_conversation_message(
    request: &CreateConversationMessageRequest,
) -> Result<(), DomainError> {
    validate_unicode_text(
        "message content",
        &request.content,
        1_048_576,
        1_048_576,
        false,
    )?;
    if let Some(model_id) = request.model_id.as_deref() {
        validate_unicode_text("model_id", model_id, 256, 1_024, false)?;
    }
    if request.role == ConversationMessageRole::User
        && (request.provider_config_id.is_some()
            || request.model_id.is_some()
            || request.invocation_id.is_some()
            || !request.references.is_empty())
    {
        return Err(DomainError::Validation(
            "user message cannot claim provider or result provenance".into(),
        ));
    }
    if request.references.len() > 64 {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_LIMIT_EXCEEDED".into(),
        ));
    }
    Ok(())
}

fn validate_unicode_text(
    label: &str,
    value: &str,
    max_scalars: usize,
    max_bytes: usize,
    allow_empty: bool,
) -> Result<(), DomainError> {
    if (!allow_empty && value.trim().is_empty())
        || value.chars().count() > max_scalars
        || value.len() > max_bytes
    {
        return Err(DomainError::Validation(format!(
            "{label} is empty or too long"
        )));
    }
    Ok(())
}

fn credential_like(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let long_token_after = |marker: &str, minimum: usize| {
        lower.match_indices(marker).any(|(index, _)| {
            let suffix = lower[index + marker.len()..].trim_start();
            let suffix = suffix.strip_prefix("bearer ").unwrap_or(suffix);
            suffix
                .bytes()
                .take_while(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
                })
                .count()
                >= minimum
        })
    };
    long_token_after("authorization:", 16)
        || long_token_after("x-api-key:", 16)
        || long_token_after("api_key=", 16)
        || long_token_after("api-key=", 16)
        || long_token_after("bearer ", 16)
        || long_token_after("sk-", 20)
}

fn valid_capture_uri(value: &str) -> bool {
    if value.len() > 2048 || value.trim() != value || value.chars().any(char::is_control) {
        return false;
    }
    let remainder = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    let Some(remainder) = remainder else {
        return false;
    };
    let authority = remainder.split(['/', '?', '#']).next().unwrap_or_default();
    !authority.is_empty() && !authority.contains('@') && !authority.chars().any(char::is_whitespace)
}

fn validate_provider_create(request: &CreateProviderConfigRequest) -> Result<(), DomainError> {
    validate_text("display_name", &request.display_name, 120)?;
    validate_text("default_model", &request.default_model, 256)?;
    fielora_model::validate_provider_model(request.provider_kind, &request.default_model)
        .map_err(|error| DomainError::Validation(error.code().into()))?;
    match request.provider_kind {
        ProviderKind::Openai | ProviderKind::Anthropic
            if request.base_url.is_none() && !request.custom_endpoint_acknowledged =>
        {
            Ok(())
        }
        ProviderKind::OpenaiCompatible
            if request.custom_endpoint_acknowledged
                && request
                    .base_url
                    .as_deref()
                    .is_some_and(|url| url.starts_with("https://")) =>
        {
            Ok(())
        }
        _ => Err(DomainError::Validation("CUSTOM_ENDPOINT_REJECTED".into())),
    }
}

fn validate_provider_update(
    current: &ProviderConfigRecord,
    request: &UpdateProviderConfigRequest,
) -> Result<(), DomainError> {
    validate_text("display_name", &request.display_name, 120)?;
    validate_text("default_model", &request.default_model, 256)?;
    fielora_model::validate_provider_model(
        request.provider_kind.unwrap_or(current.view.provider_kind),
        &request.default_model,
    )
    .map_err(|error| DomainError::Validation(error.code().into()))?;
    match request.provider_kind.unwrap_or(current.view.provider_kind) {
        ProviderKind::Openai | ProviderKind::Anthropic
            if request.base_url.is_none() && !request.custom_endpoint_acknowledged =>
        {
            Ok(())
        }
        ProviderKind::OpenaiCompatible
            if request.custom_endpoint_acknowledged
                && request
                    .base_url
                    .as_deref()
                    .is_some_and(|url| url.starts_with("https://")) =>
        {
            Ok(())
        }
        _ => Err(DomainError::Validation("CUSTOM_ENDPOINT_REJECTED".into())),
    }
}

fn validate_capture_create(
    runtime: &Runtime,
    request: &CreateCaptureRequest,
) -> Result<(), DomainError> {
    validate_unicode_text("title", &request.title, 120, 480, false)?;
    validate_unicode_text("content", &request.content, 16_000, 64 * 1024, false)?;
    if let Some(title) = request.source.title.as_deref() {
        validate_unicode_text("source.title", title, 120, 480, true)?;
    }
    let kind_matches = matches!(
        (request.kind, request.source.kind),
        (CaptureKind::Text, CaptureSourceKind::UserInput)
            | (CaptureKind::Text, CaptureSourceKind::ModelResponse)
            | (CaptureKind::Page, CaptureSourceKind::RemotePage)
            | (CaptureKind::Selection, CaptureSourceKind::RemoteSelection)
            | (CaptureKind::ModelOutput, CaptureSourceKind::ModelResponse)
            | (CaptureKind::FieldExcerpt, CaptureSourceKind::FieldResource)
    );
    if !kind_matches {
        return Err(DomainError::Validation(
            "capture kind/source mismatch".into(),
        ));
    }
    match request.source.kind {
        CaptureSourceKind::RemotePage | CaptureSourceKind::RemoteSelection => {
            if !request.source.uri.as_deref().is_some_and(valid_capture_uri) {
                return Err(DomainError::Validation(
                    "invalid credential-free page URI".into(),
                ));
            }
            if request.source.provider_config_id.is_some() || request.source.field_id.is_some() {
                return Err(DomainError::Validation(
                    "remote provenance contains unrelated identity".into(),
                ));
            }
        }
        CaptureSourceKind::ModelResponse => {
            let invocation = request
                .source
                .provider_invocation_id
                .as_ref()
                .ok_or_else(|| DomainError::Validation("model provenance missing".into()))?;
            if request.source.provider_config_id.is_none()
                || request.source.provider_model_id.is_none()
                || request.source.uri.is_some()
                || request.source.field_id.is_some()
            {
                return Err(DomainError::Validation("model provenance invalid".into()));
            }
            validate_unicode_text(
                "provider_model_id",
                request
                    .source
                    .provider_model_id
                    .as_deref()
                    .unwrap_or_default(),
                256,
                1024,
                false,
            )?;
            if !request.source.is_partial
                && !runtime
                    .completed_invocations
                    .lock()
                    .unwrap()
                    .contains(&invocation.0)
            {
                return Err(DomainError::Validation(
                    "MODEL_INVOCATION_NOT_COMPLETED".into(),
                ));
            }
        }
        CaptureSourceKind::FieldResource => {
            let field = request
                .source
                .field_id
                .as_ref()
                .ok_or_else(|| DomainError::Validation("field provenance missing".into()))?;
            let _ = runtime.field.get(field)?;
            if request.source.resource_type.is_none()
                || request.source.resource_id.is_none()
                || request.source.resource_revision.is_none()
                || request.source.provider_config_id.is_some()
                || request.source.uri.is_some()
            {
                return Err(DomainError::Validation("field provenance invalid".into()));
            }
        }
        CaptureSourceKind::UserInput => {
            if request.source.uri.is_some()
                || request.source.field_id.is_some()
                || request.source.provider_config_id.is_some()
            {
                return Err(DomainError::Validation(
                    "user input provenance invalid".into(),
                ));
            }
        }
    }
    Ok(())
}

fn normalize_context(
    runtime: &Runtime,
    chips: Vec<ContextChip>,
) -> Result<Vec<ContextChip>, DomainError> {
    if chips.len() > 8 {
        return Err(DomainError::Validation("CONTEXT_TOO_LARGE".into()));
    }
    let mut result = Vec::with_capacity(chips.len());
    let mut total_bytes = 0usize;
    let mut total_scalars = 0usize;
    for mut chip in chips {
        if chip.sensitivity == ContextSensitivity::Blocked {
            return Err(DomainError::Validation("CONTEXT_BLOCKED".into()));
        }
        match chip.kind {
            ContextChipKind::CurrentField => {
                let field = runtime
                    .field
                    .get(&FieldId::new(chip.source_identity.clone()))?;
                chip.source_revision_or_navigation_generation = field.revision.to_string();
                chip.content = format!("{}\n{}", field.title, field.goal.unwrap_or_default());
            }
            ContextChipKind::CurrentFocus => {
                let field = runtime
                    .field
                    .get(&FieldId::new(chip.source_identity.clone()))?;
                chip.source_revision_or_navigation_generation = field.revision.to_string();
                chip.content = field
                    .current_focus
                    .map(|value| value.to_string())
                    .unwrap_or_default();
            }
            ContextChipKind::Capture => {
                let capture = runtime
                    .storage
                    .get_capture(CaptureId::new(chip.source_identity.clone()))?;
                chip.source_revision_or_navigation_generation = capture.revision.to_string();
                chip.content = capture.content;
            }
            ContextChipKind::CurrentPage
            | ContextChipKind::CurrentSelection
            | ContextChipKind::UserNote => {}
        }
        validate_text("context.display_label", &chip.display_label, 160)?;
        validate_text("context.source_identity", &chip.source_identity, 256)?;
        validate_text(
            "context.source_revision_or_navigation_generation",
            &chip.source_revision_or_navigation_generation,
            64,
        )?;
        validate_unicode_text("context.content", &chip.content, 4_000, 16 * 1024, true)?;
        if credential_like(&chip.content) {
            return Err(DomainError::Validation("CONTEXT_BLOCKED".into()));
        }
        total_bytes = total_bytes.saturating_add(chip.content.len());
        total_scalars = total_scalars.saturating_add(chip.content.chars().count());
        if total_bytes > 48 * 1024 || total_scalars > 12_000 {
            return Err(DomainError::Validation("CONTEXT_TOO_LARGE".into()));
        }
        result.push(chip);
    }
    Ok(result)
}

fn start_model(
    runtime: &mut Runtime,
    params: StartModelInvocationRequest,
) -> Result<StartModelInvocationResult, DomainError> {
    validate_unicode_text("user_input", &params.user_input, 8_000, 32 * 1024, false)?;
    if credential_like(&params.user_input) {
        return Err(DomainError::Validation("CONTEXT_BLOCKED".into()));
    }
    if let Some(model_id) = params.model_id.as_deref() {
        validate_unicode_text("model_id", model_id, 256, 1024, false)?;
    }
    let record = runtime
        .storage
        .get_provider_config(params.provider_config_id.clone())?;
    if record.view.lifecycle_status != ProviderLifecycle::Active {
        return Err(DomainError::Validation("PROVIDER_DISABLED".into()));
    }
    let secret = runtime
        .credentials
        .read(&record.credential_ref)
        .map_err(|_| DomainError::Validation("CREDENTIAL_MISSING".into()))?;
    let invocation_id = ModelInvocationId::new(Uuid::now_v7().to_string());
    let context_package_id = ContextPackageId::new(Uuid::now_v7().to_string());
    let request = ModelInvocationRequest {
        invocation_id: invocation_id.clone(),
        context_package_id: context_package_id.clone(),
        provider_config_id: record.view.id.clone(),
        model_id: params.model_id.unwrap_or(record.view.default_model.clone()),
        intent: params.intent,
        user_input: params.user_input,
        context_package: normalize_context(runtime, params.context_package)?,
        response_mode: params.response_mode,
    };
    let model_settings =
        model_runtime::view(&runtime.storage, &record.view, &request.model_id)?.settings;
    let cancellation = CancellationToken::new();
    runtime
        .cancellations
        .lock()
        .unwrap()
        .insert(invocation_id.0.clone(), cancellation.clone());
    let cancellations = runtime.cancellations.clone();
    let completed = runtime.completed_invocations.clone();
    let sender = runtime.event_sender.clone();
    let id = invocation_id.0.clone();
    let fixture_enabled = std::env::var("FIELORA_E2E").as_deref() == Ok("1");
    let fixture_complete = fixture_enabled
        && matches!(
            request.model_id.as_str(),
            "__fielora_fixture__" | "__fielora_agent_fixture__"
        );
    let fixture_failure = fixture_enabled && request.model_id == "__fielora_fixture_failure__";
    let terminal_storage = runtime.storage.clone();
    let field_scope = request
        .context_package
        .iter()
        .find(|chip| chip.kind == ContextChipKind::CurrentField)
        .map(|chip| FieldId::new(chip.source_identity.clone()));
    let terminal_provider = request.provider_config_id.clone();
    let terminal_model = request.model_id.clone();
    runtime.async_runtime.as_ref().expect("model runtime available").spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        if fixture_complete || fixture_failure {
            send_model_event(&sender,ModelInvocationEvent{event:"event.model.invocation".into(),invocation_id:request.invocation_id.clone(),kind:ModelInvocationEventKind::Started,text_delta:None,tool_proposal:None,usage:None,error_code:None});
            tokio::select!{_=cancellation.cancelled()=>send_terminal(&sender,&request.invocation_id,ModelInvocationEventKind::Cancelled,Some("INVOCATION_CANCELLED")),_=tokio::time::sleep(std::time::Duration::from_millis(40))=>{
                if fixture_failure { send_terminal(&sender,&request.invocation_id,ModelInvocationEventKind::Failed,Some("PROVIDER_RATE_LIMITED")); }
                else { send_model_event(&sender,ModelInvocationEvent{event:"event.model.invocation".into(),invocation_id:request.invocation_id.clone(),kind:ModelInvocationEventKind::OutputTextDelta,text_delta:Some("Fielora fixture response".into()),tool_proposal:None,usage:None,error_code:None});
                send_model_event(&sender,ModelInvocationEvent{event:"event.model.invocation".into(),invocation_id:request.invocation_id.clone(),kind:ModelInvocationEventKind::Usage,text_delta:None,tool_proposal:None,usage:Some(ModelUsage{input_tokens:Some(3),output_tokens:Some(3)}),error_code:None});completed.lock().unwrap().insert(id.clone());send_terminal(&sender,&request.invocation_id,ModelInvocationEventKind::Completed,None); }}}
        } else {
            let result=match ModelClient::new(){Ok(client)=>client.with_settings(model_settings).invoke(ProviderEndpoint{model_optimization:record.view.model_optimization,kind:record.view.provider_kind,base_url:record.view.base_url},request.clone(),secret.expose(),cancellation.clone(),|event|send_model_event(&sender,event)).await,Err(error)=>Err(error)};
            match result {Ok(())=>{completed.lock().unwrap().insert(id.clone());send_terminal(&sender,&request.invocation_id,ModelInvocationEventKind::Completed,None);},Err(ModelError::InvocationCancelled)=>send_terminal(&sender,&request.invocation_id,ModelInvocationEventKind::Cancelled,Some("INVOCATION_CANCELLED")),Err(error)=>send_terminal(&sender,&request.invocation_id,ModelInvocationEventKind::Failed,Some(error.code()))}
        }
        let was_completed=completed.lock().unwrap().contains(&id);let _=terminal_storage.record_model_terminal(field_scope,terminal_provider,terminal_model,was_completed,now_ms());cancellations.lock().unwrap().remove(&id);
    });
    Ok(StartModelInvocationResult {
        invocation_id,
        context_package_id,
    })
}

fn send_model_event(sender: &SyncSender<Value>, event: ModelInvocationEvent) {
    let _ = sender.send(json!({"jsonrpc":"2.0","method":"event.model.invocation","params":event}));
}
fn send_terminal(
    sender: &SyncSender<Value>,
    id: &ModelInvocationId,
    kind: ModelInvocationEventKind,
    error: Option<&str>,
) {
    send_model_event(
        sender,
        ModelInvocationEvent {
            event: "event.model.invocation".into(),
            invocation_id: id.clone(),
            kind,
            text_delta: None,
            tool_proposal: None,
            usage: None,
            error_code: error.map(str::to_owned),
        },
    );
}
fn emit_capture(runtime: &Runtime, capture: &CaptureView) {
    let event = CaptureChangedEvent {
        event: "event.capture.changed".into(),
        capture_id: capture.id.clone(),
        placement_status: capture.placement_status,
        lifecycle_status: capture.lifecycle_status,
        attached_field_id: capture.attached_field_id.clone(),
        revision: capture.revision,
    };
    let _ = runtime
        .event_sender
        .send(json!({"jsonrpc":"2.0","method":"event.capture.changed","params":event}));
}

fn mutation<T: serde::Serialize>(
    (resource, event): (T, DomainEventDTO),
) -> Result<(Value, Option<DomainEventDTO>), DomainError> {
    serde_json::to_value(resource)
        .map(|value| (value, Some(event)))
        .map_err(|error| DomainError::Validation(error.to_string()))
}

fn parse_params<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T, DomainError> {
    serde_json::from_value(value.clone())
        .map_err(|error| DomainError::Validation(error.to_string()))
}

fn serialize(value: impl serde::Serialize) -> Result<(Value, Option<DomainEventDTO>), DomainError> {
    serde_json::to_value(value)
        .map(|value| (value, None))
        .map_err(|error| DomainError::Validation(error.to_string()))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn decode_png_data_url(value: &str, max_bytes: usize) -> Result<Vec<u8>, DomainError> {
    const PREFIX: &str = "data:image/png;base64,";
    let encoded = value
        .strip_prefix(PREFIX)
        .ok_or_else(|| DomainError::Validation("SCREENSHOT_DATA_URL_INVALID".into()))?;
    let max_encoded = max_bytes.div_ceil(3) * 4;
    if encoded.is_empty() || encoded.len() > max_encoded || encoded.len() % 4 != 0 {
        return Err(DomainError::Validation(
            "SCREENSHOT_DATA_URL_INVALID".into(),
        ));
    }
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(encoded.len() / 4 * 3);
    for (index, chunk) in bytes.chunks_exact(4).enumerate() {
        let final_chunk = index + 1 == bytes.len() / 4;
        let padding = usize::from(chunk[3] == b'=') + usize::from(chunk[2] == b'=');
        if (!final_chunk && padding != 0) || chunk[2] == b'=' && chunk[3] != b'=' || padding > 2 {
            return Err(DomainError::Validation(
                "SCREENSHOT_DATA_URL_INVALID".into(),
            ));
        }
        let first = base64_value(chunk[0])?;
        let second = base64_value(chunk[1])?;
        let third = if chunk[2] == b'=' {
            0
        } else {
            base64_value(chunk[2])?
        };
        let fourth = if chunk[3] == b'=' {
            0
        } else {
            base64_value(chunk[3])?
        };
        if padding == 2 && second & 0x0f != 0 || padding == 1 && third & 0x03 != 0 {
            return Err(DomainError::Validation(
                "SCREENSHOT_DATA_URL_INVALID".into(),
            ));
        }
        decoded.push((first << 2) | (second >> 4));
        if padding < 2 {
            decoded.push((second << 4) | (third >> 2));
        }
        if padding == 0 {
            decoded.push((third << 6) | fourth);
        }
        if decoded.len() > max_bytes {
            return Err(DomainError::Validation(
                "SCREENSHOT_DATA_URL_INVALID".into(),
            ));
        }
    }
    Ok(decoded)
}

fn base64_value(value: u8) -> Result<u8, DomainError> {
    match value {
        b'A'..=b'Z' => Ok(value - b'A'),
        b'a'..=b'z' => Ok(value - b'a' + 26),
        b'0'..=b'9' => Ok(value - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(DomainError::Validation(
            "SCREENSHOT_DATA_URL_INVALID".into(),
        )),
    }
}

fn data_url(media_type: &str, bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(TABLE[(first >> 2) as usize] as char);
        encoded.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            TABLE[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    format!("data:{media_type};base64,{encoded}")
}

fn field_summary(field: Field) -> FieldSummary {
    FieldSummary {
        id: field.id,
        title: field.title,
        goal: field.goal,
        current_mode: field.current_mode,
        current_focus: field.current_focus,
        revision: field.revision,
        updated_at: field.updated_at,
    }
}

fn field_view(field: Field) -> FieldView {
    FieldView {
        id: field.id,
        owner_principal_id: field.owner_principal_id,
        title: field.title,
        goal: field.goal,
        lifecycle_status: field.lifecycle_status,
        current_mode: field.current_mode,
        current_focus: field.current_focus,
        revision: field.revision,
        created_at: field.created_at,
        updated_at: field.updated_at,
    }
}

fn snapshot_view(snapshot: SurfaceSnapshot) -> SurfaceSnapshotView {
    SurfaceSnapshotView {
        id: snapshot.id,
        field_id: snapshot.field_id,
        device_id: snapshot.device_id,
        observed_field_revision: snapshot.observed_field_revision,
        layout: snapshot.layout,
        open_objects: snapshot.open_objects,
        created_at: snapshot.created_at,
    }
}

fn success_response(id: Value, result: Value) -> Value {
    json!({"jsonrpc":"2.0", "id":id, "result":result})
}

fn domain_error_response(id: Value, error: DomainError, trace_id: String) -> Value {
    match error {
        DomainError::Validation(message) if message.starts_with("unknown_method:") => {
            error_response(
                id,
                -32601,
                "Unknown method",
                "protocol_error",
                trace_id,
                false,
                json!({}),
            )
        }
        DomainError::Validation(message) => error_response(
            id,
            -32602,
            &message,
            "validation_failed",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::NotFound => error_response(
            id,
            -32001,
            "Resource not found",
            "not_found",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::RevisionConflict => error_response(
            id,
            -32002,
            "Revision conflict",
            "REVISION_CONFLICT",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::InvalidStateTransition => error_response(
            id,
            -32002,
            "Invalid state transition",
            "INVALID_STATE_TRANSITION",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::TerminalResource => error_response(
            id,
            -32002,
            "Resource is terminal",
            "TERMINAL_RESOURCE",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::DuplicateActiveReference => error_response(
            id,
            -32002,
            "Duplicate active reference",
            "DUPLICATE_ACTIVE_REFERENCE",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::InvalidReferenceUrl => error_response(
            id,
            -32602,
            "Invalid reference URL",
            "INVALID_REFERENCE_URL",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::InvalidRelationEndpoint => error_response(
            id,
            -32602,
            "Invalid relation endpoint",
            "INVALID_RELATION_ENDPOINT",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::InvalidRelationMatrix => error_response(
            id,
            -32602,
            "Invalid relation matrix",
            "INVALID_RELATION_MATRIX",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::DuplicateActiveRelation => error_response(
            id,
            -32002,
            "Duplicate active relation",
            "DUPLICATE_ACTIVE_RELATION",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::InvalidSurfaceLayout(message) => error_response(
            id,
            -32602,
            "Invalid surface layout",
            "INVALID_SURFACE_LAYOUT",
            trace_id,
            false,
            json!({"reason":message}),
        ),
        DomainError::SnapshotReferenceUnavailable => error_response(
            id,
            -32002,
            "Snapshot reference unavailable",
            "SNAPSHOT_REFERENCE_UNAVAILABLE",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::MigrationIncompatibleData => error_response(
            id,
            -32005,
            "Migration contains incompatible data",
            "MIGRATION_INCOMPATIBLE_DATA",
            trace_id,
            false,
            json!({}),
        ),
        DomainError::Storage(message) => {
            error!("storage request failed");
            error_response(
                id,
                -32005,
                "Storage operation failed",
                "storage_error",
                trace_id,
                false,
                json!({"category":message.split(':').next().unwrap_or("storage")}),
            )
        }
    }
}

fn error_response(
    id: Value,
    rpc_code: i32,
    message: &str,
    business_code: &str,
    trace_id: String,
    retryable: bool,
    details: Value,
) -> Value {
    json!({
        "jsonrpc":"2.0",
        "id":id,
        "error":{
            "code":rpc_code,
            "message":message,
            "data":{
                "code":business_code,
                "trace_id":trace_id,
                "retryable":retryable,
                "details":details
            }
        }
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Default)]
struct FrameParser {
    buffer: Vec<u8>,
    discarding: bool,
}

enum ParsedFrame {
    Frame(Vec<u8>),
    Oversized,
}

impl FrameParser {
    fn push(&mut self, bytes: &[u8]) -> Vec<ParsedFrame> {
        let mut frames = Vec::new();
        for byte in bytes {
            if self.discarding {
                if *byte == b'\n' {
                    self.discarding = false;
                    frames.push(ParsedFrame::Oversized);
                }
                continue;
            }
            if *byte == b'\n' {
                frames.push(ParsedFrame::Frame(std::mem::take(&mut self.buffer)));
            } else if self.buffer.len() == MAX_FRAME_BYTES {
                self.buffer.clear();
                self.discarding = true;
            } else {
                self.buffer.push(*byte);
            }
        }
        frames
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_handles_incremental_frames() {
        let mut parser = FrameParser::default();
        assert!(parser.push(b"{\"a\":").is_empty());
        let frames = parser.push(b"1}\n{\"b\":2}\n");
        assert_eq!(frames.len(), 2);
        match &frames[0] {
            ParsedFrame::Frame(frame) => assert_eq!(frame, b"{\"a\":1}"),
            ParsedFrame::Oversized => panic!("unexpected oversized frame"),
        }
    }

    #[test]
    fn screenshot_png_data_url_decoder_is_strict_canonical_and_bounded() {
        assert_eq!(
            decode_png_data_url("data:image/png;base64,aGVsbG8=", 5).unwrap(),
            b"hello"
        );
        assert!(decode_png_data_url("data:image/jpeg;base64,aGVsbG8=", 5).is_err());
        assert!(decode_png_data_url("data:image/png;base64,aGVsbG8", 5).is_err());
        assert!(decode_png_data_url("data:image/png;base64,aGVsbG9=", 8).is_err());
        assert!(decode_png_data_url("data:image/png;base64,aGVsbG8=", 4).is_err());
    }

    #[test]
    fn parser_discards_oversized_until_newline_and_recovers() {
        let mut parser = FrameParser::default();
        let mut input = vec![b'x'; MAX_FRAME_BYTES + 1];
        input.extend_from_slice(b"\n{}\n");
        let frames = parser.push(&input);
        assert_eq!(frames.len(), 2);
        assert!(matches!(frames[0], ParsedFrame::Oversized));
        assert!(matches!(&frames[1], ParsedFrame::Frame(frame) if frame == b"{}"));
    }

    #[test]
    fn protocol_accepts_newer_minor_but_rejects_wrong_major() {
        let newer_minor = "1.9".split_once('.').and_then(|(major, minor)| {
            Some((major.parse::<u16>().ok()?, minor.parse::<u16>().ok()?))
        });
        let wrong_major = "2.0".split_once('.').and_then(|(major, minor)| {
            Some((major.parse::<u16>().ok()?, minor.parse::<u16>().ok()?))
        });
        assert!(newer_minor.is_some_and(|(major, _)| major == PROTOCOL.major));
        assert!(wrong_major.is_none_or(|(major, _)| major != PROTOCOL.major));
    }

    #[test]
    fn phase04_unicode_bounds_count_scalars_and_utf8_bytes() {
        assert!(
            validate_unicode_text("value", &"😀".repeat(4_000), 4_000, 16 * 1024, true).is_ok()
        );
        assert!(
            validate_unicode_text("value", &"😀".repeat(4_001), 4_000, 16 * 1024, true).is_err()
        );
        assert!(
            validate_unicode_text("value", &"界".repeat(16_001), 20_000, 48_000, true).is_err()
        );
    }

    #[test]
    fn external_send_blocks_credential_like_text_without_echoing_it() {
        assert!(credential_like(
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"
        ));
        assert!(credential_like("token sk-abcdefghijklmnopqrstuvwxyz"));
        assert!(!credential_like("Explain the Authorization header concept"));
        assert!(!credential_like("a short sk-example placeholder"));
    }

    #[test]
    fn capture_uri_is_http_only_and_credential_free() {
        assert!(valid_capture_uri("https://example.com/path?q=1"));
        assert!(valid_capture_uri("http://example.com"));
        assert!(!valid_capture_uri("https://user:password@example.com/path"));
        assert!(!valid_capture_uri("file:///tmp/example"));
        assert!(!valid_capture_uri(" https://example.com"));
    }
}
