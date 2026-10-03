use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub mod idr;
mod model_runtime;
pub use model_runtime::*;

macro_rules! typed_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        pub struct $name(pub String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

typed_id!(FieldId);
typed_id!(PrincipalId);
typed_id!(DeviceId);
typed_id!(ObjectId);
typed_id!(StateId);
typed_id!(ActivityId);
typed_id!(RelationId);
typed_id!(PaneId);
typed_id!(SurfaceSnapshotId);
typed_id!(TraceId);
typed_id!(ProviderConfigId);
typed_id!(CaptureId);
typed_id!(ContextPackageId);
typed_id!(ModelInvocationId);
typed_id!(ConversationId);
typed_id!(MessageId);
typed_id!(ResultReferenceId);
typed_id!(AgentRunId);
typed_id!(AgentEventId);
typed_id!(ToolCallId);
typed_id!(ApprovalId);
typed_id!(ContextSnapshotId);
typed_id!(VerificationReceiptId);
typed_id!(ProfileId);
typed_id!(LibraryObjectId);
typed_id!(ScreenshotEvidenceId);
typed_id!(SyncChangeId);
typed_id!(ArtifactId);
typed_id!(ArtifactRevisionId);
typed_id!(AssetId);
typed_id!(DiagramNodeId);
typed_id!(DiagramEdgeId);
typed_id!(DiagramGroupId);
typed_id!(SpreadsheetSheetId);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProtocolVersion {
    pub major: u16,
    pub minor: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FipcErrorData {
    pub code: String,
    pub trace_id: String,
    pub retryable: bool,
    #[ts(type = "unknown")]
    pub details: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HelloRequest {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HelloResponse {
    pub core_version: String,
    pub protocol: ProtocolVersion,
    pub schema_version: u32,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct BuildProvenanceView {
    pub git_head: String,
    pub git_dirty: bool,
    pub build_timestamp: String,
    pub source_fingerprint: String,
    pub agent_core_fingerprint: String,
    pub agent_behavior_profile_version: String,
    pub fast_edit_implementation_version: String,
    pub context_compiler_version: String,
    pub desktop_renderer_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldLifecycle {
    Active,
    Completed,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldMode {
    Explore,
    Think,
    Build,
    Operate,
    Verify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldStateKind {
    Fact,
    Decision,
    Assumption,
    Question,
    Task,
    Blocker,
    Result,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StateStatus {
    Active,
    Resolved,
    Superseded,
    Retracted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StateTransitionTarget {
    Active,
    Resolved,
    Retracted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObjectKind {
    Reference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReferenceType {
    HttpsUrl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObjectLifecycle {
    Active,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RelationType {
    SourcedFrom,
    SupersededBy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RelationLifecycle {
    Active,
    Retracted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResourceType {
    Field,
    State,
    Object,
    Relation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum FieldFocusV1 {
    State { state_id: StateId },
    Reference { object_id: ObjectId },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FocusSource {
    None,
    TypedV1,
    LegacyText,
    InvalidIgnored,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateFieldRequest {
    pub title: String,
    pub goal: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdateFocusRequest {
    pub field_id: FieldId,
    #[ts(type = "number")]
    pub expected_revision: u64,
    #[ts(type = "unknown")]
    pub focus: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SetFieldFocusV1Request {
    pub field_id: FieldId,
    #[ts(type = "number")]
    pub expected_field_revision: u64,
    pub focus: Option<FieldFocusV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdateFieldModeRequest {
    pub field_id: FieldId,
    #[ts(type = "number")]
    pub expected_field_revision: u64,
    pub mode: Option<FieldMode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FieldReferenceRequest {
    pub field_id: FieldId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FieldSummary {
    pub id: FieldId,
    pub title: String,
    pub goal: Option<String>,
    pub current_mode: Option<FieldMode>,
    #[ts(type = "unknown | null")]
    pub current_focus: Option<Value>,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FieldView {
    pub id: FieldId,
    pub owner_principal_id: PrincipalId,
    pub title: String,
    pub goal: Option<String>,
    pub lifecycle_status: FieldLifecycle,
    pub current_mode: Option<FieldMode>,
    #[ts(type = "unknown | null")]
    pub current_focus: Option<Value>,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct StateView {
    pub id: StateId,
    pub field_id: FieldId,
    pub kind: FieldStateKind,
    pub content: String,
    pub status: StateStatus,
    pub confidence: Option<f64>,
    pub created_by: PrincipalId,
    pub source_activity_id: ActivityId,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateStateRequest {
    pub field_id: FieldId,
    pub kind: FieldStateKind,
    pub content: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReviseStateRequest {
    pub field_id: FieldId,
    pub state_id: StateId,
    #[ts(type = "number")]
    pub expected_state_revision: u64,
    pub content: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TransitionStateRequest {
    pub field_id: FieldId,
    pub state_id: StateId,
    #[ts(type = "number")]
    pub expected_state_revision: u64,
    pub target: StateTransitionTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SupersedeStateRequest {
    pub field_id: FieldId,
    pub state_id: StateId,
    #[ts(type = "number")]
    pub expected_state_revision: u64,
    pub replacement_content: String,
    pub replacement_confidence: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StateReferenceRequest {
    pub field_id: FieldId,
    pub state_id: StateId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StateCursor {
    #[ts(type = "number")]
    pub updated_at: i64,
    pub state_id: StateId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListStatesRequest {
    pub field_id: FieldId,
    pub kind: Option<FieldStateKind>,
    pub status: Option<StateStatus>,
    pub cursor: Option<StateCursor>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ReferenceView {
    pub id: ObjectId,
    pub field_id: FieldId,
    pub owner_principal_id: PrincipalId,
    pub created_by: PrincipalId,
    pub source_activity_id: ActivityId,
    pub kind: ObjectKind,
    pub title: String,
    pub reference_type: ReferenceType,
    pub canonical_url: String,
    pub lifecycle: ObjectLifecycle,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateReferenceRequest {
    pub field_id: FieldId,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReviseReferenceRequest {
    pub field_id: FieldId,
    pub object_id: ObjectId,
    #[ts(type = "number")]
    pub expected_object_revision: u64,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArchiveReferenceRequest {
    pub field_id: FieldId,
    pub object_id: ObjectId,
    #[ts(type = "number")]
    pub expected_object_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RestoreReferenceRequest {
    pub field_id: FieldId,
    pub object_id: ObjectId,
    #[ts(type = "number")]
    pub expected_object_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReferenceRequest {
    pub field_id: FieldId,
    pub object_id: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReferenceCursor {
    #[ts(type = "number")]
    pub updated_at: i64,
    pub object_id: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListReferencesRequest {
    pub field_id: FieldId,
    pub lifecycle: Option<ObjectLifecycle>,
    pub cursor: Option<ReferenceCursor>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ResourceRef {
    Field {
        field_id: FieldId,
    },
    State {
        state_id: StateId,
    },
    Reference {
        object_id: ObjectId,
    },
    Relation {
        relation_id: RelationId,
    },
    Capture {
        capture_id: CaptureId,
    },
    ProviderConfig {
        provider_config_id: ProviderConfigId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum LineageEndpointRef {
    State { state_id: StateId },
    Reference { object_id: ObjectId },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct RelationView {
    pub id: RelationId,
    pub field_id: FieldId,
    pub relation_type: RelationType,
    pub from: LineageEndpointRef,
    pub to: LineageEndpointRef,
    pub lifecycle: RelationLifecycle,
    pub created_by: PrincipalId,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AttachReferenceSourceRequest {
    pub field_id: FieldId,
    pub state_id: StateId,
    pub reference_id: ObjectId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RetractReferenceSourceRequest {
    pub field_id: FieldId,
    pub relation_id: RelationId,
    #[ts(type = "number")]
    pub expected_relation_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RelationCursor {
    #[ts(type = "number")]
    pub created_at: i64,
    pub relation_id: RelationId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListRelationsRequest {
    pub field_id: FieldId,
    pub relation_type: Option<RelationType>,
    pub lifecycle: Option<RelationLifecycle>,
    pub endpoint: Option<LineageEndpointRef>,
    pub cursor: Option<RelationCursor>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActivityAction {
    FieldCreated,
    FieldArchived,
    FieldFocusUpdated,
    FieldModeUpdated,
    StateCreated,
    StateRevised,
    StateStatusChanged,
    StateSuperseded,
    ReferenceCreated,
    ReferenceRevised,
    ReferenceArchived,
    ReferenceRestored,
    ReferenceSourceAttached,
    ReferenceSourceRetracted,
    ProviderConfigCreated,
    ProviderConfigUpdated,
    ProviderConfigRemoved,
    CaptureCreated,
    CaptureAttached,
    CapturePromoted,
    CaptureArchived,
    CaptureRestored,
    ModelInvocationCompleted,
    ModelInvocationFailed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ActivityView {
    pub id: ActivityId,
    pub field_id: Option<FieldId>,
    pub actor_principal_id: PrincipalId,
    pub action: ActivityAction,
    pub target: Option<ResourceRef>,
    pub summary: Option<String>,
    pub trace_id: TraceId,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ActivityCursor {
    #[ts(type = "number")]
    pub created_at: i64,
    pub activity_id: ActivityId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListActivitiesRequest {
    pub field_id: FieldId,
    pub cursor: Option<ActivityCursor>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Page<T, C> {
    pub items: Vec<T>,
    pub next_cursor: Option<C>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct RealityMutationResult<T> {
    pub resource: T,
    #[ts(type = "number")]
    pub field_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SupersedeStateResult {
    pub previous: StateView,
    pub replacement: StateView,
    pub relation: RelationView,
    #[ts(type = "number")]
    pub field_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurfaceTemplateV1 {
    PrimaryOnly,
    PrimarySupportRight,
    PrimaryTwoSupportsRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurfacePrimitiveV1 {
    TaskPane,
    ReferencePane,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PaneBindingV1 {
    FieldTasks,
    Reference { object_id: ObjectId },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SurfacePaneV1 {
    pub pane_id: PaneId,
    pub primitive: SurfacePrimitiveV1,
    pub binding: PaneBindingV1,
    pub collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SurfaceLayoutV1 {
    pub version: u8,
    pub template: SurfaceTemplateV1,
    pub primary: SurfacePaneV1,
    pub supporting: Vec<SurfacePaneV1>,
    pub focused_pane_id: PaneId,
}

impl SurfaceLayoutV1 {
    pub fn default_task() -> Self {
        Self {
            version: 1,
            template: SurfaceTemplateV1::PrimaryOnly,
            primary: SurfacePaneV1 {
                pane_id: PaneId::new("primary_task"),
                primitive: SurfacePrimitiveV1::TaskPane,
                binding: PaneBindingV1::FieldTasks,
                collapsed: false,
            },
            supporting: Vec::new(),
            focused_pane_id: PaneId::new("primary_task"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SaveSurfaceSnapshotRequest {
    pub field_id: FieldId,
    #[ts(type = "unknown")]
    pub layout: Value,
    pub open_objects: Vec<ObjectId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SaveSurfaceSnapshotV1Request {
    pub field_id: FieldId,
    pub layout: SurfaceLayoutV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SurfaceSnapshotView {
    pub id: SurfaceSnapshotId,
    pub field_id: FieldId,
    pub device_id: DeviceId,
    #[ts(type = "number")]
    pub observed_field_revision: u64,
    #[ts(type = "unknown")]
    pub layout: Value,
    pub open_objects: Vec<ObjectId>,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SurfaceSnapshotV1View {
    pub id: SurfaceSnapshotId,
    pub field_id: FieldId,
    pub device_id: DeviceId,
    #[ts(type = "number")]
    pub observed_field_revision: u64,
    pub layout: SurfaceLayoutV1,
    pub open_reference_ids: Vec<ObjectId>,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SurfaceResumeView {
    pub field: FieldView,
    pub snapshot: Option<SurfaceSnapshotView>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SnapshotFreshness {
    None,
    Current,
    Stale,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LayoutSource {
    Default,
    SnapshotV1,
    LegacyPhase01Fallback,
    InvalidIgnored,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExternalChangeAssessment {
    NotEvaluatedPhase02,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResumeStateItem {
    pub id: StateId,
    pub kind: FieldStateKind,
    pub content_excerpt: String,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContinuationReason {
    TypedFocus,
    LegacyTextFocus,
    ActiveBlocker,
    ActiveQuestion,
    ActiveTask,
    LastActivity,
    FieldOverview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ContinuationTarget {
    State { state_id: StateId },
    Reference { object_id: ObjectId },
    LegacyText { label: String },
    FieldOverview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ResumeContinuation {
    pub reason: ContinuationReason,
    pub target: ContinuationTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FieldResumeV1View {
    pub field: FieldView,
    #[ts(type = "number")]
    pub field_revision: u64,
    pub focus_source: FocusSource,
    pub typed_focus: Option<FieldFocusV1>,
    pub legacy_text_focus: Option<String>,
    pub snapshot_freshness: SnapshotFreshness,
    pub layout_source: LayoutSource,
    pub layout: SurfaceLayoutV1,
    pub open_reference_ids: Vec<ObjectId>,
    pub unavailable_reference_ids: Vec<ObjectId>,
    pub active_blockers: Vec<ResumeStateItem>,
    pub active_questions: Vec<ResumeStateItem>,
    pub active_tasks: Vec<ResumeStateItem>,
    pub last_activity: Option<ActivityView>,
    pub continuation: ResumeContinuation,
    pub external_changes: ExternalChangeAssessment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum FieldChangeKind {
    Created,
    FocusUpdated,
    ModeUpdated,
    StateCreated,
    StateRevised,
    StateStatusChanged,
    StateSuperseded,
    ReferenceCreated,
    ReferenceRevised,
    ReferenceArchived,
    ReferenceRestored,
    ReferenceSourceAttached,
    ReferenceSourceRetracted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DomainEventDTO {
    pub event: String,
    pub field_id: FieldId,
    pub change: FieldChangeKind,
    pub resource: Option<ResourceRef>,
    #[ts(type = "number")]
    pub revision: u64,
    pub trace_id: TraceId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CoreHealthState {
    Starting,
    Ready,
    Unavailable,
    Degraded,
    ShuttingDown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HealthDTO {
    pub state: CoreHealthState,
    pub core_version: String,
    pub protocol: ProtocolVersion,
    pub schema_version: u32,
    pub pid: u32,
    pub db_path: String,
}

// Phase 04 additive provider, invocation, context and capture contracts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderKind {
    Openai,
    Anthropic,
    OpenaiCompatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EndpointClass {
    Official,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderLifecycle {
    Active,
    Disabled,
    Removed,
}

fn default_model_optimization() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProviderConfigView {
    #[serde(default = "default_model_optimization")]
    pub model_optimization: bool,
    pub id: ProviderConfigId,
    pub provider_kind: ProviderKind,
    pub display_name: String,
    pub endpoint_class: EndpointClass,
    pub base_url: Option<String>,
    pub default_model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model_runtime: Option<ModelRuntimeView>,
    pub lifecycle_status: ProviderLifecycle,
    pub credential_present: bool,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateProviderConfigRequest {
    #[serde(default)]
    #[ts(optional)]
    pub model_optimization: Option<bool>,
    pub provider_kind: ProviderKind,
    pub display_name: String,
    pub base_url: Option<String>,
    pub default_model: String,
    pub custom_endpoint_acknowledged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdateProviderConfigRequest {
    #[serde(default)]
    #[ts(optional)]
    pub model_optimization: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub provider_kind: Option<ProviderKind>,
    pub provider_config_id: ProviderConfigId,
    #[ts(type = "number")]
    pub expected_revision: u64,
    pub display_name: String,
    pub base_url: Option<String>,
    pub default_model: String,
    pub custom_endpoint_acknowledged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProviderConfigRequest {
    pub provider_config_id: ProviderConfigId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StoreCredentialRequest {
    pub provider_config_id: ProviderConfigId,
    pub secret: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelIntent {
    Ask,
    Continue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResponseMode {
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextChipKind {
    CurrentField,
    CurrentFocus,
    CurrentPage,
    CurrentSelection,
    Capture,
    UserNote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextSensitivity {
    Normal,
    Sensitive,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextCompleteness {
    Complete,
    Partial,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ContextChip {
    pub kind: ContextChipKind,
    pub source_identity: String,
    pub source_revision_or_navigation_generation: String,
    pub display_label: String,
    pub content: String,
    pub sensitivity: ContextSensitivity,
    pub completeness: ContextCompleteness,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ModelInvocationRequest {
    pub invocation_id: ModelInvocationId,
    pub context_package_id: ContextPackageId,
    pub provider_config_id: ProviderConfigId,
    pub model_id: String,
    pub intent: ModelIntent,
    pub user_input: String,
    pub context_package: Vec<ContextChip>,
    pub response_mode: ResponseMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StartModelInvocationRequest {
    pub provider_config_id: ProviderConfigId,
    pub model_id: Option<String>,
    pub intent: ModelIntent,
    pub user_input: String,
    pub context_package: Vec<ContextChip>,
    pub response_mode: ResponseMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct StartModelInvocationResult {
    pub invocation_id: ModelInvocationId,
    pub context_package_id: ContextPackageId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CancelModelInvocationRequest {
    pub invocation_id: ModelInvocationId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ModelUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ToolProposal {
    pub name: String,
    #[ts(type = "unknown")]
    pub arguments: Value,
    pub provider_opaque_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelInvocationEventKind {
    Started,
    OutputTextDelta,
    ToolProposal,
    Usage,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelInvocationEvent {
    pub event: String,
    pub invocation_id: ModelInvocationId,
    pub kind: ModelInvocationEventKind,
    pub text_delta: Option<String>,
    pub tool_proposal: Option<ToolProposal>,
    pub usage: Option<ModelUsage>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaptureKind {
    Text,
    Page,
    Selection,
    ModelOutput,
    FieldExcerpt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapturePlacement {
    Inbox,
    Attached,
    Promoted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaptureLifecycle {
    Active,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaptureSourceKind {
    UserInput,
    RemotePage,
    RemoteSelection,
    ModelResponse,
    FieldResource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CaptureSource {
    pub kind: CaptureSourceKind,
    pub title: Option<String>,
    pub uri: Option<String>,
    pub field_id: Option<FieldId>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    #[ts(type = "number | null")]
    pub resource_revision: Option<u64>,
    pub provider_config_id: Option<ProviderConfigId>,
    pub provider_model_id: Option<String>,
    pub provider_invocation_id: Option<ModelInvocationId>,
    pub is_partial: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CaptureView {
    pub id: CaptureId,
    pub kind: CaptureKind,
    pub title: String,
    pub content: String,
    pub placement_status: CapturePlacement,
    pub lifecycle_status: CaptureLifecycle,
    pub attached_field_id: Option<FieldId>,
    pub promoted_as: Option<String>,
    pub source: CaptureSource,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateCaptureRequest {
    pub kind: CaptureKind,
    pub title: String,
    pub content: String,
    pub source: CaptureSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CaptureRequest {
    pub capture_id: CaptureId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MutateCaptureRequest {
    pub capture_id: CaptureId,
    #[ts(type = "number")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AttachCaptureRequest {
    pub capture_id: CaptureId,
    pub field_id: FieldId,
    #[ts(type = "number")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PromoteCaptureRequest {
    pub capture_id: CaptureId,
    pub field_id: Option<FieldId>,
    #[ts(type = "number")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CaptureCursor {
    #[ts(type = "number")]
    pub updated_at: i64,
    pub capture_id: CaptureId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListCapturesRequest {
    pub placement: Option<CapturePlacement>,
    pub lifecycle: Option<CaptureLifecycle>,
    pub field_id: Option<FieldId>,
    pub cursor: Option<CaptureCursor>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CaptureChangedEvent {
    pub event: String,
    pub capture_id: CaptureId,
    pub placement_status: CapturePlacement,
    pub lifecycle_status: CaptureLifecycle,
    pub attached_field_id: Option<FieldId>,
    #[ts(type = "number")]
    pub revision: u64,
}

// Library / portable-profile foundation. Library metadata is durable SQLite
// state; blob_ref is a constrained LibraryRoot-relative content binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LibraryObjectKind {
    File,
    Web,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LibraryMediaKind {
    Document,
    Image,
    Audio,
    Video,
    Other,
    Web,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LibraryLifecycle {
    Active,
    Tombstone,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct LibraryObjectView {
    pub id: LibraryObjectId,
    pub kind: LibraryObjectKind,
    pub media_kind: LibraryMediaKind,
    pub title: String,
    pub original_source: Option<String>,
    pub original_filename: Option<String>,
    pub mime_type: Option<String>,
    #[ts(type = "number | null")]
    pub size: Option<u64>,
    pub blob_ref: Option<String>,
    pub content_hash: Option<String>,
    #[ts(type = "unknown")]
    pub metadata: Value,
    pub lifecycle: LibraryLifecycle,
    #[ts(type = "number")]
    pub revision: u64,
    pub updated_by_device: DeviceId,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    #[ts(type = "number | null")]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateLibraryFileRequest {
    pub title: String,
    pub original_source: String,
    pub original_filename: String,
    pub mime_type: Option<String>,
    pub media_kind: LibraryMediaKind,
    #[ts(type = "number")]
    pub size: u64,
    pub blob_ref: String,
    pub content_hash: String,
    #[ts(type = "unknown")]
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SaveWebLibraryRequest {
    pub url: String,
    pub title: String,
    pub source: String,
    pub selected_content: Option<String>,
    #[ts(type = "unknown")]
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct LibraryObjectRequest {
    pub library_object_id: LibraryObjectId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DeleteLibraryObjectRequest {
    pub library_object_id: LibraryObjectId,
    #[ts(type = "number")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListLibraryObjectsRequest {
    pub media_kind: Option<LibraryMediaKind>,
    pub include_deleted: bool,
    pub limit: Option<u16>,
}

// ScreenshotEvidence owns visual-evidence identity and provenance. Immutable
// bytes remain in the existing LibraryRoot ContentBlobStore; this contract does
// not turn evidence into a LibraryObject or a Verification outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScreenshotEvidenceSourceKind {
    BrowserViewport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScreenshotEvidenceVisibility {
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScreenshotEvidenceRetentionClass {
    LocalEvidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScreenshotEvidenceStatus {
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScreenshotEvidenceExportPolicy {
    Excluded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScreenshotEvidenceSyncPolicy {
    LocalOnly,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ScreenshotEvidenceView {
    pub id: ScreenshotEvidenceId,
    pub content_sha256: String,
    pub blob_ref: String,
    pub mime_type: String,
    #[ts(type = "number")]
    pub byte_size: u64,
    pub width: u32,
    pub height: u32,
    pub source_kind: ScreenshotEvidenceSourceKind,
    pub page_id: String,
    #[ts(type = "number")]
    pub navigation_generation: u64,
    pub captured_url: String,
    #[ts(type = "number")]
    pub captured_at: i64,
    pub conversation_id: Option<ConversationId>,
    pub run_id: Option<AgentRunId>,
    pub tool_call_id: Option<ToolCallId>,
    pub verification_receipt_id: Option<VerificationReceiptId>,
    pub visibility: ScreenshotEvidenceVisibility,
    pub retention_class: ScreenshotEvidenceRetentionClass,
    pub status: ScreenshotEvidenceStatus,
    pub export_policy: ScreenshotEvidenceExportPolicy,
    pub sync_policy: ScreenshotEvidenceSyncPolicy,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateScreenshotEvidenceRequest {
    pub png_data_url: String,
    pub source_kind: ScreenshotEvidenceSourceKind,
    pub page_id: String,
    #[ts(type = "number")]
    pub navigation_generation: u64,
    pub captured_url: String,
    #[ts(type = "number")]
    pub captured_at: i64,
    pub conversation_id: Option<ConversationId>,
    pub run_id: Option<AgentRunId>,
    pub tool_call_id: Option<ToolCallId>,
    pub verification_receipt_id: Option<VerificationReceiptId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScreenshotEvidenceRequest {
    pub screenshot_evidence_id: ScreenshotEvidenceId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListScreenshotEvidenceByRunRequest {
    pub run_id: AgentRunId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListScreenshotEvidenceByVerificationRequest {
    pub verification_receipt_id: VerificationReceiptId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScreenshotEvidencePreviewRequest {
    pub screenshot_evidence_id: ScreenshotEvidenceId,
    pub expected_content_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ScreenshotEvidencePreviewView {
    pub screenshot_evidence_id: ScreenshotEvidenceId,
    pub source: ResultImageSource,
    pub mime_type: String,
    #[ts(type = "number")]
    pub byte_size: u64,
    pub width: u32,
    pub height: u32,
    pub content_sha256: String,
    pub data_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PortableBlobManifestEntryView {
    pub blob_ref: String,
    pub content_sha256: String,
    #[ts(type = "number")]
    pub byte_size: u64,
}

// Durable semantic Artifact foundation. Artifact content is a closed,
// Fielora-owned contract; renderer packages and arbitrary JSON are not part of
// the persisted authority boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArtifactType {
    Document,
    Presentation,
    Diagram,
    Spreadsheet,
    FileMutation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileMutationOperation {
    Create,
    Modify,
    Delete,
    Move,
    Restore,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FileArtifactStateV1 {
    pub relative_path: String,
    pub exists: bool,
    pub content_sha256: Option<String>,
    #[ts(type = "number | null")]
    pub byte_length: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FileMutationArtifactV1 {
    pub operation: FileMutationOperation,
    pub before: FileArtifactStateV1,
    pub after: FileArtifactStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DocumentArtifact {
    #[serde(default)]
    pub title: Option<String>,
    pub blocks: Vec<DocumentBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRefV1 {
    pub artifact_id: ArtifactId,
    pub revision_id: ArtifactRevisionId,
    pub expected_type: ArtifactType,
    pub semantic_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum AssetMediaType {
    #[serde(rename = "image/png")]
    #[ts(rename = "image/png")]
    Png,
}

impl AssetMediaType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArtifactAssetRefV1 {
    pub asset_id: AssetId,
    pub content_sha256: String,
    pub media_type: AssetMediaType,
    #[ts(type = "number")]
    pub byte_length: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DocumentImageSizeIntentV1 {
    DocumentWidthBounded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SpreadsheetRangeEmbedV1 {
    pub artifact_ref: ArtifactRefV1,
    pub sheet_id: SpreadsheetSheetId,
    pub start_row: u32,
    pub start_column: u16,
    pub end_row: u32,
    pub end_column: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
#[ts(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DocumentBlock {
    Heading {
        level: u8,
        text: String,
    },
    Paragraph {
        text: String,
    },
    BulletList {
        items: Vec<String>,
    },
    Table {
        rows: Vec<Vec<String>>,
    },
    SpreadsheetRange {
        source: SpreadsheetRangeEmbedV1,
    },
    InlineImage {
        source: ArtifactAssetRefV1,
        size_intent: DocumentImageSizeIntentV1,
        #[serde(default)]
        alt_text: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PresentationArtifact {
    pub slides: Vec<PresentationSlide>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PresentationSlide {
    pub layout: PresentationLayout,
    pub title: String,
    #[serde(default)]
    pub regions: Vec<SlideRegion>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationLayout {
    Title,
    TitleAndBody,
    TwoColumn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SlideRegion {
    pub slot: SlideSlot,
    pub blocks: Vec<PresentationBlock>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SlideSlot {
    Body,
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
#[ts(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationBlock {
    Paragraph {
        text: String,
    },
    BulletList {
        items: Vec<String>,
    },
    Image {
        source: ArtifactAssetRefV1,
        fit: PresentationImageFitV1,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationImageFitV1 {
    Contain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramArtifactV1 {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub layout: DiagramLayoutIntentV1,
    pub nodes: Vec<DiagramNodeV1>,
    pub edges: Vec<DiagramEdgeV1>,
    pub groups: Vec<DiagramGroupV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramLayoutIntentV1 {
    pub strategy: DiagramLayoutStrategy,
    pub direction: DiagramLayoutDirection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramLayoutStrategy {
    LayeredAuto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramLayoutDirection {
    LeftToRight,
    TopToBottom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramNodeV1 {
    pub node_id: DiagramNodeId,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    pub semantic_kind: DiagramNodeKind,
    #[serde(default)]
    pub presentation: Option<DiagramNodePresentationIntentV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramNodeKind {
    Generic,
    Person,
    System,
    Service,
    Database,
    Process,
    Document,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramNodePresentationIntentV1 {
    pub shape: DiagramNodeShape,
    pub emphasis: DiagramEmphasis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramNodeShape {
    Auto,
    Rectangle,
    RoundedRect,
    Ellipse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramEmphasis {
    Normal,
    Emphasis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramEdgeV1 {
    pub edge_id: DiagramEdgeId,
    pub source_node_id: DiagramNodeId,
    pub target_node_id: DiagramNodeId,
    #[serde(default)]
    pub label: Option<String>,
    pub relation_kind: DiagramRelationKind,
    pub direction: DiagramEdgeDirection,
    #[serde(default)]
    pub presentation: Option<DiagramEdgePresentationIntentV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramRelationKind {
    Relation,
    Flow,
    DependsOn,
    Contains,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramEdgeDirection {
    Forward,
    Bidirectional,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramEdgePresentationIntentV1 {
    pub emphasis: DiagramEmphasis,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramGroupV1 {
    pub group_id: DiagramGroupId,
    pub label: String,
    pub semantic_kind: DiagramGroupKind,
    pub member_node_ids: Vec<DiagramNodeId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagramGroupKind {
    Boundary,
    Layer,
    Cluster,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SpreadsheetArtifactV1 {
    #[serde(default)]
    pub title: Option<String>,
    pub sheets: Vec<SpreadsheetSheetV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SpreadsheetSheetV1 {
    pub sheet_id: SpreadsheetSheetId,
    pub name: String,
    pub cells: Vec<SpreadsheetCellV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SpreadsheetCellV1 {
    pub row: u32,
    pub column: u16,
    pub value: SpreadsheetLiteralV1,
    #[serde(default)]
    pub format: Option<SpreadsheetFormatIntentV1>,
    #[serde(default)]
    pub presentation: Option<SpreadsheetCellPresentationIntentV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
#[ts(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpreadsheetLiteralV1 {
    String { value: String },
    Decimal { value: SpreadsheetDecimalV1 },
    Boolean { value: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SpreadsheetDecimalV1(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpreadsheetFormatIntentV1 {
    General,
    Text,
    Integer,
    #[serde(rename = "DECIMAL_2")]
    #[ts(rename = "DECIMAL_2")]
    Decimal2,
    #[serde(rename = "PERCENT_2")]
    #[ts(rename = "PERCENT_2")]
    Percent2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SpreadsheetCellPresentationIntentV1 {
    pub emphasis: SpreadsheetCellEmphasis,
    pub alignment: SpreadsheetCellAlignment,
    pub wrap: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpreadsheetCellEmphasis {
    Normal,
    Header,
    Total,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpreadsheetCellAlignment {
    Auto,
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "content", rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(tag = "type", content = "content", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArtifactContentV1 {
    Document(DocumentArtifact),
    Presentation(PresentationArtifact),
    Diagram(DiagramArtifactV1),
    Spreadsheet(SpreadsheetArtifactV1),
    FileMutation(FileMutationArtifactV1),
}

impl ArtifactContentV1 {
    pub fn artifact_type(&self) -> ArtifactType {
        match self {
            Self::Document(_) => ArtifactType::Document,
            Self::Presentation(_) => ArtifactType::Presentation,
            Self::Diagram(_) => ArtifactType::Diagram,
            Self::Spreadsheet(_) => ArtifactType::Spreadsheet,
            Self::FileMutation(_) => ArtifactType::FileMutation,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArtifactMutationKind {
    Create,
    Update,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ArtifactView {
    pub artifact_id: ArtifactId,
    pub profile_id: ProfileId,
    pub artifact_type: ArtifactType,
    pub title: Option<String>,
    pub project_field_id: Option<FieldId>,
    pub current_revision_id: ArtifactRevisionId,
    pub created_from_conversation_id: Option<ConversationId>,
    pub created_by_agent_run_id: Option<AgentRunId>,
    pub updated_by_device: DeviceId,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArtifactListCursor {
    #[ts(type = "number")]
    pub updated_at: i64,
    pub artifact_id: ArtifactId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArtifactListView {
    pub artifacts: Vec<ArtifactView>,
    pub next_cursor: Option<ArtifactListCursor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ArtifactRevisionMetadataView {
    pub revision_id: ArtifactRevisionId,
    pub artifact_id: ArtifactId,
    #[ts(type = "number")]
    pub sequence: u64,
    pub parent_revision_id: Option<ArtifactRevisionId>,
    pub mutation_kind: ArtifactMutationKind,
    pub content_schema_version: u32,
    pub semantic_sha256: String,
    pub created_from_conversation_id: Option<ConversationId>,
    pub created_by_agent_run_id: Option<AgentRunId>,
    pub created_by_tool_call_id: ToolCallId,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArtifactHistoryView {
    pub artifact: ArtifactView,
    pub revisions: Vec<ArtifactRevisionMetadataView>,
    #[ts(type = "number | null")]
    pub next_before_sequence: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ArtifactRevisionView {
    pub revision_id: ArtifactRevisionId,
    pub artifact_id: ArtifactId,
    #[ts(type = "number")]
    pub sequence: u64,
    pub parent_revision_id: Option<ArtifactRevisionId>,
    pub mutation_kind: ArtifactMutationKind,
    pub content_schema_version: u32,
    pub semantic_sha256: String,
    pub content: ArtifactContentV1,
    pub created_from_conversation_id: Option<ConversationId>,
    pub created_by_agent_run_id: Option<AgentRunId>,
    pub created_by_tool_call_id: ToolCallId,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ArtifactReadView {
    pub artifact: ArtifactView,
    pub revision: ArtifactRevisionView,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileArtifactReviewState {
    Unreviewed,
    Reviewed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileArtifactApplicability {
    Current,
    ChangedSince,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileArtifactUndoAvailability {
    Available,
    BlockedChangedSince,
    DeferredOperation,
    ContentUnavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FileArtifactRevisionReviewView {
    pub artifact_id: ArtifactId,
    pub revision_id: ArtifactRevisionId,
    #[ts(type = "number")]
    pub sequence: u64,
    pub source_run_id: AgentRunId,
    pub source_tool_call_id: ToolCallId,
    pub operation: FileMutationOperation,
    pub before: FileArtifactStateV1,
    pub after: FileArtifactStateV1,
    pub before_text: Option<String>,
    pub after_text: Option<String>,
    pub review_state: FileArtifactReviewState,
    pub applicability: FileArtifactApplicability,
    pub undo_availability: FileArtifactUndoAvailability,
    pub verifications: Vec<VerificationReceiptView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FileArtifactReviewListView {
    pub revisions: Vec<FileArtifactRevisionReviewView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AssetView {
    pub asset_id: AssetId,
    pub profile_id: ProfileId,
    pub media_type: AssetMediaType,
    pub content_sha256: String,
    #[ts(type = "number")]
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
    pub blob_ref: String,
    pub created_from_conversation_id: Option<ConversationId>,
    pub created_by_agent_run_id: Option<AgentRunId>,
    pub created_by_tool_call_id: ToolCallId,
    #[ts(type = "number")]
    pub created_at: i64,
}

// Product-facing Artifact Working Surface requests. These are trusted Desktop
// read/mediation contracts, not Model Tool definitions. They intentionally do
// not expose storage paths or Asset blob references.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListArtifactsRequest {
    pub cursor: Option<ArtifactListCursor>,
    pub limit: Option<u16>,
    pub include_archived: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReadArtifactRequest {
    pub artifact_id: ArtifactId,
    pub revision_id: Option<ArtifactRevisionId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArtifactHistoryRequest {
    pub artifact_id: ArtifactId,
    #[ts(type = "number | null")]
    pub before_sequence: Option<u64>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListFileArtifactReviewsRequest {
    pub run_id: AgentRunId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MarkFileArtifactReviewedRequest {
    pub artifact_id: ArtifactId,
    pub revision_id: ArtifactRevisionId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UndoFileArtifactRevisionRequest {
    pub source_run_id: AgentRunId,
    pub artifact_id: ArtifactId,
    pub revision_id: ArtifactRevisionId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AssetPreviewRequest {
    pub asset_id: AssetId,
    pub expected_content_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AssetPreviewView {
    pub asset_id: AssetId,
    pub media_type: AssetMediaType,
    pub content_sha256: String,
    #[ts(type = "number")]
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
    pub data_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DiagramPreviewRequest {
    pub artifact_id: ArtifactId,
    pub revision_id: ArtifactRevisionId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DiagramPreviewView {
    pub artifact_id: ArtifactId,
    pub revision_id: ArtifactRevisionId,
    pub semantic_sha256: String,
    pub render_sha256: String,
    pub data_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VerificationSubject {
    ArtifactRevision {
        artifact_id: ArtifactId,
        revision_id: ArtifactRevisionId,
        semantic_sha256: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProfileView {
    pub profile_id: ProfileId,
    pub schema_version: u32,
    #[ts(type = "number")]
    pub created_at: i64,
    pub device_id: DeviceId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SyncOperation {
    Create,
    Update,
    Tombstone,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SyncChangeView {
    pub change_id: SyncChangeId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub entity_type: String,
    pub entity_id: String,
    pub operation: SyncOperation,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub changed_at: i64,
}

// Rapid Desktop Foundation additive Project / Conversation contracts.
// A Project keeps the stable Field identity and exposes a device-scoped local root.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProjectView {
    pub field_id: FieldId,
    pub title: String,
    pub goal: Option<String>,
    pub root_path: String,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateProjectRequest {
    pub title: String,
    pub goal: Option<String>,
    pub root_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdateProjectRequest {
    pub field_id: FieldId,
    #[ts(type = "number")]
    pub expected_revision: u64,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArchiveProjectRequest {
    pub field_id: FieldId,
    #[ts(type = "number")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProjectRequest {
    pub field_id: FieldId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RebindProjectRequest {
    pub field_id: FieldId,
    pub root_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConversationLifecycle {
    Active,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ConversationView {
    pub id: ConversationId,
    pub field_id: FieldId,
    pub title: String,
    pub provider_config_id: Option<ProviderConfigId>,
    pub model_id: Option<String>,
    pub lifecycle_status: ConversationLifecycle,
    #[ts(type = "number")]
    pub revision: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateConversationRequest {
    pub field_id: FieldId,
    pub title: String,
    pub provider_config_id: Option<ProviderConfigId>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ConversationRequest {
    pub conversation_id: ConversationId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdateConversationRequest {
    pub conversation_id: ConversationId,
    #[ts(type = "number")]
    pub expected_revision: u64,
    pub title: String,
    pub provider_config_id: Option<ProviderConfigId>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ArchiveConversationRequest {
    pub conversation_id: ConversationId,
    #[ts(type = "number")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConversationMessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConversationMessageStatus {
    Completed,
    Cancelled,
    Failed,
}

/// Durable, provider-neutral target metadata for one controlled reference in a
/// completed Markdown result. `field_id` is the existing stable Project
/// identity; device-local root paths never enter this contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResultImageSource {
    Library,
    ScreenshotEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
#[ts(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResultReferenceTarget {
    ProjectFile {
        field_id: FieldId,
        relative_path: String,
        expected_sha256: Option<String>,
    },
    CodeRange {
        field_id: FieldId,
        relative_path: String,
        line_start: u32,
        line_end: u32,
        expected_sha256: Option<String>,
    },
    WebReference {
        field_id: FieldId,
        reference_id: ObjectId,
        https_url: String,
    },
    Image {
        source: ResultImageSource,
        #[serde(default)]
        #[ts(optional)]
        library_object_id: Option<LibraryObjectId>,
        #[serde(default)]
        #[ts(optional)]
        screenshot_evidence_id: Option<ScreenshotEvidenceId>,
        expected_sha256: String,
        mime_type: String,
    },
}

/// Trusted source used by Core when resolving a model-visible reference.
/// Provider/model output never supplies database identities directly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
#[ts(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResultReferenceProvenance {
    ProjectContext,
    ToolReceipt {
        tool_call_id: ToolCallId,
    },
    SavedReference {
        reference_id: ObjectId,
    },
    LibraryObject {
        library_object_id: LibraryObjectId,
    },
    ScreenshotEvidence {
        screenshot_evidence_id: ScreenshotEvidenceId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ResultReference {
    pub id: ResultReferenceId,
    pub label: String,
    pub target: ResultReferenceTarget,
    pub provenance: ResultReferenceProvenance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ConversationMessageView {
    pub id: MessageId,
    pub conversation_id: ConversationId,
    pub role: ConversationMessageRole,
    pub content: String,
    pub status: ConversationMessageStatus,
    pub provider_config_id: Option<ProviderConfigId>,
    pub model_id: Option<String>,
    pub invocation_id: Option<ModelInvocationId>,
    #[serde(default)]
    pub references: Vec<ResultReference>,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateConversationMessageRequest {
    pub conversation_id: ConversationId,
    pub role: ConversationMessageRole,
    pub content: String,
    pub status: ConversationMessageStatus,
    pub provider_config_id: Option<ProviderConfigId>,
    pub model_id: Option<String>,
    pub invocation_id: Option<ModelInvocationId>,
    #[serde(default)]
    pub references: Vec<ResultReference>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListConversationMessagesRequest {
    pub conversation_id: ConversationId,
}

// Complete Agent Program contracts. These model durable execution, not a
// second Conversation/Project domain and not full-product event sourcing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentRunStatus {
    Queued,
    Running,
    WaitingApproval,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl AgentRunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        use AgentRunStatus::*;
        self == next
            || matches!(
                (self, next),
                (Queued, Running)
                    | (Queued, Paused)
                    | (Queued, Cancelled)
                    | (Running, WaitingApproval)
                    | (Running, Paused)
                    | (Running, Completed)
                    | (Running, Failed)
                    | (Running, Cancelled)
                    | (WaitingApproval, Running)
                    | (WaitingApproval, Paused)
                    | (WaitingApproval, Failed)
                    | (WaitingApproval, Cancelled)
                    | (Paused, Running)
                    | (Paused, WaitingApproval)
                    | (Paused, Failed)
                    | (Paused, Cancelled)
            )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentPermission {
    ReadOnly,
    ReviewChanges,
    FullControl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentEventKind {
    RunCreated,
    RunStarted,
    RunPaused,
    RunResumed,
    RunCompleted,
    RunFailed,
    RunCancelled,
    PhaseChanged,
    StepStarted,
    ContextCompiled,
    ModelStarted,
    ModelTextDelta,
    AssistantNarrative,
    ModelCompleted,
    ModelFailed,
    ToolProposed,
    ApprovalRequested,
    ApprovalResolved,
    ToolStarted,
    ToolProgress,
    ToolCompleted,
    ToolFailed,
    ToolDenied,
    ToolCancelled,
    ToolUnknown,
    VerificationRecorded,
    CheckpointCreated,
    RecoveryStarted,
    RecoveryReconciled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentToolEffect {
    Observe,
    WorkspaceWrite,
    Process,
    Network,
    Destructive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentToolStatus {
    Proposed,
    WaitingApproval,
    Running,
    Completed,
    Failed,
    Denied,
    Cancelled,
    Unknown,
}

impl AgentToolStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Denied | Self::Cancelled | Self::Unknown
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentPolicyDecision {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalDecision {
    AllowOnce,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VerificationOutcome {
    Pass,
    Fail,
    Blocked,
    NotRun,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AgentRunView {
    pub id: AgentRunId,
    pub field_id: FieldId,
    pub conversation_id: ConversationId,
    pub provider_config_id: ProviderConfigId,
    pub model_id: String,
    pub task: String,
    pub permission: AgentPermission,
    pub status: AgentRunStatus,
    #[ts(type = "number")]
    pub current_step: u32,
    #[ts(type = "number")]
    pub max_steps: u32,
    #[ts(type = "number")]
    pub next_sequence: u64,
    pub error_code: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    #[ts(type = "number | null")]
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ModelUsageReportRequest {
    #[ts(type = "number | null")]
    pub since: Option<i64>,
    #[ts(type = "number")]
    pub offset: u32,
    #[ts(type = "number")]
    pub limit: u32,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TaskTokenUsage {
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub reported_calls: u64,
    #[ts(type = "number")]
    pub unreported_calls: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelUsageTask {
    pub run_id: AgentRunId,
    pub conversation_id: ConversationId,
    pub title: String,
    pub provider_config_id: ProviderConfigId,
    pub model_id: String,
    pub status: AgentRunStatus,
    #[ts(type = "number")]
    pub created_at: i64,
    pub usage: TaskTokenUsage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelUsageGroup {
    pub provider_config_id: ProviderConfigId,
    pub model_id: String,
    pub usage: TaskTokenUsage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelUsageDay {
    pub date: String,
    pub usage: TaskTokenUsage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelUsageReport {
    pub usage: TaskTokenUsage,
    pub models: Vec<ModelUsageGroup>,
    pub daily: Vec<ModelUsageDay>,
    pub tasks: Vec<ModelUsageTask>,
    pub active: Vec<ModelUsageTask>,
    #[ts(type = "number")]
    pub total_tasks: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AgentInputAttachment {
    pub id: String,
    pub filename: String,
    pub mime_type: String,
    #[ts(type = "number")]
    pub size: u32,
    #[ts(type = "number")]
    pub width: u32,
    #[ts(type = "number")]
    pub height: u32,
    pub source: String,
    pub data_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActiveArtifactViewMode {
    Current,
    Historical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ActiveArtifactContext {
    pub artifact_id: ArtifactId,
    pub artifact_type: ArtifactType,
    pub viewed_revision_id: ArtifactRevisionId,
    pub current_revision_id: ArtifactRevisionId,
    pub view_mode: ActiveArtifactViewMode,
    pub archived: bool,
    pub selected_slide: Option<u32>,
    pub selected_sheet_id: Option<SpreadsheetSheetId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StartAgentRunRequest {
    #[serde(default)]
    #[ts(optional)]
    pub resource_budget: Option<AgentResourceBudget>,
    pub field_id: FieldId,
    pub conversation_id: ConversationId,
    pub user_message_id: Option<MessageId>,
    pub provider_config_id: ProviderConfigId,
    pub model_id: Option<String>,
    pub task: String,
    pub permission: AgentPermission,
    pub max_steps: Option<u32>,
    pub attachments: Option<Vec<AgentInputAttachment>>,
    #[serde(default)]
    #[ts(optional)]
    pub active_work_surface: Option<ActiveArtifactContext>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SetArtifactArchiveStateCommandRequest {
    pub field_id: FieldId,
    pub conversation_id: ConversationId,
    pub provider_config_id: ProviderConfigId,
    pub model_id: Option<String>,
    pub artifact_id: ArtifactId,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AgentRunRequest {
    pub run_id: AgentRunId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ResumeAgentRunRequest {
    #[serde(default)]
    #[ts(optional)]
    pub resource_budget: Option<AgentResourceBudget>,
    pub run_id: AgentRunId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub user_message_id: Option<MessageId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attachments: Option<Vec<AgentInputAttachment>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListAgentRunsRequest {
    pub conversation_id: ConversationId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AgentResourceBudget {
    #[ts(type = "number")]
    pub max_execution_ms: u64,
    #[ts(type = "number")]
    // Legacy wire/event fields only; cumulative tokens are measured, never enforced.
    #[serde(default)]
    pub max_input_tokens: u64,
    #[ts(type = "number")]
    #[serde(default)]
    pub max_output_tokens: u64,
}

impl Default for AgentResourceBudget {
    fn default() -> Self {
        Self {
            max_execution_ms: 3_600_000,
            max_input_tokens: 0,
            max_output_tokens: 0,
        }
    }
}

impl AgentResourceBudget {
    pub fn is_valid(&self) -> bool {
        (60_000..=86_400_000).contains(&self.max_execution_ms)
            && self.max_input_tokens <= 50_000_000
            && self.max_output_tokens <= 1_000_000
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AgentEventView {
    pub id: AgentEventId,
    pub run_id: AgentRunId,
    #[ts(type = "number")]
    pub sequence: u64,
    pub schema_version: u16,
    pub kind: AgentEventKind,
    #[ts(type = "unknown")]
    pub payload: Value,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ListAgentEventsRequest {
    pub run_id: AgentRunId,
    #[ts(type = "number | null")]
    pub after_sequence: Option<u64>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AgentToolCallView {
    pub id: ToolCallId,
    pub run_id: AgentRunId,
    pub name: String,
    pub effect: AgentToolEffect,
    pub status: AgentToolStatus,
    pub policy_decision: AgentPolicyDecision,
    #[ts(type = "unknown")]
    pub arguments: Value,
    #[ts(type = "unknown | null")]
    pub receipt: Option<Value>,
    pub error_code: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ApprovalView {
    pub id: ApprovalId,
    pub run_id: AgentRunId,
    pub tool_call_id: ToolCallId,
    pub decision: Option<ApprovalDecision>,
    pub nonce: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub resolved_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ResolveAgentApprovalRequest {
    pub run_id: AgentRunId,
    pub approval_id: ApprovalId,
    pub nonce: String,
    pub decision: ApprovalDecision,
}

// Passive application-level and ephemeral AgentRun-level projections for the
// existing local MCP Tool provider path. These contracts expose no process
// handle, command arguments, credentials, or durable connection state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpConfigStatus {
    Configured,
    ConfigNotFound,
    ConfigMalformed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpRunActivationState {
    NotActive,
    ActivationQueued,
    AwaitingApproval,
    Starting,
    ActiveInCurrentRun,
    ProcessUnavailable,
    ActivationDenied,
    ActivationFailed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct McpDiagnosticView {
    pub connection_id: Option<String>,
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct McpConnectionView {
    pub connection_id: String,
    pub transport: String,
    pub command_path: String,
    #[ts(type = "number")]
    pub command_argument_count: u32,
    pub credential_support: String,
    #[ts(type = "number")]
    pub credential_binding_count: u32,
    #[ts(type = "number")]
    pub credential_missing_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct McpConnectionCatalogView {
    pub status: McpConfigStatus,
    pub config_digest: Option<String>,
    #[ts(type = "number")]
    pub connection_count: u32,
    pub connections: Vec<McpConnectionView>,
    pub diagnostics: Vec<McpDiagnosticView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct McpRunConnectionView {
    pub connection_id: String,
    pub activation_state: McpRunActivationState,
    pub activation_available: bool,
    pub activation_unavailable_reason: Option<String>,
    pub provider_id: Option<String>,
    pub transport: String,
    pub protocol_version: Option<String>,
    #[ts(type = "number | null")]
    pub discovered_tool_count: Option<u32>,
    #[ts(type = "number")]
    pub credential_binding_count: u32,
    #[ts(type = "number")]
    pub credential_missing_count: u32,
    pub last_activation_tool_call_id: Option<ToolCallId>,
    pub last_error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct McpConnectionRuntimeView {
    pub run_id: AgentRunId,
    pub run_status: AgentRunStatus,
    pub connections: Vec<McpRunConnectionView>,
    pub diagnostics: Vec<McpDiagnosticView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ActivateMcpConnectionRequest {
    pub run_id: AgentRunId,
    pub connection_id: String,
}

// Metadata-only projections for the existing SkillCatalog and declarative
// local unpacked Plugin contribution host. These contracts never contain a
// Skill body, executable state, credentials, permissions, or MCP activation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SkillCatalogRequest {
    pub field_id: Option<FieldId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SkillMetadataView {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SkillPluginProvenanceView {
    pub plugin_id: String,
    pub plugin_version: String,
    pub plugin_source: String,
    pub plugin_trust: String,
    pub plugin_manifest_digest: String,
    pub plugin_snapshot_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SkillCatalogEntryView {
    pub name: String,
    pub description: String,
    pub source_kind: String,
    pub scope: String,
    pub trust: String,
    pub version: Option<String>,
    pub content_digest: String,
    pub location_reference: String,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub metadata: Vec<SkillMetadataView>,
    pub allowed_tools_advisory: Option<String>,
    pub resources: Vec<String>,
    pub resources_truncated: bool,
    pub plugin: Option<SkillPluginProvenanceView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SkillCatalogDiagnosticView {
    pub code: String,
    pub skill_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SkillCatalogView {
    pub catalog_sha256: String,
    pub entries: Vec<SkillCatalogEntryView>,
    pub diagnostics: Vec<SkillCatalogDiagnosticView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PluginContributionSkillView {
    pub name: String,
    pub relative_path: String,
    pub content_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DeclarativePluginView {
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub engine_requirement: String,
    pub source_kind: String,
    pub trust: String,
    pub manifest_reference: String,
    pub manifest_digest: String,
    pub skills: Vec<PluginContributionSkillView>,
    pub plugin_snapshot_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LocalPluginRegistrationStatus {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct LocalPluginRegistrationView {
    pub registration_id: String,
    pub root_reference: String,
    pub status: LocalPluginRegistrationStatus,
    pub error_code: Option<String>,
    pub plugin: Option<DeclarativePluginView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct LocalPluginRegistryView {
    pub config_status: String,
    pub config_digest: Option<String>,
    pub registrations: Vec<LocalPluginRegistrationView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RegisterLocalPluginRequest {
    pub root_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UnregisterLocalPluginRequest {
    pub registration_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AgentContextSnapshotView {
    pub id: ContextSnapshotId,
    pub run_id: AgentRunId,
    #[ts(type = "number")]
    pub step: u32,
    pub project_root_hash: String,
    #[ts(type = "number")]
    pub selected_files: u32,
    #[ts(type = "number")]
    pub estimated_tokens: u32,
    pub content_sha256: String,
    #[ts(type = "unknown")]
    pub manifest: Value,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct VerificationReceiptView {
    pub id: VerificationReceiptId,
    pub run_id: AgentRunId,
    pub tool_call_id: Option<ToolCallId>,
    pub check_kind: String,
    pub outcome: VerificationOutcome,
    pub summary: String,
    pub artifact_sha256: Option<String>,
    pub subject: Option<VerificationSubject>,
    #[ts(type = "number | null")]
    pub exit_code: Option<i32>,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AgentChangedEvent {
    pub event: String,
    pub run_id: AgentRunId,
    #[ts(type = "number")]
    pub sequence: u64,
    pub status: AgentRunStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelToolDefinition {
    pub name: String,
    pub description: String,
    #[ts(type = "unknown")]
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelCapabilityProfile {
    pub streaming: bool,
    pub native_tools: bool,
    pub parallel_tools: bool,
    pub strict_schema: bool,
    pub usage: bool,
    pub cancellation: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_wire_enums_and_tagged_refs_are_exact() {
        assert_eq!(
            serde_json::to_string(&FieldMode::Build).unwrap(),
            "\"BUILD\""
        );
        assert_eq!(
            serde_json::to_string(&ReferenceType::HttpsUrl).unwrap(),
            "\"HTTPS_URL\""
        );
        assert_eq!(
            serde_json::to_value(FieldFocusV1::State {
                state_id: StateId::new("state")
            })
            .unwrap(),
            serde_json::json!({"kind":"STATE","state_id":"state"})
        );
        assert!(
            serde_json::from_value::<FieldFocusV1>(
                serde_json::json!({"kind":"STATE","state_id":"state","extra":true})
            )
            .is_err()
        );
    }

    #[test]
    fn default_surface_is_deterministic() {
        let layout = SurfaceLayoutV1::default_task();
        assert_eq!(layout.version, 1);
        assert_eq!(layout.primary.pane_id.0, "primary_task");
        assert!(layout.supporting.is_empty());
    }

    #[test]
    fn rich_result_image_reference_is_provider_neutral_and_path_free() {
        let object_id = LibraryObjectId::new("019c0000-0000-7000-8000-000000000001");
        let reference = ResultReference {
            id: ResultReferenceId::new(format!("resultref_{}", "a".repeat(32))),
            label: "Layout clipping".into(),
            target: ResultReferenceTarget::Image {
                source: ResultImageSource::Library,
                library_object_id: Some(object_id.clone()),
                screenshot_evidence_id: None,
                expected_sha256: "b".repeat(64),
                mime_type: "image/png".into(),
            },
            provenance: ResultReferenceProvenance::LibraryObject {
                library_object_id: object_id,
            },
        };
        let wire = serde_json::to_value(reference).unwrap();
        assert_eq!(wire["target"]["kind"], "IMAGE");
        assert_eq!(wire["target"]["source"], "LIBRARY");
        assert!(wire["target"].get("path").is_none());
        assert!(wire["target"].get("blob_ref").is_none());
        assert!(serde_json::from_value::<ResultReference>(wire).is_ok());
        assert!(serde_json::from_value::<ResultReference>(serde_json::json!({
            "id": format!("resultref_{}", "a".repeat(32)),
            "label": "unsafe",
            "target": {
                "kind": "IMAGE",
                "source": "FILE_URL",
                "library_object_id": "019c0000-0000-7000-8000-000000000001",
                "expected_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "mime_type": "image/svg+xml"
            },
            "provenance": {
                "kind": "LIBRARY_OBJECT",
                "library_object_id": "019c0000-0000-7000-8000-000000000001"
            }
        })).is_err());
    }

    #[test]
    fn screenshot_evidence_wire_is_bounded_typed_local_only_and_not_verification() {
        let screenshot_id = ScreenshotEvidenceId::new("019c0000-0000-7000-8000-000000000010");
        let view = ScreenshotEvidenceView {
            id: screenshot_id.clone(),
            content_sha256: "c".repeat(64),
            blob_ref: format!("blobs/objects/cc/{}", "c".repeat(64)),
            mime_type: "image/png".into(),
            byte_size: 1234,
            width: 640,
            height: 480,
            source_kind: ScreenshotEvidenceSourceKind::BrowserViewport,
            page_id: "page_019c0000-0000-7000-8000-000000000011".into(),
            navigation_generation: 7,
            captured_url: "https://fixture.example/page".into(),
            captured_at: 100,
            conversation_id: None,
            run_id: None,
            tool_call_id: None,
            verification_receipt_id: None,
            visibility: ScreenshotEvidenceVisibility::Internal,
            retention_class: ScreenshotEvidenceRetentionClass::LocalEvidence,
            status: ScreenshotEvidenceStatus::Active,
            export_policy: ScreenshotEvidenceExportPolicy::Excluded,
            sync_policy: ScreenshotEvidenceSyncPolicy::LocalOnly,
            created_at: 101,
        };
        let wire = serde_json::to_value(&view).unwrap();
        assert_eq!(wire["source_kind"], "BROWSER_VIEWPORT");
        assert_eq!(wire["visibility"], "INTERNAL");
        assert_eq!(wire["export_policy"], "EXCLUDED");
        assert_eq!(wire["sync_policy"], "LOCAL_ONLY");
        assert!(wire.get("outcome").is_none());
        assert!(wire.get("absolute_path").is_none());

        let reference = ResultReference {
            id: ResultReferenceId::new(format!("resultref_{}", "f".repeat(32))),
            label: "Current page".into(),
            target: ResultReferenceTarget::Image {
                source: ResultImageSource::ScreenshotEvidence,
                library_object_id: None,
                screenshot_evidence_id: Some(screenshot_id.clone()),
                expected_sha256: "c".repeat(64),
                mime_type: "image/png".into(),
            },
            provenance: ResultReferenceProvenance::ScreenshotEvidence {
                screenshot_evidence_id: screenshot_id,
            },
        };
        let reference_wire = serde_json::to_value(&reference).unwrap();
        assert_eq!(reference_wire["target"]["kind"], "IMAGE");
        assert_eq!(reference_wire["target"]["source"], "SCREENSHOT_EVIDENCE");
        assert!(reference_wire["target"].get("library_object_id").is_some());
        assert!(reference_wire["target"]["library_object_id"].is_null());
        assert!(serde_json::from_value::<ResultReference>(reference_wire).is_ok());
    }

    #[test]
    fn file_mutation_artifact_wire_uses_project_relative_identity_and_no_implicit_verification() {
        let content = ArtifactContentV1::FileMutation(FileMutationArtifactV1 {
            operation: FileMutationOperation::Modify,
            before: FileArtifactStateV1 {
                relative_path: "src/lib.rs".into(),
                exists: true,
                content_sha256: Some("a".repeat(64)),
                byte_length: Some(12),
            },
            after: FileArtifactStateV1 {
                relative_path: "src/lib.rs".into(),
                exists: true,
                content_sha256: Some("b".repeat(64)),
                byte_length: Some(13),
            },
        });
        let wire = serde_json::to_value(&content).unwrap();
        assert_eq!(wire["type"], "FILE_MUTATION");
        assert_eq!(wire["content"]["operation"], "MODIFY");
        assert_eq!(wire["content"]["after"]["relative_path"], "src/lib.rs");
        assert!(wire["content"].get("absolute_path").is_none());
        assert!(wire.get("verification").is_none());
        assert_eq!(
            serde_json::from_value::<ArtifactContentV1>(wire).unwrap(),
            content
        );
    }
}
