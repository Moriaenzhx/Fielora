import type { AgentEventView, AgentToolCallView } from '@fielora/contracts';

export type ConversationActivityGroupKind = 'INSPECT' | 'SEARCH' | 'DIRECTORY' | 'CHANGE' | 'VERIFY' | 'COMMAND' | 'VERSION' | 'NETWORK' | 'OTHER' | 'MIXED';

export interface ConversationToolActivityEntry {
  id: string;
  kind: 'TOOL';
  sequence: number;
  occurredAt: number;
  completedAt: number | null;
  activityKind: Exclude<ConversationActivityGroupKind, 'MIXED'>;
  tool: AgentToolCallView;
  status: AgentToolCallView['status'];
  toolId: string;
}

export interface ConversationVerificationActivityEntry {
  id: string;
  kind: 'VERIFICATION';
  sequence: number;
  occurredAt: number;
  completedAt: number;
  activityKind: 'VERIFY';
  title: string;
  detail: string;
  status: 'COMPLETED' | 'FAILED';
}

export type ConversationActivityEntry = ConversationToolActivityEntry | ConversationVerificationActivityEntry;

export interface ActivityApplicationTarget {
  appId: string;
  bundleId: string;
  name: string;
}

export interface ComputerApplicationActivity {
  target: ActivityApplicationTarget | null;
  action: string;
  status: AgentToolCallView['status'];
  label: string;
  succeeded: boolean;
  canPreview: boolean;
}

export interface ApplicationActivityGroup {
  target: ActivityApplicationTarget;
  label: string;
  previewTool: AgentToolCallView | null;
  toolIds: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function applicationText(value: unknown): string {
  return typeof value === 'string' && value.length <= 256 && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) ? value.trim() : '';
}

/** Attribution comes only from the actual native receipt. Discovery results and
 * proposed arguments do not prove that an application was used. */
export function computerApplicationActivity(tool: AgentToolCallView): ComputerApplicationActivity | null {
  if (tool.name !== 'computer') return null;
  const receipt = record(tool.receipt);
  const nativeReceipt = receipt?.kind === 'COMPUTER' ? receipt : null;
  const args = record(tool.arguments);
  const action = applicationText(nativeReceipt?.action) || applicationText(args?.action);
  const observed = action !== 'status' ? record(nativeReceipt?.target) : null;
  const appId = applicationText(observed?.app_id);
  const bundleId = applicationText(observed?.bundle_id);
  const name = applicationText(observed?.name) || bundleId || appId;
  const target = name && (appId || bundleId) ? { appId, bundleId, name } : null;
  const status = nativeReceipt?.outcome_unknown === true ? 'UNKNOWN'
    : nativeReceipt?.success === false && tool.status === 'COMPLETED' ? 'FAILED' : tool.status;
  const succeeded = status === 'COMPLETED' && (nativeReceipt?.success === true
    || (nativeReceipt?.action === 'status' && typeof nativeReceipt.available === 'boolean'));
  const actions: Record<string, string> = {
    status: '检查电脑控制状态', observe: '读取应用窗口', screenshot: '查看窗口画面', activate: '切换应用',
    click: '点击控件', type: '输入文字', press: '发送快捷键', scroll: '滚动窗口', move: '移动指针', drag: '拖动目标',
  };
  const phrase = actions[action] ?? '操作应用';
  const label = succeeded ? `已${phrase}` : status === 'RUNNING' ? `正在${phrase}`
    : status === 'PROPOSED' ? `准备${phrase}` : status === 'WAITING_APPROVAL' ? `${phrase} · 等待确认`
      : status === 'UNKNOWN' ? `${phrase} · 结果待确认` : status === 'DENIED' ? `${phrase} · 已拒绝`
        : status === 'CANCELLED' ? `${phrase} · 已取消` : status === 'FAILED' ? `${phrase} · 未成功`
          : `${phrase} · 历史结果未记录`;
  return { target, action, status, label, succeeded, canPreview: Boolean(succeeded && target?.appId && observed && nativeReceipt?.action !== 'status') };
}

/** A mixed execution group keeps app identities separate from file/command
 * actions, so a native app never appears to own unrelated tool execution. */
export function applicationActivityGroups(entries: readonly ConversationActivityEntry[]): ApplicationActivityGroup[] {
  const groups = new Map<string, { group: ApplicationActivityGroup; completed: number; pending: number; incomplete: number }>();
  for (const entry of entries) {
    if (entry.kind !== 'TOOL') continue;
    const activity = computerApplicationActivity(entry.tool);
    if (!activity?.target) continue;
    const key = activity.target.appId || activity.target.bundleId;
    let current = groups.get(key);
    if (!current) {
      current = { group: { target: activity.target, label: '', previewTool: null, toolIds: [] }, completed: 0, pending: 0, incomplete: 0 };
      groups.set(key, current);
    }
    current.group.toolIds.push(entry.toolId);
    if (activity.succeeded) {
      current.completed += 1;
      if (activity.canPreview) current.group.previewTool = entry.tool;
    } else if (['PROPOSED', 'RUNNING', 'WAITING_APPROVAL'].includes(activity.status)) current.pending += 1;
    else current.incomplete += 1;
  }
  return [...groups.values()].map(({ group, completed, pending, incomplete }) => ({
    ...group,
    label: [completed && `已完成 ${completed} 项应用操作`, pending && `${pending} 项待完成`, incomplete && `${incomplete} 项未确认成功`].filter(Boolean).join('，'),
  }));
}

export interface ConversationActivityGroupItem {
  id: string;
  kind: 'GROUP';
  sequence: number;
  occurredAt: number;
  completedAt: number | null;
  groupKind: ConversationActivityGroupKind;
  title: string;
  entries: ConversationActivityEntry[];
  notes?: ConversationActivityNarrativeItem[];
  contextNotes?: ConversationContextActivityItem[];
}

export interface ConversationActivityNarrativeItem {
  id: string;
  kind: 'NARRATIVE';
  sequence: number;
  occurredAt: number;
  step: number;
  text: string;
}

export interface ConversationActivityPhaseItem {
  id: string;
  kind: 'PHASE';
  sequence: number;
  occurredAt: number;
  title: string;
  phase: 'LOCATE' | 'EDIT' | 'VERIFY' | 'FINALIZE' | 'PAUSED' | 'RESUMED' | 'RECOVERY';
  resumeAttempts?: number;
}

export interface ConversationActivityApprovalItem {
  id: string;
  kind: 'APPROVAL';
  sequence: number;
  occurredAt: number;
  completedAt: number | null;
  approvalId: string;
  toolCallId: string;
  decision: 'ALLOW_ONCE' | 'DENY' | null;
  confirmationStage?: number;
  requiredConfirmations?: number;
}

export interface ConversationContextActivityItem {
  id: string;
  kind: 'CONTEXT';
  sequence: number;
  occurredAt: number;
  completedAt: number | null;
  beforeBytes: number | null;
  afterBytes: number | null;
  interrupted?: boolean;
}

export type ConversationActivityItem = ConversationActivityGroupItem | ConversationActivityNarrativeItem | ConversationActivityPhaseItem | ConversationActivityApprovalItem | ConversationContextActivityItem;

/** Preserve every narrative and the execution scopes established by the ledger.
 * The first actual call owns the disclosure identity, regardless of later status.
 */
export function compactOperationTimeline(items: readonly ConversationActivityItem[]): ConversationActivityItem[] {
  const result: ConversationActivityItem[] = [];
  const isRetryMarker = (item: ConversationActivityItem | undefined): item is ConversationActivityPhaseItem => item?.kind === 'PHASE' && ['PAUSED', 'RESUMED'].includes(item.phase);
  for (const item of items) {
    const previous = result.at(-1);
    if (isRetryMarker(item) && isRetryMarker(previous)) {
      const resumeAttempts = (previous.resumeAttempts ?? Number(previous.phase === 'RESUMED')) + (item.resumeAttempts ?? Number(item.phase === 'RESUMED'));
      result[result.length - 1] = { ...item, resumeAttempts, title: `${item.phase === 'PAUSED' ? '任务已暂停' : '任务已继续'}${resumeAttempts ? ` · 已尝试继续 ${resumeAttempts} 次` : ''}` };
    } else if (item.kind === 'GROUP') {
      if (item.entries.length) result.push({ ...item, id: `operations-${item.entries[0]!.id}` });
    } else result.push(item);
  }
  return result;
}

export function reconcileLiveNarrative(
  items: readonly ConversationActivityItem[],
  liveText: string,
  step: number,
): string {
  if (!liveText.trim()) return '';
  const durableTurnArrived = items.some((item) => item.kind === 'NARRATIVE' && item.step === step);
  return durableTurnArrived ? '' : liveText;
}

type EventPayload = Record<string, unknown>;

function payloadOf(event: AgentEventView): EventPayload | null {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as EventPayload
    : null;
}

function payloadString(payload: EventPayload | null, key: string): string {
  return typeof payload?.[key] === 'string' ? payload[key] as string : '';
}

function payloadNumber(payload: EventPayload | null, key: string): number {
  return typeof payload?.[key] === 'number' && Number.isSafeInteger(payload[key]) ? payload[key] as number : 0;
}

function toolIdFor(event: AgentEventView): string {
  return payloadString(payloadOf(event), 'tool_call_id');
}

function terminalToolEvent(event: AgentEventView): boolean {
  return ['TOOL_COMPLETED', 'TOOL_FAILED', 'TOOL_DENIED', 'TOOL_CANCELLED', 'TOOL_UNKNOWN'].includes(event.kind);
}

function verificationPassed(event: AgentEventView): boolean {
  const receipt = payloadOf(event)?.receipt;
  return Boolean(receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    && (receipt as EventPayload).outcome === 'PASS');
}

function toolIsVerification(tool: AgentToolCallView, verificationToolIds: ReadonlySet<string>): boolean {
  if (verificationToolIds.has(tool.id)) return true;
  return Boolean(tool.receipt && typeof tool.receipt === 'object' && !Array.isArray(tool.receipt)
    && (tool.receipt as EventPayload).verification_eligible === true);
}

function activityKindFor(tool: AgentToolCallView, verificationToolIds: ReadonlySet<string>): Exclude<ConversationActivityGroupKind, 'MIXED'> {
  if (toolIsVerification(tool, verificationToolIds)) return 'VERIFY';
  if (tool.name.startsWith('git_')) return 'VERSION';
  if (tool.name === 'search_text') return 'SEARCH';
  if (['list_files', 'stat_path'].includes(tool.name)) return 'DIRECTORY';
  if (tool.effect === 'OBSERVE') return 'INSPECT';
  if (tool.effect === 'WORKSPACE_WRITE' || tool.effect === 'DESTRUCTIVE') return 'CHANGE';
  if (tool.effect === 'PROCESS') return 'COMMAND';
  if (tool.effect === 'NETWORK') return 'NETWORK';
  return 'OTHER';
}

function argumentPaths(tool: AgentToolCallView): string[] {
  if (!tool.arguments || typeof tool.arguments !== 'object' || Array.isArray(tool.arguments)) return [];
  const root = tool.arguments as Record<string, unknown>;
  const paths = new Set<string>();
  for (const key of ['path', 'from', 'to']) {
    if (typeof root[key] === 'string' && root[key]) paths.add(root[key] as string);
  }
  if (Array.isArray(root.paths)) root.paths.forEach((path) => { if (typeof path === 'string' && path) paths.add(path); });
  if (Array.isArray(root.patches)) root.patches.forEach((patch) => {
    if (patch && typeof patch === 'object' && !Array.isArray(patch) && typeof (patch as EventPayload).path === 'string') {
      paths.add((patch as EventPayload).path as string);
    }
  });
  return [...paths];
}

function activityPhrase(kind: Exclude<ConversationActivityGroupKind, 'MIXED'>, entries: readonly ConversationActivityEntry[], active: boolean): string {
  const matching = entries.filter((entry) => entry.activityKind === kind);
  if (kind === 'SEARCH') return active ? '正在搜索代码' : '已搜索代码';
  if (kind === 'DIRECTORY') return active ? '正在查看项目目录' : '已查看项目目录';
  if (kind === 'INSPECT') {
    if (matching.every(entry => entry.kind === 'TOOL' && entry.tool.name === 'work_plan')) return active ? '正在整理工作计划' : '已记录工作计划';
    const onlyFileInspection = matching.every((entry) => entry.kind !== 'TOOL' || ['list_files', 'read_file', 'search_text', 'stat_path'].includes(entry.tool.name));
    return onlyFileInspection ? (active ? '正在读取相关文件' : '已读取相关文件') : (active ? '正在检查相关信息' : '检查了相关信息');
  }
  if (kind === 'CHANGE') {
    const completed = matching.filter((entry) => entry.status === 'COMPLETED');
    const count = new Set(completed.flatMap((entry) => entry.kind === 'TOOL' ? argumentPaths(entry.tool) : [])).size;
    return active ? '正在编辑文件' : count > 0 ? `已编辑 ${count} 个文件` : completed.length ? '已编辑文件' : '尝试修改文件';
  }
  if (kind === 'VERIFY') return active ? '正在运行针对性验证' : '运行了针对性验证';
  if (matching.length && matching.every(entry => entry.kind === 'TOOL' && entry.tool.name.startsWith('fonts.'))) return active ? '正在处理字体' : '已处理字体';
  if (kind === 'COMMAND') return active ? '正在运行命令' : '运行了命令';
  if (kind === 'VERSION') {
    const onlyRead = matching.every((entry) => entry.kind !== 'TOOL' || ['git_read', 'git_status'].includes(entry.tool.name));
    return onlyRead ? (active ? '正在检查 Git 状态' : '检查了 Git 状态') : (active ? '正在处理版本变更' : '处理了版本变更');
  }
  if (kind === 'NETWORK') {
    if (matching.every(entry => entry.kind !== 'TOOL' || entry.tool.name.startsWith('browser'))) return active ? '正在检查浏览器页面' : '已检查浏览器页面';
    return active ? '正在访问外部服务' : '访问了外部服务';
  }
  return active ? '正在执行操作' : '执行了操作';
}

function groupTitle(entries: readonly ConversationActivityEntry[]): string {
  const active = entries.some((entry) => !['COMPLETED', 'FAILED', 'DENIED', 'CANCELLED', 'UNKNOWN'].includes(entry.status));
  const failed = entries.some((entry) => entry.status === 'FAILED' || entry.status === 'UNKNOWN');
  const kinds = [...new Set(entries.map((entry) => entry.activityKind))];
  if (!active && failed && kinds.length === 1 && kinds[0] === 'VERIFY') return '针对性验证未通过';
  const title = kinds.length > 1 && kinds.every(kind => ['INSPECT', 'SEARCH', 'DIRECTORY'].includes(kind)) ? (active ? '正在查看与搜索项目' : '已查看与搜索项目') : kinds.map((kind) => activityPhrase(kind, entries, active)).join('并');
  return !active && failed ? `${title}，其中有操作未完成` : title;
}

function groupKind(entries: readonly ConversationActivityEntry[]): ConversationActivityGroupKind {
  const kinds = [...new Set(entries.map((entry) => entry.activityKind))];
  return kinds.length === 1 ? kinds[0] ?? 'OTHER' : 'MIXED';
}

function phaseMarker(event: AgentEventView): ConversationActivityPhaseItem | null {
  if (event.kind === 'RUN_PAUSED') return { id: `phase-${event.sequence}`, kind: 'PHASE', sequence: event.sequence, occurredAt: event.created_at, phase: 'PAUSED', title: '任务已暂停' };
  if (event.kind === 'RUN_RESUMED') return { id: `phase-${event.sequence}`, kind: 'PHASE', sequence: event.sequence, occurredAt: event.created_at, phase: 'RESUMED', title: '任务已继续' };
  if (event.kind === 'RECOVERY_RECONCILED') return { id: `phase-${event.sequence}`, kind: 'PHASE', sequence: event.sequence, occurredAt: event.created_at, phase: 'RECOVERY', title: '已恢复并核对执行状态' };
  return null;
}

function approvalIdentity(event: AgentEventView): { approvalId: string; toolCallId: string } | null {
  const payload = payloadOf(event);
  const approval = payload?.approval;
  if (approval && typeof approval === 'object' && !Array.isArray(approval)) {
    const value = approval as EventPayload;
    const approvalId = payloadString(value, 'id');
    const toolCallId = payloadString(value, 'tool_call_id');
    if (approvalId && toolCallId) return { approvalId, toolCallId };
  }
  const approvalId = payloadString(payload, 'approval_id');
  const toolCallId = payloadString(payload, 'tool_call_id');
  return approvalId && toolCallId ? { approvalId, toolCallId } : null;
}

function narrativeFor(event: AgentEventView): ConversationActivityNarrativeItem | null {
  const payload = payloadOf(event);
  if (event.kind === 'CHECKPOINT_CREATED' && payload?.kind === 'WORK_REVIEW_V1' && payload.status === 'RECORDED') {
    if (payload.guidance_status === 'HISTORICAL_INPUTS_REASSESS') {
      return { id: `review-${event.sequence}`, kind: 'NARRATIVE', sequence: event.sequence, occurredAt: event.created_at,
        step: payloadNumber(payload, 'step'), text: '已有更新的执行证据，旧复盘保留为历史记录。' };
    }
    const review = payload.review;
    const next = review && typeof review === 'object' && !Array.isArray(review) ? (review as EventPayload).next_check : null;
    if (typeof next !== 'string' || !next.trim()) return null;
    return { id: `review-${event.sequence}`, kind: 'NARRATIVE', sequence: event.sequence, occurredAt: event.created_at,
      step: payloadNumber(payload, 'step'), text: `已复盘之前的尝试，接下来验证：${next}` };
  }
  if (event.kind !== 'ASSISTANT_NARRATIVE') return null;
  const text = payloadString(payload, 'text');
  if (!text.trim()) return null;
  return {
    id: `narrative-${event.sequence}`,
    kind: 'NARRATIVE',
    sequence: event.sequence,
    occurredAt: event.created_at,
    step: payloadNumber(payload, 'step'),
    text,
  };
}

export function buildConversationActivityProjection(
  events: readonly AgentEventView[],
  tools: readonly AgentToolCallView[],
): ConversationActivityItem[] {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  const terminalByTool = new Map<string, AgentEventView>();
  const verificationToolIds = new Set<string>();
  const approvalToolIds = new Set<string>();
  for (const event of ordered) {
    const toolId = toolIdFor(event);
    if (toolId && terminalToolEvent(event)) terminalByTool.set(toolId, event);
    if (event.kind === 'APPROVAL_REQUESTED') {
      const identity = approvalIdentity(event);
      if (identity) approvalToolIds.add(identity.toolCallId);
    }
    if (event.kind === 'VERIFICATION_RECORDED') {
      const receipt = payloadOf(event)?.receipt;
      if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
        const receiptToolId = payloadString(receipt as EventPayload, 'tool_call_id');
        if (receiptToolId) verificationToolIds.add(receiptToolId);
      }
    }
  }

  const items: ConversationActivityItem[] = [];
  const approvals = new Map<string, ConversationActivityApprovalItem>();
  const projectedToolIds = new Set<string>();
  let currentGroup: ConversationActivityGroupItem | null = null;
  let lastPhase = '';

  const appendEntry = (entry: ConversationActivityEntry) => {
    // Research has visible result content, so it must not disappear inside a
    // mixed batch (or move out of order when that batch is disclosed).
    const research = entry.kind === 'TOOL' && ['web.search', 'web.fetch'].includes(entry.tool.name);
    if (research) currentGroup = null;
    if (!currentGroup) {
      currentGroup = {
        id: `group-${entry.sequence}`,
        kind: 'GROUP',
        sequence: entry.sequence,
        occurredAt: entry.occurredAt,
        completedAt: null,
        groupKind: entry.activityKind,
        title: '',
        entries: [],
      };
      items.push(currentGroup);
    }
    currentGroup.entries.push(entry);
    const terminalTimes = currentGroup.entries.map((candidate) => candidate.completedAt);
    currentGroup.completedAt = terminalTimes.every((value) => value !== null)
      ? Math.max(...terminalTimes as number[])
      : null;
    currentGroup.groupKind = groupKind(currentGroup.entries);
    currentGroup.title = groupTitle(currentGroup.entries);
    if (research) currentGroup = null;
  };

  const appendTool = (event: AgentEventView) => {
    const toolId = toolIdFor(event);
    const tool = toolById.get(toolId);
    if (!tool || projectedToolIds.has(tool.id) || tool.name === 'delegate_readonly') return;
    projectedToolIds.add(tool.id);
    const terminal = terminalByTool.get(tool.id);
    appendEntry({
      id: `tool-${tool.id}`,
      kind: 'TOOL',
      sequence: event.sequence,
      occurredAt: event.created_at,
      completedAt: terminal?.created_at ?? (['COMPLETED', 'FAILED', 'DENIED', 'CANCELLED', 'UNKNOWN'].includes(tool.status) ? tool.updated_at : null),
      activityKind: activityKindFor(tool, verificationToolIds),
      tool,
      status: computerApplicationActivity(tool)?.status ?? (tool.status === 'COMPLETED' && tool.receipt && typeof tool.receipt === 'object' && !Array.isArray(tool.receipt) && ((tool.receipt as EventPayload).success === false || (typeof (tool.receipt as EventPayload).exit_code === 'number' && (tool.receipt as EventPayload).exit_code !== 0)) ? 'FAILED' : tool.status),
      toolId: tool.id,
    });
  };

  for (const event of ordered) {
    const checkpoint = payloadOf(event);
    if (['RUN_PAUSED', 'RUN_FAILED', 'RUN_CANCELLED', 'RUN_COMPLETED', 'RECOVERY_RECONCILED'].includes(event.kind)) {
      for (const item of items) if (item.kind === 'CONTEXT' && item.completedAt === null) item.interrupted = true;
    }
    if (event.kind === 'CHECKPOINT_CREATED' && ['GENERAL_CONTEXT_REDUCTION_STARTED', 'GENERAL_CONTEXT_REDUCED'].includes(String(checkpoint?.kind))) {
      currentGroup = null;
      const complete = checkpoint?.kind === 'GENERAL_CONTEXT_REDUCED';
      const pending = [...items].reverse().find((item): item is ConversationContextActivityItem => item.kind === 'CONTEXT' && item.completedAt === null && !item.interrupted);
      const bytes = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
      if (complete && pending) {
        pending.completedAt = event.created_at;
        pending.beforeBytes = bytes(checkpoint?.before_bytes);
        pending.afterBytes = bytes(checkpoint?.after_bytes);
      } else {
        items.push({ id: `context-${event.sequence}`, kind: 'CONTEXT', sequence: event.sequence, occurredAt: event.created_at,
          completedAt: complete ? event.created_at : null, beforeBytes: bytes(checkpoint?.before_bytes), afterBytes: bytes(checkpoint?.after_bytes) });
      }
      continue;
    }
    const narrative = narrativeFor(event);
    if (narrative) {
      currentGroup = null;
      items.push(narrative);
      continue;
    }

    const phase = phaseMarker(event);
    if (phase) {
      currentGroup = null;
      const phaseIdentity = `${phase.phase}:${phase.title}`;
      if (phaseIdentity !== lastPhase) {
        items.push(phase);
        lastPhase = phaseIdentity;
      }
      continue;
    }

    if (event.kind === 'PHASE_CHANGED' || ['RUN_CREATED', 'RUN_STARTED', 'RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELLED', 'RECOVERY_STARTED', 'TOOL_FAILED', 'TOOL_UNKNOWN', 'TOOL_DENIED', 'TOOL_CANCELLED'].includes(event.kind)) {
      currentGroup = null;
      continue;
    }

    if (event.kind === 'TOOL_COMPLETED') {
      const finished = toolById.get(toolIdFor(event));
      const receipt = finished?.receipt as EventPayload | null;
      if (finished?.name === 'request_user_input' || receipt?.success === false || (typeof receipt?.exit_code === 'number' && receipt.exit_code !== 0)) currentGroup = null;
    }

    if (event.kind === 'TOOL_PROPOSED' && !approvalToolIds.has(toolIdFor(event))) {
      if (toolById.get(toolIdFor(event))?.name === 'request_user_input') currentGroup = null;
      appendTool(event);
      continue;
    }

    if (event.kind === 'TOOL_STARTED' && approvalToolIds.has(toolIdFor(event))) {
      appendTool(event);
      continue;
    }

    if (event.kind === 'VERIFICATION_RECORDED') {
      const receipt = payloadOf(event)?.receipt;
      const receiptToolId = receipt && typeof receipt === 'object' && !Array.isArray(receipt)
        ? payloadString(receipt as EventPayload, 'tool_call_id')
        : '';
      if (receiptToolId && projectedToolIds.has(receiptToolId)) continue;
      const passed = verificationPassed(event);
      appendEntry({
        id: `verification-${event.sequence}`,
        kind: 'VERIFICATION',
        sequence: event.sequence,
        occurredAt: event.created_at,
        completedAt: event.created_at,
        activityKind: 'VERIFY',
        title: passed ? '验证通过' : '验证未通过',
        detail: passed ? '结果来自当前 workspace revision 的验证回执' : '验证回执没有证明当前修改通过',
        status: passed ? 'COMPLETED' : 'FAILED',
      });
      continue;
    }

    if (event.kind === 'APPROVAL_REQUESTED') {
      currentGroup = null;
      const identity = approvalIdentity(event);
      if (!identity) continue;
      const previous = approvals.get(identity.approvalId);
      if (previous && !previous.completedAt) {
        previous.completedAt = event.created_at;
        previous.decision = 'ALLOW_ONCE';
      }
      const item: ConversationActivityApprovalItem = {
        id: `approval-${identity.approvalId}-${event.sequence}`,
        kind: 'APPROVAL',
        sequence: event.sequence,
        occurredAt: event.created_at,
        completedAt: null,
        approvalId: identity.approvalId,
        toolCallId: identity.toolCallId,
        decision: null,
        confirmationStage: typeof (payloadOf(event)?.approval as Record<string, unknown> | undefined)?.confirmation_stage === 'number' ? (payloadOf(event)?.approval as Record<string, number>).confirmation_stage : undefined,
        requiredConfirmations: typeof (payloadOf(event)?.approval as Record<string, unknown> | undefined)?.required_confirmations === 'number' ? (payloadOf(event)?.approval as Record<string, number>).required_confirmations : undefined,
      };
      approvals.set(identity.approvalId, item);
      items.push(item);
      continue;
    }

    if (event.kind === 'APPROVAL_RESOLVED') {
      currentGroup = null;
      const payload = payloadOf(event);
      const approvalId = payloadString(payload, 'approval_id');
      const item = approvals.get(approvalId);
      if (!item) continue;
      const decision = payloadString(payload, 'decision');
      item.decision = decision === 'ALLOW_ONCE' || decision === 'DENY' ? decision : null;
      item.completedAt = event.created_at;
    }
  }

  return items;
}
