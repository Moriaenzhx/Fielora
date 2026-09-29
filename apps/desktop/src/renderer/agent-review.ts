import type { AgentToolCallView, FileArtifactRevisionReviewView } from '@fielora/contracts';

export interface AgentReviewFile {
  path: string;
  previousPath: string | null;
  changeType: 'CREATE' | 'MODIFY' | 'DELETE' | 'RENAME';
  additions: number;
  deletions: number;
  diff: string;
  changes: AgentReviewChange[];
  state: 'PROPOSED' | 'APPLIED';
  artifactId?: string;
  revisionId?: string;
  reviewState?: 'UNREVIEWED' | 'REVIEWED';
  applicability?: 'CURRENT' | 'CHANGED_SINCE';
  undoAvailability?: 'AVAILABLE' | 'BLOCKED_CHANGED_SINCE' | 'DEFERRED_OPERATION' | 'CONTENT_UNAVAILABLE';
  verificationCount?: number;
}

export interface AgentReviewChange {
  before: string | null;
  after: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface AgentReviewSummary {
  files: AgentReviewFile[];
  additions: number;
  deletions: number;
  state: 'PROPOSED' | 'APPLIED' | 'EMPTY';
}

export type AgentReviewDisplay = 'SEMANTIC' | 'STRUCTURED' | 'RAW';

export function semanticReviewLabel(change: AgentReviewChange): string | null {
  if (change.before === null) return null;
  const before = change.before.trim();
  const after = change.after.trim();
  const beforeAssignment = before.match(/^([^=\s]+)\s*=\s*([^;\r\n]+);?$/);
  const afterAssignment = after.match(/^([^=\s]+)\s*=\s*([^;\r\n]+);?$/);
  if (beforeAssignment && afterAssignment && beforeAssignment[1] === afterAssignment[1]) {
    return `${beforeAssignment[1]}：${beforeAssignment[2]!.trim()} → ${afterAssignment[2]!.trim()}`;
  }
  if (/\brequired\b/u.test(before) && !/\brequired\b/u.test(after)) return 'required → removed';
  return null;
}

export function reviewDisplayFor(file: AgentReviewFile): AgentReviewDisplay {
  if (file.changeType === 'CREATE') return file.changes.some((change) => change.after.length > 0) ? 'STRUCTURED' : 'RAW';
  if (file.changeType === 'RENAME') return file.previousPath ? 'STRUCTURED' : 'RAW';
  if (file.changeType === 'DELETE') return file.changes.some((change) => change.before !== null) ? 'STRUCTURED' : 'RAW';
  if (file.changes.length === 0 || file.changes.some((change) => change.before === null)) return 'RAW';
  return file.changes.every((change) => semanticReviewLabel(change) !== null) ? 'SEMANTIC' : 'STRUCTURED';
}

function textLines(value: string): number {
  return value ? value.split(/\r?\n/).length : 0;
}

function reviewFragment(path: string, before: string, after: string): string {
  const lines = [before ? `--- a/${path}` : '--- /dev/null', `+++ b/${path}`];
  for (const line of before.split(/\r?\n/).filter((value) => value.length > 0)) lines.push(`-${line}`);
  for (const line of after.split(/\r?\n/).filter((value) => value.length > 0)) lines.push(`+${line}`);
  return lines.join('\n');
}

function durableReviewFragment(path: string, before: string, after: string): { diff: string; additions: number; deletions: number; changes: AgentReviewChange[] } {
  const beforeLines = before === '' ? [] : before.split(/\r?\n/);
  const afterLines = after === '' ? [] : after.split(/\r?\n/);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - suffix - 1] === afterLines[afterLines.length - suffix - 1]) suffix += 1;
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const lines = [before ? `--- a/${path}` : '--- /dev/null', after ? `+++ b/${path}` : '+++ /dev/null'];
  if (removed.length > 0 || added.length > 0) {
    const leading = beforeLines.slice(Math.max(0, prefix - 3), prefix);
    const trailing = beforeLines.slice(beforeLines.length - suffix, beforeLines.length - suffix + Math.min(3, suffix));
    const start = prefix - leading.length + 1;
    lines.push(`@@ -${start},${leading.length + removed.length + trailing.length} +${start},${leading.length + added.length + trailing.length} @@`);
    lines.push(...leading.map((line) => ` ${line}`));
    lines.push(...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`));
    lines.push(...trailing.map((line) => ` ${line}`));
  }
  return {
    diff: lines.join('\n'), additions: added.length, deletions: removed.length,
    changes: removed.length > 0 || added.length > 0 ? [{ before: removed.join('\n'), after: added.join('\n') }] : [],
  };
}

export function buildDurableAgentReview(revisions: readonly FileArtifactRevisionReviewView[]): AgentReviewSummary {
  const byArtifact = new Map<string, FileArtifactRevisionReviewView[]>();
  for (const revision of revisions) {
    const items = byArtifact.get(revision.artifact_id) ?? [];
    items.push(revision);
    byArtifact.set(revision.artifact_id, items);
  }
  const files: AgentReviewFile[] = [];
  for (const items of byArtifact.values()) {
    items.sort((left, right) => left.sequence - right.sequence || left.revision_id.localeCompare(right.revision_id));
    const first = items[0]!;
    const last = items.at(-1)!;
    const path = last.after.relative_path;
    const before = first.before.exists ? first.before_text : '';
    const after = last.after.exists ? last.after_text : '';
    const review = before !== null && after !== null
      ? durableReviewFragment(path, before ?? '', after ?? '')
      : { diff: `--- a/${path}\n+++ b/${path}\nBinary or unavailable durable content`, additions: 0, deletions: 0, changes: [] };
    const changeType: AgentReviewFile['changeType'] = !first.before.exists && last.after.exists
      ? 'CREATE' : first.before.exists && !last.after.exists ? 'DELETE' : 'MODIFY';
    files.push({
      path, previousPath: null, changeType, ...review, state: 'APPLIED',
      artifactId: last.artifact_id,
      revisionId: last.revision_id,
      reviewState: last.review_state,
      applicability: last.applicability,
      undoAvailability: last.undo_availability,
      verificationCount: last.verifications.length,
    });
  }
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    state: files.length > 0 ? 'APPLIED' : 'EMPTY',
  };
}

function replacementDiff(path: string, replacements: unknown[]): { diff: string; additions: number; deletions: number; changes: AgentReviewChange[] } {
  const fragments: string[] = [];
  const changes: AgentReviewChange[] = [];
  let additions = 0;
  let deletions = 0;
  for (const replacement of replacements) {
    if (!replacement || typeof replacement !== 'object') continue;
    const values = replacement as Record<string, unknown>;
    const before = typeof values.old_text === 'string' ? values.old_text : '';
    const after = typeof values.new_text === 'string' ? values.new_text : '';
    additions += textLines(after);
    deletions += textLines(before);
    fragments.push(reviewFragment(path, before, after));
    changes.push({ before, after });
  }
  return { diff: fragments.join('\n\n'), additions, deletions, changes };
}

function lineEditDiff(path: string, lineEdits: unknown[]): { diff: string; additions: number; deletions: number; changes: AgentReviewChange[] } {
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  const changes: AgentReviewChange[] = [];
  let additions = 0;
  let deletions = 0;
  for (const edit of lineEdits) {
    if (!edit || typeof edit !== 'object') continue;
    const values = edit as Record<string, unknown>;
    const start = typeof values.start_line === 'number' ? values.start_line : 1;
    const end = typeof values.end_line === 'number' ? values.end_line : start;
    const after = typeof values.new_text === 'string' ? values.new_text : '';
    const removed = Math.max(0, end - start + 1);
    const added = textLines(after);
    deletions += removed;
    additions += added;
    lines.push(`@@ -${start},${removed} +${start},${added} @@`);
    for (const line of after.split(/\r?\n/).filter((value) => value.length > 0)) lines.push(`+${line}`);
    changes.push({ before: null, after, lineStart: start, lineEnd: end });
  }
  return { diff: lines.join('\n'), additions, deletions, changes };
}

function changeFor(toolName: string, path: string, values: Record<string, unknown>): Omit<AgentReviewFile, 'path' | 'state'> {
  if (toolName === 'move_file') {
    const previousPath = typeof values.from === 'string' ? values.from : null;
    return {
      previousPath, changeType: 'RENAME', additions: 0, deletions: 0, changes: [],
      diff: previousPath ? `rename from ${previousPath}\nrename to ${path}` : `--- a/${path}\n+++ b/${path}`,
    };
  }
  if (toolName === 'delete_file') return {
    previousPath: null, changeType: 'DELETE', additions: 0, deletions: 0, changes: [],
    diff: `--- a/${path}\n+++ /dev/null\ndeleted file ${path}`,
  };
  if (toolName === 'create_file' && typeof values.content === 'string') {
    return {
      previousPath: null, changeType: 'CREATE', diff: reviewFragment(path, '', values.content),
      additions: textLines(values.content), deletions: 0, changes: [{ before: null, after: values.content }],
    };
  }
  if (toolName === 'replace_text' && typeof values.old_text === 'string' && typeof values.new_text === 'string') {
    return { previousPath: null, changeType: 'MODIFY', ...replacementDiff(path, [values]) };
  }
  if (Array.isArray(values.replacements)) return { previousPath: null, changeType: 'MODIFY', ...replacementDiff(path, values.replacements) };
  if (Array.isArray(values.line_edits)) return { previousPath: null, changeType: 'MODIFY', ...lineEditDiff(path, values.line_edits) };
  if (typeof values.content === 'string') {
    return { previousPath: null, changeType: 'MODIFY', diff: reviewFragment(path, '', values.content), additions: textLines(values.content), deletions: 0, changes: [{ before: null, after: values.content }] };
  }
  return { previousPath: null, changeType: 'MODIFY', diff: `--- a/${path}\n+++ b/${path}`, additions: 0, deletions: 0, changes: [] };
}

export function buildAgentReview(tools: readonly AgentToolCallView[]): AgentReviewSummary {
  const files = new Map<string, AgentReviewFile>();
  for (const tool of tools) {
    if (!['PROPOSED', 'WAITING_APPROVAL', 'COMPLETED'].includes(tool.status)) continue;
    if (!['WORKSPACE_WRITE', 'DESTRUCTIVE'].includes(tool.effect)) continue;
    if (!tool.arguments || typeof tool.arguments !== 'object') continue;
    const values = tool.arguments as Record<string, unknown>;
    const state = tool.status === 'COMPLETED' ? 'APPLIED' : 'PROPOSED';
    const candidates: Array<{ path: string; values: Record<string, unknown> }> = [];
    if (Array.isArray(values.patches)) {
      for (const patch of values.patches) {
        if (patch && typeof patch === 'object' && typeof (patch as Record<string, unknown>).path === 'string') {
          candidates.push({ path: String((patch as Record<string, unknown>).path), values: patch as Record<string, unknown> });
        }
      }
    } else if (typeof values.path === 'string') {
      candidates.push({ path: values.path, values });
    } else if (typeof values.to === 'string') {
      candidates.push({ path: values.to, values });
    }
    for (const candidate of candidates) {
      const change = changeFor(tool.name, candidate.path, candidate.values);
      const existing = files.get(candidate.path);
      files.set(candidate.path, existing ? {
        path: candidate.path,
        previousPath: existing.previousPath ?? change.previousPath,
        changeType: existing.changeType === 'CREATE' ? 'CREATE' : change.changeType,
        additions: existing.additions + change.additions,
        deletions: existing.deletions + change.deletions,
        diff: `${existing.diff}\n\n${change.diff}`,
        changes: [...existing.changes, ...change.changes],
        state: existing.state === 'APPLIED' || state === 'APPLIED' ? 'APPLIED' : 'PROPOSED',
      } : { path: candidate.path, ...change, state });
    }
  }
  const ordered = [...files.values()];
  return {
    files: ordered,
    additions: ordered.reduce((sum, file) => sum + file.additions, 0),
    deletions: ordered.reduce((sum, file) => sum + file.deletions, 0),
    state: ordered.some((file) => file.state === 'APPLIED') ? 'APPLIED' : ordered.length ? 'PROPOSED' : 'EMPTY',
  };
}

export function appliedAgentReview(review: AgentReviewSummary | null): AgentReviewSummary | null {
  if (!review) return null;
  const files = review.files.filter((file) => file.state === 'APPLIED');
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    state: files.length > 0 ? 'APPLIED' : 'EMPTY',
  };
}
