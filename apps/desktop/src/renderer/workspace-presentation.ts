import type { AgentEventView, AgentPermission, AgentRunView, ConversationMessageView } from '@fielora/contracts';

export interface FileProposal {
  relativePath: string;
  content: string;
}

export interface ComposerKeyStroke {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}

export function shouldSubmitComposerKey(stroke: ComposerKeyStroke): boolean {
  return stroke.key === 'Enter' && !stroke.shiftKey && !stroke.isComposing;
}

export function hasUserMessage(messages: ReadonlyArray<{ role: string }>): boolean {
  return messages.some((message) => message.role === 'USER');
}

const permissions = new Set<AgentPermission>(['READ_ONLY', 'REVIEW_CHANGES', 'FULL_CONTROL']);

export function resolveComposerPermission(
  conversationOverride: string | null,
  projectDefault: string | null,
  globalDefault: string | null,
): AgentPermission {
  for (const candidate of [conversationOverride, projectDefault, globalDefault]) {
    if (permissions.has(candidate as AgentPermission)) return candidate as AgentPermission;
  }
  return 'REVIEW_CHANGES';
}

export function agentTurnOwnership(
  messages: readonly ConversationMessageView[],
  run: AgentRunView,
  events: readonly AgentEventView[],
): { userMessageId: string | null; assistantMessageId: string | null } {
  const created = events.find((event) => event.kind === 'RUN_CREATED');
  const payload = created?.payload && typeof created.payload === 'object' ? created.payload as Record<string, unknown> : null;
  const recordedUserId = typeof payload?.user_message_id === 'string' ? payload.user_message_id : null;
  const fallbackUser = [...messages].reverse().find((message) => message.role === 'USER' && message.created_at <= run.created_at) ?? null;
  const userMessageId = messages.some((message) => message.id === recordedUserId && message.role === 'USER')
    ? recordedUserId
    : fallbackUser?.id ?? null;
  // A clarification is an assistant message, but never a task completion.
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return { userMessageId, assistantMessageId: null };
  const exactAssistant = messages.find((message) => message.role === 'ASSISTANT' && message.invocation_id === run.id) ?? null;
  if (exactAssistant) return { userMessageId, assistantMessageId: exactAssistant.id };
  const nextUser = messages.find((message) => message.role === 'USER' && message.created_at > run.created_at);
  const fallbackAssistant = messages.find((message) => message.role === 'ASSISTANT'
    && message.created_at >= run.created_at
    && (!nextUser || message.created_at < nextUser.created_at)) ?? null;
  return { userMessageId, assistantMessageId: fallbackAssistant?.id ?? null };
}

export function previousAgentAttempts(messages: readonly ConversationMessageView[], userMessageId: string | null, assistantMessageId: string | null): ConversationMessageView[] {
  const start = messages.findIndex((message) => message.id === userMessageId);
  if (start < 0) return [];
  const attempts: ConversationMessageView[] = [];
  for (const message of messages.slice(start + 1)) {
    if (message.role === 'USER' || message.id === assistantMessageId) break;
    if (message.role === 'ASSISTANT' && message.invocation_id) attempts.push(message);
  }
  return attempts;
}

export type WorkspacePreviewKind = 'TEXT' | 'IMAGE' | 'UNSUPPORTED';

export function workspacePreviewKind(relativePath: string): WorkspacePreviewKind {
  const extension = relativePath.toLowerCase().match(/\.([^.\\/]+)$/)?.[1] ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) return 'IMAGE';
  if (['pdf', 'zip', '7z', 'rar', 'exe', 'dll', 'ico', 'mp3', 'wav', 'mp4', 'mov', 'woff', 'woff2', 'ttf'].includes(extension)) return 'UNSUPPORTED';
  return 'TEXT';
}

export function friendlyFilePreviewFailure(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason);
  if (/binary files|utf-?8|unsupported|too large/i.test(raw)) {
    return '这种文件暂不支持在 Fielora 中预览，可以用系统默认应用打开。';
  }
  return '无法预览这个文件，请稍后重试。';
}

export function isDefaultConversationTitle(title: string): boolean {
  return /^\s*新对话(?:\s*\d+)?\s*$/.test(title);
}

export function conversationTitleFromContent(content: string, maximumLength = 24): string {
  const normalized = content
    .replace(/[`*_>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '新对话';

  const firstThought = normalized.split(/[。！？!?\n]/, 1)[0]?.trim() ?? normalized;
  const concise = firstThought
    .replace(/^(?:请(?:帮我)?|麻烦(?:帮我)?|帮我|我(?:现在)?(?:需要|想要)|我们(?:准备|打算)(?:在这里)?(?:去|来)?)\s*/u, '')
    .replace(/^(?:去|来)?改一些/u, '修改')
    .replace(/[，,\s]*(?:可以吗|行吗|好吗|是否可以)\s*$/u, '')
    .trim() || firstThought;
  const characters = Array.from(concise);
  return characters.length > maximumLength
    ? `${characters.slice(0, maximumLength).join('')}…`
    : concise;
}

// Navigation visibility never removes conversations or composer drafts.
export function sentConversations<T extends { id: string }>(
  conversations: readonly T[],
  unsentIds: ReadonlySet<string>,
): T[] {
  return conversations.filter((conversation) => !unsentIds.has(conversation.id));
}

export function parseFileProposal(output: string): FileProposal | null {
  const pattern = /```fielora-file\s+path="([^"]+)"\s*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let proposal: FileProposal | null = null;
  while ((match = pattern.exec(output)) !== null) {
    const relativePath = match[1]!.replaceAll('\\', '/');
    if (/^(?:[a-zA-Z]:|\/)/.test(relativePath) || relativePath.split('/').some((part) => !part || part === '..')) continue;
    proposal = { relativePath, content: match[2]!.replace(/\r?\n$/, '') };
  }
  return proposal;
}

export function reviewDiff(relativePath: string, before: string, after: string): string {
  if (before === after) return `--- a/${relativePath}\n+++ b/${relativePath}\n(no changes)`;
  const left = before.split('\n');
  const right = after.split('\n');
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const contextStart = Math.max(0, prefix - 3);
  const leftEnd = Math.min(left.length, left.length - suffix + 3);
  const rightEnd = Math.min(right.length, right.length - suffix + 3);
  const lines = [`--- a/${relativePath}`, `+++ b/${relativePath}`, `@@ -${contextStart + 1},${leftEnd - contextStart} +${contextStart + 1},${rightEnd - contextStart} @@`];
  for (let index = contextStart; index < prefix; index += 1) lines.push(` ${left[index] ?? ''}`);
  for (let index = prefix; index < left.length - suffix; index += 1) lines.push(`-${left[index] ?? ''}`);
  for (let index = prefix; index < right.length - suffix; index += 1) lines.push(`+${right[index] ?? ''}`);
  for (let index = 0; index < Math.min(3, suffix); index += 1) lines.push(` ${left[left.length - suffix + index] ?? ''}`);
  return lines.join('\n');
}

// Visual placement may advance through a clarification while original task ownership stays fixed.
export function agentTurnDisplayAnchor(messages: readonly ConversationMessageView[], events: readonly AgentEventView[], fallback: string | null): string | null {
  for (const event of [...events].reverse()) {
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload || typeof payload !== 'object') continue;
    const question = event.kind === 'RUN_PAUSED' && payload.reason === 'AGENT_USER_INPUT_REQUIRED';
    const blocker = event.kind === 'RUN_PAUSED' && payload.reason === 'AGENT_TASK_BLOCKED';
    const answer = event.kind === 'CHECKPOINT_CREATED' && payload.kind === 'USER_INPUT_RECEIVED';
    const id = question ? payload.question_message_id : blocker ? payload.outcome_message_id : answer ? payload.user_message_id : null;
    if (typeof id === 'string' && messages.some(m => m.id === id && m.role === (question || blocker ? 'ASSISTANT' : 'USER'))) return id;
  }
  return fallback;
}
