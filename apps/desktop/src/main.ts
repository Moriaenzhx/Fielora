import { validatePrepareProviderSend, validateUpdateModelRuntime } from './validation';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeImage, nativeTheme, protocol, shell } from 'electron';
import type { ContextMenuParams, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import type { AgentRunView, ConversationMessageView, LibraryMediaKind, LibraryObjectView, PortableBlobManifestEntryView, ProfileView, ProjectView, ScreenshotEvidenceView } from '@fielora/contracts';
import type { LibraryImagePreviewView } from './workspace-types';
import { BrowserRuntime } from './browser-runtime';
import { AgentBrowserHost } from './agent-browser-host';
import { startAgentWithReconciliation } from './agent-start';
import { channels } from './channels';
import { assertTrustedSender, isAllowedNavigation, trustedOriginFor } from './security';
import { CoreProcessSupervisor } from './supervisor';
import {
  validateArchiveReference, validateAttachReferenceSource, validateCreate, validateCreateReference,
  validateCreateState, validateFocus, validateListActivities, validateListReferences,
  validateListRelations, validateListStates, validateObjectReference, validateReference,
  validateRestoreReference, validateRetractReferenceSource, validateReviseReference,
  validateReviseState, validateSetFocusV1, validateSnapshot, validateSnapshotV1,
  validateStateReference, validateSupersedeState, validateTransitionState, validateUpdateMode,
  validateBrowserBounds, validateBrowserNavigate, validateBrowserPageRequest,
  validateClipboardText,
  validateCreateProvider, validateUpdateProvider, validateProviderReference, validateStoreCredential,
  validateStartModel, validateCancelModel, validateCreateCapture, validateCaptureReference,
  validateMutateCapture, validateAttachCapture, validatePromoteCapture, validateListCaptures,
  validatePickProject, validateCreateProject, validateUpdateProject, validateArchiveProject, validateWorkspaceProject, validateCreateConversation,
  validateConversationReference, validateUpdateConversation, validateArchiveConversation,
  validateCreateConversationMessage, validateListConversationMessages, validateWorkspaceFile,
  validateApplyWorkspaceFile, validateRunTerminal, validateCancelTerminal, validateOpenWorkspaceProject,
  validateStartAgent, validateAgentRun, validateResumeAgent, validateListAgentRuns, validateListAgentEvents,
  validateResolveAgentApproval, validateModelUsageReport,
  validateActivateMcpConnection,
  validateSkillCatalog, validateRegisterLocalPlugin, validateUnregisterLocalPlugin,
  validateListArtifacts, validateReadArtifact, validateArtifactHistory,
  validateAssetPreview, validateDiagramPreview, validateSetArtifactArchiveState,
  validateListFileArtifactReviews, validateMarkFileArtifactReviewed, validateUndoFileArtifactRevision,
  validateReadWorkspaceAttachment, validateSaveWorkspaceAttachment, validateStoreWorkspaceAttachment,
  validateSaveWebLibrary, validateLibraryObject, validateDeleteLibraryObject, validateListLibraryObjects,
  validateScreenshotEvidence, validateScreenshotEvidenceByRun, validateScreenshotEvidenceByVerification, validateScreenshotEvidencePreview,
} from './validation';
import { WorkspaceRuntime } from './workspace-runtime';
import { prepareMacEnvironment } from './macos-environment';
import { detectSafeRasterMime, loadSelectedAttachments, readStoredImage, storeImageAttachment } from './attachment-runtime';
import { focusUsableWindow, usableWindow, withUsableWindow } from './window-lifecycle';
import { desktopFoundationUserDataPath, hasExplicitUserDataDirectory } from './runtime-identity';
import { windowSurfaceColors, type WindowSurfaceTheme } from './window-surface';
import { StorageManager, directoryManifest, sha256File } from './storage-manager';
import { createPortableProfile, extractPortableProfile, portableLibraryInputs, type PortableInputFile } from './portable-profile';
import { normalizeAppPreferences } from './renderer/app-preferences';
import { ScheduledTaskService } from './scheduled-tasks';
import type { CreateScheduledTaskRequest, ScheduledTaskRequest, ScheduledTaskView, UpdateScheduledTaskRequest } from './scheduled-task-types';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Windows native occlusion can mark a focused, visible WebContentsView hidden,
// leaving DOM reads alive while its compositor and native input stop. Keep
// explicit page/window visibility and background throttling; disable only this
// OS occlusion heuristic before Chromium starts (see native-repro evidence).
if (process.platform === 'win32') {
  const disabledFeatures = new Set(app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean));
  disabledFeatures.add('CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-features', [...disabledFeatures].join(','));
}

app.setName('Fielora');

protocol.registerSchemesAsPrivileged([
  { scheme: 'fielora', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Historical Phase 04 builds used Electron's default @fielora/desktop profile.
// A stranded historical process can therefore own that profile's single-instance
// lock and intercept a newer executable. Desktop Foundation has a stable runtime
// profile of its own; Core data remains under LOCALAPPDATA/Fielora and is unchanged.
if (process.env.FIELORA_E2E !== '1' && !hasExplicitUserDataDirectory(process.argv)) {
  app.setPath('userData', desktopFoundationUserDataPath(app.getPath('appData')));
}

if (process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_USER_DATA) app.setPath('userData', process.env.FIELORA_E2E_USER_DATA);

if (process.env.FIELORA_E2E === '1' && /^\d{2,5}$/.test(process.env.FIELORA_E2E_DEBUG_PORT ?? '')) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.FIELORA_E2E_DEBUG_PORT);
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}

let appWindow: BrowserWindow | undefined;
let browserRuntime: BrowserRuntime | undefined;
let trustedOrigin = '';
let quitting = false;
let storageManager: StorageManager | undefined;
let scheduledTaskService: ScheduledTaskService | undefined;
const supervisor = new CoreProcessSupervisor(() => storage().coreEnvironment());
const agentBrowserHost = new AgentBrowserHost(browser, (method, params) => supervisor.request(method, params), (runId, conversationId) => {
  withUsableWindow(appWindow, window => window.webContents.send(channels.coreEvent, { event: 'event.agent.browser', run_id: runId, conversation_id: conversationId }));
}, () => workspaceRuntime);
const workspaceRuntime = new WorkspaceRuntime((event) => {
  withUsableWindow(appWindow, (window) => window.webContents.send(channels.workspaceEvent, event));
});

function browser(): BrowserRuntime {
  if (!browserRuntime) throw new Error('Browse runtime is unavailable');
  return browserRuntime;
}

function storage(): StorageManager {
  if (!storageManager) throw new Error('StorageManager is unavailable');
  return storageManager;
}

function scheduledTasks(): ScheduledTaskService {
  if (!scheduledTaskService) throw new Error('Scheduled tasks are unavailable');
  return scheduledTaskService;
}

function scheduledPayload<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid scheduled task request');
  return payload as T;
}

function scheduledTaskId(payload: unknown): string {
  const request = scheduledPayload<ScheduledTaskRequest>(payload);
  if (typeof request.id !== 'string' || request.id.trim().length === 0 || request.id.length > 256) throw new Error('Invalid scheduled task id');
  return request.id;
}

async function executeScheduledTask(task: ScheduledTaskView): Promise<string> {
  const message = await durableMutation(() => supervisor.request('command.conversation.message.create', {
    conversation_id: task.conversation_id,
    role: 'USER',
    content: task.task,
    status: 'COMPLETED',
    provider_config_id: null,
    model_id: null,
    invocation_id: null,
    references: [],
  })) as ConversationMessageView;
  const run = await durableMutation(() => startAgentWithReconciliation((method, params) => supervisor.request(method, params), {
    field_id: task.field_id,
    conversation_id: task.conversation_id,
    user_message_id: message.id,
    provider_config_id: task.provider_config_id,
    model_id: task.model_id,
    task: task.task,
    permission: task.permission,
    max_steps: task.max_steps,
    attachments: [],
  })) as AgentRunView;
  return run.id;
}

function assertBridgeEvent(event: IpcMainInvokeEvent): void {
  const window = usableWindow(appWindow);
  if (!window || !event.senderFrame) throw new Error('Untrusted bridge sender');
  assertTrustedSender({
    senderId: event.sender.id,
    expectedSenderId: window.webContents.id,
    frameUrl: event.senderFrame.url,
    isMainFrame: event.senderFrame === event.sender.mainFrame,
  }, trustedOrigin);
}

function showTrustedEditContextMenu(params: ContextMenuParams): void {
  const window = usableWindow(appWindow);
  if (!window) return;
  const contents = window.webContents;
  const template: MenuItemConstructorOptions[] = [];
  if (params.isEditable) {
    template.push({ label: '撤销', accelerator: 'CommandOrControl+Z', enabled: params.editFlags.canUndo, click: () => contents.undo() });
    template.push({ label: '重做', accelerator: process.platform === 'darwin' ? 'Command+Shift+Z' : 'Ctrl+Y', enabled: params.editFlags.canRedo, click: () => contents.redo() });
    template.push({ type: 'separator' });
    template.push({ label: '剪切', accelerator: 'CommandOrControl+X', enabled: params.editFlags.canCut, click: () => contents.cut() });
    template.push({ label: '复制', accelerator: 'CommandOrControl+C', enabled: params.editFlags.canCopy, click: () => contents.copy() });
    template.push({ label: '粘贴', accelerator: 'CommandOrControl+V', enabled: params.editFlags.canPaste, click: () => contents.paste() });
    template.push({ type: 'separator' });
    template.push({ label: '全选', accelerator: 'CommandOrControl+A', enabled: params.editFlags.canSelectAll, click: () => contents.selectAll() });
  } else if (params.selectionText) {
    template.push({ label: '复制', accelerator: 'CommandOrControl+C', enabled: params.editFlags.canCopy, click: () => contents.copy() });
  }
  if (template.length === 0) return;
  if (!app.isPackaged || process.env.FIELORA_E2E === '1') {
    console.info(`[trusted-context-menu] editable=${params.isEditable} selection=${Boolean(params.selectionText)} items=${template.filter((item) => item.type !== 'separator').length}`);
  }
  Menu.buildFromTemplate(template).popup({ window });
}

let storageMaintenance = false;
let activeDurableMutations = 0;
let durableDrain: (() => void) | null = null;

async function durableMutation<T>(action: () => Promise<T>): Promise<T> {
  if (storageMaintenance) throw new Error('Storage maintenance is in progress');
  activeDurableMutations += 1;
  try { return await action(); }
  finally {
    activeDurableMutations -= 1;
    if (activeDurableMutations === 0) { durableDrain?.(); durableDrain = null; }
  }
}

async function beginStorageMaintenance(): Promise<void> {
  if (storageMaintenance) throw new Error('Storage maintenance is already in progress');
  storageMaintenance = true;
  if (activeDurableMutations > 0) await new Promise<void>((resolve) => { durableDrain = resolve; });
}

function endStorageMaintenance(): void { storageMaintenance = false; }

function handle(channel: string, validator: (payload: unknown) => unknown, method: string): void {
  ipcMain.handle(channel, async (event, payload) => {
    assertBridgeEvent(event);
    const request = () => method === 'command.agent.start'
      ? startAgentWithReconciliation((method, params) => supervisor.request(method, params), validateStartAgent(payload))
      : supervisor.request(method, validator(payload));
    return method.startsWith('command.') ? durableMutation(request) : request();
  });
}

async function projectRoot(fieldId: string): Promise<string> {
  const project = await supervisor.request('query.project.get', { field_id: fieldId }) as ProjectView;
  if (!project.root_path) throw new Error('Project 原位置不可用，请先定位项目文件夹');
  return project.root_path;
}

type WorkspaceOpenTargetId = import('./workspace-types').WorkspaceProjectOpenTarget;
type WorkspaceOpenTargetView = import('./workspace-types').WorkspaceProjectOpenTargetView;

const workspaceOpenApplications: Array<{
  target: Exclude<WorkspaceOpenTargetId, 'FILE_EXPLORER'>;
  label: string;
  commands: string[];
  commonPaths: string[];
}> = [
  { target: 'VISUAL_STUDIO_CODE', label: 'Visual Studio Code', commands: ['Code.exe', 'code.exe'], commonPaths: [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe')] },
  { target: 'CURSOR', label: 'Cursor', commands: ['Cursor.exe', 'cursor.exe'], commonPaths: [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'cursor', 'Cursor.exe'), path.join(process.env.ProgramFiles ?? '', 'Cursor', 'Cursor.exe')] },
  { target: 'VISUAL_STUDIO', label: 'Visual Studio', commands: ['devenv.exe'], commonPaths: [] },
  { target: 'GIT_BASH', label: 'Git Bash', commands: ['git-bash.exe'], commonPaths: [path.join(process.env.ProgramFiles ?? '', 'Git', 'git-bash.exe')] },
  { target: 'INTELLIJ_IDEA', label: 'IntelliJ IDEA', commands: ['idea64.exe', 'idea.exe'], commonPaths: [] },
  { target: 'PYCHARM', label: 'PyCharm', commands: ['pycharm64.exe', 'pycharm.exe'], commonPaths: [] },
  { target: 'WEBSTORM', label: 'WebStorm', commands: ['webstorm64.exe', 'webstorm.exe'], commonPaths: [] },
];

async function findWorkspaceApplication(target: Exclude<WorkspaceOpenTargetId, 'FILE_EXPLORER'>): Promise<string | null> {
  const application = workspaceOpenApplications.find((item) => item.target === target);
  if (!application) return null;
  if (process.platform === 'darwin') {
    const bundles: Partial<Record<WorkspaceOpenTargetId, string[]>> = {
      VISUAL_STUDIO_CODE: ['Visual Studio Code.app'], CURSOR: ['Cursor.app'],
      INTELLIJ_IDEA: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app'],
      PYCHARM: ['PyCharm.app', 'PyCharm CE.app'], WEBSTORM: ['WebStorm.app'],
    };
    for (const directory of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      for (const bundle of bundles[target] ?? []) {
        const candidate = path.join(directory, bundle);
        try { if ((await stat(candidate)).isDirectory()) return candidate; } catch { /* Not installed here. */ }
      }
    }
    return null;
  }
  if (process.platform !== 'win32') return null;
  for (const candidate of application.commonPaths.filter((value) => path.isAbsolute(value))) {
    try { await access(candidate); return candidate; } catch { /* Try PATH next. */ }
  }
  for (const command of application.commands) {
    const registryKeys = [
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${command}`,
      `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${command}`,
      `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${command}`,
      ...(target === 'VISUAL_STUDIO_CODE' ? ['HKCR\\vscode\\shell\\open\\command'] : []),
      ...(target === 'CURSOR' ? ['HKCR\\cursor\\shell\\open\\command'] : []),
    ];
    for (const key of registryKeys) {
      const registered = await new Promise<string | null>((resolve) => {
        execFile('reg.exe', ['query', key, '/ve'], { windowsHide: true, timeout: 2_500 }, (error, stdout) => {
          if (error) { resolve(null); return; }
          const value = stdout.match(/REG_SZ\s+(.+)$/mu)?.[1]?.trim() ?? '';
          resolve(value.match(/^"([^"]+\.exe)"/iu)?.[1] ?? value.match(/^([^\s]+\.exe)/iu)?.[1] ?? null);
        });
      });
      if (registered) {
        try { await access(registered); return registered; } catch { /* Keep looking. */ }
      }
    }
    const located = await new Promise<string | null>((resolve) => {
      execFile('where.exe', [command], { windowsHide: true, timeout: 2_500 }, (error, stdout) => resolve(error ? null : stdout.split(/\r?\n/u).find(Boolean) ?? null));
    });
    if (located) return located;
  }
  return null;
}

async function workspaceProtocolAvailable(target: Exclude<WorkspaceOpenTargetId, 'FILE_EXPLORER'>): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const scheme = target === 'VISUAL_STUDIO_CODE' ? 'vscode' : target === 'CURSOR' ? 'cursor' : null;
  if (!scheme) return false;
  return new Promise<boolean>((resolve) => execFile('reg.exe', ['query', `HKCR\\${scheme}\\shell\\open\\command`, '/ve'], { windowsHide: true, timeout: 2_500 }, (error) => resolve(!error)));
}

async function workspaceApplicationIcon(executable: string | null): Promise<string | null> {
  if (!executable) return null;
  try {
    const icon = await app.getFileIcon(executable, { size: 'normal' });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    return null;
  }
}

function libraryFileClassification(filename: string): { mime_type: string | null; media_kind: Exclude<LibraryMediaKind, 'WEB'> } {
  const extension = path.extname(filename).toLocaleLowerCase();
  const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const audio: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.ogg': 'audio/ogg' };
  const video: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska' };
  const documents: Record<string, string> = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  if (images[extension]) return { mime_type: images[extension], media_kind: 'IMAGE' };
  if (audio[extension]) return { mime_type: audio[extension], media_kind: 'AUDIO' };
  if (video[extension]) return { mime_type: video[extension], media_kind: 'VIDEO' };
  if (documents[extension]) return { mime_type: documents[extension], media_kind: 'DOCUMENT' };
  return { mime_type: null, media_kind: 'OTHER' };
}

async function importPortableBlobs(extractedRoot: string): Promise<void> {
  const source = path.join(extractedRoot, 'library');
  try { await access(source); } catch { return; }
  for (const item of await directoryManifest(source)) {
    const blobRef = item.relative_path;
    const target = storage().resolveBlob(blobRef);
    if (item.sha256 !== path.posix.basename(blobRef)) throw new Error('Portable Library blob identity mismatch');
    try {
      await access(target);
      if (await sha256File(target) !== item.sha256) throw new Error('Existing Library blob hash mismatch');
    } catch (error) {
      if (error instanceof Error && error.message === 'Existing Library blob hash mismatch') throw error;
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(source, ...blobRef.split('/')), target);
      if (await sha256File(target) !== item.sha256) throw new Error('Imported Library blob verification failed', { cause: error });
    }
  }
}

let workspaceOpenTargetsCache: WorkspaceOpenTargetView[] | null = null;

async function workspaceOpenTargets(): Promise<WorkspaceOpenTargetView[]> {
  if (workspaceOpenTargetsCache) return workspaceOpenTargetsCache;
  const explorerExecutable = process.platform === 'darwin' ? '/System/Library/CoreServices/Finder.app' : path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe');
  const detected = await Promise.all(workspaceOpenApplications.map(async (application) => {
    const executable = await findWorkspaceApplication(application.target);
    const available = Boolean(executable) || await workspaceProtocolAvailable(application.target);
    return { application, available, iconDataUrl: await workspaceApplicationIcon(executable) };
  }));
  workspaceOpenTargetsCache = [
    { target: 'FILE_EXPLORER', label: process.platform === 'darwin' ? 'Finder' : '文件资源管理器', icon_data_url: await workspaceApplicationIcon(explorerExecutable) },
    ...detected.filter((item) => item.available).map(({ application, iconDataUrl }) => ({ target: application.target, label: application.label, icon_data_url: iconDataUrl })),
  ];
  return workspaceOpenTargetsCache;
}

function registerBridgeHandlers(): void {
  ipcMain.handle(channels.windowTitlebarTheme, (event, payload) => {
    assertBridgeEvent(event);
    if (!payload || typeof payload !== 'object') throw new Error('Invalid titlebar theme');
    const { theme, background, translucentSidebar = false } = payload as { theme?: unknown; background?: unknown; translucentSidebar?: unknown };
    if (theme !== 'LIGHT' && theme !== 'DARK') throw new Error('Invalid titlebar theme');
    if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/iu.test(background)) throw new Error('Invalid titlebar background');
    if (typeof translucentSidebar !== 'boolean') throw new Error('Invalid sidebar material');
    const surface = windowSurfaceColors(theme as WindowSurfaceTheme, background);
    withUsableWindow(appWindow, (window) => {
      if (process.platform === 'darwin') window.setVibrancy(translucentSidebar ? 'sidebar' : null);
      window.setBackgroundColor(process.platform === 'darwin' && translucentSidebar ? '#00000000' : surface.background);
      if (process.platform !== 'darwin') window.setTitleBarOverlay({ color: surface.background, symbolColor: surface.symbols, height: surface.height });
    });
    return null;
  });
  ipcMain.handle(channels.projectPick, async (event, payload) => {
    assertBridgeEvent(event);
    const request = validatePickProject(payload);
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    let rootPath: string;
    if (process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_PROJECT_PATH) {
      rootPath = path.resolve(process.env.FIELORA_E2E_PROJECT_PATH);
    } else {
      const selection = await dialog.showOpenDialog(appWindow, { title: '选择 Project 文件夹', properties: ['openDirectory', 'createDirectory'] });
      if (selection.canceled || selection.filePaths.length !== 1) return null;
      rootPath = path.resolve(selection.filePaths[0]!);
    }
    return durableMutation(() => supervisor.request('command.project.create', {
      title: request.title.trim() || path.basename(rootPath), goal: request.goal, root_path: rootPath,
    }));
  });
  ipcMain.handle(channels.projectList, (event) => { assertBridgeEvent(event); return supervisor.request('query.project.list'); });
  handle(channels.projectGet, validateReference, 'query.project.get');
  handle(channels.projectUpdate, validateUpdateProject, 'command.project.update');
  handle(channels.projectArchive, validateArchiveProject, 'command.project.archive');
  ipcMain.handle(channels.projectRebind, async (event, payload) => {
    assertBridgeEvent(event);
    const request = validateReference(payload);
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    const selection = await dialog.showOpenDialog(appWindow, { title: '定位 Project 文件夹', properties: ['openDirectory'] });
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    return durableMutation(() => supervisor.request('command.project.rebind', { field_id: request.field_id, root_path: path.resolve(selection.filePaths[0]!) }));
  });
  handle(channels.conversationCreate, validateCreateConversation, 'command.conversation.create');
  handle(channels.conversationList, validateReference, 'query.conversation.list');
  handle(channels.conversationGet, validateConversationReference, 'query.conversation.get');
  handle(channels.conversationUpdate, validateUpdateConversation, 'command.conversation.update');
  handle(channels.conversationArchive, validateArchiveConversation, 'command.conversation.archive');
  handle(channels.conversationMessageCreate, validateCreateConversationMessage, 'command.conversation.message.create');
  handle(channels.conversationMessageList, validateListConversationMessages, 'query.conversation.message.list');
  ipcMain.handle(channels.scheduledTaskList, (event) => { assertBridgeEvent(event); return scheduledTasks().list(); });
  ipcMain.handle(channels.scheduledTaskCreate, (event, payload) => {
    assertBridgeEvent(event);
    return durableMutation(() => scheduledTasks().create(scheduledPayload<CreateScheduledTaskRequest>(payload)));
  });
  ipcMain.handle(channels.scheduledTaskUpdate, (event, payload) => {
    assertBridgeEvent(event);
    return durableMutation(() => scheduledTasks().update(scheduledPayload<UpdateScheduledTaskRequest>(payload)));
  });
  ipcMain.handle(channels.scheduledTaskDelete, (event, payload) => {
    assertBridgeEvent(event);
    return durableMutation(() => scheduledTasks().delete(scheduledTaskId(payload)));
  });
  ipcMain.handle(channels.scheduledTaskRunNow, (event, payload) => {
    assertBridgeEvent(event);
    return scheduledTasks().runNow(scheduledTaskId(payload));
  });
  handle(channels.artifactList, validateListArtifacts, 'query.artifact.list');
  handle(channels.artifactRead, validateReadArtifact, 'query.artifact.read');
  handle(channels.artifactHistory, validateArtifactHistory, 'query.artifact.history');
  handle(channels.artifactAssetPreview, validateAssetPreview, 'query.artifact.asset_preview');
  handle(channels.artifactDiagramPreview, validateDiagramPreview, 'query.artifact.diagram_preview');
  handle(channels.artifactSetArchiveState, validateSetArtifactArchiveState, 'command.artifact.set_archive_state');
  handle(channels.artifactFileReviews, validateListFileArtifactReviews, 'query.artifact.file_reviews');
  handle(channels.artifactFileMarkReviewed, validateMarkFileArtifactReviewed, 'command.artifact.file_mark_reviewed');
  handle(channels.artifactFileUndo, validateUndoFileArtifactRevision, 'command.artifact.file_undo');
  ipcMain.handle(channels.workspaceFileList, async (event, payload) => {
    assertBridgeEvent(event); const request=validateWorkspaceProject(payload);
    return workspaceRuntime.listFiles(await projectRoot(request.field_id));
  });
  ipcMain.handle(channels.workspaceFileRead, async (event, payload) => {
    assertBridgeEvent(event); const request=validateWorkspaceFile(payload);
    return workspaceRuntime.readFile(await projectRoot(request.field_id), request.relative_path);
  });
  ipcMain.handle(channels.workspaceFilePreview, async (event, payload) => {
    assertBridgeEvent(event); const request=validateWorkspaceFile(payload);
    return workspaceRuntime.previewImage(await projectRoot(request.field_id), request.relative_path);
  });
  ipcMain.handle(channels.workspaceAttachmentPick, async (event) => {
    assertBridgeEvent(event);
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    let filePaths: string[];
    if (process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_ATTACHMENT_PATHS) {
      const fixturePaths: unknown = JSON.parse(process.env.FIELORA_E2E_ATTACHMENT_PATHS);
      if (!Array.isArray(fixturePaths) || fixturePaths.some((item) => typeof item !== 'string')) throw new Error('Invalid attachment fixture');
      filePaths = fixturePaths;
    } else {
      const selection = await dialog.showOpenDialog(appWindow, { title: '添加附件', properties: ['openFile', 'multiSelections'] });
      if (selection.canceled) return { attachments: [], truncated_count: 0 };
      filePaths = selection.filePaths;
    }
    return loadSelectedAttachments(filePaths);
  });
  ipcMain.handle(channels.workspaceAttachmentStore, async (event, payload) => {
    assertBridgeEvent(event);
    return storeImageAttachment(path.join(app.getPath('userData'), 'conversation-attachments'), validateStoreWorkspaceAttachment(payload));
  });
  ipcMain.handle(channels.workspaceAttachmentRead, async (event, payload) => {
    assertBridgeEvent(event);
    const request = validateReadWorkspaceAttachment(payload);
    const stored = await readStoredImage(path.join(app.getPath('userData'), 'conversation-attachments'), request.content_ref);
    return { data_url: stored.data_url, mime_type: stored.mime_type };
  });
  ipcMain.handle(channels.workspaceAttachmentCopy, async (event, payload) => {
    assertBridgeEvent(event);
    const request = validateReadWorkspaceAttachment(payload);
    const stored = await readStoredImage(path.join(app.getPath('userData'), 'conversation-attachments'), request.content_ref);
    const image = nativeImage.createFromBuffer(Buffer.from(stored.bytes));
    if (image.isEmpty()) throw new Error('Attachment image is unavailable');
    clipboard.writeImage(image);
    const copied = clipboard.readImage();
    if (copied.isEmpty()) throw new Error('Attachment image was not copied');
    const size = copied.getSize();
    return { copied: true, width: size.width, height: size.height };
  });
  ipcMain.handle(channels.workspaceAttachmentSave, async (event, payload) => {
    assertBridgeEvent(event);
    const request = validateSaveWorkspaceAttachment(payload);
    const stored = await readStoredImage(path.join(app.getPath('userData'), 'conversation-attachments'), request.content_ref);
    let target = process.env.FIELORA_E2E_ATTACHMENT_SAVE_PATH ?? '';
    if (!target) {
      if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
      const selection = await dialog.showSaveDialog(appWindow, { title: '图片另存为', defaultPath: request.filename });
      if (selection.canceled || !selection.filePath) return { saved: false, canceled: true };
      target = selection.filePath;
    }
    await writeFile(target, stored.bytes);
    return { saved: true, canceled: false };
  });
  ipcMain.handle(channels.workspaceFileApply, async (event, payload) => {
    assertBridgeEvent(event); const request=validateApplyWorkspaceFile(payload);
    return workspaceRuntime.applyFile(await projectRoot(request.field_id), request);
  });
  ipcMain.handle(channels.workspaceEnvironment, async (event, payload) => {
    assertBridgeEvent(event); const request=validateWorkspaceProject(payload);
    return workspaceRuntime.getEnvironment(await projectRoot(request.field_id));
  });
  ipcMain.handle(channels.workspaceOpenTargets, async (event, payload) => {
    assertBridgeEvent(event); validateWorkspaceProject(payload);
    return workspaceOpenTargets();
  });
  ipcMain.handle(channels.workspaceOpenProject, async (event, payload) => {
    assertBridgeEvent(event);
    const request = validateOpenWorkspaceProject(payload);
    const root = await projectRoot(request.field_id);
    if (request.target === 'FILE_EXPLORER') {
      const error = await shell.openPath(root);
      if (error) throw new Error('无法在文件资源管理器中打开当前 Project');
      return null;
    }
    const executable = await findWorkspaceApplication(request.target);
    if (!executable && (request.target === 'VISUAL_STUDIO_CODE' || request.target === 'CURSOR') && await workspaceProtocolAvailable(request.target)) {
      const scheme = request.target === 'VISUAL_STUDIO_CODE' ? 'vscode' : 'cursor';
      await shell.openExternal(`${scheme}://file/${encodeURI(root.replaceAll('\\', '/'))}`);
      return null;
    }
    if (!executable) throw new Error('这个应用当前不可用');
    if (process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => execFile('/usr/bin/open', ['-a', executable, root], error => error ? reject(error) : resolve()));
      return null;
    }
    const child = spawn(executable, [root], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    return null;
  });
  ipcMain.handle(channels.workspaceTerminalRun, async (event, payload) => {
    assertBridgeEvent(event); const request=validateRunTerminal(payload);
    return workspaceRuntime.runTerminal(await projectRoot(request.field_id), request.field_id, request.command, request.working_directory);
  });
  ipcMain.handle(channels.workspaceTerminalCancel, (event, payload) => {
    assertBridgeEvent(event); const request=validateCancelTerminal(payload);
    workspaceRuntime.cancelTerminal(request.run_id); return null;
  });
  handle(channels.fieldCreate, validateCreate, 'command.field.create');
  ipcMain.handle(channels.fieldList, async (event) => {
    assertBridgeEvent(event);
    return supervisor.request('query.field.list');
  });
  handle(channels.fieldGet, validateReference, 'query.field.get');
  handle(channels.fieldUpdateFocus, validateFocus, 'command.field.update_focus');
  handle(channels.fieldUpdateMode, validateUpdateMode, 'command.field.update_mode');
  handle(channels.fieldSetFocusV1, validateSetFocusV1, 'command.field.set_focus_v1');
  handle(channels.fieldResumeV1, validateReference, 'query.field.resume_v1');
  handle(channels.stateCreate, validateCreateState, 'command.state.create');
  handle(channels.stateGet, validateStateReference, 'query.state.get');
  handle(channels.stateList, validateListStates, 'query.state.list');
  handle(channels.stateRevise, validateReviseState, 'command.state.revise');
  handle(channels.stateTransition, validateTransitionState, 'command.state.transition');
  handle(channels.stateSupersede, validateSupersedeState, 'command.state.supersede');
  handle(channels.referenceCreate, validateCreateReference, 'command.reference.create');
  handle(channels.referenceGet, validateObjectReference, 'query.reference.get');
  handle(channels.referenceList, validateListReferences, 'query.reference.list');
  handle(channels.referenceRevise, validateReviseReference, 'command.reference.revise');
  handle(channels.referenceArchive, validateArchiveReference, 'command.reference.archive');
  handle(channels.referenceRestore, validateRestoreReference, 'command.reference.restore');
  handle(channels.relationAttachReferenceSource, validateAttachReferenceSource, 'command.relation.attach_reference_source');
  handle(channels.relationRetractReferenceSource, validateRetractReferenceSource, 'command.relation.retract_reference_source');
  handle(channels.relationList, validateListRelations, 'query.relation.list');
  handle(channels.activityList, validateListActivities, 'query.activity.list');
  handle(channels.surfaceSaveSnapshot, validateSnapshot, 'command.surface.save_snapshot');
  handle(channels.surfaceSaveSnapshotV1, validateSnapshotV1, 'command.surface.save_snapshot_v1');
  handle(channels.surfaceLatestSnapshot, validateReference, 'query.surface.latest_snapshot');
  ipcMain.handle(channels.clipboardWriteText, (event, payload) => {
    assertBridgeEvent(event);
    clipboard.writeText(validateClipboardText(payload));
  });
  handle(channels.providerCreate, validateCreateProvider, 'command.provider.create_config');
  handle(channels.providerUpdate, validateUpdateProvider, 'command.provider.update_config');
  handle(channels.providerStoreCredential, validateStoreCredential, 'command.provider.store_credential');
  handle(channels.providerDeleteCredential, validateProviderReference, 'command.provider.delete_credential');
  handle(channels.providerRemove, validateProviderReference, 'command.provider.remove_config');
  handle(channels.providerRuntimeUpdate, validateUpdateModelRuntime, 'command.provider.update_model_runtime');
  handle(channels.providerPrepareSend, validatePrepareProviderSend, 'command.provider.prepare_send');
  handle(channels.providerValidate, validateProviderReference, 'command.provider.validate_model');
  handle(channels.providerProbe, validateProviderReference, 'command.provider.probe');
  ipcMain.handle(channels.providerCatalog, (event) => { assertBridgeEvent(event); return supervisor.request('query.provider.catalog'); });
  ipcMain.handle(channels.providerList, (event) => { assertBridgeEvent(event); return supervisor.request('query.provider.list_configs'); });
  handle(channels.providerGet, validateProviderReference, 'query.provider.get_config');
  ipcMain.handle(channels.modelStart, async (event, payload) => {
    assertBridgeEvent(event);
    return durableMutation(async () => {
    const request=validateStartModel(payload);
    if(request.context_package.some((chip)=>chip.kind==='CURRENT_PAGE'||chip.kind==='CURRENT_SELECTION')){
      const candidate=await browser().getContextCandidate();
      request.context_package=request.context_package.map((chip)=>{
        if(chip.kind!=='CURRENT_PAGE'&&chip.kind!=='CURRENT_SELECTION')return chip;
        if(chip.source_identity!==candidate.page_id||chip.source_revision_or_navigation_generation!==String(candidate.navigation_generation))throw new Error('Browse context became stale');
        if(chip.kind==='CURRENT_SELECTION'&&!candidate.selection_text)throw new Error('Browse selection became stale');
        return {...chip,display_label:chip.kind==='CURRENT_SELECTION'?'Current selection':(candidate.title||candidate.url),content:chip.kind==='CURRENT_SELECTION'?candidate.selection_text:`${candidate.url}\n\n${candidate.page_text}`,completeness:chip.kind==='CURRENT_SELECTION'||!candidate.is_partial?'COMPLETE':'PARTIAL'};
      });
    }
      return supervisor.request('command.model.start',request);
    });
  });
  handle(channels.modelCancel, validateCancelModel, 'command.model.cancel');
  handle(channels.agentStart, validateStartAgent, 'command.agent.start');
  handle(channels.agentGet, validateAgentRun, 'query.agent.get');
  handle(channels.agentList, validateListAgentRuns, 'query.agent.list');
  handle(channels.agentUsage, validateModelUsageReport, 'query.agent.usage');
  handle(channels.agentEvents, validateListAgentEvents, 'query.agent.events');
  handle(channels.agentToolCalls, validateAgentRun, 'query.agent.tool_calls');
  handle(channels.agentCancel, validateAgentRun, 'command.agent.cancel');
  handle(channels.agentPause, validateAgentRun, 'command.agent.pause');
  handle(channels.agentResume, validateResumeAgent, 'command.agent.resume');
  handle(channels.agentResolveApproval, validateResolveAgentApproval, 'command.agent.resolve_approval');
  ipcMain.handle(channels.agentMcpConnections, (event) => { assertBridgeEvent(event); return supervisor.request('query.agent.mcp_connections'); });
  handle(channels.agentMcpRuntime, validateAgentRun, 'query.agent.mcp_runtime');
  handle(channels.agentActivateMcpConnection, validateActivateMcpConnection, 'command.agent.activate_mcp_connection');
  handle(channels.agentSkillCatalog, validateSkillCatalog, 'query.agent.skill_catalog');
  ipcMain.handle(channels.pluginLocalRegistry, (event) => { assertBridgeEvent(event); return supervisor.request('query.plugin.local_registry'); });
  handle(channels.pluginRegisterLocal, validateRegisterLocalPlugin, 'command.plugin.register_local');
  handle(channels.pluginUnregisterLocal, validateUnregisterLocalPlugin, 'command.plugin.unregister_local');
  handle(channels.captureCreate, validateCreateCapture, 'command.capture.create');
  handle(channels.captureAttach, validateAttachCapture, 'command.capture.attach');
  handle(channels.capturePromote, validatePromoteCapture, 'command.capture.promote');
  handle(channels.captureArchive, validateMutateCapture, 'command.capture.archive');
  handle(channels.captureRestore, validateMutateCapture, 'command.capture.restore');
  handle(channels.captureList, validateListCaptures, 'query.capture.list');
  handle(channels.captureGet, validateCaptureReference, 'query.capture.get');
  ipcMain.handle(channels.fontsList, (event) => { assertBridgeEvent(event); return supervisor.request('query.fonts.list', {}); });
  ipcMain.handle(channels.fontsImport, async (event) => {
    assertBridgeEvent(event);
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    const selection = process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_FONT_PATHS
      ? { canceled: false, filePaths: JSON.parse(process.env.FIELORA_E2E_FONT_PATHS) as string[] }
      : await dialog.showOpenDialog(appWindow, { title: '安装字体到当前用户', properties: ['openFile', 'multiSelections'], filters: [{ name: '字体', extensions: ['ttf', 'otf', 'ttc'] }] });
    if (selection.canceled) return { canceled: true, installed: [], errors: [] };
    if (!Array.isArray(selection.filePaths) || selection.filePaths.length > 32 || selection.filePaths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('Invalid font selection');
    const installed = []; const errors = [];
    for (const source of selection.filePaths) {
      try { installed.push(await supervisor.request('command.fonts.import', { path: source })); }
      catch { errors.push({ filename: path.basename(source), message: '安装失败：请检查字体格式、文件完整性或目录权限。' }); }
    }
    return { canceled: false, installed, errors };
  });
  ipcMain.handle(channels.libraryAddFiles, async (event) => {
    assertBridgeEvent(event);
    return durableMutation(async () => {
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    const selection = process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_LIBRARY_PATHS
      ? { canceled: false, filePaths: JSON.parse(process.env.FIELORA_E2E_LIBRARY_PATHS) as string[] }
      : await dialog.showOpenDialog(appWindow, { title: '添加到资料库', properties: ['openFile', 'multiSelections'] });
    if (selection.canceled) return [];
    if (!Array.isArray(selection.filePaths) || selection.filePaths.some((item) => typeof item !== 'string')) throw new Error('Invalid Library fixture paths');
    const created: LibraryObjectView[] = [];
    for (const selected of selection.filePaths) {
      const source = path.resolve(selected);
      const blob = await storage().importFile(source);
      const classification = libraryFileClassification(path.basename(source));
      created.push(await supervisor.request('command.library.create_file', {
        title: path.basename(source),
        original_source: source,
        original_filename: path.basename(source),
        mime_type: classification.mime_type,
        media_kind: classification.media_kind,
        size: blob.size,
        blob_ref: blob.blob_ref,
        content_hash: blob.content_hash,
        metadata: { version: 1 },
      }) as LibraryObjectView);
    }
      return created;
    });
  });
  ipcMain.handle(channels.librarySaveWeb, async (event, payload) => {
    assertBridgeEvent(event);
    return durableMutation(async () => {
    const requested = validateSaveWebLibrary(payload);
    const current = await browser().getContextCandidate();
    if (current.page_id === null || current.url !== requested.url) throw new Error('Browse page changed before it could be saved');
      return supervisor.request('command.library.save_web', {
      url: current.url,
      title: current.title || requested.title || current.url,
      source: 'BROWSER',
      selected_content: current.selection_text || null,
      metadata: { version: 1, snapshot_available: false },
      });
    });
  });
  ipcMain.handle(channels.libraryList, (event, payload) => { assertBridgeEvent(event); return supervisor.request('query.library.list', validateListLibraryObjects(payload)); });
  ipcMain.handle(channels.libraryGet, (event, payload) => { assertBridgeEvent(event); return supervisor.request('query.library.get', validateLibraryObject(payload)); });
  ipcMain.handle(channels.libraryPreviewImage, async (event, payload): Promise<LibraryImagePreviewView> => {
    assertBridgeEvent(event);
    const object = await supervisor.request('query.library.get', validateLibraryObject(payload)) as LibraryObjectView;
    if (object.lifecycle !== 'ACTIVE' || object.kind !== 'FILE' || object.media_kind !== 'IMAGE'
      || !object.blob_ref || !object.content_hash || !object.size
      || !['image/png', 'image/jpeg', 'image/webp'].includes(object.mime_type ?? '')) {
      throw new Error('Library image is unavailable');
    }
    const bytes = await storage().readVerifiedBlob(object.blob_ref, object.content_hash, 8 * 1024 * 1024);
    const detectedMime = detectSafeRasterMime(bytes);
    if (!detectedMime || bytes.byteLength !== object.size || detectedMime !== object.mime_type) throw new Error('Library image integrity check failed');
    return {
      library_object_id: object.id,
      source: 'LIBRARY',
      title: object.title,
      mime_type: detectedMime,
      size: bytes.byteLength,
      content_hash: object.content_hash,
      data_url: `data:${detectedMime};base64,${Buffer.from(bytes).toString('base64')}`,
    };
  });
  ipcMain.handle(channels.libraryDelete, (event, payload) => { assertBridgeEvent(event); return durableMutation(() => supervisor.request('command.library.delete', validateDeleteLibraryObject(payload))); });
  ipcMain.handle(channels.libraryOpen, async (event, payload) => {
    assertBridgeEvent(event);
    const request = validateLibraryObject(payload);
    const object = await supervisor.request('query.library.get', request) as LibraryObjectView;
    if (object.lifecycle !== 'ACTIVE') throw new Error('Library object is deleted');
    if (object.kind === 'WEB' && object.original_source) { await browser().navigate(object.original_source); return null; }
    if (!object.blob_ref || !object.content_hash) throw new Error('Library blob is unavailable');
    const blob = storage().resolveBlob(object.blob_ref);
    if (await sha256File(blob) !== object.content_hash) throw new Error('Library blob integrity check failed');
    const message = await shell.openPath(blob);
    if (message) throw new Error('Library file could not be opened');
    return null;
  });
  ipcMain.handle(channels.libraryReveal, async (event, payload) => {
    assertBridgeEvent(event);
    const object = await supervisor.request('query.library.get', validateLibraryObject(payload)) as LibraryObjectView;
    if (!object.blob_ref) return null;
    const blob = storage().resolveBlob(object.blob_ref);
    await access(blob);
    shell.showItemInFolder(blob);
    return null;
  });
  ipcMain.handle(channels.storageInfo, (event) => { assertBridgeEvent(event); return storage().info(); });
  ipcMain.handle(channels.storageOpen, async (event, payload) => {
    assertBridgeEvent(event);
    const allowed = new Set(['DATA_ROOT', 'LIBRARY_ROOT', 'CACHE_ROOT', 'MAIN_DATABASE', 'AGENT_LEDGER', 'LIBRARY_BLOBS', 'SQLITE_WAL', 'SQLITE_SHM', 'VECTOR_INDEX', 'SEARCH_INDEX', 'INTERNAL_INDEX', 'CACHE']);
    if (typeof payload !== 'string' || !allowed.has(payload)) throw new Error('Invalid storage location');
    const target = await storage().openablePath(payload as never);
    if (!target) throw new Error('Storage location is not present');
    if ((await stat(target)).isFile()) { shell.showItemInFolder(target); return null; }
    const message = await shell.openPath(target);
    if (message) throw new Error('Storage location could not be opened');
    return null;
  });
  ipcMain.handle(channels.storageClearCache, async (event) => {
    assertBridgeEvent(event);
    return { removed_bytes: await storage().clearCache() };
  });
  ipcMain.handle(channels.storageMigrateData, async (event) => {
    assertBridgeEvent(event);
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    const selection = process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_DATA_ROOT_TARGET
      ? { canceled: false, filePaths: [path.resolve(process.env.FIELORA_E2E_DATA_ROOT_TARGET)] }
      : await dialog.showOpenDialog(appWindow, { title: '选择新的 Fielora DataRoot', properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || selection.filePaths.length !== 1) return { canceled: true, root: null };
    await beginStorageMaintenance();
    const previous = storage().current();
    try {
      await supervisor.shutdown();
      const root = await storage().migrateClosedDataRoot(path.resolve(selection.filePaths[0]!), (database) => supervisor.runMaintenance(['--maintenance-validate-database', database]));
      await supervisor.start();
      return { canceled: false, root };
    } catch (error) {
      if (storage().current().data_root !== previous.data_root) await storage().restoreRoots(previous);
      await supervisor.start();
      throw error;
    } finally { endStorageMaintenance(); }
  });
  ipcMain.handle(channels.storageMigrateLibrary, async (event) => {
    assertBridgeEvent(event);
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    const selection = process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_LIBRARY_ROOT_TARGET
      ? { canceled: false, filePaths: [path.resolve(process.env.FIELORA_E2E_LIBRARY_ROOT_TARGET)] }
      : await dialog.showOpenDialog(appWindow, { title: '选择新的 LibraryRoot', properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || selection.filePaths.length !== 1) return { canceled: true, root: null };
    await beginStorageMaintenance();
    try {
      const root = await storage().migrateLibraryRoot(path.resolve(selection.filePaths[0]!));
      return { canceled: false, root };
    } finally { endStorageMaintenance(); }
  });
  ipcMain.handle(channels.profileGet, (event) => { assertBridgeEvent(event); return supervisor.request('query.profile.get'); });
  ipcMain.handle(channels.profileExport, async (event, payload) => {
    assertBridgeEvent(event);
    if (!payload || typeof payload !== 'object' || Object.keys(payload).sort().join(',') !== 'include_library,preferences' || typeof (payload as { include_library?: unknown }).include_library !== 'boolean') throw new Error('Invalid profile export options');
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    const includeLibrary = (payload as { include_library: boolean }).include_library;
    const preferences = normalizeAppPreferences((payload as { preferences?: unknown }).preferences);
    const profile = await supervisor.request('query.profile.get') as ProfileView;
    const portableBlobs = includeLibrary
      ? await supervisor.request('query.profile.portable_blob_manifest') as PortableBlobManifestEntryView[]
      : [];
    const selection = process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_PROFILE_EXPORT_TARGET
      ? { canceled: false, filePath: path.resolve(process.env.FIELORA_E2E_PROFILE_EXPORT_TARGET) }
      : await dialog.showSaveDialog(appWindow, { title: '导出 Fielora', defaultPath: `Fielora-${new Date().toISOString().slice(0, 10)}.fielora`, filters: [{ name: 'Fielora Profile', extensions: ['fielora'] }] });
    if (selection.canceled || !selection.filePath) return { canceled: true, path: null };
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'fielora-profile-export-'));
    try { await beginStorageMaintenance(); }
    catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
    let restart = false;
    try {
      await supervisor.shutdown(); restart = true;
      const snapshot = path.join(temporary, 'profile.sqlite');
      const preferencesFile = path.join(temporary, 'app-preferences.json');
      await supervisor.runMaintenance(['--maintenance-export-snapshot', storage().databasePath(), snapshot]);
      await writeFile(preferencesFile, `${JSON.stringify(preferences)}\n`, { flag: 'wx' });
      const files: PortableInputFile[] = [
        { archive_path: 'data/profile.sqlite', source_path: snapshot },
        { archive_path: 'data/app-preferences.json', source_path: preferencesFile },
      ];
      if (includeLibrary) {
        files.push(...await portableLibraryInputs(storage().current().library_root, portableBlobs));
      }
      await createPortableProfile(selection.filePath, {
        profile_id: profile.profile_id,
        profile_schema_version: profile.schema_version,
        fielora_version: app.getVersion(),
        source_os: process.platform,
        included_sections: ['PROFILE', 'SETTINGS', 'PROJECT_METADATA', 'CONVERSATIONS', 'AGENT_HISTORY', 'LIBRARY_METADATA'],
        library_mode: includeLibrary ? 'INCLUDE_BLOBS' : 'METADATA_ONLY',
      }, files);
      return { canceled: false, path: selection.filePath };
    } catch (error) {
      await rm(selection.filePath, { force: true });
      throw error;
    } finally {
      try {
        await rm(temporary, { recursive: true, force: true });
        if (restart) await supervisor.start();
      } finally { endStorageMaintenance(); }
    }
  });
  ipcMain.handle(channels.profileImport, async (event) => {
    assertBridgeEvent(event);
    if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
    const selection = process.env.FIELORA_E2E === '1' && process.env.FIELORA_E2E_PROFILE_IMPORT_SOURCE
      ? { canceled: false, filePaths: [path.resolve(process.env.FIELORA_E2E_PROFILE_IMPORT_SOURCE)] }
      : await dialog.showOpenDialog(appWindow, { title: '导入 Fielora', properties: ['openFile'], filters: [{ name: 'Fielora Profile', extensions: ['fielora'] }] });
    if (selection.canceled || selection.filePaths.length !== 1) return { canceled: true, profile_id: null, preferences: null };
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'fielora-profile-import-'));
    try { await beginStorageMaintenance(); }
    catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
    let backup: string | null = null;
    let stopped = false;
    try {
      const manifest = await extractPortableProfile(selection.filePaths[0]!, temporary);
      const database = path.join(temporary, 'data', 'profile.sqlite');
      const preferencesPath = path.join(temporary, 'data', 'app-preferences.json');
      let preferences = null;
      try { preferences = normalizeAppPreferences(JSON.parse(await readFile(preferencesPath, 'utf8'))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await supervisor.runMaintenance(['--maintenance-validate-database', database]);
      await supervisor.shutdown(); stopped = true;
      backup = await storage().installImportedDatabase(database);
      await importPortableBlobs(temporary);
      await supervisor.start(); stopped = false;
      const restored = await supervisor.request('query.profile.get') as ProfileView;
      if (restored.profile_id !== manifest.profile_id) throw new Error('Portable profile identity mismatch');
      return { canceled: false, profile_id: restored.profile_id, preferences };
    } catch (error) {
      if (!stopped) { await supervisor.shutdown(); stopped = true; }
      if (backup) await storage().rollbackImportedDatabase(backup);
      throw error;
    } finally {
      try {
        await rm(temporary, { recursive: true, force: true });
        if (stopped) await supervisor.start();
      } finally { endStorageMaintenance(); }
    }
  });
  ipcMain.handle(channels.browserShow, (event, payload) => { assertBridgeEvent(event); return browser().show(validateBrowserBounds(payload)); });
  ipcMain.handle(channels.browserHide, (event) => { assertBridgeEvent(event); return browser().hide(); });
  ipcMain.handle(channels.browserCreatePage, (event) => { assertBridgeEvent(event); return browser().createPage(); });
  ipcMain.handle(channels.browserSwitchPage, (event, payload) => { assertBridgeEvent(event); return browser().switchPage(validateBrowserPageRequest(payload).page_id); });
  ipcMain.handle(channels.browserClosePage, (event, payload) => { assertBridgeEvent(event); return browser().closePage(validateBrowserPageRequest(payload).page_id); });
  ipcMain.handle(channels.browserShowPageContextMenu, (event, payload) => { assertBridgeEvent(event); return browser().showPageContextMenu(validateBrowserPageRequest(payload).page_id); });
  ipcMain.handle(channels.browserNavigate, (event, payload) => { assertBridgeEvent(event); return browser().navigate(validateBrowserNavigate(payload).url); });
  ipcMain.handle(channels.browserBack, (event) => { assertBridgeEvent(event); return browser().back(); });
  ipcMain.handle(channels.browserForward, (event) => { assertBridgeEvent(event); return browser().forward(); });
  ipcMain.handle(channels.browserReload, (event) => { assertBridgeEvent(event); return browser().reload(); });
  ipcMain.handle(channels.browserState, (event) => { assertBridgeEvent(event); return browser().getState(); });
  ipcMain.handle(channels.browserContext, (event) => { assertBridgeEvent(event); return browser().getContextCandidate(); });
  ipcMain.handle(channels.browserCaptureScreenshot, async (event): Promise<ScreenshotEvidenceView> => {
    assertBridgeEvent(event);
    return durableMutation(async () => {
      const capture = await browser().captureCurrentViewport();
      return supervisor.request('command.screenshot_evidence.create', {
        ...capture,
        conversation_id: null,
        run_id: null,
        tool_call_id: null,
        verification_receipt_id: null,
      }) as Promise<ScreenshotEvidenceView>;
    });
  });
  handle(channels.screenshotGet, validateScreenshotEvidence, 'query.screenshot_evidence.get');
  handle(channels.screenshotByRun, validateScreenshotEvidenceByRun, 'query.screenshot_evidence.by_run');
  handle(channels.screenshotByVerification, validateScreenshotEvidenceByVerification, 'query.screenshot_evidence.by_verification');
  handle(channels.screenshotPreview, validateScreenshotEvidencePreview, 'query.screenshot_evidence.preview');
  ipcMain.handle(channels.coreHealth, (event) => { assertBridgeEvent(event); return supervisor.getHealth(); });
  ipcMain.handle(channels.coreBuildProvenance, (event) => { assertBridgeEvent(event); return supervisor.request('query.system.build_provenance'); });
  ipcMain.handle(channels.coreRetry, async (event) => { assertBridgeEvent(event); await supervisor.retry(); });
  ipcMain.handle(channels.coreOpenLogs, async (event) => {
    assertBridgeEvent(event);
    await shell.openPath(path.join(storage().base_root, 'logs'));
  });
  ipcMain.handle(channels.coreQuit, (event) => { assertBridgeEvent(event); app.quit(); });
  if (process.env.FIELORA_E2E === '1') {
    ipcMain.handle(channels.testKillCore, (event) => { assertBridgeEvent(event); supervisor.killForTest(); });
    ipcMain.handle(channels.testResizeWindow, (event, payload: unknown) => {
      assertBridgeEvent(event);
      if (!payload || typeof payload !== 'object') throw new Error('Window size must be an object');
      if (Object.keys(payload).sort().join(',') !== 'height,width') throw new Error('Window size has unexpected fields');
      const { width, height } = payload as Record<string, unknown>;
      if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) < 900 || Number(width) > 2400 || Number(height) < 620 || Number(height) > 1600) {
        throw new Error('Window size is outside the E2E range');
      }
      if (!appWindow || appWindow.isDestroyed()) throw new Error('App window is unavailable');
      appWindow.setSize(Number(width), Number(height));
      const bounds = appWindow.getBounds();
      return { width: bounds.width, height: bounds.height };
    });
    ipcMain.handle(channels.testCreateProject, (event, payload) => {
      assertBridgeEvent(event);
      return supervisor.request('command.project.create', validateCreateProject(payload));
    });
  }
}

async function registerApplicationProtocol(): Promise<void> {
  protocol.handle('fielora', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    let relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (relative.startsWith('main_window/')) relative = relative.slice('main_window/'.length);
    if (relative.includes('..') || path.isAbsolute(relative)) return new Response('Not found', { status: 404 });
    const rendererRoot = path.join(app.getAppPath(), '.webpack', 'renderer', 'main_window');
    try {
      const bytes = await readFile(path.join(rendererRoot, relative));
      const type = relative.endsWith('.html') ? 'text/html; charset=utf-8'
        : relative.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : relative.endsWith('.css') ? 'text/css; charset=utf-8'
            : relative.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
      return new Response(bytes, {
        headers: {
          'Content-Type': type,
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function createWindow(): Promise<void> {
  // Native sidebar material follows the app's light-only appearance as well.
  nativeTheme.themeSource = 'light';
  trustedOrigin = trustedOriginFor(app.isPackaged, MAIN_WINDOW_WEBPACK_ENTRY);
  const initialSurface = windowSurfaceColors('LIGHT');
  const window = new BrowserWindow({
    width: 1180,
    height: 560,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: initialSurface.background,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 15 } }
      : { titleBarOverlay: { color: initialSurface.background, symbolColor: initialSurface.symbols, height: initialSurface.height } }),
    show: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  appWindow = window;
  if (process.platform !== 'darwin') window.removeMenu();
  browserRuntime = new BrowserRuntime(window, (state) => {
    withUsableWindow(appWindow, (current) => current.webContents.send(channels.browserEvent, state));
  }, !app.isPackaged || process.env.FIELORA_E2E === '1');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('context-menu', (_event, params) => showTrustedEditContextMenu(params));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, trustedOrigin)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, trustedOrigin)) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.once('ready-to-show', () => withUsableWindow(window, (current) => current.show()));
  window.on('close', () => {
    if (appWindow !== window) return;
    appWindow = undefined;
    const runtime = browserRuntime;
    browserRuntime = undefined;
    runtime?.destroy();
  });
  window.on('closed', () => {
    if (appWindow === window) appWindow = undefined;
  });
  if (app.isPackaged) await window.loadURL('fielora://app/index.html');
  else await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

// E2E instances use isolated LOCALAPPDATA roots and must be able to run while a
// user is reviewing a packaged build. Production still keeps the single-instance invariant.
const singleInstance = process.env.FIELORA_E2E === '1' || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => { focusUsableWindow(appWindow); });
  app.whenReady().then(async () => {
    await prepareMacEnvironment();
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    const localAppData = process.platform === 'darwin' ? app.getPath('appData') : process.env.LOCALAPPDATA;
    if (!localAppData) throw new Error('Platform application data directory is unavailable');
    const developmentRoot = (!app.isPackaged || process.env.FIELORA_E2E === '1') ? process.env.FIELORA_DATA_DIR : undefined;
    storageManager = await StorageManager.open(localAppData, developmentRoot);
    scheduledTaskService = await ScheduledTaskService.open(path.join(app.getPath('userData'), 'scheduled-tasks.json'), executeScheduledTask);
    registerBridgeHandlers();
    if (app.isPackaged) await registerApplicationProtocol();
    supervisor.on('notification', (message) => {
      if (message.method === 'host.browser.execute') { agentBrowserHost.handle(message.params); return; }
      if (message.method === 'host.browser.cancel') { agentBrowserHost.cancel(message.params.request_id); return; }
      withUsableWindow(appWindow, (window) => window.webContents.send(channels.coreEvent, (message as { params: unknown }).params));
    });
    supervisor.on('health', (payload) => {
      if (payload.state !== 'READY') agentBrowserHost.reset();
      withUsableWindow(appWindow, (window) => window.webContents.send(channels.coreEvent, { event: 'event.core.health', ...payload }));
    });
    // Resolve the initial handshake before the renderer's first data request.
    await supervisor.start().catch((error) => console.error('Core startup failed', error));
    await createWindow();
    if (supervisor.getHealth().state === 'READY') scheduledTaskService?.start();
  });
}

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  scheduledTaskService?.stop();
  void supervisor.shutdown().finally(() => {
    workspaceRuntime.dispose();
    browserRuntime?.destroy();
    browserRuntime = undefined;
    app.exit(0);
  });
});

app.on('window-all-closed', () => app.quit());
