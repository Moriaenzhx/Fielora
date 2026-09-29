//! Local-first persistence infrastructure for Fielora product and Harness state.
//!
//! AgentRun projections, durable Agent events, approvals, context snapshots,
//! tool receipts, and verification receipts implement Harness.Continuity and
//! Harness.Verification & Evidence. Storage is infrastructure, not a separate
//! Agent layer or an independent source of execution authority.

pub mod idr;
mod model_usage;
pub mod sync;

use fielora_contracts::*;
use fielora_field::{
    Activity, DomainError, Field, FieldRepository, RealityRepository, SurfaceRepository,
    SurfaceSnapshot, canonicalize_https_url, parse_persisted_focus, validate_surface_layout,
};
use fielora_platform::DeviceIdentity;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use thiserror::Error;
use uuid::Uuid;

const MIGRATION_0001: &str = include_str!("../migrations/0001_core.sql");
const MIGRATION_0002: &str = include_str!("../migrations/0002_phase02_reality.sql");
const MIGRATION_0004: &str = include_str!("../migrations/0004_phase04_entry.sql");
const MIGRATION_0005: &str = include_str!("../migrations/0005_desktop_foundation.sql");
const MIGRATION_0006: &str = include_str!("../migrations/0006_complete_agent.sql");
const MIGRATION_0007: &str = include_str!("../migrations/0007_library_storage_profile.sql");
const MIGRATION_0008: &str = include_str!("../migrations/0008_durable_artifacts.sql");
const MIGRATION_0009: &str = include_str!("../migrations/0009_artifact_type_extensibility.sql");
const MIGRATION_0010: &str = include_str!("../migrations/0010_durable_source_assets.sql");
const MIGRATION_0011: &str = include_str!("../migrations/0011_artifact_archive_state.sql");
const MIGRATION_0012: &str = include_str!("../migrations/0012_idr_v2_human_model.sql");
const MIGRATION_0013: &str = include_str!("../migrations/0013_rich_result_typed_references.sql");
const MIGRATION_0014: &str = include_str!("../migrations/0014_durable_screenshot_evidence.sql");
const MIGRATION_0015: &str = include_str!("../migrations/0015_durable_file_artifacts.sql");
const MIGRATION_0001_NAME: &str = "core";
const MIGRATION_0002_NAME: &str = "phase02_reality";
const MIGRATION_0004_NAME: &str = "phase04_entry";
const MIGRATION_0005_NAME: &str = "desktop_foundation";
const MIGRATION_0006_NAME: &str = "complete_agent";
const MIGRATION_0007_NAME: &str = "library_storage_profile";
const MIGRATION_0008_NAME: &str = "durable_artifacts";
const MIGRATION_0009_NAME: &str = "artifact_type_extensibility";
const MIGRATION_0010_NAME: &str = "durable_source_assets";
const MIGRATION_0011_NAME: &str = "artifact_archive_state";
const MIGRATION_0012_NAME: &str = "idr_v2_human_model";
const MIGRATION_0013_NAME: &str = "rich_result_typed_references";
const MIGRATION_0014_NAME: &str = "durable_screenshot_evidence";
const MIGRATION_0015_NAME: &str = "durable_file_artifacts";
const MIGRATION_0002_FROZEN_SHA256: &str =
    "9152a933786c33a58769d1c0268084a4471113fd3eee1436d122dcb1986039f9";
const MIGRATION_0004_FROZEN_SHA256: &str =
    "4d142745b3e9a5ccd8c27f422ecdc888163a575a91b0515f90a1ee6aa0f869ab";
const MIGRATION_0005_FROZEN_SHA256: &str =
    "b7e1e586b47e50389502677e172741d69463e9518ed32211dfafe0dc910c1547";
const MIGRATION_0006_FROZEN_SHA256: &str =
    "5257959801424a13426259ce10c9ed2d5037795ec7a3a207171c568bc80dbaae";
const SCHEMA_VERSION: u32 = 16;
const MIGRATION_0016: &str = include_str!("../migrations/0016_agent_continuation_budget.sql");
const MIGRATION_0016_NAME: &str = "agent_continuation_budget";
pub const AGENT_CONTINUATION_STEPS: u32 = 24;
pub const AGENT_CUMULATIVE_STEP_LIMIT: u32 = 4096;
const LOCAL_USER_NAME: &str = "Local user";
const SYSTEM_NAME: &str = "Fielora system";

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("SQLite failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("migration checksum mismatch for version {version}")]
    MigrationChecksum { version: u32 },
    #[error("SQLite open gate failed: {0}")]
    OpenGate(String),
    #[error("storage worker stopped")]
    WorkerStopped,
    #[error("invalid persisted JSON: {0}")]
    InvalidJson(String),
    #[error("revision cannot be represented as SQLite INTEGER")]
    RevisionOutOfRange,
    #[error("MIGRATION_INCOMPATIBLE_DATA")]
    MigrationIncompatibleData,
}

enum StorageCommand {
    Task(Box<dyn FnOnce(&mut Connection) + Send>),
    CreateField {
        field: Field,
        activity: Activity,
        reply: SyncSender<Result<(), DomainError>>,
    },
    ListFields {
        reply: SyncSender<Result<Vec<Field>, DomainError>>,
    },
    GetField {
        field_id: FieldId,
        reply: SyncSender<Result<Field, DomainError>>,
    },
    UpdateFocus {
        field_id: FieldId,
        expected_revision: u64,
        focus: Value,
        updated_at: i64,
        activity: Activity,
        reply: SyncSender<Result<Field, DomainError>>,
    },
    SaveSnapshot {
        field_id: FieldId,
        device_id: DeviceId,
        layout: Value,
        open_objects: Vec<ObjectId>,
        created_at: i64,
        reply: SyncSender<Result<SurfaceSnapshot, DomainError>>,
    },
    LatestSnapshot {
        field_id: FieldId,
        device_id: DeviceId,
        reply: SyncSender<Result<Option<SurfaceSnapshot>, DomainError>>,
    },
    Shutdown,
}

#[derive(Clone)]
pub struct StorageHandle {
    sender: SyncSender<StorageCommand>,
    pub local_user: PrincipalId,
    pub device_id: DeviceId,
    pub profile_id: ProfileId,
    pub database_path: PathBuf,
}

pub struct StorageWorker {
    handle: StorageHandle,
    worker: Option<JoinHandle<()>>,
}

#[derive(Debug, Clone)]
pub struct ProviderConfigRecord {
    pub view: ProviderConfigView,
    pub credential_ref: String,
}

#[derive(Debug, Clone, Default)]
pub struct AgentProjectionUpdate {
    pub status: Option<AgentRunStatus>,
    pub current_step: Option<u32>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AgentEventCommit {
    pub event: AgentEventView,
    pub run: AgentRunView,
}

/// Trusted Harness-to-storage input. These provenance identifiers are supplied
/// by Fielora execution context and are never accepted from model tool arguments.
#[derive(Debug, Clone)]
pub struct CreateArtifactRecord {
    pub artifact_type: ArtifactType,
    pub title: Option<String>,
    pub project_field_id: Option<FieldId>,
    pub conversation_id: ConversationId,
    pub run_id: AgentRunId,
    pub tool_call_id: ToolCallId,
    pub content: ArtifactContentV1,
    pub canonical_content_json: String,
    pub semantic_sha256: String,
    pub mutation_request_sha256: String,
    pub now: i64,
}

#[derive(Debug, Clone)]
pub struct UpdateArtifactRecord {
    pub artifact_id: ArtifactId,
    pub expected_revision_id: ArtifactRevisionId,
    pub conversation_id: ConversationId,
    pub run_id: AgentRunId,
    pub tool_call_id: ToolCallId,
    pub content: ArtifactContentV1,
    pub canonical_content_json: String,
    pub semantic_sha256: String,
    pub mutation_request_sha256: String,
    pub now: i64,
}

#[derive(Debug, Clone)]
pub struct FileArtifactMutationRecord {
    pub relative_path: String,
    pub content: FileMutationArtifactV1,
    pub canonical_content_json: String,
    pub semantic_sha256: String,
}

/// Trusted Harness-to-storage input for one successful built-in file ToolCall.
/// A multi-file call commits all per-file revisions in one SQLite transaction.
#[derive(Debug, Clone)]
pub struct CommitFileArtifactMutationsRecord {
    pub project_field_id: FieldId,
    pub conversation_id: ConversationId,
    pub run_id: AgentRunId,
    pub tool_call_id: ToolCallId,
    pub mutation_request_sha256: String,
    pub mutations: Vec<FileArtifactMutationRecord>,
    pub now: i64,
}

#[derive(Debug, Clone)]
pub struct StoredFileArtifactRevision {
    pub read: ArtifactReadView,
    pub review_state: FileArtifactReviewState,
}

/// Trusted Harness-to-storage input for Artifact visibility state. Archive is
/// lifecycle metadata only: identity, revisions, references, and explicit
/// reads/exports remain available.
#[derive(Debug, Clone)]
pub struct SetArtifactArchiveStateRecord {
    pub artifact_id: ArtifactId,
    pub archived: bool,
    pub conversation_id: ConversationId,
    pub run_id: AgentRunId,
    pub tool_call_id: ToolCallId,
    pub mutation_request_sha256: String,
    pub now: i64,
}

/// Trusted Harness-to-storage input for one immutable source Asset. Encoded
/// bytes live in the shared content-addressed blob store, never in SQLite.
#[derive(Debug, Clone)]
pub struct CreateAssetRecord {
    pub media_type: AssetMediaType,
    pub content_sha256: String,
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
    pub blob_ref: String,
    pub conversation_id: ConversationId,
    pub run_id: AgentRunId,
    pub tool_call_id: ToolCallId,
    pub mutation_request_sha256: String,
    pub now: i64,
}

impl StorageWorker {
    pub fn start(
        database_path: &Path,
        device: DeviceIdentity,
        now: i64,
    ) -> Result<Self, StorageError> {
        let mut connection = open_connection(database_path)?;
        apply_migrations(&mut connection, now)?;
        let local_user = bootstrap_records(&mut connection, &device, now)?;
        let profile_id = connection
            .query_row(
                "SELECT profile_id FROM profiles WHERE singleton_key=1",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(ProfileId::new)?;
        let (sender, receiver) = mpsc::sync_channel(64);
        let path = database_path.to_path_buf();
        let worker = thread::Builder::new()
            .name("fielora-storage".into())
            .spawn(move || run_worker(connection, receiver))
            .map_err(|_| StorageError::WorkerStopped)?;
        let handle = StorageHandle {
            sender,
            local_user,
            device_id: device.id,
            profile_id,
            database_path: path,
        };
        Ok(Self {
            handle,
            worker: Some(worker),
        })
    }

    pub fn handle(&self) -> StorageHandle {
        self.handle.clone()
    }

    pub fn shutdown(mut self) {
        let _ = self.handle.sender.send(StorageCommand::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for StorageWorker {
    fn drop(&mut self) {
        let _ = self.handle.sender.send(StorageCommand::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl StorageHandle {
    pub fn create_project(
        &self,
        request: CreateProjectRequest,
        now: i64,
    ) -> Result<ProjectView, DomainError> {
        let owner = self.local_user.clone();
        let device = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            let field_id = FieldId::new(Uuid::now_v7().to_string());
            let binding_id = Uuid::now_v7().to_string();
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO fields(id,owner_principal_id,title,goal,lifecycle_status,current_mode,current_focus_json,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,'ACTIVE',NULL,NULL,1,?5,?5)",
                params![field_id.0, owner.0, request.title, request.goal, now],
            ).map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO device_bindings(id,device_id,object_id,binding_kind,local_locator,metadata_json,created_at,updated_at) VALUES(?1,?2,?3,'PROJECT_ROOT',?4,'{\"version\":1}',?5,?5)",
                params![binding_id, device.0, field_id.0, request.root_path, now],
            ).map_err(storage_domain)?;
            insert_simple_activity(
                &transaction,
                Some(&field_id),
                &owner,
                "FIELD_CREATED",
                "FIELD",
                &field_id.0,
                now,
            )?;
            transaction.commit().map_err(storage_domain)?;
            get_project(connection, &owner, &device, &field_id)
        })
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectView>, DomainError> {
        let owner = self.local_user.clone();
        let device = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            let mut statement = connection.prepare(
                "SELECT f.id,f.title,f.goal,COALESCE(b.local_locator,''),f.revision,f.created_at,MAX(f.updated_at,COALESCE((SELECT MAX(c.updated_at) FROM conversations c WHERE c.field_id=f.id AND c.lifecycle_status='ACTIVE'),f.updated_at)) AS project_activity_at FROM fields f LEFT JOIN device_bindings b ON b.object_id=f.id AND b.device_id=?1 AND b.binding_kind='PROJECT_ROOT' WHERE f.owner_principal_id=?2 AND f.lifecycle_status='ACTIVE' ORDER BY project_activity_at DESC,f.id DESC"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(params![device.0, owner.0], project_from_row)
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn get_project(&self, field_id: FieldId) -> Result<ProjectView, DomainError> {
        let owner = self.local_user.clone();
        let device = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            get_project(connection, &owner, &device, &field_id)
        })
    }

    pub fn rebind_project(
        &self,
        request: RebindProjectRequest,
        now: i64,
    ) -> Result<ProjectView, DomainError> {
        let owner = self.local_user.clone();
        let device = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            if request.root_path.trim().is_empty() || request.root_path.len() > 32_767 {
                return Err(DomainError::Validation("invalid Project root".into()));
            }
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM fields WHERE id=?1 AND owner_principal_id=?2 AND lifecycle_status='ACTIVE'",
                params![request.field_id.0, owner.0], |row| row.get(0),
            ).map_err(storage_domain)?;
            if exists != 1 {
                return Err(DomainError::NotFound);
            }
            connection.execute(
                "INSERT INTO device_bindings(id,device_id,object_id,binding_kind,local_locator,metadata_json,created_at,updated_at) VALUES(?1,?2,?3,'PROJECT_ROOT',?4,'{\"version\":1}',?5,?5) ON CONFLICT(device_id,object_id,binding_kind) DO UPDATE SET local_locator=excluded.local_locator,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at",
                params![Uuid::now_v7().to_string(), device.0, request.field_id.0, request.root_path, now],
            ).map_err(storage_domain)?;
            get_project(connection, &owner, &device, &request.field_id)
        })
    }

    pub fn update_project(
        &self,
        request: UpdateProjectRequest,
        now: i64,
    ) -> Result<ProjectView, DomainError> {
        let owner = self.local_user.clone();
        let device = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            let changed = connection.execute(
                "UPDATE fields SET title=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND owner_principal_id=?4 AND revision=?5 AND lifecycle_status='ACTIVE' AND id IN (SELECT object_id FROM device_bindings WHERE device_id=?6 AND binding_kind='PROJECT_ROOT')",
                params![request.title, now, request.field_id.0, owner.0, revision_to_domain(request.expected_revision)?, device.0],
            ).map_err(storage_domain)?;
            if changed == 0 {
                return project_revision_or_not_found(
                    connection,
                    &owner,
                    &device,
                    &request.field_id,
                );
            }
            get_project(connection, &owner, &device, &request.field_id)
        })
    }

    pub fn archive_project(
        &self,
        request: ArchiveProjectRequest,
        now: i64,
    ) -> Result<ProjectView, DomainError> {
        let owner = self.local_user.clone();
        let device = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            let mut project = get_project(connection, &owner, &device, &request.field_id)?;
            let transaction = connection.transaction().map_err(storage_domain)?;
            let changed = transaction.execute(
                "UPDATE fields SET lifecycle_status='ARCHIVED',revision=revision+1,updated_at=?1 WHERE id=?2 AND owner_principal_id=?3 AND revision=?4 AND lifecycle_status='ACTIVE' AND id IN (SELECT object_id FROM device_bindings WHERE device_id=?5 AND binding_kind='PROJECT_ROOT')",
                params![now, request.field_id.0, owner.0, revision_to_domain(request.expected_revision)?, device.0],
            ).map_err(storage_domain)?;
            if changed == 0 {
                return project_revision_or_not_found(
                    &transaction,
                    &owner,
                    &device,
                    &request.field_id,
                );
            }
            insert_simple_activity(
                &transaction,
                Some(&request.field_id),
                &owner,
                "FIELD_ARCHIVED",
                "FIELD",
                &request.field_id.0,
                now,
            )?;
            transaction.commit().map_err(storage_domain)?;
            project.revision += 1;
            project.updated_at = now;
            Ok(project)
        })
    }

    pub fn create_conversation(
        &self,
        request: CreateConversationRequest,
        now: i64,
    ) -> Result<ConversationView, DomainError> {
        let owner = self.local_user.clone();
        let device = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            get_project(connection, &owner, &device, &request.field_id)?;
            ensure_provider_available(connection, &owner, request.provider_config_id.as_ref())?;
            let id = ConversationId::new(Uuid::now_v7().to_string());
            connection.execute(
                "INSERT INTO conversations(id,field_id,title,provider_config_id,model_id,lifecycle_status,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'ACTIVE',1,?6,?6)",
                params![id.0, request.field_id.0, request.title, request.provider_config_id.map(|value| value.0), request.model_id, now],
            ).map_err(storage_domain)?;
            get_conversation(connection, &owner, &id)
        })
    }

    pub fn list_conversations(
        &self,
        field_id: FieldId,
    ) -> Result<Vec<ConversationView>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let mut statement = connection.prepare(
                "SELECT c.id,c.field_id,c.title,c.provider_config_id,c.model_id,c.lifecycle_status,c.revision,c.created_at,c.updated_at FROM conversations c JOIN fields f ON f.id=c.field_id WHERE c.field_id=?1 AND f.owner_principal_id=?2 AND c.lifecycle_status='ACTIVE' ORDER BY c.updated_at DESC,c.id DESC"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(params![field_id.0, owner.0], conversation_from_row)
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn get_conversation(&self, id: ConversationId) -> Result<ConversationView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_conversation(connection, &owner, &id)
        })
    }

    pub fn update_conversation(
        &self,
        request: UpdateConversationRequest,
        now: i64,
    ) -> Result<ConversationView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            ensure_provider_available(connection, &owner, request.provider_config_id.as_ref())?;
            let changed = connection.execute(
                "UPDATE conversations SET title=?1,provider_config_id=?2,model_id=?3,revision=revision+1,updated_at=?4 WHERE id=?5 AND revision=?6 AND lifecycle_status='ACTIVE' AND field_id IN (SELECT id FROM fields WHERE owner_principal_id=?7)",
                params![request.title, request.provider_config_id.map(|value| value.0), request.model_id, now, request.conversation_id.0, revision_to_domain(request.expected_revision)?, owner.0],
            ).map_err(storage_domain)?;
            if changed == 0 {
                return conversation_revision_or_not_found(
                    connection,
                    &owner,
                    &request.conversation_id,
                );
            }
            get_conversation(connection, &owner, &request.conversation_id)
        })
    }

    pub fn archive_conversation(
        &self,
        request: ArchiveConversationRequest,
        now: i64,
    ) -> Result<ConversationView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let changed = connection.execute(
                "UPDATE conversations SET lifecycle_status='ARCHIVED',revision=revision+1,updated_at=?1 WHERE id=?2 AND revision=?3 AND lifecycle_status='ACTIVE' AND field_id IN (SELECT id FROM fields WHERE owner_principal_id=?4)",
                params![now, request.conversation_id.0, revision_to_domain(request.expected_revision)?, owner.0],
            ).map_err(storage_domain)?;
            if changed == 0 {
                return conversation_revision_or_not_found(
                    connection,
                    &owner,
                    &request.conversation_id,
                );
            }
            get_conversation(connection, &owner, &request.conversation_id)
        })
    }

    pub fn create_conversation_message(
        &self,
        request: CreateConversationMessageRequest,
        now: i64,
    ) -> Result<ConversationMessageView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let conversation = get_conversation(connection, &owner, &request.conversation_id)?;
            if conversation.lifecycle_status != ConversationLifecycle::Active {
                return Err(DomainError::TerminalResource);
            }
            ensure_provider_available(connection, &owner, request.provider_config_id.as_ref())?;
            if request
                .references
                .iter()
                .any(|reference| matches!(&reference.target, ResultReferenceTarget::Image { .. }))
                && (request.role != ConversationMessageRole::Assistant
                    || request.status != ConversationMessageStatus::Completed)
            {
                return Err(DomainError::Validation(
                    "RESULT_IMAGE_COMPLETED_ASSISTANT_ONLY".into(),
                ));
            }
            validate_result_references(
                connection,
                &owner,
                &conversation,
                &request.content,
                &request.references,
            )?;
            let references_json = serde_json::to_string(&request.references)
                .map_err(|error| DomainError::Validation(error.to_string()))?;
            if references_json.len() > 1_048_576 {
                return Err(DomainError::Validation(
                    "RESULT_REFERENCE_SIDECAR_TOO_LARGE".into(),
                ));
            }
            let id = MessageId::new(Uuid::now_v7().to_string());
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO conversation_messages(id,conversation_id,role,content,status,provider_config_id,model_id,invocation_id,references_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![id.0, request.conversation_id.0, wire(&request.role), request.content, wire(&request.status), request.provider_config_id.map(|value| value.0), request.model_id, request.invocation_id.map(|value| value.0), references_json, now],
            ).map_err(storage_domain)?;
            transaction
                .execute(
                    "UPDATE conversations SET revision=revision+1,updated_at=?1 WHERE id=?2",
                    params![now, request.conversation_id.0],
                )
                .map_err(storage_domain)?;
            transaction.commit().map_err(storage_domain)?;
            get_conversation_message(connection, &owner, &id)
        })
    }

    pub fn list_conversation_messages(
        &self,
        conversation_id: ConversationId,
    ) -> Result<Vec<ConversationMessageView>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_conversation(connection, &owner, &conversation_id)?;
            let mut statement = connection.prepare(
                "SELECT m.id,m.conversation_id,m.role,m.content,m.status,m.provider_config_id,m.model_id,m.invocation_id,m.references_json,m.created_at FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN fields f ON f.id=c.field_id WHERE m.conversation_id=?1 AND f.owner_principal_id=?2 ORDER BY m.created_at ASC,m.id ASC"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(
                    params![conversation_id.0, owner.0],
                    conversation_message_from_row,
                )
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn create_agent_run(
        &self,
        request: StartAgentRunRequest,
        now: i64,
    ) -> Result<AgentEventCommit, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let conversation = get_conversation(connection, &owner, &request.conversation_id)?;
            if conversation.lifecycle_status != ConversationLifecycle::Active
                || conversation.field_id != request.field_id
            {
                return Err(DomainError::Validation(
                    "AGENT_CONVERSATION_SCOPE_INVALID".into(),
                ));
            }
            let provider = get_provider_record(connection, &owner, &request.provider_config_id)?;
            if provider.view.lifecycle_status != ProviderLifecycle::Active {
                return Err(DomainError::Validation("PROVIDER_DISABLED".into()));
            }
            let resource_budget = request.resource_budget.unwrap_or_default();
            if !resource_budget.is_valid() {
                return Err(DomainError::Validation(
                    "AGENT_RESOURCE_BUDGET_INVALID".into(),
                ));
            }
            let model_id = request.model_id.unwrap_or(provider.view.default_model);
            let max_steps = request.max_steps.unwrap_or(AGENT_CUMULATIVE_STEP_LIMIT);
            if request
                .max_steps
                .is_some_and(|limit| !(1..=64).contains(&limit))
            {
                return Err(DomainError::Validation("AGENT_MAX_STEPS_INVALID".into()));
            }
            let run_id = AgentRunId::new(Uuid::now_v7().to_string());
            let event_id = AgentEventId::new(Uuid::now_v7().to_string());
            let payload = serde_json::json!({
                "permission": wire(&request.permission),
                "resource_budget": resource_budget,
                "user_message_id": request.user_message_id,
                "max_steps": max_steps,
                "task_bytes": request.task.len(),
                "input_attachment_count": request.attachments.as_ref().map_or(0, Vec::len),
                "active_work_surface": request.active_work_surface,
            });
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO agent_runs(id,field_id,conversation_id,provider_config_id,model_id,task,permission,status,current_step,max_steps,next_sequence,error_code,created_at,updated_at,finished_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'QUEUED',0,?8,2,NULL,?9,?9,NULL)",
                params![run_id.0,request.field_id.0,request.conversation_id.0,request.provider_config_id.0,model_id,request.task,wire(&request.permission),i64::from(max_steps),now],
            ).map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO agent_events(id,run_id,sequence,schema_version,kind,payload_json,created_at) VALUES(?1,?2,1,1,?3,?4,?5)",
                params![event_id.0,run_id.0,wire(&AgentEventKind::RunCreated),payload.to_string(),now],
            ).map_err(storage_domain)?;
            transaction.commit().map_err(storage_domain)?;
            let run = get_agent_run(connection, &owner, &run_id)?;
            Ok(AgentEventCommit {
                event: AgentEventView {
                    id: event_id,
                    run_id,
                    sequence: 1,
                    schema_version: 1,
                    kind: AgentEventKind::RunCreated,
                    payload,
                    created_at: now,
                },
                run,
            })
        })
    }

    pub fn get_agent_run(&self, run_id: AgentRunId) -> Result<AgentRunView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &run_id)
        })
    }

    pub fn list_agent_runs(
        &self,
        conversation_id: ConversationId,
    ) -> Result<Vec<AgentRunView>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_conversation(connection, &owner, &conversation_id)?;
            let mut statement = connection.prepare(
                "SELECT r.id,r.field_id,r.conversation_id,r.provider_config_id,r.model_id,r.task,r.permission,r.status,r.current_step,r.max_steps,r.next_sequence,r.error_code,r.created_at,r.updated_at,r.finished_at FROM agent_runs r JOIN fields f ON f.id=r.field_id WHERE r.conversation_id=?1 AND f.owner_principal_id=?2 ORDER BY r.updated_at DESC,r.id DESC"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(params![conversation_id.0, owner.0], agent_run_from_row)
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn append_agent_event(
        &self,
        run_id: AgentRunId,
        kind: AgentEventKind,
        payload: Value,
        update: AgentProjectionUpdate,
        now: i64,
    ) -> Result<AgentEventCommit, DomainError> {
        self.append_agent_event_inner(run_id, kind, payload, update, now, false)
    }

    /// Called only by the trusted user-resume ingress, never by a model tool.
    /// Status, allowance and the grant receipt commit in the same transaction.
    pub fn resume_agent_run(
        &self,
        run_id: AgentRunId,
        now: i64,
    ) -> Result<AgentEventCommit, DomainError> {
        self.resume_agent_run_with_budget(run_id, None, now)
    }

    pub fn resume_agent_run_with_budget(
        &self,
        run_id: AgentRunId,
        budget: Option<fielora_contracts::AgentResourceBudget>,
        now: i64,
    ) -> Result<AgentEventCommit, DomainError> {
        if budget.as_ref().is_some_and(|value| !value.is_valid()) {
            return Err(DomainError::Validation(
                "AGENT_RESOURCE_BUDGET_INVALID".into(),
            ));
        }
        self.append_agent_event_inner(
            run_id,
            AgentEventKind::RunResumed,
            serde_json::json!({"reason":"USER_RESUME","recompiled_context":true,"resource_budget":budget}),
            AgentProjectionUpdate {
                status: Some(AgentRunStatus::Running),
                ..Default::default()
            },
            now,
            true,
        )
    }

    fn append_agent_event_inner(
        &self,
        run_id: AgentRunId,
        kind: AgentEventKind,
        mut payload: Value,
        update: AgentProjectionUpdate,
        now: i64,
        explicit_resume: bool,
    ) -> Result<AgentEventCommit, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let current = get_agent_run(connection, &owner, &run_id)?;
            if current.status.is_terminal() {
                return Err(DomainError::TerminalResource);
            }
            let mut max_steps = current.max_steps;
            if explicit_resume {
                if current.status != AgentRunStatus::Paused {
                    return Err(DomainError::InvalidStateTransition);
                }
                // A deliberate continuation grants a new bounded work allowance,
                // even if verification/repetition paused just before exhaustion.
                // Automatic recovery never enters this trusted branch.
                payload["resource_budget_reset"] = serde_json::json!({
                    "source":"EXPLICIT_USER_RESUME", "previous_pause_reason":current.error_code,
                });
                if current.current_step >= max_steps {
                    if max_steps >= AGENT_CUMULATIVE_STEP_LIMIT {
                        return Err(DomainError::Validation(
                            "AGENT_CUMULATIVE_BUDGET_REACHED".into(),
                        ));
                    }
                    max_steps = max_steps
                        .saturating_add(AGENT_CONTINUATION_STEPS)
                        .min(AGENT_CUMULATIVE_STEP_LIMIT);
                    payload["budget_grant"] = serde_json::json!({
                        "source":"EXPLICIT_USER_RESUME", "previous_max_steps":current.max_steps,
                        "max_steps":max_steps, "additional_steps":max_steps-current.max_steps,
                    });
                }
            }
            let status = update.status.unwrap_or(current.status);
            if !current.status.can_transition_to(status) {
                return Err(DomainError::InvalidStateTransition);
            }
            let current_step = update.current_step.unwrap_or(current.current_step);
            if current_step > current.max_steps {
                return Err(DomainError::Validation("AGENT_STEP_BUDGET_EXCEEDED".into()));
            }
            if let Some(code) = update.error_code.as_deref()
                && (code.is_empty() || code.len() > 128)
            {
                return Err(DomainError::Validation("AGENT_ERROR_CODE_INVALID".into()));
            }
            let payload_json = payload.to_string();
            if payload_json.len() > 1024 * 1024 {
                return Err(DomainError::Validation("AGENT_EVENT_TOO_LARGE".into()));
            }
            let sequence = current.next_sequence;
            let event_id = AgentEventId::new(Uuid::now_v7().to_string());
            let finished_at = status.is_terminal().then_some(now);
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO agent_events(id,run_id,sequence,schema_version,kind,payload_json,created_at) VALUES(?1,?2,?3,1,?4,?5,?6)",
                params![event_id.0,run_id.0,revision_to_domain(sequence)?,wire(&kind),payload_json,now],
            ).map_err(storage_domain)?;
            transaction.execute(
                "UPDATE agent_runs SET status=?1,current_step=?2,next_sequence=?3,error_code=?4,updated_at=?5,finished_at=?6,max_steps=?8 WHERE id=?7",
                params![wire(&status),i64::from(current_step),revision_to_domain(sequence+1)?,update.error_code,now,finished_at,run_id.0,i64::from(max_steps)],
            ).map_err(storage_domain)?;
            transaction.commit().map_err(storage_domain)?;
            Ok(AgentEventCommit {
                event: AgentEventView {
                    id: event_id,
                    run_id: run_id.clone(),
                    sequence,
                    schema_version: 1,
                    kind,
                    payload,
                    created_at: now,
                },
                run: get_agent_run(connection, &owner, &run_id)?,
            })
        })
    }

    pub fn list_agent_events(
        &self,
        request: ListAgentEventsRequest,
    ) -> Result<Vec<AgentEventView>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &request.run_id)?;
            let after = request.after_sequence.unwrap_or(0);
            let limit = request.limit.unwrap_or(200).clamp(1, 500);
            let mut statement = connection.prepare(
                "SELECT id,run_id,sequence,schema_version,kind,payload_json,created_at FROM agent_events WHERE run_id=?1 AND sequence>?2 ORDER BY sequence ASC LIMIT ?3"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(
                    params![
                        request.run_id.0,
                        revision_to_domain(after)?,
                        i64::from(limit)
                    ],
                    agent_event_from_row,
                )
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn create_agent_tool_call(
        &self,
        run_id: AgentRunId,
        name: String,
        effect: AgentToolEffect,
        decision: AgentPolicyDecision,
        arguments: Value,
        now: i64,
    ) -> Result<AgentToolCallView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let run = get_agent_run(connection, &owner, &run_id)?;
            if run.status.is_terminal() {
                return Err(DomainError::TerminalResource);
            }
            if name.is_empty() || name.len() > 128 {
                return Err(DomainError::Validation("AGENT_TOOL_NAME_INVALID".into()));
            }
            let arguments_json = arguments.to_string();
            if arguments_json.len() > 1024 * 1024 {
                return Err(DomainError::Validation(
                    "AGENT_TOOL_ARGUMENTS_TOO_LARGE".into(),
                ));
            }
            let id = ToolCallId::new(Uuid::now_v7().to_string());
            connection.execute(
                "INSERT INTO agent_tool_calls(id,run_id,name,effect,status,policy_decision,arguments_json,receipt_json,error_code,created_at,updated_at,finished_at) VALUES(?1,?2,?3,?4,'PROPOSED',?5,?6,NULL,NULL,?7,?7,NULL)",
                params![id.0,run_id.0,name,wire(&effect),wire(&decision),arguments_json,now],
            ).map_err(storage_domain)?;
            get_agent_tool_call(connection, &owner, &id)
        })
    }

    pub fn update_agent_tool_call(
        &self,
        id: ToolCallId,
        status: AgentToolStatus,
        receipt: Option<Value>,
        error_code: Option<String>,
        now: i64,
    ) -> Result<AgentToolCallView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let current = get_agent_tool_call(connection, &owner, &id)?;
            if current.status.is_terminal() {
                return Err(DomainError::TerminalResource);
            }
            let receipt_json = receipt.map(|value| value.to_string());
            if receipt_json
                .as_ref()
                .is_some_and(|value| value.len() > 1024 * 1024)
            {
                return Err(DomainError::Validation(
                    "AGENT_TOOL_RECEIPT_TOO_LARGE".into(),
                ));
            }
            let finished_at = status.is_terminal().then_some(now);
            connection.execute(
                "UPDATE agent_tool_calls SET status=?1,receipt_json=?2,error_code=?3,updated_at=?4,finished_at=?5 WHERE id=?6",
                params![wire(&status),receipt_json,error_code,now,finished_at,id.0],
            ).map_err(storage_domain)?;
            get_agent_tool_call(connection, &owner, &id)
        })
    }

    pub fn reconcile_unknown_agent_tool_call(
        &self,
        id: ToolCallId,
        status: AgentToolStatus,
        receipt: Option<Value>,
        error_code: Option<String>,
        now: i64,
    ) -> Result<AgentToolCallView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let current = get_agent_tool_call(connection, &owner, &id)?;
            if current.status != AgentToolStatus::Unknown
                || !matches!(status, AgentToolStatus::Completed | AgentToolStatus::Failed)
            {
                return Err(DomainError::InvalidStateTransition);
            }
            let receipt_json = receipt.map(|value| value.to_string());
            if receipt_json
                .as_ref()
                .is_some_and(|value| value.len() > 1024 * 1024)
            {
                return Err(DomainError::Validation(
                    "AGENT_TOOL_RECEIPT_TOO_LARGE".into(),
                ));
            }
            connection
                .execute(
                    "UPDATE agent_tool_calls SET status=?1,receipt_json=?2,error_code=?3,updated_at=?4,finished_at=?4 WHERE id=?5 AND status='UNKNOWN'",
                    params![wire(&status), receipt_json, error_code, now, id.0],
                )
                .map_err(storage_domain)?;
            get_agent_tool_call(connection, &owner, &id)
        })
    }

    pub fn list_agent_tool_calls(
        &self,
        run_id: AgentRunId,
    ) -> Result<Vec<AgentToolCallView>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &run_id)?;
            let mut statement = connection.prepare(
                "SELECT t.id,t.run_id,t.name,t.effect,t.status,t.policy_decision,t.arguments_json,t.receipt_json,t.error_code,t.created_at,t.updated_at FROM agent_tool_calls t JOIN agent_runs r ON r.id=t.run_id JOIN fields f ON f.id=r.field_id WHERE t.run_id=?1 AND f.owner_principal_id=?2 ORDER BY t.created_at ASC,t.id ASC"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(params![run_id.0, owner.0], agent_tool_call_from_row)
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn create_agent_approval(
        &self,
        run_id: AgentRunId,
        tool_call_id: ToolCallId,
        now: i64,
    ) -> Result<ApprovalView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let run = get_agent_run(connection, &owner, &run_id)?;
            let tool = get_agent_tool_call(connection, &owner, &tool_call_id)?;
            if run.status.is_terminal()
                || tool.run_id != run_id
                || tool.status != AgentToolStatus::Proposed
                || tool.policy_decision != AgentPolicyDecision::Ask
            {
                return Err(DomainError::Validation("AGENT_APPROVAL_INVALID".into()));
            }
            let id = ApprovalId::new(Uuid::now_v7().to_string());
            let nonce = format!(
                "{}{}",
                Uuid::now_v7().as_simple(),
                Uuid::now_v7().as_simple()
            );
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO agent_approvals(id,run_id,tool_call_id,decision,nonce,created_at,resolved_at) VALUES(?1,?2,?3,NULL,?4,?5,NULL)",
                params![id.0,run_id.0,tool_call_id.0,nonce,now],
            ).map_err(storage_domain)?;
            transaction.execute(
                "UPDATE agent_tool_calls SET status='WAITING_APPROVAL',updated_at=?1 WHERE id=?2",
                params![now,tool_call_id.0],
            ).map_err(storage_domain)?;
            transaction
                .execute(
                    "UPDATE agent_runs SET status='WAITING_APPROVAL',updated_at=?1 WHERE id=?2",
                    params![now, run_id.0],
                )
                .map_err(storage_domain)?;
            transaction.commit().map_err(storage_domain)?;
            get_agent_approval(connection, &owner, &id)
        })
    }

    pub fn resolve_agent_approval(
        &self,
        request: ResolveAgentApprovalRequest,
        now: i64,
    ) -> Result<ApprovalView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let current = get_agent_approval(connection, &owner, &request.approval_id)?;
            if current.run_id != request.run_id || current.nonce != request.nonce {
                return Err(DomainError::Validation(
                    "AGENT_APPROVAL_REPLAY_DENIED".into(),
                ));
            }
            if current.decision.is_some() {
                return Err(DomainError::TerminalResource);
            }
            let tool_status = match request.decision {
                ApprovalDecision::AllowOnce => AgentToolStatus::Proposed,
                ApprovalDecision::Deny => AgentToolStatus::Denied,
            };
            let transaction = connection.transaction().map_err(storage_domain)?;
            let changed = transaction.execute(
                "UPDATE agent_approvals SET decision=?1,resolved_at=?2 WHERE id=?3 AND decision IS NULL AND nonce=?4",
                params![wire(&request.decision),now,request.approval_id.0,request.nonce],
            ).map_err(storage_domain)?;
            if changed != 1 {
                return Err(DomainError::TerminalResource);
            }
            transaction.execute(
                "UPDATE agent_tool_calls SET status=?1,error_code=?2,updated_at=?3,finished_at=?4 WHERE id=?5",
                params![wire(&tool_status),if tool_status==AgentToolStatus::Denied{Some("USER_DENIED")}else{None},now,if tool_status.is_terminal(){Some(now)}else{None},current.tool_call_id.0],
            ).map_err(storage_domain)?;
            transaction.execute(
                "UPDATE agent_runs SET status='RUNNING',updated_at=?1 WHERE id=?2 AND status='WAITING_APPROVAL'",
                params![now,request.run_id.0],
            ).map_err(storage_domain)?;
            transaction.commit().map_err(storage_domain)?;
            get_agent_approval(connection, &owner, &request.approval_id)
        })
    }

    pub fn save_agent_context_snapshot(
        &self,
        snapshot: AgentContextSnapshotView,
    ) -> Result<AgentContextSnapshotView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &snapshot.run_id)?;
            let manifest = snapshot.manifest.to_string();
            if manifest.len() > 1024 * 1024 {
                return Err(DomainError::Validation("AGENT_CONTEXT_TOO_LARGE".into()));
            }
            connection.execute(
                "INSERT INTO agent_context_snapshots(id,run_id,step,project_root_hash,selected_files,estimated_tokens,content_sha256,manifest_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![snapshot.id.0,snapshot.run_id.0,i64::from(snapshot.step),snapshot.project_root_hash,i64::from(snapshot.selected_files),i64::from(snapshot.estimated_tokens),snapshot.content_sha256,manifest,snapshot.created_at],
            ).map_err(storage_domain)?;
            Ok(snapshot)
        })
    }

    pub fn has_agent_context_snapshot(
        &self,
        run_id: AgentRunId,
        step: u32,
    ) -> Result<bool, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &run_id)?;
            connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM agent_context_snapshots WHERE run_id=?1 AND step=?2)",
                    params![run_id.0, i64::from(step)],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(storage_domain)
        })
    }

    pub fn get_agent_context_snapshot(
        &self,
        run_id: AgentRunId,
        step: u32,
    ) -> Result<AgentContextSnapshotView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &run_id)?;
            connection
                .query_row(
                    "SELECT id,project_root_hash,selected_files,estimated_tokens,content_sha256,manifest_json,created_at FROM agent_context_snapshots WHERE run_id=?1 AND step=?2",
                    params![run_id.0, i64::from(step)],
                    |row| {
                        let manifest: String = row.get(5)?;
                        Ok(AgentContextSnapshotView {
                            id: ContextSnapshotId::new(row.get::<_, String>(0)?),
                            run_id: run_id.clone(),
                            step,
                            project_root_hash: row.get(1)?,
                            selected_files: row.get::<_, u32>(2)?,
                            estimated_tokens: row.get::<_, u32>(3)?,
                            content_sha256: row.get(4)?,
                            manifest: serde_json::from_str(&manifest).unwrap_or(Value::Null),
                            created_at: row.get(6)?,
                        })
                    },
                )
                .map_err(storage_domain)
        })
    }

    pub fn record_agent_verification(
        &self,
        receipt: VerificationReceiptView,
    ) -> Result<VerificationReceiptView, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &receipt.run_id)?;
            if let Some(tool_call_id) = receipt.tool_call_id.as_ref() {
                let tool = get_agent_tool_call(connection, &owner, tool_call_id)?;
                if tool.run_id != receipt.run_id {
                    return Err(DomainError::Validation(
                        "AGENT_VERIFICATION_SCOPE_INVALID".into(),
                    ));
                }
            }
            let (subject_kind, subject_artifact_id, subject_revision_id, subject_sha256) =
                match receipt.subject.as_ref() {
                    None => (None, None, None, None),
                    Some(VerificationSubject::ArtifactRevision {
                        artifact_id,
                        revision_id,
                        semantic_sha256,
                    }) => {
                        let revision = get_artifact_revision(
                            connection,
                            &profile_id,
                            artifact_id,
                            revision_id,
                        )?;
                        if revision.semantic_sha256 != *semantic_sha256 {
                            return Err(DomainError::Validation(
                                "VERIFICATION_SUBJECT_INVALID".into(),
                            ));
                        }
                        (
                            Some("ARTIFACT_REVISION"),
                            Some(artifact_id.0.as_str()),
                            Some(revision_id.0.as_str()),
                            Some(semantic_sha256.as_str()),
                        )
                    }
                };
            connection.execute(
                "INSERT INTO agent_verification_receipts(id,run_id,tool_call_id,check_kind,outcome,summary,artifact_sha256,exit_code,created_at,subject_kind,subject_artifact_id,subject_revision_id,subject_sha256) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![receipt.id.0,receipt.run_id.0,receipt.tool_call_id.as_ref().map(|value|value.0.as_str()),receipt.check_kind,wire(&receipt.outcome),receipt.summary,receipt.artifact_sha256,receipt.exit_code,receipt.created_at,subject_kind,subject_artifact_id,subject_revision_id,subject_sha256],
            ).map_err(storage_domain)?;
            Ok(receipt)
        })
    }

    pub fn list_agent_verifications(
        &self,
        run_id: AgentRunId,
    ) -> Result<Vec<VerificationReceiptView>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &run_id)?;
            let mut statement = connection.prepare(
                "SELECT id,run_id,tool_call_id,check_kind,outcome,summary,artifact_sha256,exit_code,created_at,subject_kind,subject_artifact_id,subject_revision_id,subject_sha256 FROM agent_verification_receipts WHERE run_id=?1 ORDER BY created_at ASC,id ASC"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map([&run_id.0], verification_receipt_from_row)
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn list_artifact_revision_verifications(
        &self,
        artifact_id: ArtifactId,
        revision_id: ArtifactRevisionId,
    ) -> Result<Vec<VerificationReceiptView>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_artifact_revision(connection, &profile_id, &artifact_id, &revision_id)?;
            let mut statement = connection.prepare(
                "SELECT v.id,v.run_id,v.tool_call_id,v.check_kind,v.outcome,v.summary,v.artifact_sha256,v.exit_code,v.created_at,v.subject_kind,v.subject_artifact_id,v.subject_revision_id,v.subject_sha256 FROM agent_verification_receipts v JOIN artifacts a ON a.id=v.subject_artifact_id WHERE a.profile_id=?1 AND v.subject_kind='ARTIFACT_REVISION' AND v.subject_artifact_id=?2 AND v.subject_revision_id=?3 ORDER BY v.created_at ASC,v.id ASC"
            ).map_err(storage_domain)?;
            statement
                .query_map(
                    params![profile_id.0, artifact_id.0, revision_id.0],
                    verification_receipt_from_row,
                )
                .map_err(storage_domain)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)
        })
    }

    pub fn create_screenshot_evidence(
        &self,
        evidence: ScreenshotEvidenceView,
    ) -> Result<ScreenshotEvidenceView, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            validate_screenshot_evidence(connection, &owner, &evidence)?;
            connection.execute(
                "INSERT INTO screenshot_evidence(id,profile_id,content_sha256,blob_ref,mime_type,byte_size,width,height,source_kind,page_id,navigation_generation,captured_url,captured_at,conversation_id,run_id,tool_call_id,verification_receipt_id,visibility,retention_class,status,export_policy,sync_policy,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
                params![
                    evidence.id.0,
                    profile_id.0,
                    evidence.content_sha256,
                    evidence.blob_ref,
                    evidence.mime_type,
                    revision_to_domain(evidence.byte_size)?,
                    i64::from(evidence.width),
                    i64::from(evidence.height),
                    wire(&evidence.source_kind),
                    evidence.page_id,
                    revision_to_domain(evidence.navigation_generation)?,
                    evidence.captured_url,
                    evidence.captured_at,
                    evidence.conversation_id.as_ref().map(|value| value.0.as_str()),
                    evidence.run_id.as_ref().map(|value| value.0.as_str()),
                    evidence.tool_call_id.as_ref().map(|value| value.0.as_str()),
                    evidence.verification_receipt_id.as_ref().map(|value| value.0.as_str()),
                    wire(&evidence.visibility),
                    wire(&evidence.retention_class),
                    wire(&evidence.status),
                    wire(&evidence.export_policy),
                    wire(&evidence.sync_policy),
                    evidence.created_at,
                ],
            ).map_err(storage_domain)?;
            get_screenshot_evidence(connection, &profile_id, &evidence.id)
        })
    }

    pub fn get_screenshot_evidence(
        &self,
        id: ScreenshotEvidenceId,
    ) -> Result<ScreenshotEvidenceView, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_screenshot_evidence(connection, &profile_id, &id)
        })
    }

    pub fn list_screenshot_evidence_by_run(
        &self,
        run_id: AgentRunId,
    ) -> Result<Vec<ScreenshotEvidenceView>, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &run_id)?;
            list_screenshot_evidence(connection, &profile_id, "run_id", &run_id.0)
        })
    }

    pub fn list_screenshot_evidence_by_verification(
        &self,
        verification_receipt_id: VerificationReceiptId,
    ) -> Result<Vec<ScreenshotEvidenceView>, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_agent_verification_receipt(connection, &owner, &verification_receipt_id)?;
            list_screenshot_evidence(
                connection,
                &profile_id,
                "verification_receipt_id",
                &verification_receipt_id.0,
            )
        })
    }

    pub fn portable_blob_manifest(
        &self,
    ) -> Result<Vec<PortableBlobManifestEntryView>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            let mut statement = connection.prepare(
                "SELECT blob_ref,content_sha256,byte_size FROM (
                    SELECT blob_ref,content_hash AS content_sha256,size AS byte_size FROM library_objects WHERE profile_id=?1 AND kind='FILE'
                    UNION SELECT blob_ref,content_sha256,byte_length AS byte_size FROM assets WHERE profile_id=?1
                    UNION SELECT 'blobs/objects/' || substr(json_extract(r.content_json,'$.content.before.content_sha256'),1,2) || '/' || json_extract(r.content_json,'$.content.before.content_sha256'),json_extract(r.content_json,'$.content.before.content_sha256'),json_extract(r.content_json,'$.content.before.byte_length') FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE a.profile_id=?1 AND a.artifact_type='FILE_MUTATION' AND json_extract(r.content_json,'$.content.before.exists')=1
                    UNION SELECT 'blobs/objects/' || substr(json_extract(r.content_json,'$.content.after.content_sha256'),1,2) || '/' || json_extract(r.content_json,'$.content.after.content_sha256'),json_extract(r.content_json,'$.content.after.content_sha256'),json_extract(r.content_json,'$.content.after.byte_length') FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE a.profile_id=?1 AND a.artifact_type='FILE_MUTATION' AND json_extract(r.content_json,'$.content.after.exists')=1
                ) ORDER BY blob_ref ASC"
            ).map_err(storage_domain)?;
            statement
                .query_map([&profile_id.0], |row| {
                    Ok(PortableBlobManifestEntryView {
                        blob_ref: row.get(0)?,
                        content_sha256: row.get(1)?,
                        byte_size: row
                            .get::<_, i64>(2)?
                            .try_into()
                            .map_err(|_| conversion_error("portable blob size invalid".into()))?,
                    })
                })
                .map_err(storage_domain)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)
        })
    }

    pub fn create_artifact(
        &self,
        request: CreateArtifactRecord,
    ) -> Result<ArtifactReadView, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            validate_artifact_write_request(
                connection,
                &owner,
                &profile_id,
                "artifact.create",
                &request.run_id,
                &request.conversation_id,
                &request.tool_call_id,
                request.project_field_id.as_ref(),
                request.artifact_type,
                &request.content,
                &request.canonical_content_json,
                &request.semantic_sha256,
                &request.mutation_request_sha256,
            )?;
            if let Some(existing) =
                artifact_mutation_for_tool_call(connection, &profile_id, &request.tool_call_id)?
            {
                if existing.revision.mutation_kind == ArtifactMutationKind::Create
                    && existing.revision.semantic_sha256 == request.semantic_sha256
                    && artifact_mutation_request_sha(connection, &request.tool_call_id)?
                        == request.mutation_request_sha256
                {
                    return Ok(existing);
                }
                return Err(DomainError::Validation(
                    "ARTIFACT_TOOLCALL_IDEMPOTENCY_CONFLICT".into(),
                ));
            }
            let artifact_id = ArtifactId::new(Uuid::now_v7().to_string());
            let revision_id = ArtifactRevisionId::new(Uuid::now_v7().to_string());
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO artifacts(id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
                params![artifact_id.0,profile_id.0,wire(&request.artifact_type),request.title,request.project_field_id.as_ref().map(|value|value.0.as_str()),revision_id.0,request.conversation_id.0,request.run_id.0,device_id.0,request.now],
            ).map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO artifact_revisions(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_schema_version,content_json,semantic_sha256,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) VALUES(?1,?2,1,NULL,'CREATE',1,?3,?4,?5,?6,?7,?8,?9)",
                params![revision_id.0,artifact_id.0,request.canonical_content_json,request.semantic_sha256,request.mutation_request_sha256,request.conversation_id.0,request.run_id.0,request.tool_call_id.0,request.now],
            ).map_err(storage_domain)?;
            transaction.commit().map_err(storage_domain)?;
            get_artifact_read(connection, &profile_id, &artifact_id, Some(&revision_id))
        })
    }

    pub fn update_artifact(
        &self,
        request: UpdateArtifactRecord,
    ) -> Result<ArtifactReadView, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            let artifact = get_artifact(connection, &profile_id, &request.artifact_id)?;
            validate_artifact_write_request(
                connection,
                &owner,
                &profile_id,
                "artifact.update",
                &request.run_id,
                &request.conversation_id,
                &request.tool_call_id,
                artifact.project_field_id.as_ref(),
                artifact.artifact_type,
                &request.content,
                &request.canonical_content_json,
                &request.semantic_sha256,
                &request.mutation_request_sha256,
            )?;
            // Replay recognition intentionally precedes optimistic-concurrency
            // evaluation, so a committed revision can recover after a lost
            // ToolCall receipt without being mistaken for a stale update.
            if let Some(existing) =
                artifact_mutation_for_tool_call(connection, &profile_id, &request.tool_call_id)?
            {
                if existing.artifact.artifact_id == request.artifact_id
                    && existing.revision.mutation_kind == ArtifactMutationKind::Update
                    && existing.revision.parent_revision_id.as_ref()
                        == Some(&request.expected_revision_id)
                    && existing.revision.semantic_sha256 == request.semantic_sha256
                    && artifact_mutation_request_sha(connection, &request.tool_call_id)?
                        == request.mutation_request_sha256
                {
                    return Ok(existing);
                }
                return Err(DomainError::Validation(
                    "ARTIFACT_TOOLCALL_IDEMPOTENCY_CONFLICT".into(),
                ));
            }
            if artifact.current_revision_id != request.expected_revision_id {
                return Err(DomainError::RevisionConflict);
            }
            let parent = get_artifact_revision(
                connection,
                &profile_id,
                &request.artifact_id,
                &request.expected_revision_id,
            )?;
            let sequence = parent
                .sequence
                .checked_add(1)
                .ok_or_else(|| DomainError::Validation("ARTIFACT_REVISION_OVERFLOW".into()))?;
            let revision_id = ArtifactRevisionId::new(Uuid::now_v7().to_string());
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO artifact_revisions(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_schema_version,content_json,semantic_sha256,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) VALUES(?1,?2,?3,?4,'UPDATE',1,?5,?6,?7,?8,?9,?10,?11)",
                params![revision_id.0,request.artifact_id.0,revision_to_domain(sequence)?,request.expected_revision_id.0,request.canonical_content_json,request.semantic_sha256,request.mutation_request_sha256,request.conversation_id.0,request.run_id.0,request.tool_call_id.0,request.now],
            ).map_err(storage_domain)?;
            let changed = transaction.execute(
                "UPDATE artifacts SET current_revision_id=?1,updated_by_device=?2,updated_at=?3 WHERE id=?4 AND profile_id=?5 AND current_revision_id=?6",
                params![revision_id.0,device_id.0,request.now,request.artifact_id.0,profile_id.0,request.expected_revision_id.0],
            ).map_err(storage_domain)?;
            if changed != 1 {
                return Err(DomainError::RevisionConflict);
            }
            transaction.commit().map_err(storage_domain)?;
            get_artifact_read(
                connection,
                &profile_id,
                &request.artifact_id,
                Some(&revision_id),
            )
        })
    }

    pub fn commit_file_artifact_mutations(
        &self,
        request: CommitFileArtifactMutationsRecord,
    ) -> Result<Vec<ArtifactReadView>, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            validate_file_artifact_mutation_request(connection, &owner, &profile_id, &request)?;
            let existing = file_artifact_mutations_for_tool_call(
                connection,
                &profile_id,
                &request.tool_call_id,
            )?;
            if !existing.is_empty() {
                if file_artifact_replay_matches(connection, &request, &existing)? {
                    return Ok(existing);
                }
                return Err(DomainError::Validation(
                    "ARTIFACT_TOOLCALL_IDEMPOTENCY_CONFLICT".into(),
                ));
            }

            let transaction = connection.transaction().map_err(storage_domain)?;
            let mut committed = Vec::with_capacity(request.mutations.len());
            for mutation in &request.mutations {
                let existing_artifact_id = transaction
                    .query_row(
                        "SELECT artifact_id FROM file_artifact_bindings WHERE profile_id=?1 AND project_field_id=?2 AND relative_path=?3",
                        params![profile_id.0, request.project_field_id.0, mutation.relative_path],
                        |row| row.get::<_, String>(0).map(ArtifactId::new),
                    )
                    .optional()
                    .map_err(storage_domain)?;
                let revision_id = ArtifactRevisionId::new(Uuid::now_v7().to_string());
                let artifact_id = if let Some(artifact_id) = existing_artifact_id {
                    let artifact = get_artifact(&transaction, &profile_id, &artifact_id)?;
                    if artifact.artifact_type != ArtifactType::FileMutation
                        || artifact.project_field_id.as_ref() != Some(&request.project_field_id)
                    {
                        return Err(DomainError::Validation(
                            "FILE_ARTIFACT_BINDING_INVALID".into(),
                        ));
                    }
                    let parent = get_artifact_revision(
                        &transaction,
                        &profile_id,
                        &artifact_id,
                        &artifact.current_revision_id,
                    )?;
                    let sequence = parent.sequence.checked_add(1).ok_or_else(|| {
                        DomainError::Validation("ARTIFACT_REVISION_OVERFLOW".into())
                    })?;
                    transaction.execute(
                        "INSERT INTO artifact_revisions(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_schema_version,content_json,semantic_sha256,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) VALUES(?1,?2,?3,?4,'UPDATE',1,?5,?6,?7,?8,?9,?10,?11)",
                        params![revision_id.0,artifact_id.0,revision_to_domain(sequence)?,artifact.current_revision_id.0,mutation.canonical_content_json,mutation.semantic_sha256,request.mutation_request_sha256,request.conversation_id.0,request.run_id.0,request.tool_call_id.0,request.now],
                    ).map_err(storage_domain)?;
                    let changed = transaction.execute(
                        "UPDATE artifacts SET current_revision_id=?1,updated_by_device=?2,updated_at=?3 WHERE id=?4 AND profile_id=?5 AND current_revision_id=?6",
                        params![revision_id.0,device_id.0,request.now,artifact_id.0,profile_id.0,artifact.current_revision_id.0],
                    ).map_err(storage_domain)?;
                    if changed != 1 {
                        return Err(DomainError::RevisionConflict);
                    }
                    transaction.execute(
                        "UPDATE file_artifact_bindings SET updated_at=MAX(updated_at,?1) WHERE artifact_id=?2 AND profile_id=?3",
                        params![request.now,artifact_id.0,profile_id.0],
                    ).map_err(storage_domain)?;
                    artifact_id
                } else {
                    let artifact_id = ArtifactId::new(Uuid::now_v7().to_string());
                    transaction.execute(
                        "INSERT INTO artifacts(id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at) VALUES(?1,?2,'FILE_MUTATION',NULL,?3,?4,?5,?6,?7,?8,?8)",
                        params![artifact_id.0,profile_id.0,request.project_field_id.0,revision_id.0,request.conversation_id.0,request.run_id.0,device_id.0,request.now],
                    ).map_err(storage_domain)?;
                    transaction.execute(
                        "INSERT INTO artifact_revisions(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_schema_version,content_json,semantic_sha256,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) VALUES(?1,?2,1,NULL,'CREATE',1,?3,?4,?5,?6,?7,?8,?9)",
                        params![revision_id.0,artifact_id.0,mutation.canonical_content_json,mutation.semantic_sha256,request.mutation_request_sha256,request.conversation_id.0,request.run_id.0,request.tool_call_id.0,request.now],
                    ).map_err(storage_domain)?;
                    transaction.execute(
                        "INSERT INTO file_artifact_bindings(artifact_id,profile_id,project_field_id,relative_path,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)",
                        params![artifact_id.0,profile_id.0,request.project_field_id.0,mutation.relative_path,request.now],
                    ).map_err(storage_domain)?;
                    artifact_id
                };
                committed.push((artifact_id, revision_id));
            }
            transaction.commit().map_err(storage_domain)?;
            committed
                .into_iter()
                .map(|(artifact_id, revision_id)| {
                    get_artifact_read(connection, &profile_id, &artifact_id, Some(&revision_id))
                })
                .collect()
        })
    }

    pub fn file_artifact_mutations_by_tool_call(
        &self,
        tool_call_id: ToolCallId,
    ) -> Result<Vec<ArtifactReadView>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            file_artifact_mutations_for_tool_call(connection, &profile_id, &tool_call_id)
        })
    }

    pub fn list_file_artifact_revisions_by_run(
        &self,
        run_id: AgentRunId,
    ) -> Result<Vec<StoredFileArtifactRevision>, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_agent_run(connection, &owner, &run_id)?;
            let mut statement = connection.prepare(
                "SELECT r.artifact_id,r.id,CASE WHEN rr.revision_id IS NULL THEN 0 ELSE 1 END FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id LEFT JOIN artifact_revision_reviews rr ON rr.revision_id=r.id AND rr.profile_id=a.profile_id WHERE a.profile_id=?1 AND a.artifact_type='FILE_MUTATION' AND r.created_by_agent_run_id=?2 ORDER BY r.created_at ASC,r.sequence ASC,r.id ASC"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(params![profile_id.0, run_id.0], |row| {
                    Ok((
                        ArtifactId::new(row.get::<_, String>(0)?),
                        ArtifactRevisionId::new(row.get::<_, String>(1)?),
                        row.get::<_, bool>(2)?,
                    ))
                })
                .map_err(storage_domain)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)?;
            rows.into_iter()
                .map(|(artifact_id, revision_id, reviewed)| {
                    Ok(StoredFileArtifactRevision {
                        read: get_artifact_read(
                            connection,
                            &profile_id,
                            &artifact_id,
                            Some(&revision_id),
                        )?,
                        review_state: if reviewed {
                            FileArtifactReviewState::Reviewed
                        } else {
                            FileArtifactReviewState::Unreviewed
                        },
                    })
                })
                .collect()
        })
    }

    pub fn mark_file_artifact_revision_reviewed(
        &self,
        artifact_id: ArtifactId,
        revision_id: ArtifactRevisionId,
        now: i64,
    ) -> Result<FileArtifactReviewState, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            let read =
                get_artifact_read(connection, &profile_id, &artifact_id, Some(&revision_id))?;
            if read.artifact.artifact_type != ArtifactType::FileMutation {
                return Err(DomainError::Validation("FILE_ARTIFACT_TYPE_INVALID".into()));
            }
            connection.execute(
                "INSERT INTO artifact_revision_reviews(revision_id,profile_id,state,reviewed_by_principal_id,reviewed_at) VALUES(?1,?2,'REVIEWED',?3,?4) ON CONFLICT(revision_id) DO NOTHING",
                params![revision_id.0,profile_id.0,owner.0,now],
            ).map_err(storage_domain)?;
            Ok(FileArtifactReviewState::Reviewed)
        })
    }

    pub fn read_artifact(
        &self,
        artifact_id: ArtifactId,
        revision_id: Option<ArtifactRevisionId>,
    ) -> Result<ArtifactReadView, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_artifact_read(connection, &profile_id, &artifact_id, revision_id.as_ref())
        })
    }

    pub fn list_artifacts(
        &self,
        cursor: Option<ArtifactListCursor>,
        limit: u16,
        include_archived: bool,
    ) -> Result<ArtifactListView, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            if limit == 0 || limit > 100 {
                return Err(DomainError::Validation(
                    "ARTIFACT_LIST_LIMIT_INVALID".into(),
                ));
            }
            let cursor_updated_at = cursor.as_ref().map(|value| value.updated_at);
            let cursor_artifact_id = cursor.as_ref().map(|value| value.artifact_id.0.as_str());
            let mut statement = connection.prepare(
                "SELECT id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at,archived_at FROM artifacts WHERE profile_id=?1 AND artifact_type!='FILE_MUTATION' AND (?2 OR archived_at IS NULL) AND (?3 IS NULL OR updated_at < ?3 OR (updated_at = ?3 AND id < ?4)) ORDER BY updated_at DESC,id DESC LIMIT ?5"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(
                    params![
                        profile_id.0,
                        include_archived,
                        cursor_updated_at,
                        cursor_artifact_id,
                        i64::from(limit) + 1,
                    ],
                    artifact_from_row,
                )
                .map_err(storage_domain)?;
            let persisted = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)?;
            let mut artifacts = persisted
                .into_iter()
                .map(PersistedArtifactRow::into_view)
                .collect::<Result<Vec<_>, _>>()?;
            let has_more = artifacts.len() > usize::from(limit);
            if has_more {
                artifacts.pop();
            }
            let next_cursor = has_more.then(|| {
                let last = artifacts
                    .last()
                    .expect("bounded artifact page is non-empty");
                ArtifactListCursor {
                    updated_at: last.updated_at,
                    artifact_id: last.artifact_id.clone(),
                }
            });
            Ok(ArtifactListView {
                artifacts,
                next_cursor,
            })
        })
    }

    pub fn list_artifact_history(
        &self,
        artifact_id: ArtifactId,
        before_sequence: Option<u64>,
        limit: u16,
    ) -> Result<ArtifactHistoryView, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            if limit == 0 || limit > 100 {
                return Err(DomainError::Validation(
                    "ARTIFACT_HISTORY_LIMIT_INVALID".into(),
                ));
            }
            let before_sequence = before_sequence.map(revision_to_domain).transpose()?;
            let artifact = get_artifact(connection, &profile_id, &artifact_id)?;
            let mut statement = connection.prepare(
                "SELECT r.id,r.artifact_id,r.sequence,r.parent_revision_id,r.mutation_kind,r.content_schema_version,r.semantic_sha256,r.created_from_conversation_id,r.created_by_agent_run_id,r.created_by_tool_call_id,r.created_at FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE r.artifact_id=?1 AND a.profile_id=?2 AND (?3 IS NULL OR r.sequence < ?3) ORDER BY r.sequence DESC LIMIT ?4"
            ).map_err(storage_domain)?;
            let rows = statement
                .query_map(
                    params![
                        artifact_id.0,
                        profile_id.0,
                        before_sequence,
                        i64::from(limit) + 1
                    ],
                    artifact_revision_metadata_from_row,
                )
                .map_err(storage_domain)?;
            let mut revisions = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)?;
            let has_more = revisions.len() > usize::from(limit);
            if has_more {
                revisions.pop();
            }
            let next_before_sequence = has_more.then(|| {
                revisions
                    .last()
                    .expect("bounded artifact history page is non-empty")
                    .sequence
            });
            Ok(ArtifactHistoryView {
                artifact,
                revisions,
                next_before_sequence,
            })
        })
    }

    pub fn set_artifact_archive_state(
        &self,
        request: SetArtifactArchiveStateRecord,
    ) -> Result<ArtifactView, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            let run = get_agent_run(connection, &owner, &request.run_id)?;
            if run.conversation_id != request.conversation_id {
                return Err(DomainError::Validation(
                    "ARTIFACT_TRUSTED_CONTEXT_INVALID".into(),
                ));
            }
            let tool = get_agent_tool_call(connection, &owner, &request.tool_call_id)?;
            if tool.run_id != request.run_id || tool.name != "artifact.set_archive_state" {
                return Err(DomainError::Validation(
                    "ARTIFACT_TOOLCALL_SCOPE_INVALID".into(),
                ));
            }
            if current_profile_id(connection)? != profile_id
                || !valid_lower_sha256(&request.mutation_request_sha256)
            {
                return Err(DomainError::Validation("ARTIFACT_LIFECYCLE_INVALID".into()));
            }
            let artifact = get_artifact(connection, &profile_id, &request.artifact_id)?;
            let existing: Option<(String, String)> = connection
                .query_row(
                    "SELECT lifecycle_updated_by_tool_call_id,lifecycle_mutation_request_sha256 FROM artifacts WHERE id=?1 AND profile_id=?2 AND lifecycle_updated_by_tool_call_id IS NOT NULL",
                    params![request.artifact_id.0, profile_id.0],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(storage_domain)?;
            if let Some((tool_call_id, request_sha256)) = existing
                && tool_call_id == request.tool_call_id.0
            {
                if request_sha256 == request.mutation_request_sha256
                    && artifact.archived_at.is_some() == request.archived
                {
                    return Ok(artifact);
                }
                return Err(DomainError::Validation(
                    "ARTIFACT_TOOLCALL_IDEMPOTENCY_CONFLICT".into(),
                ));
            }
            let archived_at = request
                .archived
                .then_some(request.now.max(artifact.created_at));
            let changed = connection.execute(
                "UPDATE artifacts SET archived_at=?1,lifecycle_updated_by_tool_call_id=?2,lifecycle_mutation_request_sha256=?3,updated_by_device=?4,updated_at=MAX(updated_at,?5) WHERE id=?6 AND profile_id=?7",
                params![archived_at,request.tool_call_id.0,request.mutation_request_sha256,device_id.0,request.now,request.artifact_id.0,profile_id.0],
            ).map_err(storage_domain)?;
            if changed != 1 {
                return Err(DomainError::NotFound);
            }
            get_artifact(connection, &profile_id, &request.artifact_id)
        })
    }

    pub fn artifact_lifecycle_by_tool_call(
        &self,
        tool_call_id: ToolCallId,
    ) -> Result<Option<(ArtifactView, String)>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            let row = connection
                .query_row(
                    "SELECT id,lifecycle_mutation_request_sha256 FROM artifacts WHERE lifecycle_updated_by_tool_call_id=?1 AND profile_id=?2",
                    params![tool_call_id.0, profile_id.0],
                    |row| Ok((ArtifactId::new(row.get::<_, String>(0)?), row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(storage_domain)?;
            row.map(|(artifact_id, digest)| {
                get_artifact(connection, &profile_id, &artifact_id)
                    .map(|artifact| (artifact, digest))
            })
            .transpose()
        })
    }

    pub fn artifact_mutation_by_tool_call(
        &self,
        tool_call_id: ToolCallId,
    ) -> Result<Option<ArtifactReadView>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            artifact_mutation_for_tool_call(connection, &profile_id, &tool_call_id)
        })
    }

    pub fn artifact_mutation_request_sha256(
        &self,
        tool_call_id: ToolCallId,
    ) -> Result<Option<String>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            connection.query_row(
                "SELECT r.mutation_request_sha256 FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE r.created_by_tool_call_id=?1 AND a.profile_id=?2",
                params![tool_call_id.0,profile_id.0],
                |row| row.get(0),
            ).optional().map_err(storage_domain)
        })
    }

    pub fn create_asset(&self, request: CreateAssetRecord) -> Result<AssetView, DomainError> {
        let owner = self.local_user.clone();
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            let run = get_agent_run(connection, &owner, &request.run_id)?;
            if run.conversation_id != request.conversation_id {
                return Err(DomainError::Validation(
                    "ASSET_TRUSTED_CONTEXT_INVALID".into(),
                ));
            }
            let tool = get_agent_tool_call(connection, &owner, &request.tool_call_id)?;
            if tool.run_id != request.run_id || tool.name != "artifact.asset.import" {
                return Err(DomainError::Validation(
                    "ASSET_TOOLCALL_SCOPE_INVALID".into(),
                ));
            }
            if current_profile_id(connection)? != profile_id
                || request.media_type != AssetMediaType::Png
                || !valid_lower_sha256(&request.content_sha256)
                || !valid_lower_sha256(&request.mutation_request_sha256)
                || request.byte_length == 0
                || request.byte_length > 8 * 1024 * 1024
                || request.width == 0
                || request.width > 4096
                || request.height == 0
                || request.height > 4096
                || u64::from(request.width) * u64::from(request.height) > 16_777_216
                || request.blob_ref
                    != format!(
                        "blobs/objects/{}/{}",
                        &request.content_sha256[..2],
                        request.content_sha256
                    )
            {
                return Err(DomainError::Validation("ASSET_CONTENT_INVALID".into()));
            }
            if let Some(existing) =
                asset_for_tool_call(connection, &profile_id, &request.tool_call_id)?
            {
                let existing_request: String = connection
                    .query_row(
                        "SELECT mutation_request_sha256 FROM assets WHERE id=?1",
                        [&existing.asset_id.0],
                        |row| row.get(0),
                    )
                    .map_err(storage_domain)?;
                if existing_request == request.mutation_request_sha256
                    && existing.media_type == request.media_type
                    && existing.content_sha256 == request.content_sha256
                    && existing.byte_length == request.byte_length
                    && existing.width == request.width
                    && existing.height == request.height
                    && existing.blob_ref == request.blob_ref
                {
                    return Ok(existing);
                }
                return Err(DomainError::Validation(
                    "ASSET_TOOLCALL_IDEMPOTENCY_CONFLICT".into(),
                ));
            }
            let asset_id = AssetId::new(Uuid::now_v7().to_string());
            let byte_length = i64::try_from(request.byte_length)
                .map_err(|_| DomainError::Validation("ASSET_CONTENT_INVALID".into()))?;
            let transaction = connection.transaction().map_err(storage_domain)?;
            transaction.execute(
                "INSERT INTO assets(id,profile_id,media_type,content_sha256,byte_length,width,height,blob_ref,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![asset_id.0,profile_id.0,request.media_type.as_str(),request.content_sha256,byte_length,i64::from(request.width),i64::from(request.height),request.blob_ref,request.mutation_request_sha256,request.conversation_id.0,request.run_id.0,request.tool_call_id.0,request.now],
            ).map_err(storage_domain)?;
            transaction.commit().map_err(storage_domain)?;
            get_asset(connection, &profile_id, &asset_id)
        })
    }

    pub fn read_asset(&self, asset_id: AssetId) -> Result<AssetView, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            get_asset(connection, &profile_id, &asset_id)
        })
    }

    pub fn asset_by_tool_call(
        &self,
        tool_call_id: ToolCallId,
    ) -> Result<Option<AssetView>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            asset_for_tool_call(connection, &profile_id, &tool_call_id)
        })
    }

    pub fn asset_mutation_request_sha256(
        &self,
        tool_call_id: ToolCallId,
    ) -> Result<Option<String>, DomainError> {
        let profile_id = self.profile_id.clone();
        request_task(&self.sender, move |connection| {
            connection
                .query_row(
                    "SELECT mutation_request_sha256 FROM assets WHERE created_by_tool_call_id=?1 AND profile_id=?2",
                    params![tool_call_id.0, profile_id.0],
                    |row| row.get(0),
                )
                .optional()
                .map_err(storage_domain)
        })
    }

    pub fn reconcile_agent_runs(&self, now: i64) -> Result<Vec<AgentEventCommit>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let mut statement = connection.prepare(
                "SELECT r.id FROM agent_runs r JOIN fields f ON f.id=r.field_id WHERE f.owner_principal_id=?1 AND r.status='RUNNING' ORDER BY r.updated_at ASC,r.id ASC"
            ).map_err(storage_domain)?;
            let run_ids = statement
                .query_map([&owner.0], |row| row.get::<_, String>(0))
                .map_err(storage_domain)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)?;
            drop(statement);
            let mut commits = Vec::new();
            for raw_run_id in run_ids {
                let run_id = AgentRunId::new(raw_run_id);
                let current = get_agent_run(connection, &owner, &run_id)?;
                let mut tool_statement = connection.prepare(
                    "SELECT id FROM agent_tool_calls WHERE run_id=?1 AND status='RUNNING' ORDER BY created_at ASC,id ASC"
                ).map_err(storage_domain)?;
                let unknown_tools = tool_statement
                    .query_map([&run_id.0], |row| row.get::<_, String>(0))
                    .map_err(storage_domain)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(storage_domain)?;
                drop(tool_statement);
                let mut recovery_events = vec![(
                    AgentEventKind::RecoveryStarted,
                    serde_json::json!({"reason":"CORE_RESTARTED"}),
                )];
                recovery_events.extend(unknown_tools.iter().map(|tool_call_id| {
                    (
                        AgentEventKind::ToolUnknown,
                        serde_json::json!({
                            "reason":"CORE_RESTARTED",
                            "tool_call_id":tool_call_id,
                        }),
                    )
                }));
                recovery_events.push((
                    AgentEventKind::RunPaused,
                    serde_json::json!({
                        "reason":"CORE_RESTARTED",
                        "previous_status":"RUNNING",
                    }),
                ));
                recovery_events.push((
                    AgentEventKind::RecoveryReconciled,
                    serde_json::json!({
                        "reason":"CORE_RESTARTED",
                        "phase":"STARTUP_MARKED_UNKNOWN",
                        "unknown_tool_call_ids":unknown_tools,
                    }),
                ));
                let transaction = connection.transaction().map_err(storage_domain)?;
                transaction.execute(
                    "UPDATE agent_tool_calls SET status='UNKNOWN',error_code='CORE_RESTARTED',updated_at=?1,finished_at=?1 WHERE run_id=?2 AND status='RUNNING'",
                    params![now,run_id.0],
                ).map_err(storage_domain)?;
                let mut inserted = Vec::with_capacity(recovery_events.len());
                for (offset, (kind, payload)) in recovery_events.into_iter().enumerate() {
                    let event_id = AgentEventId::new(Uuid::now_v7().to_string());
                    let sequence = current.next_sequence + offset as u64;
                    transaction.execute(
                        "INSERT INTO agent_events(id,run_id,sequence,schema_version,kind,payload_json,created_at) VALUES(?1,?2,?3,1,?4,?5,?6)",
                        params![event_id.0,run_id.0,revision_to_domain(sequence)?,wire(&kind),payload.to_string(),now],
                    ).map_err(storage_domain)?;
                    inserted.push((event_id, sequence, kind, payload));
                }
                transaction.execute(
                    "UPDATE agent_runs SET status='PAUSED',next_sequence=?1,error_code='CORE_RESTARTED',updated_at=?2 WHERE id=?3",
                    params![revision_to_domain(current.next_sequence+inserted.len() as u64)?,now,run_id.0],
                ).map_err(storage_domain)?;
                transaction.commit().map_err(storage_domain)?;
                let recovered_run = get_agent_run(connection, &owner, &run_id)?;
                commits.extend(inserted.into_iter().map(|(id, sequence, kind, payload)| {
                    AgentEventCommit {
                        event: AgentEventView {
                            id,
                            run_id: run_id.clone(),
                            sequence,
                            schema_version: 1,
                            kind,
                            payload,
                            created_at: now,
                        },
                        run: recovered_run.clone(),
                    }
                }));
            }
            Ok(commits)
        })
    }

    pub fn create_provider_config(
        &self,
        request: CreateProviderConfigRequest,
        now: i64,
    ) -> Result<ProviderConfigRecord, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let id = ProviderConfigId::new(Uuid::now_v7().to_string());
            let credential_ref = format!("Fielora/provider/{}", id.0);
            let endpoint = match request.provider_kind {
                ProviderKind::OpenaiCompatible => EndpointClass::Custom,
                _ => EndpointClass::Official,
            };
            let tx = connection.transaction().map_err(storage_domain)?;
            tx.execute(
                "INSERT INTO provider_configs(id,owner_principal_id,provider_kind,display_name,endpoint_class,base_url,default_model,credential_ref,lifecycle_status,custom_endpoint_acknowledged_at,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'DISABLED',?9,1,?10,?10)",
                params![id.0, owner.0, wire(&request.provider_kind), request.display_name, wire(&endpoint), request.base_url, request.default_model, credential_ref, if request.custom_endpoint_acknowledged { Some(now) } else { None }, now]
            ).map_err(storage_domain)?;
            insert_simple_activity(
                &tx,
                None,
                &owner,
                "PROVIDER_CONFIG_CREATED",
                "PROVIDER_CONFIG",
                &id.0,
                now,
            )?;
            tx.commit().map_err(storage_domain)?;
            get_provider_record(connection, &owner, &id)
        })
    }

    pub fn list_provider_configs(&self) -> Result<Vec<ProviderConfigRecord>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let mut statement=connection.prepare("SELECT id,provider_kind,display_name,endpoint_class,base_url,default_model,credential_ref,lifecycle_status,revision,created_at,updated_at FROM provider_configs WHERE owner_principal_id=?1 AND lifecycle_status!='REMOVED' ORDER BY updated_at DESC,id DESC").map_err(storage_domain)?;
            let rows = statement
                .query_map([&owner.0], provider_record_from_row)
                .map_err(storage_domain)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
        })
    }

    pub fn get_provider_config(
        &self,
        id: ProviderConfigId,
    ) -> Result<ProviderConfigRecord, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_provider_record(connection, &owner, &id)
        })
    }

    pub fn update_provider_config(
        &self,
        request: UpdateProviderConfigRequest,
        now: i64,
    ) -> Result<ProviderConfigRecord, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let acknowledged = if request.custom_endpoint_acknowledged {
                Some(now)
            } else {
                None
            };
            let tx = connection.transaction().map_err(storage_domain)?;
            let changed=tx.execute("UPDATE provider_configs SET display_name=?1,base_url=?2,default_model=?3,custom_endpoint_acknowledged_at=?4,revision=revision+1,updated_at=?5 WHERE id=?6 AND owner_principal_id=?7 AND revision=?8 AND lifecycle_status!='REMOVED'",params![request.display_name,request.base_url,request.default_model,acknowledged,now,request.provider_config_id.0,owner.0,revision_to_domain(request.expected_revision)?]).map_err(storage_domain)?;
            if changed == 0 {
                return provider_revision_or_not_found(
                    &tx,
                    &owner,
                    &request.provider_config_id,
                    request.expected_revision,
                );
            }
            insert_simple_activity(
                &tx,
                None,
                &owner,
                "PROVIDER_CONFIG_UPDATED",
                "PROVIDER_CONFIG",
                &request.provider_config_id.0,
                now,
            )?;
            tx.commit().map_err(storage_domain)?;
            get_provider_record(connection, &owner, &request.provider_config_id)
        })
    }

    pub fn set_provider_credential_present(
        &self,
        id: ProviderConfigId,
        present: bool,
        now: i64,
    ) -> Result<ProviderConfigRecord, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let lifecycle = if present { "ACTIVE" } else { "DISABLED" };
            let changed=connection.execute("UPDATE provider_configs SET lifecycle_status=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND owner_principal_id=?4 AND lifecycle_status!='REMOVED'",params![lifecycle,now,id.0,owner.0]).map_err(storage_domain)?;
            if changed == 0 {
                return Err(DomainError::NotFound);
            }
            get_provider_record(connection, &owner, &id)
        })
    }

    pub fn remove_provider_config(
        &self,
        id: ProviderConfigId,
        now: i64,
    ) -> Result<ProviderConfigRecord, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let tx = connection.transaction().map_err(storage_domain)?;
            let changed=tx.execute("UPDATE provider_configs SET lifecycle_status='REMOVED',revision=revision+1,updated_at=?1 WHERE id=?2 AND owner_principal_id=?3 AND lifecycle_status!='REMOVED'",params![now,id.0,owner.0]).map_err(storage_domain)?;
            if changed == 0 {
                return Err(DomainError::NotFound);
            }
            insert_simple_activity(
                &tx,
                None,
                &owner,
                "PROVIDER_CONFIG_REMOVED",
                "PROVIDER_CONFIG",
                &id.0,
                now,
            )?;
            tx.commit().map_err(storage_domain)?;
            get_provider_record(connection, &owner, &id)
        })
    }

    pub fn create_capture(
        &self,
        request: CreateCaptureRequest,
        now: i64,
    ) -> Result<CaptureView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let id = CaptureId::new(Uuid::now_v7().to_string());
            let activity_id = Uuid::now_v7().to_string();
            let tx = connection.transaction().map_err(storage_domain)?;
            insert_simple_activity_with_id(
                &tx,
                &activity_id,
                None,
                &owner,
                "CAPTURE_CREATED",
                "CAPTURE",
                &id.0,
                now,
            )?;
            tx.execute("INSERT INTO captures(id,owner_principal_id,created_by,source_activity_id,kind,title,content,placement_status,lifecycle_status,source_kind,source_title,source_uri,source_field_id,source_resource_type,source_resource_id,source_resource_revision,provider_config_id,provider_model_id,provider_invocation_id,source_is_partial,revision,created_at,updated_at) VALUES(?1,?2,?2,?3,?4,?5,?6,'INBOX','ACTIVE',?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,1,?18,?18)",params![id.0,owner.0,activity_id,wire(&request.kind),request.title,request.content,wire(&request.source.kind),request.source.title,request.source.uri,request.source.field_id.map(|v|v.0),request.source.resource_type,request.source.resource_id,request.source.resource_revision.map(revision_to_domain).transpose()?,request.source.provider_config_id.map(|v|v.0),request.source.provider_model_id,request.source.provider_invocation_id.map(|v|v.0),request.source.is_partial as i32,now]).map_err(storage_domain)?;
            tx.commit().map_err(storage_domain)?;
            get_capture(connection, &owner, &id)
        })
    }

    pub fn get_capture(&self, id: CaptureId) -> Result<CaptureView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            get_capture(connection, &owner, &id)
        })
    }

    pub fn list_captures(
        &self,
        request: ListCapturesRequest,
    ) -> Result<Page<CaptureView, CaptureCursor>, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            list_captures(connection, &owner, &request)
        })
    }

    pub fn attach_capture(
        &self,
        request: AttachCaptureRequest,
        now: i64,
    ) -> Result<CaptureView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            mutate_capture_placement(
                connection,
                &owner,
                &request.capture_id,
                request.expected_revision,
                Some(&request.field_id),
                "ATTACHED",
                None,
                "CAPTURE_ATTACHED",
                now,
            )
        })
    }

    pub fn promote_capture(
        &self,
        request: PromoteCaptureRequest,
        now: i64,
    ) -> Result<CaptureView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            mutate_capture_placement(
                connection,
                &owner,
                &request.capture_id,
                request.expected_revision,
                request.field_id.as_ref(),
                "PROMOTED",
                Some("IDEA_CANDIDATE"),
                "CAPTURE_PROMOTED",
                now,
            )
        })
    }

    pub fn set_capture_archived(
        &self,
        id: CaptureId,
        expected_revision: u64,
        archived: bool,
        now: i64,
    ) -> Result<CaptureView, DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            let target = if archived { "ARCHIVED" } else { "ACTIVE" };
            let action = if archived {
                "CAPTURE_ARCHIVED"
            } else {
                "CAPTURE_RESTORED"
            };
            let tx = connection.transaction().map_err(storage_domain)?;
            let changed=tx.execute("UPDATE captures SET lifecycle_status=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND owner_principal_id=?4 AND revision=?5",params![target,now,id.0,owner.0,revision_to_domain(expected_revision)?]).map_err(storage_domain)?;
            if changed == 0 {
                return capture_revision_or_not_found(&tx, &owner, &id, expected_revision);
            }
            insert_simple_activity(&tx, None, &owner, action, "CAPTURE", &id.0, now)?;
            tx.commit().map_err(storage_domain)?;
            get_capture(connection, &owner, &id)
        })
    }

    pub fn profile(&self) -> Result<ProfileView, DomainError> {
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            connection
                .query_row(
                    "SELECT profile_id,schema_version,created_at FROM profiles WHERE singleton_key=1",
                    [],
                    |row| Ok(ProfileView {
                        profile_id: ProfileId::new(row.get::<_, String>(0)?),
                        schema_version: row.get::<_, u32>(1)?,
                        created_at: row.get(2)?,
                        device_id: device_id.clone(),
                    }),
                )
                .map_err(storage_domain)
        })
    }

    pub fn create_library_file(
        &self,
        request: CreateLibraryFileRequest,
        now: i64,
    ) -> Result<LibraryObjectView, DomainError> {
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            validate_library_file_request(&request)?;
            let id = LibraryObjectId::new(Uuid::now_v7().to_string());
            let profile_id = current_profile_id(connection)?;
            let metadata = serde_json::to_string(&request.metadata)
                .map_err(|error| DomainError::Validation(error.to_string()))?;
            let tx = connection.transaction().map_err(storage_domain)?;
            tx.execute(
                "INSERT INTO library_objects(id,profile_id,kind,media_kind,title,original_source,original_filename,mime_type,size,blob_ref,content_hash,metadata_json,lifecycle,revision,updated_by_device,created_at,updated_at,deleted_at) VALUES(?1,?2,'FILE',?3,?4,?5,?6,?7,?8,?9,?10,?11,'ACTIVE',1,?12,?13,?13,NULL)",
                params![id.0, profile_id.0, wire(&request.media_kind), request.title, request.original_source, request.original_filename, request.mime_type, revision_to_domain(request.size)?, request.blob_ref, request.content_hash, metadata, device_id.0, now],
            ).map_err(storage_domain)?;
            insert_sync_change(&tx, &profile_id, &device_id, &id, "CREATE", 1, now)?;
            tx.commit().map_err(storage_domain)?;
            get_library_object(connection, &id)
        })
    }

    pub fn save_web_library(
        &self,
        request: SaveWebLibraryRequest,
        now: i64,
    ) -> Result<LibraryObjectView, DomainError> {
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            if request.title.trim().is_empty() || request.title.chars().count() > 512 {
                return Err(DomainError::Validation("invalid Library title".into()));
            }
            if !(request.url.starts_with("https://") || request.url.starts_with("http://"))
                || request.url.len() > 2048
            {
                return Err(DomainError::Validation("invalid Library web URL".into()));
            }
            let id = LibraryObjectId::new(Uuid::now_v7().to_string());
            let profile_id = current_profile_id(connection)?;
            let mut metadata = request.metadata;
            if !metadata.is_object() {
                return Err(DomainError::Validation(
                    "Library metadata must be an object".into(),
                ));
            }
            if let Some(selected) = request.selected_content {
                if selected.chars().count() > 16_000 {
                    return Err(DomainError::Validation(
                        "selected content is too large".into(),
                    ));
                }
                metadata["selected_content"] = Value::String(selected);
            }
            metadata["source"] = Value::String(request.source);
            let metadata = serde_json::to_string(&metadata)
                .map_err(|error| DomainError::Validation(error.to_string()))?;
            let tx = connection.transaction().map_err(storage_domain)?;
            tx.execute(
                "INSERT INTO library_objects(id,profile_id,kind,media_kind,title,original_source,original_filename,mime_type,size,blob_ref,content_hash,metadata_json,lifecycle,revision,updated_by_device,created_at,updated_at,deleted_at) VALUES(?1,?2,'WEB','WEB',?3,?4,NULL,'text/html',NULL,NULL,NULL,?5,'ACTIVE',1,?6,?7,?7,NULL)",
                params![id.0, profile_id.0, request.title, request.url, metadata, device_id.0, now],
            ).map_err(storage_domain)?;
            insert_sync_change(&tx, &profile_id, &device_id, &id, "CREATE", 1, now)?;
            tx.commit().map_err(storage_domain)?;
            get_library_object(connection, &id)
        })
    }

    pub fn get_library_object(
        &self,
        id: LibraryObjectId,
    ) -> Result<LibraryObjectView, DomainError> {
        request_task(&self.sender, move |connection| {
            get_library_object(connection, &id)
        })
    }

    pub fn list_library_objects(
        &self,
        request: ListLibraryObjectsRequest,
    ) -> Result<Vec<LibraryObjectView>, DomainError> {
        request_task(&self.sender, move |connection| {
            let limit = request.limit.unwrap_or(200).clamp(1, 500) as i64;
            let lifecycle = if request.include_deleted {
                None
            } else {
                Some("ACTIVE")
            };
            let media = request.media_kind.as_ref().map(wire);
            let mut statement = connection.prepare(
                "SELECT id,kind,media_kind,title,original_source,original_filename,mime_type,size,blob_ref,content_hash,metadata_json,lifecycle,revision,updated_by_device,created_at,updated_at,deleted_at FROM library_objects WHERE (?1 IS NULL OR lifecycle=?1) AND (?2 IS NULL OR media_kind=?2) ORDER BY updated_at DESC,id DESC LIMIT ?3"
            ).map_err(storage_domain)?;
            statement
                .query_map(params![lifecycle, media, limit], library_object_from_row)
                .map_err(storage_domain)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)
        })
    }

    pub fn delete_library_object(
        &self,
        request: DeleteLibraryObjectRequest,
        now: i64,
    ) -> Result<LibraryObjectView, DomainError> {
        let device_id = self.device_id.clone();
        request_task(&self.sender, move |connection| {
            let profile_id = current_profile_id(connection)?;
            let next_revision = request
                .expected_revision
                .checked_add(1)
                .ok_or_else(|| DomainError::Validation("revision overflow".into()))?;
            let tx = connection.transaction().map_err(storage_domain)?;
            let changed = tx.execute(
                "UPDATE library_objects SET lifecycle='TOMBSTONE',revision=revision+1,updated_by_device=?1,updated_at=?2,deleted_at=?2 WHERE id=?3 AND lifecycle='ACTIVE' AND revision=?4",
                params![device_id.0, now, request.library_object_id.0, revision_to_domain(request.expected_revision)?],
            ).map_err(storage_domain)?;
            if changed == 0 {
                return match get_library_object(&tx, &request.library_object_id) {
                    Ok(_) => Err(DomainError::RevisionConflict),
                    Err(error) => Err(error),
                };
            }
            insert_sync_change(
                &tx,
                &profile_id,
                &device_id,
                &request.library_object_id,
                "TOMBSTONE",
                next_revision,
                now,
            )?;
            tx.commit().map_err(storage_domain)?;
            get_library_object(connection, &request.library_object_id)
        })
    }

    pub fn list_sync_changes(&self) -> Result<Vec<SyncChangeView>, DomainError> {
        request_task(&self.sender, move |connection| {
            let mut statement = connection.prepare(
                "SELECT change_id,profile_id,device_id,entity_type,entity_id,operation,revision,changed_at FROM sync_change_journal ORDER BY changed_at ASC,change_id ASC"
            ).map_err(storage_domain)?;
            statement
                .query_map([], |row| {
                    Ok(SyncChangeView {
                        change_id: SyncChangeId::new(row.get::<_, String>(0)?),
                        profile_id: ProfileId::new(row.get::<_, String>(1)?),
                        device_id: DeviceId::new(row.get::<_, String>(2)?),
                        entity_type: row.get(3)?,
                        entity_id: row.get(4)?,
                        operation: parse_wire(row.get(5)?)?,
                        revision: revision_from_row(row, 6)?,
                        changed_at: row.get(7)?,
                    })
                })
                .map_err(storage_domain)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_domain)
        })
    }

    pub fn record_model_terminal(
        &self,
        field_id: Option<FieldId>,
        provider_config_id: ProviderConfigId,
        model_id: String,
        completed: bool,
        now: i64,
    ) -> Result<(), DomainError> {
        let owner = self.local_user.clone();
        request_task(&self.sender, move |connection| {
            if model_id.len() > 256 {
                return Err(DomainError::Validation("model id too long".into()));
            }
            let action = if completed {
                "MODEL_INVOCATION_COMPLETED"
            } else {
                "MODEL_INVOCATION_FAILED"
            };
            let summary=serde_json::json!({"provider_config_id":provider_config_id.0,"model_id":model_id,"terminal":if completed{"COMPLETED"}else{"FAILED"}}).to_string();
            connection.execute("INSERT INTO activities(id,field_id,actor_principal_id,intent,action,target_type,target_id,summary,trace_id,created_at) VALUES(?1,?2,?3,NULL,?4,'PROVIDER_CONFIG',?5,?6,?7,?8)",params![Uuid::now_v7().to_string(),field_id.map(|v|v.0),owner.0,action,provider_config_id.0,summary,Uuid::now_v7().to_string(),now]).map_err(storage_domain)?;
            Ok(())
        })
    }
}

impl FieldRepository for StorageHandle {
    fn create_field(&self, field: &Field, activity: &Activity) -> Result<(), DomainError> {
        request(&self.sender, |reply| StorageCommand::CreateField {
            field: field.clone(),
            activity: activity.clone(),
            reply,
        })
    }

    fn list_active_fields(&self) -> Result<Vec<Field>, DomainError> {
        request(&self.sender, |reply| StorageCommand::ListFields { reply })
    }

    fn get_field(&self, field_id: &FieldId) -> Result<Field, DomainError> {
        request(&self.sender, |reply| StorageCommand::GetField {
            field_id: field_id.clone(),
            reply,
        })
    }

    fn update_focus(
        &self,
        field_id: &FieldId,
        expected_revision: u64,
        focus: &Value,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<Field, DomainError> {
        request(&self.sender, |reply| StorageCommand::UpdateFocus {
            field_id: field_id.clone(),
            expected_revision,
            focus: focus.clone(),
            updated_at,
            activity: activity.clone(),
            reply,
        })
    }

    fn update_mode(
        &self,
        field_id: &FieldId,
        expected_revision: u64,
        mode: Option<FieldMode>,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<Field, DomainError> {
        let field_id = field_id.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            update_mode(
                connection,
                &field_id,
                expected_revision,
                mode,
                updated_at,
                &activity,
            )
        })
    }

    fn set_focus_v1(
        &self,
        field_id: &FieldId,
        expected_revision: u64,
        focus: Option<&FieldFocusV1>,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<Field, DomainError> {
        let field_id = field_id.clone();
        let focus = focus.cloned();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            set_focus_v1(
                connection,
                &field_id,
                expected_revision,
                focus.as_ref(),
                updated_at,
                &activity,
            )
        })
    }
}

impl SurfaceRepository for StorageHandle {
    fn save_snapshot(
        &self,
        field_id: &FieldId,
        device_id: &DeviceId,
        layout: &Value,
        open_objects: &[ObjectId],
        created_at: i64,
    ) -> Result<SurfaceSnapshot, DomainError> {
        request(&self.sender, |reply| StorageCommand::SaveSnapshot {
            field_id: field_id.clone(),
            device_id: device_id.clone(),
            layout: layout.clone(),
            open_objects: open_objects.to_vec(),
            created_at,
            reply,
        })
    }

    fn latest_snapshot(
        &self,
        field_id: &FieldId,
        device_id: &DeviceId,
    ) -> Result<Option<SurfaceSnapshot>, DomainError> {
        request(&self.sender, |reply| StorageCommand::LatestSnapshot {
            field_id: field_id.clone(),
            device_id: device_id.clone(),
            reply,
        })
    }

    fn save_snapshot_v1(
        &self,
        field_id: &FieldId,
        device_id: &DeviceId,
        layout: &SurfaceLayoutV1,
        open_references: &[ObjectId],
        created_at: i64,
    ) -> Result<SurfaceSnapshotV1View, DomainError> {
        let field_id = field_id.clone();
        let device_id = device_id.clone();
        let layout = layout.clone();
        let open_references = open_references.to_vec();
        request_task(&self.sender, move |connection| {
            save_snapshot_v1(
                connection,
                &field_id,
                &device_id,
                &layout,
                &open_references,
                created_at,
            )
        })
    }
}

impl RealityRepository for StorageHandle {
    fn create_state(
        &self,
        state: &StateView,
        activity: &Activity,
    ) -> Result<RealityMutationResult<StateView>, DomainError> {
        let state = state.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            create_state(connection, &state, &activity)
        })
    }

    fn get_state(&self, field_id: &FieldId, state_id: &StateId) -> Result<StateView, DomainError> {
        let field_id = field_id.clone();
        let state_id = state_id.clone();
        request_task(&self.sender, move |connection| {
            get_state(connection, &field_id, &state_id)
        })
    }

    fn list_states(
        &self,
        request: &ListStatesRequest,
    ) -> Result<Page<StateView, StateCursor>, DomainError> {
        let request = request.clone();
        request_task(&self.sender, move |connection| {
            list_states(connection, &request)
        })
    }

    fn revise_state(
        &self,
        request: &ReviseStateRequest,
        content: &str,
        confidence: Option<f64>,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<RealityMutationResult<StateView>, DomainError> {
        let request = request.clone();
        let content = content.to_owned();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            revise_state(
                connection, &request, &content, confidence, updated_at, &activity,
            )
        })
    }

    fn transition_state(
        &self,
        request: &TransitionStateRequest,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<RealityMutationResult<StateView>, DomainError> {
        let request = request.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            transition_state(connection, &request, updated_at, &activity)
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn supersede_state(
        &self,
        request: &SupersedeStateRequest,
        replacement_id: &StateId,
        relation_id: &RelationId,
        replacement_content: &str,
        replacement_confidence: Option<f64>,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<SupersedeStateResult, DomainError> {
        let request = request.clone();
        let replacement_id = replacement_id.clone();
        let relation_id = relation_id.clone();
        let content = replacement_content.to_owned();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            supersede_state(
                connection,
                &request,
                &replacement_id,
                &relation_id,
                &content,
                replacement_confidence,
                updated_at,
                &activity,
            )
        })
    }

    fn create_reference(
        &self,
        reference: &ReferenceView,
        activity: &Activity,
    ) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
        let reference = reference.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            create_reference(connection, &reference, &activity)
        })
    }

    fn get_reference(
        &self,
        field_id: &FieldId,
        object_id: &ObjectId,
    ) -> Result<ReferenceView, DomainError> {
        let field_id = field_id.clone();
        let object_id = object_id.clone();
        request_task(&self.sender, move |connection| {
            get_reference(connection, &field_id, &object_id)
        })
    }

    fn list_references(
        &self,
        request: &ListReferencesRequest,
    ) -> Result<Page<ReferenceView, ReferenceCursor>, DomainError> {
        let request = request.clone();
        request_task(&self.sender, move |connection| {
            list_references(connection, &request)
        })
    }

    fn revise_reference(
        &self,
        request: &ReviseReferenceRequest,
        title: &str,
        canonical_url: &str,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
        let request = request.clone();
        let title = title.to_owned();
        let url = canonical_url.to_owned();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            revise_reference(connection, &request, &title, &url, updated_at, &activity)
        })
    }

    fn archive_reference(
        &self,
        request: &ArchiveReferenceRequest,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
        let request = request.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            archive_reference(connection, &request, updated_at, &activity)
        })
    }

    fn restore_reference(
        &self,
        request: &RestoreReferenceRequest,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
        let request = request.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            restore_reference(connection, &request, updated_at, &activity)
        })
    }

    fn attach_reference_source(
        &self,
        request: &AttachReferenceSourceRequest,
        relation_id: &RelationId,
        created_at: i64,
        activity: &Activity,
    ) -> Result<RealityMutationResult<RelationView>, DomainError> {
        let request = request.clone();
        let relation_id = relation_id.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            attach_reference_source(connection, &request, &relation_id, created_at, &activity)
        })
    }

    fn retract_reference_source(
        &self,
        request: &RetractReferenceSourceRequest,
        updated_at: i64,
        activity: &Activity,
    ) -> Result<RealityMutationResult<RelationView>, DomainError> {
        let request = request.clone();
        let activity = activity.clone();
        request_task(&self.sender, move |connection| {
            retract_reference_source(connection, &request, updated_at, &activity)
        })
    }

    fn list_relations(
        &self,
        request: &ListRelationsRequest,
    ) -> Result<Page<RelationView, RelationCursor>, DomainError> {
        let request = request.clone();
        request_task(&self.sender, move |connection| {
            list_relations(connection, &request)
        })
    }

    fn list_activities(
        &self,
        request: &ListActivitiesRequest,
    ) -> Result<Page<ActivityView, ActivityCursor>, DomainError> {
        let request = request.clone();
        request_task(&self.sender, move |connection| {
            list_activities(connection, &request)
        })
    }

    fn resume_v1(
        &self,
        field_id: &FieldId,
        device_id: &DeviceId,
    ) -> Result<FieldResumeV1View, DomainError> {
        let field_id = field_id.clone();
        let device_id = device_id.clone();
        request_task(&self.sender, move |connection| {
            resume_v1(connection, &field_id, &device_id)
        })
    }
}

fn wire<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn parse_wire<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_value(Value::String(value))
        .map_err(|error| conversion_error(error.to_string()))
}

fn current_profile_id(connection: &Connection) -> Result<ProfileId, DomainError> {
    connection
        .query_row(
            "SELECT profile_id FROM profiles WHERE singleton_key=1",
            [],
            |row| row.get::<_, String>(0),
        )
        .map(ProfileId::new)
        .map_err(storage_domain)
}

fn validate_library_file_request(request: &CreateLibraryFileRequest) -> Result<(), DomainError> {
    if request.title.trim().is_empty() || request.title.chars().count() > 512 {
        return Err(DomainError::Validation("invalid Library title".into()));
    }
    if request.original_filename.trim().is_empty()
        || request.original_filename.chars().count() > 512
    {
        return Err(DomainError::Validation("invalid Library filename".into()));
    }
    if request.size == 0 || request.original_source.len() > 32_767 {
        return Err(DomainError::Validation("invalid Library file".into()));
    }
    if request.content_hash.len() != 64
        || !request
            .content_hash
            .bytes()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
    {
        return Err(DomainError::Validation(
            "invalid Library content hash".into(),
        ));
    }
    let expected_ref = format!(
        "blobs/objects/{}/{}",
        &request.content_hash[..2],
        request.content_hash
    );
    if request.blob_ref != expected_ref || !request.metadata.is_object() {
        return Err(DomainError::Validation(
            "invalid Library blob binding".into(),
        ));
    }
    if request.media_kind == LibraryMediaKind::Web {
        return Err(DomainError::Validation(
            "file media kind cannot be WEB".into(),
        ));
    }
    Ok(())
}

fn insert_sync_change(
    transaction: &Transaction<'_>,
    profile_id: &ProfileId,
    device_id: &DeviceId,
    entity_id: &LibraryObjectId,
    operation: &str,
    revision: u64,
    changed_at: i64,
) -> Result<(), DomainError> {
    transaction.execute(
        "INSERT INTO sync_change_journal(change_id,profile_id,device_id,entity_type,entity_id,operation,revision,changed_at) VALUES(?1,?2,?3,'LIBRARY_OBJECT',?4,?5,?6,?7)",
        params![Uuid::now_v7().to_string(), profile_id.0, device_id.0, entity_id.0, operation, revision_to_domain(revision)?, changed_at],
    ).map_err(storage_domain)?;
    Ok(())
}

fn library_object_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryObjectView> {
    let metadata: String = row.get(10)?;
    Ok(LibraryObjectView {
        id: LibraryObjectId::new(row.get::<_, String>(0)?),
        kind: parse_wire(row.get(1)?)?,
        media_kind: parse_wire(row.get(2)?)?,
        title: row.get(3)?,
        original_source: row.get(4)?,
        original_filename: row.get(5)?,
        mime_type: row.get(6)?,
        size: row.get::<_, Option<i64>>(7)?.map(|value| value as u64),
        blob_ref: row.get(8)?,
        content_hash: row.get(9)?,
        metadata: serde_json::from_str(&metadata)
            .map_err(|error| conversion_error(error.to_string()))?,
        lifecycle: parse_wire(row.get(11)?)?,
        revision: revision_from_row(row, 12)?,
        updated_by_device: DeviceId::new(row.get::<_, String>(13)?),
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        deleted_at: row.get(16)?,
    })
}

fn get_library_object(
    connection: &Connection,
    id: &LibraryObjectId,
) -> Result<LibraryObjectView, DomainError> {
    connection.query_row(
        "SELECT id,kind,media_kind,title,original_source,original_filename,mime_type,size,blob_ref,content_hash,metadata_json,lifecycle,revision,updated_by_device,created_at,updated_at,deleted_at FROM library_objects WHERE id=?1",
        [&id.0],
        library_object_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectView> {
    Ok(ProjectView {
        field_id: FieldId::new(row.get::<_, String>(0)?),
        title: row.get(1)?,
        goal: row.get(2)?,
        root_path: row.get(3)?,
        revision: revision_from_row(row, 4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn valid_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[allow(clippy::too_many_arguments)]
fn validate_artifact_write_request(
    connection: &Connection,
    owner: &PrincipalId,
    profile_id: &ProfileId,
    expected_tool_name: &str,
    run_id: &AgentRunId,
    conversation_id: &ConversationId,
    tool_call_id: &ToolCallId,
    project_field_id: Option<&FieldId>,
    artifact_type: ArtifactType,
    content: &ArtifactContentV1,
    canonical_content_json: &str,
    semantic_sha256: &str,
    mutation_request_sha256: &str,
) -> Result<(), DomainError> {
    let run = get_agent_run(connection, owner, run_id)?;
    if run.conversation_id != *conversation_id
        || project_field_id.is_some_and(|field_id| *field_id != run.field_id)
    {
        return Err(DomainError::Validation(
            "ARTIFACT_TRUSTED_CONTEXT_INVALID".into(),
        ));
    }
    let tool = get_agent_tool_call(connection, owner, tool_call_id)?;
    if tool.run_id != *run_id || tool.name != expected_tool_name {
        return Err(DomainError::Validation(
            "ARTIFACT_TOOLCALL_SCOPE_INVALID".into(),
        ));
    }
    let current_profile = current_profile_id(connection)?;
    if current_profile != *profile_id
        || content.artifact_type() != artifact_type
        || canonical_content_json.len() > 256 * 1024
        || !valid_lower_sha256(semantic_sha256)
        || !valid_lower_sha256(mutation_request_sha256)
        || format!("{:x}", Sha256::digest(canonical_content_json.as_bytes())) != semantic_sha256
    {
        return Err(DomainError::Validation("ARTIFACT_CONTENT_INVALID".into()));
    }
    let decoded: ArtifactContentV1 = serde_json::from_str(canonical_content_json)
        .map_err(|_| DomainError::Validation("ARTIFACT_CONTENT_INVALID".into()))?;
    if decoded != *content {
        return Err(DomainError::Validation("ARTIFACT_CONTENT_INVALID".into()));
    }
    Ok(())
}

fn valid_file_artifact_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn valid_file_artifact_state(state: &FileArtifactStateV1) -> bool {
    valid_file_artifact_path(&state.relative_path)
        && if state.exists {
            state
                .content_sha256
                .as_deref()
                .is_some_and(valid_lower_sha256)
                && state.byte_length.is_some_and(|value| value <= 1024 * 1024)
        } else {
            state.content_sha256.is_none() && state.byte_length.is_none()
        }
}

fn validate_file_artifact_mutation_request(
    connection: &Connection,
    owner: &PrincipalId,
    profile_id: &ProfileId,
    request: &CommitFileArtifactMutationsRecord,
) -> Result<(), DomainError> {
    let run = get_agent_run(connection, owner, &request.run_id)?;
    if run.conversation_id != request.conversation_id || run.field_id != request.project_field_id {
        return Err(DomainError::Validation(
            "ARTIFACT_TRUSTED_CONTEXT_INVALID".into(),
        ));
    }
    let tool = get_agent_tool_call(connection, owner, &request.tool_call_id)?;
    let expected_operation = match tool.name.as_str() {
        "create_file" => FileMutationOperation::Create,
        "write_file" | "replace_text" | "apply_patches" => FileMutationOperation::Modify,
        "delete_file" => FileMutationOperation::Delete,
        "restore_file" => FileMutationOperation::Restore,
        _ => {
            return Err(DomainError::Validation(
                "ARTIFACT_TOOLCALL_SCOPE_INVALID".into(),
            ));
        }
    };
    if tool.run_id != request.run_id
        || tool.status != AgentToolStatus::Running
        || current_profile_id(connection)? != *profile_id
        || !valid_lower_sha256(&request.mutation_request_sha256)
        || request.mutations.is_empty()
        || request.mutations.len() > 16
    {
        return Err(DomainError::Validation(
            "ARTIFACT_TOOLCALL_SCOPE_INVALID".into(),
        ));
    }
    let mut paths = HashSet::with_capacity(request.mutations.len());
    for mutation in &request.mutations {
        let content = &mutation.content;
        if content.operation != expected_operation
            || !valid_file_artifact_path(&mutation.relative_path)
            || !paths.insert(mutation.relative_path.as_str())
            || !valid_file_artifact_state(&content.before)
            || !valid_file_artifact_state(&content.after)
            || content.before.relative_path != mutation.relative_path
            || content.after.relative_path != mutation.relative_path
            || match content.operation {
                FileMutationOperation::Create => content.before.exists || !content.after.exists,
                FileMutationOperation::Modify | FileMutationOperation::Restore => {
                    !content.before.exists || !content.after.exists
                }
                FileMutationOperation::Delete => !content.before.exists || content.after.exists,
                FileMutationOperation::Move => true,
            }
            || mutation.canonical_content_json.len() > 256 * 1024
            || !valid_lower_sha256(&mutation.semantic_sha256)
            || format!(
                "{:x}",
                Sha256::digest(mutation.canonical_content_json.as_bytes())
            ) != mutation.semantic_sha256
        {
            return Err(DomainError::Validation("ARTIFACT_CONTENT_INVALID".into()));
        }
        let decoded: ArtifactContentV1 = serde_json::from_str(&mutation.canonical_content_json)
            .map_err(|_| DomainError::Validation("ARTIFACT_CONTENT_INVALID".into()))?;
        if decoded != ArtifactContentV1::FileMutation(content.clone()) {
            return Err(DomainError::Validation("ARTIFACT_CONTENT_INVALID".into()));
        }
    }
    Ok(())
}

fn file_artifact_replay_matches(
    connection: &Connection,
    request: &CommitFileArtifactMutationsRecord,
    existing: &[ArtifactReadView],
) -> Result<bool, DomainError> {
    if existing.len() != request.mutations.len() {
        return Ok(false);
    }
    let digests: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM artifact_revisions WHERE created_by_tool_call_id=?1 AND mutation_request_sha256=?2",
            params![request.tool_call_id.0, request.mutation_request_sha256],
            |row| row.get(0),
        )
        .map_err(storage_domain)?;
    if digests != existing.len() as i64 {
        return Ok(false);
    }
    Ok(request.mutations.iter().all(|mutation| {
        existing.iter().any(|read| {
            read.revision.semantic_sha256 == mutation.semantic_sha256
                && matches!(
                    &read.revision.content,
                    ArtifactContentV1::FileMutation(content)
                        if content == &mutation.content
                )
        })
    }))
}

struct PersistedArtifactRow {
    artifact_id: ArtifactId,
    profile_id: ProfileId,
    artifact_type: String,
    title: Option<String>,
    project_field_id: Option<FieldId>,
    current_revision_id: ArtifactRevisionId,
    created_from_conversation_id: Option<ConversationId>,
    created_by_agent_run_id: Option<AgentRunId>,
    updated_by_device: DeviceId,
    created_at: i64,
    updated_at: i64,
    archived_at: Option<i64>,
}

impl PersistedArtifactRow {
    fn into_view(self) -> Result<ArtifactView, DomainError> {
        let artifact_type = serde_json::from_value(Value::String(self.artifact_type))
            .map_err(|_| DomainError::Validation("ARTIFACT_TYPE_UNSUPPORTED".into()))?;
        Ok(ArtifactView {
            artifact_id: self.artifact_id,
            profile_id: self.profile_id,
            artifact_type,
            title: self.title,
            project_field_id: self.project_field_id,
            current_revision_id: self.current_revision_id,
            created_from_conversation_id: self.created_from_conversation_id,
            created_by_agent_run_id: self.created_by_agent_run_id,
            updated_by_device: self.updated_by_device,
            created_at: self.created_at,
            updated_at: self.updated_at,
            archived_at: self.archived_at,
        })
    }
}

fn artifact_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersistedArtifactRow> {
    Ok(PersistedArtifactRow {
        artifact_id: ArtifactId::new(row.get::<_, String>(0)?),
        profile_id: ProfileId::new(row.get::<_, String>(1)?),
        artifact_type: row.get(2)?,
        title: row.get(3)?,
        project_field_id: row.get::<_, Option<String>>(4)?.map(FieldId::new),
        current_revision_id: ArtifactRevisionId::new(row.get::<_, String>(5)?),
        created_from_conversation_id: row.get::<_, Option<String>>(6)?.map(ConversationId::new),
        created_by_agent_run_id: row.get::<_, Option<String>>(7)?.map(AgentRunId::new),
        updated_by_device: DeviceId::new(row.get::<_, String>(8)?),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        archived_at: row.get(11)?,
    })
}

fn artifact_revision_metadata_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ArtifactRevisionMetadataView> {
    Ok(ArtifactRevisionMetadataView {
        revision_id: ArtifactRevisionId::new(row.get::<_, String>(0)?),
        artifact_id: ArtifactId::new(row.get::<_, String>(1)?),
        sequence: revision_from_row(row, 2)?,
        parent_revision_id: row
            .get::<_, Option<String>>(3)?
            .map(ArtifactRevisionId::new),
        mutation_kind: parse_wire(row.get(4)?)?,
        content_schema_version: row
            .get::<_, i64>(5)?
            .try_into()
            .map_err(|_| conversion_error("artifact schema version out of range".into()))?,
        semantic_sha256: row.get(6)?,
        created_from_conversation_id: row.get::<_, Option<String>>(7)?.map(ConversationId::new),
        created_by_agent_run_id: row.get::<_, Option<String>>(8)?.map(AgentRunId::new),
        created_by_tool_call_id: ToolCallId::new(row.get::<_, String>(9)?),
        created_at: row.get(10)?,
    })
}

fn artifact_revision_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactRevisionView> {
    let content_json: String = row.get(6)?;
    Ok(ArtifactRevisionView {
        revision_id: ArtifactRevisionId::new(row.get::<_, String>(0)?),
        artifact_id: ArtifactId::new(row.get::<_, String>(1)?),
        sequence: revision_from_row(row, 2)?,
        parent_revision_id: row
            .get::<_, Option<String>>(3)?
            .map(ArtifactRevisionId::new),
        mutation_kind: parse_wire(row.get(4)?)?,
        content_schema_version: row
            .get::<_, i64>(5)?
            .try_into()
            .map_err(|_| conversion_error("artifact schema version out of range".into()))?,
        semantic_sha256: row.get(7)?,
        content: serde_json::from_str(&content_json)
            .map_err(|error| conversion_error(error.to_string()))?,
        created_from_conversation_id: row.get::<_, Option<String>>(8)?.map(ConversationId::new),
        created_by_agent_run_id: row.get::<_, Option<String>>(9)?.map(AgentRunId::new),
        created_by_tool_call_id: ToolCallId::new(row.get::<_, String>(10)?),
        created_at: row.get(11)?,
    })
}

fn get_artifact(
    connection: &Connection,
    profile_id: &ProfileId,
    artifact_id: &ArtifactId,
) -> Result<ArtifactView, DomainError> {
    // Migration fixture tests exercise schema 8/9/10 with the current domain
    // reader before the forward migration is applied. Production startup
    // always reaches schema 11 before exposing StorageHandle.
    let has_archive_state: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('artifacts') WHERE name='archived_at')",
            [],
            |row| row.get(0),
        )
        .map_err(storage_domain)?;
    let query = if has_archive_state {
        "SELECT id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at,archived_at FROM artifacts WHERE id=?1 AND profile_id=?2"
    } else {
        "SELECT id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at,NULL AS archived_at FROM artifacts WHERE id=?1 AND profile_id=?2"
    };
    let persisted = connection
        .query_row(
            query,
            params![artifact_id.0, profile_id.0],
            artifact_from_row,
        )
        .optional()
        .map_err(storage_domain)?
        .ok_or(DomainError::NotFound)?;
    persisted.into_view()
}

fn get_artifact_revision(
    connection: &Connection,
    profile_id: &ProfileId,
    artifact_id: &ArtifactId,
    revision_id: &ArtifactRevisionId,
) -> Result<ArtifactRevisionView, DomainError> {
    connection.query_row(
        "SELECT r.id,r.artifact_id,r.sequence,r.parent_revision_id,r.mutation_kind,r.content_schema_version,r.content_json,r.semantic_sha256,r.created_from_conversation_id,r.created_by_agent_run_id,r.created_by_tool_call_id,r.created_at FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE r.id=?1 AND r.artifact_id=?2 AND a.profile_id=?3",
        params![revision_id.0,artifact_id.0,profile_id.0],
        artifact_revision_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn get_artifact_read(
    connection: &Connection,
    profile_id: &ProfileId,
    artifact_id: &ArtifactId,
    revision_id: Option<&ArtifactRevisionId>,
) -> Result<ArtifactReadView, DomainError> {
    let artifact = get_artifact(connection, profile_id, artifact_id)?;
    let selected = revision_id.unwrap_or(&artifact.current_revision_id);
    let revision = get_artifact_revision(connection, profile_id, artifact_id, selected)?;
    if revision.content_schema_version != 1
        || format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&revision.content)
                    .map_err(|_| DomainError::Validation("ARTIFACT_CONTENT_INVALID".into()))?
            )
        ) != revision.semantic_sha256
    {
        return Err(DomainError::Validation(
            "ARTIFACT_CONTENT_INTEGRITY_FAILED".into(),
        ));
    }
    Ok(ArtifactReadView { artifact, revision })
}

fn artifact_mutation_request_sha(
    connection: &Connection,
    tool_call_id: &ToolCallId,
) -> Result<String, DomainError> {
    connection
        .query_row(
            "SELECT mutation_request_sha256 FROM artifact_revisions WHERE created_by_tool_call_id=?1",
            [&tool_call_id.0],
            |row| row.get(0),
        )
        .map_err(storage_domain)
}

fn artifact_mutation_for_tool_call(
    connection: &Connection,
    profile_id: &ProfileId,
    tool_call_id: &ToolCallId,
) -> Result<Option<ArtifactReadView>, DomainError> {
    let ids = connection.query_row(
        "SELECT r.artifact_id,r.id FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE r.created_by_tool_call_id=?1 AND a.profile_id=?2",
        params![tool_call_id.0,profile_id.0],
        |row| Ok((ArtifactId::new(row.get::<_, String>(0)?),ArtifactRevisionId::new(row.get::<_, String>(1)?))),
    ).optional().map_err(storage_domain)?;
    ids.map(|(artifact_id, revision_id)| {
        get_artifact_read(connection, profile_id, &artifact_id, Some(&revision_id))
    })
    .transpose()
}

fn file_artifact_mutations_for_tool_call(
    connection: &Connection,
    profile_id: &ProfileId,
    tool_call_id: &ToolCallId,
) -> Result<Vec<ArtifactReadView>, DomainError> {
    let mut statement = connection.prepare(
        "SELECT r.artifact_id,r.id FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE r.created_by_tool_call_id=?1 AND a.profile_id=?2 AND a.artifact_type='FILE_MUTATION' ORDER BY r.id ASC"
    ).map_err(storage_domain)?;
    let ids = statement
        .query_map(params![tool_call_id.0, profile_id.0], |row| {
            Ok((
                ArtifactId::new(row.get::<_, String>(0)?),
                ArtifactRevisionId::new(row.get::<_, String>(1)?),
            ))
        })
        .map_err(storage_domain)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_domain)?;
    ids.into_iter()
        .map(|(artifact_id, revision_id)| {
            get_artifact_read(connection, profile_id, &artifact_id, Some(&revision_id))
        })
        .collect()
}

fn asset_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetView> {
    let media_type: String = row.get(2)?;
    let media_type = match media_type.as_str() {
        "image/png" => AssetMediaType::Png,
        _ => return Err(conversion_error("unsupported asset media type".into())),
    };
    let byte_length = row
        .get::<_, i64>(4)?
        .try_into()
        .map_err(|_| conversion_error("asset byte length out of range".into()))?;
    let width = row
        .get::<_, i64>(5)?
        .try_into()
        .map_err(|_| conversion_error("asset width out of range".into()))?;
    let height = row
        .get::<_, i64>(6)?
        .try_into()
        .map_err(|_| conversion_error("asset height out of range".into()))?;
    Ok(AssetView {
        asset_id: AssetId::new(row.get::<_, String>(0)?),
        profile_id: ProfileId::new(row.get::<_, String>(1)?),
        media_type,
        content_sha256: row.get(3)?,
        byte_length,
        width,
        height,
        blob_ref: row.get(7)?,
        created_from_conversation_id: row.get::<_, Option<String>>(8)?.map(ConversationId::new),
        created_by_agent_run_id: row.get::<_, Option<String>>(9)?.map(AgentRunId::new),
        created_by_tool_call_id: ToolCallId::new(row.get::<_, String>(10)?),
        created_at: row.get(11)?,
    })
}

fn get_asset(
    connection: &Connection,
    profile_id: &ProfileId,
    asset_id: &AssetId,
) -> Result<AssetView, DomainError> {
    let asset = connection
        .query_row(
            "SELECT id,profile_id,media_type,content_sha256,byte_length,width,height,blob_ref,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at FROM assets WHERE id=?1 AND profile_id=?2",
            params![asset_id.0,profile_id.0],
            asset_from_row,
        )
        .optional()
        .map_err(storage_domain)?
        .ok_or(DomainError::NotFound)?;
    if !valid_lower_sha256(&asset.content_sha256)
        || asset.media_type != AssetMediaType::Png
        || asset.byte_length == 0
        || asset.byte_length > 8 * 1024 * 1024
        || asset.width == 0
        || asset.width > 4096
        || asset.height == 0
        || asset.height > 4096
        || u64::from(asset.width) * u64::from(asset.height) > 16_777_216
        || asset.blob_ref
            != format!(
                "blobs/objects/{}/{}",
                &asset.content_sha256[..2],
                asset.content_sha256
            )
    {
        return Err(DomainError::Validation(
            "ASSET_CONTENT_INTEGRITY_FAILED".into(),
        ));
    }
    Ok(asset)
}

fn asset_for_tool_call(
    connection: &Connection,
    profile_id: &ProfileId,
    tool_call_id: &ToolCallId,
) -> Result<Option<AssetView>, DomainError> {
    let asset_id = connection
        .query_row(
            "SELECT id FROM assets WHERE created_by_tool_call_id=?1 AND profile_id=?2",
            params![tool_call_id.0, profile_id.0],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage_domain)?;
    asset_id
        .map(|asset_id| get_asset(connection, profile_id, &AssetId::new(asset_id)))
        .transpose()
}

fn get_project(
    connection: &Connection,
    owner: &PrincipalId,
    device: &DeviceId,
    field_id: &FieldId,
) -> Result<ProjectView, DomainError> {
    connection.query_row(
        "SELECT f.id,f.title,f.goal,COALESCE(b.local_locator,''),f.revision,f.created_at,MAX(f.updated_at,COALESCE((SELECT MAX(c.updated_at) FROM conversations c WHERE c.field_id=f.id AND c.lifecycle_status='ACTIVE'),f.updated_at)) FROM fields f LEFT JOIN device_bindings b ON b.object_id=f.id AND b.device_id=?1 AND b.binding_kind='PROJECT_ROOT' WHERE f.id=?2 AND f.owner_principal_id=?3 AND f.lifecycle_status='ACTIVE'",
        params![device.0, field_id.0, owner.0],
        project_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn project_revision_or_not_found(
    connection: &Connection,
    owner: &PrincipalId,
    device: &DeviceId,
    id: &FieldId,
) -> Result<ProjectView, DomainError> {
    match get_project(connection, owner, device, id) {
        Ok(_) => Err(DomainError::RevisionConflict),
        Err(error) => Err(error),
    }
}

fn conversation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationView> {
    Ok(ConversationView {
        id: ConversationId::new(row.get::<_, String>(0)?),
        field_id: FieldId::new(row.get::<_, String>(1)?),
        title: row.get(2)?,
        provider_config_id: row.get::<_, Option<String>>(3)?.map(ProviderConfigId::new),
        model_id: row.get(4)?,
        lifecycle_status: parse_wire(row.get(5)?)?,
        revision: revision_from_row(row, 6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn get_conversation(
    connection: &Connection,
    owner: &PrincipalId,
    id: &ConversationId,
) -> Result<ConversationView, DomainError> {
    connection.query_row(
        "SELECT c.id,c.field_id,c.title,c.provider_config_id,c.model_id,c.lifecycle_status,c.revision,c.created_at,c.updated_at FROM conversations c JOIN fields f ON f.id=c.field_id WHERE c.id=?1 AND f.owner_principal_id=?2",
        params![id.0, owner.0],
        conversation_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn conversation_revision_or_not_found(
    connection: &Connection,
    owner: &PrincipalId,
    id: &ConversationId,
) -> Result<ConversationView, DomainError> {
    match get_conversation(connection, owner, id) {
        Ok(_) => Err(DomainError::RevisionConflict),
        Err(error) => Err(error),
    }
}

fn conversation_message_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ConversationMessageView> {
    let references_json = row.get::<_, String>(8)?;
    Ok(ConversationMessageView {
        id: MessageId::new(row.get::<_, String>(0)?),
        conversation_id: ConversationId::new(row.get::<_, String>(1)?),
        role: parse_wire(row.get(2)?)?,
        content: row.get(3)?,
        status: parse_wire(row.get(4)?)?,
        provider_config_id: row.get::<_, Option<String>>(5)?.map(ProviderConfigId::new),
        model_id: row.get(6)?,
        invocation_id: row.get::<_, Option<String>>(7)?.map(ModelInvocationId::new),
        references: decode_result_references(&references_json),
        created_at: row.get(9)?,
    })
}

fn decode_result_references(value: &str) -> Vec<ResultReference> {
    if value.len() > 1_048_576 {
        return vec![];
    }
    match serde_json::from_str::<Vec<ResultReference>>(value) {
        Ok(references) if references.len() <= 64 => references,
        _ => vec![],
    }
}

fn agent_run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRunView> {
    Ok(AgentRunView {
        id: AgentRunId::new(row.get::<_, String>(0)?),
        field_id: FieldId::new(row.get::<_, String>(1)?),
        conversation_id: ConversationId::new(row.get::<_, String>(2)?),
        provider_config_id: ProviderConfigId::new(row.get::<_, String>(3)?),
        model_id: row.get(4)?,
        task: row.get(5)?,
        permission: parse_wire(row.get(6)?)?,
        status: parse_wire(row.get(7)?)?,
        current_step: u32_from_row(row, 8)?,
        max_steps: u32_from_row(row, 9)?,
        next_sequence: revision_from_row(row, 10)?,
        error_code: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        finished_at: row.get(14)?,
    })
}

fn get_agent_run(
    connection: &Connection,
    owner: &PrincipalId,
    run_id: &AgentRunId,
) -> Result<AgentRunView, DomainError> {
    connection.query_row(
        "SELECT r.id,r.field_id,r.conversation_id,r.provider_config_id,r.model_id,r.task,r.permission,r.status,r.current_step,r.max_steps,r.next_sequence,r.error_code,r.created_at,r.updated_at,r.finished_at FROM agent_runs r JOIN fields f ON f.id=r.field_id WHERE r.id=?1 AND f.owner_principal_id=?2",
        params![run_id.0,owner.0],
        agent_run_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn agent_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentEventView> {
    let payload: String = row.get(5)?;
    Ok(AgentEventView {
        id: AgentEventId::new(row.get::<_, String>(0)?),
        run_id: AgentRunId::new(row.get::<_, String>(1)?),
        sequence: revision_from_row(row, 2)?,
        schema_version: row
            .get::<_, i64>(3)?
            .try_into()
            .map_err(|_| conversion_error("event schema version out of range".into()))?,
        kind: parse_wire(row.get(4)?)?,
        payload: serde_json::from_str(&payload)
            .map_err(|error| conversion_error(error.to_string()))?,
        created_at: row.get(6)?,
    })
}

fn agent_tool_call_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentToolCallView> {
    let arguments: String = row.get(6)?;
    let receipt: Option<String> = row.get(7)?;
    Ok(AgentToolCallView {
        id: ToolCallId::new(row.get::<_, String>(0)?),
        run_id: AgentRunId::new(row.get::<_, String>(1)?),
        name: row.get(2)?,
        effect: parse_wire(row.get(3)?)?,
        status: parse_wire(row.get(4)?)?,
        policy_decision: parse_wire(row.get(5)?)?,
        arguments: serde_json::from_str(&arguments)
            .map_err(|error| conversion_error(error.to_string()))?,
        receipt: receipt
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| conversion_error(error.to_string()))?,
        error_code: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn get_agent_tool_call(
    connection: &Connection,
    owner: &PrincipalId,
    id: &ToolCallId,
) -> Result<AgentToolCallView, DomainError> {
    connection.query_row(
        "SELECT t.id,t.run_id,t.name,t.effect,t.status,t.policy_decision,t.arguments_json,t.receipt_json,t.error_code,t.created_at,t.updated_at FROM agent_tool_calls t JOIN agent_runs r ON r.id=t.run_id JOIN fields f ON f.id=r.field_id WHERE t.id=?1 AND f.owner_principal_id=?2",
        params![id.0,owner.0],
        agent_tool_call_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn verification_receipt_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<VerificationReceiptView> {
    let subject_kind: Option<String> = row.get(9)?;
    let subject = match subject_kind.as_deref() {
        None => None,
        Some("ARTIFACT_REVISION") => Some(VerificationSubject::ArtifactRevision {
            artifact_id: ArtifactId::new(row.get::<_, String>(10)?),
            revision_id: ArtifactRevisionId::new(row.get::<_, String>(11)?),
            semantic_sha256: row.get(12)?,
        }),
        Some(other) => {
            return Err(conversion_error(format!(
                "unknown verification subject {other}"
            )));
        }
    };
    Ok(VerificationReceiptView {
        id: VerificationReceiptId::new(row.get::<_, String>(0)?),
        run_id: AgentRunId::new(row.get::<_, String>(1)?),
        tool_call_id: row.get::<_, Option<String>>(2)?.map(ToolCallId::new),
        check_kind: row.get(3)?,
        outcome: parse_wire(row.get(4)?)?,
        summary: row.get(5)?,
        artifact_sha256: row.get(6)?,
        exit_code: row.get(7)?,
        created_at: row.get(8)?,
        subject,
    })
}

fn get_agent_verification_receipt(
    connection: &Connection,
    owner: &PrincipalId,
    id: &VerificationReceiptId,
) -> Result<VerificationReceiptView, DomainError> {
    connection.query_row(
        "SELECT v.id,v.run_id,v.tool_call_id,v.check_kind,v.outcome,v.summary,v.artifact_sha256,v.exit_code,v.created_at,v.subject_kind,v.subject_artifact_id,v.subject_revision_id,v.subject_sha256 FROM agent_verification_receipts v JOIN agent_runs r ON r.id=v.run_id JOIN fields f ON f.id=r.field_id WHERE v.id=?1 AND f.owner_principal_id=?2",
        params![id.0, owner.0],
        verification_receipt_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn screenshot_evidence_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ScreenshotEvidenceView> {
    Ok(ScreenshotEvidenceView {
        id: ScreenshotEvidenceId::new(row.get::<_, String>(0)?),
        content_sha256: row.get(1)?,
        blob_ref: row.get(2)?,
        mime_type: row.get(3)?,
        byte_size: row
            .get::<_, i64>(4)?
            .try_into()
            .map_err(|_| conversion_error("screenshot byte size invalid".into()))?,
        width: row
            .get::<_, i64>(5)?
            .try_into()
            .map_err(|_| conversion_error("screenshot width invalid".into()))?,
        height: row
            .get::<_, i64>(6)?
            .try_into()
            .map_err(|_| conversion_error("screenshot height invalid".into()))?,
        source_kind: parse_wire(row.get(7)?)?,
        page_id: row.get(8)?,
        navigation_generation: row
            .get::<_, i64>(9)?
            .try_into()
            .map_err(|_| conversion_error("screenshot navigation generation invalid".into()))?,
        captured_url: row.get(10)?,
        captured_at: row.get(11)?,
        conversation_id: row.get::<_, Option<String>>(12)?.map(ConversationId::new),
        run_id: row.get::<_, Option<String>>(13)?.map(AgentRunId::new),
        tool_call_id: row.get::<_, Option<String>>(14)?.map(ToolCallId::new),
        verification_receipt_id: row
            .get::<_, Option<String>>(15)?
            .map(VerificationReceiptId::new),
        visibility: parse_wire(row.get(16)?)?,
        retention_class: parse_wire(row.get(17)?)?,
        status: parse_wire(row.get(18)?)?,
        export_policy: parse_wire(row.get(19)?)?,
        sync_policy: parse_wire(row.get(20)?)?,
        created_at: row.get(21)?,
    })
}

const SCREENSHOT_EVIDENCE_COLUMNS: &str = "id,content_sha256,blob_ref,mime_type,byte_size,width,height,source_kind,page_id,navigation_generation,captured_url,captured_at,conversation_id,run_id,tool_call_id,verification_receipt_id,visibility,retention_class,status,export_policy,sync_policy,created_at";

fn get_screenshot_evidence(
    connection: &Connection,
    profile_id: &ProfileId,
    id: &ScreenshotEvidenceId,
) -> Result<ScreenshotEvidenceView, DomainError> {
    connection.query_row(
        &format!("SELECT {SCREENSHOT_EVIDENCE_COLUMNS} FROM screenshot_evidence WHERE id=?1 AND profile_id=?2"),
        params![id.0, profile_id.0],
        screenshot_evidence_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn list_screenshot_evidence(
    connection: &Connection,
    profile_id: &ProfileId,
    relation_column: &str,
    relation_id: &str,
) -> Result<Vec<ScreenshotEvidenceView>, DomainError> {
    if !matches!(relation_column, "run_id" | "verification_receipt_id") {
        return Err(DomainError::Validation(
            "SCREENSHOT_QUERY_RELATION_INVALID".into(),
        ));
    }
    let sql = format!(
        "SELECT {SCREENSHOT_EVIDENCE_COLUMNS} FROM screenshot_evidence WHERE profile_id=?1 AND {relation_column}=?2 ORDER BY captured_at ASC,id ASC"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_domain)?;
    statement
        .query_map(
            params![profile_id.0, relation_id],
            screenshot_evidence_from_row,
        )
        .map_err(storage_domain)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_domain)
}

fn validate_screenshot_evidence(
    connection: &Connection,
    owner: &PrincipalId,
    evidence: &ScreenshotEvidenceView,
) -> Result<(), DomainError> {
    let expected_blob_ref = if valid_lower_sha256(&evidence.content_sha256) {
        format!(
            "blobs/objects/{}/{}",
            &evidence.content_sha256[..2],
            evidence.content_sha256
        )
    } else {
        String::new()
    };
    if Uuid::parse_str(&evidence.id.0).is_err()
        || evidence.blob_ref != expected_blob_ref
        || evidence.mime_type != "image/png"
        || !(1..=4 * 1024 * 1024).contains(&evidence.byte_size)
        || evidence.width == 0
        || evidence.width > 4096
        || evidence.height == 0
        || evidence.height > 4096
        || u64::from(evidence.width) * u64::from(evidence.height) > 16_777_216
        || evidence.source_kind != ScreenshotEvidenceSourceKind::BrowserViewport
        || evidence.page_id.is_empty()
        || evidence.page_id.len() > 128
        || !evidence.page_id.starts_with("page_")
        || evidence.captured_url.is_empty()
        || evidence.captured_url.len() > 8192
        || !matches!(
            evidence.captured_url.split_once(':').map(|value| value.0),
            Some("http" | "https" | "file")
        )
        || evidence.captured_at < 0
        || evidence.created_at < 0
        || evidence.visibility != ScreenshotEvidenceVisibility::Internal
        || evidence.retention_class != ScreenshotEvidenceRetentionClass::LocalEvidence
        || evidence.status != ScreenshotEvidenceStatus::Active
        || evidence.export_policy != ScreenshotEvidenceExportPolicy::Excluded
        || evidence.sync_policy != ScreenshotEvidenceSyncPolicy::LocalOnly
        || (evidence.tool_call_id.is_some() && evidence.run_id.is_none())
        || (evidence.verification_receipt_id.is_some() && evidence.run_id.is_none())
    {
        return Err(DomainError::Validation(
            "SCREENSHOT_EVIDENCE_INVALID".into(),
        ));
    }
    if let Some(conversation_id) = evidence.conversation_id.as_ref() {
        get_conversation(connection, owner, conversation_id)?;
    }
    let run = evidence
        .run_id
        .as_ref()
        .map(|run_id| get_agent_run(connection, owner, run_id))
        .transpose()?;
    if let (Some(conversation_id), Some(run)) = (evidence.conversation_id.as_ref(), run.as_ref())
        && run.conversation_id != *conversation_id
    {
        return Err(DomainError::Validation(
            "SCREENSHOT_EVIDENCE_PROVENANCE_INVALID".into(),
        ));
    }
    if let Some(tool_call_id) = evidence.tool_call_id.as_ref() {
        let tool = get_agent_tool_call(connection, owner, tool_call_id)?;
        if evidence.run_id.as_ref() != Some(&tool.run_id) {
            return Err(DomainError::Validation(
                "SCREENSHOT_EVIDENCE_PROVENANCE_INVALID".into(),
            ));
        }
    }
    if let Some(receipt_id) = evidence.verification_receipt_id.as_ref() {
        let receipt = get_agent_verification_receipt(connection, owner, receipt_id)?;
        if evidence.run_id.as_ref() != Some(&receipt.run_id)
            || evidence.tool_call_id.is_some()
                && receipt.tool_call_id.as_ref() != evidence.tool_call_id.as_ref()
        {
            return Err(DomainError::Validation(
                "SCREENSHOT_EVIDENCE_PROVENANCE_INVALID".into(),
            ));
        }
    }
    Ok(())
}

fn agent_approval_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApprovalView> {
    Ok(ApprovalView {
        id: ApprovalId::new(row.get::<_, String>(0)?),
        run_id: AgentRunId::new(row.get::<_, String>(1)?),
        tool_call_id: ToolCallId::new(row.get::<_, String>(2)?),
        decision: row
            .get::<_, Option<String>>(3)?
            .map(parse_wire)
            .transpose()?,
        nonce: row.get(4)?,
        created_at: row.get(5)?,
        resolved_at: row.get(6)?,
    })
}

fn get_agent_approval(
    connection: &Connection,
    owner: &PrincipalId,
    id: &ApprovalId,
) -> Result<ApprovalView, DomainError> {
    connection.query_row(
        "SELECT a.id,a.run_id,a.tool_call_id,a.decision,a.nonce,a.created_at,a.resolved_at FROM agent_approvals a JOIN agent_runs r ON r.id=a.run_id JOIN fields f ON f.id=r.field_id WHERE a.id=?1 AND f.owner_principal_id=?2",
        params![id.0,owner.0],
        agent_approval_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn get_conversation_message(
    connection: &Connection,
    owner: &PrincipalId,
    id: &MessageId,
) -> Result<ConversationMessageView, DomainError> {
    connection.query_row(
        "SELECT m.id,m.conversation_id,m.role,m.content,m.status,m.provider_config_id,m.model_id,m.invocation_id,m.references_json,m.created_at FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN fields f ON f.id=c.field_id WHERE m.id=?1 AND f.owner_principal_id=?2",
        params![id.0, owner.0],
        conversation_message_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn validate_result_references(
    connection: &Connection,
    owner: &PrincipalId,
    conversation: &ConversationView,
    content: &str,
    references: &[ResultReference],
) -> Result<(), DomainError> {
    if references.len() > 64 {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_LIMIT_EXCEEDED".into(),
        ));
    }
    let mut ids = HashSet::with_capacity(references.len());
    for reference in references {
        if !valid_result_reference_id(&reference.id.0) || !ids.insert(reference.id.0.as_str()) {
            return Err(DomainError::Validation(
                "RESULT_REFERENCE_ID_INVALID".into(),
            ));
        }
        if reference.label.trim().is_empty()
            || reference.label.chars().count() > 256
            || reference.label.len() > 1_024
            || reference.label.chars().any(char::is_control)
        {
            return Err(DomainError::Validation(
                "RESULT_REFERENCE_LABEL_INVALID".into(),
            ));
        }
        let marker = format!("](fielora-reference:{})", reference.id.0);
        if !content.contains(&marker) {
            return Err(DomainError::Validation(
                "RESULT_REFERENCE_MARKER_MISSING".into(),
            ));
        }
        match &reference.target {
            ResultReferenceTarget::ProjectFile {
                field_id,
                relative_path,
                expected_sha256,
            } => {
                validate_result_file_target(
                    conversation,
                    field_id,
                    relative_path,
                    expected_sha256.as_deref(),
                )?;
                validate_result_file_provenance(
                    connection,
                    owner,
                    conversation,
                    relative_path,
                    None,
                    expected_sha256.as_deref(),
                    &reference.provenance,
                )?;
            }
            ResultReferenceTarget::CodeRange {
                field_id,
                relative_path,
                line_start,
                line_end,
                expected_sha256,
            } => {
                validate_result_file_target(
                    conversation,
                    field_id,
                    relative_path,
                    expected_sha256.as_deref(),
                )?;
                if *line_start == 0
                    || *line_end < *line_start
                    || *line_end > 1_000_000
                    || line_end.saturating_sub(*line_start) > 100_000
                {
                    return Err(DomainError::Validation(
                        "RESULT_REFERENCE_LINE_RANGE_INVALID".into(),
                    ));
                }
                validate_result_file_provenance(
                    connection,
                    owner,
                    conversation,
                    relative_path,
                    Some((*line_start, *line_end)),
                    expected_sha256.as_deref(),
                    &reference.provenance,
                )?;
            }
            ResultReferenceTarget::WebReference {
                field_id,
                reference_id,
                https_url,
            } => {
                if field_id != &conversation.field_id
                    || canonicalize_https_url(https_url)? != *https_url
                {
                    return Err(DomainError::Validation(
                        "RESULT_REFERENCE_WEB_TARGET_INVALID".into(),
                    ));
                }
                let ResultReferenceProvenance::SavedReference {
                    reference_id: source_id,
                } = &reference.provenance
                else {
                    return Err(DomainError::Validation(
                        "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
                    ));
                };
                if source_id != reference_id {
                    return Err(DomainError::Validation(
                        "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
                    ));
                }
                let source = get_reference(connection, field_id, reference_id)?;
                if source.lifecycle != ObjectLifecycle::Active
                    || source.reference_type != ReferenceType::HttpsUrl
                    || source.canonical_url != *https_url
                {
                    return Err(DomainError::Validation(
                        "RESULT_REFERENCE_WEB_TARGET_INVALID".into(),
                    ));
                }
            }
            ResultReferenceTarget::Image {
                source,
                library_object_id,
                screenshot_evidence_id,
                expected_sha256,
                mime_type,
            } => {
                let image_marker = format!(
                    "![{}](fielora-reference:{})",
                    reference.label, reference.id.0
                );
                if !valid_result_sha256(expected_sha256)
                    || reference.label.contains('[')
                    || reference.label.contains(']')
                    || !content.lines().any(|line| line.trim() == image_marker)
                {
                    return Err(DomainError::Validation(
                        "RESULT_REFERENCE_IMAGE_TARGET_INVALID".into(),
                    ));
                }
                match source {
                    ResultImageSource::Library => {
                        let (Some(library_object_id), None) =
                            (library_object_id.as_ref(), screenshot_evidence_id.as_ref())
                        else {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_IMAGE_TARGET_INVALID".into(),
                            ));
                        };
                        let ResultReferenceProvenance::LibraryObject {
                            library_object_id: source_id,
                        } = &reference.provenance
                        else {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
                            ));
                        };
                        if source_id != library_object_id
                            || !matches!(
                                mime_type.as_str(),
                                "image/png" | "image/jpeg" | "image/webp"
                            )
                        {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
                            ));
                        }
                        let object = get_library_object(connection, library_object_id)?;
                        let expected_blob_ref = format!(
                            "blobs/objects/{}/{}",
                            &expected_sha256[..2],
                            expected_sha256
                        );
                        if object.kind != LibraryObjectKind::File
                            || object.media_kind != LibraryMediaKind::Image
                            || object.lifecycle != LibraryLifecycle::Active
                            || object.content_hash.as_deref() != Some(expected_sha256.as_str())
                            || object.mime_type.as_deref() != Some(mime_type.as_str())
                            || object.blob_ref.as_deref() != Some(expected_blob_ref.as_str())
                            || object
                                .size
                                .is_none_or(|size| size == 0 || size > 8 * 1024 * 1024)
                        {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_IMAGE_TARGET_INVALID".into(),
                            ));
                        }
                    }
                    ResultImageSource::ScreenshotEvidence => {
                        let (None, Some(screenshot_evidence_id)) =
                            (library_object_id.as_ref(), screenshot_evidence_id.as_ref())
                        else {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_IMAGE_TARGET_INVALID".into(),
                            ));
                        };
                        let ResultReferenceProvenance::ScreenshotEvidence {
                            screenshot_evidence_id: source_id,
                        } = &reference.provenance
                        else {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
                            ));
                        };
                        if source_id != screenshot_evidence_id || mime_type != "image/png" {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
                            ));
                        }
                        let screenshot = get_screenshot_evidence(
                            connection,
                            &current_profile_id(connection)?,
                            screenshot_evidence_id,
                        )?;
                        if screenshot.status != ScreenshotEvidenceStatus::Active
                            || screenshot.content_sha256 != *expected_sha256
                            || screenshot.mime_type != *mime_type
                            || screenshot.byte_size == 0
                            || screenshot.byte_size > 4 * 1024 * 1024
                        {
                            return Err(DomainError::Validation(
                                "RESULT_REFERENCE_IMAGE_TARGET_INVALID".into(),
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn valid_result_reference_id(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("resultref_")
        && value[10..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_result_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_result_file_target(
    conversation: &ConversationView,
    field_id: &FieldId,
    relative_path: &str,
    expected_sha256: Option<&str>,
) -> Result<(), DomainError> {
    if field_id != &conversation.field_id || !valid_result_relative_path(relative_path) {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_PROJECT_SCOPE_INVALID".into(),
        ));
    }
    if expected_sha256.is_some_and(|hash| {
        hash.len() != 64
            || hash
                .bytes()
                .any(|byte| !byte.is_ascii_hexdigit() || byte.is_ascii_uppercase())
    }) {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_HASH_INVALID".into(),
        ));
    }
    Ok(())
}

fn valid_result_relative_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 16_384
        && !value.starts_with('/')
        && !value.starts_with('\\')
        && !value.contains('\\')
        && !value.contains(':')
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn validate_result_file_provenance(
    connection: &Connection,
    owner: &PrincipalId,
    conversation: &ConversationView,
    relative_path: &str,
    line_range: Option<(u32, u32)>,
    expected_sha256: Option<&str>,
    provenance: &ResultReferenceProvenance,
) -> Result<(), DomainError> {
    let ResultReferenceProvenance::ToolReceipt { tool_call_id } = provenance else {
        return if provenance == &ResultReferenceProvenance::ProjectContext && line_range.is_none() {
            Ok(())
        } else {
            Err(DomainError::Validation(
                "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
            ))
        };
    };
    let tool = get_agent_tool_call(connection, owner, tool_call_id)?;
    let run = get_agent_run(connection, owner, &tool.run_id)?;
    if run.conversation_id != conversation.id || tool.status != AgentToolStatus::Completed {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
        ));
    }
    let Some(receipt) = tool.receipt.as_ref() else {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
        ));
    };
    let receipt_path = receipt
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| tool.arguments.get("path").and_then(Value::as_str));
    if receipt_path != Some(relative_path) {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
        ));
    }
    if let Some((line_start, line_end)) = line_range
        && (tool.name != "read_file"
            || receipt.get("line_start").and_then(Value::as_u64) != Some(u64::from(line_start))
            || receipt.get("line_end").and_then(Value::as_u64) != Some(u64::from(line_end)))
    {
        return Err(DomainError::Validation(
            "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
        ));
    }
    if let Some(expected) = expected_sha256 {
        let receipt_hash = ["sha256", "after_sha256", "content_sha256"]
            .into_iter()
            .find_map(|key| receipt.get(key).and_then(Value::as_str));
        if receipt_hash != Some(expected) {
            return Err(DomainError::Validation(
                "RESULT_REFERENCE_PROVENANCE_INVALID".into(),
            ));
        }
    }
    Ok(())
}

fn ensure_provider_available(
    connection: &Connection,
    owner: &PrincipalId,
    id: Option<&ProviderConfigId>,
) -> Result<(), DomainError> {
    let Some(id) = id else {
        return Ok(());
    };
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM provider_configs WHERE id=?1 AND owner_principal_id=?2 AND lifecycle_status!='REMOVED')",
        params![id.0, owner.0],
        |row| row.get(0),
    ).map_err(storage_domain)?;
    if exists {
        Ok(())
    } else {
        Err(DomainError::NotFound)
    }
}

fn provider_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderConfigRecord> {
    Ok(ProviderConfigRecord {
        view: ProviderConfigView {
            id: ProviderConfigId::new(row.get::<_, String>(0)?),
            provider_kind: parse_wire(row.get(1)?)?,
            display_name: row.get(2)?,
            endpoint_class: parse_wire(row.get(3)?)?,
            base_url: row.get(4)?,
            default_model: row.get(5)?,
            lifecycle_status: parse_wire(row.get(7)?)?,
            credential_present: false,
            revision: revision_from_row(row, 8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        },
        credential_ref: row.get(6)?,
    })
}

fn get_provider_record(
    connection: &Connection,
    owner: &PrincipalId,
    id: &ProviderConfigId,
) -> Result<ProviderConfigRecord, DomainError> {
    connection.query_row("SELECT id,provider_kind,display_name,endpoint_class,base_url,default_model,credential_ref,lifecycle_status,revision,created_at,updated_at FROM provider_configs WHERE id=?1 AND owner_principal_id=?2",params![id.0,owner.0],provider_record_from_row).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn provider_revision_or_not_found(
    connection: &Connection,
    owner: &PrincipalId,
    id: &ProviderConfigId,
    _revision: u64,
) -> Result<ProviderConfigRecord, DomainError> {
    match get_provider_record(connection, owner, id) {
        Ok(_) => Err(DomainError::RevisionConflict),
        Err(error) => Err(error),
    }
}

fn insert_simple_activity(
    transaction: &Transaction<'_>,
    field_id: Option<&FieldId>,
    owner: &PrincipalId,
    action: &str,
    target_type: &str,
    target_id: &str,
    now: i64,
) -> Result<(), DomainError> {
    insert_simple_activity_with_id(
        transaction,
        &Uuid::now_v7().to_string(),
        field_id,
        owner,
        action,
        target_type,
        target_id,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn insert_simple_activity_with_id(
    transaction: &Transaction<'_>,
    id: &str,
    field_id: Option<&FieldId>,
    owner: &PrincipalId,
    action: &str,
    target_type: &str,
    target_id: &str,
    now: i64,
) -> Result<(), DomainError> {
    transaction.execute("INSERT INTO activities(id,field_id,actor_principal_id,intent,action,target_type,target_id,summary,trace_id,created_at) VALUES(?1,?2,?3,NULL,?4,?5,?6,NULL,?7,?8)",params![id,field_id.map(|v|&v.0),owner.0,action,target_type,target_id,Uuid::now_v7().to_string(),now]).map_err(storage_domain)?;
    Ok(())
}

fn capture_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CaptureView> {
    Ok(CaptureView {
        id: CaptureId::new(row.get::<_, String>(0)?),
        kind: parse_wire(row.get(1)?)?,
        title: row.get(2)?,
        content: row.get(3)?,
        placement_status: parse_wire(row.get(4)?)?,
        lifecycle_status: parse_wire(row.get(5)?)?,
        attached_field_id: row.get::<_, Option<String>>(6)?.map(FieldId::new),
        promoted_as: row.get(7)?,
        source: CaptureSource {
            kind: parse_wire(row.get(8)?)?,
            title: row.get(9)?,
            uri: row.get(10)?,
            field_id: row.get::<_, Option<String>>(11)?.map(FieldId::new),
            resource_type: row.get(12)?,
            resource_id: row.get(13)?,
            resource_revision: row
                .get::<_, Option<i64>>(14)?
                .map(|v| u64::try_from(v).map_err(|_| conversion_error("negative revision".into())))
                .transpose()?,
            provider_config_id: row.get::<_, Option<String>>(15)?.map(ProviderConfigId::new),
            provider_model_id: row.get(16)?,
            provider_invocation_id: row
                .get::<_, Option<String>>(17)?
                .map(ModelInvocationId::new),
            is_partial: row.get::<_, i64>(18)? != 0,
        },
        revision: revision_from_row(row, 19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
    })
}

const CAPTURE_SELECT: &str = "SELECT id,kind,title,content,placement_status,lifecycle_status,attached_field_id,promoted_as,source_kind,source_title,source_uri,source_field_id,source_resource_type,source_resource_id,source_resource_revision,provider_config_id,provider_model_id,provider_invocation_id,source_is_partial,revision,created_at,updated_at FROM captures";

fn get_capture(
    connection: &Connection,
    owner: &PrincipalId,
    id: &CaptureId,
) -> Result<CaptureView, DomainError> {
    connection
        .query_row(
            &format!("{CAPTURE_SELECT} WHERE id=?1 AND owner_principal_id=?2"),
            params![id.0, owner.0],
            capture_from_row,
        )
        .optional()
        .map_err(storage_domain)?
        .ok_or(DomainError::NotFound)
}

fn list_captures(
    connection: &Connection,
    owner: &PrincipalId,
    request: &ListCapturesRequest,
) -> Result<Page<CaptureView, CaptureCursor>, DomainError> {
    let placement = request.placement.as_ref().map(wire);
    let lifecycle = request.lifecycle.as_ref().map(wire);
    let field = request.field_id.as_ref().map(|v| v.0.clone());
    let cursor_time = request.cursor.as_ref().map(|v| v.updated_at);
    let cursor_id = request.cursor.as_ref().map(|v| v.capture_id.0.clone());
    let limit = i64::from(request.limit.unwrap_or(100).clamp(1, 100));
    let sql = format!(
        "{CAPTURE_SELECT} WHERE owner_principal_id=?1 AND (?2 IS NULL OR placement_status=?2) AND (?3 IS NULL OR lifecycle_status=?3) AND (?4 IS NULL OR attached_field_id=?4) AND (?5 IS NULL OR updated_at<?5 OR (updated_at=?5 AND id<?6)) ORDER BY updated_at DESC,id DESC LIMIT ?7"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_domain)?;
    let rows = statement
        .query_map(
            params![
                owner.0,
                placement,
                lifecycle,
                field,
                cursor_time,
                cursor_id,
                limit
            ],
            capture_from_row,
        )
        .map_err(storage_domain)?;
    let items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_domain)?;
    let next_cursor = if items.len() == limit as usize {
        items.last().map(|v| CaptureCursor {
            updated_at: v.updated_at,
            capture_id: v.id.clone(),
        })
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

#[allow(clippy::too_many_arguments)]
fn mutate_capture_placement(
    connection: &mut Connection,
    owner: &PrincipalId,
    id: &CaptureId,
    expected_revision: u64,
    field_id: Option<&FieldId>,
    placement: &str,
    promoted_as: Option<&str>,
    action: &str,
    now: i64,
) -> Result<CaptureView, DomainError> {
    let existing = get_capture(connection, owner, id)?;
    if existing.revision != expected_revision {
        return Err(DomainError::RevisionConflict);
    }
    if existing.lifecycle_status != CaptureLifecycle::Active {
        return Err(DomainError::TerminalResource);
    }
    if placement == "ATTACHED" {
        let Some(field) = field_id else {
            return Err(DomainError::Validation("field is required".into()));
        };
        if existing.placement_status == CapturePlacement::Promoted {
            return Err(DomainError::InvalidStateTransition);
        }
        if let Some(previous) = &existing.attached_field_id
            && previous != field
        {
            return Err(DomainError::InvalidStateTransition);
        }
    }
    let tx = connection.transaction().map_err(storage_domain)?;
    if let Some(field) = field_id {
        let changed=tx.execute("UPDATE fields SET revision=revision+1,updated_at=?1 WHERE id=?2 AND owner_principal_id=?3 AND lifecycle_status='ACTIVE'",params![now,field.0,owner.0]).map_err(storage_domain)?;
        if changed == 0 {
            return Err(DomainError::NotFound);
        }
    }
    let changed=tx.execute("UPDATE captures SET placement_status=?1,attached_field_id=?2,promoted_as=?3,revision=revision+1,updated_at=?4 WHERE id=?5 AND owner_principal_id=?6 AND revision=?7",params![placement,field_id.map(|v|&v.0),promoted_as,now,id.0,owner.0,revision_to_domain(expected_revision)?]).map_err(storage_domain)?;
    if changed == 0 {
        return Err(DomainError::RevisionConflict);
    }
    insert_simple_activity(&tx, field_id, owner, action, "CAPTURE", &id.0, now)?;
    tx.commit().map_err(storage_domain)?;
    get_capture(connection, owner, id)
}

fn capture_revision_or_not_found(
    connection: &Connection,
    owner: &PrincipalId,
    id: &CaptureId,
    _revision: u64,
) -> Result<CaptureView, DomainError> {
    match get_capture(connection, owner, id) {
        Ok(_) => Err(DomainError::RevisionConflict),
        Err(error) => Err(error),
    }
}

fn request<T>(
    sender: &SyncSender<StorageCommand>,
    command: impl FnOnce(SyncSender<Result<T, DomainError>>) -> StorageCommand,
) -> Result<T, DomainError> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    sender
        .send(command(reply_tx))
        .map_err(|_| DomainError::Storage("storage worker stopped".into()))?;
    reply_rx
        .recv()
        .map_err(|_| DomainError::Storage("storage worker stopped".into()))?
}

fn request_task<T: Send + 'static>(
    sender: &SyncSender<StorageCommand>,
    task: impl FnOnce(&mut Connection) -> Result<T, DomainError> + Send + 'static,
) -> Result<T, DomainError> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    sender
        .send(StorageCommand::Task(Box::new(move |connection| {
            let _ = reply_tx.send(task(connection));
        })))
        .map_err(|_| DomainError::Storage("storage worker stopped".into()))?;
    reply_rx
        .recv()
        .map_err(|_| DomainError::Storage("storage worker stopped".into()))?
}

fn run_worker(mut connection: Connection, receiver: Receiver<StorageCommand>) {
    while let Ok(command) = receiver.recv() {
        match command {
            StorageCommand::Task(task) => task(&mut connection),
            StorageCommand::CreateField {
                field,
                activity,
                reply,
            } => {
                let result = create_field(&mut connection, &field, &activity).map_err(map_storage);
                let _ = reply.send(result);
            }
            StorageCommand::ListFields { reply } => {
                let _ = reply.send(list_fields(&connection).map_err(map_storage));
            }
            StorageCommand::GetField { field_id, reply } => {
                let _ = reply.send(get_field(&connection, &field_id));
            }
            StorageCommand::UpdateFocus {
                field_id,
                expected_revision,
                focus,
                updated_at,
                activity,
                reply,
            } => {
                let _ = reply.send(update_focus(
                    &mut connection,
                    &field_id,
                    expected_revision,
                    &focus,
                    updated_at,
                    &activity,
                ));
            }
            StorageCommand::SaveSnapshot {
                field_id,
                device_id,
                layout,
                open_objects,
                created_at,
                reply,
            } => {
                let result = save_snapshot(
                    &mut connection,
                    &field_id,
                    &device_id,
                    &layout,
                    &open_objects,
                    created_at,
                );
                let _ = reply.send(result);
            }
            StorageCommand::LatestSnapshot {
                field_id,
                device_id,
                reply,
            } => {
                let _ = reply.send(latest_snapshot(&connection, &field_id, &device_id));
            }
            StorageCommand::Shutdown => {
                // All durable writes are serialized on this worker. Checkpoint
                // before closing so DataRoot migration never copies a live WAL.
                let _ = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                break;
            }
        }
    }
}

pub fn open_connection(path: &Path) -> Result<Connection, StorageError> {
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;\nPRAGMA journal_mode = WAL;\nPRAGMA synchronous = FULL;\nPRAGMA busy_timeout = 5000;",
    )?;
    let foreign_keys: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    let journal_mode: String = connection.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    let synchronous: i64 = connection.query_row("PRAGMA synchronous", [], |row| row.get(0))?;
    let busy_timeout: i64 = connection.query_row("PRAGMA busy_timeout", [], |row| row.get(0))?;
    if foreign_keys != 1 {
        return Err(StorageError::OpenGate("foreign_keys is not ON".into()));
    }
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(StorageError::OpenGate("journal_mode is not WAL".into()));
    }
    if synchronous != 2 {
        return Err(StorageError::OpenGate("synchronous is not FULL".into()));
    }
    if busy_timeout != 5000 {
        return Err(StorageError::OpenGate("busy_timeout is not 5000".into()));
    }
    Ok(connection)
}

pub fn apply_migrations(connection: &mut Connection, now: i64) -> Result<(), StorageError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (\n\
         version INTEGER PRIMARY KEY,\n\
         name TEXT NOT NULL,\n\
         checksum TEXT NOT NULL,\n\
         applied_at INTEGER NOT NULL\n\
         );",
    )?;
    let checksum_0001 = migration_checksum(MIGRATION_0001);
    let checksum_0002 = frozen_migration_checksum(MIGRATION_0002);
    let checksum_0004 = frozen_migration_checksum(MIGRATION_0004);
    let checksum_0005 = frozen_migration_checksum(MIGRATION_0005);
    let checksum_0006 = frozen_migration_checksum(MIGRATION_0006);
    let checksum_0007 = migration_checksum(MIGRATION_0007);
    let checksum_0008 = migration_checksum(MIGRATION_0008);
    let checksum_0009 = migration_checksum(MIGRATION_0009);
    let checksum_0010 = migration_checksum(MIGRATION_0010);
    let checksum_0011 = migration_checksum(MIGRATION_0011);
    let checksum_0012 = migration_checksum(MIGRATION_0012);
    let checksum_0013 = migration_checksum(MIGRATION_0013);
    let checksum_0014 = migration_checksum(MIGRATION_0014);
    let checksum_0015 = migration_checksum(MIGRATION_0015);
    if checksum_0002 != MIGRATION_0002_FROZEN_SHA256 {
        return Err(StorageError::MigrationChecksum { version: 2 });
    }
    if checksum_0004 != MIGRATION_0004_FROZEN_SHA256 {
        return Err(StorageError::MigrationChecksum { version: 4 });
    }
    if checksum_0005 != MIGRATION_0005_FROZEN_SHA256 {
        return Err(StorageError::MigrationChecksum { version: 5 });
    }
    if checksum_0006 != MIGRATION_0006_FROZEN_SHA256 {
        return Err(StorageError::MigrationChecksum { version: 6 });
    }

    verify_applied_migration(connection, 1, MIGRATION_0001_NAME, &checksum_0001)?;
    if !migration_exists(connection, 1)? {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        transaction.execute_batch(MIGRATION_0001)?;
        validate_base_schema(&transaction)?;
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (1, ?1, ?2, ?3)",
            params![MIGRATION_0001_NAME, checksum_0001, now],
        )?;
        transaction.commit()?;
    }

    verify_applied_migration(connection, 2, MIGRATION_0002_NAME, &checksum_0002)?;
    if !migration_exists(connection, 2)? {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(MIGRATION_0002).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (2, ?1, ?2, ?3)",
            params![MIGRATION_0002_NAME, checksum_0002, now],
        )?;
        validate_base_schema(&transaction)?;
        transaction.commit()?;
    }
    verify_applied_migration(connection, 4, MIGRATION_0004_NAME, &checksum_0004)?;
    if !migration_exists(connection, 4)? {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(MIGRATION_0004).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (4, ?1, ?2, ?3)",
            params![MIGRATION_0004_NAME, checksum_0004, now],
        )?;
        // The Phase 04 migration is followed immediately by additive 0005 on a
        // fresh database. Full current-schema validation runs after 0005.
        validate_base_schema(&transaction)?;
        transaction.commit()?;
    }
    verify_applied_migration(connection, 5, MIGRATION_0005_NAME, &checksum_0005)?;
    if !migration_exists(connection, 5)? {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(MIGRATION_0005).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (5, ?1, ?2, ?3)",
            params![MIGRATION_0005_NAME, checksum_0005, now],
        )?;
        validate_base_schema(&transaction)?;
        transaction.commit()?;
    }
    verify_applied_migration(connection, 6, MIGRATION_0006_NAME, &checksum_0006)?;
    if !migration_exists(connection, 6)? {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(MIGRATION_0006).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (6, ?1, ?2, ?3)",
            params![MIGRATION_0006_NAME, checksum_0006, now],
        )?;
        // Full current-schema validation runs after additive 0007 below.
        validate_base_schema(&transaction)?;
        transaction.commit()?;
    }
    verify_applied_migration(connection, 7, MIGRATION_0007_NAME, &checksum_0007)?;
    if !migration_exists(connection, 7)? {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(MIGRATION_0007).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (7, ?1, ?2, ?3)",
            params![MIGRATION_0007_NAME, checksum_0007, now],
        )?;
        transaction.commit()?;
    }
    verify_applied_migration(connection, 8, MIGRATION_0008_NAME, &checksum_0008)?;
    if !migration_exists(connection, 8)? {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(MIGRATION_0008).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (8, ?1, ?2, ?3)",
            params![MIGRATION_0008_NAME, checksum_0008, now],
        )?;
        transaction.commit()?;
    }
    verify_applied_migration(connection, 9, MIGRATION_0009_NAME, &checksum_0009)?;
    if !migration_exists(connection, 9)? {
        apply_artifact_type_extensibility_migration(
            connection,
            now,
            MIGRATION_0009,
            &checksum_0009,
        )?;
    }
    verify_applied_migration(connection, 10, MIGRATION_0010_NAME, &checksum_0010)?;
    if !migration_exists(connection, 10)? {
        apply_durable_source_asset_migration(connection, now, MIGRATION_0010, &checksum_0010)?;
    }
    verify_applied_migration(connection, 11, MIGRATION_0011_NAME, &checksum_0011)?;
    if !migration_exists(connection, 11)? {
        apply_artifact_archive_state_migration(connection, now, MIGRATION_0011, &checksum_0011)?;
    }
    verify_applied_migration(connection, 12, MIGRATION_0012_NAME, &checksum_0012)?;
    if !migration_exists(connection, 12)? {
        apply_idr_v2_storage_migration(connection, now, MIGRATION_0012, &checksum_0012)?;
    }
    verify_applied_migration(connection, 13, MIGRATION_0013_NAME, &checksum_0013)?;
    if !migration_exists(connection, 13)? {
        apply_rich_result_reference_migration(connection, now, MIGRATION_0013, &checksum_0013)?;
    }
    verify_applied_migration(connection, 14, MIGRATION_0014_NAME, &checksum_0014)?;
    if !migration_exists(connection, 14)? {
        apply_screenshot_evidence_migration(connection, now, MIGRATION_0014, &checksum_0014)?;
    }
    verify_applied_migration(connection, 15, MIGRATION_0015_NAME, &checksum_0015)?;
    if !migration_exists(connection, 15)? {
        apply_durable_file_artifact_migration(connection, now, MIGRATION_0015, &checksum_0015)?;
    }
    let checksum_0016 = migration_checksum(MIGRATION_0016);
    verify_applied_migration(connection, 16, MIGRATION_0016_NAME, &checksum_0016)?;
    if !migration_exists(connection, 16)? {
        apply_agent_continuation_migration(connection, now, MIGRATION_0016, &checksum_0016)?;
    }
    validate_schema(connection)?;
    Ok(())
}

fn apply_agent_continuation_migration(
    connection: &mut Connection,
    now: i64,
    sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = (|| {
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute_batch(sql)?;
        let broken: i64 =
            tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        if broken != 0 {
            return Err(StorageError::MigrationIncompatibleData);
        }
        tx.execute(
            "INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(16,?1,?2,?3)",
            params![MIGRATION_0016_NAME, checksum, now],
        )?;
        tx.commit()?;
        Ok(())
    })();
    let restored = connection.execute_batch("PRAGMA foreign_keys = ON;");
    restored?;
    result
}

fn apply_durable_file_artifact_migration(
    connection: &mut Connection,
    now: i64,
    migration_sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    // The original migration-0008 global ToolCall uniqueness lives on the
    // immutable revision table. SQLite requires the same bounded parent-table
    // rebuild protocol used by migration 0009 to broaden it for multi-file
    // ToolCalls while preserving every existing row and foreign key.
    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let foreign_keys: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if foreign_keys != 0 {
        return Err(StorageError::OpenGate(
            "migration 0015 could not suspend foreign keys".into(),
        ));
    }
    let migration_result = (|| {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(migration_sql).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (15, ?1, ?2, ?3)",
            params![MIGRATION_0015_NAME, checksum, now],
        )?;
        transaction.commit()?;
        Ok(())
    })();
    let restore_result = connection.execute_batch("PRAGMA foreign_keys = ON;");
    if let Err(error) = migration_result {
        restore_result?;
        return Err(error);
    }
    restore_result?;
    let foreign_keys: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if foreign_keys != 1 {
        return Err(StorageError::OpenGate(
            "migration 0015 did not restore foreign keys".into(),
        ));
    }
    validate_schema(connection)
}

fn apply_screenshot_evidence_migration(
    connection: &mut Connection,
    now: i64,
    migration_sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if transaction.execute_batch(migration_sql).is_err() {
        return Err(StorageError::MigrationIncompatibleData);
    }
    transaction.execute(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (14, ?1, ?2, ?3)",
        params![MIGRATION_0014_NAME, checksum, now],
    )?;
    validate_schema(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn apply_rich_result_reference_migration(
    connection: &mut Connection,
    now: i64,
    migration_sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if transaction.execute_batch(migration_sql).is_err() {
        return Err(StorageError::MigrationIncompatibleData);
    }
    transaction.execute(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (13, ?1, ?2, ?3)",
        params![MIGRATION_0013_NAME, checksum, now],
    )?;
    validate_schema(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn apply_idr_v2_storage_migration(
    connection: &mut Connection,
    now: i64,
    migration_sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if transaction.execute_batch(migration_sql).is_err() {
        return Err(StorageError::MigrationIncompatibleData);
    }
    transaction.execute(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (12, ?1, ?2, ?3)",
        params![MIGRATION_0012_NAME, checksum, now],
    )?;
    validate_schema(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn apply_artifact_archive_state_migration(
    connection: &mut Connection,
    now: i64,
    migration_sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if transaction.execute_batch(migration_sql).is_err() {
        return Err(StorageError::MigrationIncompatibleData);
    }
    transaction.execute(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (11, ?1, ?2, ?3)",
        params![MIGRATION_0011_NAME, checksum, now],
    )?;
    validate_schema(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn apply_durable_source_asset_migration(
    connection: &mut Connection,
    now: i64,
    migration_sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if transaction.execute_batch(migration_sql).is_err() {
        return Err(StorageError::MigrationIncompatibleData);
    }
    transaction.execute(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (10, ?1, ?2, ?3)",
        params![MIGRATION_0010_NAME, checksum, now],
    )?;
    validate_schema(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn apply_artifact_type_extensibility_migration(
    connection: &mut Connection,
    now: i64,
    migration_sql: &str,
    checksum: &str,
) -> Result<(), StorageError> {
    // SQLite cannot alter an existing CHECK constraint. Rebuilding this parent
    // table requires foreign-key enforcement to be disabled for this connection
    // outside the transaction. The transaction, foreign_key_check, schema gate,
    // and unconditional re-enable preserve atomicity and fail closed.
    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let foreign_keys: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if foreign_keys != 0 {
        return Err(StorageError::OpenGate(
            "migration 0009 could not suspend foreign keys".into(),
        ));
    }

    let migration_result = (|| {
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if transaction.execute_batch(migration_sql).is_err() {
            return Err(StorageError::MigrationIncompatibleData);
        }
        transaction.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (9, ?1, ?2, ?3)",
            params![MIGRATION_0009_NAME, checksum, now],
        )?;
        validate_schema(&transaction)?;
        transaction.commit()?;
        Ok(())
    })();

    let restore_result = connection.execute_batch("PRAGMA foreign_keys = ON;");
    if let Err(error) = migration_result {
        restore_result?;
        return Err(error);
    }
    restore_result?;
    let foreign_keys: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if foreign_keys != 1 {
        return Err(StorageError::OpenGate(
            "migration 0009 did not restore foreign keys".into(),
        ));
    }
    validate_schema(connection)
}

fn migration_exists(connection: &Connection, version: u32) -> Result<bool, StorageError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=?1)",
            [version],
            |row| row.get(0),
        )
        .map_err(StorageError::from)
}

fn verify_applied_migration(
    connection: &Connection,
    version: u32,
    expected_name: &str,
    expected_checksum: &str,
) -> Result<(), StorageError> {
    let existing: Option<(String, String)> = connection
        .query_row(
            "SELECT name, checksum FROM schema_migrations WHERE version=?1",
            [version],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((name, checksum)) = existing {
        if checksum != expected_checksum {
            return Err(StorageError::MigrationChecksum { version });
        }
        if name != expected_name {
            return Err(StorageError::OpenGate(format!(
                "migration {version} name mismatch"
            )));
        }
    }
    Ok(())
}

fn migration_checksum(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.as_bytes()))
}

fn frozen_migration_checksum(sql: &str) -> String {
    let normalized = sql.replace("\r\n", "\n");
    migration_checksum(normalized.trim_end_matches('\n'))
}

fn validate_base_schema(connection: &Connection) -> Result<(), StorageError> {
    const TABLES: [&str; 10] = [
        "schema_migrations",
        "principals",
        "fields",
        "field_state_entries",
        "field_objects",
        "field_relations",
        "activities",
        "devices",
        "device_bindings",
        "surface_snapshots",
    ];
    for table in TABLES {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "migration validation missing table {table}"
            )));
        }
    }
    Ok(())
}

fn validate_schema(connection: &Connection) -> Result<(), StorageError> {
    validate_base_schema(connection)?;
    const REQUIRED_COLUMNS: [(&str, &str); 10] = [
        ("field_state_entries", "status"),
        ("field_state_entries", "source_activity_id"),
        ("field_objects", "created_by"),
        ("field_objects", "source_activity_id"),
        ("field_objects", "lifecycle_status"),
        ("field_objects", "revision"),
        ("field_relations", "lifecycle_status"),
        ("field_relations", "revision"),
        ("field_relations", "updated_at"),
        ("field_state_entries", "revision"),
    ];
    for (table, column) in REQUIRED_COLUMNS {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2 AND \"notnull\"=1",
            params![table, column],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(StorageError::OpenGate(format!(
                "required NOT NULL column missing: {table}.{column}"
            )));
        }
    }
    const REQUIRED_CHECKS: [(&str, &[&str]); 3] = [
        (
            "field_state_entries",
            &[
                "KIND IN (",
                "STATUS IN (",
                "STATUS != 'RESOLVED'",
                "CONFIDENCE >= 0.0",
                "CREATED_AT <= UPDATED_AT",
            ],
        ),
        (
            "field_objects",
            &[
                "OBJECT_KIND = 'REFERENCE'",
                "EXTERNAL_REF_TYPE = 'HTTPS_URL'",
                "LIFECYCLE_STATUS IN ('ACTIVE', 'ARCHIVED')",
                "REVISION >= 1",
                "CREATED_AT <= UPDATED_AT",
            ],
        ),
        (
            "field_relations",
            &[
                "RELATION_TYPE IN ('SOURCED_FROM', 'SUPERSEDED_BY')",
                "LIFECYCLE_STATUS IN ('ACTIVE', 'RETRACTED')",
                "FROM_TYPE != TO_TYPE OR FROM_ID != TO_ID",
                "RELATION_TYPE = 'SOURCED_FROM'",
                "RELATION_TYPE = 'SUPERSEDED_BY'",
            ],
        ),
    ];
    for (table, fragments) in REQUIRED_CHECKS {
        let sql: String = connection.query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        let normalized = sql
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_uppercase();
        for fragment in fragments {
            if !normalized.contains(fragment) {
                return Err(StorageError::OpenGate(format!(
                    "required CHECK missing: {table}:{fragment}"
                )));
            }
        }
    }
    const REQUIRED_INDEXES: [(&str, &str); 6] = [
        (
            "idx_state_field_status_updated",
            "FIELD_ID, STATUS, UPDATED_AT DESC, ID DESC",
        ),
        (
            "idx_objects_field_lifecycle_updated",
            "FIELD_ID, LIFECYCLE_STATUS, UPDATED_AT DESC, ID DESC",
        ),
        (
            "idx_relations_field_lifecycle_created",
            "FIELD_ID, LIFECYCLE_STATUS, CREATED_AT DESC, ID DESC",
        ),
        (
            "uq_active_reference_per_field",
            "WHERE OBJECT_KIND = 'REFERENCE' AND LIFECYCLE_STATUS = 'ACTIVE'",
        ),
        (
            "uq_active_relation_tuple",
            "WHERE LIFECYCLE_STATUS = 'ACTIVE'",
        ),
        (
            "idx_activities_field_created",
            "FIELD_ID, CREATED_AT DESC, ID DESC",
        ),
    ];
    for (index, expected_fragment) in REQUIRED_INDEXES {
        let sql: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name=?1",
                [index],
                |row| row.get(0),
            )
            .optional()?;
        let Some(sql) = sql else {
            return Err(StorageError::OpenGate(format!(
                "required index missing: {index}"
            )));
        };
        let normalized = sql
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_uppercase();
        if !normalized.contains(expected_fragment) {
            return Err(StorageError::OpenGate(format!(
                "required index shape invalid: {index}"
            )));
        }
    }
    let foreign_key_violation: Option<String> = connection
        .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(StorageError::OpenGate("foreign_key_check failed".into()));
    }
    let migrations: i64 = connection.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version IN (1,2,4,5,6,7,8,9)",
        [],
        |row| row.get(0),
    )?;
    if migrations != 8 || migration_exists(connection, 3)? {
        return Err(StorageError::OpenGate(
            "migration registry incomplete".into(),
        ));
    }
    for table in ["provider_configs", "captures"] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "migration validation missing table {table}"
            )));
        }
    }
    for table in ["conversations", "conversation_messages"] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "migration validation missing table {table}"
            )));
        }
    }
    for table in [
        "agent_runs",
        "agent_events",
        "agent_tool_calls",
        "agent_approvals",
        "agent_context_snapshots",
        "agent_verification_receipts",
        "profiles",
        "library_objects",
        "sync_change_journal",
        "artifacts",
        "artifact_revisions",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "migration validation missing table {table}"
            )));
        }
    }
    for (table, column) in [
        ("provider_configs", "owner_principal_id"),
        ("provider_configs", "credential_ref"),
        ("provider_configs", "lifecycle_status"),
        ("captures", "source_activity_id"),
        ("captures", "content"),
        ("captures", "placement_status"),
        ("captures", "lifecycle_status"),
        ("captures", "source_kind"),
        ("captures", "revision"),
        ("conversations", "field_id"),
        ("conversations", "title"),
        ("conversations", "lifecycle_status"),
        ("conversations", "revision"),
        ("conversation_messages", "conversation_id"),
        ("conversation_messages", "role"),
        ("conversation_messages", "content"),
        ("conversation_messages", "status"),
        ("conversation_messages", "created_at"),
        ("agent_runs", "conversation_id"),
        ("agent_runs", "status"),
        ("agent_runs", "next_sequence"),
        ("agent_events", "run_id"),
        ("agent_events", "sequence"),
        ("agent_events", "payload_json"),
        ("agent_tool_calls", "run_id"),
        ("agent_tool_calls", "status"),
        ("agent_tool_calls", "arguments_json"),
        ("agent_approvals", "nonce"),
        ("agent_context_snapshots", "manifest_json"),
        ("agent_verification_receipts", "outcome"),
        ("artifacts", "profile_id"),
        ("artifacts", "artifact_type"),
        ("artifacts", "current_revision_id"),
        ("artifact_revisions", "artifact_id"),
        ("artifact_revisions", "sequence"),
        ("artifact_revisions", "mutation_kind"),
        ("artifact_revisions", "content_json"),
        ("artifact_revisions", "semantic_sha256"),
        ("artifact_revisions", "created_by_tool_call_id"),
    ] {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2 AND \"notnull\"=1",
            params![table, column],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(StorageError::OpenGate(format!(
                "required NOT NULL column missing: {table}.{column}"
            )));
        }
    }
    for (table, fragments) in [
        (
            "provider_configs",
            vec![
                "PROVIDER_KIND IN (",
                "ENDPOINT_CLASS IN ('OFFICIAL', 'CUSTOM')",
                "CREDENTIAL_REF",
                "LIFECYCLE_STATUS IN ( 'ACTIVE', 'DISABLED', 'REMOVED'",
            ],
        ),
        (
            "captures",
            vec![
                "PLACEMENT_STATUS IN ( 'INBOX', 'ATTACHED', 'PROMOTED'",
                "SOURCE_KIND = 'MODEL_RESPONSE'",
                "PROMOTED_AS = 'IDEA_CANDIDATE'",
                "SOURCE_IS_PARTIAL IN (0, 1)",
            ],
        ),
        (
            "conversations",
            vec![
                "LIFECYCLE_STATUS IN ('ACTIVE', 'ARCHIVED')",
                "LENGTH(TITLE) BETWEEN 1 AND 120",
                "REVISION >= 1",
            ],
        ),
        (
            "conversation_messages",
            vec![
                "ROLE IN ('USER', 'ASSISTANT')",
                "STATUS IN ('COMPLETED', 'CANCELLED', 'FAILED')",
                "LENGTH(CONTENT) BETWEEN 1 AND 1048576",
                "ROLE = 'USER'",
            ],
        ),
        (
            "agent_runs",
            vec![
                "STATUS IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED')",
                if migration_exists(connection, 16)? {
                    "MAX_STEPS BETWEEN 1 AND 4096"
                } else {
                    "MAX_STEPS BETWEEN 1 AND 64"
                },
                "NEXT_SEQUENCE >= 1",
            ],
        ),
        (
            "agent_events",
            vec![
                "JSON_VALID(PAYLOAD_JSON)",
                "UNIQUE (RUN_ID, SEQUENCE)",
                "LENGTH(PAYLOAD_JSON) <= 1048576",
            ],
        ),
        (
            "agent_tool_calls",
            vec![
                "POLICY_DECISION IN ('ALLOW', 'ASK', 'DENY')",
                "JSON_VALID(ARGUMENTS_JSON)",
                "RECEIPT_JSON IS NULL OR JSON_VALID(RECEIPT_JSON)",
            ],
        ),
        (
            "artifacts",
            vec![
                "LENGTH(CAST(ARTIFACT_TYPE AS BLOB)) BETWEEN 1 AND 32",
                "ARTIFACT_TYPE GLOB '[A-Z]*'",
                "ARTIFACT_TYPE NOT GLOB '*[^A-Z0-9_]*'",
                "LENGTH(TITLE) BETWEEN 1 AND 512",
                "CREATED_AT <= UPDATED_AT",
            ],
        ),
    ] {
        let sql: String = connection.query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        let normalized = sql
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_uppercase();
        for fragment in fragments {
            if !normalized.contains(fragment) {
                return Err(StorageError::OpenGate(format!(
                    "required CHECK missing: {table}:{fragment}"
                )));
            }
        }
    }
    let credential_unique: i64 = connection.query_row(
        "SELECT COUNT(*) FROM pragma_index_list('provider_configs') WHERE \"unique\"=1",
        [],
        |row| row.get(0),
    )?;
    if credential_unique < 1 {
        return Err(StorageError::OpenGate(
            "provider credential_ref unique constraint missing".into(),
        ));
    }
    let forbidden_table:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND (lower(name) LIKE '%credential%' OR lower(name) LIKE '%prompt%' OR lower(name) LIKE '%response%' OR lower(name) LIKE '%session%')",[],|row|row.get(0))?;
    if forbidden_table != 0 {
        return Err(StorageError::OpenGate(
            "forbidden retention table detected".into(),
        ));
    }
    for index in [
        "idx_provider_configs_owner_lifecycle_updated",
        "idx_captures_owner_inbox",
        "idx_captures_attached_field",
        "idx_captures_source_field",
        "idx_conversations_field_lifecycle_updated",
        "idx_conversation_messages_conversation_created",
        "uq_conversation_message_invocation",
        "idx_agent_runs_conversation_updated",
        "idx_agent_runs_status_updated",
        "idx_agent_events_run_sequence",
        "idx_agent_tool_calls_run_created",
        "idx_agent_approvals_run_unresolved",
        "idx_agent_verification_run_created",
        "idx_agent_verification_artifact_revision",
        "idx_artifacts_profile_updated",
        "idx_artifacts_project_updated",
        "idx_artifact_revisions_artifact_sequence",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            [index],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "required index missing: {index}"
            )));
        }
    }
    for trigger in [
        "agent_events_immutable_update",
        "agent_events_immutable_delete",
        "sync_change_journal_immutable_update",
        "sync_change_journal_immutable_delete",
        "artifact_revisions_immutable_update",
        "artifact_revisions_immutable_delete",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
            [trigger],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "required trigger missing: {trigger}"
            )));
        }
    }
    for (table, column) in [
        ("profiles", "profile_id"),
        ("profiles", "schema_version"),
        ("library_objects", "profile_id"),
        ("library_objects", "kind"),
        ("library_objects", "media_kind"),
        ("library_objects", "metadata_json"),
        ("library_objects", "lifecycle"),
        ("library_objects", "revision"),
        ("library_objects", "updated_by_device"),
        ("sync_change_journal", "profile_id"),
        ("sync_change_journal", "device_id"),
        ("sync_change_journal", "operation"),
        ("sync_change_journal", "revision"),
    ] {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2 AND \"notnull\"=1",
            params![table, column],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(StorageError::OpenGate(format!(
                "required NOT NULL column missing: {table}.{column}"
            )));
        }
    }
    for index in [
        "idx_library_profile_lifecycle_updated",
        "idx_library_profile_media_updated",
        "idx_sync_change_profile_changed",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            [index],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "required index missing: {index}"
            )));
        }
    }
    if migration_exists(connection, 10)? {
        validate_asset_schema(connection)?;
    }
    if migration_exists(connection, 11)? {
        validate_artifact_archive_schema(connection)?;
    }
    if migration_exists(connection, 12)? {
        validate_idr_v2_schema(connection)?;
    }
    if migration_exists(connection, 13)? {
        validate_rich_result_reference_schema(connection)?;
    }
    if migration_exists(connection, 14)? {
        validate_screenshot_evidence_schema(connection)?;
    }
    if migration_exists(connection, 15)? {
        validate_durable_file_artifact_schema(connection)?;
    }
    Ok(())
}

fn validate_durable_file_artifact_schema(connection: &Connection) -> Result<(), StorageError> {
    for table in ["file_artifact_bindings", "artifact_revision_reviews"] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "migration validation missing table {table}"
            )));
        }
    }
    for (table, column) in [
        ("file_artifact_bindings", "artifact_id"),
        ("file_artifact_bindings", "profile_id"),
        ("file_artifact_bindings", "project_field_id"),
        ("file_artifact_bindings", "relative_path"),
        ("artifact_revision_reviews", "revision_id"),
        ("artifact_revision_reviews", "profile_id"),
        ("artifact_revision_reviews", "state"),
        ("artifact_revision_reviews", "reviewed_by_principal_id"),
        ("artifact_revision_reviews", "reviewed_at"),
    ] {
        let required: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2 AND \"notnull\"=1",
            params![table, column],
            |row| row.get(0),
        )?;
        if required != 1 {
            return Err(StorageError::OpenGate(format!(
                "required NOT NULL column missing: {table}.{column}"
            )));
        }
    }
    for index in [
        "idx_artifact_revisions_tool_call",
        "idx_file_artifact_bindings_project_path",
        "idx_artifact_revision_reviews_profile_reviewed",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            [index],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "required index missing: {index}"
            )));
        }
    }
    let revision_sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='artifact_revisions'",
        [],
        |row| row.get(0),
    )?;
    let normalized = revision_sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    if !normalized.contains("UNIQUE (CREATED_BY_TOOL_CALL_ID, ARTIFACT_ID)") {
        return Err(StorageError::OpenGate(
            "file artifact ToolCall/revision uniqueness missing".into(),
        ));
    }
    let foreign_key_violations: i64 =
        connection.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if foreign_key_violations != 0 {
        return Err(StorageError::OpenGate(
            "durable file Artifact foreign key validation failed".into(),
        ));
    }
    Ok(())
}

fn validate_screenshot_evidence_schema(connection: &Connection) -> Result<(), StorageError> {
    let exists: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='screenshot_evidence'",
        [],
        |row| row.get(0),
    )?;
    if exists != 1 {
        return Err(StorageError::OpenGate(
            "migration validation missing table screenshot_evidence".into(),
        ));
    }
    for column in [
        "profile_id",
        "content_sha256",
        "blob_ref",
        "mime_type",
        "byte_size",
        "width",
        "height",
        "source_kind",
        "page_id",
        "navigation_generation",
        "captured_url",
        "captured_at",
        "visibility",
        "retention_class",
        "status",
        "export_policy",
        "sync_policy",
        "created_at",
    ] {
        let required: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('screenshot_evidence') WHERE name=?1 AND \"notnull\"=1",
            [column],
            |row| row.get(0),
        )?;
        if required != 1 {
            return Err(StorageError::OpenGate(format!(
                "required NOT NULL column missing: screenshot_evidence.{column}"
            )));
        }
    }
    let sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='screenshot_evidence'",
        [],
        |row| row.get(0),
    )?;
    let normalized = sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    for fragment in [
        "MIME_TYPE = 'IMAGE/PNG'",
        "BYTE_SIZE BETWEEN 1 AND 4194304",
        "SOURCE_KIND = 'BROWSER_VIEWPORT'",
        "VISIBILITY = 'INTERNAL'",
        "RETENTION_CLASS = 'LOCAL_EVIDENCE'",
        "EXPORT_POLICY = 'EXCLUDED'",
        "SYNC_POLICY = 'LOCAL_ONLY'",
        "WIDTH * HEIGHT <= 16777216",
    ] {
        if !normalized.contains(fragment) {
            return Err(StorageError::OpenGate(format!(
                "required screenshot evidence CHECK missing: {fragment}"
            )));
        }
    }
    for index in [
        "idx_screenshot_evidence_run_captured",
        "idx_screenshot_evidence_verification_captured",
    ] {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            [index],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(StorageError::OpenGate(format!(
                "required index missing: {index}"
            )));
        }
    }
    Ok(())
}

fn validate_rich_result_reference_schema(connection: &Connection) -> Result<(), StorageError> {
    let required: i64 = connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('conversation_messages') WHERE name='references_json' AND \"notnull\"=1 AND dflt_value='''[]'''",
        [],
        |row| row.get(0),
    )?;
    if required != 1 {
        return Err(StorageError::OpenGate(
            "required typed-reference column missing: conversation_messages.references_json".into(),
        ));
    }
    let sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='conversation_messages'",
        [],
        |row| row.get(0),
    )?;
    let normalized = sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    for fragment in [
        "JSON_VALID(REFERENCES_JSON)",
        "JSON_TYPE(REFERENCES_JSON) = 'ARRAY'",
        "LENGTH(CAST(REFERENCES_JSON AS BLOB)) BETWEEN 2 AND 1048576",
    ] {
        if !normalized.contains(fragment) {
            return Err(StorageError::OpenGate(format!(
                "required typed-reference CHECK missing: {fragment}"
            )));
        }
    }
    Ok(())
}

fn validate_idr_v2_schema(connection: &Connection) -> Result<(), StorageError> {
    const TABLES: [&str; 7] = [
        "idr_human_model_state",
        "idr_human_model_items",
        "idr_item_history",
        "idr_provenance_refs",
        "idr_item_provenance",
        "idr_item_reality_refs",
        "idr_erasure_tombstones",
    ];
    for table in TABLES {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "migration validation missing table {table}"
            )));
        }
    }
    let state: (i64, i64, i64) = connection.query_row(
        "SELECT COUNT(*),MIN(current_human_model_revision),MAX(storage_contract_version) FROM idr_human_model_state WHERE singleton_key=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if state.0 != 1 || state.1 < 0 || state.2 != 1 {
        return Err(StorageError::OpenGate(
            "IDR singleton aggregate state invalid".into(),
        ));
    }
    for index in [
        "idx_idr_items_lifecycle_scope_dimension",
        "idx_idr_items_candidate_disposition",
        "uq_idr_items_supersedes_predecessor",
        "idx_idr_item_provenance_reverse",
        "idx_idr_item_reality_reverse",
        "uq_idr_history_item_revision",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            [index],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(StorageError::OpenGate(format!(
                "required index missing: {index}"
            )));
        }
    }
    let item_sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='idr_human_model_items'",
        [],
        |row| row.get(0),
    )?;
    let normalized = item_sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    for fragment in [
        "KIND IN ('FACT', 'PREFERENCE', 'OBSERVATION', 'DISPOSITION', 'LONG_TERM_GOAL')",
        "LIFECYCLE IN ('CANDIDATE', 'ACTIVE', 'WEAKENED', 'CONFLICTED', 'SUPERSEDED', 'REVOKED')",
        "EVIDENCE_BASIS IN ('EXPLICIT', 'OBSERVED', 'INFERRED')",
        "INFERENCE_CONFIDENCE IN ('LOW', 'MEDIUM', 'HIGH')",
        "JSON_VALID(TYPED_PAYLOAD_JSON)",
        "LENGTH(CAST(TYPED_PAYLOAD_JSON AS BLOB)) BETWEEN 2 AND 16384",
        "PAYLOAD_SCHEMA_VERSION = 1",
    ] {
        if !normalized.contains(fragment) {
            return Err(StorageError::OpenGate(format!(
                "required IDR CHECK missing: {fragment}"
            )));
        }
    }
    for forbidden in [
        "idr_update_proposals",
        "idr_resolutions",
        "idr_direction_snapshots",
        "idr_forget_requests",
        "idr_observations",
        "idr_run_contexts",
        "idr_profiles",
        "idr_users",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [forbidden],
            |row| row.get(0),
        )?;
        if exists != 0 {
            return Err(StorageError::OpenGate(format!(
                "forbidden IDR table detected: {forbidden}"
            )));
        }
    }
    Ok(())
}

fn validate_artifact_archive_schema(connection: &Connection) -> Result<(), StorageError> {
    for column in [
        "archived_at",
        "lifecycle_updated_by_tool_call_id",
        "lifecycle_mutation_request_sha256",
    ] {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('artifacts') WHERE name=?1",
            [column],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(StorageError::OpenGate(format!(
                "required column missing: artifacts.{column}"
            )));
        }
    }
    let index: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_artifacts_profile_archive_updated'",
        [],
        |row| row.get(0),
    )?;
    if index != 1 {
        return Err(StorageError::OpenGate(
            "required index missing: idx_artifacts_profile_archive_updated".into(),
        ));
    }
    Ok(())
}

fn validate_asset_schema(connection: &Connection) -> Result<(), StorageError> {
    let exists: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='assets'",
        [],
        |row| row.get(0),
    )?;
    if exists != 1 {
        return Err(StorageError::OpenGate(
            "migration validation missing table assets".into(),
        ));
    }
    for column in [
        "profile_id",
        "media_type",
        "content_sha256",
        "byte_length",
        "width",
        "height",
        "blob_ref",
        "mutation_request_sha256",
        "created_by_tool_call_id",
    ] {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('assets') WHERE name=?1 AND \"notnull\"=1",
            [column],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(StorageError::OpenGate(format!(
                "required NOT NULL column missing: assets.{column}"
            )));
        }
    }
    let sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'",
        [],
        |row| row.get(0),
    )?;
    let normalized = sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    for fragment in [
        "MEDIA_TYPE = 'IMAGE/PNG'",
        "BYTE_LENGTH BETWEEN 1 AND 8388608",
        "WIDTH BETWEEN 1 AND 4096",
        "HEIGHT BETWEEN 1 AND 4096",
        "BLOB_REF = 'BLOBS/OBJECTS/'",
    ] {
        if !normalized.contains(fragment) {
            return Err(StorageError::OpenGate(format!(
                "required CHECK missing: assets:{fragment}"
            )));
        }
    }
    for (kind, name) in [
        ("index", "idx_assets_profile_created"),
        ("trigger", "assets_immutable_update"),
        ("trigger", "assets_immutable_delete"),
    ] {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type=?1 AND name=?2",
            params![kind, name],
            |row| row.get(0),
        )?;
        if count != 1 {
            return Err(StorageError::OpenGate(format!(
                "required {kind} missing: {name}"
            )));
        }
    }
    Ok(())
}

fn bootstrap_records(
    connection: &mut Connection,
    device: &DeviceIdentity,
    now: i64,
) -> Result<PrincipalId, StorageError> {
    let transaction = connection.transaction()?;
    let local_user = ensure_principal(&transaction, "LOCAL_USER", LOCAL_USER_NAME, now)?;
    ensure_principal(&transaction, "SYSTEM", SYSTEM_NAME, now)?;
    transaction.execute(
        "INSERT INTO devices(id, name, platform, architecture, created_at, last_seen_at)\n\
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)\n\
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, platform=excluded.platform,\n\
         architecture=excluded.architecture, last_seen_at=excluded.last_seen_at",
        params![
            device.id.0,
            device.name,
            device.platform,
            device.architecture,
            now
        ],
    )?;
    transaction.execute(
        "INSERT OR IGNORE INTO profiles(singleton_key, profile_id, schema_version, created_at) VALUES(1, ?1, 1, ?2)",
        params![Uuid::now_v7().to_string(), now],
    )?;
    transaction.commit()?;
    Ok(local_user)
}

fn ensure_principal(
    transaction: &Transaction<'_>,
    kind: &str,
    display_name: &str,
    now: i64,
) -> Result<PrincipalId, StorageError> {
    if let Some(id) = transaction
        .query_row("SELECT id FROM principals WHERE kind=?1", [kind], |row| {
            row.get::<_, String>(0)
        })
        .optional()?
    {
        return Ok(PrincipalId::new(id));
    }
    let id = PrincipalId::new(Uuid::now_v7().to_string());
    transaction.execute(
        "INSERT INTO principals(id, kind, display_name, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id.0, kind, display_name, now],
    )?;
    Ok(id)
}

fn create_field(
    connection: &mut Connection,
    field: &Field,
    activity: &Activity,
) -> Result<(), StorageError> {
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO fields(id, owner_principal_id, title, goal, lifecycle_status, current_mode,\n\
         current_focus_json, revision, created_at, updated_at)\n\
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            field.id.0,
            field.owner_principal_id.0,
            field.title,
            field.goal,
            lifecycle_to_db(field.lifecycle_status),
            field.current_mode.map(mode_to_db),
            encode_optional_json(&field.current_focus)?,
            revision_to_sql(field.revision)?,
            field.created_at,
            field.updated_at
        ],
    )?;
    insert_activity(&transaction, activity)?;
    transaction.commit()?;
    Ok(())
}

fn list_fields(connection: &Connection) -> Result<Vec<Field>, StorageError> {
    let mut statement = connection.prepare(
        "SELECT id, owner_principal_id, title, goal, lifecycle_status, current_mode,\n\
         current_focus_json, revision, created_at, updated_at\n\
         FROM fields WHERE lifecycle_status='ACTIVE' ORDER BY updated_at DESC",
    )?;
    statement
        .query_map([], field_from_row)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}

fn get_field(connection: &Connection, field_id: &FieldId) -> Result<Field, DomainError> {
    connection
        .query_row(
            "SELECT id, owner_principal_id, title, goal, lifecycle_status, current_mode,\n\
             current_focus_json, revision, created_at, updated_at FROM fields WHERE id=?1",
            [&field_id.0],
            field_from_row,
        )
        .optional()
        .map_err(|error| DomainError::Storage(error.to_string()))?
        .ok_or(DomainError::NotFound)
}

fn update_focus(
    connection: &mut Connection,
    field_id: &FieldId,
    expected_revision: u64,
    focus: &Value,
    updated_at: i64,
    activity: &Activity,
) -> Result<Field, DomainError> {
    let transaction = connection
        .transaction()
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    let focus_json =
        serde_json::to_string(focus).map_err(|error| DomainError::Validation(error.to_string()))?;
    let changed = transaction
        .execute(
            "UPDATE fields SET current_focus_json=?1, revision=revision+1, updated_at=MAX(updated_at, ?2)\n\
             WHERE id=?3 AND revision=?4",
            params![
                focus_json,
                updated_at,
                field_id.0,
                i64::try_from(expected_revision).map_err(|_| DomainError::Validation(
                    "expected_revision is too large".into()
                ))?
            ],
        )
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    if changed == 0 {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM fields WHERE id=?1)",
                [&field_id.0],
                |row| row.get(0),
            )
            .map_err(|error| DomainError::Storage(error.to_string()))?;
        return Err(if exists {
            DomainError::RevisionConflict
        } else {
            DomainError::NotFound
        });
    }
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field = transaction
        .query_row(
            "SELECT id, owner_principal_id, title, goal, lifecycle_status, current_mode,\n\
             current_focus_json, revision, created_at, updated_at FROM fields WHERE id=?1",
            [&field_id.0],
            field_from_row,
        )
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    transaction
        .commit()
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    Ok(field)
}

fn update_mode(
    connection: &mut Connection,
    field_id: &FieldId,
    expected_revision: u64,
    mode: Option<FieldMode>,
    updated_at: i64,
    activity: &Activity,
) -> Result<Field, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let changed = transaction
        .execute(
            "UPDATE fields SET current_mode=?1, revision=revision+1, updated_at=MAX(updated_at, ?2) WHERE id=?3 AND revision=?4",
            params![mode.map(mode_to_db), updated_at, field_id.0, revision_to_domain(expected_revision)?],
        )
        .map_err(storage_domain)?;
    ensure_mutated_field(&transaction, field_id, changed)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field = get_field_tx(&transaction, field_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(field)
}

fn set_focus_v1(
    connection: &mut Connection,
    field_id: &FieldId,
    expected_revision: u64,
    focus: Option<&FieldFocusV1>,
    updated_at: i64,
    activity: &Activity,
) -> Result<Field, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    if let Some(focus) = focus {
        match focus {
            FieldFocusV1::State { state_id } => {
                let valid: bool = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM field_state_entries WHERE id=?1 AND field_id=?2 AND status IN ('ACTIVE','RESOLVED'))",
                        params![state_id.0, field_id.0],
                        |row| row.get(0),
                    )
                    .map_err(storage_domain)?;
                if !valid {
                    return Err(DomainError::InvalidRelationEndpoint);
                }
            }
            FieldFocusV1::Reference { object_id } => {
                let valid: bool = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM field_objects WHERE id=?1 AND field_id=?2 AND lifecycle_status='ACTIVE')",
                        params![object_id.0, field_id.0],
                        |row| row.get(0),
                    )
                    .map_err(storage_domain)?;
                if !valid {
                    return Err(DomainError::InvalidRelationEndpoint);
                }
            }
        }
    }
    let focus_json = focus
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| DomainError::Validation(error.to_string()))?;
    let changed = transaction
        .execute(
            "UPDATE fields SET current_focus_json=?1, revision=revision+1, updated_at=MAX(updated_at, ?2) WHERE id=?3 AND revision=?4",
            params![focus_json, updated_at, field_id.0, revision_to_domain(expected_revision)?],
        )
        .map_err(storage_domain)?;
    ensure_mutated_field(&transaction, field_id, changed)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field = get_field_tx(&transaction, field_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(field)
}

fn ensure_mutated_field(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    changed: usize,
) -> Result<(), DomainError> {
    if changed == 1 {
        return Ok(());
    }
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM fields WHERE id=?1)",
            [&field_id.0],
            |row| row.get(0),
        )
        .map_err(storage_domain)?;
    Err(if exists {
        DomainError::RevisionConflict
    } else {
        DomainError::NotFound
    })
}

fn get_field_tx(transaction: &Transaction<'_>, field_id: &FieldId) -> Result<Field, DomainError> {
    transaction
        .query_row(
            "SELECT id, owner_principal_id, title, goal, lifecycle_status, current_mode, current_focus_json, revision, created_at, updated_at FROM fields WHERE id=?1",
            [&field_id.0], field_from_row,
        )
        .optional()
        .map_err(storage_domain)?
        .ok_or(DomainError::NotFound)
}

fn revision_to_domain(value: u64) -> Result<i64, DomainError> {
    i64::try_from(value).map_err(|_| DomainError::Validation("revision is too large".into()))
}

fn storage_domain(error: rusqlite::Error) -> DomainError {
    DomainError::Storage(error.to_string())
}

fn insert_activity(transaction: &Transaction<'_>, activity: &Activity) -> Result<(), StorageError> {
    transaction.execute(
        "INSERT INTO activities(id, field_id, actor_principal_id, intent, action, target_type,\n\
         target_id, summary, trace_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            activity.id,
            activity.field_id.as_ref().map(|id| &id.0),
            activity.actor_principal_id.0,
            activity.intent,
            activity.action,
            activity.target_type,
            activity.target_id,
            activity.summary,
            activity.trace_id.0,
            activity.created_at
        ],
    )?;
    Ok(())
}

fn save_snapshot(
    connection: &mut Connection,
    field_id: &FieldId,
    device_id: &DeviceId,
    layout: &Value,
    open_objects: &[ObjectId],
    created_at: i64,
) -> Result<SurfaceSnapshot, DomainError> {
    let transaction = connection
        .transaction()
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    let observed_field_revision: Option<i64> = transaction
        .query_row(
            "SELECT revision FROM fields WHERE id=?1",
            [&field_id.0],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    let observed_field_revision =
        u64::try_from(observed_field_revision.ok_or(DomainError::NotFound)?)
            .map_err(|_| DomainError::Storage("persisted revision is invalid".into()))?;
    let id = SurfaceSnapshotId::new(Uuid::now_v7().to_string());
    let layout_json = serde_json::to_string(layout)
        .map_err(|error| DomainError::Validation(error.to_string()))?;
    let open_objects_json = serde_json::to_string(
        &open_objects
            .iter()
            .map(|object| &object.0)
            .collect::<Vec<_>>(),
    )
    .map_err(|error| DomainError::Validation(error.to_string()))?;
    transaction
        .execute(
            "INSERT INTO surface_snapshots(id, field_id, device_id, observed_field_revision,\n\
             layout_json, open_objects_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id.0,
                field_id.0,
                device_id.0,
                i64::try_from(observed_field_revision)
                    .map_err(|_| DomainError::Storage("revision is too large".into()))?,
                layout_json,
                open_objects_json,
                created_at
            ],
        )
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    transaction
        .execute(
            "DELETE FROM surface_snapshots WHERE id IN (\n\
             SELECT id FROM surface_snapshots WHERE field_id=?1 AND device_id=?2\n\
             ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET 10)",
            params![field_id.0, device_id.0],
        )
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    transaction
        .commit()
        .map_err(|error| DomainError::Storage(error.to_string()))?;
    Ok(SurfaceSnapshot {
        id,
        field_id: field_id.clone(),
        device_id: device_id.clone(),
        observed_field_revision,
        layout: layout.clone(),
        open_objects: open_objects.to_vec(),
        created_at,
    })
}

fn latest_snapshot(
    connection: &Connection,
    field_id: &FieldId,
    device_id: &DeviceId,
) -> Result<Option<SurfaceSnapshot>, DomainError> {
    connection
        .query_row(
            "SELECT id, field_id, device_id, observed_field_revision, layout_json,\n\
             open_objects_json, created_at FROM surface_snapshots\n\
             WHERE field_id=?1 AND device_id=?2 ORDER BY created_at DESC, id DESC LIMIT 1",
            params![field_id.0, device_id.0],
            snapshot_from_row,
        )
        .optional()
        .map_err(|error| DomainError::Storage(error.to_string()))
}

fn save_snapshot_v1(
    connection: &mut Connection,
    field_id: &FieldId,
    device_id: &DeviceId,
    layout: &SurfaceLayoutV1,
    open_references: &[ObjectId],
    created_at: i64,
) -> Result<SurfaceSnapshotV1View, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let observed: Option<i64> = transaction
        .query_row(
            "SELECT revision FROM fields WHERE id=?1",
            [&field_id.0],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_domain)?;
    let observed = u64::try_from(observed.ok_or(DomainError::NotFound)?)
        .map_err(|_| DomainError::Storage("persisted revision is invalid".into()))?;
    for object_id in open_references {
        let active: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM field_objects WHERE id=?1 AND field_id=?2 AND object_kind='REFERENCE' AND lifecycle_status='ACTIVE')",
                params![object_id.0, field_id.0],
                |row| row.get(0),
            )
            .map_err(storage_domain)?;
        if !active {
            return Err(DomainError::SnapshotReferenceUnavailable);
        }
    }
    let id = SurfaceSnapshotId::new(Uuid::now_v7().to_string());
    let layout_json = serde_json::to_string(layout)
        .map_err(|error| DomainError::Validation(error.to_string()))?;
    let open_json =
        serde_json::to_string(&open_references.iter().map(|id| &id.0).collect::<Vec<_>>())
            .map_err(|error| DomainError::Validation(error.to_string()))?;
    transaction
        .execute(
            "INSERT INTO surface_snapshots(id, field_id, device_id, observed_field_revision, layout_json, open_objects_json, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![id.0, field_id.0, device_id.0, revision_to_domain(observed)?, layout_json, open_json, created_at],
        )
        .map_err(storage_domain)?;
    transaction
        .execute(
            "DELETE FROM surface_snapshots WHERE id IN (SELECT id FROM surface_snapshots WHERE field_id=?1 AND device_id=?2 ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET 10)",
            params![field_id.0, device_id.0],
        )
        .map_err(storage_domain)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(SurfaceSnapshotV1View {
        id,
        field_id: field_id.clone(),
        device_id: device_id.clone(),
        observed_field_revision: observed,
        layout: layout.clone(),
        open_reference_ids: open_references.to_vec(),
        created_at,
    })
}

fn bump_field(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    updated_at: i64,
) -> Result<u64, DomainError> {
    let changed = transaction
        .execute(
            "UPDATE fields SET revision=revision+1, updated_at=MAX(updated_at, ?1) WHERE id=?2 AND lifecycle_status='ACTIVE'",
            params![updated_at, field_id.0],
        )
        .map_err(storage_domain)?;
    if changed == 0 {
        return Err(DomainError::NotFound);
    }
    let revision: i64 = transaction
        .query_row(
            "SELECT revision FROM fields WHERE id=?1",
            [&field_id.0],
            |row| row.get(0),
        )
        .map_err(storage_domain)?;
    u64::try_from(revision)
        .map_err(|_| DomainError::Storage("persisted field revision is invalid".into()))
}

fn create_state(
    connection: &mut Connection,
    state: &StateView,
    activity: &Activity,
) -> Result<RealityMutationResult<StateView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    ensure_active_field(&transaction, &state.field_id)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    transaction
        .execute(
            "INSERT INTO field_state_entries(id,field_id,kind,content,status,confidence,created_by,source_activity_id,revision,created_at,updated_at) VALUES (?1,?2,?3,?4,'ACTIVE',?5,?6,?7,1,?8,?8)",
            params![state.id.0, state.field_id.0, state_kind_to_db(state.kind), state.content, state.confidence, state.created_by.0, state.source_activity_id.0, state.created_at],
        )
        .map_err(storage_domain)?;
    let field_revision = bump_field(&transaction, &state.field_id, state.created_at)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource: state.clone(),
        field_revision,
    })
}

fn get_state(
    connection: &Connection,
    field_id: &FieldId,
    state_id: &StateId,
) -> Result<StateView, DomainError> {
    connection
        .query_row(
            "SELECT id,field_id,kind,content,status,confidence,created_by,source_activity_id,revision,created_at,updated_at FROM field_state_entries WHERE id=?1 AND field_id=?2",
            params![state_id.0, field_id.0], state_from_row,
        )
        .optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn get_state_tx(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    state_id: &StateId,
) -> Result<StateView, DomainError> {
    transaction
        .query_row(
            "SELECT id,field_id,kind,content,status,confidence,created_by,source_activity_id,revision,created_at,updated_at FROM field_state_entries WHERE id=?1 AND field_id=?2",
            params![state_id.0, field_id.0], state_from_row,
        )
        .optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn list_states(
    connection: &Connection,
    request: &ListStatesRequest,
) -> Result<Page<StateView, StateCursor>, DomainError> {
    let limit = i64::from(request.limit.unwrap_or(50));
    let kind = request.kind.map(state_kind_to_db);
    let status = request.status.map(state_status_to_db);
    let cursor_time = request.cursor.as_ref().map(|cursor| cursor.updated_at);
    let cursor_id = request
        .cursor
        .as_ref()
        .map(|cursor| cursor.state_id.0.as_str());
    let mut statement = connection.prepare(
        "SELECT id,field_id,kind,content,status,confidence,created_by,source_activity_id,revision,created_at,updated_at FROM field_state_entries
         WHERE field_id=?1 AND (?2 IS NULL OR kind=?2) AND (?3 IS NULL OR status=?3)
         AND (?4 IS NULL OR updated_at < ?4 OR (updated_at=?4 AND id < ?5))
         ORDER BY updated_at DESC,id DESC LIMIT ?6"
    ).map_err(storage_domain)?;
    let rows = statement
        .query_map(
            params![
                request.field_id.0,
                kind,
                status,
                cursor_time,
                cursor_id,
                limit + 1
            ],
            state_from_row,
        )
        .map_err(storage_domain)?;
    let mut items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_domain)?;
    let next_cursor = if items.len() > limit as usize {
        items.truncate(limit as usize);
        items.last().map(|item| StateCursor {
            updated_at: item.updated_at,
            state_id: item.id.clone(),
        })
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

fn revise_state(
    connection: &mut Connection,
    request: &ReviseStateRequest,
    content: &str,
    confidence: Option<f64>,
    updated_at: i64,
    activity: &Activity,
) -> Result<RealityMutationResult<StateView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let current = get_state_tx(&transaction, &request.field_id, &request.state_id)?;
    if matches!(
        current.status,
        StateStatus::Superseded | StateStatus::Retracted
    ) {
        return Err(DomainError::TerminalResource);
    }
    if current.revision != request.expected_state_revision {
        return Err(DomainError::RevisionConflict);
    }
    transaction.execute(
        "UPDATE field_state_entries SET content=?1,confidence=?2,revision=revision+1,updated_at=MAX(updated_at,?3) WHERE id=?4",
        params![content, confidence, updated_at, request.state_id.0],
    ).map_err(storage_domain)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field_revision = bump_field(&transaction, &request.field_id, updated_at)?;
    let resource = get_state_tx(&transaction, &request.field_id, &request.state_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource,
        field_revision,
    })
}

fn transition_state(
    connection: &mut Connection,
    request: &TransitionStateRequest,
    updated_at: i64,
    activity: &Activity,
) -> Result<RealityMutationResult<StateView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let current = get_state_tx(&transaction, &request.field_id, &request.state_id)?;
    if matches!(
        current.status,
        StateStatus::Superseded | StateStatus::Retracted
    ) {
        return Err(DomainError::TerminalResource);
    }
    if current.revision != request.expected_state_revision {
        return Err(DomainError::RevisionConflict);
    }
    let target = match request.target {
        StateTransitionTarget::Active => StateStatus::Active,
        StateTransitionTarget::Resolved => StateStatus::Resolved,
        StateTransitionTarget::Retracted => StateStatus::Retracted,
    };
    let resolvable = matches!(
        current.kind,
        FieldStateKind::Question | FieldStateKind::Task | FieldStateKind::Blocker
    );
    let allowed = match (current.status, target) {
        (StateStatus::Active, StateStatus::Retracted) => true,
        (StateStatus::Active, StateStatus::Resolved)
        | (StateStatus::Resolved, StateStatus::Active)
        | (StateStatus::Resolved, StateStatus::Retracted) => resolvable,
        _ => false,
    };
    if !allowed {
        return Err(DomainError::InvalidStateTransition);
    }
    transaction.execute(
        "UPDATE field_state_entries SET status=?1,revision=revision+1,updated_at=MAX(updated_at,?2) WHERE id=?3",
        params![state_status_to_db(target), updated_at, request.state_id.0],
    ).map_err(storage_domain)?;
    if target == StateStatus::Retracted {
        clear_typed_state_focus(&transaction, &request.field_id, &request.state_id)?;
    }
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field_revision = bump_field(&transaction, &request.field_id, updated_at)?;
    let resource = get_state_tx(&transaction, &request.field_id, &request.state_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource,
        field_revision,
    })
}

#[allow(clippy::too_many_arguments)]
fn supersede_state(
    connection: &mut Connection,
    request: &SupersedeStateRequest,
    replacement_id: &StateId,
    relation_id: &RelationId,
    content: &str,
    confidence: Option<f64>,
    updated_at: i64,
    activity: &Activity,
) -> Result<SupersedeStateResult, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let current = get_state_tx(&transaction, &request.field_id, &request.state_id)?;
    if matches!(
        current.status,
        StateStatus::Superseded | StateStatus::Retracted
    ) {
        return Err(DomainError::TerminalResource);
    }
    if current.revision != request.expected_state_revision {
        return Err(DomainError::RevisionConflict);
    }
    if current.status == StateStatus::Resolved
        && !matches!(
            current.kind,
            FieldStateKind::Question | FieldStateKind::Task | FieldStateKind::Blocker
        )
    {
        return Err(DomainError::InvalidStateTransition);
    }
    insert_activity(&transaction, activity).map_err(map_storage)?;
    transaction.execute("UPDATE field_state_entries SET status='SUPERSEDED',revision=revision+1,updated_at=MAX(updated_at,?1) WHERE id=?2", params![updated_at, request.state_id.0]).map_err(storage_domain)?;
    transaction.execute(
        "INSERT INTO field_state_entries(id,field_id,kind,content,status,confidence,created_by,source_activity_id,revision,created_at,updated_at) VALUES (?1,?2,?3,?4,'ACTIVE',?5,?6,?7,1,?8,?8)",
        params![replacement_id.0, request.field_id.0, state_kind_to_db(current.kind), content, confidence, activity.actor_principal_id.0, activity.id, updated_at],
    ).map_err(storage_domain)?;
    transaction.execute(
        "INSERT INTO field_relations(id,field_id,from_type,from_id,relation_type,to_type,to_id,lifecycle_status,created_by,revision,created_at,updated_at) VALUES (?1,?2,'STATE',?3,'SUPERSEDED_BY','STATE',?4,'ACTIVE',?5,1,?6,?6)",
        params![relation_id.0, request.field_id.0, request.state_id.0, replacement_id.0, activity.actor_principal_id.0, updated_at],
    ).map_err(storage_domain)?;
    move_typed_state_focus(
        &transaction,
        &request.field_id,
        &request.state_id,
        replacement_id,
    )?;
    let field_revision = bump_field(&transaction, &request.field_id, updated_at)?;
    let previous = get_state_tx(&transaction, &request.field_id, &request.state_id)?;
    let replacement = get_state_tx(&transaction, &request.field_id, replacement_id)?;
    let relation = get_relation_tx(&transaction, &request.field_id, relation_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(SupersedeStateResult {
        previous,
        replacement,
        relation,
        field_revision,
    })
}

fn create_reference(
    connection: &mut Connection,
    reference: &ReferenceView,
    activity: &Activity,
) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    ensure_active_field(&transaction, &reference.field_id)?;
    ensure_reference_url_available(
        &transaction,
        &reference.field_id,
        &reference.canonical_url,
        None,
    )?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    transaction.execute(
        "INSERT INTO field_objects(id,field_id,owner_principal_id,created_by,source_activity_id,object_kind,title,external_ref_type,external_ref_id,metadata_json,lifecycle_status,revision,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,'REFERENCE',?6,'HTTPS_URL',?7,'{}','ACTIVE',1,?8,?8)",
        params![reference.id.0, reference.field_id.0, reference.owner_principal_id.0, reference.created_by.0, reference.source_activity_id.0, reference.title, reference.canonical_url, reference.created_at],
    ).map_err(map_reference_write_error)?;
    let field_revision = bump_field(&transaction, &reference.field_id, reference.created_at)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource: reference.clone(),
        field_revision,
    })
}

fn get_reference(
    connection: &Connection,
    field_id: &FieldId,
    object_id: &ObjectId,
) -> Result<ReferenceView, DomainError> {
    connection.query_row(
        "SELECT id,field_id,owner_principal_id,created_by,source_activity_id,object_kind,title,external_ref_type,external_ref_id,lifecycle_status,revision,created_at,updated_at FROM field_objects WHERE id=?1 AND field_id=?2",
        params![object_id.0, field_id.0], reference_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn get_reference_tx(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    object_id: &ObjectId,
) -> Result<ReferenceView, DomainError> {
    transaction.query_row(
        "SELECT id,field_id,owner_principal_id,created_by,source_activity_id,object_kind,title,external_ref_type,external_ref_id,lifecycle_status,revision,created_at,updated_at FROM field_objects WHERE id=?1 AND field_id=?2",
        params![object_id.0, field_id.0], reference_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn list_references(
    connection: &Connection,
    request: &ListReferencesRequest,
) -> Result<Page<ReferenceView, ReferenceCursor>, DomainError> {
    let limit = i64::from(request.limit.unwrap_or(50));
    let lifecycle = Some(object_lifecycle_to_db(
        request.lifecycle.unwrap_or(ObjectLifecycle::Active),
    ));
    let cursor_time = request.cursor.as_ref().map(|cursor| cursor.updated_at);
    let cursor_id = request
        .cursor
        .as_ref()
        .map(|cursor| cursor.object_id.0.as_str());
    let mut statement = connection.prepare(
        "SELECT id,field_id,owner_principal_id,created_by,source_activity_id,object_kind,title,external_ref_type,external_ref_id,lifecycle_status,revision,created_at,updated_at FROM field_objects
         WHERE field_id=?1 AND object_kind='REFERENCE' AND (?2 IS NULL OR lifecycle_status=?2)
         AND (?3 IS NULL OR updated_at < ?3 OR (updated_at=?3 AND id < ?4))
         ORDER BY updated_at DESC,id DESC LIMIT ?5"
    ).map_err(storage_domain)?;
    let rows = statement
        .query_map(
            params![
                request.field_id.0,
                lifecycle,
                cursor_time,
                cursor_id,
                limit + 1
            ],
            reference_from_row,
        )
        .map_err(storage_domain)?;
    let mut items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_domain)?;
    let next_cursor = if items.len() > limit as usize {
        items.truncate(limit as usize);
        items.last().map(|item| ReferenceCursor {
            updated_at: item.updated_at,
            object_id: item.id.clone(),
        })
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

fn revise_reference(
    connection: &mut Connection,
    request: &ReviseReferenceRequest,
    title: &str,
    canonical_url: &str,
    updated_at: i64,
    activity: &Activity,
) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let current = get_reference_tx(&transaction, &request.field_id, &request.object_id)?;
    if current.lifecycle == ObjectLifecycle::Archived {
        return Err(DomainError::TerminalResource);
    }
    if current.revision != request.expected_object_revision {
        return Err(DomainError::RevisionConflict);
    }
    ensure_reference_url_available(
        &transaction,
        &request.field_id,
        canonical_url,
        Some(&request.object_id),
    )?;
    transaction.execute(
        "UPDATE field_objects SET title=?1,external_ref_id=?2,revision=revision+1,updated_at=MAX(updated_at,?3) WHERE id=?4",
        params![title, canonical_url, updated_at, request.object_id.0],
    ).map_err(map_reference_write_error)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field_revision = bump_field(&transaction, &request.field_id, updated_at)?;
    let resource = get_reference_tx(&transaction, &request.field_id, &request.object_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource,
        field_revision,
    })
}

fn archive_reference(
    connection: &mut Connection,
    request: &ArchiveReferenceRequest,
    updated_at: i64,
    activity: &Activity,
) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let current = get_reference_tx(&transaction, &request.field_id, &request.object_id)?;
    if current.lifecycle == ObjectLifecycle::Archived {
        return Err(DomainError::TerminalResource);
    }
    if current.revision != request.expected_object_revision {
        return Err(DomainError::RevisionConflict);
    }
    transaction.execute("UPDATE field_objects SET lifecycle_status='ARCHIVED',revision=revision+1,updated_at=MAX(updated_at,?1) WHERE id=?2", params![updated_at, request.object_id.0]).map_err(storage_domain)?;
    transaction.execute(
        "UPDATE field_relations SET lifecycle_status='RETRACTED',revision=revision+1,updated_at=MAX(updated_at,?1) WHERE field_id=?2 AND relation_type='SOURCED_FROM' AND to_type='OBJECT' AND to_id=?3 AND lifecycle_status='ACTIVE'",
        params![updated_at, request.field_id.0, request.object_id.0],
    ).map_err(storage_domain)?;
    clear_typed_reference_focus(&transaction, &request.field_id, &request.object_id)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field_revision = bump_field(&transaction, &request.field_id, updated_at)?;
    let resource = get_reference_tx(&transaction, &request.field_id, &request.object_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource,
        field_revision,
    })
}

fn restore_reference(
    connection: &mut Connection,
    request: &RestoreReferenceRequest,
    updated_at: i64,
    activity: &Activity,
) -> Result<RealityMutationResult<ReferenceView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let current = get_reference_tx(&transaction, &request.field_id, &request.object_id)?;
    if current.lifecycle != ObjectLifecycle::Archived {
        return Err(DomainError::InvalidStateTransition);
    }
    if current.revision != request.expected_object_revision {
        return Err(DomainError::RevisionConflict);
    }
    ensure_reference_url_available(
        &transaction,
        &request.field_id,
        &current.canonical_url,
        Some(&request.object_id),
    )?;
    transaction.execute("UPDATE field_objects SET lifecycle_status='ACTIVE',revision=revision+1,updated_at=MAX(updated_at,?1) WHERE id=?2", params![updated_at, request.object_id.0]).map_err(map_reference_write_error)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field_revision = bump_field(&transaction, &request.field_id, updated_at)?;
    let resource = get_reference_tx(&transaction, &request.field_id, &request.object_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource,
        field_revision,
    })
}

fn ensure_reference_url_available(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    url: &str,
    excluding: Option<&ObjectId>,
) -> Result<(), DomainError> {
    let duplicate: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM field_objects WHERE field_id=?1 AND object_kind='REFERENCE' AND lifecycle_status='ACTIVE' AND external_ref_type='HTTPS_URL' AND external_ref_id=?2 AND (?3 IS NULL OR id != ?3))",
        params![field_id.0, url, excluding.map(|id| id.0.as_str())], |row| row.get(0),
    ).map_err(storage_domain)?;
    if duplicate {
        Err(DomainError::DuplicateActiveReference)
    } else {
        Ok(())
    }
}

fn map_reference_write_error(error: rusqlite::Error) -> DomainError {
    if is_constraint(&error) {
        DomainError::DuplicateActiveReference
    } else {
        storage_domain(error)
    }
}

fn attach_reference_source(
    connection: &mut Connection,
    request: &AttachReferenceSourceRequest,
    relation_id: &RelationId,
    created_at: i64,
    activity: &Activity,
) -> Result<RealityMutationResult<RelationView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let _state =
        get_state_tx(&transaction, &request.field_id, &request.state_id).map_err(|error| {
            match error {
                DomainError::NotFound => DomainError::InvalidRelationEndpoint,
                other => other,
            }
        })?;
    let reference = get_reference_tx(&transaction, &request.field_id, &request.reference_id)
        .map_err(|error| match error {
            DomainError::NotFound => DomainError::InvalidRelationEndpoint,
            other => other,
        })?;
    if reference.lifecycle != ObjectLifecycle::Active {
        return Err(DomainError::InvalidRelationEndpoint);
    }
    let duplicate: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM field_relations WHERE field_id=?1 AND relation_type='SOURCED_FROM' AND from_type='STATE' AND from_id=?2 AND to_type='OBJECT' AND to_id=?3 AND lifecycle_status='ACTIVE')",
        params![request.field_id.0, request.state_id.0, request.reference_id.0], |row| row.get(0),
    ).map_err(storage_domain)?;
    if duplicate {
        return Err(DomainError::DuplicateActiveRelation);
    }
    transaction.execute(
        "INSERT INTO field_relations(id,field_id,from_type,from_id,relation_type,to_type,to_id,lifecycle_status,created_by,revision,created_at,updated_at) VALUES (?1,?2,'STATE',?3,'SOURCED_FROM','OBJECT',?4,'ACTIVE',?5,1,?6,?6)",
        params![relation_id.0, request.field_id.0, request.state_id.0, request.reference_id.0, activity.actor_principal_id.0, created_at],
    ).map_err(|error| if is_constraint(&error) { DomainError::DuplicateActiveRelation } else { storage_domain(error) })?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field_revision = bump_field(&transaction, &request.field_id, created_at)?;
    let resource = get_relation_tx(&transaction, &request.field_id, relation_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource,
        field_revision,
    })
}

fn retract_reference_source(
    connection: &mut Connection,
    request: &RetractReferenceSourceRequest,
    updated_at: i64,
    activity: &Activity,
) -> Result<RealityMutationResult<RelationView>, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let current = get_relation_tx(&transaction, &request.field_id, &request.relation_id)?;
    if current.relation_type != RelationType::SourcedFrom {
        return Err(DomainError::InvalidRelationMatrix);
    }
    if current.lifecycle != RelationLifecycle::Active {
        return Err(DomainError::TerminalResource);
    }
    if current.revision != request.expected_relation_revision {
        return Err(DomainError::RevisionConflict);
    }
    transaction.execute("UPDATE field_relations SET lifecycle_status='RETRACTED',revision=revision+1,updated_at=MAX(updated_at,?1) WHERE id=?2", params![updated_at, request.relation_id.0]).map_err(storage_domain)?;
    insert_activity(&transaction, activity).map_err(map_storage)?;
    let field_revision = bump_field(&transaction, &request.field_id, updated_at)?;
    let resource = get_relation_tx(&transaction, &request.field_id, &request.relation_id)?;
    transaction.commit().map_err(storage_domain)?;
    Ok(RealityMutationResult {
        resource,
        field_revision,
    })
}

fn get_relation_tx(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    relation_id: &RelationId,
) -> Result<RelationView, DomainError> {
    transaction.query_row(
        "SELECT id,field_id,from_type,from_id,relation_type,to_type,to_id,lifecycle_status,created_by,revision,created_at,updated_at FROM field_relations WHERE id=?1 AND field_id=?2",
        params![relation_id.0, field_id.0], relation_from_row,
    ).optional().map_err(storage_domain)?.ok_or(DomainError::NotFound)
}

fn list_relations(
    connection: &Connection,
    request: &ListRelationsRequest,
) -> Result<Page<RelationView, RelationCursor>, DomainError> {
    let limit = i64::from(request.limit.unwrap_or(50));
    let relation_type = request.relation_type.map(relation_type_to_db);
    let lifecycle = Some(relation_lifecycle_to_db(
        request.lifecycle.unwrap_or(RelationLifecycle::Active),
    ));
    let (endpoint_type, endpoint_id): (Option<&str>, Option<&str>) = match &request.endpoint {
        Some(LineageEndpointRef::State { state_id }) => (Some("STATE"), Some(state_id.0.as_str())),
        Some(LineageEndpointRef::Reference { object_id }) => {
            (Some("OBJECT"), Some(object_id.0.as_str()))
        }
        None => (None, None),
    };
    let cursor_time = request.cursor.as_ref().map(|cursor| cursor.created_at);
    let cursor_id = request
        .cursor
        .as_ref()
        .map(|cursor| cursor.relation_id.0.as_str());
    let mut statement=connection.prepare(
        "SELECT id,field_id,from_type,from_id,relation_type,to_type,to_id,lifecycle_status,created_by,revision,created_at,updated_at FROM field_relations
         WHERE field_id=?1 AND (?2 IS NULL OR relation_type=?2) AND (?3 IS NULL OR lifecycle_status=?3)
         AND (?4 IS NULL OR (from_type=?4 AND from_id=?5) OR (to_type=?4 AND to_id=?5))
         AND (?6 IS NULL OR created_at < ?6 OR (created_at=?6 AND id < ?7)) ORDER BY created_at DESC,id DESC LIMIT ?8"
    ).map_err(storage_domain)?;
    let rows = statement
        .query_map(
            params![
                request.field_id.0,
                relation_type,
                lifecycle,
                endpoint_type,
                endpoint_id,
                cursor_time,
                cursor_id,
                limit + 1
            ],
            relation_from_row,
        )
        .map_err(storage_domain)?;
    let mut items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_domain)?;
    let next_cursor = if items.len() > limit as usize {
        items.truncate(limit as usize);
        items.last().map(|item| RelationCursor {
            created_at: item.created_at,
            relation_id: item.id.clone(),
        })
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

fn list_activities(
    connection: &Connection,
    request: &ListActivitiesRequest,
) -> Result<Page<ActivityView, ActivityCursor>, DomainError> {
    let limit = i64::from(request.limit.unwrap_or(50));
    let cursor_time = request.cursor.as_ref().map(|cursor| cursor.created_at);
    let cursor_id = request
        .cursor
        .as_ref()
        .map(|cursor| cursor.activity_id.0.as_str());
    let mut statement=connection.prepare(
        "SELECT id,field_id,actor_principal_id,action,target_type,target_id,summary,trace_id,created_at FROM activities
         WHERE field_id=?1 AND (?2 IS NULL OR created_at < ?2 OR (created_at=?2 AND id < ?3)) ORDER BY created_at DESC,id DESC LIMIT ?4"
    ).map_err(storage_domain)?;
    let rows = statement
        .query_map(
            params![request.field_id.0, cursor_time, cursor_id, limit + 1],
            activity_from_row,
        )
        .map_err(storage_domain)?;
    let mut items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_domain)?;
    let next_cursor = if items.len() > limit as usize {
        items.truncate(limit as usize);
        items.last().map(|item| ActivityCursor {
            created_at: item.created_at,
            activity_id: item.id.clone(),
        })
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

fn resume_v1(
    connection: &mut Connection,
    field_id: &FieldId,
    device_id: &DeviceId,
) -> Result<FieldResumeV1View, DomainError> {
    let transaction = connection.transaction().map_err(storage_domain)?;
    let field = get_field_tx(&transaction, field_id)?;
    let field_view = field_to_view(field.clone());
    let (mut focus_source, mut typed_focus, legacy_text_focus) =
        parse_persisted_focus(field.current_focus.as_ref());
    if typed_focus.as_ref().is_some_and(|focus| {
        !focus_target_available(&transaction, field_id, focus).unwrap_or(false)
    }) {
        focus_source = FocusSource::InvalidIgnored;
        typed_focus = None;
    }

    let snapshot: Option<(i64,String,String)> = transaction.query_row(
        "SELECT observed_field_revision,layout_json,open_objects_json FROM surface_snapshots WHERE field_id=?1 AND device_id=?2 ORDER BY created_at DESC,id DESC LIMIT 1",
        params![field_id.0,device_id.0], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    ).optional().map_err(storage_domain)?;
    let mut snapshot_freshness = SnapshotFreshness::None;
    let mut layout_source = LayoutSource::Default;
    let mut layout = SurfaceLayoutV1::default_task();
    let mut open_reference_ids = Vec::new();
    if let Some((observed, layout_json, open_json)) = snapshot {
        let observed = u64::try_from(observed).unwrap_or(0);
        snapshot_freshness = match observed.cmp(&field.revision) {
            std::cmp::Ordering::Less => SnapshotFreshness::Stale,
            std::cmp::Ordering::Equal => SnapshotFreshness::Current,
            std::cmp::Ordering::Greater => SnapshotFreshness::Invalid,
        };
        if snapshot_freshness == SnapshotFreshness::Invalid {
            layout_source = LayoutSource::InvalidIgnored;
        } else if let Ok(candidate) = serde_json::from_str::<SurfaceLayoutV1>(&layout_json) {
            match validate_surface_layout(&candidate) {
                Ok(open) => {
                    layout_source = LayoutSource::SnapshotV1;
                    layout = candidate;
                    open_reference_ids = open;
                }
                Err(_) => {
                    layout_source = LayoutSource::InvalidIgnored;
                    snapshot_freshness = SnapshotFreshness::Invalid;
                }
            }
        } else {
            let legacy_layout: Result<Value, _> = serde_json::from_str(&layout_json);
            let legacy_open: Result<Vec<String>, _> = serde_json::from_str(&open_json);
            if legacy_layout.ok().as_ref()
                == Some(&serde_json::json!({"primary":"FIELD","supporting":[]}))
                && legacy_open.ok().is_some_and(|items| items.is_empty())
            {
                layout_source = LayoutSource::LegacyPhase01Fallback;
            } else {
                layout_source = LayoutSource::InvalidIgnored;
                snapshot_freshness = SnapshotFreshness::Invalid;
            }
        }
    }
    let unavailable_reference_ids = open_reference_ids
        .iter()
        .filter(|id| !active_reference_exists(&transaction, field_id, id).unwrap_or(false))
        .cloned()
        .collect::<Vec<_>>();
    let active_blockers = resume_state_items(&transaction, field_id, FieldStateKind::Blocker)?;
    let active_questions = resume_state_items(&transaction, field_id, FieldStateKind::Question)?;
    let active_tasks = resume_state_items(&transaction, field_id, FieldStateKind::Task)?;
    let last_activity=transaction.query_row(
        "SELECT id,field_id,actor_principal_id,action,target_type,target_id,summary,trace_id,created_at FROM activities WHERE field_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1",
        [&field_id.0],activity_from_row,
    ).optional().map_err(storage_domain)?;
    let continuation = choose_continuation(
        &transaction,
        field_id,
        typed_focus.as_ref(),
        legacy_text_focus.as_ref(),
        &active_blockers,
        &active_questions,
        &active_tasks,
        last_activity.as_ref(),
    )?;
    transaction.commit().map_err(storage_domain)?;
    Ok(FieldResumeV1View {
        field: field_view,
        field_revision: field.revision,
        focus_source,
        typed_focus,
        legacy_text_focus,
        snapshot_freshness,
        layout_source,
        layout,
        open_reference_ids,
        unavailable_reference_ids,
        active_blockers,
        active_questions,
        active_tasks,
        last_activity,
        continuation,
        external_changes: ExternalChangeAssessment::NotEvaluatedPhase02,
    })
}

fn resume_state_items(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    kind: FieldStateKind,
) -> Result<Vec<ResumeStateItem>, DomainError> {
    let mut statement=transaction.prepare("SELECT id,kind,content,revision,updated_at FROM field_state_entries WHERE field_id=?1 AND kind=?2 AND status='ACTIVE' ORDER BY updated_at DESC,id DESC LIMIT 5").map_err(storage_domain)?;
    let rows = statement
        .query_map(params![field_id.0, state_kind_to_db(kind)], |row| {
            let content: String = row.get(2)?;
            let excerpt = content.chars().take(240).collect();
            Ok(ResumeStateItem {
                id: StateId::new(row.get::<_, String>(0)?),
                kind: state_kind_from_db(&row.get::<_, String>(1)?)?,
                content_excerpt: excerpt,
                revision: revision_from_row(row, 3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(storage_domain)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(storage_domain)
}

#[allow(clippy::too_many_arguments)]
fn choose_continuation(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    typed: Option<&FieldFocusV1>,
    legacy: Option<&String>,
    blockers: &[ResumeStateItem],
    questions: &[ResumeStateItem],
    tasks: &[ResumeStateItem],
    last: Option<&ActivityView>,
) -> Result<ResumeContinuation, DomainError> {
    if let Some(focus) = typed {
        let target = match focus {
            FieldFocusV1::State { state_id } => ContinuationTarget::State {
                state_id: state_id.clone(),
            },
            FieldFocusV1::Reference { object_id } => ContinuationTarget::Reference {
                object_id: object_id.clone(),
            },
        };
        return Ok(ResumeContinuation {
            reason: ContinuationReason::TypedFocus,
            target,
        });
    }
    if let Some(label) = legacy {
        return Ok(ResumeContinuation {
            reason: ContinuationReason::LegacyTextFocus,
            target: ContinuationTarget::LegacyText {
                label: label.clone(),
            },
        });
    }
    if let Some(item) = blockers.first() {
        return Ok(ResumeContinuation {
            reason: ContinuationReason::ActiveBlocker,
            target: ContinuationTarget::State {
                state_id: item.id.clone(),
            },
        });
    }
    if let Some(item) = questions.first() {
        return Ok(ResumeContinuation {
            reason: ContinuationReason::ActiveQuestion,
            target: ContinuationTarget::State {
                state_id: item.id.clone(),
            },
        });
    }
    if let Some(item) = tasks.first() {
        return Ok(ResumeContinuation {
            reason: ContinuationReason::ActiveTask,
            target: ContinuationTarget::State {
                state_id: item.id.clone(),
            },
        });
    }
    if let Some(activity) = last
        && let Some(target) = activity.target.as_ref().and_then(|target| {
            valid_activity_continuation(transaction, field_id, target)
                .ok()
                .flatten()
        })
    {
        return Ok(ResumeContinuation {
            reason: ContinuationReason::LastActivity,
            target,
        });
    }
    Ok(ResumeContinuation {
        reason: ContinuationReason::FieldOverview,
        target: ContinuationTarget::FieldOverview,
    })
}

fn valid_activity_continuation(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    target: &ResourceRef,
) -> Result<Option<ContinuationTarget>, DomainError> {
    Ok(match target {
        ResourceRef::Field {
            field_id: target_field,
        } if target_field == field_id => Some(ContinuationTarget::FieldOverview),
        ResourceRef::State { state_id }
            if get_state_tx(transaction, field_id, state_id).is_ok() =>
        {
            Some(ContinuationTarget::State {
                state_id: state_id.clone(),
            })
        }
        ResourceRef::Reference { object_id }
            if active_reference_exists(transaction, field_id, object_id)? =>
        {
            Some(ContinuationTarget::Reference {
                object_id: object_id.clone(),
            })
        }
        _ => None,
    })
}

fn focus_target_available(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    focus: &FieldFocusV1,
) -> Result<bool, DomainError> {
    match focus {
        FieldFocusV1::State { state_id } => Ok(get_state_tx(transaction, field_id, state_id)
            .is_ok_and(|state| {
                !matches!(
                    state.status,
                    StateStatus::Superseded | StateStatus::Retracted
                )
            })),
        FieldFocusV1::Reference { object_id } => {
            active_reference_exists(transaction, field_id, object_id)
        }
    }
}

fn active_reference_exists(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    object_id: &ObjectId,
) -> Result<bool, DomainError> {
    transaction.query_row("SELECT EXISTS(SELECT 1 FROM field_objects WHERE id=?1 AND field_id=?2 AND object_kind='REFERENCE' AND lifecycle_status='ACTIVE')",params![object_id.0,field_id.0],|row|row.get(0)).map_err(storage_domain)
}

fn ensure_active_field(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
) -> Result<(), DomainError> {
    let active: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM fields WHERE id=?1 AND lifecycle_status='ACTIVE')",
            [&field_id.0],
            |row| row.get(0),
        )
        .map_err(storage_domain)?;
    if active {
        Ok(())
    } else {
        Err(DomainError::NotFound)
    }
}

fn clear_typed_state_focus(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    state_id: &StateId,
) -> Result<(), DomainError> {
    clear_focus_matching(
        transaction,
        field_id,
        &FieldFocusV1::State {
            state_id: state_id.clone(),
        },
        None,
    )
}
fn clear_typed_reference_focus(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    object_id: &ObjectId,
) -> Result<(), DomainError> {
    clear_focus_matching(
        transaction,
        field_id,
        &FieldFocusV1::Reference {
            object_id: object_id.clone(),
        },
        None,
    )
}
fn move_typed_state_focus(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    from: &StateId,
    to: &StateId,
) -> Result<(), DomainError> {
    clear_focus_matching(
        transaction,
        field_id,
        &FieldFocusV1::State {
            state_id: from.clone(),
        },
        Some(&FieldFocusV1::State {
            state_id: to.clone(),
        }),
    )
}
fn clear_focus_matching(
    transaction: &Transaction<'_>,
    field_id: &FieldId,
    expected: &FieldFocusV1,
    replacement: Option<&FieldFocusV1>,
) -> Result<(), DomainError> {
    let current: Option<String> = transaction
        .query_row(
            "SELECT current_focus_json FROM fields WHERE id=?1",
            [&field_id.0],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_domain)?
        .flatten();
    if current
        .as_deref()
        .and_then(|json| serde_json::from_str::<FieldFocusV1>(json).ok())
        .as_ref()
        == Some(expected)
    {
        let replacement = replacement
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| DomainError::Storage(error.to_string()))?;
        transaction
            .execute(
                "UPDATE fields SET current_focus_json=?1 WHERE id=?2",
                params![replacement, field_id.0],
            )
            .map_err(storage_domain)?;
    }
    Ok(())
}

fn field_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Field> {
    let lifecycle: String = row.get(4)?;
    let mode: Option<String> = row.get(5)?;
    let focus_json: Option<String> = row.get(6)?;
    Ok(Field {
        id: FieldId::new(row.get::<_, String>(0)?),
        owner_principal_id: PrincipalId::new(row.get::<_, String>(1)?),
        title: row.get(2)?,
        goal: row.get(3)?,
        lifecycle_status: lifecycle_from_db(&lifecycle)?,
        current_mode: mode.as_deref().map(mode_from_db).transpose()?,
        current_focus: focus_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|error| conversion_error(error.to_string()))?,
        revision: revision_from_row(row, 7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn field_to_view(field: Field) -> FieldView {
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

fn state_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StateView> {
    Ok(StateView {
        id: StateId::new(row.get::<_, String>(0)?),
        field_id: FieldId::new(row.get::<_, String>(1)?),
        kind: state_kind_from_db(&row.get::<_, String>(2)?)?,
        content: row.get(3)?,
        status: state_status_from_db(&row.get::<_, String>(4)?)?,
        confidence: row.get(5)?,
        created_by: PrincipalId::new(row.get::<_, String>(6)?),
        source_activity_id: ActivityId::new(row.get::<_, String>(7)?),
        revision: revision_from_row(row, 8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn reference_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReferenceView> {
    let kind: String = row.get(5)?;
    let reference_type: String = row.get(7)?;
    if kind != "REFERENCE" || reference_type != "HTTPS_URL" {
        return Err(conversion_error("invalid reference discriminant".into()));
    }
    Ok(ReferenceView {
        id: ObjectId::new(row.get::<_, String>(0)?),
        field_id: FieldId::new(row.get::<_, String>(1)?),
        owner_principal_id: PrincipalId::new(row.get::<_, String>(2)?),
        created_by: PrincipalId::new(row.get::<_, String>(3)?),
        source_activity_id: ActivityId::new(row.get::<_, String>(4)?),
        kind: ObjectKind::Reference,
        title: row.get(6)?,
        reference_type: ReferenceType::HttpsUrl,
        canonical_url: row.get(8)?,
        lifecycle: object_lifecycle_from_db(&row.get::<_, String>(9)?)?,
        revision: revision_from_row(row, 10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn relation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RelationView> {
    let from_type: String = row.get(2)?;
    let from_id: String = row.get(3)?;
    let relation_type = relation_type_from_db(&row.get::<_, String>(4)?)?;
    let to_type: String = row.get(5)?;
    let to_id: String = row.get(6)?;
    let from = endpoint_from_db(&from_type, from_id)?;
    let to = endpoint_from_db(&to_type, to_id)?;
    Ok(RelationView {
        id: RelationId::new(row.get::<_, String>(0)?),
        field_id: FieldId::new(row.get::<_, String>(1)?),
        relation_type,
        from,
        to,
        lifecycle: relation_lifecycle_from_db(&row.get::<_, String>(7)?)?,
        created_by: PrincipalId::new(row.get::<_, String>(8)?),
        revision: revision_from_row(row, 9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn activity_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityView> {
    let field_id: Option<String> = row.get(1)?;
    let target_type: Option<String> = row.get(4)?;
    let target_id: Option<String> = row.get(5)?;
    let target = match (target_type.as_deref(), target_id) {
        (Some("FIELD"), Some(id)) => Some(ResourceRef::Field {
            field_id: FieldId::new(id),
        }),
        (Some("STATE"), Some(id)) => Some(ResourceRef::State {
            state_id: StateId::new(id),
        }),
        (Some("OBJECT"), Some(id)) => Some(ResourceRef::Reference {
            object_id: ObjectId::new(id),
        }),
        (Some("RELATION"), Some(id)) => Some(ResourceRef::Relation {
            relation_id: RelationId::new(id),
        }),
        (Some("CAPTURE"), Some(id)) => Some(ResourceRef::Capture {
            capture_id: CaptureId::new(id),
        }),
        (Some("PROVIDER_CONFIG"), Some(id)) => Some(ResourceRef::ProviderConfig {
            provider_config_id: ProviderConfigId::new(id),
        }),
        (None, None) => None,
        _ => return Err(conversion_error("invalid activity target".into())),
    };
    Ok(ActivityView {
        id: ActivityId::new(row.get::<_, String>(0)?),
        field_id: field_id.map(FieldId::new),
        actor_principal_id: PrincipalId::new(row.get::<_, String>(2)?),
        action: activity_action_from_db(&row.get::<_, String>(3)?)?,
        target,
        summary: row.get(6)?,
        trace_id: TraceId::new(row.get::<_, String>(7)?),
        created_at: row.get(8)?,
    })
}

fn state_kind_to_db(value: FieldStateKind) -> &'static str {
    match value {
        FieldStateKind::Fact => "FACT",
        FieldStateKind::Decision => "DECISION",
        FieldStateKind::Assumption => "ASSUMPTION",
        FieldStateKind::Question => "QUESTION",
        FieldStateKind::Task => "TASK",
        FieldStateKind::Blocker => "BLOCKER",
        FieldStateKind::Result => "RESULT",
    }
}
fn state_kind_from_db(value: &str) -> rusqlite::Result<FieldStateKind> {
    match value {
        "FACT" => Ok(FieldStateKind::Fact),
        "DECISION" => Ok(FieldStateKind::Decision),
        "ASSUMPTION" => Ok(FieldStateKind::Assumption),
        "QUESTION" => Ok(FieldStateKind::Question),
        "TASK" => Ok(FieldStateKind::Task),
        "BLOCKER" => Ok(FieldStateKind::Blocker),
        "RESULT" => Ok(FieldStateKind::Result),
        _ => Err(conversion_error(format!("unknown state kind {value}"))),
    }
}
fn state_status_to_db(value: StateStatus) -> &'static str {
    match value {
        StateStatus::Active => "ACTIVE",
        StateStatus::Resolved => "RESOLVED",
        StateStatus::Superseded => "SUPERSEDED",
        StateStatus::Retracted => "RETRACTED",
    }
}
fn state_status_from_db(value: &str) -> rusqlite::Result<StateStatus> {
    match value {
        "ACTIVE" => Ok(StateStatus::Active),
        "RESOLVED" => Ok(StateStatus::Resolved),
        "SUPERSEDED" => Ok(StateStatus::Superseded),
        "RETRACTED" => Ok(StateStatus::Retracted),
        _ => Err(conversion_error(format!("unknown state status {value}"))),
    }
}
fn object_lifecycle_to_db(value: ObjectLifecycle) -> &'static str {
    match value {
        ObjectLifecycle::Active => "ACTIVE",
        ObjectLifecycle::Archived => "ARCHIVED",
    }
}
fn object_lifecycle_from_db(value: &str) -> rusqlite::Result<ObjectLifecycle> {
    match value {
        "ACTIVE" => Ok(ObjectLifecycle::Active),
        "ARCHIVED" => Ok(ObjectLifecycle::Archived),
        _ => Err(conversion_error(format!(
            "unknown object lifecycle {value}"
        ))),
    }
}
fn relation_type_to_db(value: RelationType) -> &'static str {
    match value {
        RelationType::SourcedFrom => "SOURCED_FROM",
        RelationType::SupersededBy => "SUPERSEDED_BY",
    }
}
fn relation_type_from_db(value: &str) -> rusqlite::Result<RelationType> {
    match value {
        "SOURCED_FROM" => Ok(RelationType::SourcedFrom),
        "SUPERSEDED_BY" => Ok(RelationType::SupersededBy),
        _ => Err(conversion_error(format!("unknown relation type {value}"))),
    }
}
fn relation_lifecycle_to_db(value: RelationLifecycle) -> &'static str {
    match value {
        RelationLifecycle::Active => "ACTIVE",
        RelationLifecycle::Retracted => "RETRACTED",
    }
}
fn relation_lifecycle_from_db(value: &str) -> rusqlite::Result<RelationLifecycle> {
    match value {
        "ACTIVE" => Ok(RelationLifecycle::Active),
        "RETRACTED" => Ok(RelationLifecycle::Retracted),
        _ => Err(conversion_error(format!(
            "unknown relation lifecycle {value}"
        ))),
    }
}
fn endpoint_from_db(kind: &str, id: String) -> rusqlite::Result<LineageEndpointRef> {
    match kind {
        "STATE" => Ok(LineageEndpointRef::State {
            state_id: StateId::new(id),
        }),
        "OBJECT" => Ok(LineageEndpointRef::Reference {
            object_id: ObjectId::new(id),
        }),
        _ => Err(conversion_error(format!("unknown endpoint kind {kind}"))),
    }
}

fn activity_action_from_db(value: &str) -> rusqlite::Result<ActivityAction> {
    match value {
        "FIELD_CREATED" => Ok(ActivityAction::FieldCreated),
        "FIELD_FOCUS_UPDATED" => Ok(ActivityAction::FieldFocusUpdated),
        "FIELD_MODE_UPDATED" => Ok(ActivityAction::FieldModeUpdated),
        "STATE_CREATED" => Ok(ActivityAction::StateCreated),
        "STATE_REVISED" => Ok(ActivityAction::StateRevised),
        "STATE_STATUS_CHANGED" => Ok(ActivityAction::StateStatusChanged),
        "STATE_SUPERSEDED" => Ok(ActivityAction::StateSuperseded),
        "REFERENCE_CREATED" => Ok(ActivityAction::ReferenceCreated),
        "REFERENCE_REVISED" => Ok(ActivityAction::ReferenceRevised),
        "REFERENCE_ARCHIVED" => Ok(ActivityAction::ReferenceArchived),
        "REFERENCE_RESTORED" => Ok(ActivityAction::ReferenceRestored),
        "REFERENCE_SOURCE_ATTACHED" => Ok(ActivityAction::ReferenceSourceAttached),
        "REFERENCE_SOURCE_RETRACTED" => Ok(ActivityAction::ReferenceSourceRetracted),
        "PROVIDER_CONFIG_CREATED" => Ok(ActivityAction::ProviderConfigCreated),
        "PROVIDER_CONFIG_UPDATED" => Ok(ActivityAction::ProviderConfigUpdated),
        "PROVIDER_CONFIG_REMOVED" => Ok(ActivityAction::ProviderConfigRemoved),
        "CAPTURE_CREATED" => Ok(ActivityAction::CaptureCreated),
        "CAPTURE_ATTACHED" => Ok(ActivityAction::CaptureAttached),
        "CAPTURE_PROMOTED" => Ok(ActivityAction::CapturePromoted),
        "CAPTURE_ARCHIVED" => Ok(ActivityAction::CaptureArchived),
        "CAPTURE_RESTORED" => Ok(ActivityAction::CaptureRestored),
        "MODEL_INVOCATION_COMPLETED" => Ok(ActivityAction::ModelInvocationCompleted),
        "MODEL_INVOCATION_FAILED" => Ok(ActivityAction::ModelInvocationFailed),
        _ => Err(conversion_error(format!("unknown activity action {value}"))),
    }
}

fn is_constraint(error: &rusqlite::Error) -> bool {
    matches!(error,rusqlite::Error::SqliteFailure(code,_) if code.code==rusqlite::ErrorCode::ConstraintViolation)
}

fn snapshot_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SurfaceSnapshot> {
    let layout_json: String = row.get(4)?;
    let open_objects_json: String = row.get(5)?;
    let open_objects: Vec<String> = serde_json::from_str(&open_objects_json)
        .map_err(|error| conversion_error(error.to_string()))?;
    Ok(SurfaceSnapshot {
        id: SurfaceSnapshotId::new(row.get::<_, String>(0)?),
        field_id: FieldId::new(row.get::<_, String>(1)?),
        device_id: DeviceId::new(row.get::<_, String>(2)?),
        observed_field_revision: revision_from_row(row, 3)?,
        layout: serde_json::from_str(&layout_json)
            .map_err(|error| conversion_error(error.to_string()))?,
        open_objects: open_objects.into_iter().map(ObjectId::new).collect(),
        created_at: row.get(6)?,
    })
}

fn conversion_error(message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(StorageError::InvalidJson(message)),
    )
}

fn encode_optional_json(value: &Option<Value>) -> Result<Option<String>, StorageError> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| StorageError::InvalidJson(error.to_string()))
}

fn revision_to_sql(value: u64) -> Result<i64, StorageError> {
    i64::try_from(value).map_err(|_| StorageError::RevisionOutOfRange)
}

fn revision_from_row(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let value: i64 = row.get(index)?;
    u64::try_from(value).map_err(|_| conversion_error("negative revision".into()))
}

fn u32_from_row(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u32> {
    row.get::<_, i64>(index)?
        .try_into()
        .map_err(|_| conversion_error("integer out of u32 range".into()))
}

fn lifecycle_to_db(value: FieldLifecycle) -> &'static str {
    match value {
        FieldLifecycle::Active => "ACTIVE",
        FieldLifecycle::Completed => "COMPLETED",
        FieldLifecycle::Archived => "ARCHIVED",
    }
}

fn lifecycle_from_db(value: &str) -> rusqlite::Result<FieldLifecycle> {
    match value {
        "ACTIVE" => Ok(FieldLifecycle::Active),
        "COMPLETED" => Ok(FieldLifecycle::Completed),
        "ARCHIVED" => Ok(FieldLifecycle::Archived),
        _ => Err(conversion_error(format!("unknown lifecycle {value}"))),
    }
}

fn mode_to_db(value: FieldMode) -> &'static str {
    match value {
        FieldMode::Explore => "EXPLORE",
        FieldMode::Think => "THINK",
        FieldMode::Build => "BUILD",
        FieldMode::Operate => "OPERATE",
        FieldMode::Verify => "VERIFY",
    }
}

fn mode_from_db(value: &str) -> rusqlite::Result<FieldMode> {
    match value {
        "EXPLORE" => Ok(FieldMode::Explore),
        "THINK" => Ok(FieldMode::Think),
        "BUILD" => Ok(FieldMode::Build),
        "OPERATE" => Ok(FieldMode::Operate),
        "VERIFY" => Ok(FieldMode::Verify),
        _ => Err(conversion_error(format!("unknown mode {value}"))),
    }
}

fn map_storage(error: StorageError) -> DomainError {
    DomainError::Storage(error.to_string())
}

pub fn schema_version() -> u32 {
    SCHEMA_VERSION
}

/// Create a closed, portable SQLite snapshot. The caller must stop the live
/// StorageWorker first; machine-local device bindings and surface snapshots are
/// deliberately removed from the copy, never from the source database.
pub fn create_portable_snapshot(source: &Path, target: &Path) -> Result<(), StorageError> {
    if source == target || target.exists() {
        return Err(StorageError::OpenGate(
            "invalid portable snapshot target".into(),
        ));
    }
    std::fs::copy(source, target)?;
    let mut connection = open_connection(target)?;
    validate_schema(&connection)?;
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM surface_snapshots", [])?;
    transaction.execute("DELETE FROM device_bindings", [])?;
    transaction.execute("DELETE FROM screenshot_evidence", [])?;
    transaction.execute(
        "UPDATE library_objects SET original_source=NULL WHERE kind='FILE'",
        [],
    )?;
    transaction.execute(
        "UPDATE provider_configs SET lifecycle_status='DISABLED' WHERE lifecycle_status='ACTIVE'",
        [],
    )?;
    transaction.commit()?;
    connection.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
    validate_database_snapshot_connection(&connection)?;
    drop(connection);
    let wal = PathBuf::from(format!("{}-wal", target.to_string_lossy()));
    let shm = PathBuf::from(format!("{}-shm", target.to_string_lossy()));
    if wal.exists() {
        std::fs::remove_file(wal)?;
    }
    if shm.exists() {
        std::fs::remove_file(shm)?;
    }
    Ok(())
}

pub fn validate_database_snapshot(path: &Path) -> Result<(), StorageError> {
    let connection = open_connection(path)?;
    validate_schema(&connection)?;
    validate_database_snapshot_connection(&connection)
}

fn validate_database_snapshot_connection(connection: &Connection) -> Result<(), StorageError> {
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(StorageError::OpenGate("integrity_check failed".into()));
    }
    let profiles: i64 = connection.query_row(
        "SELECT COUNT(*) FROM profiles WHERE singleton_key=1 AND schema_version>=1",
        [],
        |row| row.get(0),
    )?;
    if profiles != 1 {
        return Err(StorageError::OpenGate(
            "portable profile identity missing".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fielora_field::{FieldService, RealityService, SurfaceService};
    use fielora_platform::PlatformPaths;
    use serde_json::json;
    use std::fs;

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("fielora-storage-{}", Uuid::now_v7()))
    }

    fn start(root: &Path, now: i64) -> StorageWorker {
        let paths = PlatformPaths::from_root(root.to_path_buf()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        StorageWorker::start(&paths.database, device, now).unwrap()
    }

    fn apply_schema_through_7(connection: &mut Connection, now: i64) {
        connection.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);",
        ).unwrap();
        for (version, name, sql, checksum) in [
            (
                1,
                MIGRATION_0001_NAME,
                MIGRATION_0001,
                migration_checksum(MIGRATION_0001),
            ),
            (
                2,
                MIGRATION_0002_NAME,
                MIGRATION_0002,
                frozen_migration_checksum(MIGRATION_0002),
            ),
            (
                4,
                MIGRATION_0004_NAME,
                MIGRATION_0004,
                frozen_migration_checksum(MIGRATION_0004),
            ),
            (
                5,
                MIGRATION_0005_NAME,
                MIGRATION_0005,
                frozen_migration_checksum(MIGRATION_0005),
            ),
            (
                6,
                MIGRATION_0006_NAME,
                MIGRATION_0006,
                frozen_migration_checksum(MIGRATION_0006),
            ),
            (
                7,
                MIGRATION_0007_NAME,
                MIGRATION_0007,
                migration_checksum(MIGRATION_0007),
            ),
        ] {
            let transaction = connection.transaction().unwrap();
            transaction.execute_batch(sql).unwrap();
            transaction.execute(
                "INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?1,?2,?3,?4)",
                params![version,name,checksum,now],
            ).unwrap();
            transaction.commit().unwrap();
        }
    }

    fn apply_schema_through_8(connection: &mut Connection, now: i64) {
        apply_schema_through_7(connection, now);
        let transaction = connection.transaction().unwrap();
        transaction.execute_batch(MIGRATION_0008).unwrap();
        transaction
            .execute(
                "INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(8,?1,?2,?3)",
                params![
                    MIGRATION_0008_NAME,
                    migration_checksum(MIGRATION_0008),
                    now
                ],
            )
            .unwrap();
        transaction.commit().unwrap();
    }

    fn apply_schema_through_11(connection: &mut Connection, now: i64) {
        apply_schema_through_8(connection, now);
        apply_artifact_type_extensibility_migration(
            connection,
            now + 1,
            MIGRATION_0009,
            &migration_checksum(MIGRATION_0009),
        )
        .unwrap();
        apply_durable_source_asset_migration(
            connection,
            now + 2,
            MIGRATION_0010,
            &migration_checksum(MIGRATION_0010),
        )
        .unwrap();
        apply_artifact_archive_state_migration(
            connection,
            now + 3,
            MIGRATION_0011,
            &migration_checksum(MIGRATION_0011),
        )
        .unwrap();
    }

    fn apply_schema_through_12(connection: &mut Connection, now: i64) {
        apply_schema_through_11(connection, now);
        apply_idr_v2_storage_migration(
            connection,
            now + 4,
            MIGRATION_0012,
            &migration_checksum(MIGRATION_0012),
        )
        .unwrap();
    }

    fn apply_schema_through_13(connection: &mut Connection, now: i64) {
        apply_schema_through_12(connection, now);
        apply_rich_result_reference_migration(
            connection,
            now + 5,
            MIGRATION_0013,
            &migration_checksum(MIGRATION_0013),
        )
        .unwrap();
    }

    fn apply_schema_through_14(connection: &mut Connection, now: i64) {
        apply_schema_through_13(connection, now);
        apply_screenshot_evidence_migration(
            connection,
            now + 6,
            MIGRATION_0014,
            &migration_checksum(MIGRATION_0014),
        )
        .unwrap();
    }

    fn start_pre_migrated_worker(
        mut connection: Connection,
        database_path: PathBuf,
        device: DeviceIdentity,
        now: i64,
    ) -> StorageWorker {
        let local_user = bootstrap_records(&mut connection, &device, now).unwrap();
        let profile_id = connection
            .query_row(
                "SELECT profile_id FROM profiles WHERE singleton_key=1",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(ProfileId::new)
            .unwrap();
        let (sender, receiver) = std::sync::mpsc::sync_channel(64);
        let worker = std::thread::Builder::new()
            .name("fielora-storage-test-v8".into())
            .spawn(move || run_worker(connection, receiver))
            .unwrap();
        StorageWorker {
            handle: StorageHandle {
                sender,
                local_user,
                device_id: device.id,
                profile_id,
                database_path,
            },
            worker: Some(worker),
        }
    }

    fn presentation_artifact_content(text: &str) -> ArtifactContentV1 {
        ArtifactContentV1::Presentation(PresentationArtifact {
            slides: vec![PresentationSlide {
                layout: PresentationLayout::TitleAndBody,
                title: "Durable presentation".into(),
                regions: vec![SlideRegion {
                    slot: SlideSlot::Body,
                    blocks: vec![PresentationBlock::Paragraph { text: text.into() }],
                }],
            }],
        })
    }

    fn query_json_rows(connection: &Connection, sql: &str) -> Vec<String> {
        let mut statement = connection.prepare(sql).unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    fn artifact_content(text: &str) -> ArtifactContentV1 {
        ArtifactContentV1::Document(DocumentArtifact {
            title: Some("Durable document".into()),
            blocks: vec![DocumentBlock::Paragraph { text: text.into() }],
        })
    }

    fn diagram_artifact_content(label: &str) -> ArtifactContentV1 {
        ArtifactContentV1::Diagram(DiagramArtifactV1 {
            title: Some("Storage Diagram".into()),
            description: None,
            layout: DiagramLayoutIntentV1 {
                strategy: DiagramLayoutStrategy::LayeredAuto,
                direction: DiagramLayoutDirection::LeftToRight,
            },
            nodes: vec![DiagramNodeV1 {
                node_id: DiagramNodeId::new("storage_node"),
                label: label.into(),
                description: None,
                semantic_kind: DiagramNodeKind::Generic,
                presentation: None,
            }],
            edges: vec![],
            groups: vec![],
        })
    }

    fn spreadsheet_artifact_content(value: &str) -> ArtifactContentV1 {
        ArtifactContentV1::Spreadsheet(SpreadsheetArtifactV1 {
            title: Some("Storage Spreadsheet".into()),
            sheets: vec![SpreadsheetSheetV1 {
                sheet_id: SpreadsheetSheetId::new("storage_sheet"),
                name: "Storage Sheet".into(),
                cells: vec![SpreadsheetCellV1 {
                    row: 1,
                    column: 1,
                    value: SpreadsheetLiteralV1::String {
                        value: value.into(),
                    },
                    format: None,
                    presentation: None,
                }],
            }],
        })
    }

    fn canonical_artifact(content: &ArtifactContentV1) -> (String, String) {
        let json = serde_json::to_string(content).unwrap();
        let digest = format!("{:x}", Sha256::digest(json.as_bytes()));
        (json, digest)
    }

    fn artifact_run_fixture(
        handle: &StorageHandle,
        root: &Path,
        now: i64,
    ) -> (ProjectView, ConversationView, AgentRunView) {
        fs::create_dir_all(root.join("workspace")).unwrap();
        let project = handle
            .create_project(
                CreateProjectRequest {
                    title: "Durable Artifact".into(),
                    goal: None,
                    root_path: root.join("workspace").to_string_lossy().into_owned(),
                },
                now,
            )
            .unwrap();
        let provider = handle
            .create_provider_config(
                CreateProviderConfigRequest {
                    provider_kind: ProviderKind::Openai,
                    display_name: "Artifact fixture".into(),
                    base_url: None,
                    default_model: "fixture-model".into(),
                    custom_endpoint_acknowledged: false,
                },
                now + 1,
            )
            .unwrap();
        handle
            .set_provider_credential_present(provider.view.id.clone(), true, now + 2)
            .unwrap();
        let conversation = handle
            .create_conversation(
                CreateConversationRequest {
                    field_id: project.field_id.clone(),
                    title: "Artifact work".into(),
                    provider_config_id: Some(provider.view.id.clone()),
                    model_id: Some("fixture-model".into()),
                },
                now + 3,
            )
            .unwrap();
        let run = handle
            .create_agent_run(
                StartAgentRunRequest {
                    resource_budget: None,
                    field_id: project.field_id.clone(),
                    conversation_id: conversation.id.clone(),
                    user_message_id: None,
                    provider_config_id: provider.view.id,
                    model_id: None,
                    task: "Create a durable artifact".into(),
                    permission: AgentPermission::ReviewChanges,
                    max_steps: Some(8),
                    attachments: None,
                    active_work_surface: None,
                },
                now + 4,
            )
            .unwrap()
            .run;
        handle
            .append_agent_event(
                run.id.clone(),
                AgentEventKind::RunStarted,
                json!({}),
                AgentProjectionUpdate {
                    status: Some(AgentRunStatus::Running),
                    ..Default::default()
                },
                now + 5,
            )
            .unwrap();
        (project, conversation, handle.get_agent_run(run.id).unwrap())
    }

    #[test]
    fn resource_budget_is_validated_and_persisted_in_existing_run_events() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, original) = artifact_run_fixture(&handle, &root, 10);
        let budget = AgentResourceBudget {
            max_execution_ms: 14_400_000,
            max_input_tokens: 10_000_000,
            max_output_tokens: 262_144,
        };
        let mut request = StartAgentRunRequest {
            resource_budget: Some(budget.clone()),
            field_id: project.field_id,
            conversation_id: conversation.id,
            user_message_id: None,
            provider_config_id: original.provider_config_id,
            model_id: None,
            task: "Budget persistence".into(),
            permission: AgentPermission::ReviewChanges,
            max_steps: None,
            attachments: None,
            active_work_surface: None,
        };
        request.resource_budget.as_mut().unwrap().max_execution_ms = 0;
        assert!(
            matches!(handle.create_agent_run(request.clone(), 20), Err(DomainError::Validation(code)) if code == "AGENT_RESOURCE_BUDGET_INVALID")
        );
        request.resource_budget = Some(budget.clone());
        let created = handle.create_agent_run(request, 21).unwrap();
        assert_eq!(created.event.payload["resource_budget"], json!(budget));
        handle
            .append_agent_event(
                created.run.id.clone(),
                AgentEventKind::RunPaused,
                json!({}),
                AgentProjectionUpdate {
                    status: Some(AgentRunStatus::Paused),
                    ..Default::default()
                },
                22,
            )
            .unwrap();
        let mut invalid = budget.clone();
        invalid.max_input_tokens = 50_000_001;
        assert!(
            matches!(handle.resume_agent_run_with_budget(created.run.id.clone(), Some(invalid), 23), Err(DomainError::Validation(code)) if code == "AGENT_RESOURCE_BUDGET_INVALID")
        );
        assert_eq!(
            handle.get_agent_run(created.run.id.clone()).unwrap().status,
            AgentRunStatus::Paused
        );
        let resumed = handle
            .resume_agent_run_with_budget(
                created.run.id.clone(),
                Some(AgentResourceBudget::default()),
                24,
            )
            .unwrap();
        assert_eq!(
            resumed.event.payload["resource_budget"],
            json!(AgentResourceBudget::default())
        );
        assert_eq!(
            resumed.event.payload["resource_budget_reset"]["source"],
            "EXPLICIT_USER_RESUME"
        );
        drop(handle);
        drop(worker);
        let worker = start(&root, 30);
        let events = worker
            .handle()
            .list_agent_events(ListAgentEventsRequest {
                run_id: created.run.id,
                after_sequence: None,
                limit: Some(100),
            })
            .unwrap();
        assert!(events.iter().any(|e| e.kind == AgentEventKind::RunCreated
            && e.payload["resource_budget"] == json!(budget)));
        assert!(events.iter().any(|e| e.kind == AgentEventKind::RunResumed && e.payload == resumed.event.payload));
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    fn artifact_tool(
        handle: &StorageHandle,
        run_id: AgentRunId,
        name: &str,
        effect: AgentToolEffect,
        now: i64,
    ) -> AgentToolCallView {
        let tool = handle
            .create_agent_tool_call(
                run_id,
                name.into(),
                effect,
                AgentPolicyDecision::Allow,
                json!({"fixture":true}),
                now,
            )
            .unwrap();
        handle
            .update_agent_tool_call(
                tool.id.clone(),
                AgentToolStatus::Running,
                None,
                None,
                now + 1,
            )
            .unwrap()
    }

    fn create_artifact_fixture(
        handle: &StorageHandle,
        context: (&ProjectView, &ConversationView, &AgentRunView),
        artifact_type: ArtifactType,
        content: ArtifactContentV1,
        title: &str,
        now: i64,
    ) -> ArtifactReadView {
        let (project, conversation, run) = context;
        let tool = artifact_tool(
            handle,
            run.id.clone(),
            "artifact.create",
            AgentToolEffect::WorkspaceWrite,
            now,
        );
        let (canonical_content_json, semantic_sha256) = canonical_artifact(&content);
        handle
            .create_artifact(CreateArtifactRecord {
                artifact_type,
                title: Some(title.into()),
                project_field_id: Some(project.field_id.clone()),
                conversation_id: conversation.id.clone(),
                run_id: run.id.clone(),
                tool_call_id: tool.id,
                content,
                canonical_content_json,
                semantic_sha256,
                mutation_request_sha256: format!(
                    "{:x}",
                    Sha256::digest(format!("{title}-{now}").as_bytes())
                ),
                now: now + 2,
            })
            .unwrap()
    }

    #[test]
    fn durable_assets_are_immutable_profile_scoped_idempotent_and_restart_safe() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        let tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.asset.import",
            AgentToolEffect::WorkspaceWrite,
            20,
        );
        let digest = "a".repeat(64);
        let request_digest = "b".repeat(64);
        let request = CreateAssetRecord {
            media_type: AssetMediaType::Png,
            content_sha256: digest.clone(),
            byte_length: 128,
            width: 16,
            height: 8,
            blob_ref: format!("blobs/objects/aa/{digest}"),
            conversation_id: conversation.id.clone(),
            run_id: run.id.clone(),
            tool_call_id: tool.id.clone(),
            mutation_request_sha256: request_digest.clone(),
            now: 22,
        };
        let created = handle.create_asset(request.clone()).unwrap();
        assert_eq!(handle.create_asset(request.clone()).unwrap(), created);
        let mut changed = request;
        changed.mutation_request_sha256 = "c".repeat(64);
        assert!(matches!(
            handle.create_asset(changed),
            Err(DomainError::Validation(code)) if code == "ASSET_TOOLCALL_IDEMPOTENCY_CONFLICT"
        ));

        let second_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.asset.import",
            AgentToolEffect::WorkspaceWrite,
            30,
        );
        let second = handle
            .create_asset(CreateAssetRecord {
                media_type: AssetMediaType::Png,
                content_sha256: digest.clone(),
                byte_length: 128,
                width: 16,
                height: 8,
                blob_ref: format!("blobs/objects/aa/{digest}"),
                conversation_id: conversation.id,
                run_id: run.id.clone(),
                tool_call_id: second_tool.id,
                mutation_request_sha256: "d".repeat(64),
                now: 32,
            })
            .unwrap();
        assert_ne!(second.asset_id, created.asset_id);
        assert_eq!(second.content_sha256, created.content_sha256);
        assert_eq!(project.field_id, run.field_id);

        let other_profile = StorageHandle {
            sender: handle.sender.clone(),
            local_user: handle.local_user.clone(),
            device_id: handle.device_id.clone(),
            profile_id: ProfileId::new("other-profile"),
            database_path: handle.database_path.clone(),
        };
        assert_eq!(
            other_profile
                .read_asset(created.asset_id.clone())
                .unwrap_err(),
            DomainError::NotFound
        );
        drop(other_profile);
        drop(handle);
        drop(worker);

        let reopened = start(&root, 40);
        assert_eq!(
            reopened
                .handle()
                .read_asset(created.asset_id.clone())
                .unwrap(),
            created
        );
        drop(reopened);

        let connection =
            open_connection(&PlatformPaths::from_root(root.clone()).unwrap().database).unwrap();
        assert!(
            connection
                .execute(
                    "UPDATE assets SET content_sha256=?1 WHERE id=?2",
                    params!["e".repeat(64), created.asset_id.0]
                )
                .is_err()
        );
        assert!(
            connection
                .execute("DELETE FROM assets WHERE id=?1", [created.asset_id.0])
                .is_err()
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn artifact_list_history_and_archive_are_bounded_profile_scoped_and_durable() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        let first = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("first"),
            "First",
            20,
        );
        let second = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Presentation,
            presentation_artifact_content("second"),
            "Second",
            30,
        );
        let third_r1 = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("third r1"),
            "Third",
            40,
        );
        let update = |handle: &StorageHandle, parent: &ArtifactReadView, text: &str, now: i64| {
            let tool = artifact_tool(
                handle,
                run.id.clone(),
                "artifact.update",
                AgentToolEffect::WorkspaceWrite,
                now,
            );
            let content = artifact_content(text);
            let (canonical_content_json, semantic_sha256) = canonical_artifact(&content);
            handle
                .update_artifact(UpdateArtifactRecord {
                    artifact_id: parent.artifact.artifact_id.clone(),
                    expected_revision_id: parent.revision.revision_id.clone(),
                    conversation_id: conversation.id.clone(),
                    run_id: run.id.clone(),
                    tool_call_id: tool.id,
                    content,
                    canonical_content_json,
                    semantic_sha256,
                    mutation_request_sha256: format!(
                        "{:x}",
                        Sha256::digest(format!("history-{text}-{now}").as_bytes())
                    ),
                    now: now + 2,
                })
                .unwrap()
        };
        let third_r2 = update(&handle, &third_r1, "third r2", 50);
        let third_r3 = update(&handle, &third_r2, "third r3", 60);

        let page_one = handle.list_artifacts(None, 2, false).unwrap();
        assert_eq!(page_one.artifacts.len(), 2);
        assert_eq!(
            page_one.artifacts[0].artifact_id,
            third_r3.artifact.artifact_id
        );
        assert!(page_one.next_cursor.is_some());
        let page_two = handle
            .list_artifacts(page_one.next_cursor.clone(), 2, false)
            .unwrap();
        assert_eq!(page_two.artifacts.len(), 1);
        assert_eq!(
            page_two.artifacts[0].artifact_id,
            first.artifact.artifact_id
        );
        assert!(page_two.next_cursor.is_none());

        let history_one = handle
            .list_artifact_history(third_r3.artifact.artifact_id.clone(), None, 2)
            .unwrap();
        assert_eq!(
            history_one
                .revisions
                .iter()
                .map(|revision| revision.sequence)
                .collect::<Vec<_>>(),
            vec![3, 2]
        );
        assert_eq!(history_one.next_before_sequence, Some(2));
        let history_two = handle
            .list_artifact_history(
                third_r3.artifact.artifact_id.clone(),
                history_one.next_before_sequence,
                2,
            )
            .unwrap();
        assert_eq!(history_two.revisions.len(), 1);
        assert_eq!(history_two.revisions[0].sequence, 1);
        assert!(history_two.next_before_sequence.is_none());

        let archive_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.set_archive_state",
            AgentToolEffect::WorkspaceWrite,
            70,
        );
        let archive_request = SetArtifactArchiveStateRecord {
            artifact_id: second.artifact.artifact_id.clone(),
            archived: true,
            conversation_id: conversation.id.clone(),
            run_id: run.id.clone(),
            tool_call_id: archive_tool.id.clone(),
            mutation_request_sha256: format!("{:x}", Sha256::digest(b"archive-second")),
            now: 72,
        };
        let archived = handle
            .set_artifact_archive_state(archive_request.clone())
            .unwrap();
        assert!(archived.archived_at.is_some());
        assert_eq!(
            handle.set_artifact_archive_state(archive_request).unwrap(),
            archived
        );
        let visible = handle.list_artifacts(None, 100, false).unwrap();
        assert!(
            visible
                .artifacts
                .iter()
                .all(|artifact| artifact.artifact_id != second.artifact.artifact_id)
        );
        let all = handle.list_artifacts(None, 100, true).unwrap();
        assert_eq!(all.artifacts.len(), 3);
        assert!(all.artifacts.iter().any(|artifact| artifact.artifact_id
            == second.artifact.artifact_id
            && artifact.archived_at.is_some()));
        assert_eq!(
            handle
                .read_artifact(
                    second.artifact.artifact_id.clone(),
                    Some(second.revision.revision_id.clone()),
                )
                .unwrap()
                .revision,
            second.revision
        );

        let other_profile = StorageHandle {
            sender: handle.sender.clone(),
            local_user: handle.local_user.clone(),
            device_id: handle.device_id.clone(),
            profile_id: ProfileId::new("other-profile"),
            database_path: handle.database_path.clone(),
        };
        assert!(
            other_profile
                .list_artifacts(None, 100, true)
                .unwrap()
                .artifacts
                .is_empty()
        );

        let restore_tool = artifact_tool(
            &handle,
            run.id,
            "artifact.set_archive_state",
            AgentToolEffect::WorkspaceWrite,
            80,
        );
        let restored = handle
            .set_artifact_archive_state(SetArtifactArchiveStateRecord {
                artifact_id: second.artifact.artifact_id.clone(),
                archived: false,
                conversation_id: conversation.id,
                run_id: restore_tool.run_id,
                tool_call_id: restore_tool.id,
                mutation_request_sha256: format!("{:x}", Sha256::digest(b"restore-second")),
                now: 82,
            })
            .unwrap();
        assert_eq!(restored.archived_at, None);
        drop(other_profile);
        drop(handle);
        drop(worker);

        let reopened = start(&root, 90);
        let reopened_second = reopened
            .handle()
            .read_artifact(second.artifact.artifact_id, None)
            .unwrap();
        assert_eq!(reopened_second.artifact.archived_at, None);
        assert_eq!(
            reopened_second.revision.revision_id,
            second.revision.revision_id
        );
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_and_bootstrap_are_idempotent_across_reopen() {
        let root = temporary_root();
        let first_user = {
            let worker = start(&root, 1);
            worker.handle().local_user.clone()
        };
        let second_user = {
            let worker = start(&root, 2);
            worker.handle().local_user.clone()
        };
        assert_eq!(first_user, second_user);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_checksum_mismatch_blocks_reopen() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        {
            let worker = StorageWorker::start(&paths.database, device.clone(), 1).unwrap();
            drop(worker);
        }
        {
            let connection = open_connection(&paths.database).unwrap();
            connection
                .execute(
                    "UPDATE schema_migrations SET checksum='tampered' WHERE version=1",
                    [],
                )
                .unwrap();
        }
        assert!(matches!(
            StorageWorker::start(&paths.database, device, 2),
            Err(StorageError::MigrationChecksum { version: 1 })
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reality_activity_and_snapshot_survive_real_close_reopen() {
        let root = temporary_root();
        let field_id = {
            let worker = start(&root, 1);
            let handle = worker.handle();
            let fields = FieldService::new(handle.clone(), handle.local_user.clone());
            let trace = TraceId::new(Uuid::now_v7().to_string());
            let (field, _) = fields
                .create("Persistent Field".into(), None, trace.clone(), 2)
                .unwrap();
            let (field, _) = fields
                .update_focus(field.id, 1, Value::String("Persistence".into()), trace, 3)
                .unwrap();
            let surfaces = SurfaceService::new(handle.clone(), handle.device_id.clone());
            surfaces
                .save(
                    field.id.clone(),
                    serde_json::json!({"primary":"field"}),
                    vec![],
                    4,
                )
                .unwrap();
            field.id
        };
        {
            let worker = start(&root, 5);
            let handle = worker.handle();
            let fields = FieldService::new(handle.clone(), handle.local_user.clone());
            let reopened = fields.get(&field_id).unwrap();
            assert_eq!(
                reopened.current_focus,
                Some(Value::String("Persistence".into()))
            );
            let surfaces = SurfaceService::new(handle.clone(), handle.device_id.clone());
            assert_eq!(
                surfaces
                    .latest(&field_id)
                    .unwrap()
                    .unwrap()
                    .observed_field_revision,
                2
            );
            let connection = open_connection(&handle.database_path).unwrap();
            let activities: i64 = connection
                .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
                .unwrap();
            assert_eq!(activities, 2);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshots_keep_only_latest_ten() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let fields = FieldService::new(handle.clone(), handle.local_user.clone());
        let trace = TraceId::new(Uuid::now_v7().to_string());
        let (field, _) = fields.create("Snapshots".into(), None, trace, 2).unwrap();
        let surfaces = SurfaceService::new(handle.clone(), handle.device_id.clone());
        for index in 0..12 {
            surfaces
                .save(
                    field.id.clone(),
                    serde_json::json!({"index": index}),
                    vec![],
                    10 + index,
                )
                .unwrap();
        }
        let connection = open_connection(&handle.database_path).unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM surface_snapshots", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 10);
        drop(connection);
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn frozen_migration_sql_checksum_is_exact() {
        assert_eq!(
            frozen_migration_checksum(MIGRATION_0002),
            MIGRATION_0002_FROZEN_SHA256
        );
        assert_eq!(
            frozen_migration_checksum(MIGRATION_0004),
            MIGRATION_0004_FROZEN_SHA256
        );
        assert_eq!(
            frozen_migration_checksum(MIGRATION_0005),
            MIGRATION_0005_FROZEN_SHA256
        );
        assert_eq!(
            frozen_migration_checksum(MIGRATION_0006),
            MIGRATION_0006_FROZEN_SHA256
        );
        assert_eq!(schema_version(), 16);
    }

    #[test]
    fn migration_0008_upgrades_schema_7_retains_profile_and_is_atomic_on_failure() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_7(&mut connection, 1);
        bootstrap_records(&mut connection, &device, 2).unwrap();
        let profile_before: String = connection
            .query_row(
                "SELECT profile_id FROM profiles WHERE singleton_key=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        apply_migrations(&mut connection, 3).unwrap();
        let profile_after: String = connection
            .query_row(
                "SELECT profile_id FROM profiles WHERE singleton_key=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!((profile_before, version), (profile_after, 16));
        drop(connection);
        fs::remove_dir_all(&root).unwrap();

        let rollback_root = temporary_root();
        let rollback_paths = PlatformPaths::from_root(rollback_root.clone()).unwrap();
        let rollback_device =
            DeviceIdentity::load_or_create(&rollback_paths.device_identity).unwrap();
        let mut rollback = open_connection(&rollback_paths.database).unwrap();
        apply_schema_through_7(&mut rollback, 1);
        bootstrap_records(&mut rollback, &rollback_device, 2).unwrap();
        rollback
            .execute("CREATE TABLE artifacts(preexisting TEXT)", [])
            .unwrap();
        assert!(matches!(
            apply_migrations(&mut rollback, 3),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let version8: i64 = rollback
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=8",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let revisions: i64 = rollback.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='artifact_revisions'",
            [],
            |row| row.get(0),
        ).unwrap();
        let subject_columns: i64 = rollback.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('agent_verification_receipts') WHERE name LIKE 'subject_%'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!((version8, revisions, subject_columns), (0, 0, 0));
        drop(rollback);
        fs::remove_dir_all(rollback_root).unwrap();
    }

    #[test]
    fn migration_0009_preserves_artifacts_revisions_verification_indexes_and_foreign_keys() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_8(&mut connection, 1);
        let worker =
            start_pre_migrated_worker(connection, paths.database.clone(), device.clone(), 2);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);

        let document_r1 = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("document revision one"),
            "Document fixture",
            20,
        );
        let update_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.update",
            AgentToolEffect::WorkspaceWrite,
            30,
        );
        let document_v2 = artifact_content("document revision two");
        let (document_v2_json, document_v2_digest) = canonical_artifact(&document_v2);
        let document_r2 = handle
            .update_artifact(UpdateArtifactRecord {
                artifact_id: document_r1.artifact.artifact_id.clone(),
                expected_revision_id: document_r1.revision.revision_id.clone(),
                conversation_id: conversation.id.clone(),
                run_id: run.id.clone(),
                tool_call_id: update_tool.id.clone(),
                content: document_v2,
                canonical_content_json: document_v2_json,
                semantic_sha256: document_v2_digest,
                mutation_request_sha256: format!(
                    "{:x}",
                    Sha256::digest(b"migration-0009-document-update")
                ),
                now: 32,
            })
            .unwrap();
        let presentation = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Presentation,
            presentation_artifact_content("presentation revision one"),
            "Presentation fixture",
            40,
        );
        let verification = VerificationReceiptView {
            id: VerificationReceiptId::new(Uuid::now_v7().to_string()),
            run_id: run.id.clone(),
            tool_call_id: Some(update_tool.id),
            check_kind: "ARTIFACT_MIGRATION_FIXTURE".into(),
            outcome: VerificationOutcome::Pass,
            summary: "Exact migrated revision fixture".into(),
            artifact_sha256: None,
            subject: Some(VerificationSubject::ArtifactRevision {
                artifact_id: document_r2.artifact.artifact_id.clone(),
                revision_id: document_r2.revision.revision_id.clone(),
                semantic_sha256: document_r2.revision.semantic_sha256.clone(),
            }),
            exit_code: None,
            created_at: 45,
        };
        handle
            .record_agent_verification(verification.clone())
            .unwrap();
        drop(worker);

        let mut connection = open_connection(&paths.database).unwrap();
        let artifacts_before = query_json_rows(
            &connection,
            "SELECT json_array(id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at) FROM artifacts ORDER BY id",
        );
        let revisions_before = query_json_rows(
            &connection,
            "SELECT json_array(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_schema_version,content_json,semantic_sha256,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) FROM artifact_revisions ORDER BY artifact_id,sequence",
        );
        let verification_before = query_json_rows(
            &connection,
            "SELECT json_array(id,run_id,tool_call_id,check_kind,outcome,summary,artifact_sha256,exit_code,created_at,subject_kind,subject_artifact_id,subject_revision_id,subject_sha256) FROM agent_verification_receipts ORDER BY id",
        );
        let artifact_fks_before = query_json_rows(
            &connection,
            "SELECT json_array(seq,\"table\",\"from\",\"to\",on_update,on_delete,match) FROM pragma_foreign_key_list('artifacts') WHERE \"table\"!='agent_tool_calls' ORDER BY \"table\",\"from\",seq",
        );
        let revision_fks_before = query_json_rows(
            &connection,
            "SELECT json_array(id,seq,\"table\",\"from\",\"to\",on_update,on_delete,match) FROM pragma_foreign_key_list('artifact_revisions') ORDER BY id,seq",
        );
        let artifact_indexes_before = query_json_rows(
            &connection,
            "SELECT json_array(name,sql) FROM sqlite_master WHERE type='index' AND tbl_name='artifacts' AND sql IS NOT NULL ORDER BY name",
        );

        apply_migrations(&mut connection, 50).unwrap();

        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let migration_name: String = connection
            .query_row(
                "SELECT name FROM schema_migrations WHERE version=9",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            (version, migration_name.as_str()),
            (16, MIGRATION_0009_NAME)
        );
        assert_eq!(
            artifacts_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at) FROM artifacts ORDER BY id",
            )
        );
        assert_eq!(
            revisions_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_schema_version,content_json,semantic_sha256,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) FROM artifact_revisions ORDER BY artifact_id,sequence",
            )
        );
        assert_eq!(
            verification_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,run_id,tool_call_id,check_kind,outcome,summary,artifact_sha256,exit_code,created_at,subject_kind,subject_artifact_id,subject_revision_id,subject_sha256) FROM agent_verification_receipts ORDER BY id",
            )
        );
        assert_eq!(
            artifact_fks_before,
            query_json_rows(
                &connection,
                "SELECT json_array(seq,\"table\",\"from\",\"to\",on_update,on_delete,match) FROM pragma_foreign_key_list('artifacts') WHERE \"table\"!='agent_tool_calls' ORDER BY \"table\",\"from\",seq",
            )
        );
        assert_eq!(
            revision_fks_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,seq,\"table\",\"from\",\"to\",on_update,on_delete,match) FROM pragma_foreign_key_list('artifact_revisions') ORDER BY id,seq",
            )
        );
        assert_eq!(
            artifact_indexes_before,
            query_json_rows(
                &connection,
                "SELECT json_array(name,sql) FROM sqlite_master WHERE type='index' AND tbl_name='artifacts' AND sql IS NOT NULL AND name!='idx_artifacts_profile_archive_updated' ORDER BY name",
            )
        );
        let foreign_key_violations: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_violations, 0);
        drop(connection);

        let reopened = StorageWorker::start(&paths.database, device, 60).unwrap();
        let reopened_handle = reopened.handle();
        assert_eq!(
            reopened_handle
                .read_artifact(document_r2.artifact.artifact_id.clone(), None)
                .unwrap(),
            document_r2
        );
        assert_eq!(
            reopened_handle
                .read_artifact(presentation.artifact.artifact_id.clone(), None)
                .unwrap(),
            presentation
        );
        assert_eq!(
            reopened_handle
                .list_agent_verifications(run.id.clone())
                .unwrap(),
            vec![verification]
        );

        let update_tool = artifact_tool(
            &reopened_handle,
            run.id,
            "artifact.update",
            AgentToolEffect::WorkspaceWrite,
            70,
        );
        let document_v3 = artifact_content("document revision three");
        let (document_v3_json, document_v3_digest) = canonical_artifact(&document_v3);
        let updated = reopened_handle
            .update_artifact(UpdateArtifactRecord {
                artifact_id: document_r2.artifact.artifact_id.clone(),
                expected_revision_id: document_r2.revision.revision_id.clone(),
                conversation_id: conversation.id,
                run_id: update_tool.run_id,
                tool_call_id: update_tool.id,
                content: document_v3,
                canonical_content_json: document_v3_json,
                semantic_sha256: document_v3_digest,
                mutation_request_sha256: format!(
                    "{:x}",
                    Sha256::digest(b"migration-0009-post-migration-update")
                ),
                now: 72,
            })
            .unwrap();
        assert_eq!(updated.revision.sequence, 3);
        assert_eq!(
            reopened_handle
                .read_artifact(
                    document_r1.artifact.artifact_id,
                    Some(document_r1.revision.revision_id),
                )
                .unwrap()
                .revision
                .content,
            document_r1.revision.content
        );
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_0009_rolls_back_table_data_registry_and_foreign_key_state_on_failure() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_8(&mut connection, 1);
        let worker = start_pre_migrated_worker(connection, paths.database.clone(), device, 2);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("rollback survivor"),
            "Rollback fixture",
            20,
        );
        drop(worker);

        let mut connection = open_connection(&paths.database).unwrap();
        let artifacts_before = query_json_rows(
            &connection,
            "SELECT json_array(id,profile_id,artifact_type,current_revision_id,updated_by_device,created_at,updated_at) FROM artifacts ORDER BY id",
        );
        let revisions_before = query_json_rows(
            &connection,
            "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
        );
        let failing_migration =
            format!("{MIGRATION_0009}\nSELECT * FROM migration_0009_forced_failure;");
        assert!(matches!(
            apply_artifact_type_extensibility_migration(
                &mut connection,
                30,
                &failing_migration,
                &migration_checksum(&failing_migration),
            ),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let version9: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=9",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let replacement_table: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='artifacts_v9'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let artifact_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='artifacts'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let foreign_keys: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        let foreign_key_violations: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!((version9, replacement_table, foreign_keys), (0, 0, 1));
        assert!(artifact_sql.contains("'DOCUMENT', 'PRESENTATION'"));
        assert_eq!(foreign_key_violations, 0);
        assert_eq!(
            artifacts_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,profile_id,artifact_type,current_revision_id,updated_by_device,created_at,updated_at) FROM artifacts ORDER BY id",
            )
        );
        assert_eq!(
            revisions_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
            )
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_0010_upgrades_schema_9_preserves_data_and_rolls_back_on_failure() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_8(&mut connection, 1);
        apply_artifact_type_extensibility_migration(
            &mut connection,
            2,
            MIGRATION_0009,
            &migration_checksum(MIGRATION_0009),
        )
        .unwrap();
        let worker = start_pre_migrated_worker(connection, paths.database.clone(), device, 3);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("schema 9 survivor"),
            "Schema 9 survivor",
            20,
        );
        drop(worker);

        let mut connection = open_connection(&paths.database).unwrap();
        let artifacts_before = query_json_rows(
            &connection,
            "SELECT json_array(id,profile_id,artifact_type,current_revision_id,updated_by_device,created_at,updated_at) FROM artifacts ORDER BY id",
        );
        let revisions_before = query_json_rows(
            &connection,
            "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
        );
        let failing_migration =
            format!("{MIGRATION_0010}\nSELECT * FROM migration_0010_forced_failure;");
        assert!(matches!(
            apply_durable_source_asset_migration(
                &mut connection,
                30,
                &failing_migration,
                &migration_checksum(&failing_migration),
            ),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let version_10: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=10",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let assets_table: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='assets'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((version_10, assets_table), (0, 0));
        assert_eq!(
            artifacts_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,profile_id,artifact_type,current_revision_id,updated_by_device,created_at,updated_at) FROM artifacts ORDER BY id",
            )
        );
        assert_eq!(
            revisions_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
            )
        );

        apply_migrations(&mut connection, 40).unwrap();
        let max_version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let assets_table: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='assets'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((max_version, assets_table), (16, 1));
        assert_eq!(
            artifacts_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,profile_id,artifact_type,current_revision_id,updated_by_device,created_at,updated_at) FROM artifacts ORDER BY id",
            )
        );
        assert_eq!(
            revisions_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
            )
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_0011_adds_archive_state_without_changing_artifact_content() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_8(&mut connection, 1);
        apply_artifact_type_extensibility_migration(
            &mut connection,
            2,
            MIGRATION_0009,
            &migration_checksum(MIGRATION_0009),
        )
        .unwrap();
        apply_durable_source_asset_migration(
            &mut connection,
            3,
            MIGRATION_0010,
            &migration_checksum(MIGRATION_0010),
        )
        .unwrap();
        let worker = start_pre_migrated_worker(connection, paths.database.clone(), device, 4);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        let artifact = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("schema 10 survivor"),
            "Schema 10 survivor",
            20,
        );
        drop(worker);

        let mut connection = open_connection(&paths.database).unwrap();
        let artifact_before = query_json_rows(
            &connection,
            "SELECT json_array(id,profile_id,artifact_type,title,current_revision_id,created_at,updated_at) FROM artifacts ORDER BY id",
        );
        let revisions_before = query_json_rows(
            &connection,
            "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
        );
        let failing_migration =
            format!("{MIGRATION_0011}\nSELECT * FROM migration_0011_forced_failure;");
        assert!(matches!(
            apply_artifact_archive_state_migration(
                &mut connection,
                30,
                &failing_migration,
                &migration_checksum(&failing_migration),
            ),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let version_11: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=11",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let archive_columns: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('artifacts') WHERE name IN ('archived_at','lifecycle_updated_by_tool_call_id','lifecycle_mutation_request_sha256')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((version_11, archive_columns), (0, 0));
        assert_eq!(
            artifact_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,profile_id,artifact_type,title,current_revision_id,created_at,updated_at) FROM artifacts ORDER BY id",
            )
        );
        assert_eq!(
            revisions_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
            )
        );

        apply_migrations(&mut connection, 40).unwrap();
        let archived_at: Option<i64> = connection
            .query_row(
                "SELECT archived_at FROM artifacts WHERE id=?1",
                [&artifact.artifact.artifact_id.0],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(archived_at, None);
        assert_eq!(
            artifact_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,profile_id,artifact_type,title,current_revision_id,created_at,updated_at) FROM artifacts ORDER BY id",
            )
        );
        assert_eq!(
            revisions_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,artifact_id,sequence,content_json,semantic_sha256) FROM artifact_revisions ORDER BY id",
            )
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_0012_upgrades_schema_11_empty_reopens_and_rolls_back_on_failure() {
        const IDR_TABLES: &str = "'idr_human_model_state','idr_human_model_items','idr_item_history','idr_provenance_refs','idr_item_provenance','idr_item_reality_refs','idr_erasure_tombstones'";

        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_11(&mut connection, 1);
        let before: (i64, i64) = connection
            .query_row(
                &format!(
                    "SELECT (SELECT MAX(version) FROM schema_migrations), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ({IDR_TABLES}))"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(before, (11, 0));

        apply_idr_v2_storage_migration(
            &mut connection,
            10,
            MIGRATION_0012,
            &migration_checksum(MIGRATION_0012),
        )
        .unwrap();
        let after: (i64, i64, i64, i64) = connection
            .query_row(
                &format!(
                    "SELECT (SELECT MAX(version) FROM schema_migrations), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ({IDR_TABLES})), (SELECT current_human_model_revision FROM idr_human_model_state WHERE singleton_key=1), (SELECT COUNT(*) FROM idr_human_model_items)"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(after, (12, 7, 0, 0));
        drop(connection);

        let mut reopened = open_connection(&paths.database).unwrap();
        apply_migrations(&mut reopened, 11).unwrap();
        validate_schema(&reopened).unwrap();
        drop(reopened);
        fs::remove_dir_all(root).unwrap();

        let rollback_root = temporary_root();
        let rollback_paths = PlatformPaths::from_root(rollback_root.clone()).unwrap();
        let mut rollback = open_connection(&rollback_paths.database).unwrap();
        apply_schema_through_11(&mut rollback, 1);
        let failing_migration =
            format!("{MIGRATION_0012}\nSELECT * FROM migration_0012_forced_failure;");
        assert!(matches!(
            apply_idr_v2_storage_migration(
                &mut rollback,
                10,
                &failing_migration,
                &migration_checksum(&failing_migration),
            ),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let rolled_back: (i64, i64, i64) = rollback
            .query_row(
                &format!(
                    "SELECT (SELECT MAX(version) FROM schema_migrations), (SELECT COUNT(*) FROM schema_migrations WHERE version=12), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ({IDR_TABLES}))"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(rolled_back, (11, 0, 0));
        drop(rollback);
        fs::remove_dir_all(rollback_root).unwrap();
    }

    #[test]
    fn migration_0013_preserves_markdown_adds_empty_sidecar_and_rolls_back_atomically() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_12(&mut connection, 1);
        let user = bootstrap_records(&mut connection, &device, 10).unwrap();
        let field_id = Uuid::now_v7().to_string();
        let conversation_id = Uuid::now_v7().to_string();
        let message_id = Uuid::now_v7().to_string();
        connection.execute("INSERT INTO fields(id,owner_principal_id,title,lifecycle_status,revision,created_at,updated_at) VALUES(?1,?2,'Rich Result','ACTIVE',1,10,10)",params![field_id,user.0]).unwrap();
        connection.execute("INSERT INTO conversations(id,field_id,title,provider_config_id,model_id,lifecycle_status,revision,created_at,updated_at) VALUES(?1,?2,'Typed result',NULL,NULL,'ACTIVE',1,11,11)",params![conversation_id,field_id]).unwrap();
        connection.execute("INSERT INTO conversation_messages(id,conversation_id,role,content,status,provider_config_id,model_id,invocation_id,created_at) VALUES(?1,?2,'ASSISTANT','# Existing Markdown','COMPLETED',NULL,NULL,NULL,12)",params![message_id,conversation_id]).unwrap();

        apply_migrations(&mut connection, 20).unwrap();
        let migrated: (i64, String, String) = connection.query_row(
            "SELECT (SELECT MAX(version) FROM schema_migrations),content,references_json FROM conversation_messages WHERE id=?1",
            [&message_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(migrated, (16, "# Existing Markdown".into(), "[]".into()));
        apply_migrations(&mut connection, 21).unwrap();
        validate_schema(&connection).unwrap();
        drop(connection);
        fs::remove_dir_all(root).unwrap();

        let rollback_root = temporary_root();
        let rollback_paths = PlatformPaths::from_root(rollback_root.clone()).unwrap();
        let mut rollback = open_connection(&rollback_paths.database).unwrap();
        apply_schema_through_12(&mut rollback, 1);
        let failing_migration =
            format!("{MIGRATION_0013}\nSELECT * FROM migration_0013_forced_failure;");
        assert!(matches!(
            apply_rich_result_reference_migration(
                &mut rollback,
                20,
                &failing_migration,
                &migration_checksum(&failing_migration),
            ),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let rolled_back: (i64, i64) = rollback.query_row(
            "SELECT (SELECT COUNT(*) FROM schema_migrations WHERE version=13), (SELECT COUNT(*) FROM pragma_table_info('conversation_messages') WHERE name='references_json')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(rolled_back, (0, 0));
        drop(rollback);
        fs::remove_dir_all(rollback_root).unwrap();
    }

    #[test]
    fn migration_0014_is_additive_old_database_compatible_and_atomic() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_13(&mut connection, 1);
        bootstrap_records(&mut connection, &device, 10).unwrap();
        apply_migrations(&mut connection, 20).unwrap();
        let migrated: (i64, i64) = connection
            .query_row(
                "SELECT (SELECT MAX(version) FROM schema_migrations), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='screenshot_evidence')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(migrated, (16, 1));
        apply_migrations(&mut connection, 21).unwrap();
        validate_schema(&connection).unwrap();
        drop(connection);
        fs::remove_dir_all(root).unwrap();

        let rollback_root = temporary_root();
        let rollback_paths = PlatformPaths::from_root(rollback_root.clone()).unwrap();
        let mut rollback = open_connection(&rollback_paths.database).unwrap();
        apply_schema_through_13(&mut rollback, 1);
        let failing_migration =
            format!("{MIGRATION_0014}\nSELECT * FROM migration_0014_forced_failure;");
        assert!(matches!(
            apply_screenshot_evidence_migration(
                &mut rollback,
                20,
                &failing_migration,
                &migration_checksum(&failing_migration),
            ),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let rolled_back: (i64, i64) = rollback
            .query_row(
                "SELECT (SELECT COUNT(*) FROM schema_migrations WHERE version=14), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='screenshot_evidence')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(rolled_back, (0, 0));
        drop(rollback);
        fs::remove_dir_all(rollback_root).unwrap();
    }

    #[test]
    fn migration_0016_preserves_run_lineage_and_rolls_back_on_failure() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_14(&mut connection, 1);
        apply_durable_file_artifact_migration(
            &mut connection,
            8,
            MIGRATION_0015,
            &migration_checksum(MIGRATION_0015),
        )
        .unwrap();
        let worker =
            start_pre_migrated_worker(connection, paths.database.clone(), device.clone(), 10);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 20);
        let artifact = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("retained history"),
            "Retain",
            30,
        );
        drop(worker);
        let mut connection = open_connection(&paths.database).unwrap();
        let before = query_json_rows(
            &connection,
            "SELECT json_array(id,current_step,max_steps,next_sequence,status) FROM agent_runs ORDER BY id",
        );
        let events = query_json_rows(
            &connection,
            "SELECT json_array(id,run_id,sequence,payload_json) FROM agent_events ORDER BY id",
        );
        let failing = format!("{MIGRATION_0016}\nSELECT * FROM forced_migration_failure;");
        assert!(
            apply_agent_continuation_migration(
                &mut connection,
                40,
                &failing,
                &migration_checksum(&failing)
            )
            .is_err()
        );
        assert!(!migration_exists(&connection, 16).unwrap());
        assert_eq!(
            connection
                .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,current_step,max_steps,next_sequence,status) FROM agent_runs ORDER BY id"
            )
        );
        apply_migrations(&mut connection, 41).unwrap();
        assert_eq!(
            before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,current_step,max_steps,next_sequence,status) FROM agent_runs ORDER BY id"
            )
        );
        assert_eq!(
            events,
            query_json_rows(
                &connection,
                "SELECT json_array(id,run_id,sequence,payload_json) FROM agent_events ORDER BY id"
            )
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        drop(connection);
        let worker = StorageWorker::start(&paths.database, device, 50).unwrap();
        let handle = worker.handle();
        assert_eq!(
            handle
                .read_artifact(artifact.artifact.artifact_id, None)
                .unwrap()
                .revision
                .content,
            artifact.revision.content
        );
        let mut allowance = run.max_steps;
        for now in [60, 70, 80] {
            handle
                .append_agent_event(
                    run.id.clone(),
                    AgentEventKind::RunPaused,
                    json!({"reason":"AGENT_BUDGET_EXHAUSTED"}),
                    AgentProjectionUpdate {
                        status: Some(AgentRunStatus::Paused),
                        current_step: Some(allowance),
                        ..Default::default()
                    },
                    now,
                )
                .unwrap();
            let resumed = handle.resume_agent_run(run.id.clone(), now + 1).unwrap();
            assert_eq!(resumed.run.id, run.id);
            assert_eq!(resumed.run.current_step, allowance);
            assert_eq!(resumed.run.max_steps, allowance + 24);
            assert_eq!(
                resumed.event.payload["budget_grant"]["source"],
                "EXPLICIT_USER_RESUME"
            );
            assert!(handle.resume_agent_run(run.id.clone(), now + 2).is_err());
            allowance += 24;
        }
        assert!(allowance > 64);
        handle
            .append_agent_event(
                run.id.clone(),
                AgentEventKind::RunPaused,
                json!({}),
                AgentProjectionUpdate {
                    status: Some(AgentRunStatus::Paused),
                    ..Default::default()
                },
                90,
            )
            .unwrap();
        let ordinary = handle.resume_agent_run(run.id.clone(), 91).unwrap();
        assert_eq!(ordinary.run.max_steps, allowance);
        assert!(ordinary.event.payload.get("budget_grant").is_none());
        assert_eq!(
            ordinary.event.payload["resource_budget_reset"]["source"],
            "EXPLICIT_USER_RESUME"
        );
        drop(worker);
        let connection = open_connection(&paths.database).unwrap();
        connection.execute("UPDATE agent_runs SET status='PAUSED',current_step=4096,max_steps=4096 WHERE id=?1", [&run.id.0]).unwrap();
        assert!(
            connection
                .execute(
                    "UPDATE agent_runs SET max_steps=4097 WHERE id=?1",
                    [&run.id.0]
                )
                .is_err()
        );
        drop(connection);
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let worker = StorageWorker::start(&paths.database, device, 100).unwrap();
        assert!(
            matches!(worker.handle().resume_agent_run(run.id, 101), Err(DomainError::Validation(code)) if code == "AGENT_CUMULATIVE_BUDGET_REACHED")
        );
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_0015_preserves_artifact_history_and_is_atomic() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        apply_schema_through_14(&mut connection, 1);
        bootstrap_records(&mut connection, &device, 10).unwrap();
        let worker =
            start_pre_migrated_worker(connection, paths.database.clone(), device.clone(), 11);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 20);
        let existing = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Document,
            artifact_content("pre-0015 revision"),
            "Pre-0015 Artifact",
            30,
        );
        drop(worker);

        let mut connection = open_connection(&paths.database).unwrap();
        let revisions_before = query_json_rows(
            &connection,
            "SELECT json_array(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_json,semantic_sha256,mutation_request_sha256,created_by_tool_call_id) FROM artifact_revisions ORDER BY id",
        );
        apply_migrations(&mut connection, 40).unwrap();
        let migrated: (i64, i64, i64) = connection.query_row(
            "SELECT (SELECT MAX(version) FROM schema_migrations), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='file_artifact_bindings'), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='artifact_revision_reviews')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(migrated, (16, 1, 1));
        assert_eq!(
            revisions_before,
            query_json_rows(
                &connection,
                "SELECT json_array(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_json,semantic_sha256,mutation_request_sha256,created_by_tool_call_id) FROM artifact_revisions ORDER BY id",
            )
        );
        let foreign_key_violations: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_violations, 0);
        drop(connection);

        let reopened = StorageWorker::start(&paths.database, device, 50).unwrap();
        assert_eq!(
            reopened
                .handle()
                .read_artifact(existing.artifact.artifact_id, None)
                .unwrap()
                .revision
                .content,
            existing.revision.content
        );
        drop(reopened);
        fs::remove_dir_all(root).unwrap();

        let rollback_root = temporary_root();
        let rollback_paths = PlatformPaths::from_root(rollback_root.clone()).unwrap();
        let rollback_device =
            DeviceIdentity::load_or_create(&rollback_paths.device_identity).unwrap();
        let mut rollback = open_connection(&rollback_paths.database).unwrap();
        apply_schema_through_14(&mut rollback, 1);
        bootstrap_records(&mut rollback, &rollback_device, 10).unwrap();
        let failing_migration =
            format!("{MIGRATION_0015}\nSELECT * FROM migration_0015_forced_failure;");
        assert!(matches!(
            apply_durable_file_artifact_migration(
                &mut rollback,
                20,
                &failing_migration,
                &migration_checksum(&failing_migration),
            ),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let rolled_back: (i64, i64, i64, i64) = rollback.query_row(
            "SELECT (SELECT COUNT(*) FROM schema_migrations WHERE version=15), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='file_artifact_bindings'), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='artifact_revision_reviews'), (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='artifact_revisions')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert_eq!(rolled_back, (0, 0, 0, 1));
        let foreign_keys: i64 = rollback
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1);
        drop(rollback);
        fs::remove_dir_all(rollback_root).unwrap();
    }

    #[test]
    fn file_artifact_revisions_are_stable_idempotent_reviewable_and_exactly_verified() {
        fn mutation(
            operation: FileMutationOperation,
            path: &str,
            before: Option<&[u8]>,
            after: Option<&[u8]>,
        ) -> FileArtifactMutationRecord {
            let state = |bytes: Option<&[u8]>| FileArtifactStateV1 {
                relative_path: path.into(),
                exists: bytes.is_some(),
                content_sha256: bytes.map(|value| format!("{:x}", Sha256::digest(value))),
                byte_length: bytes.map(|value| value.len() as u64),
            };
            let content = FileMutationArtifactV1 {
                operation,
                before: state(before),
                after: state(after),
            };
            let canonical_content_json =
                serde_json::to_string(&ArtifactContentV1::FileMutation(content.clone())).unwrap();
            let semantic_sha256 =
                format!("{:x}", Sha256::digest(canonical_content_json.as_bytes()));
            FileArtifactMutationRecord {
                relative_path: path.into(),
                content,
                canonical_content_json,
                semantic_sha256,
            }
        }

        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        let create_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "create_file",
            AgentToolEffect::WorkspaceWrite,
            20,
        );
        let create_mutation = mutation(
            FileMutationOperation::Create,
            "src/lib.rs",
            None,
            Some(b"revision one\n"),
        );
        let create_request = CommitFileArtifactMutationsRecord {
            project_field_id: project.field_id.clone(),
            conversation_id: conversation.id.clone(),
            run_id: run.id.clone(),
            tool_call_id: create_tool.id.clone(),
            mutation_request_sha256: format!("{:x}", Sha256::digest(b"create-file-r1")),
            mutations: vec![create_mutation.clone()],
            now: 22,
        };
        let sync_before: i64 = request_task(&handle.sender, |connection| {
            connection
                .query_row("SELECT COUNT(*) FROM sync_change_journal", [], |row| {
                    row.get(0)
                })
                .map_err(storage_domain)
        })
        .unwrap();
        let r1 = handle
            .commit_file_artifact_mutations(create_request.clone())
            .unwrap();
        assert_eq!(r1.len(), 1);
        assert_eq!(r1[0].revision.sequence, 1);
        assert_eq!(
            handle
                .commit_file_artifact_mutations(create_request)
                .unwrap(),
            r1
        );
        assert!(
            !serde_json::to_string(&r1[0].revision.content)
                .unwrap()
                .contains(&project.root_path)
        );
        let sync_after: i64 = request_task(&handle.sender, |connection| {
            connection
                .query_row("SELECT COUNT(*) FROM sync_change_journal", [], |row| {
                    row.get(0)
                })
                .map_err(storage_domain)
        })
        .unwrap();
        assert_eq!(sync_after, sync_before);

        let verification = VerificationReceiptView {
            id: VerificationReceiptId::new(Uuid::now_v7().to_string()),
            run_id: run.id.clone(),
            tool_call_id: Some(create_tool.id.clone()),
            check_kind: "TARGETED_FILE_CHECK".into(),
            outcome: VerificationOutcome::Pass,
            summary: "Exact first revision passed".into(),
            artifact_sha256: None,
            subject: Some(VerificationSubject::ArtifactRevision {
                artifact_id: r1[0].artifact.artifact_id.clone(),
                revision_id: r1[0].revision.revision_id.clone(),
                semantic_sha256: r1[0].revision.semantic_sha256.clone(),
            }),
            exit_code: Some(0),
            created_at: 23,
        };
        handle
            .record_agent_verification(verification.clone())
            .unwrap();
        assert_eq!(
            handle
                .mark_file_artifact_revision_reviewed(
                    r1[0].artifact.artifact_id.clone(),
                    r1[0].revision.revision_id.clone(),
                    24,
                )
                .unwrap(),
            FileArtifactReviewState::Reviewed
        );

        let update_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "write_file",
            AgentToolEffect::WorkspaceWrite,
            25,
        );
        let update_mutation = mutation(
            FileMutationOperation::Modify,
            "src/lib.rs",
            Some(b"revision one\n"),
            Some(b"revision two\n"),
        );
        let r2 = handle
            .commit_file_artifact_mutations(CommitFileArtifactMutationsRecord {
                project_field_id: project.field_id.clone(),
                conversation_id: conversation.id.clone(),
                run_id: run.id.clone(),
                tool_call_id: update_tool.id,
                mutation_request_sha256: format!("{:x}", Sha256::digest(b"write-file-r2")),
                mutations: vec![update_mutation],
                now: 27,
            })
            .unwrap();
        assert_eq!(r2.len(), 1);
        assert_eq!(r2[0].artifact.artifact_id, r1[0].artifact.artifact_id);
        assert_eq!(r2[0].revision.sequence, 2);
        assert_eq!(
            r2[0].revision.parent_revision_id,
            Some(r1[0].revision.revision_id.clone())
        );
        assert_eq!(
            handle
                .list_artifact_revision_verifications(
                    r1[0].artifact.artifact_id.clone(),
                    r1[0].revision.revision_id.clone(),
                )
                .unwrap(),
            vec![verification]
        );
        assert!(
            handle
                .list_artifact_revision_verifications(
                    r2[0].artifact.artifact_id.clone(),
                    r2[0].revision.revision_id.clone(),
                )
                .unwrap()
                .is_empty()
        );
        let listed = handle
            .list_file_artifact_revisions_by_run(run.id.clone())
            .unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].review_state, FileArtifactReviewState::Reviewed);
        assert_eq!(listed[1].review_state, FileArtifactReviewState::Unreviewed);
        assert!(
            handle
                .list_artifacts(None, 100, true)
                .unwrap()
                .artifacts
                .is_empty()
        );

        let (shared_hash, shared_length) = match &r2[0].revision.content {
            ArtifactContentV1::FileMutation(content) => (
                content.after.content_sha256.clone().unwrap(),
                content.after.byte_length.unwrap(),
            ),
            _ => panic!("expected file mutation Artifact content"),
        };
        let unrelated_hash = "c".repeat(64);
        for (index, content_sha256) in [shared_hash.clone(), unrelated_hash.clone()]
            .into_iter()
            .enumerate()
        {
            handle
                .create_screenshot_evidence(ScreenshotEvidenceView {
                    id: ScreenshotEvidenceId::new(Uuid::now_v7().to_string()),
                    content_sha256: content_sha256.clone(),
                    blob_ref: format!("blobs/objects/{}/{}", &content_sha256[..2], content_sha256),
                    mime_type: "image/png".into(),
                    byte_size: if index == 0 { shared_length } else { 64 },
                    width: 8,
                    height: 8,
                    source_kind: ScreenshotEvidenceSourceKind::BrowserViewport,
                    page_id: format!("page_{}", Uuid::now_v7()),
                    navigation_generation: 1,
                    captured_url: "https://fixture.example/artifact-owner-boundary".into(),
                    captured_at: 28 + index as i64,
                    conversation_id: Some(conversation.id.clone()),
                    run_id: Some(run.id.clone()),
                    tool_call_id: Some(create_tool.id.clone()),
                    verification_receipt_id: None,
                    visibility: ScreenshotEvidenceVisibility::Internal,
                    retention_class: ScreenshotEvidenceRetentionClass::LocalEvidence,
                    status: ScreenshotEvidenceStatus::Active,
                    export_policy: ScreenshotEvidenceExportPolicy::Excluded,
                    sync_policy: ScreenshotEvidenceSyncPolicy::LocalOnly,
                    created_at: 28 + index as i64,
                })
                .unwrap();
        }

        let manifest = handle.portable_blob_manifest().unwrap();
        assert_eq!(manifest.len(), 2);
        assert!(manifest.iter().all(|entry| {
            !entry.blob_ref.contains(&project.root_path)
                && entry.blob_ref.starts_with("blobs/objects/")
        }));
        assert_eq!(
            manifest
                .iter()
                .filter(|entry| entry.content_sha256 == shared_hash)
                .count(),
            1
        );
        assert!(
            manifest
                .iter()
                .all(|entry| entry.content_sha256 != unrelated_hash)
        );

        drop(worker);
        let reopened = start(&root, 30);
        let reopened_handle = reopened.handle();
        let restored = reopened_handle
            .list_file_artifact_revisions_by_run(run.id)
            .unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].review_state, FileArtifactReviewState::Reviewed);
        assert_eq!(
            restored[1].review_state,
            FileArtifactReviewState::Unreviewed
        );
        assert_eq!(
            restored[1].read.artifact.artifact_id,
            restored[0].read.artifact.artifact_id
        );
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multi_file_toolcall_is_atomic_project_scoped_and_terminal_failures_create_no_revision() {
        fn mutation(path: &str, before: &[u8], after: &[u8]) -> FileArtifactMutationRecord {
            let content = FileMutationArtifactV1 {
                operation: FileMutationOperation::Modify,
                before: FileArtifactStateV1 {
                    relative_path: path.into(),
                    exists: true,
                    content_sha256: Some(format!("{:x}", Sha256::digest(before))),
                    byte_length: Some(before.len() as u64),
                },
                after: FileArtifactStateV1 {
                    relative_path: path.into(),
                    exists: true,
                    content_sha256: Some(format!("{:x}", Sha256::digest(after))),
                    byte_length: Some(after.len() as u64),
                },
            };
            let canonical_content_json =
                serde_json::to_string(&ArtifactContentV1::FileMutation(content.clone())).unwrap();
            FileArtifactMutationRecord {
                relative_path: path.into(),
                content,
                semantic_sha256: format!("{:x}", Sha256::digest(canonical_content_json.as_bytes())),
                canonical_content_json,
            }
        }

        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        let tool = artifact_tool(
            &handle,
            run.id.clone(),
            "apply_patches",
            AgentToolEffect::WorkspaceWrite,
            20,
        );
        let request = CommitFileArtifactMutationsRecord {
            project_field_id: project.field_id.clone(),
            conversation_id: conversation.id.clone(),
            run_id: run.id.clone(),
            tool_call_id: tool.id.clone(),
            mutation_request_sha256: format!("{:x}", Sha256::digest(b"multi-file")),
            mutations: vec![
                mutation("src/a.rs", b"a1\n", b"a2\n"),
                mutation("src/b.rs", b"b1\n", b"b2\n"),
            ],
            now: 22,
        };
        let committed = handle
            .commit_file_artifact_mutations(request.clone())
            .unwrap();
        assert_eq!(committed.len(), 2);
        assert_ne!(
            committed[0].artifact.artifact_id,
            committed[1].artifact.artifact_id
        );
        assert_eq!(
            handle.commit_file_artifact_mutations(request).unwrap(),
            committed
        );
        assert_eq!(
            handle
                .file_artifact_mutations_by_tool_call(tool.id)
                .unwrap()
                .len(),
            2
        );

        request_task(&handle.sender, |connection| {
            connection
                .execute_batch(
                    "CREATE TRIGGER file_artifact_batch_failure BEFORE INSERT ON file_artifact_bindings WHEN NEW.relative_path='src/fail-b.rs' BEGIN SELECT RAISE(ABORT, 'TEST_BATCH_FAILURE'); END;",
                )
                .map_err(storage_domain)?;
            Ok(())
        })
        .unwrap();
        let failed_batch_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "apply_patches",
            AgentToolEffect::WorkspaceWrite,
            24,
        );
        assert!(
            handle
                .commit_file_artifact_mutations(CommitFileArtifactMutationsRecord {
                    project_field_id: project.field_id.clone(),
                    conversation_id: conversation.id.clone(),
                    run_id: run.id.clone(),
                    tool_call_id: failed_batch_tool.id.clone(),
                    mutation_request_sha256: format!("{:x}", Sha256::digest(b"failed-batch")),
                    mutations: vec![
                        mutation("src/fail-a.rs", b"a\n", b"aa\n"),
                        mutation("src/fail-b.rs", b"b\n", b"bb\n"),
                    ],
                    now: 26,
                })
                .is_err()
        );
        assert!(
            handle
                .file_artifact_mutations_by_tool_call(failed_batch_tool.id)
                .unwrap()
                .is_empty()
        );

        let other_root = root.join("other-project");
        let (other_project, other_conversation, other_run) =
            artifact_run_fixture(&handle, &other_root, 30);
        let other_tool = artifact_tool(
            &handle,
            other_run.id.clone(),
            "write_file",
            AgentToolEffect::WorkspaceWrite,
            40,
        );
        let other = handle
            .commit_file_artifact_mutations(CommitFileArtifactMutationsRecord {
                project_field_id: other_project.field_id,
                conversation_id: other_conversation.id,
                run_id: other_run.id,
                tool_call_id: other_tool.id,
                mutation_request_sha256: format!("{:x}", Sha256::digest(b"other-project")),
                mutations: vec![mutation("src/a.rs", b"a1\n", b"a2\n")],
                now: 42,
            })
            .unwrap();
        assert_ne!(
            other[0].artifact.artifact_id,
            committed[0].artifact.artifact_id
        );

        for (index, status) in [
            AgentToolStatus::Failed,
            AgentToolStatus::Denied,
            AgentToolStatus::Cancelled,
            AgentToolStatus::Unknown,
        ]
        .into_iter()
        .enumerate()
        {
            let terminal_tool = artifact_tool(
                &handle,
                run.id.clone(),
                "write_file",
                AgentToolEffect::WorkspaceWrite,
                50 + index as i64 * 3,
            );
            handle
                .update_agent_tool_call(
                    terminal_tool.id.clone(),
                    status,
                    None,
                    Some("FIXTURE_TERMINAL".into()),
                    52 + index as i64 * 3,
                )
                .unwrap();
            assert!(
                handle
                    .commit_file_artifact_mutations(CommitFileArtifactMutationsRecord {
                        project_field_id: project.field_id.clone(),
                        conversation_id: conversation.id.clone(),
                        run_id: run.id.clone(),
                        tool_call_id: terminal_tool.id.clone(),
                        mutation_request_sha256: format!(
                            "{:x}",
                            Sha256::digest(format!("terminal-{index}").as_bytes())
                        ),
                        mutations: vec![mutation("src/terminal.rs", b"x\n", b"y\n")],
                        now: 53 + index as i64 * 3,
                    })
                    .is_err()
            );
            assert!(
                handle
                    .file_artifact_mutations_by_tool_call(terminal_tool.id)
                    .unwrap()
                    .is_empty()
            );
        }
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn screenshot_evidence_is_durable_profile_scoped_local_only_and_verification_bounded() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        let tool = artifact_tool(
            &handle,
            run.id.clone(),
            "browser.fixture.observe",
            AgentToolEffect::Observe,
            20,
        );
        let receipt = VerificationReceiptView {
            id: VerificationReceiptId::new(Uuid::now_v7().to_string()),
            run_id: run.id.clone(),
            tool_call_id: Some(tool.id.clone()),
            check_kind: "VISUAL_FIXTURE".into(),
            outcome: VerificationOutcome::Fail,
            summary: "The screenshot supports inspection but does not grant PASS".into(),
            artifact_sha256: None,
            subject: None,
            exit_code: None,
            created_at: 24,
        };
        handle.record_agent_verification(receipt.clone()).unwrap();
        let content_sha256 = "a".repeat(64);
        let screenshot = ScreenshotEvidenceView {
            id: ScreenshotEvidenceId::new(Uuid::now_v7().to_string()),
            content_sha256: content_sha256.clone(),
            blob_ref: format!("blobs/objects/aa/{content_sha256}"),
            mime_type: "image/png".into(),
            byte_size: 128,
            width: 16,
            height: 8,
            source_kind: ScreenshotEvidenceSourceKind::BrowserViewport,
            page_id: format!("page_{}", Uuid::now_v7()),
            navigation_generation: 3,
            captured_url: "https://fixture.example/verified".into(),
            captured_at: 25,
            conversation_id: Some(conversation.id.clone()),
            run_id: Some(run.id.clone()),
            tool_call_id: Some(tool.id.clone()),
            verification_receipt_id: Some(receipt.id.clone()),
            visibility: ScreenshotEvidenceVisibility::Internal,
            retention_class: ScreenshotEvidenceRetentionClass::LocalEvidence,
            status: ScreenshotEvidenceStatus::Active,
            export_policy: ScreenshotEvidenceExportPolicy::Excluded,
            sync_policy: ScreenshotEvidenceSyncPolicy::LocalOnly,
            created_at: 26,
        };
        let library_hash = "b".repeat(64);
        let library = handle
            .create_library_file(
                CreateLibraryFileRequest {
                    title: "Normal Library image".into(),
                    original_source: root.join("normal.png").to_string_lossy().into_owned(),
                    original_filename: "normal.png".into(),
                    mime_type: Some("image/png".into()),
                    media_kind: LibraryMediaKind::Image,
                    size: 64,
                    blob_ref: format!("blobs/objects/bb/{library_hash}"),
                    content_hash: library_hash.clone(),
                    metadata: json!({"fixture":true}),
                },
                25,
            )
            .unwrap();
        let library_before = handle
            .list_library_objects(ListLibraryObjectsRequest {
                media_kind: None,
                include_deleted: true,
                limit: Some(500),
            })
            .unwrap()
            .len();
        let journal_before: i64 = open_connection(&handle.database_path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sync_change_journal", [], |row| {
                row.get(0)
            })
            .unwrap();
        let created = handle
            .create_screenshot_evidence(screenshot.clone())
            .unwrap();
        assert_eq!(created, screenshot);
        assert_eq!(
            handle
                .get_screenshot_evidence(screenshot.id.clone())
                .unwrap(),
            screenshot
        );
        assert_eq!(
            handle
                .list_screenshot_evidence_by_run(run.id.clone())
                .unwrap(),
            vec![screenshot.clone()]
        );
        assert_eq!(
            handle
                .list_screenshot_evidence_by_verification(receipt.id.clone())
                .unwrap(),
            vec![screenshot.clone()]
        );
        let mut same_pixels_later = screenshot.clone();
        same_pixels_later.id = ScreenshotEvidenceId::new(Uuid::now_v7().to_string());
        same_pixels_later.captured_at += 1;
        same_pixels_later.created_at += 1;
        let same_pixels_later = handle
            .create_screenshot_evidence(same_pixels_later)
            .unwrap();
        assert_ne!(same_pixels_later.id, screenshot.id);
        assert_eq!(same_pixels_later.content_sha256, screenshot.content_sha256);
        let mut shared_with_library = screenshot.clone();
        shared_with_library.id = ScreenshotEvidenceId::new(Uuid::now_v7().to_string());
        shared_with_library.content_sha256 = library_hash.clone();
        shared_with_library.blob_ref = format!("blobs/objects/bb/{library_hash}");
        shared_with_library.captured_at += 2;
        shared_with_library.created_at += 2;
        let shared_with_library = handle
            .create_screenshot_evidence(shared_with_library)
            .unwrap();
        assert_eq!(shared_with_library.content_sha256, library_hash);
        let other_profile = StorageHandle {
            sender: handle.sender.clone(),
            local_user: handle.local_user.clone(),
            device_id: handle.device_id.clone(),
            profile_id: ProfileId::new("other-profile"),
            database_path: handle.database_path.clone(),
        };
        assert_eq!(
            other_profile
                .get_screenshot_evidence(screenshot.id.clone())
                .unwrap_err(),
            DomainError::NotFound
        );
        drop(other_profile);
        assert_eq!(receipt.outcome, VerificationOutcome::Fail);
        assert_eq!(
            handle
                .list_library_objects(ListLibraryObjectsRequest {
                    media_kind: None,
                    include_deleted: true,
                    limit: Some(500),
                })
                .unwrap()
                .len(),
            library_before
        );
        assert_eq!(
            handle.portable_blob_manifest().unwrap(),
            vec![PortableBlobManifestEntryView {
                blob_ref: library.blob_ref.unwrap(),
                content_sha256: library_hash.clone(),
                byte_size: 64,
            }]
        );
        let journal_after: i64 = open_connection(&handle.database_path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sync_change_journal", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(journal_after, journal_before);

        let second_run = handle
            .create_agent_run(
                StartAgentRunRequest {
                    resource_budget: None,
                    field_id: project.field_id,
                    conversation_id: conversation.id.clone(),
                    user_message_id: None,
                    provider_config_id: run.provider_config_id.clone(),
                    model_id: Some(run.model_id.clone()),
                    task: "Second run".into(),
                    permission: AgentPermission::ReadOnly,
                    max_steps: Some(2),
                    attachments: None,
                    active_work_surface: None,
                },
                30,
            )
            .unwrap()
            .run;
        let mut invalid = screenshot.clone();
        invalid.id = ScreenshotEvidenceId::new(Uuid::now_v7().to_string());
        invalid.run_id = Some(second_run.id);
        assert!(matches!(
            handle.create_screenshot_evidence(invalid),
            Err(DomainError::Validation(code)) if code == "SCREENSHOT_EVIDENCE_PROVENANCE_INVALID"
        ));

        let reference_id = ResultReferenceId::new(format!("resultref_{}", "e".repeat(32)));
        let markdown = format!(
            "## 页面验证\n\n当前实际界面：\n\n![当前页面](fielora-reference:{reference_id})\n\n对应验证已记录。"
        );
        let message = handle
            .create_conversation_message(
                CreateConversationMessageRequest {
                    conversation_id: conversation.id.clone(),
                    role: ConversationMessageRole::Assistant,
                    content: markdown,
                    status: ConversationMessageStatus::Completed,
                    provider_config_id: None,
                    model_id: None,
                    invocation_id: None,
                    references: vec![ResultReference {
                        id: reference_id,
                        label: "当前页面".into(),
                        target: ResultReferenceTarget::Image {
                            source: ResultImageSource::ScreenshotEvidence,
                            library_object_id: None,
                            screenshot_evidence_id: Some(screenshot.id.clone()),
                            expected_sha256: screenshot.content_sha256.clone(),
                            mime_type: "image/png".into(),
                        },
                        provenance: ResultReferenceProvenance::ScreenshotEvidence {
                            screenshot_evidence_id: screenshot.id.clone(),
                        },
                    }],
                },
                40,
            )
            .unwrap();
        drop(handle);
        drop(worker);

        let reopened = start(&root, 50);
        assert_eq!(
            reopened
                .handle()
                .get_screenshot_evidence(screenshot.id.clone())
                .unwrap(),
            screenshot
        );
        assert_eq!(
            reopened
                .handle()
                .list_conversation_messages(conversation.id)
                .unwrap()
                .last()
                .unwrap(),
            &message
        );
        drop(reopened);

        let portable = root.join("portable.sqlite");
        create_portable_snapshot(
            &PlatformPaths::from_root(root.clone()).unwrap().database,
            &portable,
        )
        .unwrap();
        let portable_connection = open_connection(&portable).unwrap();
        let screenshot_rows: i64 = portable_connection
            .query_row("SELECT COUNT(*) FROM screenshot_evidence", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(screenshot_rows, 0);
        let restored_references: String = portable_connection
            .query_row(
                "SELECT references_json FROM conversation_messages WHERE id=?1",
                [&message.id.0],
                |row| row.get(0),
            )
            .unwrap();
        assert!(restored_references.contains(&screenshot.id.0));
        drop(portable_connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn schema_9_accepts_typed_diagram_and_bounded_future_tokens_while_unknown_reads_fail_closed() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);

        let mut connection = open_connection(&handle.database_path).unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .unwrap();
        let transaction = connection.transaction().unwrap();
        for (index, token) in [
            "DOCUMENT",
            "PRESENTATION",
            "DIAGRAM",
            "SPREADSHEET",
            "FUTURE_ARTIFACT",
        ]
        .into_iter()
        .enumerate()
        {
            assert_eq!(
                transaction
                    .execute(
                        "INSERT INTO artifacts(id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at) VALUES(?1,'profile',?2,NULL,NULL,'revision',NULL,NULL,'device',1,1)",
                        params![format!("valid-{index}"), token],
                    )
                    .unwrap(),
                1
            );
        }
        let invalid_tokens = vec![
            String::new(),
            "document".into(),
            "1DOCUMENT".into(),
            "_DOCUMENT".into(),
            "DOC TYPE".into(),
            "DOC/TYPE".into(),
            "DOC.TYPE".into(),
            "DOC-TYPE".into(),
            "DÍAGRAM".into(),
            "A".repeat(33),
        ];
        for (index, token) in invalid_tokens.into_iter().enumerate() {
            assert!(
                transaction
                    .execute(
                        "INSERT INTO artifacts(id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at) VALUES(?1,'profile',?2,NULL,NULL,'revision',NULL,NULL,'device',1,1)",
                        params![format!("invalid-{index}"), token],
                    )
                    .is_err()
            );
        }
        transaction.rollback().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();

        let future_artifact_id = ArtifactId::new(Uuid::now_v7().to_string());
        let future_revision_id = ArtifactRevisionId::new(Uuid::now_v7().to_string());
        let future_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.create",
            AgentToolEffect::WorkspaceWrite,
            20,
        );
        let future_content = artifact_content("future test-owned payload");
        let (future_json, future_digest) = canonical_artifact(&future_content);
        let future_mutation_digest = format!("{:x}", Sha256::digest(b"future-artifact"));
        let transaction = connection.transaction().unwrap();
        transaction
            .execute(
                "INSERT INTO artifacts(id,profile_id,artifact_type,title,project_field_id,current_revision_id,created_from_conversation_id,created_by_agent_run_id,updated_by_device,created_at,updated_at) VALUES(?1,?2,'FUTURE_ARTIFACT','Future fixture',?3,?4,?5,?6,?7,22,22)",
                params![
                    future_artifact_id.0,
                    handle.profile_id.0,
                    project.field_id.0,
                    future_revision_id.0,
                    conversation.id.0,
                    run.id.0,
                    handle.device_id.0,
                ],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO artifact_revisions(id,artifact_id,sequence,parent_revision_id,mutation_kind,content_schema_version,content_json,semantic_sha256,mutation_request_sha256,created_from_conversation_id,created_by_agent_run_id,created_by_tool_call_id,created_at) VALUES(?1,?2,1,NULL,'CREATE',1,?3,?4,?5,?6,?7,?8,22)",
                params![
                    future_revision_id.0,
                    future_artifact_id.0,
                    future_json,
                    future_digest,
                    future_mutation_digest,
                    conversation.id.0,
                    run.id.0,
                    future_tool.id.0,
                ],
            )
            .unwrap();
        transaction.commit().unwrap();
        drop(connection);

        assert_eq!(
            handle.read_artifact(future_artifact_id, None).unwrap_err(),
            DomainError::Validation("ARTIFACT_TYPE_UNSUPPORTED".into())
        );
        assert_eq!(
            serde_json::from_str::<ArtifactType>("\"DIAGRAM\"").unwrap(),
            ArtifactType::Diagram
        );
        assert_eq!(
            serde_json::from_str::<ArtifactType>("\"DOCUMENT\"").unwrap(),
            ArtifactType::Document
        );
        assert_eq!(
            serde_json::from_str::<ArtifactType>("\"SPREADSHEET\"").unwrap(),
            ArtifactType::Spreadsheet
        );
        let stored_diagram = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Diagram,
            diagram_artifact_content("Schema nine"),
            "Diagram fixture",
            30,
        );
        assert_eq!(stored_diagram.artifact.artifact_type, ArtifactType::Diagram);
        assert!(matches!(
            stored_diagram.revision.content,
            ArtifactContentV1::Diagram(_)
        ));
        let stored_spreadsheet = create_artifact_fixture(
            &handle,
            (&project, &conversation, &run),
            ArtifactType::Spreadsheet,
            spreadsheet_artifact_content("Schema nine Spreadsheet"),
            "Spreadsheet fixture",
            40,
        );
        assert_eq!(
            stored_spreadsheet.artifact.artifact_type,
            ArtifactType::Spreadsheet
        );
        assert!(matches!(
            stored_spreadsheet.revision.content,
            ArtifactContentV1::Spreadsheet(_)
        ));
        assert_eq!(stored_spreadsheet.revision.content_schema_version, 1);
        let mut foreign_profile = handle.clone();
        foreign_profile.profile_id = ProfileId::new(Uuid::now_v7().to_string());
        assert_eq!(
            foreign_profile
                .read_artifact(stored_spreadsheet.artifact.artifact_id, None)
                .unwrap_err(),
            DomainError::NotFound
        );
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn durable_artifact_revisions_are_profile_scoped_atomic_idempotent_and_restart_safe() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
        let create_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.create",
            AgentToolEffect::WorkspaceWrite,
            20,
        );
        let content_v1 = artifact_content("revision one");
        let (json_v1, digest_v1) = canonical_artifact(&content_v1);
        let request_v1 = format!("{:x}", Sha256::digest(b"create-request-v1"));
        let create_request = CreateArtifactRecord {
            artifact_type: ArtifactType::Document,
            title: Some("Fixture".into()),
            project_field_id: Some(project.field_id.clone()),
            conversation_id: conversation.id.clone(),
            run_id: run.id.clone(),
            tool_call_id: create_tool.id.clone(),
            content: content_v1.clone(),
            canonical_content_json: json_v1.clone(),
            semantic_sha256: digest_v1.clone(),
            mutation_request_sha256: request_v1.clone(),
            now: 22,
        };
        let created = handle.create_artifact(create_request.clone()).unwrap();
        assert_eq!(created.revision.sequence, 1);
        assert_eq!(created.revision.content, content_v1);
        assert_eq!(created.artifact.profile_id, handle.profile_id);
        assert_eq!(
            created.artifact.project_field_id,
            Some(project.field_id.clone())
        );
        assert_eq!(
            handle.create_artifact(create_request.clone()).unwrap(),
            created
        );

        let content_changed = artifact_content("same ToolCall, different request");
        let (changed_json, changed_digest) = canonical_artifact(&content_changed);
        let changed = handle.create_artifact(CreateArtifactRecord {
            content: content_changed,
            canonical_content_json: changed_json,
            semantic_sha256: changed_digest,
            mutation_request_sha256: format!("{:x}", Sha256::digest(b"different")),
            ..create_request
        });
        assert_eq!(
            changed.unwrap_err(),
            DomainError::Validation("ARTIFACT_TOOLCALL_IDEMPOTENCY_CONFLICT".into())
        );

        let verification = VerificationReceiptView {
            id: VerificationReceiptId::new(Uuid::now_v7().to_string()),
            run_id: run.id.clone(),
            tool_call_id: Some(create_tool.id.clone()),
            check_kind: "ARTIFACT_FIXTURE".into(),
            outcome: VerificationOutcome::Pass,
            summary: "Verified exact revision one".into(),
            artifact_sha256: None,
            subject: Some(VerificationSubject::ArtifactRevision {
                artifact_id: created.artifact.artifact_id.clone(),
                revision_id: created.revision.revision_id.clone(),
                semantic_sha256: created.revision.semantic_sha256.clone(),
            }),
            exit_code: None,
            created_at: 23,
        };
        handle
            .record_agent_verification(verification.clone())
            .unwrap();

        let update_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.update",
            AgentToolEffect::WorkspaceWrite,
            24,
        );
        let content_v2 = artifact_content("revision two");
        let (json_v2, digest_v2) = canonical_artifact(&content_v2);
        let update_request = UpdateArtifactRecord {
            artifact_id: created.artifact.artifact_id.clone(),
            expected_revision_id: created.revision.revision_id.clone(),
            conversation_id: conversation.id.clone(),
            run_id: run.id.clone(),
            tool_call_id: update_tool.id.clone(),
            content: content_v2.clone(),
            canonical_content_json: json_v2,
            semantic_sha256: digest_v2,
            mutation_request_sha256: format!("{:x}", Sha256::digest(b"update-request-v2")),
            now: 26,
        };
        let updated = handle.update_artifact(update_request.clone()).unwrap();
        assert_eq!(updated.revision.sequence, 2);
        assert_eq!(
            updated.revision.parent_revision_id,
            Some(created.revision.revision_id.clone())
        );
        assert_eq!(handle.update_artifact(update_request).unwrap(), updated);
        assert_eq!(
            handle
                .read_artifact(
                    created.artifact.artifact_id.clone(),
                    Some(created.revision.revision_id.clone()),
                )
                .unwrap()
                .revision
                .content,
            content_v1
        );

        let stale_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.update",
            AgentToolEffect::WorkspaceWrite,
            27,
        );
        let stale_content = artifact_content("stale concurrent update");
        let (stale_json, stale_digest) = canonical_artifact(&stale_content);
        let stale = handle.update_artifact(UpdateArtifactRecord {
            artifact_id: created.artifact.artifact_id.clone(),
            expected_revision_id: created.revision.revision_id.clone(),
            conversation_id: conversation.id.clone(),
            run_id: run.id.clone(),
            tool_call_id: stale_tool.id,
            content: stale_content,
            canonical_content_json: stale_json,
            semantic_sha256: stale_digest,
            mutation_request_sha256: format!("{:x}", Sha256::digest(b"stale")),
            now: 29,
        });
        assert_eq!(stale.unwrap_err(), DomainError::RevisionConflict);

        let listed = handle.list_agent_verifications(run.id.clone()).unwrap();
        assert_eq!(listed, vec![verification]);
        assert_ne!(
            updated.artifact.current_revision_id,
            match listed[0].subject.as_ref().unwrap() {
                VerificationSubject::ArtifactRevision { revision_id, .. } => revision_id.clone(),
            }
        );

        let mut foreign_profile = handle.clone();
        foreign_profile.profile_id = ProfileId::new(Uuid::now_v7().to_string());
        assert_eq!(
            foreign_profile
                .read_artifact(created.artifact.artifact_id.clone(), None)
                .unwrap_err(),
            DomainError::NotFound
        );

        let direct = open_connection(&handle.database_path).unwrap();
        assert!(
            direct
                .execute(
                    "UPDATE artifact_revisions SET semantic_sha256=?1 WHERE id=?2",
                    params![
                        format!("{:x}", Sha256::digest(b"tamper")),
                        created.revision.revision_id.0
                    ],
                )
                .is_err()
        );
        drop(direct);

        let failure_tool = artifact_tool(
            &handle,
            run.id.clone(),
            "artifact.update",
            AgentToolEffect::WorkspaceWrite,
            30,
        );
        request_task(&handle.sender, |connection| {
            connection.execute_batch(
                "CREATE TRIGGER artifact_pointer_test_failure BEFORE UPDATE OF current_revision_id ON artifacts BEGIN SELECT RAISE(ABORT, 'TEST_POINTER_FAILURE'); END;"
            ).map_err(storage_domain)?;
            Ok(())
        }).unwrap();
        let failed_content = artifact_content("transaction must roll back");
        let (failed_json, failed_digest) = canonical_artifact(&failed_content);
        assert!(
            handle
                .update_artifact(UpdateArtifactRecord {
                    artifact_id: created.artifact.artifact_id.clone(),
                    expected_revision_id: updated.revision.revision_id.clone(),
                    conversation_id: conversation.id,
                    run_id: run.id.clone(),
                    tool_call_id: failure_tool.id,
                    content: failed_content,
                    canonical_content_json: failed_json,
                    semantic_sha256: failed_digest,
                    mutation_request_sha256: format!("{:x}", Sha256::digest(b"rollback")),
                    now: 32,
                })
                .is_err()
        );
        let (current_after_failure, revision_count): (String, i64) =
            request_task(&handle.sender, {
                let artifact_id = created.artifact.artifact_id.clone();
                move |connection| {
                    let current = connection
                        .query_row(
                            "SELECT current_revision_id FROM artifacts WHERE id=?1",
                            [&artifact_id.0],
                            |row| row.get(0),
                        )
                        .map_err(storage_domain)?;
                    let count = connection
                        .query_row(
                            "SELECT COUNT(*) FROM artifact_revisions WHERE artifact_id=?1",
                            [&artifact_id.0],
                            |row| row.get(0),
                        )
                        .map_err(storage_domain)?;
                    Ok((current, count))
                }
            })
            .unwrap();
        assert_eq!(current_after_failure, updated.revision.revision_id.0);
        assert_eq!(revision_count, 2);
        request_task(&handle.sender, |connection| {
            connection
                .execute_batch("DROP TRIGGER artifact_pointer_test_failure;")
                .map_err(storage_domain)?;
            Ok(())
        })
        .unwrap();

        let artifact_id = created.artifact.artifact_id;
        let revision_id = updated.revision.revision_id;
        drop(worker);
        let reopened = start(&root, 40);
        let reopened_handle = reopened.handle();
        let persisted = reopened_handle
            .read_artifact(artifact_id.clone(), None)
            .unwrap();
        assert_eq!(persisted.artifact.artifact_id, artifact_id);
        assert_eq!(persisted.revision.revision_id, revision_id);
        assert_eq!(persisted.revision.content, content_v2);
        assert!(
            reopened_handle
                .artifact_mutation_by_tool_call(update_tool.id)
                .unwrap()
                .is_some()
        );
        let database_path = reopened_handle.database_path.clone();
        drop(reopened);
        let portable = root.join("durable-artifact-portable.db");
        create_portable_snapshot(&database_path, &portable).unwrap();
        let portable_connection = open_connection(&portable).unwrap();
        let portable_identity: (String, String) = portable_connection
            .query_row(
                "SELECT a.id,r.id FROM artifacts a JOIN artifact_revisions r ON r.id=a.current_revision_id WHERE a.id=?1",
                [&artifact_id.0],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(portable_identity, (artifact_id.0, revision_id.0));
        drop(portable_connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_conversation_and_messages_survive_reopen() {
        let root = temporary_root();
        let (field_id, conversation_id) = {
            let worker = start(&root, 1);
            let handle = worker.handle();
            let project = handle
                .create_project(
                    CreateProjectRequest {
                        title: "Desktop Foundation".into(),
                        goal: Some("Persist a coding loop".into()),
                        root_path: r"C:\work\desktop-foundation".into(),
                    },
                    2,
                )
                .unwrap();
            let conversation = handle
                .create_conversation(
                    CreateConversationRequest {
                        field_id: project.field_id.clone(),
                        title: "Implement the loop".into(),
                        provider_config_id: None,
                        model_id: None,
                    },
                    3,
                )
                .unwrap();
            handle
                .create_conversation_message(
                    CreateConversationMessageRequest {
                        conversation_id: conversation.id.clone(),
                        role: ConversationMessageRole::User,
                        content: "Inspect the project".into(),
                        status: ConversationMessageStatus::Completed,
                        provider_config_id: None,
                        model_id: None,
                        invocation_id: None,
                        references: vec![],
                    },
                    4,
                )
                .unwrap();
            (project.field_id, conversation.id)
        };
        {
            let worker = start(&root, 5);
            let handle = worker.handle();
            let project = handle.get_project(field_id).unwrap();
            assert_eq!(project.root_path, r"C:\work\desktop-foundation");
            let conversations = handle.list_conversations(project.field_id).unwrap();
            assert_eq!(conversations.len(), 1);
            let messages = handle.list_conversation_messages(conversation_id).unwrap();
            assert_eq!(messages.len(), 1);
            assert_eq!(messages[0].content, "Inspect the project");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rich_result_references_round_trip_reopen_and_reject_unsafe_targets() {
        let root = temporary_root();
        let conversation_id = {
            let worker = start(&root, 1);
            let handle = worker.handle();
            let (project, conversation, run) = artifact_run_fixture(&handle, &root, 10);
            fs::create_dir_all(root.join("workspace/src")).unwrap();
            fs::write(
                root.join("workspace/src/lib.rs"),
                (1..=30)
                    .map(|line| format!("line {line}\n"))
                    .collect::<String>(),
            )
            .unwrap();
            let digest = "a".repeat(64);
            let tool = handle
                .create_agent_tool_call(
                    run.id.clone(),
                    "read_file".into(),
                    AgentToolEffect::Observe,
                    AgentPolicyDecision::Allow,
                    json!({"path":"src/lib.rs","line_start":10,"line_end":20}),
                    20,
                )
                .unwrap();
            handle
                .update_agent_tool_call(tool.id.clone(), AgentToolStatus::Running, None, None, 21)
                .unwrap();
            handle
                .update_agent_tool_call(
                    tool.id.clone(),
                    AgentToolStatus::Completed,
                    Some(json!({"kind":"FILE_READ","path":"src/lib.rs","sha256":digest,"line_start":10,"line_end":20})),
                    None,
                    22,
                )
                .unwrap();
            let reality = RealityService::new(
                handle.clone(),
                handle.local_user.clone(),
                handle.device_id.clone(),
            );
            let (saved, _) = reality
                .create_reference(
                    CreateReferenceRequest {
                        field_id: project.field_id.clone(),
                        title: "Architecture".into(),
                        url: "https://example.com/architecture".into(),
                    },
                    TraceId::new(Uuid::now_v7().to_string()),
                    23,
                )
                .unwrap();
            let image_hash = "b".repeat(64);
            let image = handle
                .create_library_file(
                    CreateLibraryFileRequest {
                        title: "Layout clipping.png".into(),
                        original_source: root
                            .join("layout-clipping.png")
                            .to_string_lossy()
                            .into_owned(),
                        original_filename: "layout-clipping.png".into(),
                        mime_type: Some("image/png".into()),
                        media_kind: LibraryMediaKind::Image,
                        size: 128,
                        blob_ref: format!("blobs/objects/bb/{image_hash}"),
                        content_hash: image_hash.clone(),
                        metadata: json!({"version":1}),
                    },
                    23,
                )
                .unwrap();
            let file_id = ResultReferenceId::new(format!("resultref_{}", "1".repeat(32)));
            let range_id = ResultReferenceId::new(format!("resultref_{}", "2".repeat(32)));
            let web_id = ResultReferenceId::new(format!("resultref_{}", "3".repeat(32)));
            let image_id = ResultReferenceId::new(format!("resultref_{}", "9".repeat(32)));
            let markdown = format!(
                "## 实现位置\n\n[lib.rs](fielora-reference:{file_id})\n\n[lib.rs · L10–L20](fielora-reference:{range_id})\n\n右侧菜单在窄布局中发生裁切：\n\n![布局裁切截图](fielora-reference:{image_id})\n\n问题位于 overlay positioning。\n\n## 参考资料\n\n[Architecture](fielora-reference:{web_id})"
            );
            let references = vec![
                ResultReference {
                    id: file_id,
                    label: "lib.rs".into(),
                    target: ResultReferenceTarget::ProjectFile {
                        field_id: project.field_id.clone(),
                        relative_path: "src/lib.rs".into(),
                        expected_sha256: None,
                    },
                    provenance: ResultReferenceProvenance::ProjectContext,
                },
                ResultReference {
                    id: range_id,
                    label: "lib.rs · L10–L20".into(),
                    target: ResultReferenceTarget::CodeRange {
                        field_id: project.field_id.clone(),
                        relative_path: "src/lib.rs".into(),
                        line_start: 10,
                        line_end: 20,
                        expected_sha256: Some("a".repeat(64)),
                    },
                    provenance: ResultReferenceProvenance::ToolReceipt {
                        tool_call_id: tool.id.clone(),
                    },
                },
                ResultReference {
                    id: web_id,
                    label: "Architecture".into(),
                    target: ResultReferenceTarget::WebReference {
                        field_id: project.field_id.clone(),
                        reference_id: saved.resource.id.clone(),
                        https_url: saved.resource.canonical_url.clone(),
                    },
                    provenance: ResultReferenceProvenance::SavedReference {
                        reference_id: saved.resource.id.clone(),
                    },
                },
                ResultReference {
                    id: image_id,
                    label: "布局裁切截图".into(),
                    target: ResultReferenceTarget::Image {
                        source: ResultImageSource::Library,
                        library_object_id: Some(image.id.clone()),
                        screenshot_evidence_id: None,
                        expected_sha256: image_hash.clone(),
                        mime_type: "image/png".into(),
                    },
                    provenance: ResultReferenceProvenance::LibraryObject {
                        library_object_id: image.id.clone(),
                    },
                },
            ];
            let message = handle
                .create_conversation_message(
                    CreateConversationMessageRequest {
                        conversation_id: conversation.id.clone(),
                        role: ConversationMessageRole::Assistant,
                        content: markdown.clone(),
                        status: ConversationMessageStatus::Completed,
                        provider_config_id: Some(run.provider_config_id.clone()),
                        model_id: Some(run.model_id.clone()),
                        invocation_id: Some(ModelInvocationId::new(run.id.0.clone())),
                        references: references.clone(),
                    },
                    24,
                )
                .unwrap();
            assert_eq!(message.references, references);

            for (object_id, mime_type, provenance_id) in [
                (
                    LibraryObjectId::new(Uuid::now_v7().to_string()),
                    "image/png",
                    image.id.clone(),
                ),
                (image.id.clone(), "image/svg+xml", image.id.clone()),
                (
                    image.id.clone(),
                    "image/png",
                    LibraryObjectId::new(Uuid::now_v7().to_string()),
                ),
            ] {
                let invalid_id =
                    ResultReferenceId::new(format!("resultref_{}", Uuid::now_v7().simple()));
                assert!(
                    handle
                        .create_conversation_message(
                            CreateConversationMessageRequest {
                                conversation_id: conversation.id.clone(),
                                role: ConversationMessageRole::Assistant,
                                content: format!("![unsafe image](fielora-reference:{invalid_id})"),
                                status: ConversationMessageStatus::Completed,
                                provider_config_id: None,
                                model_id: None,
                                invocation_id: None,
                                references: vec![ResultReference {
                                    id: invalid_id,
                                    label: "unsafe image".into(),
                                    target: ResultReferenceTarget::Image {
                                        source: ResultImageSource::Library,
                                        library_object_id: Some(object_id),
                                        screenshot_evidence_id: None,
                                        expected_sha256: image_hash.clone(),
                                        mime_type: mime_type.into(),
                                    },
                                    provenance: ResultReferenceProvenance::LibraryObject {
                                        library_object_id: provenance_id
                                    },
                                }],
                            },
                            24,
                        )
                        .is_err()
                );
            }
            let non_terminal_id = ResultReferenceId::new(format!("resultref_{}", "d".repeat(32)));
            assert!(
                handle
                    .create_conversation_message(
                        CreateConversationMessageRequest {
                            conversation_id: conversation.id.clone(),
                            role: ConversationMessageRole::Assistant,
                            content: format!("![layout](fielora-reference:{non_terminal_id})"),
                            status: ConversationMessageStatus::Failed,
                            provider_config_id: None,
                            model_id: None,
                            invocation_id: None,
                            references: vec![ResultReference {
                                id: non_terminal_id,
                                label: "layout".into(),
                                target: ResultReferenceTarget::Image {
                                    source: ResultImageSource::Library,
                                    library_object_id: Some(image.id.clone()),
                                    screenshot_evidence_id: None,
                                    expected_sha256: image_hash.clone(),
                                    mime_type: "image/png".into(),
                                },
                                provenance: ResultReferenceProvenance::LibraryObject {
                                    library_object_id: image.id.clone()
                                },
                            }],
                        },
                        24,
                    )
                    .is_err()
            );

            for invalid_path in ["../outside.rs", r"C:\Windows\secret.rs", "/etc/passwd"] {
                let invalid_id = ResultReferenceId::new(format!("resultref_{}", "4".repeat(32)));
                let error = handle
                    .create_conversation_message(
                        CreateConversationMessageRequest {
                            conversation_id: conversation.id.clone(),
                            role: ConversationMessageRole::Assistant,
                            content: format!("[unsafe](fielora-reference:{invalid_id})"),
                            status: ConversationMessageStatus::Completed,
                            provider_config_id: None,
                            model_id: None,
                            invocation_id: None,
                            references: vec![ResultReference {
                                id: invalid_id,
                                label: "unsafe".into(),
                                target: ResultReferenceTarget::ProjectFile {
                                    field_id: project.field_id.clone(),
                                    relative_path: invalid_path.into(),
                                    expected_sha256: None,
                                },
                                provenance: ResultReferenceProvenance::ProjectContext,
                            }],
                        },
                        25,
                    )
                    .unwrap_err();
                assert!(matches!(error, DomainError::Validation(_)));
            }
            let other_project = handle
                .create_project(
                    CreateProjectRequest {
                        title: "Other Project".into(),
                        goal: None,
                        root_path: root.join("other-workspace").to_string_lossy().into_owned(),
                    },
                    26,
                )
                .unwrap();
            let cross_id = ResultReferenceId::new(format!("resultref_{}", "6".repeat(32)));
            assert!(matches!(
                handle.create_conversation_message(
                    CreateConversationMessageRequest {
                        conversation_id: conversation.id.clone(),
                        role: ConversationMessageRole::Assistant,
                        content: format!("[cross](fielora-reference:{cross_id})"),
                        status: ConversationMessageStatus::Completed,
                        provider_config_id: None,
                        model_id: None,
                        invocation_id: None,
                        references: vec![ResultReference {
                            id: cross_id,
                            label: "cross".into(),
                            target: ResultReferenceTarget::ProjectFile {
                                field_id: other_project.field_id,
                                relative_path: "src/lib.rs".into(),
                                expected_sha256: None,
                            },
                            provenance: ResultReferenceProvenance::ProjectContext,
                        }],
                    },
                    27,
                ),
                Err(DomainError::Validation(_))
            ));
            for unsafe_url in [
                "http://example.com/architecture",
                "file:///C:/Windows/secret",
                "javascript:alert(1)",
                "fielora://app",
            ] {
                let invalid_id = ResultReferenceId::new(format!("resultref_{}", "8".repeat(32)));
                assert!(
                    handle
                        .create_conversation_message(
                            CreateConversationMessageRequest {
                                conversation_id: conversation.id.clone(),
                                role: ConversationMessageRole::Assistant,
                                content: format!("[web](fielora-reference:{invalid_id})"),
                                status: ConversationMessageStatus::Completed,
                                provider_config_id: None,
                                model_id: None,
                                invocation_id: None,
                                references: vec![ResultReference {
                                    id: invalid_id,
                                    label: "web".into(),
                                    target: ResultReferenceTarget::WebReference {
                                        field_id: project.field_id.clone(),
                                        reference_id: saved.resource.id.clone(),
                                        https_url: unsafe_url.into(),
                                    },
                                    provenance: ResultReferenceProvenance::SavedReference {
                                        reference_id: saved.resource.id.clone(),
                                    },
                                }],
                            },
                            28,
                        )
                        .is_err(),
                    "unsafe Web reference unexpectedly accepted: {unsafe_url}"
                );
            }
            for (line_start, line_end) in [(0, 20), (20, 10), (1, 1_000_001)] {
                let invalid_id = ResultReferenceId::new(format!("resultref_{}", "7".repeat(32)));
                assert!(matches!(
                    handle.create_conversation_message(
                        CreateConversationMessageRequest {
                            conversation_id: conversation.id.clone(),
                            role: ConversationMessageRole::Assistant,
                            content: format!("[range](fielora-reference:{invalid_id})"),
                            status: ConversationMessageStatus::Completed,
                            provider_config_id: None,
                            model_id: None,
                            invocation_id: None,
                            references: vec![ResultReference {
                                id: invalid_id,
                                label: "range".into(),
                                target: ResultReferenceTarget::CodeRange {
                                    field_id: project.field_id.clone(),
                                    relative_path: "src/lib.rs".into(),
                                    line_start,
                                    line_end,
                                    expected_sha256: Some("a".repeat(64)),
                                },
                                provenance: ResultReferenceProvenance::ToolReceipt {
                                    tool_call_id: tool.id.clone(),
                                },
                            }],
                        },
                        28,
                    ),
                    Err(DomainError::Validation(_))
                ));
            }
            let plain = handle
                .create_conversation_message(
                    CreateConversationMessageRequest {
                        conversation_id: conversation.id.clone(),
                        role: ConversationMessageRole::Assistant,
                        content: "[Important](file:///C:/Windows/System32/config) src/app.ts:20 [fake](fielora-reference:resultref_55555555555555555555555555555555)".into(),
                        status: ConversationMessageStatus::Completed,
                        provider_config_id: None,
                        model_id: None,
                        invocation_id: None,
                        references: vec![],
                    },
                    29,
                )
                .unwrap();
            assert!(plain.references.is_empty());
            let deleted = handle
                .delete_library_object(
                    DeleteLibraryObjectRequest {
                        library_object_id: image.id,
                        expected_revision: image.revision,
                    },
                    30,
                )
                .unwrap();
            assert_eq!(deleted.lifecycle, LibraryLifecycle::Tombstone);
            conversation.id
        };
        {
            let worker = start(&root, 30);
            let messages = worker
                .handle()
                .list_conversation_messages(conversation_id)
                .unwrap();
            let rich = messages
                .iter()
                .find(|message| message.references.len() == 4)
                .unwrap();
            assert!(rich.content.starts_with("## 实现位置"));
            assert_eq!(
                rich.references
                    .iter()
                    .map(|reference| &reference.target)
                    .collect::<Vec<_>>()
                    .len(),
                4
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_and_oversized_reference_sidecars_fail_soft_per_message() {
        let root = temporary_root();
        let (conversation_id, malformed_id, oversized_id) = {
            let worker = start(&root, 1);
            let handle = worker.handle();
            let project = handle
                .create_project(
                    CreateProjectRequest {
                        title: "Sidecar recovery".into(),
                        goal: None,
                        root_path: root.join("workspace").to_string_lossy().into_owned(),
                    },
                    2,
                )
                .unwrap();
            let conversation = handle
                .create_conversation(
                    CreateConversationRequest {
                        field_id: project.field_id.clone(),
                        title: "Reference recovery".into(),
                        provider_config_id: None,
                        model_id: None,
                    },
                    3,
                )
                .unwrap();
            let create_plain = |content: &str, now| {
                handle
                    .create_conversation_message(
                        CreateConversationMessageRequest {
                            conversation_id: conversation.id.clone(),
                            role: ConversationMessageRole::Assistant,
                            content: content.into(),
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
            let malformed = create_plain("Malformed sidecar message", 4);
            let oversized = create_plain("Oversized sidecar message", 5);
            create_plain("Unaffected message", 6);

            let long_path = format!("{}.rs", "a".repeat(16_376));
            let references = (1..=64)
                .map(|index| ResultReference {
                    id: ResultReferenceId::new(format!("resultref_{index:032x}")),
                    label: "large".into(),
                    target: ResultReferenceTarget::ProjectFile {
                        field_id: project.field_id.clone(),
                        relative_path: long_path.clone(),
                        expected_sha256: None,
                    },
                    provenance: ResultReferenceProvenance::ProjectContext,
                })
                .collect::<Vec<_>>();
            let content = references
                .iter()
                .map(|reference| format!("[large](fielora-reference:{})", reference.id.0))
                .collect::<Vec<_>>()
                .join("\n");
            assert!(matches!(
                handle.create_conversation_message(
                    CreateConversationMessageRequest {
                        conversation_id: conversation.id.clone(),
                        role: ConversationMessageRole::Assistant,
                        content,
                        status: ConversationMessageStatus::Completed,
                        provider_config_id: None,
                        model_id: None,
                        invocation_id: None,
                        references,
                    },
                    7,
                ),
                Err(DomainError::Validation(message)) if message == "RESULT_REFERENCE_SIDECAR_TOO_LARGE"
            ));
            (conversation.id, malformed.id, oversized.id)
        };

        let database = PlatformPaths::from_root(root.clone()).unwrap().database;
        let connection = open_connection(&database).unwrap();
        connection
            .execute_batch("PRAGMA ignore_check_constraints = ON;")
            .unwrap();
        connection
            .execute(
                "UPDATE conversation_messages SET references_json=?1 WHERE id=?2",
                params!["{not-json", malformed_id.0],
            )
            .unwrap();
        let oversized_json = format!("[\"{}\"]", "x".repeat(1_048_576));
        connection
            .execute(
                "UPDATE conversation_messages SET references_json=?1 WHERE id=?2",
                params![oversized_json, oversized_id.0],
            )
            .unwrap();
        drop(connection);

        let worker = start(&root, 8);
        let messages = worker
            .handle()
            .list_conversation_messages(conversation_id)
            .unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(
            messages
                .iter()
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>(),
            [
                "Malformed sidecar message",
                "Oversized sidecar message",
                "Unaffected message"
            ]
        );
        assert!(messages.iter().all(|message| message.references.is_empty()));
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_title_update_is_revision_guarded_and_preserves_root() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let project = handle
            .create_project(
                CreateProjectRequest {
                    title: "Before".into(),
                    goal: None,
                    root_path: r"C:\work\rename-project".into(),
                },
                2,
            )
            .unwrap();
        let updated = handle
            .update_project(
                UpdateProjectRequest {
                    field_id: project.field_id.clone(),
                    expected_revision: project.revision,
                    title: "After".into(),
                },
                3,
            )
            .unwrap();
        assert_eq!(updated.title, "After");
        assert_eq!(updated.root_path, r"C:\work\rename-project");
        assert_eq!(updated.revision, project.revision + 1);
        let stale = handle.update_project(
            UpdateProjectRequest {
                field_id: project.field_id,
                expected_revision: project.revision,
                title: "Stale".into(),
            },
            4,
        );
        assert!(matches!(stale, Err(DomainError::RevisionConflict)));
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_archive_hides_metadata_and_preserves_local_folder() {
        let root = temporary_root();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("keep.txt"), "keep me").unwrap();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let project = handle
            .create_project(
                CreateProjectRequest {
                    title: "Remove from Fielora".into(),
                    goal: None,
                    root_path: workspace.to_string_lossy().into_owned(),
                },
                2,
            )
            .unwrap();
        let stale = handle.archive_project(
            ArchiveProjectRequest {
                field_id: project.field_id.clone(),
                expected_revision: project.revision + 1,
            },
            3,
        );
        assert!(matches!(stale, Err(DomainError::RevisionConflict)));
        let archived = handle
            .archive_project(
                ArchiveProjectRequest {
                    field_id: project.field_id.clone(),
                    expected_revision: project.revision,
                },
                4,
            )
            .unwrap();
        assert_eq!(archived.revision, project.revision + 1);
        assert!(handle.list_projects().unwrap().is_empty());
        assert!(matches!(
            handle.get_project(project.field_id),
            Err(DomainError::NotFound)
        ));
        assert_eq!(
            fs::read_to_string(workspace.join("keep.txt")).unwrap(),
            "keep me"
        );
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn incompatible_legacy_rows_roll_back_migration_0002() {
        let root = temporary_root();
        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let mut connection = open_connection(&paths.database).unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);").unwrap();
        connection.execute_batch(MIGRATION_0001).unwrap();
        connection
            .execute(
                "INSERT INTO schema_migrations VALUES(1,?1,?2,1)",
                params![MIGRATION_0001_NAME, migration_checksum(MIGRATION_0001)],
            )
            .unwrap();
        // This fixture intentionally remains at schema 1. Production bootstrap
        // runs only after all migrations and now writes the profile introduced
        // by migration 0007, so seed only the schema-1 principal required by
        // the incompatible legacy object.
        let transaction = connection.transaction().unwrap();
        let user = ensure_principal(&transaction, "LOCAL_USER", LOCAL_USER_NAME, 1).unwrap();
        transaction.commit().unwrap();
        let field = Uuid::now_v7().to_string();
        let object = Uuid::now_v7().to_string();
        connection.execute("INSERT INTO fields(id,owner_principal_id,title,lifecycle_status,revision,created_at,updated_at) VALUES(?1,?2,'legacy','ACTIVE',1,1,1)",params![field,user.0]).unwrap();
        connection.execute("INSERT INTO field_objects(id,field_id,owner_principal_id,object_kind,title,external_ref_type,external_ref_id,metadata_json,created_at,updated_at) VALUES(?1,?2,?3,'LEGACY','legacy',NULL,NULL,'{}',1,1)",params![object,field,user.0]).unwrap();
        assert!(matches!(
            apply_migrations(&mut connection, 2),
            Err(StorageError::MigrationIncompatibleData)
        ));
        let version2: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let transient: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE '%_v2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let phase02_columns: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('field_objects') WHERE name IN ('created_by','source_activity_id','lifecycle_status','revision')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let legacy_kind: String = connection
            .query_row(
                "SELECT object_kind FROM field_objects WHERE id=?1",
                [object],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((version2, transient, phase02_columns), (0, 0, 0));
        assert_eq!(legacy_kind, "LEGACY");
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn phase02_reality_is_atomic_and_resume_is_authoritative() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let fields = FieldService::new(handle.clone(), handle.local_user.clone());
        let reality = RealityService::new(
            handle.clone(),
            handle.local_user.clone(),
            handle.device_id.clone(),
        );
        let surfaces = SurfaceService::new(handle.clone(), handle.device_id.clone());
        let trace = || TraceId::new(Uuid::now_v7().to_string());
        let (field, _) = fields.create("Reality".into(), None, trace(), 2).unwrap();
        let (task, _) = reality
            .create_state(
                CreateStateRequest {
                    field_id: field.id.clone(),
                    kind: FieldStateKind::Task,
                    content: " Ship ".into(),
                    confidence: Some(0.8),
                },
                trace(),
                3,
            )
            .unwrap();
        assert_eq!(
            (task.resource.content.as_str(), task.field_revision),
            ("Ship", 2)
        );
        let (resolved, _) = reality
            .transition_state(
                TransitionStateRequest {
                    field_id: field.id.clone(),
                    state_id: task.resource.id.clone(),
                    expected_state_revision: 1,
                    target: StateTransitionTarget::Resolved,
                },
                trace(),
                4,
            )
            .unwrap();
        assert_eq!(
            (resolved.resource.status, resolved.field_revision),
            (StateStatus::Resolved, 3)
        );
        let (reopened, _) = reality
            .transition_state(
                TransitionStateRequest {
                    field_id: field.id.clone(),
                    state_id: task.resource.id.clone(),
                    expected_state_revision: 2,
                    target: StateTransitionTarget::Active,
                },
                trace(),
                5,
            )
            .unwrap();
        let (revised, _) = reality
            .revise_state(
                ReviseStateRequest {
                    field_id: field.id.clone(),
                    state_id: task.resource.id.clone(),
                    expected_state_revision: 3,
                    content: "Ship verified".into(),
                    confidence: Some(1.0),
                },
                trace(),
                6,
            )
            .unwrap();
        assert_eq!((reopened.field_revision, revised.field_revision), (4, 5));
        let (focused, _) = fields
            .set_focus_v1(
                SetFieldFocusV1Request {
                    field_id: field.id.clone(),
                    expected_field_revision: 5,
                    focus: Some(FieldFocusV1::State {
                        state_id: task.resource.id.clone(),
                    }),
                },
                trace(),
                7,
            )
            .unwrap();
        assert_eq!(focused.revision, 6);
        let (superseded, _) = reality
            .supersede_state(
                SupersedeStateRequest {
                    field_id: field.id.clone(),
                    state_id: task.resource.id.clone(),
                    expected_state_revision: 4,
                    replacement_content: "Ship accepted".into(),
                    replacement_confidence: Some(1.0),
                },
                trace(),
                8,
            )
            .unwrap();
        assert_eq!(superseded.field_revision, 7);
        assert_eq!(superseded.previous.status, StateStatus::Superseded);
        assert_eq!(
            fields.get(&field.id).unwrap().current_focus,
            Some(
                serde_json::to_value(FieldFocusV1::State {
                    state_id: superseded.replacement.id.clone()
                })
                .unwrap()
            )
        );
        let (reference, _) = reality
            .create_reference(
                CreateReferenceRequest {
                    field_id: field.id.clone(),
                    title: " Source ".into(),
                    url: "HTTPS://Example.COM:443/path?q=secret".into(),
                },
                trace(),
                9,
            )
            .unwrap();
        assert_eq!(
            (
                reference.resource.canonical_url.as_str(),
                reference.field_revision
            ),
            ("https://example.com/path?q=secret", 8)
        );
        let (relation, _) = reality
            .attach_reference_source(
                AttachReferenceSourceRequest {
                    field_id: field.id.clone(),
                    state_id: superseded.replacement.id.clone(),
                    reference_id: reference.resource.id.clone(),
                },
                trace(),
                10,
            )
            .unwrap();
        assert_eq!(relation.field_revision, 9);
        let (focused, _) = fields
            .set_focus_v1(
                SetFieldFocusV1Request {
                    field_id: field.id.clone(),
                    expected_field_revision: 9,
                    focus: Some(FieldFocusV1::Reference {
                        object_id: reference.resource.id.clone(),
                    }),
                },
                trace(),
                11,
            )
            .unwrap();
        assert_eq!(focused.revision, 10);
        let layout = SurfaceLayoutV1 {
            version: 1,
            template: SurfaceTemplateV1::PrimarySupportRight,
            primary: SurfaceLayoutV1::default_task().primary,
            supporting: vec![SurfacePaneV1 {
                pane_id: PaneId::new(format!("pane_{}", Uuid::now_v7())),
                primitive: SurfacePrimitiveV1::ReferencePane,
                binding: PaneBindingV1::Reference {
                    object_id: reference.resource.id.clone(),
                },
                collapsed: false,
            }],
            focused_pane_id: PaneId::new("primary_task"),
        };
        assert_eq!(
            surfaces
                .save_v1(
                    SaveSurfaceSnapshotV1Request {
                        field_id: field.id.clone(),
                        layout
                    },
                    12
                )
                .unwrap()
                .observed_field_revision,
            10
        );
        let (archived, _) = reality
            .archive_reference(
                ArchiveReferenceRequest {
                    field_id: field.id.clone(),
                    object_id: reference.resource.id.clone(),
                    expected_object_revision: 1,
                },
                trace(),
                13,
            )
            .unwrap();
        assert_eq!(archived.field_revision, 11);
        let resume = reality.resume_v1(field.id.clone()).unwrap();
        assert_eq!(resume.snapshot_freshness, SnapshotFreshness::Stale);
        assert_eq!(
            resume.unavailable_reference_ids,
            vec![reference.resource.id.clone()]
        );
        assert_eq!(resume.focus_source, FocusSource::None);
        let relations = reality
            .list_relations(ListRelationsRequest {
                field_id: field.id.clone(),
                relation_type: None,
                lifecycle: Some(RelationLifecycle::Retracted),
                endpoint: None,
                cursor: None,
                limit: None,
            })
            .unwrap();
        assert_eq!(
            relations
                .items
                .iter()
                .find(|item| item.id == relation.resource.id)
                .unwrap()
                .lifecycle,
            RelationLifecycle::Retracted
        );
        let (restored, _) = reality
            .restore_reference(
                RestoreReferenceRequest {
                    field_id: field.id.clone(),
                    object_id: reference.resource.id.clone(),
                    expected_object_revision: 2,
                },
                trace(),
                14,
            )
            .unwrap();
        assert_eq!(restored.field_revision, 12);
        let activity_count = reality
            .list_activities(ListActivitiesRequest {
                field_id: field.id.clone(),
                cursor: None,
                limit: Some(100),
            })
            .unwrap()
            .items
            .len();
        let before = fields.get(&field.id).unwrap().revision;
        assert_eq!(
            reality
                .create_reference(
                    CreateReferenceRequest {
                        field_id: field.id.clone(),
                        title: "Duplicate".into(),
                        url: "https://example.com/path?q=secret".into()
                    },
                    trace(),
                    15
                )
                .unwrap_err(),
            DomainError::DuplicateActiveReference
        );
        assert_eq!(
            (
                fields.get(&field.id).unwrap().revision,
                reality
                    .list_activities(ListActivitiesRequest {
                        field_id: field.id.clone(),
                        cursor: None,
                        limit: Some(100)
                    })
                    .unwrap()
                    .items
                    .len()
            ),
            (before, activity_count)
        );
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn phase02_rejections_leave_reality_activity_and_revisions_unchanged() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let fields = FieldService::new(handle.clone(), handle.local_user.clone());
        let reality = RealityService::new(
            handle.clone(),
            handle.local_user.clone(),
            handle.device_id.clone(),
        );
        let trace = || TraceId::new(Uuid::now_v7().to_string());
        let (field, _) = fields.create("Rejects".into(), None, trace(), 2).unwrap();
        let (fact, _) = reality
            .create_state(
                CreateStateRequest {
                    field_id: field.id.clone(),
                    kind: FieldStateKind::Fact,
                    content: "Frozen fact".into(),
                    confidence: None,
                },
                trace(),
                3,
            )
            .unwrap();
        let activity_count = || {
            reality
                .list_activities(ListActivitiesRequest {
                    field_id: field.id.clone(),
                    cursor: None,
                    limit: Some(100),
                })
                .unwrap()
                .items
                .len()
        };
        assert_eq!(
            reality
                .transition_state(
                    TransitionStateRequest {
                        field_id: field.id.clone(),
                        state_id: fact.resource.id.clone(),
                        expected_state_revision: 1,
                        target: StateTransitionTarget::Resolved,
                    },
                    trace(),
                    4,
                )
                .unwrap_err(),
            DomainError::InvalidStateTransition
        );
        assert_eq!(
            (fields.get(&field.id).unwrap().revision, activity_count()),
            (2, 2)
        );
        let (retracted, _) = reality
            .transition_state(
                TransitionStateRequest {
                    field_id: field.id.clone(),
                    state_id: fact.resource.id.clone(),
                    expected_state_revision: 1,
                    target: StateTransitionTarget::Retracted,
                },
                trace(),
                5,
            )
            .unwrap();
        assert_eq!(retracted.field_revision, 3);
        assert_eq!(
            reality
                .revise_state(
                    ReviseStateRequest {
                        field_id: field.id.clone(),
                        state_id: fact.resource.id,
                        expected_state_revision: 2,
                        content: "Cannot revise".into(),
                        confidence: None,
                    },
                    trace(),
                    6,
                )
                .unwrap_err(),
            DomainError::TerminalResource
        );
        assert_eq!(
            (fields.get(&field.id).unwrap().revision, activity_count()),
            (3, 3)
        );
        assert_eq!(
            reality
                .create_reference(
                    CreateReferenceRequest {
                        field_id: field.id.clone(),
                        title: "Credential".into(),
                        url: "https://user:secret@example.com/".into(),
                    },
                    trace(),
                    7,
                )
                .unwrap_err(),
            DomainError::InvalidReferenceUrl
        );
        assert_eq!(
            (fields.get(&field.id).unwrap().revision, activity_count()),
            (3, 3)
        );
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn activity_keyset_pages_have_no_duplicates_or_omissions() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let fields = FieldService::new(handle.clone(), handle.local_user.clone());
        let reality = RealityService::new(
            handle.clone(),
            handle.local_user.clone(),
            handle.device_id.clone(),
        );
        let trace = || TraceId::new(Uuid::now_v7().to_string());
        let (field, _) = fields
            .create("Pagination".into(), None, trace(), 2)
            .unwrap();
        for index in 0..55 {
            reality
                .create_state(
                    CreateStateRequest {
                        field_id: field.id.clone(),
                        kind: FieldStateKind::Task,
                        content: format!("Task {index}"),
                        confidence: None,
                    },
                    trace(),
                    3,
                )
                .unwrap();
        }
        let mut cursor = None;
        let mut ids = Vec::new();
        loop {
            let page = reality
                .list_activities(ListActivitiesRequest {
                    field_id: field.id.clone(),
                    cursor,
                    limit: Some(20),
                })
                .unwrap();
            ids.extend(page.items.into_iter().map(|activity| activity.id.0));
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), 56);
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            56
        );
        drop(worker);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_tool_receipt_and_events_preserve_execution_source_across_reopen() {
        let root = temporary_root();
        fs::create_dir_all(root.join("workspace")).unwrap();
        let run_id = {
            let worker = start(&root, 1);
            let handle = worker.handle();
            let project = handle
                .create_project(
                    CreateProjectRequest {
                        title: "External provider receipt".into(),
                        goal: None,
                        root_path: root.join("workspace").to_string_lossy().into_owned(),
                    },
                    2,
                )
                .unwrap();
            let provider = handle
                .create_provider_config(
                    CreateProviderConfigRequest {
                        provider_kind: ProviderKind::Openai,
                        display_name: "Fixture".into(),
                        base_url: None,
                        default_model: "fixture-model".into(),
                        custom_endpoint_acknowledged: false,
                    },
                    3,
                )
                .unwrap();
            handle
                .set_provider_credential_present(provider.view.id.clone(), true, 4)
                .unwrap();
            let conversation = handle
                .create_conversation(
                    CreateConversationRequest {
                        field_id: project.field_id.clone(),
                        title: "Receipt persistence".into(),
                        provider_config_id: Some(provider.view.id.clone()),
                        model_id: Some("fixture-model".into()),
                    },
                    5,
                )
                .unwrap();
            let created = handle
                .create_agent_run(
                    StartAgentRunRequest {
                        resource_budget: None,
                        field_id: project.field_id,
                        conversation_id: conversation.id,
                        user_message_id: None,
                        provider_config_id: provider.view.id,
                        model_id: None,
                        task: "Persist external execution provenance".into(),
                        permission: AgentPermission::ReadOnly,
                        max_steps: Some(4),
                        attachments: None,
                        active_work_surface: None,
                    },
                    6,
                )
                .unwrap();
            handle
                .append_agent_event(
                    created.run.id.clone(),
                    AgentEventKind::RunStarted,
                    serde_json::json!({}),
                    AgentProjectionUpdate {
                        status: Some(AgentRunStatus::Running),
                        ..Default::default()
                    },
                    7,
                )
                .unwrap();
            let source = serde_json::json!({
                "capability_id":"fixture.external.lookup",
                "capability_version":"1.0.0",
                "source_kind":"EXTERNAL",
                "provider_id":"fixture.external",
                "provider_tool_name":"lookup",
            });
            let completed = handle
                .create_agent_tool_call(
                    created.run.id.clone(),
                    "fixture.external.lookup".into(),
                    AgentToolEffect::Observe,
                    AgentPolicyDecision::Allow,
                    serde_json::json!({"key":"alpha"}),
                    8,
                )
                .unwrap();
            handle
                .update_agent_tool_call(
                    completed.id.clone(),
                    AgentToolStatus::Running,
                    None,
                    None,
                    9,
                )
                .unwrap();
            handle
                .update_agent_tool_call(
                    completed.id.clone(),
                    AgentToolStatus::Completed,
                    Some(serde_json::json!({
                        "kind":"EXTERNAL_FIXTURE_LOOKUP",
                        "success":true,
                        "execution_source":source.clone(),
                    })),
                    None,
                    10,
                )
                .unwrap();
            handle
                .append_agent_event(
                    created.run.id.clone(),
                    AgentEventKind::ToolCompleted,
                    serde_json::json!({
                        "tool_call_id":completed.id,
                        "name":"fixture.external.lookup",
                        "execution_source":source.clone(),
                    }),
                    AgentProjectionUpdate::default(),
                    11,
                )
                .unwrap();
            let failed = handle
                .create_agent_tool_call(
                    created.run.id.clone(),
                    "fixture.external.lookup".into(),
                    AgentToolEffect::Observe,
                    AgentPolicyDecision::Allow,
                    serde_json::json!({"key":"fail"}),
                    12,
                )
                .unwrap();
            handle
                .update_agent_tool_call(failed.id.clone(), AgentToolStatus::Running, None, None, 13)
                .unwrap();
            handle
                .update_agent_tool_call(
                    failed.id.clone(),
                    AgentToolStatus::Failed,
                    Some(serde_json::json!({
                        "kind":"TOOL_EXECUTION_FAILED",
                        "execution_source":source.clone(),
                    })),
                    Some("AGENT_TOOL_PROVIDER_FAILED".into()),
                    14,
                )
                .unwrap();
            handle
                .append_agent_event(
                    created.run.id.clone(),
                    AgentEventKind::ToolFailed,
                    serde_json::json!({
                        "tool_call_id":failed.id,
                        "name":"fixture.external.lookup",
                        "error_code":"AGENT_TOOL_PROVIDER_FAILED",
                        "execution_source":source,
                    }),
                    AgentProjectionUpdate::default(),
                    15,
                )
                .unwrap();
            created.run.id
        };
        {
            let worker = start(&root, 16);
            let handle = worker.handle();
            let tools = handle.list_agent_tool_calls(run_id.clone()).unwrap();
            assert_eq!(tools.len(), 2);
            assert!(tools.iter().all(|tool| {
                tool.receipt.as_ref().unwrap()["execution_source"]["provider_id"]
                    == "fixture.external"
            }));
            assert!(tools.iter().any(|tool| {
                tool.status == AgentToolStatus::Completed
                    && tool.receipt.as_ref().unwrap()["execution_source"]["source_kind"]
                        == "EXTERNAL"
            }));
            assert!(tools.iter().any(|tool| {
                tool.status == AgentToolStatus::Failed
                    && tool.error_code.as_deref() == Some("AGENT_TOOL_PROVIDER_FAILED")
            }));
            let events = handle
                .list_agent_events(ListAgentEventsRequest {
                    run_id,
                    after_sequence: None,
                    limit: Some(200),
                })
                .unwrap();
            assert!(events.iter().any(|event| {
                event.kind == AgentEventKind::ToolCompleted
                    && event.payload["execution_source"]["provider_tool_name"] == "lookup"
            }));
            assert!(events.iter().any(|event| {
                event.kind == AgentEventKind::ToolFailed
                    && event.payload["execution_source"]["provider_tool_name"] == "lookup"
            }));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn agent_ledger_is_append_only_and_restart_reconciles_incomplete_tools() {
        let root = temporary_root();
        let (run_id, tool_id, waiting_run_id, pending_approval_id, paused_run_id) = {
            let worker = start(&root, 1);
            let handle = worker.handle();
            let project = handle
                .create_project(
                    CreateProjectRequest {
                        title: "Agent fixture".into(),
                        goal: None,
                        root_path: root.join("workspace").to_string_lossy().into_owned(),
                    },
                    2,
                )
                .unwrap();
            let provider = handle
                .create_provider_config(
                    CreateProviderConfigRequest {
                        provider_kind: ProviderKind::Openai,
                        display_name: "Fixture".into(),
                        base_url: None,
                        default_model: "fixture-model".into(),
                        custom_endpoint_acknowledged: false,
                    },
                    3,
                )
                .unwrap();
            handle
                .set_provider_credential_present(provider.view.id.clone(), true, 4)
                .unwrap();
            let conversation = handle
                .create_conversation(
                    CreateConversationRequest {
                        field_id: project.field_id.clone(),
                        title: "Agent run".into(),
                        provider_config_id: Some(provider.view.id.clone()),
                        model_id: Some("fixture-model".into()),
                    },
                    5,
                )
                .unwrap();
            let created = handle
                .create_agent_run(
                    StartAgentRunRequest {
                        resource_budget: None,
                        field_id: project.field_id.clone(),
                        conversation_id: conversation.id.clone(),
                        user_message_id: None,
                        provider_config_id: provider.view.id.clone(),
                        model_id: None,
                        task: "Fix the fixture".into(),
                        permission: AgentPermission::ReviewChanges,
                        max_steps: Some(8),
                        attachments: None,
                        active_work_surface: None,
                    },
                    6,
                )
                .unwrap();
            assert_eq!((created.event.sequence, created.run.next_sequence), (1, 2));
            let started = handle
                .append_agent_event(
                    created.run.id.clone(),
                    AgentEventKind::RunStarted,
                    serde_json::json!({}),
                    AgentProjectionUpdate {
                        status: Some(AgentRunStatus::Running),
                        ..Default::default()
                    },
                    7,
                )
                .unwrap();
            assert_eq!(started.event.sequence, 2);
            let tool = handle
                .create_agent_tool_call(
                    created.run.id.clone(),
                    "run_command".into(),
                    AgentToolEffect::Process,
                    AgentPolicyDecision::Ask,
                    serde_json::json!({"program":"cargo","argv":["test"]}),
                    8,
                )
                .unwrap();
            let approval = handle
                .create_agent_approval(created.run.id.clone(), tool.id.clone(), 9)
                .unwrap();
            handle
                .resolve_agent_approval(
                    ResolveAgentApprovalRequest {
                        run_id: created.run.id.clone(),
                        approval_id: approval.id.clone(),
                        nonce: approval.nonce.clone(),
                        decision: ApprovalDecision::AllowOnce,
                    },
                    10,
                )
                .unwrap();
            assert_eq!(
                handle
                    .resolve_agent_approval(
                        ResolveAgentApprovalRequest {
                            run_id: created.run.id.clone(),
                            approval_id: approval.id,
                            nonce: approval.nonce,
                            decision: ApprovalDecision::AllowOnce,
                        },
                        11,
                    )
                    .unwrap_err(),
                DomainError::TerminalResource
            );
            handle
                .update_agent_tool_call(tool.id.clone(), AgentToolStatus::Running, None, None, 12)
                .unwrap();
            let waiting = handle
                .create_agent_run(
                    StartAgentRunRequest {
                        resource_budget: None,
                        field_id: project.field_id.clone(),
                        conversation_id: conversation.id.clone(),
                        user_message_id: None,
                        provider_config_id: provider.view.id.clone(),
                        model_id: None,
                        task: "Wait for approval".into(),
                        permission: AgentPermission::ReviewChanges,
                        max_steps: Some(8),
                        attachments: None,
                        active_work_surface: None,
                    },
                    13,
                )
                .unwrap();
            let waiting_tool = handle
                .create_agent_tool_call(
                    waiting.run.id.clone(),
                    "write_file".into(),
                    AgentToolEffect::WorkspaceWrite,
                    AgentPolicyDecision::Ask,
                    serde_json::json!({"path":"src/lib.rs"}),
                    14,
                )
                .unwrap();
            let pending_approval = handle
                .create_agent_approval(waiting.run.id.clone(), waiting_tool.id, 15)
                .unwrap();
            let paused = handle
                .create_agent_run(
                    StartAgentRunRequest {
                        resource_budget: None,
                        field_id: project.field_id,
                        conversation_id: conversation.id,
                        user_message_id: None,
                        provider_config_id: provider.view.id,
                        model_id: None,
                        task: "Remain paused".into(),
                        permission: AgentPermission::ReviewChanges,
                        max_steps: Some(8),
                        attachments: None,
                        active_work_surface: None,
                    },
                    16,
                )
                .unwrap();
            handle
                .append_agent_event(
                    paused.run.id.clone(),
                    AgentEventKind::RunPaused,
                    serde_json::json!({"reason":"TEST"}),
                    AgentProjectionUpdate {
                        status: Some(AgentRunStatus::Paused),
                        ..Default::default()
                    },
                    17,
                )
                .unwrap();
            (
                created.run.id,
                tool.id,
                waiting.run.id,
                pending_approval,
                paused.run.id,
            )
        };
        {
            let worker = start(&root, 13);
            let handle = worker.handle();
            let reconciled = handle.reconcile_agent_runs(14).unwrap();
            assert_eq!(reconciled.len(), 4);
            assert!(
                reconciled
                    .iter()
                    .all(|commit| commit.run.status == AgentRunStatus::Paused)
            );
            assert_eq!(
                handle.list_agent_tool_calls(run_id.clone()).unwrap()[0].status,
                AgentToolStatus::Unknown
            );
            let events = handle
                .list_agent_events(ListAgentEventsRequest {
                    run_id: run_id.clone(),
                    after_sequence: None,
                    limit: None,
                })
                .unwrap();
            assert_eq!(
                events
                    .iter()
                    .map(|event| event.sequence)
                    .collect::<Vec<_>>(),
                vec![1, 2, 3, 4, 5, 6]
            );
            assert_eq!(
                events
                    .iter()
                    .skip(2)
                    .map(|event| event.kind)
                    .collect::<Vec<_>>(),
                vec![
                    AgentEventKind::RecoveryStarted,
                    AgentEventKind::ToolUnknown,
                    AgentEventKind::RunPaused,
                    AgentEventKind::RecoveryReconciled,
                ]
            );
            let connection = open_connection(&handle.database_path).unwrap();
            assert!(
                connection
                    .execute(
                        "UPDATE agent_events SET kind='RUN_FAILED' WHERE run_id=?1 AND sequence=1",
                        [&run_id.0],
                    )
                    .is_err()
            );
            assert!(
                connection
                    .execute("DELETE FROM agent_events WHERE run_id=?1", [&run_id.0])
                    .is_err()
            );
            assert_eq!(
                handle
                    .list_agent_tool_calls(run_id)
                    .unwrap()
                    .into_iter()
                    .find(|tool| tool.id == tool_id)
                    .unwrap()
                    .error_code
                    .as_deref(),
                Some("CORE_RESTARTED")
            );
            assert_eq!(
                handle.get_agent_run(waiting_run_id.clone()).unwrap().status,
                AgentRunStatus::WaitingApproval
            );
            assert_eq!(
                handle
                    .resolve_agent_approval(
                        ResolveAgentApprovalRequest {
                            run_id: waiting_run_id,
                            approval_id: pending_approval_id.id,
                            nonce: pending_approval_id.nonce,
                            decision: ApprovalDecision::Deny,
                        },
                        18,
                    )
                    .unwrap()
                    .decision,
                Some(ApprovalDecision::Deny)
            );
            assert_eq!(
                handle.get_agent_run(paused_run_id).unwrap().status,
                AgentRunStatus::Paused
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn library_profile_journal_and_tombstone_survive_reopen() {
        let root = temporary_root();
        let profile_id;
        let library_id;
        {
            let worker = start(&root, 10);
            let handle = worker.handle();
            let profile = handle.profile().unwrap();
            profile_id = profile.profile_id.clone();
            let hash = "a".repeat(64);
            let created = handle
                .create_library_file(
                    CreateLibraryFileRequest {
                        title: "example.txt".into(),
                        original_source: "C:\\fixture\\example.txt".into(),
                        original_filename: "example.txt".into(),
                        mime_type: Some("text/plain".into()),
                        media_kind: LibraryMediaKind::Document,
                        size: 7,
                        blob_ref: format!("blobs/objects/aa/{hash}"),
                        content_hash: hash,
                        metadata: serde_json::json!({"version":1}),
                    },
                    11,
                )
                .unwrap();
            library_id = created.id.clone();
            assert_eq!(created.revision, 1);
            let deleted = handle
                .delete_library_object(
                    DeleteLibraryObjectRequest {
                        library_object_id: created.id,
                        expected_revision: 1,
                    },
                    12,
                )
                .unwrap();
            assert_eq!(deleted.lifecycle, LibraryLifecycle::Tombstone);
            assert_eq!(deleted.revision, 2);
            let changes = handle.list_sync_changes().unwrap();
            assert_eq!(changes.len(), 2);
            assert_eq!(changes[0].operation, SyncOperation::Create);
            assert_eq!(changes[1].operation, SyncOperation::Tombstone);
        }
        {
            let worker = start(&root, 20);
            let handle = worker.handle();
            assert_eq!(handle.profile().unwrap().profile_id, profile_id);
            let objects = handle
                .list_library_objects(ListLibraryObjectsRequest {
                    media_kind: None,
                    include_deleted: true,
                    limit: None,
                })
                .unwrap();
            assert_eq!(objects.len(), 1);
            assert_eq!(objects[0].id, library_id);
            assert_eq!(objects[0].lifecycle, LibraryLifecycle::Tombstone);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn portable_snapshot_restores_profile_to_a_new_device_without_machine_paths() {
        let source_root = temporary_root();
        let imported_root = temporary_root();
        let source_paths = PlatformPaths::from_root(source_root.clone()).unwrap();
        let source_device = DeviceIdentity::load_or_create(&source_paths.device_identity).unwrap();
        let source_device_id = source_device.id.clone();
        let profile_id;
        let project_id;
        let conversation_id;
        {
            let worker = StorageWorker::start(&source_paths.database, source_device, 1).unwrap();
            let handle = worker.handle();
            profile_id = handle.profile().unwrap().profile_id;
            let project = handle
                .create_project(
                    CreateProjectRequest {
                        title: "Portable Project".into(),
                        goal: None,
                        root_path: "F:\\machine-only\\project".into(),
                    },
                    2,
                )
                .unwrap();
            project_id = project.field_id.clone();
            let provider = handle
                .create_provider_config(
                    CreateProviderConfigRequest {
                        provider_kind: ProviderKind::Openai,
                        display_name: "Portable provider metadata".into(),
                        base_url: None,
                        default_model: "test-model".into(),
                        custom_endpoint_acknowledged: false,
                    },
                    3,
                )
                .unwrap();
            let provider = handle
                .set_provider_credential_present(provider.view.id, true, 4)
                .unwrap();
            let conversation = handle
                .create_conversation(
                    CreateConversationRequest {
                        field_id: project_id.clone(),
                        title: "Durable conversation".into(),
                        provider_config_id: Some(provider.view.id.clone()),
                        model_id: Some("test-model".into()),
                    },
                    5,
                )
                .unwrap();
            conversation_id = conversation.id.clone();
            let message = handle
                .create_conversation_message(
                    CreateConversationMessageRequest {
                        conversation_id: conversation.id.clone(),
                        role: ConversationMessageRole::User,
                        content: "durable message".into(),
                        status: ConversationMessageStatus::Completed,
                        provider_config_id: None,
                        model_id: None,
                        invocation_id: None,
                        references: vec![],
                    },
                    6,
                )
                .unwrap();
            handle
                .create_agent_run(
                    StartAgentRunRequest {
                        resource_budget: None,
                        field_id: project_id.clone(),
                        conversation_id: conversation.id,
                        user_message_id: Some(message.id),
                        provider_config_id: provider.view.id,
                        model_id: Some("test-model".into()),
                        task: "durable agent history".into(),
                        permission: AgentPermission::ReadOnly,
                        max_steps: Some(2),
                        attachments: None,
                        active_work_surface: None,
                    },
                    7,
                )
                .unwrap();
            let hash = "b".repeat(64);
            handle
                .create_library_file(
                    CreateLibraryFileRequest {
                        title: "portable.txt".into(),
                        original_source: "C:\\machine-only\\portable.txt".into(),
                        original_filename: "portable.txt".into(),
                        mime_type: Some("text/plain".into()),
                        media_kind: LibraryMediaKind::Document,
                        size: 8,
                        blob_ref: format!("blobs/objects/bb/{hash}"),
                        content_hash: hash,
                        metadata: serde_json::json!({"version":1}),
                    },
                    8,
                )
                .unwrap();
        }
        let imported_paths = PlatformPaths::from_root(imported_root.clone()).unwrap();
        create_portable_snapshot(&source_paths.database, &imported_paths.database).unwrap();
        let imported_device =
            DeviceIdentity::load_or_create(&imported_paths.device_identity).unwrap();
        assert_ne!(imported_device.id, source_device_id);
        {
            let worker =
                StorageWorker::start(&imported_paths.database, imported_device, 20).unwrap();
            let handle = worker.handle();
            assert_eq!(handle.profile().unwrap().profile_id, profile_id);
            let projects = handle.list_projects().unwrap();
            assert_eq!(projects.len(), 1);
            assert_eq!(projects[0].field_id, project_id);
            assert_eq!(projects[0].root_path, "");
            assert_eq!(
                handle
                    .list_conversation_messages(conversation_id.clone())
                    .unwrap()
                    .len(),
                1
            );
            assert_eq!(handle.list_agent_runs(conversation_id).unwrap().len(), 1);
            let providers = handle.list_provider_configs().unwrap();
            assert_eq!(providers.len(), 1);
            assert_eq!(
                providers[0].view.lifecycle_status,
                ProviderLifecycle::Disabled
            );
            assert!(!providers[0].view.credential_present);
            let objects = handle
                .list_library_objects(ListLibraryObjectsRequest {
                    media_kind: None,
                    include_deleted: false,
                    limit: None,
                })
                .unwrap();
            assert_eq!(objects.len(), 1);
            assert_eq!(objects[0].original_source, None);
        }
        let source = StorageWorker::start(
            &source_paths.database,
            DeviceIdentity::load_or_create(&source_paths.device_identity).unwrap(),
            30,
        )
        .unwrap();
        assert_eq!(
            source.handle().get_project(project_id).unwrap().root_path,
            "F:\\machine-only\\project"
        );
        drop(source);
        fs::remove_dir_all(source_root).unwrap();
        fs::remove_dir_all(imported_root).unwrap();
    }
}
