// Generated from Rust DTOs. Do not edit by hand.

export type FieldId = string;

export type PrincipalId = string;

export type DeviceId = string;

export type ObjectId = string;

export type StateId = string;

export type ActivityId = string;

export type RelationId = string;

export type PaneId = string;

export type SurfaceSnapshotId = string;

export type TraceId = string;

export type ProviderConfigId = string;

export type CaptureId = string;

export type ContextPackageId = string;

export type ModelInvocationId = string;

export type ConversationId = string;

export type MessageId = string;

export type ResultReferenceId = string;

export type AgentRunId = string;

export type AgentEventId = string;

export type ToolCallId = string;

export type ApprovalId = string;

export type ContextSnapshotId = string;

export type VerificationReceiptId = string;

export type ProfileId = string;

export type LibraryObjectId = string;

export type ScreenshotEvidenceId = string;

export type SyncChangeId = string;

export type ArtifactId = string;

export type ArtifactRevisionId = string;

export type AssetId = string;

export type ProtocolVersion = { major: number, minor: number, };

export type FipcErrorData = { code: string, trace_id: string, retryable: boolean, details: unknown, };

export type HelloRequest = Record<symbol, never>;

export type HelloResponse = { core_version: string, protocol: ProtocolVersion, schema_version: number, capabilities: Array<string>, };

export type BuildProvenanceView = { git_head: string, git_dirty: boolean, build_timestamp: string, source_fingerprint: string, agent_core_fingerprint: string, agent_behavior_profile_version: string, fast_edit_implementation_version: string, context_compiler_version: string, desktop_renderer_version: string, };

export type FieldLifecycle = "ACTIVE" | "COMPLETED" | "ARCHIVED";

export type FieldMode = "EXPLORE" | "THINK" | "BUILD" | "OPERATE" | "VERIFY";

export type FieldStateKind = "FACT" | "DECISION" | "ASSUMPTION" | "QUESTION" | "TASK" | "BLOCKER" | "RESULT";

export type StateStatus = "ACTIVE" | "RESOLVED" | "SUPERSEDED" | "RETRACTED";

export type StateTransitionTarget = "ACTIVE" | "RESOLVED" | "RETRACTED";

export type ObjectKind = "REFERENCE";

export type ReferenceType = "HTTPS_URL";

export type ObjectLifecycle = "ACTIVE" | "ARCHIVED";

export type RelationType = "SOURCED_FROM" | "SUPERSEDED_BY";

export type RelationLifecycle = "ACTIVE" | "RETRACTED";

export type ResourceType = "FIELD" | "STATE" | "OBJECT" | "RELATION";

export type FieldFocusV1 = { "kind": "STATE", state_id: StateId, } | { "kind": "REFERENCE", object_id: ObjectId, };

export type FocusSource = "NONE" | "TYPED_V1" | "LEGACY_TEXT" | "INVALID_IGNORED";

export type CreateFieldRequest = { title: string, goal: string | null, };

export type UpdateFocusRequest = { field_id: FieldId, expected_revision: number, focus: unknown, };

export type SetFieldFocusV1Request = { field_id: FieldId, expected_field_revision: number, focus: FieldFocusV1 | null, };

export type UpdateFieldModeRequest = { field_id: FieldId, expected_field_revision: number, mode: FieldMode | null, };

export type FieldReferenceRequest = { field_id: FieldId, };

export type FieldSummary = { id: FieldId, title: string, goal: string | null, current_mode: FieldMode | null, current_focus: unknown | null, revision: number, updated_at: number, };

export type FieldView = { id: FieldId, owner_principal_id: PrincipalId, title: string, goal: string | null, lifecycle_status: FieldLifecycle, current_mode: FieldMode | null, current_focus: unknown | null, revision: number, created_at: number, updated_at: number, };

export type StateView = { id: StateId, field_id: FieldId, kind: FieldStateKind, content: string, status: StateStatus, confidence: number | null, created_by: PrincipalId, source_activity_id: ActivityId, revision: number, created_at: number, updated_at: number, };

export type CreateStateRequest = { field_id: FieldId, kind: FieldStateKind, content: string, confidence: number | null, };

export type ReviseStateRequest = { field_id: FieldId, state_id: StateId, expected_state_revision: number, content: string, confidence: number | null, };

export type TransitionStateRequest = { field_id: FieldId, state_id: StateId, expected_state_revision: number, target: StateTransitionTarget, };

export type SupersedeStateRequest = { field_id: FieldId, state_id: StateId, expected_state_revision: number, replacement_content: string, replacement_confidence: number | null, };

export type StateReferenceRequest = { field_id: FieldId, state_id: StateId, };

export type StateCursor = { updated_at: number, state_id: StateId, };

export type ListStatesRequest = { field_id: FieldId, kind: FieldStateKind | null, status: StateStatus | null, cursor: StateCursor | null, limit: number | null, };

export type ReferenceView = { id: ObjectId, field_id: FieldId, owner_principal_id: PrincipalId, created_by: PrincipalId, source_activity_id: ActivityId, kind: ObjectKind, title: string, reference_type: ReferenceType, canonical_url: string, lifecycle: ObjectLifecycle, revision: number, created_at: number, updated_at: number, };

export type CreateReferenceRequest = { field_id: FieldId, title: string, url: string, };

export type ReviseReferenceRequest = { field_id: FieldId, object_id: ObjectId, expected_object_revision: number, title: string, url: string, };

export type ArchiveReferenceRequest = { field_id: FieldId, object_id: ObjectId, expected_object_revision: number, };

export type RestoreReferenceRequest = { field_id: FieldId, object_id: ObjectId, expected_object_revision: number, };

export type ReferenceRequest = { field_id: FieldId, object_id: ObjectId, };

export type ReferenceCursor = { updated_at: number, object_id: ObjectId, };

export type ListReferencesRequest = { field_id: FieldId, lifecycle: ObjectLifecycle | null, cursor: ReferenceCursor | null, limit: number | null, };

export type ResourceRef = { "kind": "FIELD", field_id: FieldId, } | { "kind": "STATE", state_id: StateId, } | { "kind": "REFERENCE", object_id: ObjectId, } | { "kind": "RELATION", relation_id: RelationId, } | { "kind": "CAPTURE", capture_id: CaptureId, } | { "kind": "PROVIDER_CONFIG", provider_config_id: ProviderConfigId, };

export type LineageEndpointRef = { "kind": "STATE", state_id: StateId, } | { "kind": "REFERENCE", object_id: ObjectId, };

export type RelationView = { id: RelationId, field_id: FieldId, relation_type: RelationType, from: LineageEndpointRef, to: LineageEndpointRef, lifecycle: RelationLifecycle, created_by: PrincipalId, revision: number, created_at: number, updated_at: number, };

export type AttachReferenceSourceRequest = { field_id: FieldId, state_id: StateId, reference_id: ObjectId, };

export type RetractReferenceSourceRequest = { field_id: FieldId, relation_id: RelationId, expected_relation_revision: number, };

export type RelationCursor = { created_at: number, relation_id: RelationId, };

export type ListRelationsRequest = { field_id: FieldId, relation_type: RelationType | null, lifecycle: RelationLifecycle | null, endpoint: LineageEndpointRef | null, cursor: RelationCursor | null, limit: number | null, };

export type ActivityAction = "FIELD_CREATED" | "FIELD_ARCHIVED" | "FIELD_FOCUS_UPDATED" | "FIELD_MODE_UPDATED" | "STATE_CREATED" | "STATE_REVISED" | "STATE_STATUS_CHANGED" | "STATE_SUPERSEDED" | "REFERENCE_CREATED" | "REFERENCE_REVISED" | "REFERENCE_ARCHIVED" | "REFERENCE_RESTORED" | "REFERENCE_SOURCE_ATTACHED" | "REFERENCE_SOURCE_RETRACTED" | "PROVIDER_CONFIG_CREATED" | "PROVIDER_CONFIG_UPDATED" | "PROVIDER_CONFIG_REMOVED" | "CAPTURE_CREATED" | "CAPTURE_ATTACHED" | "CAPTURE_PROMOTED" | "CAPTURE_ARCHIVED" | "CAPTURE_RESTORED" | "MODEL_INVOCATION_COMPLETED" | "MODEL_INVOCATION_FAILED";

export type ActivityView = { id: ActivityId, field_id: FieldId | null, actor_principal_id: PrincipalId, action: ActivityAction, target: ResourceRef | null, summary: string | null, trace_id: TraceId, created_at: number, };

export type ActivityCursor = { created_at: number, activity_id: ActivityId, };

export type ListActivitiesRequest = { field_id: FieldId, cursor: ActivityCursor | null, limit: number | null, };

export type Page<T, C> = { items: Array<T>, next_cursor: C | null, };

export type RealityMutationResult<T> = { resource: T, field_revision: number, };

export type SupersedeStateResult = { previous: StateView, replacement: StateView, relation: RelationView, field_revision: number, };

export type SurfaceTemplateV1 = "PRIMARY_ONLY" | "PRIMARY_SUPPORT_RIGHT" | "PRIMARY_TWO_SUPPORTS_RIGHT";

export type SurfacePrimitiveV1 = "TASK_PANE" | "REFERENCE_PANE";

export type PaneBindingV1 = { "kind": "FIELD_TASKS" } | { "kind": "REFERENCE", object_id: ObjectId, };

export type SurfacePaneV1 = { pane_id: PaneId, primitive: SurfacePrimitiveV1, binding: PaneBindingV1, collapsed: boolean, };

export type SurfaceLayoutV1 = { version: number, template: SurfaceTemplateV1, primary: SurfacePaneV1, supporting: Array<SurfacePaneV1>, focused_pane_id: PaneId, };

export type SaveSurfaceSnapshotRequest = { field_id: FieldId, layout: unknown, open_objects: Array<ObjectId>, };

export type SaveSurfaceSnapshotV1Request = { field_id: FieldId, layout: SurfaceLayoutV1, };

export type SurfaceSnapshotView = { id: SurfaceSnapshotId, field_id: FieldId, device_id: DeviceId, observed_field_revision: number, layout: unknown, open_objects: Array<ObjectId>, created_at: number, };

export type SurfaceSnapshotV1View = { id: SurfaceSnapshotId, field_id: FieldId, device_id: DeviceId, observed_field_revision: number, layout: SurfaceLayoutV1, open_reference_ids: Array<ObjectId>, created_at: number, };

export type SurfaceResumeView = { field: FieldView, snapshot: SurfaceSnapshotView | null, };

export type SnapshotFreshness = "NONE" | "CURRENT" | "STALE" | "INVALID";

export type LayoutSource = "DEFAULT" | "SNAPSHOT_V1" | "LEGACY_PHASE01_FALLBACK" | "INVALID_IGNORED";

export type ExternalChangeAssessment = "NOT_EVALUATED_PHASE02";

export type ResumeStateItem = { id: StateId, kind: FieldStateKind, content_excerpt: string, revision: number, updated_at: number, };

export type ContinuationReason = "TYPED_FOCUS" | "LEGACY_TEXT_FOCUS" | "ACTIVE_BLOCKER" | "ACTIVE_QUESTION" | "ACTIVE_TASK" | "LAST_ACTIVITY" | "FIELD_OVERVIEW";

export type ContinuationTarget = { "kind": "STATE", state_id: StateId, } | { "kind": "REFERENCE", object_id: ObjectId, } | { "kind": "LEGACY_TEXT", label: string, } | { "kind": "FIELD_OVERVIEW" };

export type ResumeContinuation = { reason: ContinuationReason, target: ContinuationTarget, };

export type FieldResumeV1View = { field: FieldView, field_revision: number, focus_source: FocusSource, typed_focus: FieldFocusV1 | null, legacy_text_focus: string | null, snapshot_freshness: SnapshotFreshness, layout_source: LayoutSource, layout: SurfaceLayoutV1, open_reference_ids: Array<ObjectId>, unavailable_reference_ids: Array<ObjectId>, active_blockers: Array<ResumeStateItem>, active_questions: Array<ResumeStateItem>, active_tasks: Array<ResumeStateItem>, last_activity: ActivityView | null, continuation: ResumeContinuation, external_changes: ExternalChangeAssessment, };

export type FieldChangeKind = "created" | "focus_updated" | "mode_updated" | "state_created" | "state_revised" | "state_status_changed" | "state_superseded" | "reference_created" | "reference_revised" | "reference_archived" | "reference_restored" | "reference_source_attached" | "reference_source_retracted";

export type DomainEventDTO = { event: string, field_id: FieldId, change: FieldChangeKind, resource: ResourceRef | null, revision: number, trace_id: TraceId, };

export type CoreHealthState = "STARTING" | "READY" | "UNAVAILABLE" | "DEGRADED" | "SHUTTING_DOWN";

export type HealthDTO = { state: CoreHealthState, core_version: string, protocol: ProtocolVersion, schema_version: number, pid: number, db_path: string, };

export type ProviderKind = "OPENAI" | "ANTHROPIC" | "OPENAI_COMPATIBLE";

export type EndpointClass = "OFFICIAL" | "CUSTOM";

export type ProviderLifecycle = "ACTIVE" | "DISABLED" | "REMOVED";

export type ProviderConfigView = { id: ProviderConfigId, provider_kind: ProviderKind, display_name: string, endpoint_class: EndpointClass, base_url: string | null, default_model: string, lifecycle_status: ProviderLifecycle, credential_present: boolean, revision: number, created_at: number, updated_at: number, };

export type CreateProviderConfigRequest = { provider_kind: ProviderKind, display_name: string, base_url: string | null, default_model: string, custom_endpoint_acknowledged: boolean, };

export type UpdateProviderConfigRequest = { provider_config_id: ProviderConfigId, expected_revision: number, display_name: string, base_url: string | null, default_model: string, custom_endpoint_acknowledged: boolean, };

export type ProviderConfigRequest = { provider_config_id: ProviderConfigId, };

export type StoreCredentialRequest = { provider_config_id: ProviderConfigId, secret: string, };

export type ModelIntent = "ASK" | "CONTINUE";

export type ResponseMode = "TEXT";

export type ContextChipKind = "CURRENT_FIELD" | "CURRENT_FOCUS" | "CURRENT_PAGE" | "CURRENT_SELECTION" | "CAPTURE" | "USER_NOTE";

export type ContextSensitivity = "NORMAL" | "SENSITIVE" | "BLOCKED";

export type ContextCompleteness = "COMPLETE" | "PARTIAL";

export type ContextChip = { kind: ContextChipKind, source_identity: string, source_revision_or_navigation_generation: string, display_label: string, content: string, sensitivity: ContextSensitivity, completeness: ContextCompleteness, };

export type ModelInvocationRequest = { invocation_id: ModelInvocationId, context_package_id: ContextPackageId, provider_config_id: ProviderConfigId, model_id: string, intent: ModelIntent, user_input: string, context_package: Array<ContextChip>, response_mode: ResponseMode, };

export type StartModelInvocationRequest = { provider_config_id: ProviderConfigId, model_id: string | null, intent: ModelIntent, user_input: string, context_package: Array<ContextChip>, response_mode: ResponseMode, };

export type StartModelInvocationResult = { invocation_id: ModelInvocationId, context_package_id: ContextPackageId, };

export type CancelModelInvocationRequest = { invocation_id: ModelInvocationId, };

export type ModelUsage = { input_tokens: bigint | null, output_tokens: bigint | null, };

export type ToolProposal = { name: string, arguments: unknown, provider_opaque_id: string | null, };

export type ModelInvocationEventKind = "STARTED" | "OUTPUT_TEXT_DELTA" | "TOOL_PROPOSAL" | "USAGE" | "COMPLETED" | "CANCELLED" | "FAILED";

export type ModelInvocationEvent = { event: string, invocation_id: ModelInvocationId, kind: ModelInvocationEventKind, text_delta: string | null, tool_proposal: ToolProposal | null, usage: ModelUsage | null, error_code: string | null, };

export type CaptureKind = "TEXT" | "PAGE" | "SELECTION" | "MODEL_OUTPUT" | "FIELD_EXCERPT";

export type CapturePlacement = "INBOX" | "ATTACHED" | "PROMOTED";

export type CaptureLifecycle = "ACTIVE" | "ARCHIVED";

export type CaptureSourceKind = "USER_INPUT" | "REMOTE_PAGE" | "REMOTE_SELECTION" | "MODEL_RESPONSE" | "FIELD_RESOURCE";

export type CaptureSource = { kind: CaptureSourceKind, title: string | null, uri: string | null, field_id: FieldId | null, resource_type: string | null, resource_id: string | null, resource_revision: number | null, provider_config_id: ProviderConfigId | null, provider_model_id: string | null, provider_invocation_id: ModelInvocationId | null, is_partial: boolean, };

export type CaptureView = { id: CaptureId, kind: CaptureKind, title: string, content: string, placement_status: CapturePlacement, lifecycle_status: CaptureLifecycle, attached_field_id: FieldId | null, promoted_as: string | null, source: CaptureSource, revision: number, created_at: number, updated_at: number, };

export type CreateCaptureRequest = { kind: CaptureKind, title: string, content: string, source: CaptureSource, };

export type CaptureRequest = { capture_id: CaptureId, };

export type MutateCaptureRequest = { capture_id: CaptureId, expected_revision: number, };

export type AttachCaptureRequest = { capture_id: CaptureId, field_id: FieldId, expected_revision: number, };

export type PromoteCaptureRequest = { capture_id: CaptureId, field_id: FieldId | null, expected_revision: number, };

export type CaptureCursor = { updated_at: number, capture_id: CaptureId, };

export type ListCapturesRequest = { placement: CapturePlacement | null, lifecycle: CaptureLifecycle | null, field_id: FieldId | null, cursor: CaptureCursor | null, limit: number | null, };

export type CaptureChangedEvent = { event: string, capture_id: CaptureId, placement_status: CapturePlacement, lifecycle_status: CaptureLifecycle, attached_field_id: FieldId | null, revision: number, };

export type LibraryObjectKind = "FILE" | "WEB";

export type LibraryMediaKind = "DOCUMENT" | "IMAGE" | "AUDIO" | "VIDEO" | "OTHER" | "WEB";

export type LibraryLifecycle = "ACTIVE" | "TOMBSTONE";

export type LibraryObjectView = { id: LibraryObjectId, kind: LibraryObjectKind, media_kind: LibraryMediaKind, title: string, original_source: string | null, original_filename: string | null, mime_type: string | null, size: number | null, blob_ref: string | null, content_hash: string | null, metadata: unknown, lifecycle: LibraryLifecycle, revision: number, updated_by_device: DeviceId, created_at: number, updated_at: number, deleted_at: number | null, };

export type CreateLibraryFileRequest = { title: string, original_source: string, original_filename: string, mime_type: string | null, media_kind: LibraryMediaKind, size: number, blob_ref: string, content_hash: string, metadata: unknown, };

export type SaveWebLibraryRequest = { url: string, title: string, source: string, selected_content: string | null, metadata: unknown, };

export type LibraryObjectRequest = { library_object_id: LibraryObjectId, };

export type DeleteLibraryObjectRequest = { library_object_id: LibraryObjectId, expected_revision: number, };

export type ListLibraryObjectsRequest = { media_kind: LibraryMediaKind | null, include_deleted: boolean, limit: number | null, };

export type ScreenshotEvidenceSourceKind = "BROWSER_VIEWPORT";

export type ScreenshotEvidenceVisibility = "INTERNAL";

export type ScreenshotEvidenceRetentionClass = "LOCAL_EVIDENCE";

export type ScreenshotEvidenceStatus = "ACTIVE";

export type ScreenshotEvidenceExportPolicy = "EXCLUDED";

export type ScreenshotEvidenceSyncPolicy = "LOCAL_ONLY";

export type ScreenshotEvidenceView = { id: ScreenshotEvidenceId, content_sha256: string, blob_ref: string, mime_type: string, byte_size: number, width: number, height: number, source_kind: ScreenshotEvidenceSourceKind, page_id: string, navigation_generation: number, captured_url: string, captured_at: number, conversation_id: ConversationId | null, run_id: AgentRunId | null, tool_call_id: ToolCallId | null, verification_receipt_id: VerificationReceiptId | null, visibility: ScreenshotEvidenceVisibility, retention_class: ScreenshotEvidenceRetentionClass, status: ScreenshotEvidenceStatus, export_policy: ScreenshotEvidenceExportPolicy, sync_policy: ScreenshotEvidenceSyncPolicy, created_at: number, };

export type CreateScreenshotEvidenceRequest = { png_data_url: string, source_kind: ScreenshotEvidenceSourceKind, page_id: string, navigation_generation: number, captured_url: string, captured_at: number, conversation_id: ConversationId | null, run_id: AgentRunId | null, tool_call_id: ToolCallId | null, verification_receipt_id: VerificationReceiptId | null, };

export type ScreenshotEvidenceRequest = { screenshot_evidence_id: ScreenshotEvidenceId, };

export type ListScreenshotEvidenceByRunRequest = { run_id: AgentRunId, };

export type ListScreenshotEvidenceByVerificationRequest = { verification_receipt_id: VerificationReceiptId, };

export type ScreenshotEvidencePreviewRequest = { screenshot_evidence_id: ScreenshotEvidenceId, expected_content_sha256: string, };

export type ScreenshotEvidencePreviewView = { screenshot_evidence_id: ScreenshotEvidenceId, source: ResultImageSource, mime_type: string, byte_size: number, width: number, height: number, content_sha256: string, data_url: string, };

export type PortableBlobManifestEntryView = { blob_ref: string, content_sha256: string, byte_size: number, };

export type ArtifactType = "DOCUMENT" | "PRESENTATION" | "DIAGRAM" | "SPREADSHEET" | "FILE_MUTATION";

export type FileMutationOperation = "CREATE" | "MODIFY" | "DELETE" | "MOVE" | "RESTORE";

export type FileArtifactStateV1 = { relative_path: string, exists: boolean, content_sha256: string | null, byte_length: number | null, };

export type FileMutationArtifactV1 = { operation: FileMutationOperation, before: FileArtifactStateV1, after: FileArtifactStateV1, };

export type ArtifactRefV1 = { artifact_id: ArtifactId, revision_id: ArtifactRevisionId, expected_type: ArtifactType, semantic_sha256: string, };

export type AssetMediaType = "image/png";

export type ArtifactAssetRefV1 = { asset_id: AssetId, content_sha256: string, media_type: AssetMediaType, byte_length: number, };

export type DocumentImageSizeIntentV1 = "DOCUMENT_WIDTH_BOUNDED";

export type SpreadsheetRangeEmbedV1 = { artifact_ref: ArtifactRefV1, sheet_id: SpreadsheetSheetId, start_row: number, start_column: number, end_row: number, end_column: number, };

export type DocumentArtifact = { title: string | null, blocks: Array<DocumentBlock>, };

export type DocumentBlock = { "kind": "HEADING", level: number, text: string, } | { "kind": "PARAGRAPH", text: string, } | { "kind": "BULLET_LIST", items: Array<string>, } | { "kind": "TABLE", rows: Array<Array<string>>, } | { "kind": "SPREADSHEET_RANGE", source: SpreadsheetRangeEmbedV1, } | { "kind": "INLINE_IMAGE", source: ArtifactAssetRefV1, size_intent: DocumentImageSizeIntentV1, alt_text: string | null, };

export type PresentationArtifact = { slides: Array<PresentationSlide>, };

export type PresentationSlide = { layout: PresentationLayout, title: string, regions: Array<SlideRegion>, };

export type PresentationLayout = "TITLE" | "TITLE_AND_BODY" | "TWO_COLUMN";

export type SlideRegion = { slot: SlideSlot, blocks: Array<PresentationBlock>, };

export type SlideSlot = "BODY" | "LEFT" | "RIGHT";

export type PresentationBlock = { "kind": "PARAGRAPH", text: string, } | { "kind": "BULLET_LIST", items: Array<string>, } | { "kind": "IMAGE", source: ArtifactAssetRefV1, fit: PresentationImageFitV1, };

export type PresentationImageFitV1 = "CONTAIN";

export type DiagramNodeId = string;

export type DiagramEdgeId = string;

export type DiagramGroupId = string;

export type SpreadsheetSheetId = string;

export type DiagramArtifactV1 = { title: string | null, description: string | null, layout: DiagramLayoutIntentV1, nodes: Array<DiagramNodeV1>, edges: Array<DiagramEdgeV1>, groups: Array<DiagramGroupV1>, };

export type DiagramLayoutIntentV1 = { strategy: DiagramLayoutStrategy, direction: DiagramLayoutDirection, };

export type DiagramLayoutStrategy = "LAYERED_AUTO";

export type DiagramLayoutDirection = "LEFT_TO_RIGHT" | "TOP_TO_BOTTOM";

export type DiagramNodeV1 = { node_id: DiagramNodeId, label: string, description: string | null, semantic_kind: DiagramNodeKind, presentation: DiagramNodePresentationIntentV1 | null, };

export type DiagramNodeKind = "GENERIC" | "PERSON" | "SYSTEM" | "SERVICE" | "DATABASE" | "PROCESS" | "DOCUMENT";

export type DiagramNodePresentationIntentV1 = { shape: DiagramNodeShape, emphasis: DiagramEmphasis, };

export type DiagramNodeShape = "AUTO" | "RECTANGLE" | "ROUNDED_RECT" | "ELLIPSE";

export type DiagramEmphasis = "NORMAL" | "EMPHASIS";

export type DiagramEdgeV1 = { edge_id: DiagramEdgeId, source_node_id: DiagramNodeId, target_node_id: DiagramNodeId, label: string | null, relation_kind: DiagramRelationKind, direction: DiagramEdgeDirection, presentation: DiagramEdgePresentationIntentV1 | null, };

export type DiagramRelationKind = "RELATION" | "FLOW" | "DEPENDS_ON" | "CONTAINS";

export type DiagramEdgeDirection = "FORWARD" | "BIDIRECTIONAL" | "NONE";

export type DiagramEdgePresentationIntentV1 = { emphasis: DiagramEmphasis, };

export type DiagramGroupV1 = { group_id: DiagramGroupId, label: string, semantic_kind: DiagramGroupKind, member_node_ids: Array<DiagramNodeId>, };

export type DiagramGroupKind = "BOUNDARY" | "LAYER" | "CLUSTER";

export type SpreadsheetArtifactV1 = { title: string | null, sheets: Array<SpreadsheetSheetV1>, };

export type SpreadsheetSheetV1 = { sheet_id: SpreadsheetSheetId, name: string, cells: Array<SpreadsheetCellV1>, };

export type SpreadsheetCellV1 = { row: number, column: number, value: SpreadsheetLiteralV1, format: SpreadsheetFormatIntentV1 | null, presentation: SpreadsheetCellPresentationIntentV1 | null, };

export type SpreadsheetLiteralV1 = { "kind": "STRING", value: string, } | { "kind": "DECIMAL", value: SpreadsheetDecimalV1, } | { "kind": "BOOLEAN", value: boolean, };

export type SpreadsheetDecimalV1 = string;

export type SpreadsheetFormatIntentV1 = "GENERAL" | "TEXT" | "INTEGER" | "DECIMAL_2" | "PERCENT_2";

export type SpreadsheetCellPresentationIntentV1 = { emphasis: SpreadsheetCellEmphasis, alignment: SpreadsheetCellAlignment, wrap: boolean, };

export type SpreadsheetCellEmphasis = "NORMAL" | "HEADER" | "TOTAL";

export type SpreadsheetCellAlignment = "AUTO" | "LEFT" | "CENTER" | "RIGHT";

export type ArtifactContentV1 = { "type": "DOCUMENT", "content": DocumentArtifact } | { "type": "PRESENTATION", "content": PresentationArtifact } | { "type": "DIAGRAM", "content": DiagramArtifactV1 } | { "type": "SPREADSHEET", "content": SpreadsheetArtifactV1 } | { "type": "FILE_MUTATION", "content": FileMutationArtifactV1 };

export type ArtifactMutationKind = "CREATE" | "UPDATE";

export type ArtifactView = { artifact_id: ArtifactId, profile_id: ProfileId, artifact_type: ArtifactType, title: string | null, project_field_id: FieldId | null, current_revision_id: ArtifactRevisionId, created_from_conversation_id: ConversationId | null, created_by_agent_run_id: AgentRunId | null, updated_by_device: DeviceId, created_at: number, updated_at: number, archived_at: number | null, };

export type ArtifactListCursor = { updated_at: number, artifact_id: ArtifactId, };

export type ArtifactListView = { artifacts: Array<ArtifactView>, next_cursor: ArtifactListCursor | null, };

export type ArtifactRevisionMetadataView = { revision_id: ArtifactRevisionId, artifact_id: ArtifactId, sequence: number, parent_revision_id: ArtifactRevisionId | null, mutation_kind: ArtifactMutationKind, content_schema_version: number, semantic_sha256: string, created_from_conversation_id: ConversationId | null, created_by_agent_run_id: AgentRunId | null, created_by_tool_call_id: ToolCallId, created_at: number, };

export type ArtifactHistoryView = { artifact: ArtifactView, revisions: Array<ArtifactRevisionMetadataView>, next_before_sequence: number | null, };

export type ArtifactRevisionView = { revision_id: ArtifactRevisionId, artifact_id: ArtifactId, sequence: number, parent_revision_id: ArtifactRevisionId | null, mutation_kind: ArtifactMutationKind, content_schema_version: number, semantic_sha256: string, content: ArtifactContentV1, created_from_conversation_id: ConversationId | null, created_by_agent_run_id: AgentRunId | null, created_by_tool_call_id: ToolCallId, created_at: number, };

export type ArtifactReadView = { artifact: ArtifactView, revision: ArtifactRevisionView, };

export type FileArtifactReviewState = "UNREVIEWED" | "REVIEWED";

export type FileArtifactApplicability = "CURRENT" | "CHANGED_SINCE";

export type FileArtifactUndoAvailability = "AVAILABLE" | "BLOCKED_CHANGED_SINCE" | "DEFERRED_OPERATION" | "CONTENT_UNAVAILABLE";

export type FileArtifactRevisionReviewView = { artifact_id: ArtifactId, revision_id: ArtifactRevisionId, sequence: number, source_run_id: AgentRunId, source_tool_call_id: ToolCallId, operation: FileMutationOperation, before: FileArtifactStateV1, after: FileArtifactStateV1, before_text: string | null, after_text: string | null, review_state: FileArtifactReviewState, applicability: FileArtifactApplicability, undo_availability: FileArtifactUndoAvailability, verifications: Array<VerificationReceiptView>, };

export type FileArtifactReviewListView = { revisions: Array<FileArtifactRevisionReviewView>, };

export type AssetView = { asset_id: AssetId, profile_id: ProfileId, media_type: AssetMediaType, content_sha256: string, byte_length: number, width: number, height: number, blob_ref: string, created_from_conversation_id: ConversationId | null, created_by_agent_run_id: AgentRunId | null, created_by_tool_call_id: ToolCallId, created_at: number, };

export type ListArtifactsRequest = { cursor: ArtifactListCursor | null, limit: number | null, include_archived: boolean, };

export type ReadArtifactRequest = { artifact_id: ArtifactId, revision_id: ArtifactRevisionId | null, };

export type ArtifactHistoryRequest = { artifact_id: ArtifactId, before_sequence: number | null, limit: number | null, };

export type ListFileArtifactReviewsRequest = { run_id: AgentRunId, };

export type MarkFileArtifactReviewedRequest = { artifact_id: ArtifactId, revision_id: ArtifactRevisionId, };

export type UndoFileArtifactRevisionRequest = { source_run_id: AgentRunId, artifact_id: ArtifactId, revision_id: ArtifactRevisionId, };

export type AssetPreviewRequest = { asset_id: AssetId, expected_content_sha256: string, };

export type AssetPreviewView = { asset_id: AssetId, media_type: AssetMediaType, content_sha256: string, byte_length: number, width: number, height: number, data_url: string, };

export type DiagramPreviewRequest = { artifact_id: ArtifactId, revision_id: ArtifactRevisionId, };

export type DiagramPreviewView = { artifact_id: ArtifactId, revision_id: ArtifactRevisionId, semantic_sha256: string, render_sha256: string, data_url: string, };

export type VerificationSubject = { "kind": "ARTIFACT_REVISION", artifact_id: ArtifactId, revision_id: ArtifactRevisionId, semantic_sha256: string, };

export type ProfileView = { profile_id: ProfileId, schema_version: number, created_at: number, device_id: DeviceId, };

export type SyncOperation = "CREATE" | "UPDATE" | "TOMBSTONE";

export type SyncChangeView = { change_id: SyncChangeId, profile_id: ProfileId, device_id: DeviceId, entity_type: string, entity_id: string, operation: SyncOperation, revision: number, changed_at: number, };

export type ProjectView = { field_id: FieldId, title: string, goal: string | null, root_path: string, revision: number, created_at: number, updated_at: number, };

export type CreateProjectRequest = { title: string, goal: string | null, root_path: string, };

export type UpdateProjectRequest = { field_id: FieldId, expected_revision: number, title: string, };

export type ArchiveProjectRequest = { field_id: FieldId, expected_revision: number, };

export type ProjectRequest = { field_id: FieldId, };

export type RebindProjectRequest = { field_id: FieldId, root_path: string, };

export type ConversationLifecycle = "ACTIVE" | "ARCHIVED";

export type ConversationView = { id: ConversationId, field_id: FieldId, title: string, provider_config_id: ProviderConfigId | null, model_id: string | null, lifecycle_status: ConversationLifecycle, revision: number, created_at: number, updated_at: number, };

export type CreateConversationRequest = { field_id: FieldId, title: string, provider_config_id: ProviderConfigId | null, model_id: string | null, };

export type ConversationRequest = { conversation_id: ConversationId, };

export type UpdateConversationRequest = { conversation_id: ConversationId, expected_revision: number, title: string, provider_config_id: ProviderConfigId | null, model_id: string | null, };

export type ArchiveConversationRequest = { conversation_id: ConversationId, expected_revision: number, };

export type ConversationMessageRole = "USER" | "ASSISTANT";

export type ConversationMessageStatus = "COMPLETED" | "CANCELLED" | "FAILED";

export type ResultImageSource = "LIBRARY" | "SCREENSHOT_EVIDENCE";

export type ResultReferenceTarget = { "kind": "PROJECT_FILE", field_id: FieldId, relative_path: string, expected_sha256: string | null, } | { "kind": "CODE_RANGE", field_id: FieldId, relative_path: string, line_start: number, line_end: number, expected_sha256: string | null, } | { "kind": "WEB_REFERENCE", field_id: FieldId, reference_id: ObjectId, https_url: string, } | { "kind": "IMAGE", source: ResultImageSource, library_object_id?: LibraryObjectId, screenshot_evidence_id?: ScreenshotEvidenceId, expected_sha256: string, mime_type: string, };

export type ResultReferenceProvenance = { "kind": "PROJECT_CONTEXT" } | { "kind": "TOOL_RECEIPT", tool_call_id: ToolCallId, } | { "kind": "SAVED_REFERENCE", reference_id: ObjectId, } | { "kind": "LIBRARY_OBJECT", library_object_id: LibraryObjectId, } | { "kind": "SCREENSHOT_EVIDENCE", screenshot_evidence_id: ScreenshotEvidenceId, };

export type ResultReference = { id: ResultReferenceId, label: string, target: ResultReferenceTarget, provenance: ResultReferenceProvenance, };

export type ConversationMessageView = { id: MessageId, conversation_id: ConversationId, role: ConversationMessageRole, content: string, status: ConversationMessageStatus, provider_config_id: ProviderConfigId | null, model_id: string | null, invocation_id: ModelInvocationId | null, references: Array<ResultReference>, created_at: number, };

export type CreateConversationMessageRequest = { conversation_id: ConversationId, role: ConversationMessageRole, content: string, status: ConversationMessageStatus, provider_config_id: ProviderConfigId | null, model_id: string | null, invocation_id: ModelInvocationId | null, references: Array<ResultReference>, };

export type ListConversationMessagesRequest = { conversation_id: ConversationId, };

export type AgentRunStatus = "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

export type AgentPermission = "READ_ONLY" | "REVIEW_CHANGES" | "FULL_CONTROL";

export type AgentEventKind = "RUN_CREATED" | "RUN_STARTED" | "RUN_PAUSED" | "RUN_RESUMED" | "RUN_COMPLETED" | "RUN_FAILED" | "RUN_CANCELLED" | "PHASE_CHANGED" | "STEP_STARTED" | "CONTEXT_COMPILED" | "MODEL_STARTED" | "MODEL_TEXT_DELTA" | "ASSISTANT_NARRATIVE" | "MODEL_COMPLETED" | "MODEL_FAILED" | "TOOL_PROPOSED" | "APPROVAL_REQUESTED" | "APPROVAL_RESOLVED" | "TOOL_STARTED" | "TOOL_PROGRESS" | "TOOL_COMPLETED" | "TOOL_FAILED" | "TOOL_DENIED" | "TOOL_CANCELLED" | "TOOL_UNKNOWN" | "VERIFICATION_RECORDED" | "CHECKPOINT_CREATED" | "RECOVERY_STARTED" | "RECOVERY_RECONCILED";

export type AgentToolEffect = "OBSERVE" | "WORKSPACE_WRITE" | "PROCESS" | "NETWORK" | "DESTRUCTIVE";

export type AgentToolStatus = "PROPOSED" | "WAITING_APPROVAL" | "RUNNING" | "COMPLETED" | "FAILED" | "DENIED" | "CANCELLED" | "UNKNOWN";

export type AgentPolicyDecision = "ALLOW" | "ASK" | "DENY";

export type ApprovalDecision = "ALLOW_ONCE" | "DENY";

export type VerificationOutcome = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

export type AgentRunView = { id: AgentRunId, field_id: FieldId, conversation_id: ConversationId, provider_config_id: ProviderConfigId, model_id: string, task: string, permission: AgentPermission, status: AgentRunStatus, current_step: number, max_steps: number, next_sequence: number, error_code: string | null, created_at: number, updated_at: number, finished_at: number | null, };

export type ModelUsageReportRequest = { since: number | null, offset: number, limit: number, };

export type TaskTokenUsage = { input_tokens: number, output_tokens: number, reported_calls: number, unreported_calls: number, };

export type ModelUsageTask = { run_id: AgentRunId, conversation_id: ConversationId, title: string, provider_config_id: ProviderConfigId, model_id: string, status: AgentRunStatus, created_at: number, usage: TaskTokenUsage, };

export type ModelUsageGroup = { provider_config_id: ProviderConfigId, model_id: string, usage: TaskTokenUsage, };

export type ModelUsageDay = { date: string, usage: TaskTokenUsage, };

export type ModelUsageReport = { usage: TaskTokenUsage, models: Array<ModelUsageGroup>, daily: Array<ModelUsageDay>, tasks: Array<ModelUsageTask>, active: Array<ModelUsageTask>, total_tasks: number, };

export type AgentInputAttachment = { id: string, filename: string, mime_type: string, size: number, width: number, height: number, source: string, data_url: string, };

export type ActiveArtifactViewMode = "CURRENT" | "HISTORICAL";

export type ActiveArtifactContext = { artifact_id: ArtifactId, artifact_type: ArtifactType, viewed_revision_id: ArtifactRevisionId, current_revision_id: ArtifactRevisionId, view_mode: ActiveArtifactViewMode, archived: boolean, selected_slide: number | null, selected_sheet_id: SpreadsheetSheetId | null, };

export type StartAgentRunRequest = { resource_budget?: AgentResourceBudget, field_id: FieldId, conversation_id: ConversationId, user_message_id: MessageId | null, provider_config_id: ProviderConfigId, model_id: string | null, task: string, permission: AgentPermission, max_steps: number | null, attachments: Array<AgentInputAttachment> | null, active_work_surface?: ActiveArtifactContext, };

export type AgentResourceBudget = { max_execution_ms: number, max_input_tokens: number, max_output_tokens: number, };

export type SetArtifactArchiveStateCommandRequest = { field_id: FieldId, conversation_id: ConversationId, provider_config_id: ProviderConfigId, model_id: string | null, artifact_id: ArtifactId, archived: boolean, };

export type AgentRunRequest = { run_id: AgentRunId, };

export type ResumeAgentRunRequest = { resource_budget?: AgentResourceBudget, run_id: AgentRunId, user_message_id?: MessageId, attachments?: Array<AgentInputAttachment>, };

export type ListAgentRunsRequest = { conversation_id: ConversationId, };

export type AgentEventView = { id: AgentEventId, run_id: AgentRunId, sequence: number, schema_version: number, kind: AgentEventKind, payload: unknown, created_at: number, };

export type ListAgentEventsRequest = { run_id: AgentRunId, after_sequence: number | null, limit: number | null, };

export type AgentToolCallView = { id: ToolCallId, run_id: AgentRunId, name: string, effect: AgentToolEffect, status: AgentToolStatus, policy_decision: AgentPolicyDecision, arguments: unknown, receipt: unknown | null, error_code: string | null, created_at: number, updated_at: number, };

export type ApprovalView = { id: ApprovalId, run_id: AgentRunId, tool_call_id: ToolCallId, decision: ApprovalDecision | null, nonce: string, created_at: number, resolved_at: number | null, };

export type ResolveAgentApprovalRequest = { run_id: AgentRunId, approval_id: ApprovalId, nonce: string, decision: ApprovalDecision, };

export type McpConfigStatus = "CONFIGURED" | "CONFIG_NOT_FOUND" | "CONFIG_MALFORMED";

export type McpRunActivationState = "NOT_ACTIVE" | "ACTIVATION_QUEUED" | "AWAITING_APPROVAL" | "STARTING" | "ACTIVE_IN_CURRENT_RUN" | "PROCESS_UNAVAILABLE" | "ACTIVATION_DENIED" | "ACTIVATION_FAILED";

export type McpDiagnosticView = { connection_id: string | null, code: string, };

export type McpConnectionView = { connection_id: string, transport: string, command_path: string, command_argument_count: number, credential_support: string, credential_binding_count: number, credential_missing_count: number, };

export type McpConnectionCatalogView = { status: McpConfigStatus, config_digest: string | null, connection_count: number, connections: Array<McpConnectionView>, diagnostics: Array<McpDiagnosticView>, };

export type McpRunConnectionView = { connection_id: string, activation_state: McpRunActivationState, activation_available: boolean, activation_unavailable_reason: string | null, provider_id: string | null, transport: string, protocol_version: string | null, discovered_tool_count: number | null, credential_binding_count: number, credential_missing_count: number, last_activation_tool_call_id: ToolCallId | null, last_error_code: string | null, };

export type McpConnectionRuntimeView = { run_id: AgentRunId, run_status: AgentRunStatus, connections: Array<McpRunConnectionView>, diagnostics: Array<McpDiagnosticView>, };

export type ActivateMcpConnectionRequest = { run_id: AgentRunId, connection_id: string, };

export type SkillCatalogRequest = { field_id: FieldId | null, };

export type SkillMetadataView = { key: string, value: string, };

export type SkillPluginProvenanceView = { plugin_id: string, plugin_version: string, plugin_source: string, plugin_trust: string, plugin_manifest_digest: string, plugin_snapshot_digest: string, };

export type SkillCatalogEntryView = { name: string, description: string, source_kind: string, scope: string, trust: string, version: string | null, content_digest: string, location_reference: string, license: string | null, compatibility: string | null, metadata: Array<SkillMetadataView>, allowed_tools_advisory: string | null, resources: Array<string>, resources_truncated: boolean, plugin: SkillPluginProvenanceView | null, };

export type SkillCatalogDiagnosticView = { code: string, skill_name: string | null, };

export type SkillCatalogView = { catalog_sha256: string, entries: Array<SkillCatalogEntryView>, diagnostics: Array<SkillCatalogDiagnosticView>, };

export type PluginContributionSkillView = { name: string, relative_path: string, content_digest: string, };

export type DeclarativePluginView = { id: string, name: string, version: string, publisher: string, engine_requirement: string, source_kind: string, trust: string, manifest_reference: string, manifest_digest: string, skills: Array<PluginContributionSkillView>, plugin_snapshot_digest: string, };

export type LocalPluginRegistrationStatus = "AVAILABLE" | "UNAVAILABLE";

export type LocalPluginRegistrationView = { registration_id: string, root_reference: string, status: LocalPluginRegistrationStatus, error_code: string | null, plugin: DeclarativePluginView | null, };

export type LocalPluginRegistryView = { config_status: string, config_digest: string | null, registrations: Array<LocalPluginRegistrationView>, };

export type RegisterLocalPluginRequest = { root_path: string, };

export type UnregisterLocalPluginRequest = { registration_id: string, };

export type AgentContextSnapshotView = { id: ContextSnapshotId, run_id: AgentRunId, step: number, project_root_hash: string, selected_files: number, estimated_tokens: number, content_sha256: string, manifest: unknown, created_at: number, };

export type VerificationReceiptView = { id: VerificationReceiptId, run_id: AgentRunId, tool_call_id: ToolCallId | null, check_kind: string, outcome: VerificationOutcome, summary: string, artifact_sha256: string | null, subject: VerificationSubject | null, exit_code: number | null, created_at: number, };

export type AgentChangedEvent = { event: string, run_id: AgentRunId, sequence: number, status: AgentRunStatus, };

export type ModelToolDefinition = { name: string, description: string, input_schema: unknown, };

export type ModelCapabilityProfile = { streaming: boolean, native_tools: boolean, parallel_tools: boolean, strict_schema: boolean, usage: boolean, cancellation: boolean, };

