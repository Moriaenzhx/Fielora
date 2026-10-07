//! Typed local persistence for Harness.IDR Human Model state.
//!
//! This module deliberately stops at admitted semantic storage. It does not
//! resolve dispositions, compile Context, call a Model, or alter Agent behavior.

use super::{StorageCommand, StorageHandle};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::mpsc::{self, SyncSender};
use thiserror::Error;
use uuid::Uuid;

pub const IDR_CONTRACT_VERSION: u16 = 1;
pub const IDR_PAYLOAD_SCHEMA_VERSION: u16 = 1;
pub const IDR_MAX_PAYLOAD_BYTES: usize = 16 * 1024;
pub const IDR_MAX_PROVENANCE_SUPPORT_BYTES: usize = 2 * 1024;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum IdrStorageError {
    #[error("INVALID_ITEM")]
    InvalidItem,
    #[error("INVALID_KIND_PAYLOAD")]
    InvalidKindPayload,
    #[error("INVALID_TRANSITION")]
    InvalidTransition,
    #[error("REVISION_CONFLICT")]
    RevisionConflict,
    #[error("INVALID_SCOPE")]
    InvalidScope,
    #[error("UNSUPPORTED_CONTRACT_VERSION")]
    UnsupportedContractVersion,
    #[error("STALE_REALITY_REF")]
    StaleRealityRef,
    #[error("SENSITIVE_DENIED")]
    SensitiveDenied,
    #[error("IDR_ITEM_NOT_FOUND")]
    NotFound,
    #[error("IDR_STORAGE_FAILURE")]
    StorageFailure,
}

impl From<rusqlite::Error> for IdrStorageError {
    fn from(_: rusqlite::Error) -> Self {
        Self::StorageFailure
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HumanModelKind {
    Fact,
    Preference,
    Observation,
    Disposition,
    LongTermGoal,
}

impl HumanModelKind {
    fn as_db(self) -> &'static str {
        match self {
            Self::Fact => "FACT",
            Self::Preference => "PREFERENCE",
            Self::Observation => "OBSERVATION",
            Self::Disposition => "DISPOSITION",
            Self::LongTermGoal => "LONG_TERM_GOAL",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "FACT" => Ok(Self::Fact),
            "PREFERENCE" => Ok(Self::Preference),
            "OBSERVATION" => Ok(Self::Observation),
            "DISPOSITION" => Ok(Self::Disposition),
            "LONG_TERM_GOAL" => Ok(Self::LongTermGoal),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceBasis {
    Explicit,
    Observed,
    Inferred,
}

impl EvidenceBasis {
    fn as_db(self) -> &'static str {
        match self {
            Self::Explicit => "EXPLICIT",
            Self::Observed => "OBSERVED",
            Self::Inferred => "INFERRED",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "EXPLICIT" => Ok(Self::Explicit),
            "OBSERVED" => Ok(Self::Observed),
            "INFERRED" => Ok(Self::Inferred),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InferenceConfidence {
    Low,
    Medium,
    High,
}

impl InferenceConfidence {
    fn as_db(self) -> &'static str {
        match self {
            Self::Low => "LOW",
            Self::Medium => "MEDIUM",
            Self::High => "HIGH",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "LOW" => Ok(Self::Low),
            "MEDIUM" => Ok(Self::Medium),
            "HIGH" => Ok(Self::High),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HumanModelLifecycle {
    Candidate,
    Active,
    Weakened,
    Conflicted,
    Superseded,
    Revoked,
}

impl HumanModelLifecycle {
    fn as_db(self) -> &'static str {
        match self {
            Self::Candidate => "CANDIDATE",
            Self::Active => "ACTIVE",
            Self::Weakened => "WEAKENED",
            Self::Conflicted => "CONFLICTED",
            Self::Superseded => "SUPERSEDED",
            Self::Revoked => "REVOKED",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "CANDIDATE" => Ok(Self::Candidate),
            "ACTIVE" => Ok(Self::Active),
            "WEAKENED" => Ok(Self::Weakened),
            "CONFLICTED" => Ok(Self::Conflicted),
            "SUPERSEDED" => Ok(Self::Superseded),
            "REVOKED" => Ok(Self::Revoked),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Superseded | Self::Revoked)
    }

    fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Candidate, Self::Active | Self::Revoked)
                | (
                    Self::Active,
                    Self::Weakened | Self::Conflicted | Self::Superseded | Self::Revoked
                )
                | (
                    Self::Weakened,
                    Self::Active | Self::Superseded | Self::Revoked
                )
                | (
                    Self::Conflicted,
                    Self::Active | Self::Superseded | Self::Revoked
                )
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreferenceRelation {
    Prefer,
    Avoid,
    Tradeoff,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FactValueV1 {
    Text(String),
    Boolean(bool),
    Decimal(String),
    Token(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FactPayloadV1 {
    pub subject_key: String,
    pub value: FactValueV1,
    pub qualifier: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreferencePayloadV1 {
    pub dimension: String,
    pub relation: PreferenceRelation,
    pub normalized_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationPayloadV1 {
    pub observation_kind: String,
    pub normalized_value: String,
    pub related_dimension: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DispositionPayloadV1 {
    pub dimension: String,
    pub normalized_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LongTermGoalPayloadV1 {
    pub goal_key: String,
    pub desired_outcome: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum HumanModelPayloadV1 {
    Fact(FactPayloadV1),
    Preference(PreferencePayloadV1),
    Observation(ObservationPayloadV1),
    Disposition(DispositionPayloadV1),
    LongTermGoal(LongTermGoalPayloadV1),
}

impl HumanModelPayloadV1 {
    pub fn kind(&self) -> HumanModelKind {
        match self {
            Self::Fact(_) => HumanModelKind::Fact,
            Self::Preference(_) => HumanModelKind::Preference,
            Self::Observation(_) => HumanModelKind::Observation,
            Self::Disposition(_) => HumanModelKind::Disposition,
            Self::LongTermGoal(_) => HumanModelKind::LongTermGoal,
        }
    }

    fn dimension_value(&self) -> (Option<&str>, Option<&str>) {
        match self {
            Self::Preference(value) => (
                Some(value.dimension.as_str()),
                Some(value.normalized_value.as_str()),
            ),
            Self::Disposition(value) => (
                Some(value.dimension.as_str()),
                Some(value.normalized_value.as_str()),
            ),
            Self::Observation(value) => (
                value.related_dimension.as_deref(),
                value
                    .related_dimension
                    .as_ref()
                    .map(|_| value.normalized_value.as_str()),
            ),
            Self::Fact(_) | Self::LongTermGoal(_) => (None, None),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DispositionScope {
    pub domain: Option<String>,
    pub project_ref: Option<String>,
    pub task_type: Option<String>,
    pub interaction_kind: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvenanceSourceType {
    ExplicitUserStatement,
    ExplicitUserSetting,
    UserAction,
    UserCorrection,
    AgentOutcome,
    UserApprovedImport,
    SystemInference,
}

impl ProvenanceSourceType {
    fn as_db(self) -> &'static str {
        match self {
            Self::ExplicitUserStatement => "EXPLICIT_USER_STATEMENT",
            Self::ExplicitUserSetting => "EXPLICIT_USER_SETTING",
            Self::UserAction => "USER_ACTION",
            Self::UserCorrection => "USER_CORRECTION",
            Self::AgentOutcome => "AGENT_OUTCOME",
            Self::UserApprovedImport => "USER_APPROVED_IMPORT",
            Self::SystemInference => "SYSTEM_INFERENCE",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "EXPLICIT_USER_STATEMENT" => Ok(Self::ExplicitUserStatement),
            "EXPLICIT_USER_SETTING" => Ok(Self::ExplicitUserSetting),
            "USER_ACTION" => Ok(Self::UserAction),
            "USER_CORRECTION" => Ok(Self::UserCorrection),
            "AGENT_OUTCOME" => Ok(Self::AgentOutcome),
            "USER_APPROVED_IMPORT" => Ok(Self::UserApprovedImport),
            "SYSTEM_INFERENCE" => Ok(Self::SystemInference),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvenanceSourceRefKind {
    Message,
    Conversation,
    AgentRun,
    AgentEvent,
    Setting,
    HumanModelItem,
    ImportedSource,
    UserAction,
}

impl ProvenanceSourceRefKind {
    fn as_db(self) -> &'static str {
        match self {
            Self::Message => "MESSAGE",
            Self::Conversation => "CONVERSATION",
            Self::AgentRun => "AGENT_RUN",
            Self::AgentEvent => "AGENT_EVENT",
            Self::Setting => "SETTING",
            Self::HumanModelItem => "HUMAN_MODEL_ITEM",
            Self::ImportedSource => "IMPORTED_SOURCE",
            Self::UserAction => "USER_ACTION",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "MESSAGE" => Ok(Self::Message),
            "CONVERSATION" => Ok(Self::Conversation),
            "AGENT_RUN" => Ok(Self::AgentRun),
            "AGENT_EVENT" => Ok(Self::AgentEvent),
            "SETTING" => Ok(Self::Setting),
            "HUMAN_MODEL_ITEM" => Ok(Self::HumanModelItem),
            "IMPORTED_SOURCE" => Ok(Self::ImportedSource),
            "USER_ACTION" => Ok(Self::UserAction),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvenanceAdmissionRelation {
    Explicit,
    Confirmation,
    Correction,
    Import,
    InferenceSupport,
}

impl ProvenanceAdmissionRelation {
    fn as_db(self) -> &'static str {
        match self {
            Self::Explicit => "EXPLICIT",
            Self::Confirmation => "CONFIRMATION",
            Self::Correction => "CORRECTION",
            Self::Import => "IMPORT",
            Self::InferenceSupport => "INFERENCE_SUPPORT",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "EXPLICIT" => Ok(Self::Explicit),
            "CONFIRMATION" => Ok(Self::Confirmation),
            "CORRECTION" => Ok(Self::Correction),
            "IMPORT" => Ok(Self::Import),
            "INFERENCE_SUPPORT" => Ok(Self::InferenceSupport),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvenanceSourceStatus {
    Available,
    Revocable,
}

impl ProvenanceSourceStatus {
    fn as_db(self) -> &'static str {
        match self {
            Self::Available => "AVAILABLE",
            Self::Revocable => "REVOCABLE",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "AVAILABLE" => Ok(Self::Available),
            "REVOCABLE" => Ok(Self::Revocable),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvenanceRefInput {
    pub provenance_ref_id: String,
    pub source_type: ProvenanceSourceType,
    pub source_ref_kind: ProvenanceSourceRefKind,
    pub source_ref_id: String,
    pub observed_at: i64,
    pub bounded_support: Option<String>,
    pub source_digest: Option<String>,
    pub admission_relation: Option<ProvenanceAdmissionRelation>,
    pub source_status_at_admission: ProvenanceSourceStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RealityKind {
    Project,
    Artifact,
    Decision,
    Verification,
    FieldObject,
}

impl RealityKind {
    fn as_db(self) -> &'static str {
        match self {
            Self::Project => "PROJECT",
            Self::Artifact => "ARTIFACT",
            Self::Decision => "DECISION",
            Self::Verification => "VERIFICATION",
            Self::FieldObject => "FIELD_OBJECT",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "PROJECT" => Ok(Self::Project),
            "ARTIFACT" => Ok(Self::Artifact),
            "DECISION" => Ok(Self::Decision),
            "VERIFICATION" => Ok(Self::Verification),
            "FIELD_OBJECT" => Ok(Self::FieldObject),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RealityDependencyRelation {
    MustExist,
    RevisionMatch,
    FingerprintMatch,
}

impl RealityDependencyRelation {
    fn as_db(self) -> &'static str {
        match self {
            Self::MustExist => "MUST_EXIST",
            Self::RevisionMatch => "REVISION_MATCH",
            Self::FingerprintMatch => "FINGERPRINT_MATCH",
        }
    }

    fn from_db(value: &str) -> Result<Self, IdrStorageError> {
        match value {
            "MUST_EXIST" => Ok(Self::MustExist),
            "REVISION_MATCH" => Ok(Self::RevisionMatch),
            "FINGERPRINT_MATCH" => Ok(Self::FingerprintMatch),
            _ => Err(IdrStorageError::InvalidItem),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RealityDependencyInput {
    pub reality_kind: RealityKind,
    pub reality_ref: String,
    pub dependency_relation: RealityDependencyRelation,
    pub expected_revision: Option<u64>,
    pub expected_fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedHumanModelItem {
    pub item_id: String,
    pub contract_version: u16,
    pub payload_schema_version: u16,
    pub payload: HumanModelPayloadV1,
    pub lifecycle: HumanModelLifecycle,
    pub evidence_basis: EvidenceBasis,
    pub inference_confidence: Option<InferenceConfidence>,
    pub scope: DispositionScope,
    pub provenance_refs: Vec<ProvenanceRefInput>,
    pub reality_dependencies: Vec<RealityDependencyInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanModelItemRecord {
    pub item_id: String,
    pub contract_version: u16,
    pub payload_schema_version: u16,
    pub payload: HumanModelPayloadV1,
    pub lifecycle: HumanModelLifecycle,
    pub evidence_basis: EvidenceBasis,
    pub inference_confidence: Option<InferenceConfidence>,
    pub scope: DispositionScope,
    pub supersedes_item_id: Option<String>,
    pub created_human_model_revision: u64,
    pub updated_human_model_revision: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub provenance_refs: Vec<ProvenanceRefInput>,
    pub reality_dependencies: Vec<RealityDependencyInput>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HumanModelItemQuery {
    pub kind: Option<HumanModelKind>,
    pub lifecycle: Option<HumanModelLifecycle>,
    pub project_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanModelSnapshot {
    pub human_model_revision: u64,
    pub items: Vec<HumanModelItemRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanModelMutationResult {
    pub human_model_revision: u64,
    pub item: HumanModelItemRecord,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanModelCorrectionResult {
    pub human_model_revision: u64,
    pub previous: HumanModelItemRecord,
    pub replacement: HumanModelItemRecord,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanModelEraseResult {
    pub human_model_revision: u64,
    pub item_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanModelResetResult {
    pub human_model_revision: u64,
    pub erased_items: usize,
}

#[derive(Debug)]
struct StoredItemRow {
    item_id: String,
    contract_version: i64,
    payload_schema_version: i64,
    kind: String,
    typed_payload_json: String,
    lifecycle: String,
    evidence_basis: String,
    inference_confidence: Option<String>,
    scope_domain: Option<String>,
    scope_project_ref: Option<String>,
    scope_task_type: Option<String>,
    scope_interaction_kind: Option<String>,
    supersedes_item_id: Option<String>,
    created_revision: i64,
    updated_revision: i64,
    created_at: i64,
    updated_at: i64,
}

impl StorageHandle {
    pub fn get_human_model_revision(&self) -> Result<u64, IdrStorageError> {
        request_idr_task(&self.sender, |connection| current_revision(connection))
    }

    pub fn get_human_model_item(
        &self,
        item_id: String,
    ) -> Result<HumanModelItemRecord, IdrStorageError> {
        validate_identifier(&item_id)?;
        request_idr_task(&self.sender, move |connection| {
            get_item_on_connection(connection, &item_id)?.ok_or(IdrStorageError::NotFound)
        })
    }

    pub fn list_human_model_items(
        &self,
        query: HumanModelItemQuery,
    ) -> Result<Vec<HumanModelItemRecord>, IdrStorageError> {
        if let Some(project_ref) = query.project_ref.as_deref() {
            validate_identifier(project_ref).map_err(|_| IdrStorageError::InvalidScope)?;
        }
        request_idr_task(&self.sender, move |connection| {
            list_items_on_connection(connection, &query)
        })
    }

    pub fn read_human_model_snapshot(&self) -> Result<HumanModelSnapshot, IdrStorageError> {
        request_idr_task(&self.sender, move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Deferred)
                .map_err(IdrStorageError::from)?;
            let revision = current_revision(&transaction)?;
            let items = list_items_on_connection(&transaction, &HumanModelItemQuery::default())?;
            transaction.commit().map_err(IdrStorageError::from)?;
            Ok(HumanModelSnapshot {
                human_model_revision: revision,
                items,
            })
        })
    }

    pub fn create_human_model_item(
        &self,
        item: AdmittedHumanModelItem,
        expected_human_model_revision: u64,
        mutation_ref: String,
        now: i64,
    ) -> Result<HumanModelMutationResult, IdrStorageError> {
        validate_new_item(&item)?;
        validate_reason_or_ref(&mutation_ref)?;
        validate_time(now)?;
        let owner = self.local_user.0.clone();
        request_idr_task(&self.sender, move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(IdrStorageError::from)?;
            require_expected_revision(&transaction, expected_human_model_revision)?;
            let next_revision = expected_human_model_revision
                .checked_add(1)
                .ok_or(IdrStorageError::InvalidItem)?;
            insert_item(
                &transaction,
                &owner,
                &item,
                None,
                next_revision,
                &mutation_ref,
                now,
            )?;
            advance_revision(
                &transaction,
                expected_human_model_revision,
                next_revision,
                now,
            )?;
            transaction.commit().map_err(IdrStorageError::from)?;
            let item = get_item_on_connection(connection, &item.item_id)?
                .ok_or(IdrStorageError::StorageFailure)?;
            Ok(HumanModelMutationResult {
                human_model_revision: next_revision,
                item,
            })
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn transition_human_model_item(
        &self,
        item_id: String,
        next_lifecycle: HumanModelLifecycle,
        next_confidence: Option<InferenceConfidence>,
        expected_human_model_revision: u64,
        reason_code: String,
        mutation_ref: String,
        now: i64,
    ) -> Result<HumanModelMutationResult, IdrStorageError> {
        validate_identifier(&item_id)?;
        validate_reason_or_ref(&reason_code)?;
        validate_reason_or_ref(&mutation_ref)?;
        validate_time(now)?;
        if next_lifecycle == HumanModelLifecycle::Superseded {
            return Err(IdrStorageError::InvalidTransition);
        }
        request_idr_task(&self.sender, move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(IdrStorageError::from)?;
            require_expected_revision(&transaction, expected_human_model_revision)?;
            let current =
                get_item_on_connection(&transaction, &item_id)?.ok_or(IdrStorageError::NotFound)?;
            if current.lifecycle.is_terminal()
                || !current.lifecycle.can_transition_to(next_lifecycle)
            {
                return Err(IdrStorageError::InvalidTransition);
            }
            let confidence = match current.payload.kind() {
                HumanModelKind::Disposition => Some(
                    next_confidence
                        .or(current.inference_confidence)
                        .ok_or(IdrStorageError::InvalidItem)?,
                ),
                _ if next_confidence.is_some() => return Err(IdrStorageError::InvalidItem),
                _ => None,
            };
            let next_revision = expected_human_model_revision
                .checked_add(1)
                .ok_or(IdrStorageError::InvalidItem)?;
            let changed = transaction
                .execute(
                    "UPDATE idr_human_model_items SET lifecycle=?1,inference_confidence=?2,updated_human_model_revision=?3,updated_at=?4 WHERE item_id=?5 AND lifecycle=?6",
                    params![
                        next_lifecycle.as_db(),
                        confidence.map(InferenceConfidence::as_db),
                        to_i64(next_revision)?,
                        now,
                        item_id,
                        current.lifecycle.as_db()
                    ],
                )
                .map_err(IdrStorageError::from)?;
            if changed != 1 {
                return Err(IdrStorageError::RevisionConflict);
            }
            insert_history(
                &transaction,
                &item_id,
                next_revision,
                history_kind_for_lifecycle(next_lifecycle),
                Some(current.lifecycle),
                next_lifecycle,
                current.inference_confidence,
                confidence,
                &reason_code,
                &mutation_ref,
                now,
            )?;
            advance_revision(
                &transaction,
                expected_human_model_revision,
                next_revision,
                now,
            )?;
            transaction.commit().map_err(IdrStorageError::from)?;
            let item = get_item_on_connection(connection, &item_id)?
                .ok_or(IdrStorageError::StorageFailure)?;
            Ok(HumanModelMutationResult {
                human_model_revision: next_revision,
                item,
            })
        })
    }

    pub fn disable_human_model_item(
        &self,
        item_id: String,
        expected_human_model_revision: u64,
        mutation_ref: String,
        now: i64,
    ) -> Result<HumanModelMutationResult, IdrStorageError> {
        self.transition_human_model_item(
            item_id,
            HumanModelLifecycle::Revoked,
            None,
            expected_human_model_revision,
            "DISABLE_USE".into(),
            mutation_ref,
            now,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_disposition_confidence(
        &self,
        item_id: String,
        next_confidence: InferenceConfidence,
        expected_human_model_revision: u64,
        reason_code: String,
        mutation_ref: String,
        now: i64,
    ) -> Result<HumanModelMutationResult, IdrStorageError> {
        validate_identifier(&item_id)?;
        validate_reason_or_ref(&reason_code)?;
        validate_reason_or_ref(&mutation_ref)?;
        validate_time(now)?;
        request_idr_task(&self.sender, move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(IdrStorageError::from)?;
            require_expected_revision(&transaction, expected_human_model_revision)?;
            let current =
                get_item_on_connection(&transaction, &item_id)?.ok_or(IdrStorageError::NotFound)?;
            if current.payload.kind() != HumanModelKind::Disposition
                || current.lifecycle.is_terminal()
                || current.inference_confidence == Some(next_confidence)
            {
                return Err(IdrStorageError::InvalidItem);
            }
            let previous_confidence = current
                .inference_confidence
                .ok_or(IdrStorageError::InvalidItem)?;
            let next_revision = expected_human_model_revision
                .checked_add(1)
                .ok_or(IdrStorageError::InvalidItem)?;
            let changed = transaction
                .execute(
                    "UPDATE idr_human_model_items SET inference_confidence=?1,updated_human_model_revision=?2,updated_at=?3 WHERE item_id=?4 AND lifecycle=?5 AND inference_confidence=?6",
                    params![
                        next_confidence.as_db(),
                        to_i64(next_revision)?,
                        now,
                        item_id,
                        current.lifecycle.as_db(),
                        previous_confidence.as_db()
                    ],
                )
                .map_err(IdrStorageError::from)?;
            if changed != 1 {
                return Err(IdrStorageError::RevisionConflict);
            }
            insert_history(
                &transaction,
                &item_id,
                next_revision,
                "CONFIDENCE_CHANGED",
                Some(current.lifecycle),
                current.lifecycle,
                Some(previous_confidence),
                Some(next_confidence),
                &reason_code,
                &mutation_ref,
                now,
            )?;
            advance_revision(
                &transaction,
                expected_human_model_revision,
                next_revision,
                now,
            )?;
            transaction.commit().map_err(IdrStorageError::from)?;
            let item = get_item_on_connection(connection, &item_id)?
                .ok_or(IdrStorageError::StorageFailure)?;
            Ok(HumanModelMutationResult {
                human_model_revision: next_revision,
                item,
            })
        })
    }

    pub fn correct_human_model_item(
        &self,
        target_item_id: String,
        replacement: AdmittedHumanModelItem,
        expected_human_model_revision: u64,
        mutation_ref: String,
        now: i64,
    ) -> Result<HumanModelCorrectionResult, IdrStorageError> {
        validate_identifier(&target_item_id)?;
        validate_new_item(&replacement)?;
        validate_reason_or_ref(&mutation_ref)?;
        validate_time(now)?;
        if replacement.item_id == target_item_id
            || replacement.lifecycle != HumanModelLifecycle::Active
        {
            return Err(IdrStorageError::InvalidItem);
        }
        let owner = self.local_user.0.clone();
        request_idr_task(&self.sender, move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(IdrStorageError::from)?;
            require_expected_revision(&transaction, expected_human_model_revision)?;
            let current = get_item_on_connection(&transaction, &target_item_id)?
                .ok_or(IdrStorageError::NotFound)?;
            if current.lifecycle.is_terminal()
                || !current
                    .lifecycle
                    .can_transition_to(HumanModelLifecycle::Superseded)
            {
                return Err(IdrStorageError::InvalidTransition);
            }
            let successor_exists: i64 = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM idr_human_model_items WHERE supersedes_item_id=?1)",
                    [&target_item_id],
                    |row| row.get(0),
                )
                .map_err(IdrStorageError::from)?;
            if successor_exists != 0 {
                return Err(IdrStorageError::InvalidItem);
            }
            let next_revision = expected_human_model_revision
                .checked_add(1)
                .ok_or(IdrStorageError::InvalidItem)?;
            insert_item(
                &transaction,
                &owner,
                &replacement,
                Some(&target_item_id),
                next_revision,
                &mutation_ref,
                now,
            )?;
            let changed = transaction
                .execute(
                    "UPDATE idr_human_model_items SET lifecycle='SUPERSEDED',updated_human_model_revision=?1,updated_at=?2 WHERE item_id=?3 AND lifecycle=?4",
                    params![to_i64(next_revision)?, now, target_item_id, current.lifecycle.as_db()],
                )
                .map_err(IdrStorageError::from)?;
            if changed != 1 {
                return Err(IdrStorageError::RevisionConflict);
            }
            insert_history(
                &transaction,
                &target_item_id,
                next_revision,
                "SUPERSEDED",
                Some(current.lifecycle),
                HumanModelLifecycle::Superseded,
                current.inference_confidence,
                current.inference_confidence,
                "USER_CORRECTION",
                &mutation_ref,
                now,
            )?;
            advance_revision(
                &transaction,
                expected_human_model_revision,
                next_revision,
                now,
            )?;
            transaction.commit().map_err(IdrStorageError::from)?;
            let previous = get_item_on_connection(connection, &target_item_id)?
                .ok_or(IdrStorageError::StorageFailure)?;
            let replacement = get_item_on_connection(connection, &replacement.item_id)?
                .ok_or(IdrStorageError::StorageFailure)?;
            Ok(HumanModelCorrectionResult {
                human_model_revision: next_revision,
                previous,
                replacement,
            })
        })
    }

    pub fn erase_human_model_item_if_allowed(
        &self,
        item_id: String,
        expected_human_model_revision: u64,
        now: i64,
    ) -> Result<HumanModelEraseResult, IdrStorageError> {
        validate_identifier(&item_id)?;
        validate_time(now)?;
        request_idr_task(&self.sender, move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(IdrStorageError::from)?;
            require_expected_revision(&transaction, expected_human_model_revision)?;
            let contract_version: i64 = transaction
                .query_row(
                    "SELECT contract_version FROM idr_human_model_items WHERE item_id=?1",
                    [&item_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(IdrStorageError::from)?
                .ok_or(IdrStorageError::NotFound)?;
            let next_revision = expected_human_model_revision
                .checked_add(1)
                .ok_or(IdrStorageError::InvalidItem)?;
            let deleted = transaction
                .execute(
                    "DELETE FROM idr_human_model_items WHERE item_id=?1",
                    [&item_id],
                )
                .map_err(IdrStorageError::from)?;
            if deleted != 1 {
                return Err(IdrStorageError::RevisionConflict);
            }
            transaction
                .execute(
                    "INSERT INTO idr_erasure_tombstones(item_id,erased_marker,erasure_mode,erased_at,erased_human_model_revision,contract_version) VALUES(?1,1,'ERASE_IF_ALLOWED',?2,?3,?4)",
                    params![item_id, now, to_i64(next_revision)?, contract_version],
                )
                .map_err(IdrStorageError::from)?;
            garbage_collect_unreferenced_provenance(&transaction)?;
            advance_revision(
                &transaction,
                expected_human_model_revision,
                next_revision,
                now,
            )?;
            transaction.commit().map_err(IdrStorageError::from)?;
            Ok(HumanModelEraseResult {
                human_model_revision: next_revision,
                item_id,
            })
        })
    }

    pub fn reset_human_model(
        &self,
        expected_human_model_revision: u64,
        now: i64,
    ) -> Result<HumanModelResetResult, IdrStorageError> {
        validate_time(now)?;
        request_idr_task(&self.sender, move |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(IdrStorageError::from)?;
            require_expected_revision(&transaction, expected_human_model_revision)?;
            let next_revision = expected_human_model_revision
                .checked_add(1)
                .ok_or(IdrStorageError::InvalidItem)?;
            let items = {
                let mut statement = transaction
                    .prepare(
                        "SELECT item_id,contract_version FROM idr_human_model_items ORDER BY item_id",
                    )
                    .map_err(IdrStorageError::from)?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })
                    .map_err(IdrStorageError::from)?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(IdrStorageError::from)?
            };
            for (item_id, contract_version) in &items {
                transaction
                    .execute(
                        "INSERT INTO idr_erasure_tombstones(item_id,erased_marker,erasure_mode,erased_at,erased_human_model_revision,contract_version) VALUES(?1,1,'RESET_PROFILE',?2,?3,?4)",
                        params![item_id, now, to_i64(next_revision)?, contract_version],
                    )
                    .map_err(IdrStorageError::from)?;
            }
            transaction
                .execute("DELETE FROM idr_human_model_items", [])
                .map_err(IdrStorageError::from)?;
            garbage_collect_unreferenced_provenance(&transaction)?;
            advance_revision(
                &transaction,
                expected_human_model_revision,
                next_revision,
                now,
            )?;
            transaction.commit().map_err(IdrStorageError::from)?;
            Ok(HumanModelResetResult {
                human_model_revision: next_revision,
                erased_items: items.len(),
            })
        })
    }
}

fn request_idr_task<T: Send + 'static>(
    sender: &SyncSender<StorageCommand>,
    task: impl FnOnce(&mut Connection) -> Result<T, IdrStorageError> + Send + 'static,
) -> Result<T, IdrStorageError> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    sender
        .send(StorageCommand::Task(Box::new(move |connection| {
            let _ = reply_tx.send(task(connection));
        })))
        .map_err(|_| IdrStorageError::StorageFailure)?;
    reply_rx
        .recv()
        .map_err(|_| IdrStorageError::StorageFailure)?
}

fn current_revision(connection: &Connection) -> Result<u64, IdrStorageError> {
    let revision = connection
        .query_row(
            "SELECT current_human_model_revision FROM idr_human_model_state WHERE singleton_key=1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(IdrStorageError::from)?;
    u64::try_from(revision).map_err(|_| IdrStorageError::StorageFailure)
}

fn require_expected_revision(
    connection: &Connection,
    expected: u64,
) -> Result<(), IdrStorageError> {
    if current_revision(connection)? == expected {
        Ok(())
    } else {
        Err(IdrStorageError::RevisionConflict)
    }
}

fn advance_revision(
    transaction: &Transaction<'_>,
    expected: u64,
    next: u64,
    now: i64,
) -> Result<(), IdrStorageError> {
    let changed = transaction
        .execute(
            "UPDATE idr_human_model_state SET current_human_model_revision=?1,updated_at=?2 WHERE singleton_key=1 AND current_human_model_revision=?3",
            params![to_i64(next)?, now, to_i64(expected)?],
        )
        .map_err(IdrStorageError::from)?;
    if changed == 1 {
        Ok(())
    } else {
        Err(IdrStorageError::RevisionConflict)
    }
}

fn insert_item(
    transaction: &Transaction<'_>,
    local_user_id: &str,
    item: &AdmittedHumanModelItem,
    supersedes_item_id: Option<&str>,
    revision: u64,
    mutation_ref: &str,
    now: i64,
) -> Result<(), IdrStorageError> {
    let identity_exists: i64 = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM idr_human_model_items WHERE item_id=?1) OR EXISTS(SELECT 1 FROM idr_erasure_tombstones WHERE item_id=?1)",
            [&item.item_id],
            |row| row.get(0),
        )
        .map_err(IdrStorageError::from)?;
    if identity_exists != 0 {
        return Err(IdrStorageError::InvalidItem);
    }
    if let Some(target) = supersedes_item_id {
        validate_identifier(target)?;
        if target == item.item_id {
            return Err(IdrStorageError::InvalidItem);
        }
        let target_exists: i64 = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM idr_human_model_items WHERE item_id=?1) OR EXISTS(SELECT 1 FROM idr_erasure_tombstones WHERE item_id=?1)",
                [target],
                |row| row.get(0),
            )
            .map_err(IdrStorageError::from)?;
        if target_exists != 1 {
            return Err(IdrStorageError::InvalidItem);
        }
    }
    validate_project_scope(
        transaction,
        local_user_id,
        item.scope.project_ref.as_deref(),
    )?;
    for dependency in &item.reality_dependencies {
        validate_reality_dependency(dependency)?;
        if dependency.reality_kind == RealityKind::Project {
            validate_project_scope(transaction, local_user_id, Some(&dependency.reality_ref))?;
        }
    }
    let payload_json = encode_payload(&item.payload)?;
    let (dimension, normalized_value) = item.payload.dimension_value();
    transaction
        .execute(
            "INSERT INTO idr_human_model_items(item_id,contract_version,payload_schema_version,kind,typed_payload_json,dimension,normalized_value,lifecycle,evidence_basis,inference_confidence,scope_domain,scope_project_ref,scope_task_type,scope_interaction_kind,supersedes_item_id,created_human_model_revision,updated_human_model_revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16,?17,?17)",
            params![
                item.item_id,
                i64::from(item.contract_version),
                i64::from(item.payload_schema_version),
                item.payload.kind().as_db(),
                payload_json,
                dimension,
                normalized_value,
                item.lifecycle.as_db(),
                item.evidence_basis.as_db(),
                item.inference_confidence.map(InferenceConfidence::as_db),
                item.scope.domain,
                item.scope.project_ref,
                item.scope.task_type,
                item.scope.interaction_kind,
                supersedes_item_id,
                to_i64(revision)?,
                now
            ],
        )
        .map_err(map_constraint_error)?;
    let mut seen_provenance = HashSet::new();
    for provenance in &item.provenance_refs {
        if !seen_provenance.insert(provenance.provenance_ref_id.as_str()) {
            return Err(IdrStorageError::InvalidItem);
        }
        insert_or_validate_provenance(transaction, provenance, now)?;
        transaction
            .execute(
                "INSERT INTO idr_item_provenance(item_id,provenance_ref_id,admitted_human_model_revision) VALUES(?1,?2,?3)",
                params![item.item_id, provenance.provenance_ref_id, to_i64(revision)?],
            )
            .map_err(map_constraint_error)?;
    }
    for dependency in &item.reality_dependencies {
        transaction
            .execute(
                "INSERT INTO idr_item_reality_refs(item_id,reality_kind,reality_ref,dependency_relation,expected_revision,expected_fingerprint,admitted_human_model_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    item.item_id,
                    dependency.reality_kind.as_db(),
                    dependency.reality_ref,
                    dependency.dependency_relation.as_db(),
                    dependency.expected_revision.map(to_i64).transpose()?,
                    dependency.expected_fingerprint,
                    to_i64(revision)?,
                    now
                ],
            )
            .map_err(map_constraint_error)?;
    }
    let provenance_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM idr_item_provenance WHERE item_id=?1",
            [&item.item_id],
            |row| row.get(0),
        )
        .map_err(IdrStorageError::from)?;
    if provenance_count < 1 {
        return Err(IdrStorageError::InvalidItem);
    }
    insert_history(
        transaction,
        &item.item_id,
        revision,
        "CREATED",
        None,
        item.lifecycle,
        None,
        item.inference_confidence,
        "ITEM_CREATED",
        mutation_ref,
        now,
    )
}

fn insert_or_validate_provenance(
    transaction: &Transaction<'_>,
    provenance: &ProvenanceRefInput,
    now: i64,
) -> Result<(), IdrStorageError> {
    validate_provenance(provenance)?;
    type ProvenanceRow = (
        i64,
        String,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    );
    let existing: Option<ProvenanceRow> = transaction
        .query_row(
            "SELECT contract_version,source_type,source_ref_kind,source_ref_id,observed_at,bounded_support,source_digest,admission_relation,source_status_at_admission FROM idr_provenance_refs WHERE provenance_ref_id=?1",
            [&provenance.provenance_ref_id],
            |row| {
                Ok((
                    row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                    row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?,
                ))
            },
        )
        .optional()
        .map_err(IdrStorageError::from)?;
    let expected = (
        i64::from(IDR_CONTRACT_VERSION),
        provenance.source_type.as_db().to_owned(),
        provenance.source_ref_kind.as_db().to_owned(),
        provenance.source_ref_id.clone(),
        provenance.observed_at,
        provenance.bounded_support.clone(),
        provenance.source_digest.clone(),
        provenance
            .admission_relation
            .map(|value| value.as_db().to_owned()),
        provenance.source_status_at_admission.as_db().to_owned(),
    );
    if let Some(existing) = existing {
        if existing == expected {
            return Ok(());
        }
        return Err(IdrStorageError::InvalidItem);
    }
    transaction
        .execute(
            "INSERT INTO idr_provenance_refs(provenance_ref_id,contract_version,source_type,source_ref_kind,source_ref_id,observed_at,bounded_support,source_digest,admission_relation,source_status_at_admission,created_at) VALUES(?1,1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                provenance.provenance_ref_id,
                provenance.source_type.as_db(),
                provenance.source_ref_kind.as_db(),
                provenance.source_ref_id,
                provenance.observed_at,
                provenance.bounded_support,
                provenance.source_digest,
                provenance.admission_relation.map(ProvenanceAdmissionRelation::as_db),
                provenance.source_status_at_admission.as_db(),
                now
            ],
        )
        .map_err(map_constraint_error)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_history(
    transaction: &Transaction<'_>,
    item_id: &str,
    revision: u64,
    mutation_kind: &str,
    previous_lifecycle: Option<HumanModelLifecycle>,
    resulting_lifecycle: HumanModelLifecycle,
    previous_confidence: Option<InferenceConfidence>,
    resulting_confidence: Option<InferenceConfidence>,
    reason_code: &str,
    mutation_ref: &str,
    now: i64,
) -> Result<(), IdrStorageError> {
    transaction
        .execute(
            "INSERT INTO idr_item_history(history_id,item_id,human_model_revision,mutation_kind,previous_lifecycle,resulting_lifecycle,previous_confidence,resulting_confidence,reason_code,mutation_ref,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                Uuid::now_v7().to_string(),
                item_id,
                to_i64(revision)?,
                mutation_kind,
                previous_lifecycle.map(HumanModelLifecycle::as_db),
                resulting_lifecycle.as_db(),
                previous_confidence.map(InferenceConfidence::as_db),
                resulting_confidence.map(InferenceConfidence::as_db),
                reason_code,
                mutation_ref,
                now
            ],
        )
        .map_err(map_constraint_error)?;
    Ok(())
}

fn history_kind_for_lifecycle(lifecycle: HumanModelLifecycle) -> &'static str {
    match lifecycle {
        HumanModelLifecycle::Active => "ACTIVATED",
        HumanModelLifecycle::Weakened => "WEAKENED",
        HumanModelLifecycle::Conflicted => "CONFLICTED",
        HumanModelLifecycle::Superseded => "SUPERSEDED",
        HumanModelLifecycle::Revoked => "REVOKED",
        HumanModelLifecycle::Candidate => "CONFIDENCE_CHANGED",
    }
}

fn garbage_collect_unreferenced_provenance(
    transaction: &Transaction<'_>,
) -> Result<(), IdrStorageError> {
    transaction
        .execute(
            "DELETE FROM idr_provenance_refs WHERE NOT EXISTS(SELECT 1 FROM idr_item_provenance link WHERE link.provenance_ref_id=idr_provenance_refs.provenance_ref_id)",
            [],
        )
        .map_err(IdrStorageError::from)?;
    Ok(())
}

fn get_item_on_connection(
    connection: &Connection,
    item_id: &str,
) -> Result<Option<HumanModelItemRecord>, IdrStorageError> {
    let stored = connection
        .query_row(
            "SELECT item_id,contract_version,payload_schema_version,kind,typed_payload_json,lifecycle,evidence_basis,inference_confidence,scope_domain,scope_project_ref,scope_task_type,scope_interaction_kind,supersedes_item_id,created_human_model_revision,updated_human_model_revision,created_at,updated_at FROM idr_human_model_items WHERE item_id=?1",
            [item_id],
            |row| {
                Ok(StoredItemRow {
                    item_id: row.get(0)?,
                    contract_version: row.get(1)?,
                    payload_schema_version: row.get(2)?,
                    kind: row.get(3)?,
                    typed_payload_json: row.get(4)?,
                    lifecycle: row.get(5)?,
                    evidence_basis: row.get(6)?,
                    inference_confidence: row.get(7)?,
                    scope_domain: row.get(8)?,
                    scope_project_ref: row.get(9)?,
                    scope_task_type: row.get(10)?,
                    scope_interaction_kind: row.get(11)?,
                    supersedes_item_id: row.get(12)?,
                    created_revision: row.get(13)?,
                    updated_revision: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
            },
        )
        .optional()
        .map_err(IdrStorageError::from)?;
    stored
        .map(|row| decode_stored_item(connection, row))
        .transpose()
}

fn decode_stored_item(
    connection: &Connection,
    row: StoredItemRow,
) -> Result<HumanModelItemRecord, IdrStorageError> {
    if row.contract_version != i64::from(IDR_CONTRACT_VERSION)
        || row.payload_schema_version != i64::from(IDR_PAYLOAD_SCHEMA_VERSION)
    {
        return Err(IdrStorageError::UnsupportedContractVersion);
    }
    let kind = HumanModelKind::from_db(&row.kind)?;
    let payload = decode_payload(&row.typed_payload_json, row.payload_schema_version)?;
    if payload.kind() != kind {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    let lifecycle = HumanModelLifecycle::from_db(&row.lifecycle)?;
    let evidence_basis = EvidenceBasis::from_db(&row.evidence_basis)?;
    let inference_confidence = row
        .inference_confidence
        .as_deref()
        .map(InferenceConfidence::from_db)
        .transpose()?;
    validate_compatibility(kind, evidence_basis, inference_confidence)?;
    validate_payload(&payload)?;
    let expected_dimension_value = payload.dimension_value();
    if row
        .scope_project_ref
        .as_deref()
        .is_some_and(|value| value.is_empty())
        || row
            .scope_domain
            .as_deref()
            .is_some_and(|value| value.is_empty())
        || row
            .scope_task_type
            .as_deref()
            .is_some_and(|value| value.is_empty())
        || row
            .scope_interaction_kind
            .as_deref()
            .is_some_and(|value| value.is_empty())
    {
        return Err(IdrStorageError::InvalidScope);
    }
    let stored_dimension: Option<String> = connection
        .query_row(
            "SELECT dimension FROM idr_human_model_items WHERE item_id=?1",
            [&row.item_id],
            |record| record.get(0),
        )
        .map_err(IdrStorageError::from)?;
    let stored_value: Option<String> = connection
        .query_row(
            "SELECT normalized_value FROM idr_human_model_items WHERE item_id=?1",
            [&row.item_id],
            |record| record.get(0),
        )
        .map_err(IdrStorageError::from)?;
    if stored_dimension.as_deref() != expected_dimension_value.0
        || stored_value.as_deref() != expected_dimension_value.1
    {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    let provenance_refs = load_provenance(connection, &row.item_id)?;
    if provenance_refs.is_empty() {
        return Err(IdrStorageError::InvalidItem);
    }
    let reality_dependencies = load_reality_dependencies(connection, &row.item_id)?;
    Ok(HumanModelItemRecord {
        item_id: row.item_id,
        contract_version: u16::try_from(row.contract_version)
            .map_err(|_| IdrStorageError::UnsupportedContractVersion)?,
        payload_schema_version: u16::try_from(row.payload_schema_version)
            .map_err(|_| IdrStorageError::UnsupportedContractVersion)?,
        payload,
        lifecycle,
        evidence_basis,
        inference_confidence,
        scope: DispositionScope {
            domain: row.scope_domain,
            project_ref: row.scope_project_ref,
            task_type: row.scope_task_type,
            interaction_kind: row.scope_interaction_kind,
        },
        supersedes_item_id: row.supersedes_item_id,
        created_human_model_revision: u64::try_from(row.created_revision)
            .map_err(|_| IdrStorageError::InvalidItem)?,
        updated_human_model_revision: u64::try_from(row.updated_revision)
            .map_err(|_| IdrStorageError::InvalidItem)?,
        created_at: row.created_at,
        updated_at: row.updated_at,
        provenance_refs,
        reality_dependencies,
    })
}

fn list_items_on_connection(
    connection: &Connection,
    query: &HumanModelItemQuery,
) -> Result<Vec<HumanModelItemRecord>, IdrStorageError> {
    let item_ids = {
        let mut statement = connection
            .prepare(
                "SELECT item_id FROM idr_human_model_items WHERE (?1 IS NULL OR kind=?1) AND (?2 IS NULL OR lifecycle=?2) AND (?3 IS NULL OR scope_project_ref=?3) ORDER BY updated_human_model_revision ASC,item_id ASC",
            )
            .map_err(IdrStorageError::from)?;
        let rows = statement
            .query_map(
                params![
                    query.kind.map(HumanModelKind::as_db),
                    query.lifecycle.map(HumanModelLifecycle::as_db),
                    query.project_ref
                ],
                |row| row.get::<_, String>(0),
            )
            .map_err(IdrStorageError::from)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(IdrStorageError::from)?
    };
    item_ids
        .into_iter()
        .map(|item_id| {
            get_item_on_connection(connection, &item_id)?.ok_or(IdrStorageError::StorageFailure)
        })
        .collect()
}

fn load_provenance(
    connection: &Connection,
    item_id: &str,
) -> Result<Vec<ProvenanceRefInput>, IdrStorageError> {
    type Row = (
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    );
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT p.provenance_ref_id,p.source_type,p.source_ref_kind,p.source_ref_id,p.observed_at,p.bounded_support,p.source_digest,p.admission_relation,p.source_status_at_admission FROM idr_item_provenance link JOIN idr_provenance_refs p ON p.provenance_ref_id=link.provenance_ref_id WHERE link.item_id=?1 ORDER BY p.provenance_ref_id",
            )
            .map_err(IdrStorageError::from)?;
        let rows = statement
            .query_map([item_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            })
            .map_err(IdrStorageError::from)?;
        rows.collect::<Result<Vec<Row>, _>>()
            .map_err(IdrStorageError::from)?
    };
    rows.into_iter()
        .map(
            |(
                provenance_ref_id,
                source_type,
                source_ref_kind,
                source_ref_id,
                observed_at,
                bounded_support,
                source_digest,
                admission_relation,
                source_status,
            )| {
                Ok(ProvenanceRefInput {
                    provenance_ref_id,
                    source_type: ProvenanceSourceType::from_db(&source_type)?,
                    source_ref_kind: ProvenanceSourceRefKind::from_db(&source_ref_kind)?,
                    source_ref_id,
                    observed_at,
                    bounded_support,
                    source_digest,
                    admission_relation: admission_relation
                        .as_deref()
                        .map(ProvenanceAdmissionRelation::from_db)
                        .transpose()?,
                    source_status_at_admission: ProvenanceSourceStatus::from_db(&source_status)?,
                })
            },
        )
        .collect()
}

fn load_reality_dependencies(
    connection: &Connection,
    item_id: &str,
) -> Result<Vec<RealityDependencyInput>, IdrStorageError> {
    type Row = (String, String, String, Option<i64>, Option<String>);
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT reality_kind,reality_ref,dependency_relation,expected_revision,expected_fingerprint FROM idr_item_reality_refs WHERE item_id=?1 ORDER BY reality_kind,reality_ref,dependency_relation",
            )
            .map_err(IdrStorageError::from)?;
        let rows = statement
            .query_map([item_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(IdrStorageError::from)?;
        rows.collect::<Result<Vec<Row>, _>>()
            .map_err(IdrStorageError::from)?
    };
    rows.into_iter()
        .map(
            |(kind, reference, relation, expected_revision, expected_fingerprint)| {
                Ok(RealityDependencyInput {
                    reality_kind: RealityKind::from_db(&kind)?,
                    reality_ref: reference,
                    dependency_relation: RealityDependencyRelation::from_db(&relation)?,
                    expected_revision: expected_revision
                        .map(u64::try_from)
                        .transpose()
                        .map_err(|_| IdrStorageError::InvalidItem)?,
                    expected_fingerprint,
                })
            },
        )
        .collect()
}

fn validate_new_item(item: &AdmittedHumanModelItem) -> Result<(), IdrStorageError> {
    validate_identifier(&item.item_id)?;
    if item.contract_version != IDR_CONTRACT_VERSION
        || item.payload_schema_version != IDR_PAYLOAD_SCHEMA_VERSION
    {
        return Err(IdrStorageError::UnsupportedContractVersion);
    }
    validate_payload(&item.payload)?;
    validate_compatibility(
        item.payload.kind(),
        item.evidence_basis,
        item.inference_confidence,
    )?;
    if !matches!(
        item.lifecycle,
        HumanModelLifecycle::Candidate | HumanModelLifecycle::Active
    ) {
        return Err(IdrStorageError::InvalidTransition);
    }
    if item.payload.kind() == HumanModelKind::Disposition
        && item.lifecycle != HumanModelLifecycle::Candidate
    {
        return Err(IdrStorageError::InvalidTransition);
    }
    validate_scope(&item.scope)?;
    if item.provenance_refs.is_empty() {
        return Err(IdrStorageError::InvalidItem);
    }
    for provenance in &item.provenance_refs {
        validate_provenance(provenance)?;
    }
    for dependency in &item.reality_dependencies {
        validate_reality_dependency(dependency)?;
    }
    Ok(())
}

fn validate_compatibility(
    kind: HumanModelKind,
    evidence_basis: EvidenceBasis,
    confidence: Option<InferenceConfidence>,
) -> Result<(), IdrStorageError> {
    let basis_valid = matches!(
        (kind, evidence_basis),
        (
            HumanModelKind::Fact,
            EvidenceBasis::Explicit | EvidenceBasis::Observed
        ) | (HumanModelKind::Preference, EvidenceBasis::Explicit)
            | (HumanModelKind::Observation, EvidenceBasis::Observed)
            | (HumanModelKind::Disposition, EvidenceBasis::Inferred)
            | (HumanModelKind::LongTermGoal, EvidenceBasis::Explicit)
    );
    if !basis_valid || (kind == HumanModelKind::Disposition) != confidence.is_some() {
        return Err(IdrStorageError::InvalidItem);
    }
    Ok(())
}

fn validate_payload(payload: &HumanModelPayloadV1) -> Result<(), IdrStorageError> {
    match payload {
        HumanModelPayloadV1::Fact(value) => {
            validate_token(&value.subject_key, 128)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            match &value.value {
                FactValueV1::Text(text) => validate_bounded_text(text, 2048)
                    .map_err(|_| IdrStorageError::InvalidKindPayload)?,
                FactValueV1::Boolean(_) => {}
                FactValueV1::Decimal(decimal) => validate_decimal(decimal)?,
                FactValueV1::Token(token) => validate_normalized_value(token)
                    .map_err(|_| IdrStorageError::InvalidKindPayload)?,
            }
            if let Some(qualifier) = value.qualifier.as_deref() {
                validate_bounded_text(qualifier, 512)
                    .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            }
        }
        HumanModelPayloadV1::Preference(value) => {
            validate_dimension_token(&value.dimension)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            validate_normalized_value(&value.normalized_value)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
        }
        HumanModelPayloadV1::Observation(value) => {
            validate_token(&value.observation_kind, 128)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            validate_normalized_value(&value.normalized_value)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            if let Some(dimension) = value.related_dimension.as_deref() {
                validate_dimension_token(dimension)
                    .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            }
        }
        HumanModelPayloadV1::Disposition(value) => {
            validate_dimension_token(&value.dimension)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            validate_normalized_value(&value.normalized_value)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
        }
        HumanModelPayloadV1::LongTermGoal(value) => {
            validate_token(&value.goal_key, 128)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
            validate_bounded_text(&value.desired_outcome, 2048)
                .map_err(|_| IdrStorageError::InvalidKindPayload)?;
        }
    }
    let encoded = serde_json::to_vec(payload).map_err(|_| IdrStorageError::InvalidKindPayload)?;
    if encoded.len() > IDR_MAX_PAYLOAD_BYTES {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    Ok(())
}

fn encode_payload(payload: &HumanModelPayloadV1) -> Result<String, IdrStorageError> {
    validate_payload(payload)?;
    let encoded =
        serde_json::to_string(payload).map_err(|_| IdrStorageError::InvalidKindPayload)?;
    if encoded.len() > IDR_MAX_PAYLOAD_BYTES {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    Ok(encoded)
}

fn decode_payload(
    encoded: &str,
    payload_schema_version: i64,
) -> Result<HumanModelPayloadV1, IdrStorageError> {
    if payload_schema_version != i64::from(IDR_PAYLOAD_SCHEMA_VERSION) {
        return Err(IdrStorageError::UnsupportedContractVersion);
    }
    if encoded.len() > IDR_MAX_PAYLOAD_BYTES {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    let payload = serde_json::from_str::<HumanModelPayloadV1>(encoded)
        .map_err(|_| IdrStorageError::InvalidKindPayload)?;
    validate_payload(&payload)?;
    Ok(payload)
}

fn validate_scope(scope: &DispositionScope) -> Result<(), IdrStorageError> {
    for value in [
        scope.domain.as_deref(),
        scope.task_type.as_deref(),
        scope.interaction_kind.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        validate_token(value, 128).map_err(|_| IdrStorageError::InvalidScope)?;
    }
    if let Some(project_ref) = scope.project_ref.as_deref() {
        validate_identifier(project_ref).map_err(|_| IdrStorageError::InvalidScope)?;
    }
    Ok(())
}

fn validate_project_scope(
    connection: &Connection,
    local_user_id: &str,
    project_ref: Option<&str>,
) -> Result<(), IdrStorageError> {
    let Some(project_ref) = project_ref else {
        return Ok(());
    };
    let exists: i64 = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM fields WHERE id=?1 AND owner_principal_id=?2)",
            params![project_ref, local_user_id],
            |row| row.get(0),
        )
        .map_err(IdrStorageError::from)?;
    if exists == 1 {
        Ok(())
    } else {
        Err(IdrStorageError::InvalidScope)
    }
}

fn validate_provenance(provenance: &ProvenanceRefInput) -> Result<(), IdrStorageError> {
    validate_identifier(&provenance.provenance_ref_id)?;
    validate_bounded_text(&provenance.source_ref_id, 512)?;
    validate_time(provenance.observed_at)?;
    if let Some(support) = provenance.bounded_support.as_deref() {
        validate_bounded_text(support, IDR_MAX_PROVENANCE_SUPPORT_BYTES)?;
    }
    if let Some(digest) = provenance.source_digest.as_deref() {
        validate_sha256(digest)?;
    }
    Ok(())
}

fn validate_reality_dependency(dependency: &RealityDependencyInput) -> Result<(), IdrStorageError> {
    validate_bounded_text(&dependency.reality_ref, 512)?;
    match dependency.dependency_relation {
        RealityDependencyRelation::MustExist
            if dependency.expected_revision.is_none()
                && dependency.expected_fingerprint.is_none() => {}
        RealityDependencyRelation::RevisionMatch
            if dependency.expected_revision.is_some()
                && dependency.expected_fingerprint.is_none() => {}
        RealityDependencyRelation::FingerprintMatch
            if dependency.expected_revision.is_none()
                && dependency.expected_fingerprint.is_some() =>
        {
            validate_sha256(
                dependency
                    .expected_fingerprint
                    .as_deref()
                    .ok_or(IdrStorageError::InvalidItem)?,
            )?;
        }
        _ => return Err(IdrStorageError::InvalidItem),
    }
    Ok(())
}

pub fn validate_dimension_token(value: &str) -> Result<(), IdrStorageError> {
    if !value.starts_with("fielora.")
        || value.len() > 128
        || value.ends_with('.')
        || value.contains("..")
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
    {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    Ok(())
}

fn validate_normalized_value(value: &str) -> Result<(), IdrStorageError> {
    if value.is_empty()
        || value.len() > 512
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/+-".contains(&byte))
    {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    Ok(())
}

fn validate_token(value: &str, max_bytes: usize) -> Result<(), IdrStorageError> {
    if value.is_empty()
        || value.len() > max_bytes
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err(IdrStorageError::InvalidItem);
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), IdrStorageError> {
    validate_token(value, 128)
}

fn validate_reason_or_ref(value: &str) -> Result<(), IdrStorageError> {
    validate_token(value, 128)
}

fn validate_bounded_text(value: &str, max_bytes: usize) -> Result<(), IdrStorageError> {
    if value.is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(IdrStorageError::InvalidItem);
    }
    Ok(())
}

fn validate_decimal(value: &str) -> Result<(), IdrStorageError> {
    if value.is_empty() || value.len() > 64 {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    let value = value.strip_prefix('-').unwrap_or(value);
    let mut parts = value.split('.');
    let integral = parts.next().unwrap_or_default();
    let fractional = parts.next();
    if integral.is_empty()
        || !integral.bytes().all(|byte| byte.is_ascii_digit())
        || fractional
            .is_some_and(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
        || parts.next().is_some()
    {
        return Err(IdrStorageError::InvalidKindPayload);
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), IdrStorageError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(IdrStorageError::InvalidItem);
    }
    Ok(())
}

fn validate_time(value: i64) -> Result<(), IdrStorageError> {
    if value < 0 {
        Err(IdrStorageError::InvalidItem)
    } else {
        Ok(())
    }
}

fn to_i64(value: u64) -> Result<i64, IdrStorageError> {
    i64::try_from(value).map_err(|_| IdrStorageError::InvalidItem)
}

fn map_constraint_error(error: rusqlite::Error) -> IdrStorageError {
    match error {
        rusqlite::Error::SqliteFailure(_, _) => IdrStorageError::InvalidItem,
        _ => IdrStorageError::StorageFailure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StorageWorker, open_connection, schema_version};
    use fielora_contracts::CreateProjectRequest;
    use fielora_platform::{DeviceIdentity, PlatformPaths};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("fielora-idr-storage-{}", Uuid::now_v7()))
    }

    fn start(root: &Path, now: i64) -> StorageWorker {
        let paths = PlatformPaths::from_root(root.to_path_buf()).unwrap();
        let device = DeviceIdentity::load_or_create(&paths.device_identity).unwrap();
        StorageWorker::start(&paths.database, device, now).unwrap()
    }

    fn provenance(id: &str, support: &str) -> ProvenanceRefInput {
        ProvenanceRefInput {
            provenance_ref_id: id.into(),
            source_type: ProvenanceSourceType::ExplicitUserStatement,
            source_ref_kind: ProvenanceSourceRefKind::Message,
            source_ref_id: format!("message-{id}"),
            observed_at: 10,
            bounded_support: Some(support.into()),
            source_digest: None,
            admission_relation: Some(ProvenanceAdmissionRelation::Explicit),
            source_status_at_admission: ProvenanceSourceStatus::Available,
        }
    }

    fn admitted(
        item_id: &str,
        payload: HumanModelPayloadV1,
        lifecycle: HumanModelLifecycle,
        evidence_basis: EvidenceBasis,
        inference_confidence: Option<InferenceConfidence>,
        provenance_refs: Vec<ProvenanceRefInput>,
    ) -> AdmittedHumanModelItem {
        AdmittedHumanModelItem {
            item_id: item_id.into(),
            contract_version: IDR_CONTRACT_VERSION,
            payload_schema_version: IDR_PAYLOAD_SCHEMA_VERSION,
            payload,
            lifecycle,
            evidence_basis,
            inference_confidence,
            scope: DispositionScope::default(),
            provenance_refs,
            reality_dependencies: Vec::new(),
        }
    }

    fn fact(item_id: &str, value: &str, provenance_id: &str) -> AdmittedHumanModelItem {
        admitted(
            item_id,
            HumanModelPayloadV1::Fact(FactPayloadV1 {
                subject_key: "locale".into(),
                value: FactValueV1::Token(value.into()),
                qualifier: None,
            }),
            HumanModelLifecycle::Active,
            EvidenceBasis::Explicit,
            None,
            vec![provenance(provenance_id, "explicit test fact")],
        )
    }

    fn preference(
        item_id: &str,
        value: &str,
        provenance_ref: ProvenanceRefInput,
    ) -> AdmittedHumanModelItem {
        admitted(
            item_id,
            HumanModelPayloadV1::Preference(PreferencePayloadV1 {
                dimension: "fielora.test.response_style".into(),
                relation: PreferenceRelation::Prefer,
                normalized_value: value.into(),
            }),
            HumanModelLifecycle::Active,
            EvidenceBasis::Explicit,
            None,
            vec![provenance_ref],
        )
    }

    fn assert_error<T>(result: Result<T, IdrStorageError>, expected: IdrStorageError) {
        assert_eq!(result.err(), Some(expected));
    }

    #[test]
    fn typed_kind_matrix_payload_bounds_and_forbidden_channels_fail_closed() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        assert_eq!(handle.get_human_model_revision().unwrap(), 0);

        let items = vec![
            fact("item-fact", "en-US", "prov-fact"),
            preference(
                "item-preference",
                "compact",
                provenance("prov-preference", "explicit preference"),
            ),
            admitted(
                "item-observation",
                HumanModelPayloadV1::Observation(ObservationPayloadV1 {
                    observation_kind: "correction".into(),
                    normalized_value: "accepted".into(),
                    related_dimension: Some("fielora.test.response_style".into()),
                }),
                HumanModelLifecycle::Active,
                EvidenceBasis::Observed,
                None,
                vec![provenance("prov-observation", "observed correction")],
            ),
            admitted(
                "item-disposition",
                HumanModelPayloadV1::Disposition(DispositionPayloadV1 {
                    dimension: "fielora.test.response_style".into(),
                    normalized_value: "structured".into(),
                }),
                HumanModelLifecycle::Candidate,
                EvidenceBasis::Inferred,
                Some(InferenceConfidence::High),
                vec![provenance("prov-disposition", "bounded inference support")],
            ),
            admitted(
                "item-goal",
                HumanModelPayloadV1::LongTermGoal(LongTermGoalPayloadV1 {
                    goal_key: "ship_product".into(),
                    desired_outcome: "Deliver a stable local product".into(),
                }),
                HumanModelLifecycle::Active,
                EvidenceBasis::Explicit,
                None,
                vec![provenance("prov-goal", "explicit durable goal")],
            ),
        ];
        for (index, item) in items.into_iter().enumerate() {
            let expected = index as u64;
            let result = handle
                .create_human_model_item(
                    item,
                    expected,
                    format!("create-{index}"),
                    20 + index as i64,
                )
                .unwrap();
            assert_eq!(result.human_model_revision, expected + 1);
        }
        assert_eq!(
            handle
                .list_human_model_items(Default::default())
                .unwrap()
                .len(),
            5
        );

        let mut invalid_basis = preference(
            "invalid-basis",
            "compact",
            provenance("prov-invalid-basis", "invalid basis"),
        );
        invalid_basis.evidence_basis = EvidenceBasis::Observed;
        assert_error(
            handle.create_human_model_item(invalid_basis, 5, "invalid-basis".into(), 30),
            IdrStorageError::InvalidItem,
        );

        let mut invalid_confidence = fact("invalid-confidence", "en-US", "prov-invalid-confidence");
        invalid_confidence.inference_confidence = Some(InferenceConfidence::Low);
        assert_error(
            handle.create_human_model_item(invalid_confidence, 5, "invalid-confidence".into(), 31),
            IdrStorageError::InvalidItem,
        );

        let mut missing_confidence = admitted(
            "missing-confidence",
            HumanModelPayloadV1::Disposition(DispositionPayloadV1 {
                dimension: "fielora.test.response_style".into(),
                normalized_value: "compact".into(),
            }),
            HumanModelLifecycle::Candidate,
            EvidenceBasis::Inferred,
            None,
            vec![provenance("prov-missing-confidence", "missing confidence")],
        );
        assert_error(
            handle.create_human_model_item(
                missing_confidence.clone(),
                5,
                "missing-confidence".into(),
                32,
            ),
            IdrStorageError::InvalidItem,
        );
        missing_confidence.payload_schema_version = 2;
        missing_confidence.inference_confidence = Some(InferenceConfidence::Low);
        assert_error(
            handle.create_human_model_item(
                missing_confidence,
                5,
                "unknown-payload-version".into(),
                33,
            ),
            IdrStorageError::UnsupportedContractVersion,
        );

        let oversized = admitted(
            "oversized-payload",
            HumanModelPayloadV1::Fact(FactPayloadV1 {
                subject_key: "note".into(),
                value: FactValueV1::Text("x".repeat(IDR_MAX_PAYLOAD_BYTES)),
                qualifier: None,
            }),
            HumanModelLifecycle::Active,
            EvidenceBasis::Explicit,
            None,
            vec![provenance("prov-oversized", "bounded")],
        );
        assert_error(
            handle.create_human_model_item(oversized, 5, "oversized".into(), 34),
            IdrStorageError::InvalidKindPayload,
        );

        let mut missing_provenance = fact("missing-provenance", "en-US", "prov-missing-provenance");
        missing_provenance.provenance_refs.clear();
        assert_error(
            handle.create_human_model_item(missing_provenance, 5, "missing-provenance".into(), 35),
            IdrStorageError::InvalidItem,
        );

        let forbidden_channel = r#"{"kind":"PREFERENCE","data":{"dimension":"fielora.test.response_style","relation":"PREFER","normalized_value":"compact","api_key":"not-a-real-secret"}}"#;
        assert!(serde_json::from_str::<HumanModelPayloadV1>(forbidden_channel).is_err());
        let forbidden_outer_channel = r#"{"kind":"PREFERENCE","data":{"dimension":"fielora.test.response_style","relation":"PREFER","normalized_value":"compact"},"authorization":"unsupported-channel"}"#;
        assert!(serde_json::from_str::<HumanModelPayloadV1>(forbidden_outer_channel).is_err());

        let connection = open_connection(&handle.database_path).unwrap();
        assert!(
            connection
                .execute(
                    "UPDATE idr_human_model_items SET kind='PREFERENCE' WHERE item_id='item-fact'",
                    [],
                )
                .is_err()
        );
        drop(connection);
        assert_eq!(handle.get_human_model_revision().unwrap(), 5);
        worker.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lifecycle_terminal_revision_and_stale_writes_are_enforced() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let mut candidate = preference(
            "lifecycle-item",
            "compact",
            provenance("prov-lifecycle", "explicit preference"),
        );
        candidate.lifecycle = HumanModelLifecycle::Candidate;
        handle
            .create_human_model_item(candidate, 0, "create-lifecycle".into(), 10)
            .unwrap();
        assert_error(
            handle.transition_human_model_item(
                "lifecycle-item".into(),
                HumanModelLifecycle::Active,
                None,
                0,
                "ACTIVATE".into(),
                "stale-activate".into(),
                11,
            ),
            IdrStorageError::RevisionConflict,
        );
        let active = handle
            .transition_human_model_item(
                "lifecycle-item".into(),
                HumanModelLifecycle::Active,
                None,
                1,
                "ACTIVATE".into(),
                "activate".into(),
                12,
            )
            .unwrap();
        assert_eq!(active.human_model_revision, 2);
        let revoked = handle
            .disable_human_model_item("lifecycle-item".into(), 2, "disable".into(), 13)
            .unwrap();
        assert_eq!(revoked.item.lifecycle, HumanModelLifecycle::Revoked);
        assert_eq!(revoked.human_model_revision, 3);
        assert_error(
            handle.transition_human_model_item(
                "lifecycle-item".into(),
                HumanModelLifecycle::Active,
                None,
                3,
                "REACTIVATE".into(),
                "reactivate".into(),
                14,
            ),
            IdrStorageError::InvalidTransition,
        );
        assert_error(
            handle.transition_human_model_item(
                "lifecycle-item".into(),
                HumanModelLifecycle::Superseded,
                None,
                3,
                "FORCE_SUPERSEDE".into(),
                "force-supersede".into(),
                15,
            ),
            IdrStorageError::InvalidTransition,
        );
        assert_eq!(handle.get_human_model_revision().unwrap(), 3);
        worker.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn disposition_activation_and_confidence_change_are_explicit_revisioned_mutations() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let disposition = admitted(
            "confidence-disposition",
            HumanModelPayloadV1::Disposition(DispositionPayloadV1 {
                dimension: "fielora.test.response_style".into(),
                normalized_value: "structured".into(),
            }),
            HumanModelLifecycle::Candidate,
            EvidenceBasis::Inferred,
            Some(InferenceConfidence::Low),
            vec![provenance(
                "prov-confidence-disposition",
                "bounded inference support",
            )],
        );
        handle
            .create_human_model_item(disposition, 0, "create-confidence".into(), 10)
            .unwrap();
        let activated = handle
            .transition_human_model_item(
                "confidence-disposition".into(),
                HumanModelLifecycle::Active,
                Some(InferenceConfidence::Medium),
                1,
                "EXPLICIT_ACTIVATION".into(),
                "activate-confidence".into(),
                11,
            )
            .unwrap();
        assert_eq!(activated.human_model_revision, 2);
        assert_eq!(activated.item.lifecycle, HumanModelLifecycle::Active);
        assert_eq!(
            activated.item.inference_confidence,
            Some(InferenceConfidence::Medium)
        );
        let strengthened = handle
            .update_disposition_confidence(
                "confidence-disposition".into(),
                InferenceConfidence::High,
                2,
                "EXPLICIT_RECONFIRMATION".into(),
                "strengthen-confidence".into(),
                12,
            )
            .unwrap();
        assert_eq!(strengthened.human_model_revision, 3);
        assert_eq!(strengthened.item.lifecycle, HumanModelLifecycle::Active);
        assert_eq!(
            strengthened.item.inference_confidence,
            Some(InferenceConfidence::High)
        );
        assert_error(
            handle.update_disposition_confidence(
                "confidence-disposition".into(),
                InferenceConfidence::High,
                3,
                "NO_CHANGE".into(),
                "duplicate-confidence".into(),
                13,
            ),
            IdrStorageError::InvalidItem,
        );
        assert_eq!(handle.get_human_model_revision().unwrap(), 3);
        worker.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scope_provenance_reality_and_snapshot_round_trip_without_body_duplication() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        let project = handle
            .create_project(
                CreateProjectRequest {
                    title: "IDR storage fixture".into(),
                    goal: None,
                    root_path: root.join("project").to_string_lossy().into_owned(),
                },
                2,
            )
            .unwrap();
        let shared = provenance("prov-shared", "bounded shared support");
        let mut first = preference("scope-first", "compact", shared.clone());
        first.scope = DispositionScope {
            domain: Some("coding".into()),
            project_ref: Some(project.field_id.0.clone()),
            task_type: Some("edit".into()),
            interaction_kind: Some("chat".into()),
        };
        first.reality_dependencies = vec![RealityDependencyInput {
            reality_kind: RealityKind::Project,
            reality_ref: project.field_id.0.clone(),
            dependency_relation: RealityDependencyRelation::RevisionMatch,
            expected_revision: Some(project.revision),
            expected_fingerprint: None,
        }];
        first.provenance_refs.push(provenance(
            "prov-scope-secondary",
            "second admitted support",
        ));
        handle
            .create_human_model_item(first, 0, "create-scope-first".into(), 10)
            .unwrap();
        handle
            .create_human_model_item(
                preference("scope-second", "structured", shared),
                1,
                "create-scope-second".into(),
                11,
            )
            .unwrap();
        let scoped = handle
            .list_human_model_items(HumanModelItemQuery {
                kind: Some(HumanModelKind::Preference),
                lifecycle: Some(HumanModelLifecycle::Active),
                project_ref: Some(project.field_id.0.clone()),
            })
            .unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].provenance_refs.len(), 2);
        assert_eq!(scoped[0].reality_dependencies.len(), 1);
        let snapshot = handle.read_human_model_snapshot().unwrap();
        assert_eq!(snapshot.human_model_revision, 2);
        assert_eq!(snapshot.items.len(), 2);

        let mut invalid_project = preference(
            "invalid-project-scope",
            "compact",
            provenance("prov-invalid-project", "invalid project scope"),
        );
        invalid_project.scope.project_ref = Some("missing-project".into());
        assert_error(
            handle.create_human_model_item(invalid_project, 2, "invalid-project-scope".into(), 12),
            IdrStorageError::InvalidScope,
        );
        assert_eq!(handle.get_human_model_revision().unwrap(), 2);
        worker.shutdown();

        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let connection = open_connection(&paths.database).unwrap();
        let shared_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM idr_provenance_refs WHERE provenance_ref_id='prov-shared'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let links: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM idr_item_provenance WHERE provenance_ref_id='prov-shared'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((shared_rows, links), (1, 2));
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn correction_is_atomic_and_supersession_chain_is_linear() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        handle
            .create_human_model_item(
                preference(
                    "chain-a",
                    "compact",
                    provenance("prov-chain-a", "preference A"),
                ),
                0,
                "create-chain-a".into(),
                10,
            )
            .unwrap();
        let first = handle
            .correct_human_model_item(
                "chain-a".into(),
                preference(
                    "chain-b",
                    "structured",
                    provenance("prov-chain-b", "correction B"),
                ),
                1,
                "correct-chain-b".into(),
                11,
            )
            .unwrap();
        assert_eq!(first.human_model_revision, 2);
        assert_eq!(first.previous.lifecycle, HumanModelLifecycle::Superseded);
        assert_eq!(
            first.replacement.supersedes_item_id.as_deref(),
            Some("chain-a")
        );
        let second = handle
            .correct_human_model_item(
                "chain-b".into(),
                preference(
                    "chain-c",
                    "detailed",
                    provenance("prov-chain-c", "correction C"),
                ),
                2,
                "correct-chain-c".into(),
                12,
            )
            .unwrap();
        assert_eq!(second.human_model_revision, 3);
        assert_eq!(
            second.replacement.supersedes_item_id.as_deref(),
            Some("chain-b")
        );
        assert_error(
            handle.transition_human_model_item(
                "chain-a".into(),
                HumanModelLifecycle::Active,
                None,
                3,
                "REACTIVATE_SUPERSEDED".into(),
                "reactivate-superseded".into(),
                13,
            ),
            IdrStorageError::InvalidTransition,
        );
        assert_error(
            handle.correct_human_model_item(
                "chain-c".into(),
                preference(
                    "chain-c",
                    "compact",
                    provenance("prov-cycle", "self correction"),
                ),
                3,
                "self-cycle".into(),
                14,
            ),
            IdrStorageError::InvalidItem,
        );
        assert_error(
            handle.correct_human_model_item(
                "chain-a".into(),
                preference(
                    "chain-d",
                    "compact",
                    provenance("prov-duplicate-predecessor", "duplicate predecessor"),
                ),
                3,
                "duplicate-predecessor".into(),
                15,
            ),
            IdrStorageError::InvalidTransition,
        );
        assert_eq!(handle.get_human_model_revision().unwrap(), 3);
        worker.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn correction_mid_transaction_failure_rolls_back_every_effect() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        handle
            .create_human_model_item(
                preference(
                    "rollback-old",
                    "compact",
                    provenance("prov-rollback-old", "old preference"),
                ),
                0,
                "create-rollback-old".into(),
                10,
            )
            .unwrap();
        worker.shutdown();

        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let connection = open_connection(&paths.database).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER idr_test_fail_correction BEFORE UPDATE OF lifecycle ON idr_human_model_items WHEN NEW.lifecycle='SUPERSEDED' BEGIN SELECT RAISE(ABORT, 'forced correction failure'); END;",
            )
            .unwrap();
        drop(connection);

        let worker = start(&root, 20);
        let handle = worker.handle();
        assert_error(
            handle.correct_human_model_item(
                "rollback-old".into(),
                preference(
                    "rollback-new",
                    "structured",
                    provenance("prov-rollback-new", "new preference"),
                ),
                1,
                "forced-rollback".into(),
                21,
            ),
            IdrStorageError::StorageFailure,
        );
        assert_eq!(handle.get_human_model_revision().unwrap(), 1);
        assert_eq!(
            handle
                .get_human_model_item("rollback-old".into())
                .unwrap()
                .lifecycle,
            HumanModelLifecycle::Active
        );
        assert_error(
            handle.get_human_model_item("rollback-new".into()),
            IdrStorageError::NotFound,
        );
        worker.shutdown();

        let connection = open_connection(&paths.database).unwrap();
        let new_links: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM idr_item_provenance WHERE item_id='rollback-new'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let history: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM idr_item_history WHERE item_id IN ('rollback-old','rollback-new')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((new_links, history), (0, 1));
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn erase_removes_semantic_sentinel_and_preserves_shared_provenance_until_last_use() {
        let root = temporary_root();
        let sentinel = format!("sentinel{}", Uuid::now_v7().simple());
        let worker = start(&root, 1);
        let handle = worker.handle();
        handle
            .create_human_model_item(
                preference(
                    "erase-target",
                    &sentinel,
                    provenance("prov-erase-target", &sentinel),
                ),
                0,
                "create-erase-target".into(),
                10,
            )
            .unwrap();
        let erased = handle
            .erase_human_model_item_if_allowed("erase-target".into(), 1, 11)
            .unwrap();
        assert_eq!(erased.human_model_revision, 2);
        assert_error(
            handle.get_human_model_item("erase-target".into()),
            IdrStorageError::NotFound,
        );
        assert_error(
            handle.create_human_model_item(
                preference(
                    "erase-target",
                    "resurrected",
                    provenance("prov-resurrection", "must fail"),
                ),
                2,
                "reuse-erased-id".into(),
                12,
            ),
            IdrStorageError::InvalidItem,
        );

        let shared = provenance("prov-gc-shared", "shared bounded support");
        handle
            .create_human_model_item(
                preference("shared-one", "compact", shared.clone()),
                2,
                "create-shared-one".into(),
                13,
            )
            .unwrap();
        handle
            .create_human_model_item(
                preference("shared-two", "structured", shared),
                3,
                "create-shared-two".into(),
                14,
            )
            .unwrap();
        handle
            .erase_human_model_item_if_allowed("shared-one".into(), 4, 15)
            .unwrap();
        worker.shutdown();

        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let connection = open_connection(&paths.database).unwrap();
        assert_eq!(sentinel_occurrences(&connection, &sentinel), 0);
        let shared_after_one: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM idr_provenance_refs WHERE provenance_ref_id='prov-gc-shared'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(shared_after_one, 1);
        drop(connection);

        let worker = start(&root, 20);
        let handle = worker.handle();
        handle
            .erase_human_model_item_if_allowed("shared-two".into(), 5, 21)
            .unwrap();
        worker.shutdown();
        let connection = open_connection(&paths.database).unwrap();
        let shared_after_last: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM idr_provenance_refs WHERE provenance_ref_id='prov-gc-shared'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(shared_after_last, 0);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn disable_and_reset_preserve_revision_semantics_without_profile_rows() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        handle
            .create_human_model_item(
                fact("reset-one", "en-US", "prov-reset-one"),
                0,
                "create-reset-one".into(),
                10,
            )
            .unwrap();
        handle
            .create_human_model_item(
                fact("reset-two", "zh-CN", "prov-reset-two"),
                1,
                "create-reset-two".into(),
                11,
            )
            .unwrap();
        let disabled = handle
            .disable_human_model_item("reset-one".into(), 2, "disable-reset-one".into(), 12)
            .unwrap();
        assert_eq!(disabled.item.lifecycle, HumanModelLifecycle::Revoked);
        assert_eq!(disabled.item.provenance_refs.len(), 1);
        let reset = handle.reset_human_model(3, 13).unwrap();
        assert_eq!(reset.human_model_revision, 4);
        assert_eq!(reset.erased_items, 2);
        assert!(
            handle
                .list_human_model_items(Default::default())
                .unwrap()
                .is_empty()
        );
        assert_eq!(handle.get_human_model_revision().unwrap(), 4);
        worker.shutdown();

        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let connection = open_connection(&paths.database).unwrap();
        let tombstones: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM idr_erasure_tombstones WHERE erasure_mode='RESET_PROFILE'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let provenance_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM idr_provenance_refs", [], |row| {
                row.get(0)
            })
            .unwrap();
        let idr_profile_tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('idr_profiles','idr_users')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((tombstones, provenance_rows, idr_profile_tables), (2, 0, 0));
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_reopen_unknown_version_and_forbidden_schema_paths_are_bounded() {
        let root = temporary_root();
        let worker = start(&root, 1);
        let handle = worker.handle();
        assert_eq!(schema_version(), 19);
        assert_eq!(handle.get_human_model_revision().unwrap(), 0);
        assert!(
            handle
                .list_human_model_items(Default::default())
                .unwrap()
                .is_empty()
        );
        handle
            .create_human_model_item(
                fact("reopen-item", "en-US", "prov-reopen"),
                0,
                "create-reopen".into(),
                10,
            )
            .unwrap();
        worker.shutdown();

        let worker = start(&root, 20);
        let handle = worker.handle();
        assert_eq!(handle.get_human_model_revision().unwrap(), 1);
        assert_eq!(
            handle
                .get_human_model_item("reopen-item".into())
                .unwrap()
                .item_id,
            "reopen-item"
        );
        worker.shutdown();

        let paths = PlatformPaths::from_root(root.clone()).unwrap();
        let connection = open_connection(&paths.database).unwrap();
        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('idr_human_model_state','idr_human_model_items','idr_item_history','idr_provenance_refs','idr_item_provenance','idr_item_reality_refs','idr_erasure_tombstones')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let migration: (String, i64) = connection
            .query_row(
                "SELECT name,version FROM schema_migrations WHERE version=12",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(table_count, 7);
        assert_eq!(migration, ("idr_v2_human_model".into(), 12));
        let columns = idr_column_names(&connection);
        for forbidden in [
            "credential",
            "api_key",
            "authorization",
            "password",
            "private_key",
            "transcript",
            "provider_response",
            "reasoning",
            "file_content",
            "webpage",
            "cookie",
            "session",
        ] {
            assert!(!columns.iter().any(|column| column.contains(forbidden)));
        }
        connection
            .execute_batch("PRAGMA ignore_check_constraints=ON;")
            .unwrap();
        connection
            .execute(
                "UPDATE idr_human_model_items SET payload_schema_version=2 WHERE item_id='reopen-item'",
                [],
            )
            .unwrap();
        drop(connection);

        let worker = start(&root, 30);
        let handle = worker.handle();
        assert_error(
            handle.get_human_model_item("reopen-item".into()),
            IdrStorageError::UnsupportedContractVersion,
        );
        worker.shutdown();
        fs::remove_dir_all(root).unwrap();
    }

    fn sentinel_occurrences(connection: &Connection, sentinel: &str) -> i64 {
        connection
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM idr_human_model_items WHERE instr(item_id,?1)>0 OR instr(typed_payload_json,?1)>0 OR instr(COALESCE(dimension,''),?1)>0 OR instr(COALESCE(normalized_value,''),?1)>0 OR instr(COALESCE(scope_domain,''),?1)>0 OR instr(COALESCE(scope_project_ref,''),?1)>0 OR instr(COALESCE(scope_task_type,''),?1)>0 OR instr(COALESCE(scope_interaction_kind,''),?1)>0 OR instr(COALESCE(supersedes_item_id,''),?1)>0) +
                    (SELECT COUNT(*) FROM idr_item_history WHERE instr(item_id,?1)>0 OR instr(reason_code,?1)>0 OR instr(mutation_ref,?1)>0) +
                    (SELECT COUNT(*) FROM idr_provenance_refs WHERE instr(provenance_ref_id,?1)>0 OR instr(source_ref_id,?1)>0 OR instr(COALESCE(bounded_support,''),?1)>0 OR instr(COALESCE(source_digest,''),?1)>0) +
                    (SELECT COUNT(*) FROM idr_item_provenance WHERE instr(item_id,?1)>0 OR instr(provenance_ref_id,?1)>0) +
                    (SELECT COUNT(*) FROM idr_item_reality_refs WHERE instr(item_id,?1)>0 OR instr(reality_ref,?1)>0 OR instr(COALESCE(expected_fingerprint,''),?1)>0) +
                    (SELECT COUNT(*) FROM idr_erasure_tombstones WHERE instr(item_id,?1)>0 OR instr(erasure_mode,?1)>0)",
                [sentinel],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn idr_column_names(connection: &Connection) -> Vec<String> {
        let mut names = Vec::new();
        for table in [
            "idr_human_model_state",
            "idr_human_model_items",
            "idr_item_history",
            "idr_provenance_refs",
            "idr_item_provenance",
            "idr_item_reality_refs",
            "idr_erasure_tombstones",
        ] {
            let mut statement = connection
                .prepare("SELECT name FROM pragma_table_info(?1)")
                .unwrap();
            names.extend(
                statement
                    .query_map([table], |row| row.get::<_, String>(0))
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap(),
            );
        }
        names
    }
}
