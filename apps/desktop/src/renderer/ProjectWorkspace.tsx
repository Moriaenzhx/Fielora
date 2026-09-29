import { readAppPreferences } from './app-preferences';
import type { ActivityFileLink } from './agent-activity-detail';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  AgentChangedEvent, AgentEventView, AgentPermission, AgentRunView, AgentToolCallView, ApprovalView,
  McpConnectionRuntimeView,
  ConversationMessageStatus, ConversationMessageView, ConversationView, ProjectView, ProviderConfigView, ArtifactView, ResultReference,
  FileArtifactRevisionReviewView,
} from '@fielora/contracts';
import type { AgentTextDeltaEvent } from '../types';
import type { ResultImagePreviewView, WorkspaceAttachmentView, WorkspaceEnvironmentView, WorkspaceFileEntry, WorkspaceFileView, WorkspaceImagePreview, WorkspaceProjectOpenTarget, WorkspaceProjectOpenTargetView } from '../workspace-types';
import { PrimaryNav } from './PrimaryNav';
import { AppIcon, FileTypeIcon, type AppIconName } from './ui';
import { BrowsePanel } from './BrowseScreen';
import { AgentTurn } from './AgentTurn';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { AgentHumanReview } from './AgentHumanReview';
import { AttachmentThumbnail, ConversationImageGallery, ImageContextMenu, ImagePreview } from './AttachmentMedia';
import { AGENT_PROJECTION_UNAVAILABLE_MESSAGE, loadCompleteAgentEventSequence, mergeAgentEventPages } from './agent-projection';
import { buildAgentReview, buildDurableAgentReview, type AgentReviewFile } from './agent-review';
import { MarkdownMessage } from './MarkdownMessage';
import { ResizableDivider } from './ResizableDivider';
import { RightWorkspaceDock, type RightWorkspaceTab, type RightWorkspaceTool } from './RightWorkspaceDock';
import { ArtifactSurface } from './ArtifactWorkingSurface';
import {
  activeArtifactContext, artifactTabId, emptyArtifactSession, pinArtifactRevision,
  refreshArtifactCurrent, type ArtifactSurfaceSession,
} from './artifact-working-surface';
import { WorkspaceFileTree } from './WorkspaceFileTree';
import { SyntaxCodeEditor } from './SyntaxCodeEditor';
import { IconButton, SelectMenu, TextActionDialog, ToolbarAction, TooltipButton, TimestampHover } from './UiPrimitives';
import {
  persistWorkspaceNavigationWidth,
  readWorkspaceNavigationWidth,
  WORKSPACE_NAVIGATION_DEFAULT_WIDTH,
  WORKSPACE_NAVIGATION_MAX_WIDTH,
  WORKSPACE_NAVIGATION_MIN_WIDTH,
  WorkspaceSurface,
} from './WorkspaceSurface';
import { referencedConversationImages } from './referenced-images';
import { attachmentsForCapabilities, loadBrowserAttachments, messageAttachments, normalizeAttachmentSelection, persistMessageAttachments } from './attachment-pipeline';
import { modelCapabilities } from './model-capabilities';
import { composerDraftKey, useComposerDraft } from './composer-drafts';
import {
  sentConversations,
  conversationTitleFromContent,
  agentTurnOwnership,
  agentTurnDisplayAnchor,
  previousAgentAttempts,
  friendlyFilePreviewFailure,
  hasUserMessage,
  isDefaultConversationTitle,
  resolveComposerPermission,
  reviewDiff,
  shouldSubmitComposerKey,
  workspacePreviewKind,
} from './workspace-presentation';

interface ProjectWorkspaceProps {
  onModelSelectionChange?: (selection: { providerId: string; modelId: string } | null) => void;
  onNow: () => void;
  onBrowse: () => void;
  onFields: () => void;
  onSettings: (fieldId: string | null) => void;
  newConversationRequest: number;
  addProjectRequest: number;
  workspaceRequest: { id: number; tool: 'FILES' | 'DIFF' | 'TERMINAL' | 'BROWSER' };
}

const PROJECT_WORKSPACE_DEFAULT_WIDTH = 635;
const PROJECT_WORKSPACE_MIN_WIDTH = 360;
const CONVERSATION_MIN_WIDTH = 340;
const WORKSPACE_RESIZER_WIDTH = 4;
const NAVIGATION_RESIZER_WIDTH = 4;
const PROJECT_WORKSPACE_COLLAPSE_THRESHOLD = 176;
const PROJECT_WORKSPACE_RESTORE_THRESHOLD = 236;
const PROJECT_WORKSPACE_FOCUS_OVERSHOOT = 48;
const PROJECT_WORKSPACE_UNFOCUS_OVERSHOOT = 12;

interface ReviewDraft {
  relativePath: string;
  before: string;
  after: string;
  beforeHash: string;
  diff: string;
}

interface UndoChange {
  relativePath: string;
  content: string;
  expectedHash: string;
}

interface ActiveAgent {
  runId: string;
  conversationId: string;
  output: string;
  step: number;
}

interface QueuedFollowUp {
  id: string;
  messageId: string | null;
  content: string;
  afterRunId: string;
  selectedFilePath: string | null;
  permission: ComposerPermission;
  createdAt: number;
}

interface HistoricalReviewSelection {
  review: ReturnType<typeof buildAgentReview>;
  runId: string;
  task: string;
  path: string;
}

interface ActiveTerminal {
  runId: string;
  command: string;
  output: string;
}

type ConversationDialog =
  | { kind: 'RENAME'; value: string }
  | { kind: 'DELETE' }
  | null;

interface ConversationContextMenuState {
  conversationId: string;
  title: string;
  left: number;
  top: number;
}

type ProjectDialog = { project: ProjectView; value: string } | null;
interface ProjectContextMenuState {
  project: ProjectView;
  left: number;
  top: number;
}
type ProjectSort = 'RECENT' | 'NAME' | 'CREATED';
const showLegacyWorkspace: boolean = false;

type ComposerPermission = AgentPermission;

type FilePreviewState =
  | { kind: 'IMAGE'; preview: WorkspaceImagePreview }
  | { kind: 'UNSUPPORTED'; relativePath: string; message: string }
  | null;

type RightDockKind = 'FILES' | 'FILE' | 'IMAGE' | 'REVIEW' | 'BROWSER' | 'TERMINAL' | 'ARTIFACT';

function WorkspaceAppBadge({ target, iconDataUrl = null }: { target: WorkspaceProjectOpenTarget; iconDataUrl?: string | null }) {
  if (iconDataUrl) return <img className={`workspace-app-icon target-${target.toLowerCase()}`} src={iconDataUrl} alt="" aria-hidden="true" data-app-icon={target} data-icon-source="native"/>;
  const fallbackIcons: Record<WorkspaceProjectOpenTarget, AppIconName> = {
    FILE_EXPLORER: 'folder',
    VISUAL_STUDIO_CODE: 'application',
    CURSOR: 'application',
    VISUAL_STUDIO: 'application',
    GIT_BASH: 'terminal',
    INTELLIJ_IDEA: 'application',
    PYCHARM: 'application',
    WEBSTORM: 'application',
  };
  return <AppIcon name={fallbackIcons[target]} className={`workspace-app-icon target-${target.toLowerCase()}`} data-app-icon={target} data-icon-source="fallback" />;
}

interface ProjectDockTab extends RightWorkspaceTab {
  kind: RightDockKind;
  relativePath?: string;
  attachment?: WorkspaceAttachmentView;
  reviewSelection?: HistoricalReviewSelection;
  artifactId?: string;
}

interface FileDockSession {
  file: WorkspaceFileView | null;
  preview: FilePreviewState;
  content: string;
  loading?: boolean;
  markdownMode?: 'PREVIEW' | 'SOURCE';
  reveal?: { lineStart: number; lineEnd: number; nonce: number };
}

function fileTabLabel(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').split('/').at(-1) ?? relativePath;
}

function isMarkdownFile(relativePath: string): boolean {
  return /\.(?:md|markdown)$/i.test(relativePath);
}

// Freeze the sliding content before paint, then release it only when the
// owning grid has settled. Reversal and reduced motion use the same cleanup.
function trackPaneMotion(element: HTMLElement, finish: () => void): () => void {
  let frame = 0;
  element.dataset.workspaceMotion = 'true';
  const clear = () => {
    cancelAnimationFrame(frame);
    delete element.dataset.workspaceMotion;
    finish();
  };
  const sample = () => {
    if (element.getAnimations().some((animation) => animation.playState === 'running')) frame = requestAnimationFrame(sample);
    else clear();
  };
  frame = requestAnimationFrame(sample);
  return clear;
}

function TerminalSession({ workingDirectory, command, lastCommand, output, running, active, onCommandChange, onRun, onCancel, testId }: {
  workingDirectory: string;
  command: string;
  lastCommand: string;
  output: string;
  running: boolean;
  active: boolean;
  onCommandChange: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  testId: 'terminal' | 'bottom-terminal';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [lastCommand, output, running]);
  return <div className="terminal-session" data-testid={`${testId}-session`} onClick={(event) => {
    if (!(event.target as HTMLElement).closest('button')) inputRef.current?.focus();
  }}>
    <div ref={transcriptRef} className="terminal-transcript" data-testid={`${testId}-output`}>
      <p>Windows PowerShell</p>
      <p>Copyright (C) Microsoft Corporation. All rights reserved.</p>
      {lastCommand && <p className="terminal-history-command"><span>PS {workingDirectory}&gt;</span> {lastCommand}</p>}
      {output && <pre>{output}</pre>}
      <form className="terminal-prompt" data-terminal-inline-prompt="true" onSubmit={(event) => { event.preventDefault(); onRun(); }}>
        <span>PS {workingDirectory}&gt;</span>
        <input ref={inputRef} value={command} onChange={(event) => onCommandChange(event.target.value)} aria-label={testId === 'terminal' ? 'Terminal command' : 'Bottom terminal command'} autoComplete="off" autoCapitalize="none" spellCheck={false} data-testid={`${testId}-command`}/>
        {running && <button type="button" onClick={onCancel} aria-label="停止当前命令"><AppIcon name="close"/></button>}
      </form>
    </div>
  </div>;
}

const FILE_TREE_COLLAPSE_THRESHOLD = 36;
const FILE_TREE_RESTORE_THRESHOLD = 80;

function DockResourceLayout({ children, fileTree, treeWidth, treeCollapsed, onTreeWidthChange, onTreeCollapsedChange }: {
  children: ReactNode;
  fileTree: ReactNode;
  treeWidth: number;
  treeCollapsed: boolean;
  onTreeWidthChange: (width: number) => void;
  onTreeCollapsedChange: (collapsed: boolean) => void;
}) {
  const resourceLayoutRef = useRef<HTMLDivElement>(null);
  const dragGeometryRef = useRef<{ right: number; maximum: number; collapsed: boolean } | null>(null);
  useLayoutEffect(() => {
    const layout = resourceLayoutRef.current;
    const tree = layout?.querySelector<HTMLElement>('.dock-resource-file-tree');
    if (!layout || !tree) return;
    const width = Math.max(tree.getBoundingClientRect().width, Math.min(treeWidth, Math.max(160, layout.clientWidth * .55)));
    tree.style.setProperty('--file-tree-slide-width', `${width}px`);
    const contentWidth = layout.clientWidth - (treeCollapsed ? 0 : width + WORKSPACE_RESIZER_WIDTH);
    const editor = layout.querySelector<HTMLElement>('.dock-code-editor-surface');
    const editorWidth = editor?.getBoundingClientRect().width ?? 0;
    editor?.style.setProperty('--code-layout-width', `${Math.max(contentWidth, editorWidth)}px`);
    return trackPaneMotion(layout, () => {
      tree.style.removeProperty('--file-tree-slide-width');
      editor?.style.removeProperty('--code-layout-width');
    });
  }, [treeCollapsed, treeWidth]);
  const resizeTree = (clientX: number, commit: boolean) => {
    const geometry = dragGeometryRef.current;
    if (!geometry) return;
    const rawWidth = geometry.right - clientX;
    if (!geometry.collapsed && rawWidth <= FILE_TREE_COLLAPSE_THRESHOLD) {
      geometry.collapsed = true;
      resourceLayoutRef.current?.style.setProperty('--dock-file-tree-width', `${treeWidth}px`);
      onTreeCollapsedChange(true);
      return;
    }
    if (geometry.collapsed) {
      if (rawWidth < FILE_TREE_RESTORE_THRESHOLD) return;
      geometry.collapsed = false;
      onTreeCollapsedChange(false);
    }
    const width = Math.min(Math.max(rawWidth, commit ? 160 : 0), geometry.maximum);
    resourceLayoutRef.current?.style.setProperty('--dock-file-tree-width', `${width}px`);
    if (commit) onTreeWidthChange(width);
  };
  return <div
    ref={resourceLayoutRef}
    className={`dock-resource-layout ${treeCollapsed ? 'file-tree-collapsed' : ''}`}
    style={{ '--dock-file-tree-width': `${treeWidth}px` } as CSSProperties}
    data-testid="dock-resource-layout"
  >
    <main className="dock-resource-content">{children}</main>
    <ResizableDivider
      label="调整文件内容与文件菜单宽度"
      value={treeWidth}
      min={160}
      max={420}
      onResizeStart={(clientX) => {
        const layout = resourceLayoutRef.current;
        const rect = layout?.getBoundingClientRect();
        const width = layout?.querySelector('.dock-resource-file-tree')?.getBoundingClientRect().width;
        if (rect && width !== undefined) dragGeometryRef.current = { right: clientX + width, maximum: Math.min(420, Math.max(160, rect.width * .55)), collapsed: treeCollapsed };
      }}
      onResize={(clientX) => resizeTree(clientX, false)}
      onResizeEnd={(clientX) => { resizeTree(clientX, true); dragGeometryRef.current = null; }}
      onKeyboardResize={(delta) => onTreeWidthChange(treeWidth - delta)}
      testId="dock-file-tree-resizer"
      className="dock-file-tree-resizer"
    />
    <aside className="dock-resource-file-tree" aria-label="Project 文件" data-testid="dock-resource-file-tree">
      <div className="dock-file-tree-body" data-testid="dock-file-tree-body">{fileTree}</div>
    </aside>
  </div>;
}

function workspaceImageAttachment(preview: WorkspaceImagePreview): WorkspaceAttachmentView {
  return {
    id: `workspace:${preview.relative_path}`, name: fileTabLabel(preview.relative_path), size: preview.size,
    kind: 'IMAGE', mime_type: preview.mime_type, status: 'READY', content: null, data_url: preview.data_url,
    sha256: null, reason: null, width: null, height: null, source: 'file_picker', content_ref: null,
  };
}

function resultImageAttachment(preview: ResultImagePreviewView): WorkspaceAttachmentView {
  const screenshot = preview.source === 'SCREENSHOT_EVIDENCE';
  return {
    id: screenshot ? `screenshot:${preview.screenshot_evidence_id}` : `library:${preview.library_object_id}`,
    name: screenshot ? '页面截图' : preview.title,
    size: screenshot ? preview.byte_size : preview.size,
    kind: 'IMAGE', mime_type: preview.mime_type, status: 'READY', content: null, data_url: preview.data_url,
    sha256: screenshot ? preview.content_sha256 : preview.content_hash,
    reason: null, width: screenshot ? preview.width : null, height: screenshot ? preview.height : null, source: 'library', content_ref: null,
  };
}

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike { error: string; }

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function PermissionIcon({ permission }: { permission: ComposerPermission }) {
  const icons: Record<ComposerPermission, AppIconName> = { READ_ONLY: 'permissionAsk', REVIEW_CHANGES: 'permissionReview', FULL_CONTROL: 'permissionFull' };
  return <span className="composer-icon permission-icon" data-permission-icon={permission}><AppIcon name={icons[permission]}/></span>;
}

function reasonMessage(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason);
  if (/unknown field [`']attachments[`']|expected one of [`']field_id/i.test(raw)) return '当前桌面与 Agent Runtime 版本不一致。请重新打开最新 Fielora 后重试；已输入的内容仍保留在当前对话中。';
  if (raw.includes('FILE_CHANGED_SINCE_REVIEW')) return '文件在 review 后已被其他程序修改，请重新载入再确认。';
  if (raw.includes('CREDENTIAL_REJECTED')) return '模型凭据无效，请在设置中更新。';
  if (raw.includes('PROVIDER_RATE_LIMITED')) return '模型服务当前限流，请稍后重试。';
  if (raw.includes('AGENT_RUN_ALREADY_ACTIVE')) return '本对话还有未结束的任务，请继续或停止当前任务后再发送。输入内容已保留。';
  return raw;
}

function withUiTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (reason) => {
      window.clearTimeout(timer);
      reject(reason);
    });
  });
}

function messageTimeLabel(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function messageStatusLabel(status: ConversationMessageStatus): string {
  return status === 'FAILED' ? '失败' : status === 'CANCELLED' ? '已取消' : '';
}

function queuedFollowUpKey(conversationId: string): string {
  return `fielora:queued-follow-ups:${conversationId}`;
}

function readQueuedFollowUps(conversationId: string): QueuedFollowUp[] {
  if (!conversationId) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queuedFollowUpKey(conversationId)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<QueuedFollowUp>;
      if (typeof candidate.content !== 'string' || typeof candidate.afterRunId !== 'string') return [];
      const legacyMessageId = typeof candidate.messageId === 'string' ? candidate.messageId : null;
      const id = typeof candidate.id === 'string' ? candidate.id : legacyMessageId;
      if (!id) return [];
      return [{
        id,
        messageId: legacyMessageId,
        content: candidate.content,
        afterRunId: candidate.afterRunId,
        selectedFilePath: typeof candidate.selectedFilePath === 'string' ? candidate.selectedFilePath : null,
        permission: candidate.permission === 'READ_ONLY' || candidate.permission === 'FULL_CONTROL' ? candidate.permission : 'REVIEW_CHANGES',
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
      } satisfies QueuedFollowUp];
    });
  } catch { return []; }
}

function persistQueuedFollowUps(conversationId: string, items: QueuedFollowUp[]): void {
  if (!conversationId) return;
  if (items.length === 0) window.localStorage.removeItem(queuedFollowUpKey(conversationId));
  else window.localStorage.setItem(queuedFollowUpKey(conversationId), JSON.stringify(items));
}

function isLegacyTerminalMessage(content: string): boolean {
  return /^Terminal · ([^\n]+)\n\n([\s\S]*?)\n\nExit: ([^\n]+)$/.test(content.trim());
}

function pendingApproval(events: AgentEventView[], run: AgentRunView | null): ApprovalView | null {
  if (run?.status !== 'WAITING_APPROVAL') return null;
  const event = [...events].reverse().find((item) => item.kind === 'APPROVAL_REQUESTED');
  if (!event || !event.payload || typeof event.payload !== 'object' || !(event.payload as Record<string, unknown>).approval) return null;
  return (event.payload as { approval: ApprovalView }).approval;
}

function pendingToolSummary(events: AgentEventView[], run: AgentRunView | null): string {
  if (run?.status !== 'WAITING_APPROVAL') return '';
  const event = [...events].reverse().find((item) => item.kind === 'APPROVAL_REQUESTED');
  const payload = event?.payload as { tool?: { name?: unknown; arguments?: unknown } } | undefined;
  const name = typeof payload?.tool?.name === 'string' ? payload.tool.name : 'tool';
  const args = payload?.tool?.arguments;
  if (!args || typeof args !== 'object') return name;
  const values = args as Record<string, unknown>;
  if (name === 'run_command') return `${String(values.program ?? '')} ${Array.isArray(values.argv) ? values.argv.map(String).join(' ') : ''}`.trim();
  if (name === 'apply_patches' && Array.isArray(values.patches)) return `修改 ${values.patches.length} 个文件 · ${values.patches.slice(0, 3).map((patch) => patch && typeof patch === 'object' && 'path' in patch ? String((patch as { path: unknown }).path) : '').filter(Boolean).join('、')}`;
  if (name === 'git_stage' || name === 'git_unstage') return `${name === 'git_stage' ? '暂存' : '取消暂存'} · ${Array.isArray(values.paths) ? values.paths.map(String).join('、') : ''}`;
  if (name === 'git_commit') return `创建提交 · ${String(values.message ?? '')}`;
  if (name === 'git_push') return `推送 · ${String(values.remote ?? '')}/${String(values.branch ?? '')}`;
  if (name === 'git_create_branch') return `创建分支 · ${String(values.branch ?? '')}`;
  if (name === 'git_switch_branch') return `切换分支 · ${String(values.branch ?? '')}`;
  if (typeof values.path === 'string') return `${name} · ${values.path}`;
  if (typeof values.from === 'string' && typeof values.to === 'string') return `${name} · ${values.from} → ${values.to}`;
  if (typeof values.objective === 'string') return `${name} · ${values.objective}`;
  return name;
}

function HistoricalAgentTurn({ terminalMessage, requestText, userMessageId, copied, onCopy, onCopyError, onReview, onOpenReference, onOpenImage, onOpenActivityFile }: {
  terminalMessage: ConversationMessageView;
  requestText: string;
  userMessageId: string | null;
  copied: boolean;
  onCopy: () => void;
  onCopyError: (reason: string) => void;
  onReview: (selection: HistoricalReviewSelection) => void;
  onOpenReference: (reference: ResultReference) => void;
  onOpenImage: (preview: ResultImagePreviewView) => void;
  onOpenActivityFile: (file: ActivityFileLink) => void;
}) {
  const [run, setRun] = useState<AgentRunView | null>(null);
  const [events, setEvents] = useState<AgentEventView[]>([]);
  const [tools, setTools] = useState<AgentToolCallView[]>([]);
  const [fileRevisions, setFileRevisions] = useState<FileArtifactRevisionReviewView[]>([]);
  useEffect(() => {
    const runId = terminalMessage.invocation_id;
    if (!runId) return undefined;
    let current = true;
    void Promise.all([
      window.fielora.agent.get({ run_id: runId }),
      loadCompleteAgentEventSequence((request) => window.fielora.agent.events(request), runId),
      window.fielora.agent.toolCalls({ run_id: runId }),
      window.fielora.artifact.listFileReviews({ run_id: runId }).catch(() => ({ revisions: [] })),
    ]).then(([nextRun, nextEvents, nextTools, nextFileReviews]) => {
      if (!current) return;
      setRun(nextRun); setEvents(nextEvents); setTools(nextTools); setFileRevisions(nextFileReviews.revisions);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [terminalMessage.invocation_id]);
  const review = useMemo(() => fileRevisions.length > 0 ? buildDurableAgentReview(fileRevisions) : buildAgentReview(tools), [fileRevisions, tools]);
  const reviewSelection = (path = ''): HistoricalReviewSelection => ({
    review,
    runId: run?.id ?? terminalMessage.invocation_id ?? '',
    task: run?.task ?? requestText,
    path,
  });
  return <AgentTurn
    run={run}
    requestText={requestText}
    userMessageId={userMessageId}
    terminalMessage={terminalMessage}
    events={events}
    tools={tools}
    review={review}
    copied={copied}
    onReview={() => onReview(reviewSelection())}
    onReviewFile={(path) => onReview(reviewSelection(path))}
    onCopy={onCopy}
    onCopyError={onCopyError}
    onOpenReference={onOpenReference}
    onOpenActivityFile={onOpenActivityFile}
    onOpenImage={onOpenImage}
  />;
}

function ConversationActionsMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', pointer);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', pointer);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return <div className={`conversation-menu ${open ? 'open' : ''}`} ref={rootRef}>
    <IconButton className="conversation-menu-trigger" label="对话菜单" icon={<AppIcon name="more"/>} active={open} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)} testId="conversation-menu-trigger" />
    {open && <div role="menu" data-surface="overlay" data-testid="conversation-menu-popover"><button type="button" role="menuitem" onClick={() => { setOpen(false); onRename(); }}>重命名</button><button type="button" role="menuitem" className="quiet" onClick={() => { setOpen(false); onDelete(); }}>删除对话</button></div>}
  </div>;
}

function ConversationContextMenu({ state, onClose, onRename, onDelete }: {
  state: ConversationContextMenuState;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeWithKeyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [onClose]);
  return createPortal(<div
    ref={menuRef}
    className="conversation-context-menu"
    role="menu"
    data-surface="overlay"
    aria-label={`${state.title} 对话菜单`}
    data-testid="conversation-context-menu"
    style={{ left: state.left, top: state.top }}
  >
    <button type="button" role="menuitem" onClick={() => { onClose(); onRename(); }}><AppIcon name="edit"/>重命名</button>
    <button type="button" role="menuitem" className="danger" onClick={() => { onClose(); onDelete(); }}><AppIcon name="close"/>删除对话</button>
  </div>, document.body);
}

function ProjectContextMenu({ state, onClose, onNewConversation, onManage, onRemove }: {
  state: ProjectContextMenuState;
  onClose: () => void;
  onNewConversation: () => void;
  onManage: () => void;
  onRemove: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeWithKeyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [onClose]);
  return createPortal(<div
    ref={menuRef}
    className="conversation-context-menu project-context-menu"
    role="menu"
    data-surface="overlay"
    aria-label={`${state.project.title} 项目菜单`}
    data-testid="project-context-menu"
    style={{ left: state.left, top: state.top }}
  >
    <button type="button" role="menuitem" onClick={() => { onClose(); onNewConversation(); }}><AppIcon name="plus"/>新建对话</button>
    <button type="button" role="menuitem" onClick={() => { onClose(); onManage(); }}><AppIcon name="edit"/>管理项目</button>
    <button type="button" role="menuitem" className="danger" onClick={() => { onClose(); onRemove(); }}><AppIcon name="close"/>从 Fielora 移除</button>
  </div>, document.body);
}

function ProjectSortControl({ value, onChange }: { value: ProjectSort; onChange: (value: ProjectSort) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const updateAnchor = useCallback(() => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = 154;
    const height = 116;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, bounds.right - width));
    const top = bounds.bottom + height + 8 <= window.innerHeight
      ? bounds.bottom + 4
      : Math.max(8, bounds.top - height - 4);
    setAnchor({ left, top });
  }, []);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const reposition = () => updateAnchor();
    window.addEventListener('pointerdown', pointer);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('pointerdown', pointer);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, updateAnchor]);
  const options: Array<{ value: ProjectSort; label: string }> = [
    { value: 'RECENT', label: '最近活动' },
    { value: 'NAME', label: '名称' },
    { value: 'CREATED', label: '添加时间' },
  ];
  return <div className={`project-sort-control ${open ? 'open' : ''}`} ref={rootRef}>
    <button ref={triggerRef} type="button" aria-label="整理项目" title="整理项目" aria-haspopup="menu" aria-expanded={open} onClick={() => { if (!open) updateAnchor(); setOpen((current) => !current); }} data-testid="project-sort-toggle"><AppIcon name="sort"/></button>
    {open && anchor && createPortal(<div ref={menuRef} className="project-sort-popover" role="menu" data-surface="overlay" data-testid="project-sort-menu" style={{ left: anchor.left, top: anchor.top }}>{options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span><em>{value === option.value ? '✓' : ''}</em></button>)}</div>, document.body)}
  </div>;
}

export function ProjectWorkspace({ onNow, onBrowse, onFields, onSettings, newConversationRequest, addProjectRequest, workspaceRequest, onModelSelectionChange }: ProjectWorkspaceProps) {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [projectId, setProjectId] = useState('');
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [unsentConversationIds, setUnsentConversationIds] = useState<Set<string>>(() => new Set());
  const sidebarConversations = useMemo(() => sentConversations(conversations, unsentConversationIds), [conversations, unsentConversationIds]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<ConversationMessageView[]>([]);
  const [providers, setProviders] = useState<ProviderConfigView[]>([]);
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileView | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewState>(null);
  const [editorContent, setEditorContent] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState<'FILES' | 'DIFF'>('FILES');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [dockTabs, setDockTabs] = useState<ProjectDockTab[]>([]);
  const [activeDockTabId, setActiveDockTabId] = useState('');
  const [fileDockSessions, setFileDockSessions] = useState<Record<string, FileDockSession>>({});
  const fileRevealNonceRef = useRef(0);
  const [artifactSessions, setArtifactSessions] = useState<Record<string, ArtifactSurfaceSession>>({});
  const [artifactCommandBusy, setArtifactCommandBusy] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [fileTreeSelection, setFileTreeSelection] = useState('');
  const openTreeFileRef = useRef(openFile);
  useLayoutEffect(() => { openTreeFileRef.current = openFile; });
  const openTreeFile = useCallback((file: WorkspaceFileEntry) => { void openTreeFileRef.current(file); }, []);
  const refreshTreeFiles = useCallback(() => {
    if (projectId) void window.fielora.workspace.listFiles({ field_id: projectId }).then(setFiles).catch((reason) => setError(reasonMessage(reason)));
  }, [projectId]);
  const [environment, setEnvironment] = useState<WorkspaceEnvironmentView | null>(null);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [environmentError, setEnvironmentError] = useState(false);
  const [environmentRefresh, setEnvironmentRefresh] = useState(0);
  const [dockProjectLauncherOpen, setDockProjectLauncherOpen] = useState(false);
  const [projectOpenTargets, setProjectOpenTargets] = useState<WorkspaceProjectOpenTargetView[]>([{ target: 'FILE_EXPLORER', label: '文件资源管理器', icon_data_url: null }]);
  const [dockFileTreeCollapsed, setDockFileTreeCollapsed] = useState(false);
  const [dockFileTreeWidth, setDockFileTreeWidth] = useState(() => {
    const stored = Number.parseFloat(window.localStorage.getItem('fielora:dock-file-tree-width') ?? '270');
    return Number.isFinite(stored) ? Math.min(Math.max(stored, 160), 420) : 270;
  });
  const [dockFocused, setDockFocused] = useState(false);
  const [conversationDialog, setConversationDialog] = useState<ConversationDialog>(null);
  const [conversationContextMenu, setConversationContextMenu] = useState<ConversationContextMenuState | null>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialog>(null);
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(null);
  const [projectRemoval, setProjectRemoval] = useState<ProjectView | null>(null);
  const [projectSort, setProjectSort] = useState<ProjectSort>(() => {
    const stored = window.localStorage.getItem('fielora:project-sort');
    return stored === 'NAME' || stored === 'CREATED' ? stored : 'RECENT';
  });
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [undoChange, setUndoChange] = useState<UndoChange | null>(null);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [streamingStep, setStreamingStep] = useState(0);
  const [agentRun, setAgentRun] = useState<AgentRunView | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEventView[]>([]);
  const [agentTools, setAgentTools] = useState<AgentToolCallView[]>([]);
  const [agentFileRevisions, setAgentFileRevisions] = useState<FileArtifactRevisionReviewView[]>([]);
  const [mcpRuntime, setMcpRuntime] = useState<McpConnectionRuntimeView | null>(null);
  const [mcpBusyConnectionId, setMcpBusyConnectionId] = useState('');
  const [agentProjectionNotice, setAgentProjectionNotice] = useState('');
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalLastCommand, setTerminalLastCommand] = useState('');
  const [terminalOutput, setTerminalOutput] = useState('');
  const [terminalRunId, setTerminalRunId] = useState('');
  const [terminalWorkingDirectory, setTerminalWorkingDirectory] = useState('');
  const [bottomTerminalOpen, setBottomTerminalOpen] = useState(false);
  const bottomTerminalDragRef = useRef<{ bottom: number; area: HTMLElement; layer: HTMLElement; dock: HTMLElement; panes: HTMLElement[] } | null>(null);
  const [bottomTerminalHeight, setBottomTerminalHeight] = useState(() => {
    const stored = Number.parseFloat(window.localStorage.getItem('fielora:terminal-dock-height') ?? '250');
    return Number.isFinite(stored) ? Math.min(Math.max(stored, 170), 520) : 250;
  });
  const composerScope = composerDraftKey(projectId, conversationId);
  const { prompt, setPrompt, attachments, setAttachments, update: updateComposerDraft, move: moveComposerDraft, clear: clearComposerDraft } = useComposerDraft(composerScope);
  const [projectDraftProviderId, setProjectDraftProviderId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<WorkspaceAttachmentView | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ left: number; top: number; attachment: WorkspaceAttachmentView } | null>(null);
  const [permission, setPermission] = useState<ComposerPermission>('REVIEW_CHANGES');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [atLatestAnswer, setAtLatestAnswer] = useState(true);
  const [hasUnseenActivity, setHasUnseenActivity] = useState(false);
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [queuedFollowUpMenuId, setQueuedFollowUpMenuId] = useState('');
  const [agentReviewPath, setAgentReviewPath] = useState('');
  const [historicalReview, setHistoricalReview] = useState<HistoricalReviewSelection | null>(null);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [conversationCreatingFor, setConversationCreatingFor] = useState('');
  const [newConversationStart, setNewConversationStart] = useState(false);
  const [navigationWidth, setNavigationWidth] = useState(() => readWorkspaceNavigationWidth(WORKSPACE_NAVIGATION_DEFAULT_WIDTH, 'fielora:project-navigation-width'));
  const [workspaceWidth, setWorkspaceWidth] = useState(() => {
    const stored = Number.parseFloat(window.localStorage.getItem('fielora:project-workspace-width') ?? String(PROJECT_WORKSPACE_DEFAULT_WIDTH));
    if (!Number.isFinite(stored) || stored < PROJECT_WORKSPACE_MIN_WIDTH) return PROJECT_WORKSPACE_DEFAULT_WIDTH;
    return stored;
  });
  const workspacePreferredWidthRef = useRef(workspaceWidth);
  const workspaceDragGeometryRef = useRef<{ right: number; maximum: number } | null>(null);
  const workspaceCollapsedDuringDragRef = useRef(false);
  const workspaceFocusedDuringDragRef = useRef(false);
  const dockTabCopyNonceRef = useRef(0);
  const activeAgentRef = useRef<ActiveAgent | null>(null);
  const agentRunIdRef = useRef('');
  const agentEventsRef = useRef<AgentEventView[]>([]);
  const agentToolsRef = useRef<AgentToolCallView[]>([]);
  const agentFileRevisionsRef = useRef<FileArtifactRevisionReviewView[]>([]);
  const dockTabsRef = useRef<ProjectDockTab[]>([]);
  const artifactSessionsRef = useRef<Record<string, ArtifactSurfaceSession>>({});
  const handledArtifactToolCallsRef = useRef(new Set<string>());
  const foregroundAgentRunsRef = useRef(new Set<string>());
  const agentProjectionRefreshRef = useRef({ runId: '', inFlight: false, pending: false, timer: null as number | null });
  const terminalAgentRefreshRef = useRef(new Set<string>());
  const terminalRef = useRef<ActiveTerminal | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedConversationRef = useRef('');
  const handledNewConversationRequest = useRef(0);
  const handledAddProjectRequest = useRef(0);
  const handledWorkspaceRequest = useRef(0);
  const layoutRef = useRef<HTMLElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const atLatestAnswerRef = useRef(true);
  const environmentMenuRef = useRef<HTMLDivElement>(null);
  const dockProjectLauncherRef = useRef<HTMLDivElement>(null);
  const copiedMessageResetRef = useRef<number | null>(null);
  const creatingConversationForRef = useRef(new Set<string>());
  const sendingRef = useRef(false);
  const queuedFollowUpStartingRef = useRef(false);
  const conversationRefreshGenerationRef = useRef(0);
  const [projectActionsLayer, setProjectActionsLayer] = useState<HTMLElement | null>(null);
  const [terminalLayer, setTerminalLayer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    document.body.dataset.projectWorkspace = 'true';
    return () => { delete document.body.dataset.projectWorkspace; };
  }, []);

  useEffect(() => {
    setProjectActionsLayer(document.getElementById('desktop-project-actions-layer'));
    setTerminalLayer(document.getElementById('desktop-terminal-layer'));
  }, []);

  useEffect(() => {
    document.body.style.setProperty('--desktop-navigation-width', `${navigationWidth + 4}px`);
    return () => { document.body.style.removeProperty('--desktop-navigation-width'); };
  }, [navigationWidth]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('fielora:workspace-dock-state', { detail: { open: workspaceOpen, activeTabId: activeDockTabId } }));
  }, [activeDockTabId, workspaceOpen]);

  useEffect(() => { dockTabsRef.current = dockTabs; }, [dockTabs]);
  useEffect(() => { artifactSessionsRef.current = artifactSessions; }, [artifactSessions]);

  useEffect(() => {
    if (!queuedFollowUpMenuId) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.queued-follow-up-card')) setQueuedFollowUpMenuId('');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [queuedFollowUpMenuId]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('fielora:terminal-state', { detail: { open: bottomTerminalOpen, height: bottomTerminalHeight } }));
  }, [bottomTerminalHeight, bottomTerminalOpen]);

  useEffect(() => {
    const toggle = () => setBottomTerminalOpen((current) => !current);
    window.addEventListener('fielora:toggle-terminal', toggle);
    return () => {
      window.removeEventListener('fielora:toggle-terminal', toggle);
      window.dispatchEvent(new CustomEvent('fielora:terminal-state', { detail: { open: false, height: 250 } }));
    };
  }, []);

  useEffect(() => {
    document.body.dataset.workspaceDockFocus = String(dockFocused);
    window.dispatchEvent(new CustomEvent('fielora:workspace-focus-state', { detail: { focused: dockFocused } }));
    return () => { delete document.body.dataset.workspaceDockFocus; };
  }, [dockFocused]);

  useEffect(() => {
    const close = () => { setWorkspaceOpen(false); setDockFocused(false); };
    const openLauncher = () => setWorkspaceOpen(true);
    const toggleFocus = () => setDockFocused((current) => !current);
    window.addEventListener('fielora:close-workspace-dock', close);
    window.addEventListener('fielora:open-workspace-launcher', openLauncher);
    window.addEventListener('fielora:toggle-workspace-focus', toggleFocus);
    return () => {
      window.removeEventListener('fielora:close-workspace-dock', close);
      window.removeEventListener('fielora:open-workspace-launcher', openLauncher);
      window.removeEventListener('fielora:toggle-workspace-focus', toggleFocus);
    };
  }, []);

  useEffect(() => {
    atLatestAnswerRef.current = atLatestAnswer;
  }, [atLatestAnswer]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return undefined;
    atLatestAnswerRef.current = true;
    setAtLatestAnswer(true);
    setHasUnseenActivity(false);
    const update = () => {
      const next = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      atLatestAnswerRef.current = next;
      setAtLatestAnswer(next);
      if (next) setHasUnseenActivity(false);
    };
    list.addEventListener('scroll', update, { passive: true });
    window.requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; update(); });
    return () => list.removeEventListener('scroll', update);
  }, [conversationId]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const frame = window.requestAnimationFrame(() => {
      if (atLatestAnswerRef.current) {
        list.scrollTop = list.scrollHeight;
        setAtLatestAnswer(true);
        setHasUnseenActivity(false);
      } else {
        setAtLatestAnswer(list.scrollHeight - list.scrollTop - list.clientHeight < 80);
        setHasUnseenActivity(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [agentEvents.length, agentRun?.status, agentTools.length, conversationId, messages.length, streamingOutput]);

  const project = projects.find((item) => item.field_id === projectId) ?? null;
  const conversation = conversations.find((item) => item.id === conversationId) ?? null;
  const activeProviders = useMemo(() => providers.filter((item) => item.lifecycle_status !== 'REMOVED'), [providers]);
  const singleActiveProvider = useMemo(() => (activeProviders.length === 1 ? activeProviders[0] : null), [activeProviders]);
  const defaultConversationProvider = useMemo(() => activeProviders.find((item) => item.credential_present) ?? singleActiveProvider ?? activeProviders[0] ?? null, [activeProviders, singleActiveProvider]);
  const effectiveConversationProvider = useMemo(() => {
    if (!conversation) return projectDraftProviderId === null ? defaultConversationProvider : activeProviders.find((item) => item.id === projectDraftProviderId) ?? null;
    return conversation.provider_config_id
      ? activeProviders.find((item) => item.id === conversation.provider_config_id) ?? singleActiveProvider
      : singleActiveProvider;
  }, [activeProviders, conversation, defaultConversationProvider, projectDraftProviderId, singleActiveProvider]);
  const currentModelCapabilities = useMemo(() => modelCapabilities(effectiveConversationProvider), [effectiveConversationProvider]);
  useEffect(() => {
    onModelSelectionChange?.(effectiveConversationProvider ? { providerId: effectiveConversationProvider.id, modelId: effectiveConversationProvider.default_model } : null);
  }, [effectiveConversationProvider?.id, effectiveConversationProvider?.default_model, onModelSelectionChange]);
  const composerAttachments = useMemo(() => attachmentsForCapabilities(attachments, currentModelCapabilities), [attachments, currentModelCapabilities]);
  const approval = useMemo(() => pendingApproval(agentEvents, agentRun), [agentEvents, agentRun]);
  const approvalToolSummary = useMemo(() => pendingToolSummary(agentEvents, agentRun), [agentEvents, agentRun]);
  const agentTurn = useMemo(() => agentRun ? agentTurnOwnership(messages, agentRun, agentEvents) : null, [agentEvents, agentRun, messages]);
  const agentReview = useMemo(() => agentFileRevisions.length > 0 ? buildDurableAgentReview(agentFileRevisions) : buildAgentReview(agentTools), [agentFileRevisions, agentTools]);
  const displayedAgentReview = historicalReview?.review ?? agentReview;
  const agentRunIsTerminal = agentRun ? ['COMPLETED', 'FAILED', 'CANCELLED'].includes(agentRun.status) : false;
  const agentExecuting = agentRun?.status === 'RUNNING' || agentRun?.status === 'QUEUED';
  const awaitingAgentAnswer = agentRun?.status === 'PAUSED' && agentRun.error_code === 'AGENT_USER_INPUT_REQUIRED';
  const clarificationSubmissionRef = useRef<{ runId: string; text: string; messageId: string } | null>(null);
  const sortedProjects = useMemo(() => {
    const next = [...projects];
    if (projectSort === 'NAME') return next.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN', { sensitivity: 'base' }));
    if (projectSort === 'CREATED') return next.sort((left, right) => right.created_at - left.created_at || right.field_id.localeCompare(left.field_id));
    return next.sort((left, right) => right.updated_at - left.updated_at || right.field_id.localeCompare(left.field_id));
  }, [projectSort, projects]);

  useEffect(() => {
    setTerminalWorkingDirectory(project?.root_path ?? '');
    setTerminalCommand('');
    setTerminalLastCommand('');
    setTerminalOutput('');
  }, [project?.field_id, project?.root_path]);

  useEffect(() => {
    document.body.dataset.workspacePanelOpen = String(Boolean(project && workspaceOpen));
    const surface = layoutRef.current;
    const column = surface?.querySelector<HTMLElement>('.conversation-column');
    const navigation = surface?.querySelector<HTMLElement>('[data-testid="project-navigation"]');
    const controls = document.querySelector<HTMLElement>('[data-testid="project-context-controls"]');
    let lastInset = -1;
    let lastNavigationEdge = -1;
    const terminal = document.getElementById('desktop-terminal-layer');
    const syncControlEdge = () => {
      const columnRect = column?.getBoundingClientRect();
      const navigationEdge = Math.round(columnRect?.left ?? 0);
      if (navigationEdge !== lastNavigationEdge) {
        lastNavigationEdge = navigationEdge;
        terminal?.style.setProperty('left', `${navigationEdge}px`);
      }
      const inset = Math.round(columnRect ? Math.max(0, window.innerWidth - columnRect.right) : workspaceWidth + 4);
      if (inset === lastInset) return;
      lastInset = inset;
      controls?.style.setProperty('--desktop-project-workspace-width', `${inset}px`);
    };
    const observer = new ResizeObserver(syncControlEdge);
    for (const element of [surface, column, navigation]) if (element) observer.observe(element);
    window.addEventListener('resize', syncControlEdge);
    syncControlEdge();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncControlEdge);
      delete document.body.dataset.workspacePanelOpen;
      controls?.style.removeProperty('--desktop-project-workspace-width');
      terminal?.style.removeProperty('left');
    };
  }, [project, workspaceOpen, workspaceWidth]);

  useLayoutEffect(() => {
    const surface = layoutRef.current;
    if (!surface) return;
    const dock = surface.querySelector<HTMLElement>('.right-workspace-dock');
    const conversation = surface.querySelector<HTMLElement>('.conversation-column');
    if (!dock || !conversation) return;
    const available = surface.clientWidth - renderedNavigationWidth() - (document.body.dataset.sidebarCollapsed === 'true' ? 0 : NAVIGATION_RESIZER_WIDTH);
    const target = workspaceOpen ? (dockFocused ? available : workspaceWidth) : 0;
    dock.style.setProperty('--dock-slide-width', `${Math.max(dock.getBoundingClientRect().width, target)}px`);
    conversation.style.setProperty('--conversation-slide-width', `${Math.max(conversation.getBoundingClientRect().width, available - workspaceWidth - WORKSPACE_RESIZER_WIDTH, CONVERSATION_MIN_WIDTH)}px`);
    return trackPaneMotion(surface, () => {
      dock.style.removeProperty('--dock-slide-width');
      conversation.style.removeProperty('--conversation-slide-width');
    });
  }, [dockFocused, workspaceOpen, workspaceWidth]);

  function layoutWidth(): number {
    return layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
  }

  function renderedNavigationWidth(): number {
    const navigation = layoutRef.current?.querySelector<HTMLElement>('[data-testid="project-navigation"]');
    return navigation?.getBoundingClientRect().width ?? navigationWidth;
  }

  function workspaceMaximumWidth(): number {
    const availableWorkArea = layoutWidth() - renderedNavigationWidth() - NAVIGATION_RESIZER_WIDTH;
    return Math.max(PROJECT_WORKSPACE_MIN_WIDTH, availableWorkArea - CONVERSATION_MIN_WIDTH - WORKSPACE_RESIZER_WIDTH);
  }

  function clampWorkspaceWidth(next: number): number {
    return Math.min(Math.max(next, PROJECT_WORKSPACE_MIN_WIDTH), workspaceMaximumWidth());
  }

  function clampWorkspaceWidthTo(next: number, maximum: number): number {
    return Math.min(Math.max(next, PROJECT_WORKSPACE_MIN_WIDTH), maximum);
  }

  function captureWorkspaceDragGeometry(): { right: number; maximum: number } | null {
    const surface = layoutRef.current;
    if (!surface) return null;
    const surfaceRect = surface.getBoundingClientRect();
    const navigation = surface.querySelector<HTMLElement>('[data-testid="project-navigation"]');
    const navigationWidth = navigation?.getBoundingClientRect().width ?? WORKSPACE_NAVIGATION_DEFAULT_WIDTH;
    const availableWorkArea = surfaceRect.width - navigationWidth - NAVIGATION_RESIZER_WIDTH;
    return {
      right: surfaceRect.right,
      maximum: Math.max(PROJECT_WORKSPACE_MIN_WIDTH, availableWorkArea - CONVERSATION_MIN_WIDTH - WORKSPACE_RESIZER_WIDTH),
    };
  }

  function navigationMaximumWidth(): number {
    const reserved = workspaceOpen && project ? workspaceWidth + CONVERSATION_MIN_WIDTH : 420;
    return Math.min(WORKSPACE_NAVIGATION_MAX_WIDTH, Math.max(WORKSPACE_NAVIGATION_MIN_WIDTH, layoutWidth() - reserved));
  }

  function updateNavigationWidth(next: number) {
    const maximum = navigationMaximumWidth();
    const width = Math.min(Math.max(next, WORKSPACE_NAVIGATION_MIN_WIDTH), maximum);
    setNavigationWidth(width);
    persistWorkspaceNavigationWidth(width, 'fielora:project-navigation-width');
  }

  function updateWorkspaceWidth(next: number) {
    const preferred = clampWorkspaceWidth(next);
    workspacePreferredWidthRef.current = preferred;
    setWorkspaceWidth(clampWorkspaceWidth(preferred));
    window.localStorage.setItem('fielora:project-workspace-width', String(Math.round(preferred)));
  }

  function resizeWorkspaceDuringDrag(clientX: number, commit: boolean) {
    const geometry = workspaceDragGeometryRef.current;
    if (!geometry) return;
    const rawWidth = geometry.right - clientX;
    if (!workspaceCollapsedDuringDragRef.current && rawWidth <= PROJECT_WORKSPACE_COLLAPSE_THRESHOLD) {
      workspaceCollapsedDuringDragRef.current = true;
      workspaceFocusedDuringDragRef.current = false;
      setWorkspaceOpen(false);
      setDockFocused(false);
      return;
    }
    if (workspaceCollapsedDuringDragRef.current) {
      if (rawWidth < PROJECT_WORKSPACE_RESTORE_THRESHOLD) return;
      workspaceCollapsedDuringDragRef.current = false;
      setWorkspaceOpen(true);
    }
    // The split limit protects a readable conversation. Continuing left is an
    // intentional focus gesture; keep the saved split width for Restore.
    if (!workspaceFocusedDuringDragRef.current && rawWidth >= geometry.maximum + PROJECT_WORKSPACE_FOCUS_OVERSHOOT) {
      workspaceFocusedDuringDragRef.current = true;
      // Discard the uncommitted CSS preview as well as preserving the stored
      // preference; React may otherwise keep it when the state width is equal.
      layoutRef.current?.style.setProperty('--project-workspace-width', `${workspaceWidth}px`);
      setDockFocused(true);
    } else if (workspaceFocusedDuringDragRef.current && rawWidth <= geometry.maximum + PROJECT_WORKSPACE_UNFOCUS_OVERSHOOT) {
      workspaceFocusedDuringDragRef.current = false;
      setDockFocused(false);
    }
    if (workspaceFocusedDuringDragRef.current) return;
    const width = clampWorkspaceWidthTo(rawWidth, geometry.maximum);
    layoutRef.current?.style.setProperty('--project-workspace-width', `${width}px`);
    if (commit) updateWorkspaceWidth(width);
  }

  useEffect(() => {
    const surface = layoutRef.current;
    if (!surface) return undefined;
    let frame: number | null = null;
    const sync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (document.documentElement.dataset.resizing) return;
        const next = clampWorkspaceWidth(workspacePreferredWidthRef.current);
        setWorkspaceWidth((current) => Math.abs(current - next) < 0.5 ? current : next);
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(surface);
    const navigation = surface.querySelector<HTMLElement>('[data-testid="project-navigation"]');
    if (navigation) observer.observe(navigation);
    window.addEventListener('resize', sync);
    sync();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [navigationWidth]);

  function updateBottomTerminalHeight(next: number) {
    const height = Math.min(Math.max(next, 170), 520);
    setBottomTerminalHeight(height);
    window.localStorage.setItem('fielora:terminal-dock-height', String(Math.round(height)));
  }

  function beginBottomTerminalDrag(clientY: number) {
    const area = document.querySelector<HTMLElement>('[data-testid="desktop-work-area"]');
    const layer = document.getElementById('desktop-terminal-layer');
    const dock = layer?.querySelector<HTMLElement>('.terminal-dock');
    if (!area || !layer || !dock) return;
    const panes = [...area.querySelectorAll<HTMLElement>('.project-layout > .conversation-column, .project-layout > .project-workspace-resizer, .project-layout > .right-workspace-dock')];
    bottomTerminalDragRef.current = { bottom: clientY + layer.getBoundingClientRect().height, area, layer, dock, panes };
  }

  function resizeBottomTerminalDuringDrag(clientY: number, commit: boolean) {
    const geometry = bottomTerminalDragRef.current;
    if (!geometry) return;
    const height = Math.min(Math.max(geometry.bottom - clientY, 170), 520);
    geometry.layer.style.height = `${height}px`;
    geometry.dock.style.height = `${height - 4}px`;
    for (const pane of geometry.panes) pane.style.marginBottom = `${height}px`;
    if (!commit) return;
    // Publish once before clearing the CSS preview, so there is no frame that
    // falls back to the old height while Chrome receives its state event.
    geometry.area.style.setProperty('--desktop-terminal-height', `${height}px`);
    updateBottomTerminalHeight(height);
    geometry.layer.style.removeProperty('height');
    geometry.dock.style.removeProperty('height');
    for (const pane of geometry.panes) pane.style.removeProperty('margin-bottom');
    bottomTerminalDragRef.current = null;
  }

  const refreshProviders = useCallback(async () => setProviders(await window.fielora.provider.list()), []);
  const refreshProjects = useCallback(async (preferred?: string) => {
    const next = await window.fielora.project.list();
    setProjects(next);
    setProjectId((current) => preferred ?? (next.some((item) => item.field_id === current) ? current : next[0]?.field_id ?? ''));
    setProjectsLoaded(true);
  }, []);
  const refreshConversations = useCallback(async (fieldId: string, preferred?: string, draftSource?: string) => {
    const generation = ++conversationRefreshGenerationRef.current;
    const next = await window.fielora.conversation.list({ field_id: fieldId });
    const draftCandidates = next;
    let normalized = next;
    let unsentIds = new Set<string>();
    if (draftCandidates.length > 0) {
      const draftHistories = await Promise.all(draftCandidates.map(async (item) => ({
        conversation: item,
        messages: await window.fielora.conversation.listMessages({ conversation_id: item.id }),
      })));
      const replacements = new Map<string, ConversationView>();
      await Promise.all(draftHistories.map(async ({ conversation: draftConversation, messages: history }) => {
        const firstUserMessage = history.find((message) => message.role === 'USER');
        if (!firstUserMessage || !isDefaultConversationTitle(draftConversation.title)) return;
        const generatedTitle = conversationTitleFromContent(firstUserMessage.content);
        if (isDefaultConversationTitle(generatedTitle)) return;
        try {
          const titled = await window.fielora.conversation.update({
            conversation_id: draftConversation.id,
            expected_revision: draftConversation.revision,
            title: generatedTitle,
            provider_config_id: draftConversation.provider_config_id,
            model_id: draftConversation.model_id,
          });
          replacements.set(titled.id, titled);
        } catch {
          // A concurrent update wins; the next refresh will reconcile the display title.
        }
      }));
      normalized = next.map((item) => replacements.get(item.id) ?? item);
      unsentIds = new Set(draftHistories.filter((item) => !hasUserMessage(item.messages)).map((item) => item.conversation.id));
    }
    if (generation !== conversationRefreshGenerationRef.current) return;
    if (preferred && draftSource) moveComposerDraft(draftSource, composerDraftKey(fieldId, preferred));
    // Keep every page addressable; only the sidebar projection hides unsent drafts.
    setConversations(normalized);
    setUnsentConversationIds(unsentIds);
    setConversationId((current) => {
      if (preferred && normalized.some((item) => item.id === preferred)) return preferred;
      return normalized.some((item) => item.id === current) ? current : normalized[0]?.id ?? '';
    });
  }, [moveComposerDraft]);
  const refreshMessages = useCallback(async (id: string) => {
    const next = await window.fielora.conversation.listMessages({ conversation_id: id });
    if (selectedConversationRef.current === id) {
      setMessages(next);
      if (hasUserMessage(next)) setUnsentConversationIds((current) => {
        if (!current.has(id)) return current;
        const updated = new Set(current); updated.delete(id); return updated;
      });
    }
  }, []);
  const loadAgentRun = useCallback(async (run: AgentRunView, reset = false) => {
    const projectionStarted = performance.now();
    const sameRun = agentRunIdRef.current === run.id;
    const existing = !reset && sameRun ? agentEventsRef.current : [];
    const afterSequence = existing.at(-1)?.sequence ?? null;
    const incremental = await loadCompleteAgentEventSequence(
      (request) => window.fielora.agent.events(request),
      run.id,
      afterSequence,
      reset ? 200 : 100,
    );
    const needsTools = reset || !sameRun || incremental.some((event) => event.kind.startsWith('TOOL_') || event.kind.startsWith('APPROVAL_'));
    const [tools, nextMcpRuntime, fileReviewList] = await Promise.all([
      needsTools ? window.fielora.agent.toolCalls({ run_id: run.id }) : Promise.resolve(agentToolsRef.current),
      window.fielora.agent.mcpRuntime({ run_id: run.id }).catch(() => null),
      needsTools ? window.fielora.artifact.listFileReviews({ run_id: run.id }).catch(() => ({ revisions: [] })) : Promise.resolve({ revisions: agentFileRevisionsRef.current }),
    ]);
    if (selectedConversationRef.current !== run.conversation_id) return;
    const activeRunId = activeAgentRef.current?.runId;
    if (agentRunIdRef.current && agentRunIdRef.current !== run.id && activeRunId !== run.id) return;
    const events = mergeAgentEventPages(existing, incremental);
    agentEventsRef.current = events;
    agentToolsRef.current = tools;
    agentFileRevisionsRef.current = fileReviewList.revisions;
    processArtifactToolReceipts(tools);
    agentRunIdRef.current = run.id;
    setAgentRun(run); setAgentEvents(events); setAgentTools(tools); setAgentFileRevisions(fileReviewList.revisions); setMcpRuntime(nextMcpRuntime); setAgentProjectionNotice('');
    performance.clearMeasures('fielora.agent.projection');
    performance.measure('fielora.agent.projection', { start: projectionStarted });
    if (['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED'].includes(run.status)) {
      if (activeAgentRef.current?.runId !== run.id) activeAgentRef.current = { runId: run.id, conversationId: run.conversation_id, output: '', step: 0 };
    } else if (activeAgentRef.current?.runId === run.id) activeAgentRef.current = null;
  }, []);
  const refreshConversationAgent = useCallback(async (id: string) => {
    const runs = (await window.fielora.agent.list({ conversation_id: id })).filter((run) => !run.task.startsWith('[SUBAGENT ') && !run.task.startsWith('[HUMAN_COMMAND '));
    if (selectedConversationRef.current !== id) return;
    if (!runs[0]) { agentRunIdRef.current = ''; agentEventsRef.current = []; agentToolsRef.current = []; agentFileRevisionsRef.current = []; setAgentRun(null); setAgentEvents([]); setAgentTools([]); setAgentFileRevisions([]); setMcpRuntime(null); activeAgentRef.current = null; return; }
    await loadAgentRun(runs[0], true);
  }, [loadAgentRun]);

  useEffect(() => {
    void Promise.all([refreshProjects(), refreshProviders()]).catch((reason) => setError(reasonMessage(reason)));
  }, [refreshProjects, refreshProviders]);

  useEffect(() => {
    const changed = () => void refreshProviders().catch((reason) => setError(reasonMessage(reason)));
    window.addEventListener('fielora:providers-changed', changed);
    return () => window.removeEventListener('fielora:providers-changed', changed);
  }, [refreshProviders]);

  useEffect(() => {
    if (!projectId) { setConversations([]); setConversationId(''); setFiles([]); setEnvironment(null); setDockTabs([]); setArtifactSessions({}); setActiveDockTabId(''); setWorkspaceOpen(false); setDockFocused(false); foregroundAgentRunsRef.current.clear(); return; }
    setProjectDraftProviderId(null);
    setEnvironment(null);
    setSelectedFile(null); setFilePreview(null); setEditorContent(''); setDraft(null); setUndoChange(null);
    setWorkspaceOpen(false); setDockTabs([]); setArtifactSessions({}); setActiveDockTabId(''); setFileDockSessions({}); setFileTreeSelection(''); setEnvironmentOpen(false); setDockProjectLauncherOpen(false); setDockFocused(false); handledArtifactToolCallsRef.current.clear(); foregroundAgentRunsRef.current.clear();
    void Promise.all([
      refreshConversations(projectId),
      window.fielora.workspace.listFiles({ field_id: projectId }).then(setFiles),
      window.fielora.workspace.getOpenTargets({ field_id: projectId }).then(setProjectOpenTargets),
    ]).catch((reason) => setError(reasonMessage(reason)));
  }, [projectId, refreshConversations]);

  useEffect(() => {
    if (!environmentOpen || !projectId) return;
    let cancelled = false;
    setEnvironmentLoading(true);
    setEnvironmentError(false);
    void window.fielora.workspace.getEnvironment({ field_id: projectId })
      .then((value) => { if (!cancelled) setEnvironment(value); })
      .catch(() => { if (!cancelled) { setEnvironment(null); setEnvironmentError(true); } })
      .finally(() => { if (!cancelled) setEnvironmentLoading(false); });
    return () => { cancelled = true; };
  }, [environmentOpen, environmentRefresh, projectId]);

  useEffect(() => {
    selectedConversationRef.current = conversationId;
    setStreamingOutput('');
    setStreamingStep(0);
    setQueuedFollowUps(readQueuedFollowUps(conversationId));
    queuedFollowUpStartingRef.current = false;
    setHistoricalReview(null); setAgentReviewPath('');
    const conversationOverride = conversationId ? localStorage.getItem(`fielora:conversation-permission:${conversationId}`) : null;
    const projectDefault = projectId ? localStorage.getItem(`fielora:project-permission:${projectId}`) : null;
    const globalDefault = localStorage.getItem('fielora:permission:default');
    setPermission(resolveComposerPermission(conversationOverride, projectDefault, globalDefault));
    agentEventsRef.current = [];
    agentToolsRef.current = [];
    agentFileRevisionsRef.current = [];
    agentRunIdRef.current = '';
    setAgentProjectionNotice('');
    setAgentFileRevisions([]);
    if (!conversationId) { setMessages([]); setAgentRun(null); setAgentEvents([]); setAgentTools([]); setMcpRuntime(null); activeAgentRef.current = null; return; }
    void refreshMessages(conversationId).catch((reason) => setError(reasonMessage(reason)));
    void refreshConversationAgent(conversationId).catch(() => setAgentProjectionNotice(AGENT_PROJECTION_UNAVAILABLE_MESSAGE));
  }, [conversationId, projectId, refreshConversationAgent, refreshMessages]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  useEffect(() => () => {
    if (copiedMessageResetRef.current !== null) window.clearTimeout(copiedMessageResetRef.current);
  }, []);

  async function copyMessage(message: ConversationMessageView): Promise<void> {
    try {
      await window.fielora.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      if (copiedMessageResetRef.current !== null) window.clearTimeout(copiedMessageResetRef.current);
      copiedMessageResetRef.current = window.setTimeout(() => {
        setCopiedMessageId('');
        copiedMessageResetRef.current = null;
      }, 1600);
    } catch (reason) {
      setError(`复制消息失败：${reasonMessage(reason)}`);
    }
  }

  useEffect(() => {
    if (!environmentOpen && !dockProjectLauncherOpen) return;
    const close = (event: PointerEvent) => {
      if (!environmentMenuRef.current?.contains(event.target as Node)) setEnvironmentOpen(false);
      if (!dockProjectLauncherRef.current?.contains(event.target as Node)) setDockProjectLauncherOpen(false);
    };
    window.addEventListener('pointerdown', close);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (environmentOpen) {
        setEnvironmentOpen(false);
        environmentMenuRef.current?.querySelector<HTMLButtonElement>('[data-testid="environment-menu-toggle"]')?.focus();
      }
      setDockProjectLauncherOpen(false);
    };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [dockProjectLauncherOpen, environmentOpen]);

  const refreshChangedAgent = useCallback(async (runId: string) => {
    const refresh = agentProjectionRefreshRef.current;
    refresh.runId = runId;
    if (refresh.inFlight) { refresh.pending = true; return; }
    refresh.inFlight = true;
    try {
      do {
        refresh.pending = false;
        const nextRunId = refresh.runId;
        try {
          const run = await window.fielora.agent.get({ run_id: nextRunId });
          if (run.task.startsWith('[SUBAGENT ') || selectedConversationRef.current !== run.conversation_id) continue;
          if (agentRunIdRef.current && agentRunIdRef.current !== run.id && activeAgentRef.current?.runId !== run.id) continue;
          await loadAgentRun(run);
          if (run.status === 'PAUSED' && ['AGENT_USER_INPUT_REQUIRED', 'AGENT_TASK_BLOCKED'].includes(run.error_code ?? '')) await refreshMessages(run.conversation_id);
          if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status) && !terminalAgentRefreshRef.current.has(run.id)) {
            terminalAgentRefreshRef.current.add(run.id);
            if (activeAgentRef.current?.runId === run.id) activeAgentRef.current = null;
            setStreamingOutput('');
            setStreamingStep(0);
            await Promise.all([
              refreshMessages(run.conversation_id),
              refreshConversations(run.field_id, run.conversation_id),
              window.fielora.workspace.listFiles({ field_id: run.field_id }).then(setFiles),
            ]);
          }
        } catch {
          setAgentProjectionNotice(AGENT_PROJECTION_UNAVAILABLE_MESSAGE);
        }
      } while (refresh.pending);
    } finally {
      refresh.inFlight = false;
    }
  }, [loadAgentRun, refreshConversations, refreshMessages]);

  useEffect(() => window.fielora.core.subscribe((event) => {
    if (event.event === 'event.agent.browser') {
      if (activeAgentRef.current?.runId === (event as { run_id: string }).run_id) openDockTool('BROWSER');
      return;
    }
    if (event.event === 'event.agent.text_delta') {
      const delta = event as AgentTextDeltaEvent;
      const active = activeAgentRef.current;
      if (!active || active.runId !== delta.run_id) return;
      if (active.step !== delta.step) {
        active.step = delta.step;
        active.output = '';
      }
      active.output += delta.text_delta;
      setStreamingStep(active.step);
      setStreamingOutput(active.output);
      return;
    }
    if (event.event !== 'event.agent.changed') return;
    const runId = (event as AgentChangedEvent).run_id;
    const refresh = agentProjectionRefreshRef.current;
    refresh.runId = runId;
    refresh.pending = true;
    if (refresh.timer !== null) return;
    refresh.timer = window.setTimeout(() => {
      refresh.timer = null;
      void refreshChangedAgent(refresh.runId);
    }, 40);
  }), [refreshChangedAgent]);

  useEffect(() => () => {
    const timer = agentProjectionRefreshRef.current.timer;
    if (timer !== null) window.clearTimeout(timer);
  }, []);

  useEffect(() => window.fielora.workspace.subscribe((event) => {
    const active = terminalRef.current;
    if (!active) return;
    if (active.runId === 'pending') active.runId = event.run_id;
    if (active.runId !== event.run_id) return;
    if (event.kind === 'OUTPUT' && event.text) {
      active.output += event.text;
      setTerminalOutput(active.output);
      return;
    }
    if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(event.kind)) return;
    terminalRef.current = null; setTerminalRunId('');
  }), []);

  async function addProject() {
    setError('');
    try {
      const created = await window.fielora.project.pick({ title: '', goal: null });
      if (created) {
        await refreshProjects(created.field_id);
      }
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function rebindProject(targetProject: ProjectView) {
    setError('');
    try {
      const rebound = await window.fielora.project.rebind({ field_id: targetProject.field_id });
      if (rebound) await refreshProjects(rebound.field_id);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function createConversationFor(targetProject: ProjectView, options: { provider?: ProviderConfigView; preserveComposer?: boolean } = {}): Promise<ConversationView | null> {
    const fieldId = targetProject.field_id;
    setProjectId(fieldId);
    setCollapsedProjectIds((current) => {
      if (!current.has(fieldId)) return current;
      const next = new Set(current);
      next.delete(fieldId);
      return next;
    });
    setNewConversationStart(false);
    if (creatingConversationForRef.current.has(fieldId)) return null;
    creatingConversationForRef.current.add(fieldId);
    setConversationCreatingFor(fieldId);
    setError('');
    try {
      const existing = await withUiTimeout(window.fielora.conversation.list({ field_id: fieldId }), 12_000, '创建对话超时，请重试。');
      const currentDraft = existing.find((item) => item.id === selectedConversationRef.current);
      const candidates = currentDraft ? [currentDraft, ...existing.filter((item) => item.id !== currentDraft.id)] : existing;
      for (const candidate of candidates) {
        const history = await withUiTimeout(window.fielora.conversation.listMessages({ conversation_id: candidate.id }), 12_000, '读取现有对话超时，请重试。');
        if (!hasUserMessage(history)) {
          if (options.preserveComposer) {
            moveComposerDraft(composerScope, composerDraftKey(fieldId, candidate.id));
            localStorage.setItem(`fielora:conversation-permission:${candidate.id}`, permission);
          }
          await refreshConversations(fieldId, candidate.id);
          return candidate;
        }
      }
      const ready = options.provider ?? defaultConversationProvider;
      const created = await withUiTimeout(window.fielora.conversation.create({
        field_id: fieldId, title: '新对话', provider_config_id: ready?.id ?? null, model_id: ready?.default_model ?? null,
      }), 12_000, '创建对话超时，请重试。');
      if (options.preserveComposer) {
        localStorage.setItem(`fielora:conversation-permission:${created.id}`, permission);
      }
      // Transfer after loading, immediately before publishing the selected page:
      // typing while creation/listing is pending still belongs to this draft.
      await refreshConversations(fieldId, created.id, options.preserveComposer ? composerScope : composerDraftKey(fieldId, ''));
      return created;
    } catch (reason) {
      setError(`无法创建新对话：${reasonMessage(reason)}`);
      return null;
    } finally {
      creatingConversationForRef.current.delete(fieldId);
      setConversationCreatingFor((current) => current === fieldId ? '' : current);
    }
  }

  async function createConversation() {
    if (!project) { setNewConversationStart(true); return; }
    await createConversationFor(project);
  }

  function activateConversation(id: string) {
    setConversationId(id);
  }

  useEffect(() => {
    if (!projectsLoaded || newConversationRequest <= handledNewConversationRequest.current) return;
    handledNewConversationRequest.current = newConversationRequest;
    if (project) void createConversation();
    else setNewConversationStart(true);
  }, [newConversationRequest, project, projectsLoaded]);

  useEffect(() => {
    if (!projectsLoaded || addProjectRequest <= handledAddProjectRequest.current) return;
    handledAddProjectRequest.current = addProjectRequest;
    void addProject();
  }, [addProjectRequest, projectsLoaded]);

  useEffect(() => {
    if (!projectsLoaded || workspaceRequest.id <= handledWorkspaceRequest.current) return;
    if (projects.length === 0) {
      handledWorkspaceRequest.current = workspaceRequest.id;
      setError('请先打开一个本地 Project，再使用文件、审阅或终端。');
      return;
    }
    if (!project) return;
    handledWorkspaceRequest.current = workspaceRequest.id;
    openWorkspace(workspaceRequest.tool);
  }, [project, projects, projectsLoaded, workspaceRequest]);

  async function renameConversation(title: string) {
    if (!conversation) return;
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === conversation.title) { setConversationDialog(null); return; }
    try {
      const updated = await window.fielora.conversation.update({
        conversation_id: conversation.id, expected_revision: conversation.revision, title: nextTitle,
        provider_config_id: conversation.provider_config_id, model_id: conversation.model_id,
      });
      await refreshConversations(updated.field_id, updated.id);
      setConversationDialog(null);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  function updateProjectSort(value: ProjectSort) {
    setProjectSort(value);
    window.localStorage.setItem('fielora:project-sort', value);
  }

  async function renameProject() {
    if (!projectDialog) return;
    const nextTitle = projectDialog.value.trim();
    if (!nextTitle || nextTitle === projectDialog.project.title) { setProjectDialog(null); return; }
    try {
      const updated = await window.fielora.project.update({
        field_id: projectDialog.project.field_id,
        expected_revision: projectDialog.project.revision,
        title: nextTitle,
      });
      await refreshProjects(updated.field_id);
      setProjectDialog(null);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function archiveProject(target: ProjectView) {
    if (target.field_id === projectId && activeAgentRef.current) {
      setProjectRemoval(null);
      setError('请先停止当前 Agent，再移除这个项目。');
      return;
    }
    if (target.field_id === projectId && terminalRunId) {
      setProjectRemoval(null);
      setError('请先停止当前终端任务，再移除这个项目。');
      return;
    }
    try {
      await window.fielora.project.archive({
        field_id: target.field_id,
        expected_revision: target.revision,
      });
      const remaining = sortedProjects.filter((item) => item.field_id !== target.field_id);
      const preferred = target.field_id === projectId ? remaining[0]?.field_id ?? '' : projectId;
      setProjectRemoval(null);
      setProjectContextMenu(null);
      await refreshProjects(preferred);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function archiveConversation() {
    if (!conversation) return;
    try {
      await window.fielora.conversation.archive({ conversation_id: conversation.id, expected_revision: conversation.revision });
      await refreshConversations(conversation.field_id);
      setConversationDialog(null);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function updateConversationSelection(providerId: string, modelId?: string) {
    if (!conversation) { setProjectDraftProviderId(providerId); return; }
    const provider = activeProviders.find((item) => item.id === providerId) ?? null;
    try {
      const updated = await window.fielora.conversation.update({
        conversation_id: conversation.id, expected_revision: conversation.revision, title: conversation.title,
        provider_config_id: provider?.id ?? null, model_id: modelId ?? provider?.default_model ?? null,
      });
      setConversations((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  function updatePermission(value: ComposerPermission) {
    setPermission(value);
    if (conversation) localStorage.setItem(`fielora:conversation-permission:${conversation.id}`, value);
    if (project) localStorage.setItem(`fielora:project-permission:${project.field_id}`, value);
    localStorage.setItem('fielora:permission:default', value);
  }

  async function decideApproval(decision: 'ALLOW_ONCE' | 'DENY') {
    if (!agentRun || !approval) return;
    setBusy(true); setError('');
    try {
      await window.fielora.agent.resolveApproval({ run_id: agentRun.id, approval_id: approval.id, nonce: approval.nonce, decision });
      const next = await window.fielora.agent.get({ run_id: agentRun.id });
      await loadAgentRun(next);
    } catch (reason) { setError(reasonMessage(reason)); }
    finally { setBusy(false); }
  }

  async function resumeAgent() {
    if (!agentRun || sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true); setError('');
    try {
      const ownership = agentTurnOwnership(messages, agentRun, agentEvents);
      const images = await restoredAgentImages(agentRun.task, agentRun.conversation_id, ownership.userMessageId);
      const next = await window.fielora.agent.resume({ resource_budget: readAppPreferences(window.localStorage).agentResourceBudget, run_id: agentRun.id, attachments: agentImageInputs(images) });
      activeAgentRef.current = { runId: next.id, conversationId: next.conversation_id, output: '', step: 0 }; await loadAgentRun(next);
    }
    catch (reason) { setError(reasonMessage(reason)); }
    finally { sendingRef.current = false; setBusy(false); }
  }

  async function activateMcpConnection(connectionId: string) {
    if (!agentRun || mcpBusyConnectionId) return;
    setMcpBusyConnectionId(connectionId); setError('');
    try {
      await window.fielora.agent.activateMcpConnection({ run_id: agentRun.id, connection_id: connectionId });
      const next = await window.fielora.agent.get({ run_id: agentRun.id });
      await loadAgentRun(next);
    } catch (reason) {
      setError(`MCP 激活请求失败：${reasonMessage(reason)}`);
      const runtime = await window.fielora.agent.mcpRuntime({ run_id: agentRun.id }).catch(() => null);
      setMcpRuntime(runtime);
    } finally {
      setMcpBusyConnectionId('');
    }
  }

  async function cancelAgent() {
    if (!agentRun || sendingRef.current) return;
    sendingRef.current = true; setBusy(true); setError('');
    try { const next = await window.fielora.agent.cancel({ run_id: agentRun.id }); await loadAgentRun(next); }
    catch (reason) { setError(reasonMessage(reason)); }
    finally { sendingRef.current = false; setBusy(false); }
  }

  async function retryAgent() {
    if (!project || !conversation || !agentRun || agentRun.status !== 'FAILED' || activeAgentRef.current || sendingRef.current) return;
    const provider = activeProviders.find((item) => item.id === agentRun.provider_config_id) ?? effectiveConversationProvider;
    if (!provider || !provider.credential_present) { setError('原模型配置已不可用，请先在设置中检查。'); return; }
    sendingRef.current = true;
    setBusy(true); setError('');
    try {
      const ownership = agentTurnOwnership(messages, agentRun, agentEvents);
      const retryImages = await restoredAgentImages(agentRun.task, agentRun.conversation_id, ownership.userMessageId);
      const started = await window.fielora.agent.start({
        resource_budget: readAppPreferences(window.localStorage).agentResourceBudget,
        field_id: project.field_id,
        conversation_id: conversation.id,
        user_message_id: ownership.userMessageId,
        provider_config_id: provider.id,
        model_id: agentRun.model_id,
        task: agentRun.task,
        permission: agentRun.permission,
        max_steps: null,
        attachments: agentImageInputs(retryImages),
        active_work_surface: selectedActiveArtifactContext(),
      });
      foregroundAgentRunsRef.current.add(started.id);
      activeAgentRef.current = { runId: started.id, conversationId: conversation.id, output: '', step: 0 };
      agentRunIdRef.current = started.id; agentEventsRef.current = []; agentToolsRef.current = []; agentFileRevisionsRef.current = [];
      setAgentRun(started); setAgentEvents([]); setAgentTools([]); setAgentFileRevisions([]); setMcpRuntime(null); setStreamingOutput(''); setStreamingStep(0);
      scrollToLatestAnswer();
    } catch (reason) { setError(reasonMessage(reason)); }
    finally { sendingRef.current = false; setBusy(false); }
  }

  async function pickAttachments() {
    setError('');
    try {
      const selection = await window.fielora.workspace.pickAttachments();
      await acceptAttachmentSelection(selection.attachments, 'file_picker', selection.truncated_count);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function acceptAttachmentSelection(incoming: WorkspaceAttachmentView[], source: WorkspaceAttachmentView['source'], truncatedCount = 0, targetScope = composerScope) {
    const normalized = await normalizeAttachmentSelection(incoming, source, (request) => window.fielora.workspace.storeAttachment(request));
    let overflow = truncatedCount;
    updateComposerDraft(targetScope, current => {
      const unique = normalized.filter((item) => !current.attachments.some((existing) => existing.id === item.id));
      overflow += Math.max(0, current.attachments.length + unique.length - 4);
      return { ...current, attachments: [...current.attachments, ...unique].slice(0, 4) };
    });
    const rejected = attachmentsForCapabilities(normalized, currentModelCapabilities).filter((item) => item.status !== 'READY');
    if (overflow > 0) setError(`一次最多添加 4 个附件，已忽略 ${overflow} 个。`);
    else if (rejected.length > 0) setError(rejected.map((item) => `${item.name}：${item.reason}`).join('；'));
    else setError('');
  }

  async function addBrowserAttachments(files: readonly File[], source: 'clipboard' | 'drag_drop') {
    const targetScope = composerScope;
    try {
      const selection = await loadBrowserAttachments(files, source);
      await acceptAttachmentSelection(selection.attachments, source, selection.truncated_count, targetScope);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return; // Keep Chromium's native text/code paste and cursor behavior.
    event.preventDefault();
    void addBrowserAttachments(files, 'clipboard');
  }

  function handleComposerDrop(event: DragEvent<HTMLFormElement>) {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addBrowserAttachments(files, 'drag_drop');
  }

  function openImageContextMenu(event: ReactMouseEvent, attachment: WorkspaceAttachmentView) {
    setImageContextMenu({ left: Math.max(8, Math.min(window.innerWidth - 170, event.clientX)), top: Math.max(8, Math.min(window.innerHeight - 48, event.clientY)), attachment });
  }

  async function saveImageAttachment(attachment: WorkspaceAttachmentView) {
    setImageContextMenu(null);
    if (!attachment.content_ref) { setError('这张图片还没有可保存的本地内容。'); return; }
    try { await window.fielora.workspace.saveAttachment({ content_ref: attachment.content_ref, filename: attachment.name }); }
    catch (reason) { setError(reasonMessage(reason)); }
  }

  async function copyImageAttachment(attachment: WorkspaceAttachmentView) {
    setImageContextMenu(null);
    if (!attachment.content_ref) { setError('这张图片还没有可复制的本地内容。'); return; }
    try { await window.fielora.workspace.copyAttachment({ content_ref: attachment.content_ref }); }
    catch (reason) { setError(reasonMessage(reason)); }
  }

  function toggleVoiceInput() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setError('当前 Windows 语音识别服务不可用，请继续使用文字输入。'); return; }
    const recognition = new Recognition();
    const original = prompt.trim();
    recognition.lang = navigator.language || 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index]?.[0]?.transcript ?? '';
      setPrompt(`${original}${original && transcript ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = (event) => {
      setListening(false); recognitionRef.current = null;
      setError(event.error === 'not-allowed' ? '麦克风权限未开启，请在 Windows 隐私设置中允许后重试。' : '语音识别没有成功，请重试或继续输入文字。');
    };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    setError(''); setListening(true);
    try { recognition.start(); }
    catch { setListening(false); recognitionRef.current = null; setError('语音识别无法启动，请继续使用文字输入。'); }
  }

  async function queueFollowUp(content: string) {
    const active = activeAgentRef.current;
    if (!project || !conversation || !active) return;
    const userText = content.trim();
    if (!userText) return;
    if (composerAttachments.some((item) => item.status === 'READY')) {
      setError('运行中追加暂时只支持文字；附件仍保留在输入框中，可在当前任务结束后发送。');
      return;
    }
    const queued: QueuedFollowUp = {
      id: crypto.randomUUID(),
      messageId: null,
      content: userText,
      afterRunId: active.runId,
      selectedFilePath: selectedFile?.relative_path ?? null,
      permission,
      createdAt: Date.now(),
    };
    setQueuedFollowUps((current) => {
      const next = [...current, queued];
      persistQueuedFollowUps(conversation.id, next);
      return next;
    });
    setPrompt('');
    scrollToLatestAnswer();
  }

  function removeQueuedFollowUp(id: string) {
    if (!conversation) return;
    setQueuedFollowUpMenuId('');
    setQueuedFollowUps((current) => {
      const next = current.filter((item) => item.id !== id);
      persistQueuedFollowUps(conversation.id, next);
      return next;
    });
  }

  function editQueuedFollowUp(item: QueuedFollowUp) {
    if (item.messageId) {
      setError('这条追加消息已经进入启动流程，暂时不能再编辑。');
      return;
    }
    setPrompt(item.content);
    removeQueuedFollowUp(item.id);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function historicalInputImages(task: string, conversationId: string, originMessageId?: string | null) {
    return referencedConversationImages(task, conversationId,
      await window.fielora.conversation.listMessages({ conversation_id: conversationId }),
      messageAttachments, content_ref => window.fielora.workspace.readAttachment({ content_ref }), originMessageId);
  }

  async function restoredAgentImages(task: string, conversationId: string, originMessageId?: string | null) {
    // Without ownership, only Core may restore its canonical run input blobs.
    if (!originMessageId) return [];
    const originals = messageAttachments(originMessageId).filter(item => item.kind === 'IMAGE');
    if (!originals.length) return historicalInputImages(task, conversationId, originMessageId);
    return Promise.all(originals.map(async item => {
      if (item.data_url) return item;
      if (!item.content_ref) throw new Error('原消息的图片引用已不可用。');
      return { ...item, ...await window.fielora.workspace.readAttachment({ content_ref: item.content_ref }) };
    }));
  }

  function agentImageInputs(images: readonly WorkspaceAttachmentView[]) {
    return images.map(item => ({ id: item.id, filename: item.name, mime_type: item.mime_type, size: item.size,
      width: item.width!, height: item.height!, source: item.source, data_url: item.data_url! }));
  }

  async function startQueuedFollowUp(item: QueuedFollowUp) {
    if (!project || !conversation || activeAgentRef.current || !agentRunIsTerminal) return;
    const provider = effectiveConversationProvider;
    if (!provider || !provider.credential_present) throw new Error('追加任务对应的模型服务当前不可用，请在设置中检查。');
    let messageId = item.messageId;
    if (!messageId) {
      const message = await window.fielora.conversation.createMessage({
        conversation_id: conversation.id, role: 'USER', content: item.content, status: 'COMPLETED',
        provider_config_id: null, model_id: null, invocation_id: null, references: [],
      });
      messageId = message.id;
      setQueuedFollowUps((current) => {
        const next = current.map((queued) => queued.id === item.id ? { ...queued, messageId } : queued);
        persistQueuedFollowUps(conversation.id, next);
        return next;
      });
      await refreshMessages(conversation.id);
    }
    const selectedHint = item.selectedFilePath ? `\n\nThe currently selected project file is: ${item.selectedFilePath}` : '';
    const started = await window.fielora.agent.start({
        resource_budget: readAppPreferences(window.localStorage).agentResourceBudget,
      field_id: project.field_id, conversation_id: conversation.id,
      user_message_id: messageId,
      provider_config_id: provider.id, model_id: provider.default_model,
      task: `${item.content}${selectedHint}`.slice(0, 32_000), permission: item.permission, max_steps: null,
      attachments: agentImageInputs(await historicalInputImages(item.content, conversation.id)),
      active_work_surface: selectedActiveArtifactContext(),
    });
    foregroundAgentRunsRef.current.add(started.id);
    activeAgentRef.current = { runId: started.id, conversationId: conversation.id, output: '', step: 0 };
    agentRunIdRef.current = started.id; agentEventsRef.current = []; agentToolsRef.current = []; agentFileRevisionsRef.current = [];
    setAgentRun(started); setAgentEvents([]); setAgentTools([]); setAgentFileRevisions([]); setMcpRuntime(null); setStreamingOutput(''); setStreamingStep(0);
    scrollToLatestAnswer();
    setQueuedFollowUps((current) => {
      const next = current.filter((queued) => queued.id !== item.id);
      persistQueuedFollowUps(conversation.id, next);
      return next;
    });
  }

  async function answerAgentQuestion(content: string, run: AgentRunView) {
    const text = content.trim();
    if (!text || !conversation || run.conversation_id !== conversation.id) return;
    if (composerAttachments.some(item => item.status === 'READY')) { setError('请先用文字回答当前问题；附件仍保留在输入框中。'); return; }
    sendingRef.current = true;
    setBusy(true); setError('');
    try {
      let submission = clarificationSubmissionRef.current;
      if (!submission || submission.runId !== run.id || submission.text !== text) {
        const message = await window.fielora.conversation.createMessage({ conversation_id: run.conversation_id, role: 'USER', content: text, status: 'COMPLETED', provider_config_id: null, model_id: null, invocation_id: null, references: [] });
        submission = { runId: run.id, text, messageId: message.id };
        clarificationSubmissionRef.current = submission;
      }
      const resumed = await window.fielora.agent.resume({ resource_budget: readAppPreferences(window.localStorage).agentResourceBudget, run_id: run.id, user_message_id: submission.messageId });
      clarificationSubmissionRef.current = null;
      setPrompt(''); setStreamingOutput(''); setStreamingStep(0);
      activeAgentRef.current = { runId: resumed.id, conversationId: resumed.conversation_id, output: '', step: 0 };
      await Promise.all([loadAgentRun(resumed), refreshMessages(resumed.conversation_id)]);
      scrollToLatestAnswer();
    } catch (reason) { setError(reasonMessage(reason)); }
    finally { sendingRef.current = false; setBusy(false); }
  }

  async function send(content: string) {
    if (!project || sendingRef.current) return;
    if (agentRun?.status === 'PAUSED' && agentRun.error_code === 'AGENT_USER_INPUT_REQUIRED') { await answerAgentQuestion(content, agentRun); return; }
    if (activeAgentRef.current) {
      sendingRef.current = true;
      try { setError(''); await queueFollowUp(content); }
      finally { sendingRef.current = false; }
      return;
    }
    const provider = effectiveConversationProvider;
    if (!provider || !provider.credential_present) { setError('请先选择已配置凭据的模型服务。'); return; }
    const blockedImage = composerAttachments.find((item) => item.kind === 'IMAGE' && item.status !== 'READY');
    if (blockedImage) { setError(blockedImage.reason ?? '当前模型不支持图片输入'); return; }
    const readyTextAttachments = composerAttachments.filter((item) => item.status === 'READY' && item.kind === 'TEXT' && item.content !== null && item.sha256 !== null);
    const readyImageAttachments = composerAttachments.filter((item) => item.status === 'READY' && item.kind === 'IMAGE' && item.data_url && item.sha256 && item.width && item.height && item.content_ref);
    const readyAttachments = [...readyTextAttachments, ...readyImageAttachments];
    const userText = content.trim() || (readyAttachments.length > 0 ? '请阅读并分析这些附件。' : '');
    if (!userText) return;
    sendingRef.current = true;
    setBusy(true); setError('');
    try {
      let activeConversation = conversation ?? await createConversationFor(project, { provider, preserveComposer: true });
      if (!activeConversation) return;
      const targetConversationId = activeConversation.id;
      // Projection can lag behind Core after restart or a status transition.
      // Check admission before creating a visible, durable user message.
      const pendingRun = (await window.fielora.agent.list({ conversation_id: targetConversationId }))
        .find((run) => ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED'].includes(run.status) && !run.task.startsWith('[SUBAGENT '));
      if (pendingRun) {
        if (selectedConversationRef.current !== targetConversationId) return;
        activeAgentRef.current = { runId: pendingRun.id, conversationId: targetConversationId, output: '', step: 0 };
        await loadAgentRun(pendingRun);
        if (selectedConversationRef.current !== targetConversationId) return;
        if (pendingRun.error_code === 'AGENT_USER_INPUT_REQUIRED' && pendingRun.status === 'PAUSED') { sendingRef.current = false; await answerAgentQuestion(content, pendingRun); return; }
        await queueFollowUp(content);
        return;
      }
      if (activeConversation.provider_config_id !== provider.id || activeConversation.model_id !== provider.default_model) {
        const synced = await window.fielora.conversation.update({
          conversation_id: targetConversationId, expected_revision: activeConversation.revision, title: activeConversation.title,
          provider_config_id: provider.id, model_id: provider.default_model,
        });
        activeConversation = synced;
        setConversations((items) => items.map((item) => item.id === synced.id ? synced : item));
      }
      const runImages = readyImageAttachments.length ? readyImageAttachments : await historicalInputImages(userText, targetConversationId);
      const visibleMessage = readyTextAttachments.length > 0 ? `${userText}\n\n附件：${readyTextAttachments.map((item) => item.name).join('、')}` : userText;
      const userMessage = await window.fielora.conversation.createMessage({
        conversation_id: targetConversationId, role: 'USER', content: visibleMessage, status: 'COMPLETED',
        provider_config_id: null, model_id: null, invocation_id: null, references: [],
      });
      persistMessageAttachments(userMessage.id, readyImageAttachments);
      await refreshMessages(targetConversationId);
      if (isDefaultConversationTitle(activeConversation.title)) {
        try {
          const latest = await window.fielora.conversation.get({ conversation_id: targetConversationId });
          const generatedTitle = conversationTitleFromContent(userText);
          if (!isDefaultConversationTitle(generatedTitle)) {
            const titled = await window.fielora.conversation.update({
              conversation_id: latest.id,
              expected_revision: latest.revision,
              title: generatedTitle,
              provider_config_id: latest.provider_config_id,
              model_id: latest.model_id,
            });
            await refreshConversations(titled.field_id, titled.id);
          }
        } catch {
          // Title generation is presentation metadata and must never stop an accepted user task.
        }
      }
      const selectedHint = selectedFile ? `\n\nThe currently selected project file is: ${selectedFile.relative_path}` : '';
      const attachmentContext = readyTextAttachments.map((item) => `\n<attachment name=${JSON.stringify(item.name)} sha256=${JSON.stringify(item.sha256)}>\n${item.content!.slice(0, 32_000)}\n</attachment>`).join('');
      const task = `${userText}${selectedHint}${attachmentContext}`.slice(0, 32_000);
      const started = await window.fielora.agent.start({
        resource_budget: readAppPreferences(window.localStorage).agentResourceBudget,
        field_id: project.field_id, conversation_id: targetConversationId,
        user_message_id: userMessage.id,
        provider_config_id: provider.id, model_id: provider.default_model,
        task, permission, max_steps: null,
        attachments: agentImageInputs(runImages),
        active_work_surface: selectedActiveArtifactContext(),
      });
      foregroundAgentRunsRef.current.add(started.id);
      activeAgentRef.current = { runId: started.id, conversationId: targetConversationId, output: '', step: 0 };
      agentRunIdRef.current = started.id; agentEventsRef.current = []; agentToolsRef.current = []; agentFileRevisionsRef.current = [];
      setAgentRun(started); setAgentEvents([]); setAgentTools([]); setAgentFileRevisions([]); setMcpRuntime(null);
      setStreamingOutput(''); setStreamingStep(0); clearComposerDraft(composerDraftKey(project.field_id, targetConversationId));
      scrollToLatestAnswer();
    } catch (reason) { setError(reasonMessage(reason)); }
    finally { sendingRef.current = false; setBusy(false); }
  }

  useEffect(() => {
    const next = queuedFollowUps[0];
    if (!next || !agentRunIsTerminal || activeAgentRef.current || queuedFollowUpStartingRef.current) return;
    queuedFollowUpStartingRef.current = true;
    setBusy(true);
    void startQueuedFollowUp(next)
      .catch((reason) => setError(reasonMessage(reason)))
      .finally(() => { queuedFollowUpStartingRef.current = false; setBusy(false); });
  }, [agentRun?.id, agentRun?.status, queuedFollowUps]);

  function selectedActiveArtifactContext() {
    const tab = dockTabsRef.current.find((candidate) => candidate.id === activeDockTabId);
    if (tab?.kind !== 'ARTIFACT') return undefined;
    return activeArtifactContext(artifactSessionsRef.current[tab.id] ?? null) ?? undefined;
  }

  function updateArtifactTabLabel(artifact: ArtifactView) {
    const id = artifactTabId(artifact.artifact_id);
    setDockTabs((current) => current.map((tab) => tab.id === id ? {
      ...tab,
      label: artifact.title?.trim() || `未命名${artifact.artifact_type === 'PRESENTATION' ? '演示文稿' : artifact.artifact_type === 'SPREADSHEET' ? '电子表格' : artifact.artifact_type === 'DIAGRAM' ? '图示' : '文档'}`,
    } : tab));
  }

  async function loadArtifactRevision(artifactId: string, revisionId: string | null, mode: 'CURRENT' | 'HISTORICAL') {
    const tabId = artifactTabId(artifactId);
    setArtifactSessions((current) => ({ ...current, [tabId]: { ...(current[tabId] ?? emptyArtifactSession(artifactId)), loading: true, error: '' } }));
    try {
      const [read, history] = await Promise.all([
        window.fielora.artifact.read({ artifact_id: artifactId, revision_id: revisionId }),
        window.fielora.artifact.history({ artifact_id: artifactId, before_sequence: null, limit: 50 }),
      ]);
      setArtifactSessions((current) => {
        const previous = current[tabId] ?? emptyArtifactSession(artifactId);
        let next = mode === 'CURRENT'
          ? refreshArtifactCurrent({ ...previous, mode: 'CURRENT' }, read, history)
          : pinArtifactRevision(previous, read, history);
        if (read.revision.content.type === 'PRESENTATION' && next.selectedSlide === null) next = { ...next, selectedSlide: 0 };
        if (read.revision.content.type === 'SPREADSHEET' && next.selectedSheetId === null) next = { ...next, selectedSheetId: read.revision.content.content.sheets[0]?.sheet_id ?? null };
        return { ...current, [tabId]: next };
      });
      updateArtifactTabLabel(read.artifact);
    } catch {
      setArtifactSessions((current) => ({ ...current, [tabId]: { ...(current[tabId] ?? emptyArtifactSession(artifactId)), loading: false, error: '暂时无法读取这个工作对象或版本。' } }));
    }
  }

  function openArtifact(artifact: ArtifactView | string) {
    const artifactId = typeof artifact === 'string' ? artifact : artifact.artifact_id;
    const tabId = artifactTabId(artifactId);
    const artifactType = typeof artifact === 'string' ? null : artifact.artifact_type;
    ensureDockTab({ id: tabId, kind: 'ARTIFACT', label: typeof artifact === 'string' ? '工作对象' : artifact.title || '工作对象', icon: artifactType === 'PRESENTATION' ? 'image' : 'files', artifactId });
    if (!artifactSessionsRef.current[tabId]) {
      const session = emptyArtifactSession(artifactId);
      artifactSessionsRef.current = { ...artifactSessionsRef.current, [tabId]: session };
      setArtifactSessions((current) => ({ ...current, [tabId]: session }));
      void loadArtifactRevision(artifactId, null, 'CURRENT');
    }
  }

  function refreshOpenArtifact(artifactId: string) {
    const tabId = artifactTabId(artifactId);
    const session = artifactSessionsRef.current[tabId];
    if (!session) return;
    if (session.mode === 'CURRENT') {
      void loadArtifactRevision(artifactId, null, 'CURRENT');
      return;
    }
    void Promise.all([
      window.fielora.artifact.read({ artifact_id: artifactId, revision_id: null }),
      window.fielora.artifact.history({ artifact_id: artifactId, before_sequence: null, limit: 50 }),
    ]).then(([currentRead, history]) => setArtifactSessions((current) => {
      const existing = current[tabId];
      return existing ? { ...current, [tabId]: refreshArtifactCurrent(existing, currentRead, history) } : current;
    })).catch(() => undefined);
  }

  async function setArtifactArchiveState(session: ArtifactSurfaceSession, archived: boolean) {
    if (!project || !conversation || !effectiveConversationProvider) return;
    setArtifactCommandBusy(true);
    try {
      await window.fielora.artifact.setArchiveState({
        field_id: project.field_id,
        conversation_id: conversation.id,
        provider_config_id: effectiveConversationProvider.id,
        model_id: effectiveConversationProvider.default_model,
        artifact_id: session.artifactId,
        archived,
      });
      await loadArtifactRevision(session.artifactId, session.mode === 'HISTORICAL' ? session.viewedRevisionId : null, session.mode);
    } catch (reason) {
      setError(reasonMessage(reason));
    } finally {
      setArtifactCommandBusy(false);
    }
  }

  function processArtifactToolReceipts(tools: AgentToolCallView[]) {
    for (const tool of tools) {
      if (tool.status !== 'COMPLETED'
        || handledArtifactToolCallsRef.current.has(tool.id)
        || !foregroundAgentRunsRef.current.has(tool.run_id)
        || !tool.receipt
        || typeof tool.receipt !== 'object') continue;
      const receipt = tool.receipt as Record<string, unknown>;
      if (receipt.kind !== 'ARTIFACT_REVISION_COMMITTED' || typeof receipt.artifact_id !== 'string') continue;
      handledArtifactToolCallsRef.current.add(tool.id);
      if (receipt.mutation_kind === 'CREATE') openArtifact(receipt.artifact_id);
      else if (receipt.mutation_kind === 'UPDATE') refreshOpenArtifact(receipt.artifact_id);
    }
  }

  useEffect(() => processArtifactToolReceipts(agentTools), [agentTools]);

  function ensureDockTab(tab: ProjectDockTab) {
    setDockTabs((current) => current.some((item) => item.id === tab.id) ? current : [...current, tab]);
    setActiveDockTabId(tab.id);
    setWorkspaceOpen(true);
    setWorkspaceWidth(clampWorkspaceWidth(workspacePreferredWidthRef.current));
  }

  function openDockTool(kind: 'FILES' | 'REVIEW' | 'BROWSER' | 'TERMINAL') {
    const definitions: Record<typeof kind, ProjectDockTab> = {
      FILES: { id: 'files', kind: 'FILES', label: '文件', icon: 'folder' },
      REVIEW: { id: 'review', kind: 'REVIEW', label: '审阅', icon: 'diff' },
      BROWSER: { id: 'browser', kind: 'BROWSER', label: '浏览器', icon: 'browse', tabHostId: 'right-workspace-browser-page-tabs' },
      TERMINAL: { id: 'terminal', kind: 'TERMINAL', label: 'PowerShell', icon: 'terminal' },
    };
    if (kind === 'REVIEW') {
      setHistoricalReview(null);
      setAgentReviewPath('');
    }
    ensureDockTab(definitions[kind]);
  }

  function syncFileSession(tabId: string) {
    const session = fileDockSessions[tabId];
    if (!session) return;
    setSelectedFile(session.file);
    setFilePreview(session.preview);
    setEditorContent(session.content);
  }

  function activateDockTab(id: string) {
    setActiveDockTabId(id);
    const tab = dockTabs.find((item) => item.id === id);
    if (tab?.kind === 'FILE' || (tab?.kind === 'IMAGE' && tab.relativePath)) syncFileSession(id);
    if (tab?.kind === 'REVIEW') {
      setHistoricalReview(tab.reviewSelection ?? null);
      setAgentReviewPath(tab.relativePath ?? '');
    }
  }

  function closeDockTab(id: string) {
    const index = dockTabs.findIndex((item) => item.id === id);
    const next = dockTabs.filter((item) => item.id !== id);
    setDockTabs(next);
    if (id.startsWith('file:')) setFileDockSessions((current) => { const copy = { ...current }; delete copy[id]; return copy; });
    if (id.startsWith('artifact:')) {
      const nextSessions = { ...artifactSessionsRef.current };
      delete nextSessions[id];
      artifactSessionsRef.current = nextSessions;
      setArtifactSessions(nextSessions);
    }
    if (next.length === 0) {
      setActiveDockTabId('');
      setWorkspaceOpen(false);
      setDockFocused(false);
      return;
    }
    if (activeDockTabId !== id) return;
    const nextTab = next[Math.min(Math.max(index, 0), next.length - 1)]!;
    setActiveDockTabId(nextTab.id);
    if (nextTab.kind === 'FILE' || (nextTab.kind === 'IMAGE' && nextTab.relativePath)) syncFileSession(nextTab.id);
    if (nextTab.kind === 'REVIEW') {
      setHistoricalReview(nextTab.reviewSelection ?? null);
      setAgentReviewPath(nextTab.relativePath ?? '');
    }
  }

  function discardDockSessions(ids: Set<string>) {
    if (ids.size === 0) return;
    setFileDockSessions((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
    setArtifactSessions((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      artifactSessionsRef.current = next;
      return next;
    });
  }

  function duplicateDockTab(id: string) {
    const index = dockTabs.findIndex((tab) => tab.id === id);
    const source = dockTabs[index];
    if (!source) return;
    const copyId = `${source.id}:copy:${++dockTabCopyNonceRef.current}`;
    const copy = { ...source, id: copyId, tabHostId: undefined, label: `${source.label} 副本` };
    setDockTabs((current) => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
    setFileDockSessions((current) => current[source.id]
      ? { ...current, [copyId]: { ...current[source.id]! } }
      : current);
    setArtifactSessions((current) => {
      if (!current[source.id]) return current;
      const next = { ...current, [copyId]: { ...current[source.id]! } };
      artifactSessionsRef.current = next;
      return next;
    });
    setActiveDockTabId(copyId);
    setWorkspaceOpen(true);
  }

  function renameDockTab(id: string, label: string) {
    setDockTabs((current) => current.map((tab) => tab.id === id ? { ...tab, label } : tab));
  }

  function closeOtherDockTabs(id: string) {
    const keep = dockTabs.find((tab) => tab.id === id);
    if (!keep) return;
    discardDockSessions(new Set(dockTabs.filter((tab) => tab.id !== id).map((tab) => tab.id)));
    setDockTabs([keep]);
    setActiveDockTabId(id);
    activateDockTab(id);
  }

  function closeDockTabsToRight(id: string) {
    const index = dockTabs.findIndex((tab) => tab.id === id);
    if (index < 0 || index === dockTabs.length - 1) return;
    const removed = dockTabs.slice(index + 1);
    discardDockSessions(new Set(removed.map((tab) => tab.id)));
    setDockTabs(dockTabs.slice(0, index + 1));
    setActiveDockTabId(id);
    activateDockTab(id);
  }

  function reloadDockTab(id: string) {
    const tab = dockTabs.find((candidate) => candidate.id === id);
    if (!project || !tab) return;
    if (tab.relativePath) {
      const entry = files.find((file) => file.relative_path === tab.relativePath) ?? { relative_path: tab.relativePath, size: 0 };
      void openFile(entry, { force: true, targetTabId: id });
      return;
    }
    if (tab.kind === 'FILES') {
      void window.fielora.workspace.listFiles({ field_id: project.field_id }).then(setFiles).catch((reason) => setError(reasonMessage(reason)));
    } else if (tab.kind === 'REVIEW' && tab.reviewSelection?.runId) {
      void refreshFileArtifactReview(tab.reviewSelection.runId);
    } else if (tab.kind === 'ARTIFACT' && tab.artifactId) {
      void loadArtifactRevision(tab.artifactId, null, 'CURRENT');
    } else if (tab.kind === 'TERMINAL') {
      setTerminalOutput('');
    }
  }

  function openAttachmentInDock(attachment: WorkspaceAttachmentView) {
    ensureDockTab({ id: `image:${attachment.id}`, kind: 'IMAGE', label: attachment.name, icon: 'image', attachment });
  }

  async function openFile(entry: WorkspaceFileEntry, options?: { lineStart?: number; lineEnd?: number; expectedSha256?: string | null; force?: boolean; targetTabId?: string }) {
    if (!project) return;
    setFileTreeSelection(entry.relative_path);
    const tabId = options?.targetTabId ?? `file:${entry.relative_path}`;
    const existing = fileDockSessions[tabId];
    const reveal = options?.lineStart && options.lineEnd
      ? { lineStart: options.lineStart, lineEnd: options.lineEnd, nonce: ++fileRevealNonceRef.current }
      : undefined;
    if (existing && !reveal && !options?.expectedSha256 && !options?.force) {
      syncFileSession(tabId);
      ensureDockTab({ id: tabId, kind: existing.preview?.kind === 'IMAGE' ? 'IMAGE' : 'FILE', label: fileTabLabel(entry.relative_path), icon: existing.preview?.kind === 'IMAGE' ? 'image' : 'files', relativePath: entry.relative_path });
      return;
    }
    const kind = workspacePreviewKind(entry.relative_path);
    const tabKind = kind === 'IMAGE' ? 'IMAGE' : 'FILE';
    ensureDockTab({ id: tabId, kind: tabKind, label: fileTabLabel(entry.relative_path), icon: kind === 'IMAGE' ? 'image' : 'files', relativePath: entry.relative_path });
    setFileDockSessions((current) => ({ ...current, [tabId]: current[tabId] ?? { file: null, preview: null, content: '', loading: true } }));
    try {
      if (kind === 'IMAGE') {
        const preview = await window.fielora.workspace.previewFile({ field_id: project.field_id, relative_path: entry.relative_path });
        const session: FileDockSession = { file: null, preview: { kind: 'IMAGE', preview }, content: '' };
        setFileDockSessions((current) => ({ ...current, [tabId]: session }));
        setSelectedFile(null); setFilePreview(session.preview); setEditorContent(''); setDraft(null); setError('');
        return;
      }
      if (kind === 'UNSUPPORTED') {
        const preview: FilePreviewState = { kind: 'UNSUPPORTED', relativePath: entry.relative_path, message: friendlyFilePreviewFailure('unsupported') };
        setFileDockSessions((current) => ({ ...current, [tabId]: { file: null, preview, content: '' } }));
        setSelectedFile(null); setFilePreview(preview); setEditorContent(''); setDraft(null); setError('');
        return;
      }
      const file = await window.fielora.workspace.readFile({ field_id: project.field_id, relative_path: entry.relative_path });
      setFileDockSessions((current) => ({ ...current, [tabId]: { file, preview: null, content: file.content, markdownMode: reveal ? 'SOURCE' : isMarkdownFile(file.relative_path) ? 'PREVIEW' : undefined, reveal } }));
      setSelectedFile(file); setFilePreview(null); setEditorContent(file.content); setDraft(null);
      setError(options?.expectedSha256 && options.expectedSha256 !== file.sha256 ? '引用创建后文件内容已变化；当前已打开最新内容。' : '');
    } catch (reason) {
      const preview: FilePreviewState = { kind: 'UNSUPPORTED', relativePath: entry.relative_path, message: friendlyFilePreviewFailure(reason) };
      setFileDockSessions((current) => ({ ...current, [tabId]: { file: null, preview, content: '' } }));
      setSelectedFile(null); setFilePreview(preview); setEditorContent(''); setDraft(null); setError('');
    }
  }

  function reviewEditor() {
    if (!selectedFile || editorContent === selectedFile.content) return;
    setDraft({ relativePath: selectedFile.relative_path, before: selectedFile.content, after: editorContent, beforeHash: selectedFile.sha256, diff: reviewDiff(selectedFile.relative_path, selectedFile.content, editorContent) });
    openDockTool('REVIEW');
  }

  async function acceptDraft() {
    if (!project || !draft) return;
    try {
      const applied = await window.fielora.workspace.applyFile({ field_id: project.field_id, relative_path: draft.relativePath, expected_sha256: draft.beforeHash, content: draft.after });
      setUndoChange({ relativePath: draft.relativePath, content: draft.before, expectedHash: applied.sha256 });
      const tabId = `file:${applied.relative_path}`;
      setFileDockSessions((current) => ({ ...current, [tabId]: { file: applied, preview: null, content: applied.content, markdownMode: isMarkdownFile(applied.relative_path) ? (current[tabId]?.markdownMode ?? 'PREVIEW') : undefined } }));
      setSelectedFile(applied); setEditorContent(applied.content); setDraft(null);
      ensureDockTab({ id: tabId, kind: 'FILE', label: fileTabLabel(applied.relative_path), icon: 'files', relativePath: applied.relative_path });
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function undoAcceptedChange() {
    if (!project || !undoChange) return;
    try {
      const restored = await window.fielora.workspace.applyFile({ field_id: project.field_id, relative_path: undoChange.relativePath, expected_sha256: undoChange.expectedHash, content: undoChange.content });
      const tabId = `file:${restored.relative_path}`;
      setFileDockSessions((current) => ({ ...current, [tabId]: { file: restored, preview: null, content: restored.content, markdownMode: isMarkdownFile(restored.relative_path) ? (current[tabId]?.markdownMode ?? 'PREVIEW') : undefined } }));
      setSelectedFile(restored); setEditorContent(restored.content); setUndoChange(null);
    } catch (reason) { setError(reasonMessage(reason)); }
  }

  async function runTerminal(command = terminalCommand, presentation: 'RIGHT' | 'BOTTOM' = 'RIGHT') {
    const nextCommand = command.trim();
    if (!project || terminalRef.current || !nextCommand) return;
    const workingDirectory = terminalWorkingDirectory || project.root_path;
    setTerminalOutput('');
    setTerminalLastCommand(nextCommand);
    setTerminalCommand('');
    terminalRef.current = { runId: 'pending', command: nextCommand, output: '' };
    if (presentation === 'RIGHT') openDockTool('TERMINAL');
    else setBottomTerminalOpen(true);
    try {
      const started = await window.fielora.workspace.runTerminal({ field_id: project.field_id, command: nextCommand, working_directory: workingDirectory });
      if (started.working_directory) {
        terminalRef.current = null;
        setTerminalRunId('');
        setTerminalWorkingDirectory(started.working_directory);
        return;
      }
      const active = terminalRef.current;
      if (!active) return;
      active.runId = started.run_id;
      setTerminalRunId(started.run_id);
    } catch (reason) {
      terminalRef.current = null;
      setTerminalRunId('');
      setTerminalCommand(nextCommand);
      setError(reasonMessage(reason));
    }
  }

  function openWorkspace(tab: 'FILES' | 'DIFF' | 'TERMINAL' | 'BROWSER') {
    if (!project) { setError(`请先打开一个 Project，再使用${tab === 'TERMINAL' ? '终端' : '工作区工具'}。`); return; }
    openDockTool(tab === 'DIFF' ? 'REVIEW' : tab);
  }

  async function openAgentReviewFile(relativePath: string) {
    const entry = files.find((file) => file.relative_path === relativePath) ?? { relative_path: relativePath, size: 0 };
    await openFile(entry);
  }

  async function refreshFileArtifactReview(runId: string): Promise<ReturnType<typeof buildAgentReview>> {
    const list = await window.fielora.artifact.listFileReviews({ run_id: runId });
    const review = buildDurableAgentReview(list.revisions);
    if (agentRunIdRef.current === runId) {
      agentFileRevisionsRef.current = list.revisions;
      setAgentFileRevisions(list.revisions);
    }
    setHistoricalReview((current) => current?.runId === runId ? { ...current, review } : current);
    setDockTabs((tabs) => tabs.map((tab) => tab.reviewSelection?.runId === runId
      ? { ...tab, reviewSelection: { ...tab.reviewSelection, review } }
      : tab));
    return review;
  }

  async function markAgentFileArtifactReviewed(file: AgentReviewFile): Promise<void> {
    if (!file.artifactId || !file.revisionId) return;
    try {
      await window.fielora.artifact.markFileReviewed({ artifact_id: file.artifactId, revision_id: file.revisionId });
      setError('');
    } catch (reason) {
      setError(`无法保存审阅状态：${reasonMessage(reason)}`);
      throw reason;
    }
  }

  async function undoAgentFileArtifact(runId: string, file: AgentReviewFile): Promise<void> {
    if (!file.artifactId || !file.revisionId) return;
    try {
      await window.fielora.artifact.undoFileRevision({
        source_run_id: runId,
        artifact_id: file.artifactId,
        revision_id: file.revisionId,
      });
      await Promise.all([
        refreshFileArtifactReview(runId),
        project ? window.fielora.workspace.listFiles({ field_id: project.field_id }).then(setFiles) : Promise.resolve(),
      ]);
      setError('');
    } catch (reason) {
      setError(`无法安全撤销：${reasonMessage(reason)}`);
      throw reason;
    }
  }

  useEffect(() => {
    const list = messageListRef.current;
    const column = list?.closest<HTMLElement>('.conversation-column');
    const composer = column?.querySelector<HTMLElement>('.conversation-composer');
    const queue = column?.querySelector<HTMLElement>('.queued-follow-up-stack');
    if (!column || !composer) return undefined;
    const measure = () => {
      column.style.setProperty('--fl-composer-height', `${Math.ceil(composer.getBoundingClientRect().height)}px`);
      column.style.setProperty('--fl-queued-height', `${Math.ceil(queue?.getBoundingClientRect().height ?? 0)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    if (queue) observer.observe(queue);
    measure();
    return () => observer.disconnect();
  }, [conversationId, queuedFollowUps.length]);

  function openActivityFile(file: ActivityFileLink) {
    void openFile({ relative_path: file.path, size: 0 }, file);
  }

  async function openResultReference(reference: ResultReference) {
    const target = reference.target;
    if (target.kind === 'IMAGE') {
      try {
        const preview = target.source === 'SCREENSHOT_EVIDENCE' && target.screenshot_evidence_id
          ? await window.fielora.screenshot.preview({ screenshot_evidence_id: target.screenshot_evidence_id, expected_content_sha256: target.expected_sha256 })
          : target.source === 'LIBRARY' && target.library_object_id
            ? await window.fielora.library.previewImage({ library_object_id: target.library_object_id })
            : null;
        if (!preview || preview.mime_type !== target.mime_type
          || (preview.source === 'LIBRARY' ? preview.content_hash : preview.content_sha256) !== target.expected_sha256) throw new Error('Image identity changed');
        setPreviewAttachment(resultImageAttachment(preview));
        setError('');
      } catch {
        setError('该图片暂时不可用。');
      }
      return;
    }
    if (!project || target.field_id !== project.field_id) {
      setError('该引用不属于当前 Project，无法打开。');
      return;
    }
    if (target.kind === 'PROJECT_FILE') {
      const entry = files.find((file) => file.relative_path === target.relative_path) ?? { relative_path: target.relative_path, size: 0 };
      await openFile(entry, { expectedSha256: target.expected_sha256 });
      return;
    }
    if (target.kind === 'CODE_RANGE') {
      const entry = files.find((file) => file.relative_path === target.relative_path) ?? { relative_path: target.relative_path, size: 0 };
      await openFile(entry, { lineStart: target.line_start, lineEnd: target.line_end, expectedSha256: target.expected_sha256 });
      return;
    }
    try {
      const source = await window.fielora.reference.get({ field_id: project.field_id, object_id: target.reference_id });
      if (source.lifecycle !== 'ACTIVE' || source.canonical_url !== target.https_url) {
        setError('该网页引用已变更或不可用。');
        return;
      }
      openDockTool('BROWSER');
      await window.fielora.browser.navigate({ url: target.https_url });
      setError('');
    } catch {
      setError('该网页引用暂时不可用。');
    }
  }

  function openAgentReview(relativePath = '') {
    setHistoricalReview(null);
    setAgentReviewPath(relativePath);
    if (!project) { setError('请先打开一个 Project，再使用工作区工具。'); return; }
    const runId = agentRun?.id ?? conversation?.id ?? 'current';
    ensureDockTab({
      id: `review:${runId}:${relativePath || 'summary'}`,
      kind: 'REVIEW',
      label: relativePath ? `${fileTabLabel(relativePath)} Diff` : '变更 Diff',
      icon: 'diff',
      relativePath: relativePath || undefined,
    });
  }

  function openHistoricalAgentReview(selection: HistoricalReviewSelection) {
    setHistoricalReview(selection);
    setAgentReviewPath(selection.path);
    if (!project) { setError('请先打开一个 Project，再使用工作区工具。'); return; }
    ensureDockTab({
      id: `review:${selection.runId || 'historical'}:${selection.path || 'summary'}`,
      kind: 'REVIEW',
      label: selection.path ? `${fileTabLabel(selection.path)} Diff` : '变更 Diff',
      icon: 'diff',
      relativePath: selection.path || undefined,
      reviewSelection: selection,
    });
  }

  function runEnvironmentCommand(command: string) {
    setEnvironmentOpen(false);
    setTerminalCommand(command);
    openDockTool('TERMINAL');
    void runTerminal(command);
  }

  async function toggleDockProjectLauncher() {
    const next = !dockProjectLauncherOpen;
    setEnvironmentOpen(false);
    setDockProjectLauncherOpen(next);
    if (!next || !project) return;
    try { setProjectOpenTargets(await window.fielora.workspace.getOpenTargets({ field_id: project.field_id })); }
    catch (reason) { setError(reasonMessage(reason)); }
  }

  async function openProjectTarget(target: WorkspaceProjectOpenTarget) {
    if (!project) return;
    setDockProjectLauncherOpen(false);
    try { await window.fielora.workspace.openProject({ field_id: project.field_id, target }); }
    catch (reason) { setError(reasonMessage(reason)); }
  }

  function updateDockFileTreeWidth(width: number) {
    const next = Math.min(Math.max(width, 160), 420);
    setDockFileTreeWidth(next);
    window.localStorage.setItem('fielora:dock-file-tree-width', String(next));
  }

  function reviewDockFileSession(tab: ProjectDockTab, session: FileDockSession) {
    if (!session.file) return;
    setSelectedFile(session.file);
    setEditorContent(session.content);
    setDraft({
      relativePath: session.file.relative_path,
      before: session.file.content,
      after: session.content,
      beforeHash: session.file.sha256,
      diff: reviewDiff(session.file.relative_path, session.file.content, session.content),
    });
    setActiveDockTabId(tab.id);
    openDockTool('REVIEW');
  }

  function prepareVersionControl(action: 'COMMIT' | 'PUSH') {
    setEnvironmentOpen(false);
    const request = action === 'COMMIT'
      ? '请检查当前 Git 变更，运行最相关的测试，并审阅 diff。测试通过后，只暂存与本任务相关的文件，创建一个简洁准确的提交；不要推送。所有操作遵循当前权限设置。'
      : '请检查当前分支、上游以及待推送的提交，确认已有相关验证记录，再推送已有提交到当前上游。不要创建新提交、强制推送或自动设置上游；缺少上游或验证依据时说明情况。所有操作遵循当前权限设置。';
    setPrompt((current) => current.trim() ? `${current}\n\n${request}` : request);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function scrollToLatestAnswer() {
    const list = messageListRef.current;
    if (!list) return;
    atLatestAnswerRef.current = true;
    setAtLatestAnswer(true);
    setHasUnseenActivity(false);
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }

  const environmentSources = [...attachments, ...messages.flatMap((message) => messageAttachments(message.id))]
    .filter((source, index, all) => all.findIndex((candidate) => candidate.id === source.id) === index)
    .reverse();
  const environmentControl = project && projectActionsLayer ? createPortal(<>
    <div className="environment-menu" ref={environmentMenuRef}>
      <ToolbarAction label="工作区信息" icon={<AppIcon name="environment"/>} active={environmentOpen} onClick={() => { setDockProjectLauncherOpen(false); setEnvironmentOpen((open) => !open); }} aria-expanded={environmentOpen} testId="environment-menu-toggle" />
      {environmentOpen && <div className="environment-popover" data-surface="overlay" data-testid="environment-popover">
        <header><strong>工作区信息</strong><IconButton size="sm" label="刷新工作区信息" icon={<AppIcon name="refresh"/>} disabled={environmentLoading} onClick={() => setEnvironmentRefresh((value) => value + 1)} testId="environment-refresh"/></header>
        <div className="environment-repository" role="status" aria-busy={environmentLoading}>
          <AppIcon name={environment?.is_git_repository ? 'branch' : 'folder'}/>
          <span><strong>{environmentLoading ? '正在读取工作区…' : environmentError ? '暂时无法读取工作区' : environment?.is_git_repository ? environment.branch || '未检出分支' : '本地文件夹'}</strong>
            <small>{environmentError ? '点击右上角刷新以重试' : environmentLoading ? project.title : environment?.is_git_repository ? environment.upstream || '没有上游分支' : '此文件夹未使用 Git'}</small></span>
          {environment?.upstream && <small className="environment-sync-state">{environment.ahead || environment.behind ? `领先 ${environment.ahead} · 落后 ${environment.behind}` : '已同步'}</small>}
        </div>
        <button type="button" className="environment-action" data-testid="environment-task-changes" onClick={() => { setEnvironmentOpen(false); openWorkspace('DIFF'); }}>
          <AppIcon name="diff"/><span><strong>任务改动</strong><small>{displayedAgentReview.files.length ? `${displayedAgentReview.files.length} 个文件 · 打开审阅` : '本次任务暂无文件改动'}</small></span>
          {displayedAgentReview.files.length > 0 && <span className="environment-diff-stat"><em>+{displayedAgentReview.additions}</em><del>−{displayedAgentReview.deletions}</del></span>}
        </button>
        {environment?.is_git_repository && <>
          <button type="button" className="environment-action" data-testid="environment-local-changes" onClick={() => runEnvironmentCommand('git status --short')}>
            <AppIcon name="changes"/><span><strong>工作区改动</strong><small>在终端查看 Git 状态</small></span><small className="environment-count">{environment.changed_files} 个文件</small>
          </button>
          <button type="button" className="environment-action" data-testid="environment-diff-stat" onClick={() => runEnvironmentCommand('git diff --stat')}>
            <AppIcon name="files"/><span><strong>查看改动统计</strong><small>未暂存的改动 · 在终端打开</small></span><AppIcon name="openAction"/>
          </button>
          <section className="environment-section" aria-label="AI 协助">
            <header><span>AI 协助</span><small>填入输入框，确认后发送</small></header>
            <button type="button" className="environment-action" data-testid="environment-prepare-commit" onClick={() => prepareVersionControl('COMMIT')}>
              <AppIcon name="commit"/><span><strong>准备提交</strong><small>检查改动、运行测试并生成提交</small></span><AppIcon name="openAction"/>
            </button>
            <button type="button" className="environment-action" data-testid="environment-prepare-push" onClick={() => prepareVersionControl('PUSH')} disabled={!environment.upstream}>
              <AppIcon name="cloud"/><span><strong>准备推送</strong><small>{environment.upstream ? '检查并推送已有提交到上游' : '设置上游分支后可用'}</small></span><AppIcon name="openAction"/>
            </button>
          </section>
        </>}
        <section className="environment-section environment-sources" aria-label="来源">
          <header><span>{environmentSources.length === 0 && selectedFile ? '当前文件' : '对话来源'}</span><IconButton size="sm" label="添加来源" icon={<AppIcon name="plus"/>} onClick={() => void pickAttachments()}/></header>
          <div className="environment-source-list">{environmentSources.map((source) => <button type="button" key={source.id} className="environment-source" title={source.name} onClick={() => { setEnvironmentOpen(false); openAttachmentInDock(source); }}>
            {source.kind === 'IMAGE' && source.data_url ? <span className="environment-source-thumb"><img src={source.data_url} alt=""/></span> : <FileTypeIcon path={source.name}/>}
            <span>{source.name}</span>
          </button>)}
          {environmentSources.length === 0 && selectedFile ? <button type="button" className="environment-source" data-testid="environment-current-file" title={selectedFile.relative_path} onClick={() => { setEnvironmentOpen(false); void openFile(selectedFile); }}><FileTypeIcon path={selectedFile.relative_path}/><span>{selectedFile.relative_path}</span></button> : environmentSources.length === 0 ? <small className="environment-empty">添加文件或图片作为对话参考。</small> : null}</div>
        </section>
      </div>}
    </div>
  </>, projectActionsLayer) : null;

  const currentTerminalMessage = agentTurn?.assistantMessageId
    ? messages.find((message) => message.id === agentTurn.assistantMessageId) ?? null
    : null;
  const activeDockTab = dockTabs.find((tab) => tab.id === activeDockTabId) ?? dockTabs.at(-1) ?? null;
  const activeFileSession = activeDockTab ? fileDockSessions[activeDockTab.id] ?? null : null;
  const activeReview = activeDockTab?.reviewSelection?.review ?? displayedAgentReview;
  const agentReviewOpen = Boolean(project && workspaceOpen && activeDockTab?.kind === 'REVIEW' && !draft && activeReview.files.length > 0);
  const dockBreadcrumb = project
    ? [project.title, ...(activeDockTab?.relativePath?.replaceAll('\\', '/').split('/').filter(Boolean) ?? [])]
    : [];
  const dockToolbar = activeDockTab && ['FILE', 'IMAGE'].includes(activeDockTab.kind) && project ? <>
    <div className="right-dock-breadcrumb" title={dockBreadcrumb.join(' / ')}>
      {dockBreadcrumb.map((segment, index) => <Fragment key={`${segment}:${index}`}>{index > 0 && <i>/</i>}<span>{segment}</span></Fragment>)}
    </div>
    {(activeDockTab.kind === 'FILE' || activeDockTab.kind === 'IMAGE') && <div className="right-dock-resource-actions">
      {activeDockTab.kind === 'FILE' && activeFileSession?.file && isMarkdownFile(activeFileSession.file.relative_path) && <div className="markdown-view-toggle" role="tablist" aria-label="Markdown 显示方式" data-testid="markdown-view-toggle">
        <button type="button" role="tab" aria-selected={(activeFileSession.markdownMode ?? 'PREVIEW') === 'PREVIEW'} onClick={() => setFileDockSessions((current) => ({ ...current, [activeDockTab.id]: { ...activeFileSession, markdownMode: 'PREVIEW' } }))} data-testid="markdown-preview-toggle">预览</button>
        <button type="button" role="tab" aria-selected={activeFileSession.markdownMode === 'SOURCE'} onClick={() => setFileDockSessions((current) => ({ ...current, [activeDockTab.id]: { ...activeFileSession, markdownMode: 'SOURCE' } }))} data-testid="markdown-source-toggle">源代码</button>
      </div>}
      {activeDockTab.kind === 'FILE' && activeFileSession?.file && activeFileSession.content !== activeFileSession.file.content && <button type="button" className="right-dock-review-change" onClick={() => reviewDockFileSession(activeDockTab, activeFileSession)} data-testid="review-change">审阅修改</button>}
      <ToolbarAction onClick={() => setDockFileTreeCollapsed((current) => !current)} label={dockFileTreeCollapsed ? '展开文件目录' : '收起文件目录'} active={!dockFileTreeCollapsed} icon={<AppIcon name="fileTree"/>} aria-expanded={!dockFileTreeCollapsed} testId="dock-file-tree-toggle"/>
      <div className="dock-project-launcher" ref={dockProjectLauncherRef}>
        <button type="button" className="dock-project-launcher-main" onClick={() => void openProjectTarget('FILE_EXPLORER')} aria-label="在文件资源管理器中打开 Project" title="打开 Project" data-testid="dock-project-open-default"><WorkspaceAppBadge target="FILE_EXPLORER" iconDataUrl={projectOpenTargets.find((target) => target.target === 'FILE_EXPLORER')?.icon_data_url}/><span>打开</span></button>
        <button type="button" className={`dock-project-launcher-more ${dockProjectLauncherOpen ? 'active' : ''}`} onClick={() => void toggleDockProjectLauncher()} aria-label="选择打开方式" title="选择打开方式" aria-expanded={dockProjectLauncherOpen} data-testid="dock-project-open-menu-toggle"><AppIcon name="chevronDown"/></button>
        {dockProjectLauncherOpen && <div className="project-launcher-popover dock-project-launcher-popover" role="menu" data-surface="overlay" data-testid="dock-project-open-menu">
          {projectOpenTargets.filter((target) => target.target !== 'FILE_EXPLORER').map((target) => <button key={target.target} type="button" role="menuitem" onClick={() => void openProjectTarget(target.target)}><WorkspaceAppBadge target={target.target} iconDataUrl={target.icon_data_url}/><span>{target.label}</span></button>)}
        </div>}
      </div>
    </div>}
  </> : null;
  const dockTools: RightWorkspaceTool[] = [
    { id: 'review', label: '审阅', icon: 'diff', shortcut: 'Ctrl+Shift+G', onOpen: () => openDockTool('REVIEW') },
    { id: 'terminal', label: 'PowerShell', icon: 'terminal', shortcut: 'Ctrl+`', onOpen: () => openDockTool('TERMINAL') },
    { id: 'browser', label: '浏览器', icon: 'browse', shortcut: 'Ctrl+T', onOpen: () => openDockTool('BROWSER') },
    { id: 'files', label: '文件', icon: 'folder', shortcut: 'Ctrl+P', onOpen: () => openDockTool('FILES') },
  ];
  const dockViews = project ? dockTabs.map((tab) => {
    const session = fileDockSessions[tab.id] ?? null;
    const artifactSession = artifactSessions[tab.id] ?? null;
    const imageAttachment = tab.attachment ?? (session?.preview?.kind === 'IMAGE' ? workspaceImageAttachment(session.preview.preview) : null);
    const dockFileTree = <WorkspaceFileTree files={files} filter={fileFilter} activePath={fileTreeSelection} onFilter={setFileFilter} onRefresh={refreshTreeFiles} onOpen={openTreeFile}/>;
    return <section key={tab.id} className={`right-dock-view right-dock-view-${tab.kind.toLowerCase()}`} hidden={tab.id !== activeDockTabId} data-dock-kind={tab.kind} data-testid={`right-dock-view-${tab.id}`}>
      {tab.kind === 'FILES' && dockFileTree}
      {tab.kind === 'FILE' && <DockResourceLayout fileTree={dockFileTree} treeWidth={dockFileTreeWidth} treeCollapsed={dockFileTreeCollapsed} onTreeWidthChange={updateDockFileTreeWidth} onTreeCollapsedChange={setDockFileTreeCollapsed}>
        <>
          {session?.loading ? <div className="dock-resource-status" role="status"><AppIcon name="file"/><span>正在载入文件…</span></div> : session?.file && <div className={`file-editor dock-file-editor ${undoChange?.relativePath === session.file.relative_path ? 'has-undo' : ''}`}>{undoChange?.relativePath === session.file.relative_path && <header><span/><button onClick={() => void undoAcceptedChange()} data-testid="undo-change">撤销已接受变更</button></header>}{isMarkdownFile(session.file.relative_path) && (session.markdownMode ?? 'PREVIEW') === 'PREVIEW'
            ? <div className="dock-markdown-preview" data-testid="markdown-preview"><MarkdownMessage content={session.content} onCopyError={(reason) => setError(`复制代码失败：${reason}`)}/></div>
            : <SyntaxCodeEditor value={session.content} relativePath={session.file.relative_path} reveal={session.reveal} onChange={(content) => { setFileDockSessions((current) => ({ ...current, [tab.id]: { ...session, content } })); if (tab.id === activeDockTabId) setEditorContent(content); }}/>}</div>}
          {session?.preview?.kind === 'UNSUPPORTED' && <div className="file-unsupported-preview" data-testid="file-unsupported-preview"><AppIcon name="files"/><h3>无法在此预览</h3><strong>{session.preview.relativePath}</strong><p>{session.preview.message}</p></div>}
          {!session && <div className="dock-resource-status" role="status"><AppIcon name="file"/><span>正在载入文件…</span></div>}
        </>
      </DockResourceLayout>}
      {tab.kind === 'IMAGE' && <DockResourceLayout fileTree={dockFileTree} treeWidth={dockFileTreeWidth} treeCollapsed={dockFileTreeCollapsed} onTreeWidthChange={updateDockFileTreeWidth} onTreeCollapsedChange={setDockFileTreeCollapsed}>{imageAttachment?.data_url ? <div className="dock-image-preview" data-testid="file-image-preview"><button type="button" aria-label={`放大 ${imageAttachment.name}`} onClick={() => setPreviewAttachment(imageAttachment)} onContextMenu={(event) => openImageContextMenu(event, imageAttachment)}><img src={imageAttachment.data_url} alt={imageAttachment.name}/></button><small>{imageAttachment.mime_type} · {Math.max(1, Math.ceil(imageAttachment.size / 1024))} KB · 点击放大</small></div> : session?.preview?.kind === 'UNSUPPORTED' ? <div className="file-unsupported-preview" data-testid="file-unsupported-preview"><AppIcon name="image"/><h3>无法在此预览</h3><strong>{session.preview.relativePath}</strong><p>{session.preview.message}</p></div> : <div className="dock-resource-status" role="status"><AppIcon name="image"/><span>正在载入图片…</span></div>}</DockResourceLayout>}
      {tab.kind === 'REVIEW' && <div className="diff-workspace">{draft ? <><header><div><p className="eyebrow">REVIEW</p><h3>{draft.relativePath}</h3></div><span>写入前不会修改磁盘</span></header><pre className="diff-view" data-testid="diff-view">{draft.diff}</pre><footer><button className="secondary-button" onClick={() => { setDraft(null); setEditorContent(selectedFile?.content ?? ''); if (selectedFile) ensureDockTab({ id: `file:${selectedFile.relative_path}`, kind: 'FILE', label: fileTabLabel(selectedFile.relative_path), icon: 'files', relativePath: selectedFile.relative_path }); else openDockTool('FILES'); }}>放弃</button><button className="primary-button" onClick={() => void acceptDraft()} data-testid="accept-change">接受变更</button></footer></> : (tab.reviewSelection?.review ?? displayedAgentReview).files.length > 0 ? <AgentHumanReview review={tab.reviewSelection?.review ?? displayedAgentReview} task={tab.reviewSelection?.task ?? agentRun?.task ?? conversation?.title ?? ''} runId={tab.reviewSelection?.runId ?? agentRun?.id ?? ''} selectedPathHint={tab.relativePath ?? agentReviewPath} onOpenFile={(path) => void openAgentReviewFile(path)} onMarkReviewed={markAgentFileArtifactReviewed} onUndo={(file) => undoAgentFileArtifact(tab.reviewSelection?.runId ?? agentRun?.id ?? '', file)}/> : <div className="workspace-blank"><h3>{conversation ? '本次任务没有文件变更' : '当前 Project 没有可审阅的变更'}</h3><p>文件写入、补丁和替换会显示在这里。</p></div>}</div>}
      {tab.kind === 'BROWSER' && <BrowsePanel browser={window.fielora.browser} onSaveToLibrary={(input) => window.fielora.library.saveWeb(input)} onOpenBrowserSettings={() => window.dispatchEvent(new CustomEvent('fielora:open-settings', { detail: 'BROWSER' }))} workspaceTabHostId={tab.tabHostId} workspaceActive={workspaceOpen && tab.id === activeDockTabId} onRequestWorkspaceActivate={() => activateDockTab(tab.id)} onRequestWorkspaceClose={() => closeDockTab(tab.id)}/>}
      {tab.kind === 'TERMINAL' && <div className="right-terminal-view" data-testid="terminal-dock"><TerminalSession workingDirectory={terminalWorkingDirectory || project.root_path} command={terminalCommand} lastCommand={terminalLastCommand} output={terminalOutput} running={Boolean(terminalRunId)} active={workspaceOpen && tab.id === activeDockTabId} onCommandChange={setTerminalCommand} onRun={() => void runTerminal(terminalCommand, 'RIGHT')} onCancel={() => terminalRunId ? void window.fielora.workspace.cancelTerminal({ run_id: terminalRunId }) : undefined} testId="terminal"/></div>}
      {tab.kind === 'ARTIFACT' && artifactSession && <ArtifactSurface
        session={artifactSession}
        busy={artifactCommandBusy}
        onSelectRevision={(revisionId) => void loadArtifactRevision(artifactSession.artifactId, revisionId, 'HISTORICAL')}
        onReturnCurrent={() => void loadArtifactRevision(artifactSession.artifactId, null, 'CURRENT')}
        onArchiveState={(archived) => void setArtifactArchiveState(artifactSession, archived)}
        onSelectedSlide={(selectedSlide) => { const next = { ...artifactSession, selectedSlide }; artifactSessionsRef.current = { ...artifactSessionsRef.current, [tab.id]: next }; setArtifactSessions((current) => ({ ...current, [tab.id]: next })); }}
        onSelectedSheet={(selectedSheetId) => { const next = { ...artifactSession, selectedSheetId }; artifactSessionsRef.current = { ...artifactSessionsRef.current, [tab.id]: next }; setArtifactSessions((current) => ({ ...current, [tab.id]: next })); }}
      />}
    </section>;
  }) : null;
  const currentAgentTurn = agentRun && agentTurn?.userMessageId ? <AgentTurn
    run={agentRun}
    userMessageId={agentTurn.userMessageId}
    terminalMessage={currentTerminalMessage}
    events={agentEvents}
    tools={agentTools}
    approval={approval}
    approvalSummary={approvalToolSummary}
    review={agentReview}
    streamingContent={streamingOutput}
    streamingStep={streamingStep}
    busy={busy}
    copied={Boolean(currentTerminalMessage && copiedMessageId === currentTerminalMessage.id)}
    onResume={() => void resumeAgent()}
    onStop={() => void cancelAgent()}
    onRetry={() => void retryAgent()}
    onReview={() => openAgentReview()}
    onReviewFile={(path) => openAgentReview(path)}
    onDecision={(decision) => void decideApproval(decision)}
    onCopy={currentTerminalMessage ? () => void copyMessage(currentTerminalMessage) : undefined}
    onCopyError={(reason) => setError(`复制代码失败：${reason}`)}
    onOpenActivityFile={openActivityFile}
    onOpenReference={(reference) => void openResultReference(reference)}
    onOpenImage={(preview) => setPreviewAttachment(resultImageAttachment(preview))}
    mcpRuntime={mcpRuntime}
    mcpBusyConnectionId={mcpBusyConnectionId}
    onActivateMcp={(connectionId) => void activateMcpConnection(connectionId)}
  /> : null;
  const visibleMessages = useMemo(() => messages.filter((message) => message.role !== 'ASSISTANT' || !isLegacyTerminalMessage(message.content)), [messages]);
  const priorAttempts = useMemo(() => previousAgentAttempts(visibleMessages, agentTurn?.userMessageId ?? null, agentTurn?.assistantMessageId ?? null), [visibleMessages, agentTurn]);
  const agentDisplayAnchor = agentTurnDisplayAnchor(messages, agentEvents, agentTurn?.userMessageId ?? null);
  const navigationTurns = useMemo(() => {
    const turns: { id: string; content: string; preview: string }[] = [];
    for (const message of visibleMessages) {
      if (message.role === 'USER' && !queuedFollowUps.some(item => item.messageId === message.id)) {
        turns.push({ id: message.id, content: message.content, preview: '' });
      } else if (message.role === 'ASSISTANT' && turns.length && !turns[turns.length - 1]!.preview) {
        turns[turns.length - 1]!.preview = message.content;
      }
    }
    return turns;
  }, [visibleMessages, queuedFollowUps]);

  return <div className="project-root" data-testid="project-workspace">
    <WorkspaceSurface
      surfaceRef={layoutRef}
      className={`project-layout ${workspaceOpen && project ? 'workspace-open' : ''}${agentReviewOpen ? ' agent-review-open' : ''}${dockFocused ? ' dock-focused' : ''}`}
      testId="project-workspace-surface"
      navigationWidth={navigationWidth}
      navigationMax={navigationMaximumWidth()}
      onNavigationWidthChange={updateNavigationWidth}
      navigationResizerTestId="project-navigation-resizer"
      navigationResizerClassName="project-navigation-resizer"
      style={{ '--project-workspace-width': `${workspaceWidth}px` } as CSSProperties}
      navigation={<PrimaryNav
        active="PROJECTS"
        onProjects={() => setNewConversationStart(false)}
        onNow={onNow}
        onBrowse={onBrowse}
        onFields={onFields}
        onNewConversation={() => void createConversation()}
        onSettings={() => onSettings(project?.field_id ?? null)}
        onAddProject={() => void addProject()}
        projectHeaderControls={<>
          <ProjectSortControl value={projectSort} onChange={updateProjectSort}/>
          <button type="button" onClick={() => void addProject()} title="添加本地 Project" aria-label="添加本地 Project" data-testid="project-add"><AppIcon name="plus"/></button>
        </>}
        projectContent={<>
          <div className="project-list">{projects.length === 0 ? <p className="project-list-empty" data-testid="project-list-empty">还没有项目</p> : sortedProjects.map((item) => <Fragment key={item.field_id}>
            <div className={`project-item-row ${item.field_id === projectId ? 'active' : ''}`} onContextMenu={(event) => { event.preventDefault(); setProjectContextMenu({ project: item, left: Math.max(8, Math.min(window.innerWidth - 184, event.clientX)), top: Math.max(8, Math.min(window.innerHeight - 116, event.clientY)) }); }} data-testid={`project-row-${item.field_id}`}>
              <TooltipButton className="project-item" tooltip={<span className="sidebar-hover-preview"><span><strong>{item.title}</strong></span><span><AppIcon name="folder"/><small>{item.root_path || '本地项目'}</small></span></span>} onClick={() => { setNewConversationStart(false); if (item.field_id === projectId) { setCollapsedProjectIds((current) => { const next = new Set(current); if (next.has(item.field_id)) next.delete(item.field_id); else next.add(item.field_id); return next; }); return; } setProjectId(item.field_id); setCollapsedProjectIds((current) => { if (!current.has(item.field_id)) return current; const next = new Set(current); next.delete(item.field_id); return next; }); }} onKeyDown={(event) => { if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setProjectContextMenu({ project: item, left: Math.max(8, Math.min(window.innerWidth - 184, bounds.left + 28)), top: Math.max(8, Math.min(window.innerHeight - 116, bounds.bottom)) }); }} aria-haspopup="menu" aria-expanded={item.field_id === projectId && !collapsedProjectIds.has(item.field_id)} data-testid={`project-${item.field_id}`}><span className="project-expand-indicator"><AppIcon name="chevronDown"/></span><AppIcon name={item.field_id === projectId ? 'folderOpen' : 'folder'}/><div><strong>{item.title}</strong></div></TooltipButton>
              <div className="project-item-actions">
                {!item.root_path && <button type="button" aria-label={`定位 ${item.title}`} title="原位置不可用，定位 Project" onClick={() => void rebindProject(item)} data-testid={`project-rebind-${item.field_id}`}><AppIcon name="folderOpen"/></button>}
                <button type="button" aria-label={`在 ${item.title} 新建对话`} title="新建对话" onClick={() => void createConversationFor(item)} data-testid={`project-new-conversation-${item.field_id}`}><AppIcon name="plus"/></button>
                <button type="button" aria-label={`编辑 ${item.title}`} title="编辑项目" onClick={() => setProjectDialog({ project: item, value: item.title })} data-testid={`project-edit-${item.field_id}`}><AppIcon name="edit"/></button>
              </div>
            </div>
            {item.field_id === projectId && !collapsedProjectIds.has(item.field_id) && sidebarConversations.length > 0 && <div className="conversation-section" data-testid={`project-conversations-${item.field_id}`}>{sidebarConversations.map((conversationItem) => <TooltipButton key={conversationItem.id} className={`conversation-item ${conversationItem.id === conversationId ? 'active' : ''}`} tooltip={<span className="sidebar-hover-preview"><span><strong>{conversationItem.title}</strong><time>{new Date(conversationItem.updated_at).toLocaleDateString()}</time></span><span><AppIcon name="folder"/><small>{item.title}</small></span></span>} onClick={() => activateConversation(conversationItem.id)} onContextMenu={(event) => { event.preventDefault(); activateConversation(conversationItem.id); setConversationContextMenu({ conversationId: conversationItem.id, title: conversationItem.title, left: Math.max(8, Math.min(window.innerWidth - 150, event.clientX)), top: Math.max(8, Math.min(window.innerHeight - 94, event.clientY)) }); }} onKeyDown={(event) => { if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); activateConversation(conversationItem.id); setConversationContextMenu({ conversationId: conversationItem.id, title: conversationItem.title, left: Math.max(8, Math.min(window.innerWidth - 150, bounds.left + 28)), top: Math.max(8, Math.min(window.innerHeight - 94, bounds.bottom)) }); }} aria-haspopup="menu" data-testid={`conversation-${conversationItem.id}`}><span>{conversationItem.title}</span><small>{new Date(conversationItem.updated_at).toLocaleDateString()}</small></TooltipButton>)}</div>}
          </Fragment>)}</div>
        </>}
      />}
    >

      <section className={`conversation-column${visibleMessages.length === 0 && !streamingOutput ? ' is-empty-conversation' : ''}`} data-surface="content">
        {!project ? newConversationStart ? <div className="new-conversation-start" data-testid="new-conversation-start"><div><p className="eyebrow">新对话</p><h2>开始一条新对话</h2><p>先选择一个本地文件夹建立 Project，然后即可创建第一条对话。Project 与对话各自独立，不会修改文件夹内容。</p><button className="secondary-button" onClick={() => void addProject()} data-testid="new-conversation-choose-project"><AppIcon name="folder"/>选择 Project 文件夹</button></div></div> : <div className="project-overview" data-testid="project-overview"><header><div><p className="eyebrow">PROJECTS</p><h1>项目</h1><p>本地文件夹、持久对话、文件变更和运行结果。</p></div><button className="secondary-button" onClick={() => void addProject()}><AppIcon name="folder"/>打开文件夹</button></header><div className="project-overview-empty"><h2>还没有项目</h2><p>使用左侧“项目”旁的 ＋ 或上方“打开文件夹”添加第一个本地 Project。</p></div></div> : <>
          <header className="conversation-header conversation-context-header"><div className="conversation-heading"><AppIcon name="folder"/><div className="conversation-title-line"><h2 title={conversation?.title ?? '新对话'}>{conversation?.title ?? '新对话'}</h2>{conversation && <ConversationActionsMenu onRename={() => setConversationDialog({ kind: 'RENAME', value: conversation.title })} onDelete={() => setConversationDialog({ kind: 'DELETE' })}/>}</div></div></header>
          <div className="message-list" ref={messageListRef}>
            {!conversation || (visibleMessages.length === 0 && !streamingOutput) ? <div className="conversation-empty" data-testid={!conversation ? 'project-empty-conversation' : undefined}><h3>{conversation ? '从这里开始工作' : project.title}</h3><p>{conversation ? '描述你想在当前项目中完成的任务。' : '开始新的工作'}</p></div> : visibleMessages.map((message, index) => {
              const isCurrentAgentAssistant = Boolean(agentRun && agentTurn?.assistantMessageId === message.id);
              if (message.role === 'ASSISTANT' && message.invocation_id) {
                if (isCurrentAgentAssistant || priorAttempts.some((attempt) => attempt.id === message.id)) return null;
                const historicalUserMessage = [...visibleMessages.slice(0, index)].reverse().find((item) => item.role === 'USER') ?? null;
                return <HistoricalAgentTurn onOpenActivityFile={openActivityFile} key={message.id} terminalMessage={message} requestText={historicalUserMessage?.content ?? ''} userMessageId={historicalUserMessage?.id ?? null} copied={copiedMessageId === message.id} onReview={openHistoricalAgentReview} onOpenReference={(reference) => void openResultReference(reference)} onOpenImage={(preview) => setPreviewAttachment(resultImageAttachment(preview))} onCopy={() => void copyMessage(message)} onCopyError={(reason) => setError(`复制代码失败：${reason}`)}/>;
              }
              const persistedImages = message.role === 'USER' ? messageAttachments(message.id) : [];
              const queuedFollowUp = message.role === 'USER' ? queuedFollowUps.find((item) => item.messageId === message.id) ?? null : null;
              if (queuedFollowUp) return null;
              return <Fragment key={message.id}>
                <article data-message-id={message.id} className={`message ${message.role.toLowerCase()}${persistedImages.length ? ' has-image-attachments' : ''}`} data-testid={`message-${message.role.toLowerCase()}`}>{persistedImages.length > 0 && <ConversationImageGallery attachments={persistedImages} onOpen={openAttachmentInDock} onContextMenu={openImageContextMenu}/>}<div className="message-content"><TimestampHover timestamp={message.created_at}><MarkdownMessage content={message.content} references={message.references} onOpenReference={(reference) => void openResultReference(reference)} onOpenImage={(preview) => setPreviewAttachment(resultImageAttachment(preview))} onCopyError={(reason) => setError(`复制代码失败：${reason}`)}/></TimestampHover></div><footer className={`message-actions ${copiedMessageId === message.id ? 'copy-confirmed' : ''}`}><time dateTime={new Date(message.created_at).toISOString()} title={new Date(message.created_at).toLocaleString('zh-CN')}>{messageTimeLabel(message.created_at)}</time>{message.status !== 'COMPLETED' && <span className="message-status">{messageStatusLabel(message.status)}</span>}<button type="button" className={copiedMessageId === message.id ? 'copied' : ''} aria-label={copiedMessageId === message.id ? '消息已复制' : '复制消息'} title={copiedMessageId === message.id ? '已复制' : '复制'} onClick={() => void copyMessage(message)} data-testid="message-copy"><AppIcon name={copiedMessageId === message.id ? 'check' : 'copy'}/>{copiedMessageId === message.id && <span role="status" aria-live="polite">已复制</span>}</button></footer></article>
                {agentRun && agentDisplayAnchor === message.id && <>
                  {priorAttempts.length > 0 && <details className="agent-prior-attempts" data-testid="agent-prior-attempts"><summary>之前的尝试 · {priorAttempts.length} 次<AppIcon name="chevronDown"/></summary>{priorAttempts.map((attempt) => <HistoricalAgentTurn key={attempt.id} terminalMessage={attempt} requestText={message.content} userMessageId={message.id} copied={copiedMessageId === attempt.id} onCopy={() => void copyMessage(attempt)} onCopyError={(reason) => setError(`复制代码失败：${reason}`)} onReview={openHistoricalAgentReview} onOpenReference={(reference) => void openResultReference(reference)} onOpenImage={(preview) => setPreviewAttachment(resultImageAttachment(preview))} onOpenActivityFile={openActivityFile}/>)}</details>}
                  {currentAgentTurn}
                </>}
              </Fragment>;
            })}
            {agentProjectionNotice && <p className="agent-projection-notice" role="status" data-testid="agent-projection-notice">{agentProjectionNotice}</p>}
          </div>
          {conversation && <ConversationTurnNavigation key={conversation.id} turns={navigationTurns} scrollContainer={messageListRef} onNavigate={() => { atLatestAnswerRef.current = false; setAtLatestAnswer(false); }}/>}
          {!atLatestAnswer && <button type="button" className={`latest-answer-button ${agentExecuting ? 'is-generating' : 'is-complete'}${hasUnseenActivity ? ' has-unseen' : ''}`} aria-label={agentRun && !agentRunIsTerminal ? '跳转到当前任务底部' : '跳转到最新消息'} title={agentRun && !agentRunIsTerminal ? '跳转到当前任务底部' : '跳转到最新消息'} onClick={scrollToLatestAnswer} data-testid="jump-to-latest">
            <AppIcon name="arrowDown"/>
          </button>}
          {queuedFollowUps.length > 0 && <section className="queued-follow-up-stack" aria-label="排队中的追加消息" data-testid="queued-follow-up-stack">
            {queuedFollowUps.map((item, index) => <article className="queued-follow-up-card" key={item.id} data-testid="queued-follow-up-card">
              <div className="queued-follow-up-main"><span className="queued-follow-up-index" aria-hidden="true">{index + 1}</span><strong title={item.content}>{item.content}</strong></div>
              <p className="queued-follow-up-status" data-testid="queued-follow-up-status" data-after-run-id={item.afterRunId}><span aria-hidden="true"/>{agentRun?.status === 'PAUSED' ? '当前任务已暂停；继续或停止后处理这条消息' : '将在当前任务结束后继续处理'}</p>
              <div className="queued-follow-up-actions">
                <button type="button" className="queued-follow-up-adjust" onClick={() => editQueuedFollowUp(item)}><AppIcon name="forward"/><span>调整方向</span></button>
                <button type="button" aria-label="删除排队消息" title="删除排队消息" onClick={() => removeQueuedFollowUp(item.id)}><AppIcon name="delete"/></button>
                <button type="button" className={queuedFollowUpMenuId === item.id ? 'active' : ''} aria-label="更多排队操作" aria-expanded={queuedFollowUpMenuId === item.id} onClick={() => setQueuedFollowUpMenuId((current) => current === item.id ? '' : item.id)}><AppIcon name="more"/></button>
              </div>
              {queuedFollowUpMenuId === item.id && <div className="queued-follow-up-menu" role="menu" data-surface="overlay">
                <button type="button" role="menuitem" onClick={() => editQueuedFollowUp(item)}><AppIcon name="edit"/><span>编辑消息</span></button>
                <button type="button" role="menuitem" onClick={() => removeQueuedFollowUp(item.id)}><AppIcon name="close"/><span>关闭排队</span></button>
              </div>}
            </article>)}
          </section>}
    <form className="conversation-composer" data-surface="floating" data-testid="conversation-composer" aria-busy={busy || conversationCreatingFor === project.field_id} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={handleComposerDrop} onSubmit={(event) => { event.preventDefault(); void send(prompt); }}>
            {composerAttachments.length > 0 && <div className="composer-attachments" data-testid="composer-attachments">
              {composerAttachments.filter((attachment) => attachment.kind === 'IMAGE').map((attachment) => <AttachmentThumbnail key={attachment.id} attachment={attachment} variant="composer" onOpen={openAttachmentInDock} onRemove={(id) => setAttachments((items) => items.filter((item) => item.id !== id))} onContextMenu={openImageContextMenu}/>)}
              {composerAttachments.filter((attachment) => attachment.kind === 'TEXT').map((attachment) => <div key={attachment.id} className={`attachment-chip ${attachment.status === 'READY' ? '' : 'unsupported'}`} title={attachment.reason ?? attachment.name}><AppIcon name="file"/><span><strong>{attachment.name}</strong><small>{attachment.status === 'READY' ? `${Math.max(1, Math.ceil(attachment.size / 1024))} KB · 文字 Context` : attachment.reason}</small></span><button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}><AppIcon name="close"/></button></div>)}
            </div>}
            <textarea
              ref={composerRef}
              name="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onPaste={handleComposerPaste}
              onKeyDown={(event) => {
                if (!shouldSubmitComposerKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              aria-label="描述要完成的任务"
              placeholder={awaitingAgentAnswer ? '回答上面的问题，继续当前任务…' : selectedFile ? `询问或修改 ${selectedFile.relative_path}…` : composerAttachments.some((item) => item.status === 'READY') ? '询问这些附件…' : '描述要完成的任务…'}
            />
            <div className="composer-footer">
              <div className="composer-left-actions">
                <TooltipButton type="button" className="composer-icon-button" tooltip="添加附件" placement="top" variant="default" onClick={() => void pickAttachments()} aria-label="添加附件" data-testid="composer-add-attachment"><AppIcon name="plus"/></TooltipButton>
                <SelectMenu className="composer-menu-picker permission-picker" value={permission} ariaLabel="权限" testId="composer-permission" placement="top" hideChevron leading={<PermissionIcon permission={permission}/>} options={[{ value: 'READ_ONLY', label: '请求批准', description: '编辑外部文件和使用互联网时始终询问', icon: <PermissionIcon permission="READ_ONLY"/> }, { value: 'REVIEW_CHANGES', label: '帮我批准', description: '仅对检测到的风险操作请求批准', icon: <PermissionIcon permission="REVIEW_CHANGES"/> }, { value: 'FULL_CONTROL', label: '完全访问权限', triggerLabel: '完全访问', description: '可不受限制地访问互联网和你电脑上的任何文件', icon: <PermissionIcon permission="FULL_CONTROL"/>, tone: 'warning' }]} onChange={updatePermission} />
              </div>
              <div className="composer-right-actions">
                {activeProviders.length > 1 ? <SelectMenu className="composer-menu-picker configured-model-picker" value={effectiveConversationProvider?.id ?? ''} ariaLabel="模型" testId="conversation-model" placement="top" options={[{ value: '', label: '选择模型' }, ...activeProviders.map((provider) => ({ value: provider.id, label: provider.default_model, description: `${provider.display_name}${provider.credential_present ? '' : ' · 需要凭据'}`, disabled: !provider.credential_present }))]} onChange={(value) => void updateConversationSelection(value)} /> : effectiveConversationProvider && <span className="composer-model-label" title={effectiveConversationProvider.display_name}>{effectiveConversationProvider.default_model}</span>}
                <TooltipButton type="button" className={`composer-icon-button voice-button ${listening ? 'active' : ''}`} tooltip={listening ? '停止语音输入' : '语音输入'} placement="top" variant="default" onClick={toggleVoiceInput} aria-label={listening ? '停止语音输入' : '开始语音输入'} data-testid="composer-voice"><AppIcon name="microphone"/></TooltipButton>
                {activeAgentRef.current && !awaitingAgentAnswer && prompt.trim() ? <>
                  {agentExecuting && <TooltipButton type="button" className="composer-icon-button composer-running-stop" tooltip="停止当前任务" placement="top" variant="default" aria-label="停止 Agent" onClick={() => void cancelAgent()} data-testid="stop-agent-secondary"><AppIcon name="stop"/></TooltipButton>}
                  <TooltipButton className="composer-submit" type="submit" tooltip="当前任务完成后继续处理" placement="top" variant="default" disabled={busy} aria-label="追加到当前任务" data-testid="send-steering"><AppIcon name="send" weight="bold"/></TooltipButton>
                </> : agentExecuting
                  ? <button type="button" className="composer-submit stop" aria-label="停止 Agent" onClick={() => void cancelAgent()} data-testid="stop-agent"><AppIcon name="stop"/></button>
                  : <button className="composer-submit" type="submit" disabled={busy || (!prompt.trim() && !composerAttachments.some((item) => item.status === 'READY'))} aria-label={awaitingAgentAnswer ? "回答并继续" : "发送"} data-testid="send-message"><AppIcon name="send" weight="bold"/></button>}
              </div>
            </div>
          </form>
        </>}
      </section>

      {project && <ResizableDivider label="调整文件或审阅区域宽度" value={workspaceWidth} min={PROJECT_WORKSPACE_MIN_WIDTH} max={workspaceMaximumWidth()} onResizeStart={() => {
        workspaceDragGeometryRef.current = captureWorkspaceDragGeometry();
        workspaceCollapsedDuringDragRef.current = !workspaceOpen;
        workspaceFocusedDuringDragRef.current = dockFocused;
      }} onResize={(clientX) => resizeWorkspaceDuringDrag(clientX, false)} onResizeEnd={(clientX) => {
        resizeWorkspaceDuringDrag(clientX, true);
        workspaceDragGeometryRef.current = null;
      }} onKeyboardResize={(delta) => updateWorkspaceWidth(workspacePreferredWidthRef.current - delta)} testId="project-workspace-resizer" className="project-workspace-resizer" />}

      {project && showLegacyWorkspace && <section className="legacy-workspace-panel" aria-hidden="true">
        <header className="workspace-panel-header"><div><AppIcon name={workspaceTab === 'FILES' ? 'files' : 'diff'}/><strong>{workspaceTab === 'FILES' ? '文件' : '审阅变更'}</strong></div><button onClick={() => setWorkspaceOpen(false)} title="关闭工作区" data-testid="workspace-close"><AppIcon name="close"/></button></header>
        <div className="workspace-tabs"><button className={workspaceTab === 'FILES' ? 'active' : ''} onClick={() => setWorkspaceTab('FILES')}>文件</button><button className={workspaceTab === 'DIFF' ? 'active' : ''} onClick={() => setWorkspaceTab('DIFF')}>审阅{draft || displayedAgentReview.files.length ? ` · ${draft ? 1 : displayedAgentReview.files.length}` : ''}</button></div>
        {workspaceTab === 'FILES' && <div className="file-workspace"><div className="file-tree"><header><strong>文件</strong><button onClick={async () => setFiles(await window.fielora.workspace.listFiles({field_id:project.field_id}))}>↻</button></header>{files.map((file) => <button key={file.relative_path} className={selectedFile?.relative_path === file.relative_path || (filePreview?.kind === 'IMAGE' ? filePreview.preview.relative_path : filePreview?.relativePath) === file.relative_path ? 'active' : ''} onClick={() => void openFile(file)} data-testid="workspace-file"><span>⌑</span>{file.relative_path}</button>)}</div>{selectedFile ? <div className="file-editor"><header><span>{selectedFile.relative_path}</span>{undoChange?.relativePath === selectedFile.relative_path && <button onClick={() => void undoAcceptedChange()} data-testid="undo-change">撤销已接受变更</button>}</header><textarea value={editorContent} onChange={(event) => setEditorContent(event.target.value)} spellCheck={false} data-testid="file-editor" /><footer><span>{editorContent === selectedFile.content ? '未修改' : '有未 review 的修改'}</span><button disabled={editorContent === selectedFile.content} onClick={reviewEditor} data-testid="review-change">Review Diff</button></footer></div> : filePreview?.kind === 'IMAGE' ? <div className="file-image-preview" data-testid="file-image-preview"><header><span>{filePreview.preview.relative_path}</span></header><div><img src={filePreview.preview.data_url} alt={filePreview.preview.relative_path}/><small>{filePreview.preview.mime_type} · {Math.max(1, Math.ceil(filePreview.preview.size / 1024))} KB</small></div></div> : filePreview?.kind === 'UNSUPPORTED' ? <div className="file-unsupported-preview" data-testid="file-unsupported-preview"><AppIcon name="files"/><h3>无法在此预览</h3><strong>{filePreview.relativePath}</strong><p>{filePreview.message}</p></div> : <div className="workspace-blank"><p>选择文件以查看和编辑。</p></div>}</div>}
        {workspaceTab === 'DIFF' && <div className="diff-workspace">{draft ? <><header><div><p className="eyebrow">REVIEW</p><h3>{draft.relativePath}</h3></div><span>写入前不会修改磁盘</span></header><pre className="diff-view" data-testid="diff-view">{draft.diff}</pre><footer><button className="secondary-button" onClick={() => {setDraft(null);setEditorContent(selectedFile?.content??'');setWorkspaceTab('FILES');}}>放弃</button><button className="primary-button" onClick={() => void acceptDraft()} data-testid="accept-change">接受变更</button></footer></> : displayedAgentReview.files.length > 0 ? <AgentHumanReview review={displayedAgentReview} task={historicalReview?.task ?? agentRun?.task ?? conversation?.title ?? ''} runId={historicalReview?.runId ?? agentRun?.id ?? ''} selectedPathHint={agentReviewPath} onOpenFile={(path) => void openAgentReviewFile(path)} onMarkReviewed={markAgentFileArtifactReviewed} onUndo={(file) => undoAgentFileArtifact(historicalReview?.runId ?? agentRun?.id ?? '', file)}/> : <div className="workspace-blank"><h3>本次任务没有文件变更</h3><p>Agent 的写入、补丁和替换会显示在这里。</p></div>}</div>}
      </section>}
      {project && <RightWorkspaceDock
        tabs={dockTabs.map((tab) => ({ ...tab, fileIconPath: tab.kind === 'FILE' || tab.kind === 'IMAGE' ? tab.relativePath ?? tab.attachment?.name : undefined }))}
        activeTabId={activeDockTabId}
        toolbar={dockToolbar}
        tools={dockTools}
        showLauncher={workspaceOpen && dockTabs.length === 0}
        onActivate={activateDockTab}
        onClose={closeDockTab}
        onReload={reloadDockTab}
        onDuplicate={duplicateDockTab}
        onRename={renameDockTab}
        onCloseOthers={closeOtherDockTabs}
        onCloseToRight={closeDockTabsToRight}
      >{dockViews}</RightWorkspaceDock>}
    </WorkspaceSurface>
    {previewAttachment && createPortal(<ImagePreview attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} onContextMenu={previewAttachment.source === 'library' ? undefined : openImageContextMenu}/>, document.body)}
    {imageContextMenu && createPortal(<ImageContextMenu {...imageContextMenu} locationLabel={project ? `${project.title} / 当前对话 / ${imageContextMenu.attachment.name}` : `当前对话 / ${imageContextMenu.attachment.name}`} onShow={(attachment) => { setImageContextMenu(null); openAttachmentInDock(attachment); }} onCopy={(attachment) => void copyImageAttachment(attachment)} onSave={(attachment) => void saveImageAttachment(attachment)} onClose={() => setImageContextMenu(null)}/>, document.body)}
    {environmentControl}
    {project && terminalLayer && createPortal(<>
      <ResizableDivider orientation="horizontal" label="调整终端高度" value={bottomTerminalHeight} min={170} max={520} onResizeStart={beginBottomTerminalDrag} onResize={(clientY) => resizeBottomTerminalDuringDrag(clientY, false)} onResizeEnd={(clientY) => resizeBottomTerminalDuringDrag(clientY, true)} onKeyboardResize={(delta) => updateBottomTerminalHeight(bottomTerminalHeight - delta)} testId="bottom-terminal-resizer" className="terminal-resizer" />
      <section className="terminal-dock bottom-terminal-dock" data-testid="bottom-terminal-dock" aria-hidden={!bottomTerminalOpen}>
        <header><div><AppIcon name="terminalPanel"/><strong>PowerShell</strong></div><button type="button" onClick={() => setBottomTerminalOpen(false)} aria-label="关闭底部终端" data-testid="bottom-terminal-close"><AppIcon name="close"/></button></header>
        <TerminalSession workingDirectory={terminalWorkingDirectory || project.root_path} command={terminalCommand} lastCommand={terminalLastCommand} output={terminalOutput} running={Boolean(terminalRunId)} active={bottomTerminalOpen} onCommandChange={setTerminalCommand} onRun={() => void runTerminal(terminalCommand, 'BOTTOM')} onCancel={() => terminalRunId ? void window.fielora.workspace.cancelTerminal({ run_id: terminalRunId }) : undefined} testId="bottom-terminal"/>
      </section>
    </>, terminalLayer)}
    {conversationDialog?.kind === 'RENAME' && <TextActionDialog title="重命名对话" description="新名称会同步更新到当前 Project 的对话列表。" value={conversationDialog.value} confirmLabel="保存" onChange={(value) => setConversationDialog({ kind: 'RENAME', value })} onCancel={() => setConversationDialog(null)} onConfirm={() => void renameConversation(conversationDialog.value)} testId="rename-conversation-dialog" />}
    {conversationDialog?.kind === 'DELETE' && conversation && <TextActionDialog title={`删除“${conversation.title}”？`} description="这条对话和消息会从 Project 列表归档。此操作不会删除项目文件。" confirmLabel="删除对话" danger onCancel={() => setConversationDialog(null)} onConfirm={() => void archiveConversation()} testId="delete-conversation-dialog" />}
    {conversationContextMenu && <ConversationContextMenu state={conversationContextMenu} onClose={() => setConversationContextMenu(null)} onRename={() => setConversationDialog({ kind: 'RENAME', value: conversationContextMenu.title })} onDelete={() => setConversationDialog({ kind: 'DELETE' })} />}
    {projectContextMenu && <ProjectContextMenu state={projectContextMenu} onClose={() => setProjectContextMenu(null)} onNewConversation={() => void createConversationFor(projectContextMenu.project)} onManage={() => setProjectDialog({ project: projectContextMenu.project, value: projectContextMenu.project.title })} onRemove={() => setProjectRemoval(projectContextMenu.project)} />}
    {projectDialog && <TextActionDialog title="编辑项目" description={`修改项目名称；本地文件夹保持为 ${projectDialog.project.root_path}`} value={projectDialog.value} confirmLabel="保存" onChange={(value) => setProjectDialog({ ...projectDialog, value })} onCancel={() => setProjectDialog(null)} onConfirm={() => void renameProject()} testId="edit-project-dialog" />}
    {projectRemoval && <TextActionDialog title={`移除“${projectRemoval.title}”？`} description="只会从 Fielora 项目列表移除。不会删除磁盘上的文件夹、代码、Git 历史或已保存的对话数据。" confirmLabel="移除项目" danger onCancel={() => setProjectRemoval(null)} onConfirm={() => void archiveProject(projectRemoval)} testId="remove-project-dialog" />}
    {error && <div className="project-toast" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
  </div>;
}
