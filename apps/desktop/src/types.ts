import type { UpdateModelRuntimeRequest } from '@fielora/contracts';
import type {
  ActivityCursor, ActivityView, ArchiveReferenceRequest, AttachReferenceSourceRequest,
  CreateFieldRequest,
  CreateReferenceRequest, CreateStateRequest,
  DomainEventDTO,
  FieldResumeV1View,
  FieldReferenceRequest,
  FieldSummary,
  FieldView,
  HealthDTO,
  ListActivitiesRequest, ListReferencesRequest, ListRelationsRequest, ListStatesRequest,
  Page, RealityMutationResult, ReferenceCursor, ReferenceRequest, ReferenceView,
  RelationCursor, RelationView, RestoreReferenceRequest, RetractReferenceSourceRequest,
  ReviseReferenceRequest, ReviseStateRequest,
  SaveSurfaceSnapshotV1Request,
  SaveSurfaceSnapshotRequest,
  SetFieldFocusV1Request, StateCursor, StateReferenceRequest, StateView, SupersedeStateRequest,
  SupersedeStateResult,
  SurfaceResumeView,
  SurfaceSnapshotV1View,
  SurfaceSnapshotView,
  TransitionStateRequest, UpdateFieldModeRequest,
  UpdateFocusRequest,
  CreateProviderConfigRequest, UpdateProviderConfigRequest, ProviderConfigRequest, StoreCredentialRequest,
  ProviderConfigView, StartModelInvocationRequest, StartModelInvocationResult, CancelModelInvocationRequest,
  ModelInvocationEvent, CaptureChangedEvent, CreateCaptureRequest, CaptureRequest, MutateCaptureRequest,
  AttachCaptureRequest, PromoteCaptureRequest, ListCapturesRequest, CaptureView, CaptureCursor,
  ProjectView, ProjectRequest, CreateProjectRequest, UpdateProjectRequest, ArchiveProjectRequest,
  ConversationView, CreateConversationRequest, ConversationRequest, UpdateConversationRequest,
  ArchiveConversationRequest, ConversationMessageView, CreateConversationMessageRequest,
  ListConversationMessagesRequest,
  AgentChangedEvent, AgentRunView, StartAgentRunRequest, AgentRunRequest, ResumeAgentRunRequest, ListAgentRunsRequest,
  ModelUsageReportRequest, ModelUsageReport,
  AgentEventView, ListAgentEventsRequest, AgentToolCallView, ApprovalView, ResolveAgentApprovalRequest,
  ActivateMcpConnectionRequest, McpConnectionCatalogView, McpConnectionRuntimeView,
  SkillCatalogRequest, SkillCatalogView, LocalPluginRegistryView,
  RegisterLocalPluginRequest, UnregisterLocalPluginRequest,
  BuildProvenanceView,
  LibraryObjectView, LibraryObjectRequest, DeleteLibraryObjectRequest, ListLibraryObjectsRequest,
  SaveWebLibraryRequest, ProfileView,
  ListArtifactsRequest, ReadArtifactRequest, ArtifactHistoryRequest,
  ArtifactListView, ArtifactReadView, ArtifactHistoryView,
  AssetPreviewRequest, AssetPreviewView, DiagramPreviewRequest, DiagramPreviewView,
  SetArtifactArchiveStateCommandRequest,
  FileArtifactReviewListView, FileArtifactReviewState, ListFileArtifactReviewsRequest,
  MarkFileArtifactReviewedRequest, UndoFileArtifactRevisionRequest,
  ScreenshotEvidenceView, ScreenshotEvidenceRequest, ScreenshotEvidencePreviewRequest,
  ListScreenshotEvidenceByRunRequest, ListScreenshotEvidenceByVerificationRequest,
} from '@fielora/contracts';
import type { StorageDetail, StorageInfo } from './storage-manager';
import type { AppPreferences } from './renderer/app-preferences';
import type { BrowserContextCandidate, BrowserNavigateRequest, BrowserPageRequest, BrowserPageState, BrowserViewBounds } from './browser-types';
import type {
  ApplyWorkspaceFileRequest, CancelTerminalRequest, PickProjectRequest, RunTerminalRequest,
  LibraryImagePreviewView, ScreenshotImagePreviewView, TerminalEvent, TerminalRunResult, WorkspaceFileEntry, WorkspaceFileRequest, WorkspaceFileView, WorkspaceImagePreview,
  OpenWorkspaceProjectRequest, WorkspaceProjectOpenTargetView,
  CopyWorkspaceAttachmentResult, ReadWorkspaceAttachmentRequest, SaveWorkspaceAttachmentRequest, SaveWorkspaceAttachmentResult, StoreWorkspaceAttachmentRequest,
  WorkspaceAttachmentSelection, WorkspaceAttachmentView, WorkspaceEnvironmentView, WorkspaceProjectRequest,
} from './workspace-types';
import type { CreateScheduledTaskRequest, ScheduledTaskRequest, ScheduledTaskView, UpdateScheduledTaskRequest } from './scheduled-task-types';

export type Unsubscribe = () => void;
export type AgentTextDeltaEvent = {
  event: 'event.agent.text_delta';
  run_id: string;
  step: number;
  text_delta: string;
};
export type DesktopCoreEvent = DomainEventDTO | ModelInvocationEvent | CaptureChangedEvent | AgentChangedEvent | AgentTextDeltaEvent | {
  event: 'event.agent.browser';
  run_id: string;
  conversation_id: string;
} | {
  event: 'event.core.health';
  state: HealthDTO['state'];
  error?: string;
};

export interface FieloraBridge {
  window: {
    setTitlebarTheme(theme: 'LIGHT' | 'DARK', background: string, translucentSidebar?: boolean): Promise<null>;
  };
  project: {
    pick(request: PickProjectRequest): Promise<ProjectView | null>;
    list(): Promise<ProjectView[]>;
    get(request: ProjectRequest): Promise<ProjectView>;
    update(request: UpdateProjectRequest): Promise<ProjectView>;
    archive(request: ArchiveProjectRequest): Promise<ProjectView>;
    rebind(request: ProjectRequest): Promise<ProjectView | null>;
  };
  conversation: {
    create(request: CreateConversationRequest): Promise<ConversationView>;
    list(request: ProjectRequest): Promise<ConversationView[]>;
    get(request: ConversationRequest): Promise<ConversationView>;
    update(request: UpdateConversationRequest): Promise<ConversationView>;
    archive(request: ArchiveConversationRequest): Promise<ConversationView>;
    createMessage(request: CreateConversationMessageRequest): Promise<ConversationMessageView>;
    listMessages(request: ListConversationMessagesRequest): Promise<ConversationMessageView[]>;
  };
  scheduledTask: {
    list(): Promise<ScheduledTaskView[]>;
    create(request: CreateScheduledTaskRequest): Promise<ScheduledTaskView>;
    update(request: UpdateScheduledTaskRequest): Promise<ScheduledTaskView>;
    delete(request: ScheduledTaskRequest): Promise<null>;
    runNow(request: ScheduledTaskRequest): Promise<ScheduledTaskView>;
  };
  artifact: {
    list(request: ListArtifactsRequest): Promise<ArtifactListView>;
    read(request: ReadArtifactRequest): Promise<ArtifactReadView>;
    history(request: ArtifactHistoryRequest): Promise<ArtifactHistoryView>;
    previewAsset(request: AssetPreviewRequest): Promise<AssetPreviewView>;
    previewDiagram(request: DiagramPreviewRequest): Promise<DiagramPreviewView>;
    setArchiveState(request: SetArtifactArchiveStateCommandRequest): Promise<AgentToolCallView>;
    listFileReviews(request: ListFileArtifactReviewsRequest): Promise<FileArtifactReviewListView>;
    markFileReviewed(request: MarkFileArtifactReviewedRequest): Promise<FileArtifactReviewState>;
    undoFileRevision(request: UndoFileArtifactRevisionRequest): Promise<AgentToolCallView>;
  };
  workspace: {
    listFiles(request: WorkspaceProjectRequest): Promise<WorkspaceFileEntry[]>;
    readFile(request: WorkspaceFileRequest): Promise<WorkspaceFileView>;
    previewFile(request: WorkspaceFileRequest): Promise<WorkspaceImagePreview>;
    applyFile(request: ApplyWorkspaceFileRequest): Promise<WorkspaceFileView>;
    getEnvironment(request: WorkspaceProjectRequest): Promise<WorkspaceEnvironmentView>;
    getOpenTargets(request: WorkspaceProjectRequest): Promise<WorkspaceProjectOpenTargetView[]>;
    openProject(request: OpenWorkspaceProjectRequest): Promise<null>;
    pickAttachments(): Promise<WorkspaceAttachmentSelection>;
    storeAttachment(request: StoreWorkspaceAttachmentRequest): Promise<WorkspaceAttachmentView>;
    readAttachment(request: ReadWorkspaceAttachmentRequest): Promise<{ data_url: string; mime_type: string }>;
    copyAttachment(request: ReadWorkspaceAttachmentRequest): Promise<CopyWorkspaceAttachmentResult>;
    saveAttachment(request: SaveWorkspaceAttachmentRequest): Promise<SaveWorkspaceAttachmentResult>;
    runTerminal(request: RunTerminalRequest): Promise<TerminalRunResult>;
    cancelTerminal(request: CancelTerminalRequest): Promise<null>;
    subscribe(listener: (event: TerminalEvent) => void): Unsubscribe;
  };
  field: {
    create(request: CreateFieldRequest): Promise<FieldView>;
    list(): Promise<FieldSummary[]>;
    get(request: FieldReferenceRequest): Promise<FieldView>;
    updateFocus(request: UpdateFocusRequest): Promise<FieldView>;
    updateMode(request: UpdateFieldModeRequest): Promise<RealityMutationResult<FieldView>>;
    setFocusV1(request: SetFieldFocusV1Request): Promise<RealityMutationResult<FieldView>>;
    resumeV1(request: FieldReferenceRequest): Promise<FieldResumeV1View>;
  };
  state: {
    create(request: CreateStateRequest): Promise<RealityMutationResult<StateView>>;
    get(request: StateReferenceRequest): Promise<StateView>;
    list(request: ListStatesRequest): Promise<Page<StateView, StateCursor>>;
    revise(request: ReviseStateRequest): Promise<RealityMutationResult<StateView>>;
    transition(request: TransitionStateRequest): Promise<RealityMutationResult<StateView>>;
    supersede(request: SupersedeStateRequest): Promise<SupersedeStateResult>;
  };
  reference: {
    create(request: CreateReferenceRequest): Promise<RealityMutationResult<ReferenceView>>;
    get(request: ReferenceRequest): Promise<ReferenceView>;
    list(request: ListReferencesRequest): Promise<Page<ReferenceView, ReferenceCursor>>;
    revise(request: ReviseReferenceRequest): Promise<RealityMutationResult<ReferenceView>>;
    archive(request: ArchiveReferenceRequest): Promise<RealityMutationResult<ReferenceView>>;
    restore(request: RestoreReferenceRequest): Promise<RealityMutationResult<ReferenceView>>;
  };
  relation: {
    attachReferenceSource(request: AttachReferenceSourceRequest): Promise<RealityMutationResult<RelationView>>;
    retractReferenceSource(request: RetractReferenceSourceRequest): Promise<RealityMutationResult<RelationView>>;
    list(request: ListRelationsRequest): Promise<Page<RelationView, RelationCursor>>;
  };
  activity: {
    list(request: ListActivitiesRequest): Promise<Page<ActivityView, ActivityCursor>>;
  };
  surface: {
    saveSnapshot(request: SaveSurfaceSnapshotRequest): Promise<SurfaceSnapshotView>;
    latestSnapshot(request: FieldReferenceRequest): Promise<SurfaceResumeView>;
    saveSnapshotV1(request: SaveSurfaceSnapshotV1Request): Promise<SurfaceSnapshotV1View>;
  };
  browser: {
    show(bounds: BrowserViewBounds): Promise<BrowserPageState>;
    hide(): Promise<BrowserPageState>;
    createPage(): Promise<BrowserPageState>;
    switchPage(request: BrowserPageRequest): Promise<BrowserPageState>;
    closePage(request: BrowserPageRequest): Promise<BrowserPageState>;
    showPageContextMenu(request: BrowserPageRequest): Promise<BrowserPageState>;
    navigate(request: BrowserNavigateRequest): Promise<BrowserPageState>;
    back(): Promise<BrowserPageState>;
    forward(): Promise<BrowserPageState>;
    reload(): Promise<BrowserPageState>;
    getState(): Promise<BrowserPageState>;
    getContextCandidate(): Promise<BrowserContextCandidate>;
    captureScreenshot(): Promise<ScreenshotEvidenceView>;
    subscribe(listener: (state: BrowserPageState) => void): Unsubscribe;
  };
  screenshot: {
    get(request: ScreenshotEvidenceRequest): Promise<ScreenshotEvidenceView>;
    byRun(request: ListScreenshotEvidenceByRunRequest): Promise<ScreenshotEvidenceView[]>;
    byVerification(request: ListScreenshotEvidenceByVerificationRequest): Promise<ScreenshotEvidenceView[]>;
    preview(request: ScreenshotEvidencePreviewRequest): Promise<ScreenshotImagePreviewView>;
  };
  clipboard: {
    writeText(text: string): Promise<void>;
  };
  provider: {
    catalog(): Promise<import('@fielora/contracts').ModelProviderPreset[]>;
    updateRuntime(request: UpdateModelRuntimeRequest): Promise<ProviderConfigView>;
    validate(request: ProviderConfigRequest): Promise<StartModelInvocationResult>;
    create(request: CreateProviderConfigRequest): Promise<ProviderConfigView>;
    update(request: UpdateProviderConfigRequest): Promise<ProviderConfigView>;
    storeCredential(request: StoreCredentialRequest): Promise<ProviderConfigView>;
    deleteCredential(request: ProviderConfigRequest): Promise<ProviderConfigView>;
    remove(request: ProviderConfigRequest): Promise<ProviderConfigView>;
    probe(request: ProviderConfigRequest): Promise<StartModelInvocationResult>;
    list(): Promise<ProviderConfigView[]>;
    get(request: ProviderConfigRequest): Promise<ProviderConfigView>;
  };
  model: {
    start(request: StartModelInvocationRequest): Promise<StartModelInvocationResult>;
    cancel(request: CancelModelInvocationRequest): Promise<null>;
  };
  agent: {
    start(request: StartAgentRunRequest): Promise<AgentRunView>;
    get(request: AgentRunRequest): Promise<AgentRunView>;
    list(request: ListAgentRunsRequest): Promise<AgentRunView[]>;
    usage(request: ModelUsageReportRequest): Promise<ModelUsageReport>;
    events(request: ListAgentEventsRequest): Promise<AgentEventView[]>;
    toolCalls(request: AgentRunRequest): Promise<AgentToolCallView[]>;
    cancel(request: AgentRunRequest): Promise<AgentRunView>;
    pause(request: AgentRunRequest): Promise<AgentRunView>;
    resume(request: ResumeAgentRunRequest): Promise<AgentRunView>;
    resolveApproval(request: ResolveAgentApprovalRequest): Promise<ApprovalView>;
    mcpConnections(): Promise<McpConnectionCatalogView>;
    mcpRuntime(request: AgentRunRequest): Promise<McpConnectionRuntimeView>;
    activateMcpConnection(request: ActivateMcpConnectionRequest): Promise<AgentToolCallView>;
  };
  skill: {
    catalog(request: SkillCatalogRequest): Promise<SkillCatalogView>;
  };
  plugin: {
    localRegistry(): Promise<LocalPluginRegistryView>;
    registerLocal(request: RegisterLocalPluginRequest): Promise<LocalPluginRegistryView>;
    unregisterLocal(request: UnregisterLocalPluginRequest): Promise<LocalPluginRegistryView>;
  };
  capture: {
    create(request: CreateCaptureRequest): Promise<CaptureView>;
    attach(request: AttachCaptureRequest): Promise<CaptureView>;
    promote(request: PromoteCaptureRequest): Promise<CaptureView>;
    archive(request: MutateCaptureRequest): Promise<CaptureView>;
    restore(request: MutateCaptureRequest): Promise<CaptureView>;
    list(request: ListCapturesRequest): Promise<Page<CaptureView, CaptureCursor>>;
    get(request: CaptureRequest): Promise<CaptureView>;
  };
  fonts: { list(): Promise<FontCatalog>; import(): Promise<FontImportResult> };
  library: {
    addFiles(): Promise<LibraryObjectView[]>;
    saveWeb(request: SaveWebLibraryRequest): Promise<LibraryObjectView>;
    list(request: ListLibraryObjectsRequest): Promise<LibraryObjectView[]>;
    get(request: LibraryObjectRequest): Promise<LibraryObjectView>;
    previewImage(request: LibraryObjectRequest): Promise<LibraryImagePreviewView>;
    delete(request: DeleteLibraryObjectRequest): Promise<LibraryObjectView>;
    open(request: LibraryObjectRequest): Promise<null>;
    reveal(request: LibraryObjectRequest): Promise<null>;
  };
  storage: {
    info(): Promise<StorageInfo>;
    open(id: 'DATA_ROOT' | 'LIBRARY_ROOT' | 'CACHE_ROOT' | StorageDetail['id']): Promise<null>;
    migrateDataRoot(): Promise<{ canceled: boolean; root: string | null }>;
    migrateLibraryRoot(): Promise<{ canceled: boolean; root: string | null }>;
    clearCache(): Promise<{ removed_bytes: number }>;
  };
  profile: {
    get(): Promise<ProfileView>;
    export(request: { include_library: boolean; preferences: AppPreferences }): Promise<{ canceled: boolean; path: string | null }>;
    import(): Promise<{ canceled: boolean; profile_id: string | null; preferences: AppPreferences | null }>;
  };
  core: {
    getHealth(): Promise<HealthDTO>;
    getBuildProvenance(): Promise<BuildProvenanceView>;
    subscribe(listener: (event: DesktopCoreEvent) => void): Unsubscribe;
    retry(): Promise<void>;
    openLogs(): Promise<void>;
    quit(): Promise<void>;
  };
}

declare global {
  interface Window {
    fielora: FieloraBridge;
    fieloraTest?: {
      killCore(): Promise<void>;
      resizeWindow(size: { width: number; height: number }): Promise<{ width: number; height: number }>;
      createProject(request: CreateProjectRequest): Promise<ProjectView>;
    };
  }
}

export interface FontFamily { family: string; monospace: boolean }
export interface FontCatalog { families: FontFamily[]; install_directory: string }
export interface FontInstallation { success: boolean; already_installed: boolean; path: string; font: { families: FontFamily[]; sha256: string; bytes: number } }
export interface FontImportResult { canceled: boolean; installed: FontInstallation[]; errors: Array<{ filename: string; message: string }> }
