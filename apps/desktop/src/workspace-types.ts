export interface PickProjectRequest {
  title: string;
  goal: string | null;
}

export interface WorkspaceProjectRequest {
  field_id: string;
}

export type WorkspaceProjectOpenTarget =
  | 'FILE_EXPLORER'
  | 'VISUAL_STUDIO_CODE'
  | 'CURSOR'
  | 'VISUAL_STUDIO'
  | 'GIT_BASH'
  | 'INTELLIJ_IDEA'
  | 'PYCHARM'
  | 'WEBSTORM';

export interface OpenWorkspaceProjectRequest extends WorkspaceProjectRequest {
  target: WorkspaceProjectOpenTarget;
}

export interface WorkspaceProjectOpenTargetView {
  target: WorkspaceProjectOpenTarget;
  label: string;
  icon_data_url: string | null;
}

export interface WorkspaceFileEntry {
  relative_path: string;
  size: number;
}

export interface WorkspaceFileRequest extends WorkspaceProjectRequest {
  relative_path: string;
}

export interface WorkspaceFileView extends WorkspaceFileEntry {
  content: string;
  sha256: string;
}

export interface PrototypePreviewRequest extends WorkspaceFileRequest {
  expected_sha256: string;
}

export interface PrototypePreviewView extends WorkspaceFileEntry {
  url: string;
  sha256: string;
}

export interface ReleasePrototypeRequest { url: string; }

export interface WorkspaceImagePreview extends WorkspaceFileEntry {
  kind: 'IMAGE';
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  data_url: string;
}

export interface LibraryImagePreviewView {
  library_object_id: string;
  source: 'LIBRARY';
  title: string;
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
  content_hash: string;
  data_url: string;
}

export type ScreenshotImagePreviewView = Omit<ScreenshotEvidencePreviewView, 'source'> & { source: 'SCREENSHOT_EVIDENCE' };
export type ResultImagePreviewView = LibraryImagePreviewView | ScreenshotImagePreviewView;

export type WorkspaceAttachmentStatus = 'READY' | 'UNSUPPORTED' | 'TOO_LARGE';
export type WorkspaceAttachmentSource = 'clipboard' | 'file_picker' | 'drag_drop' | 'library';

export interface WorkspaceAttachmentView {
  id: string;
  name: string;
  size: number;
  kind: 'TEXT' | 'IMAGE';
  mime_type: string;
  status: WorkspaceAttachmentStatus;
  content: string | null;
  data_url: string | null;
  sha256: string | null;
  reason: string | null;
  width: number | null;
  height: number | null;
  source: WorkspaceAttachmentSource;
  content_ref: string | null;
}

export interface WorkspaceAttachmentSelection {
  attachments: WorkspaceAttachmentView[];
  truncated_count: number;
}

export interface StoreWorkspaceAttachmentRequest {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  data_url: string;
  width: number;
  height: number;
  source: WorkspaceAttachmentSource;
}

export interface ReadWorkspaceAttachmentRequest { content_ref: string; }

export interface CopyWorkspaceAttachmentResult { copied: boolean; width: number; height: number; }

export interface SaveWorkspaceAttachmentRequest { content_ref: string; filename: string; }

export interface SaveWorkspaceAttachmentResult { saved: boolean; canceled: boolean; }

export interface WorkspaceEnvironmentView {
  is_git_repository: boolean;
  branch: string | null;
  upstream: string | null;
  changed_files: number;
  ahead: number;
  behind: number;
}

export interface ApplyWorkspaceFileRequest extends WorkspaceFileRequest {
  expected_sha256: string;
  content: string;
}

export interface RunTerminalRequest extends WorkspaceProjectRequest {
  command: string;
  working_directory: string;
}

export interface CancelTerminalRequest {
  run_id: string;
}

export interface TerminalRunResult {
  run_id: string;
  working_directory: string | null;
}

export type TerminalEventKind = 'STARTED' | 'OUTPUT' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

export interface TerminalEvent {
  event: 'event.workspace.terminal';
  run_id: string;
  field_id: string;
  kind: TerminalEventKind;
  stream: 'STDOUT' | 'STDERR' | null;
  text: string | null;
  exit_code: number | null;
}
import type { ScreenshotEvidencePreviewView } from '@fielora/contracts';
