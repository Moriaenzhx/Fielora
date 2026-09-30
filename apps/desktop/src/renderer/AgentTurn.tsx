import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TimestampHover } from './UiPrimitives';
import type { AgentEventView, AgentRunView, AgentToolCallView, ApprovalView, ConversationMessageView, McpConnectionRuntimeView, ResultReference } from '@fielora/contracts';
import type { ResultImagePreviewView } from '../workspace-types';
import { appliedAgentReview, type AgentReviewSummary } from './agent-review';
import {
  buildConversationActivityProjection,
  compactOperationTimeline,
  reconcileLiveNarrative,
  type ConversationActivityEntry,
  type ConversationActivityGroupItem,
  type ConversationActivityGroupKind,
  type ConversationActivityItem,
} from './agent-activity-projection';

const ActivityRunningContext = createContext(false);
const ActivityActiveToolContext = createContext<string | null>(null);
const ActivityNarrativeTimeContext = createContext<number | undefined>(undefined);
type OperationDisclosure = { open: boolean; selected: string | null };
const ActivityDisclosureContext = createContext<{
  states: Record<string, OperationDisclosure>;
  update: (id: string, value: OperationDisclosure) => void;
}>({ states: {}, update: () => undefined });
import {
  agentRequestKind,
  agentModelIsActive,
  agentPausePresentation,
  agentCompletionTimeLabel,
  approvalActionLabel,
  buildAgentResultViewModel,
  buildAgentPresentation,
  toolDetail,
  toolTitle,
  type AgentPresentation,
  type AgentTerminalStatus,
} from './agent-presentation';
import { MarkdownMessage, type ActivityFileContext } from './MarkdownMessage';
import { activityDetailFields, activityStatusLabel, activityFailureReason, activityToolDescription, activityToolIssue, browserLoadPauseReason, resolveActivityFileLink, shouldShowMcpRuntime, type ActivityFileLink } from './agent-activity-detail';
import { AppIcon, type AppIconName } from './ui';

interface AgentTurnProps {
  run: AgentRunView | null;
  requestText?: string;
  userMessageId: string | null;
  terminalMessage: ConversationMessageView | null;
  events?: AgentEventView[];
  tools?: AgentToolCallView[];
  approval?: ApprovalView | null;
  approvalSummary?: string;
  review?: AgentReviewSummary | null;
  streamingContent?: string;
  streamingStep?: number;
  busy?: boolean;
  stopping?: boolean;
  copied?: boolean;
  onOpenActivityFile?: (file: ActivityFileLink) => void;
  onResume?: () => void;
  onStop?: () => void;
  onDecision?: (decision: 'DENY' | 'ALLOW_ONCE') => void;
  onRetry?: () => void;
  onReview?: () => void;
  onReviewFile?: (path: string) => void;
  onCopy?: () => void;
  onCopyError?: (reason: string) => void;
  onOpenReference?: (reference: ResultReference) => void;
  onOpenImage?: (preview: ResultImagePreviewView) => void;
  mcpRuntime?: McpConnectionRuntimeView | null;
  mcpBusyConnectionId?: string;
  onActivateMcp?: (connectionId: string) => void;
}

function isTerminalRun(run: AgentRunView | null): boolean {
  return Boolean(run && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status));
}

function terminalStatus(run: AgentRunView | null, message: ConversationMessageView | null): AgentTerminalStatus | null {
  if (run && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return run.status as AgentTerminalStatus;
  return message?.status ?? null;
}

function mcpActivationLabel(state: McpConnectionRuntimeView['connections'][number]['activation_state']): string {
  if (state === 'ACTIVATION_QUEUED') return '等待当前安全边界';
  if (state === 'AWAITING_APPROVAL') return '等待批准';
  if (state === 'STARTING') return '正在启动';
  if (state === 'ACTIVE_IN_CURRENT_RUN') return 'Active for this Run';
  if (state === 'PROCESS_UNAVAILABLE') return '进程不可用';
  if (state === 'ACTIVATION_DENIED') return '已拒绝';
  if (state === 'ACTIVATION_FAILED') return '激活失败';
  return 'Configured · Not active';
}

function CurrentRunMcp({ runtime, busyConnectionId, onActivate }: {
  runtime: McpConnectionRuntimeView | null;
  busyConnectionId?: string;
  onActivate?: (connectionId: string) => void;
}) {
  if (!runtime || !shouldShowMcpRuntime(runtime)) return null;
  return <section className="agent-run-mcp" data-testid="agent-run-mcp" data-run-status={runtime.run_status}>
    <header><span><strong>外部工具连接</strong><small>已激活的连接仅用于当前任务。</small></span></header>
    {runtime.connections.length === 0 ? <p className="agent-run-mcp-empty">当前 Run 没有可用的 Local MCP 配置。</p> : <div>{runtime.connections.map((connection) => {
      const active = connection.activation_state === 'ACTIVE_IN_CURRENT_RUN';
      const busy = busyConnectionId === connection.connection_id || ['ACTIVATION_QUEUED', 'AWAITING_APPROVAL', 'STARTING'].includes(connection.activation_state);
      return <article key={connection.connection_id} data-testid={`agent-run-mcp-${connection.connection_id}`} data-activation-state={connection.activation_state}>
        <span><strong>{connection.connection_id}</strong><small>{connection.transport} · {mcpActivationLabel(connection.activation_state)}</small>{active && <><small>{connection.discovered_tool_count ?? 0} Tools discovered · Fielora policy: unknown Tools → DESTRUCTIVE</small><small>{connection.provider_id} · MCP {connection.protocol_version}</small></>}{connection.last_error_code && <code>{connection.last_error_code}</code>}</span>
        {connection.activation_available && onActivate ? <button type="button" disabled={Boolean(busyConnectionId)} onClick={() => onActivate(connection.connection_id)} data-testid={`mcp-activate-${connection.connection_id}`}>{busy ? '正在请求…' : 'Activate for this run'}</button> : <em>{active ? '仅此 Run' : mcpActivationLabel(connection.activation_state)}</em>}
      </article>;
    })}</div>}
    {runtime.diagnostics.length > 0 && <details><summary>配置诊断</summary>{runtime.diagnostics.map((item, index) => <p key={`${item.connection_id ?? 'config'}-${item.code}-${index}`}><code>{item.code}</code>{item.connection_id && <span>{item.connection_id}</span>}</p>)}</details>}
  </section>;
}

function activityIcon(kind: ConversationActivityGroupKind): AppIconName {
  if (kind === 'SEARCH') return 'search';
  if (kind === 'DIRECTORY') return 'folderOpen';
  if (kind === 'INSPECT') return 'files';
  if (kind === 'CHANGE') return 'edit';
  if (kind === 'VERIFY') return 'check';
  if (kind === 'COMMAND') return 'terminal';
  if (kind === 'VERSION') return 'branch';
  if (kind === 'NETWORK') return 'browse';
  return 'tools';
}

function activityToolPresentation(tool: AgentToolCallView): { title: string; detail: string; command: boolean; inlineDetail: boolean } {
  if (isImageActivity(tool)) return { title: tool.status === 'COMPLETED' && (tool.receipt as { screenshot?: unknown } | null)?.screenshot ? '已获取 1 张页面截图' : '获取页面截图', detail: '', command: false, inlineDetail: false };
  const specific: Record<string, string> = {
    list_skills: '查看 Skill 清单', load_skill: '加载 Skill', verify_skill: '检查 Skill 完整性',
    capability_status: '查询可用能力', 'mcp.list_connections': '查看外部工具连接',
    'mcp.activate_connection': '连接外部工具', 'skills.search': '搜索 Skill 来源',
    'skills.prepare': '准备完整 Skill 包', 'skills.install': '安装 Skill',
    finish_task: '整理任务结果', record_request_intent: '确认当前请求', read_run_history: '查看历史执行记录',
    browser: '操作浏览器', browser_verify: '检查页面结果', browser_plan: '记录页面检查计划',
    browser_server: '管理开发服务', 'file.extract': '提取文档内容',
    'environment.inspect': '检查运行环境',
  };
  if (specific[tool.name]) return { title: specific[tool.name]!, detail: '', command: false, inlineDetail: false };
  if (tool.name === 'work_plan') return { title: '工作计划', detail: '', command: false, inlineDetail: false };
  if (tool.name === 'delegate_readonly') return { title: '检查了项目结构', detail: '', command: false, inlineDetail: false };
  if (tool.name === 'run_command') return { title: toolDetail(tool), detail: '', command: true, inlineDetail: false };
  const knownNames = new Set([
    'list_files', 'read_file', 'search_text', 'stat_path', 'create_file', 'replace_text', 'apply_patches', 'write_file',
    'delete_file', 'move_file', 'git_read', 'git_status', 'git_stage', 'git_unstage', 'git_commit', 'git_push',
    'git_create_branch', 'git_switch_branch',
  ]);
  if (!knownNames.has(tool.name)) {
    const title = tool.effect === 'OBSERVE' ? '检查相关信息'
      : tool.effect === 'WORKSPACE_WRITE' || tool.effect === 'DESTRUCTIVE' ? '更新项目文件'
        : tool.effect === 'PROCESS' ? '运行命令'
          : tool.effect === 'NETWORK' ? '访问外部服务'
            : '执行一项操作';
    return { title, detail: '', command: false, inlineDetail: false };
  }
  const title = toolTitle(tool.name);
  const detail = toolDetail(tool);
  const conciseAction: Partial<Record<string, string>> = {
    list_files: '查看', read_file: '读取', search_text: '搜索', stat_path: '检查',
    create_file: '创建', replace_text: '修改', apply_patches: '修改', write_file: '写入', delete_file: '删除', move_file: '移动',
    git_stage: '暂存', git_unstage: '取消暂存', git_create_branch: '创建分支', git_switch_branch: '切换分支',
  };
  if (detail !== title && conciseAction[tool.name]) {
    return { title: conciseAction[tool.name]!, detail, command: false, inlineDetail: true };
  }
  return { title, detail: detail === title ? '' : detail, command: false, inlineDetail: false };
}

function isImageActivity(tool: AgentToolCallView): boolean {
  return tool.name === 'browser' && (tool.arguments as { action?: string })?.action === 'screenshot';
}

function activityTimestamp(timestamp: number): string {
  return agentCompletionTimeLabel(timestamp).replace(/^(?:完成于|结束于)\s+/, '');
}

function operationLabel(entry: ConversationActivityEntry): string {
  if (entry.kind !== 'TOOL') return entry.title;
  const tool = entry.tool;
  const args = tool.arguments as Record<string, unknown> | null;
  const actions: Record<string, string> = { read_file: '读取', list_files: '查看目录', search_text: '搜索', stat_path: '检查',
    run_command: '运行', create_file: '创建', write_file: '编辑', replace_text: '编辑', apply_patches: '编辑', delete_file: '删除', move_file: '移动' };
  const action = actions[tool.name] ?? activityToolPresentation(tool).title.replace(/^已/, '');
  const target = tool.name === 'read_file' ? (typeof args?.path === 'string' ? args.path : '')
    : tool.name === 'run_command' ? activityToolDescription(tool).split(/\r?\n/)[0]!.slice(0, 96) + (activityToolDescription(tool).length > 96 ? '…' : '') : activityToolDescription(tool);
  const status = entry.status === 'COMPLETED' ? '已' : entry.status === 'RUNNING' ? '正在' : `${activityStatusLabel(entry.status)} · `;
  return `${status}${action}${target ? ` ${target}` : ''}`;
}

function operationIcon(entry: ConversationActivityEntry): AppIconName {
  return entry.kind === 'TOOL' && entry.tool.name === 'run_command' ? 'terminal'
    : entry.kind === 'TOOL' && isImageActivity(entry.tool) ? 'images' : activityIcon(entry.activityKind);
}

function OperationDetail({ entry, activityFiles }: { entry: ConversationActivityEntry; activityFiles?: ActivityFileContext }) {
  const [copied, setCopied] = useState('');
  const fields = entry.kind === 'TOOL' ? activityDetailFields(entry.tool) : [{ label: '验证回执', text: entry.detail }];
  const issue = entry.kind === 'TOOL' ? activityToolIssue(entry.tool) : null;
  const path = fields.find(field => field.label === '操作对象')?.text;
  const file = path ? activityFiles?.resolve(`fielora-project-file:${path}`) : null;
  return <section className="operation-detail" id={`detail-${entry.id}`} data-testid="operation-detail" aria-label="操作详情">
    {fields.length === 0 && <p>该历史记录未保存执行详情。</p>}
    {fields.map(field => <div className="operation-detail-field" key={field.label}>
      <div className="operation-detail-heading"><span>{field.label}</span><button type="button" aria-label={`复制${field.label}`} onClick={() => {
        void window.fielora.clipboard.writeText(field.text).then(() => setCopied(`${field.label}已复制`), () => setCopied(`${field.label}复制失败`));
      }}><AppIcon name="copy"/></button>{field.label === '操作对象' && file && activityFiles?.open && <button type="button" onClick={() => activityFiles.open?.(file)}>打开文件</button>}</div>
      {field.code ? <pre tabIndex={0}>{field.text}</pre> : <div className="operation-detail-value">{field.text}</div>}
    </div>)}
    {issue && <p>{issue}</p>}
    <footer><span>{activityStatusLabel(entry.status)}</span>{entry.occurredAt > 0 && <time>开始于 {activityTimestamp(entry.occurredAt)}</time>}{entry.completedAt !== null && <time>结束于 {activityTimestamp(entry.completedAt)}</time>}</footer>
    {copied && <span role="status">{copied}</span>}
  </section>;
}

function CompactActivityGroup({ item, activityFiles }: { item: ConversationActivityGroupItem; activityFiles?: ActivityFileContext }) {
  const running = useContext(ActivityRunningContext);
  const activeToolId = useContext(ActivityActiveToolContext);
  const disclosure = useContext(ActivityDisclosureContext);
  const state = disclosure.states[item.id] ?? { open: false, selected: null };
  const single = item.entries.length === 1;
  const first = item.entries[0]!;
  const selected = item.entries.find(entry => entry.id === state.selected);
  const active = running && item.entries.some(entry => entry.kind === 'TOOL' && entry.toolId === activeToolId);
  const issues = [...new Set(item.entries.filter(entry => ['FAILED', 'UNKNOWN', 'DENIED', 'CANCELLED', 'WAITING_APPROVAL'].includes(entry.status)).map(entry => activityStatusLabel(entry.status)))];
  const categories: Record<ConversationActivityGroupKind, string> = { INSPECT: '读取信息', SEARCH: '搜索', DIRECTORY: '查看目录', CHANGE: '编辑文件', COMMAND: '运行命令', VERIFY: '执行检查', VERSION: '版本操作', NETWORK: '访问服务', OTHER: '工具操作', MIXED: '工具操作' };
  const kinds = [...new Set(item.entries.map(entry => entry.kind === 'TOOL' && entry.tool.name === 'run_command' ? '运行命令' : entry.kind === 'TOOL' && entry.tool.name === 'read_file' ? '读取文件' : categories[entry.activityKind]))];
  const completed = item.entries.every(entry => entry.status === 'COMPLETED');
  const label = single ? operationLabel(first) : `${completed ? '已执行' : '执行记录'} ${item.entries.length} 项操作 · ${kinds.slice(0, 2).join('、')}${kinds.length > 2 ? '等' : ''}`;
  const detailVisible = state.open && Boolean(selected);
  return <div className={`operation-group${active ? ' is-working' : ''}`} data-testid="compact-category" data-single={single} data-activity-sequence={item.sequence}>
    <button type="button" className="operation-summary" data-testid="operation-group-toggle" aria-expanded={state.open} aria-controls={`operations-${item.id}`} onClick={() => disclosure.update(item.id, { ...state, open: !state.open, selected: single ? first.id : state.selected })}>
      <AppIcon name={operationIcon(first)}/><span className="operation-label">{label}</span>
      {!single && issues.length > 0 && <span className="operation-issue">{issues.join('、')}</span>}
      {!single && active && <span>执行中</span>}<AppIcon name="chevronDown"/>
    </button>
    <div id={`operations-${item.id}`} hidden={!state.open}>
      {!single && state.open && <ol className="operation-list" data-testid="operation-list" aria-label="操作列表">{item.entries.map(entry => <li key={entry.id} data-testid="operation-row" data-activity-entry={entry.kind.toLowerCase()} data-activity-status={entry.status}>
        <button type="button" aria-expanded={detailVisible && selected?.id === entry.id} aria-controls={`detail-${entry.id}`} onClick={() => disclosure.update(item.id, { open: true, selected: state.selected === entry.id ? null : entry.id })}>
          <AppIcon name={operationIcon(entry)}/><span className="operation-label">{operationLabel(entry)}</span><span className="operation-detail-link">{state.selected === entry.id ? '收起详情' : '查看详情'}</span>
        </button>
      </li>)}</ol>}
      {detailVisible && selected && <OperationDetail key={selected.id} entry={selected} activityFiles={activityFiles}/>}
    </div>
  </div>;
}

function currentCompactAction(items: ConversationActivityItem[], tools: AgentToolCallView[], events: AgentEventView[]): string {
  // Execution already has a visible operation row; do not repeat it in the footer.
  if (items.some(item => item.kind === 'CONTEXT' && item.completedAt === null && !item.interrupted)) return '';
  if (tools.some(tool => ['PROPOSED', 'RUNNING', 'WAITING_APPROVAL'].includes(tool.status))) return '';
  return agentModelIsActive(events, tools) ? '正在思考' : '正在处理';
}

function ContextActivity({ item }: { item: Extract<ConversationActivityItem, { kind: 'CONTEXT' }> }) {
  const running = useContext(ActivityRunningContext);
  const active = running && item.completedAt === null && !item.interrupted;
  const label = active ? '正在压缩上下文' : item.completedAt === null ? '上下文压缩已中断，结果待确认'
    : item.beforeBytes !== null && item.beforeBytes === item.afterBytes ? '上下文整理完成，保留原内容' : '上下文已自动压缩';
  return <TimestampHover timestamp={item.completedAt ?? item.occurredAt}><details className={`compact-activity-row context-activity${active ? ' is-working' : ''}`} data-testid="context-compaction" data-context-state={active ? 'RUNNING' : item.completedAt === null ? 'INTERRUPTED' : 'COMPLETED'}>
    <summary><AppIcon name="contextCompress"/><span className="compact-activity-label">{label}</span><AppIcon name="chevronDown"/></summary>
    <div className="compact-command-panel"><p>整理较早的上下文，保留任务目标与近期证据；聊天记录仍然保留。</p>
      {item.beforeBytes !== null && <p>压缩前：{item.beforeBytes.toLocaleString()} 字节{item.afterBytes !== null && `；压缩后：${item.afterBytes.toLocaleString()} 字节`}。此数值不是 token 用量。</p>}
    </div>
  </details></TimestampHover>;
}

function ActivityGroup({ item, activityFiles }: { item: ConversationActivityGroupItem; activityFiles?: ActivityFileContext }) {
  return <CompactActivityGroup item={item} activityFiles={activityFiles}/>;
}

function ActivityApprovalRecord({ item }: { item: Extract<ConversationActivityItem, { kind: 'APPROVAL' }> }) {
  const label = item.completedAt ? agentCompletionTimeLabel(item.completedAt, item.decision === 'ALLOW_ONCE') : '';
  return <div className="conversation-activity-approval-record" data-activity-sequence={item.sequence} data-completed-at={item.completedAt ?? undefined}>
    <span>{item.decision === 'ALLOW_ONCE' ? '已允许本次操作' : item.decision === 'DENY' ? '已拒绝本次操作' : '等待操作确认'}</span>{label && <small>{label}</small>}
  </div>;
}

function NarrativeBlock({ text, streaming = false, sequence, timestamp, activityFiles }: { text: string; streaming?: boolean; sequence?: number; timestamp?: number; activityFiles?: ActivityFileContext }) {
  const invocationTime = useContext(ActivityNarrativeTimeContext);
  return <TimestampHover timestamp={timestamp ?? (streaming ? invocationTime : undefined)}><div className={`conversation-narrative${streaming ? ' is-streaming' : ''}`} data-testid="conversation-narrative" data-activity-sequence={sequence}>
    <MarkdownMessage content={text} streaming={streaming} activityFiles={activityFiles}/>
  </div></TimestampHover>;
}

function ConversationActivityStream({ items, tools, approval, approvalSummary, busy, onDecision, liveNarrative, activityFiles }: {
  items: ConversationActivityItem[];
  tools: AgentToolCallView[];
  approval: ApprovalView | null;
  approvalSummary: string;
  busy: boolean;
  onDecision?: (decision: 'DENY' | 'ALLOW_ONCE') => void;
  liveNarrative?: string;
  activityFiles?: ActivityFileContext;
}) {
  const visibleItems = useMemo(() => compactOperationTimeline(items), [items]);
  const renderItem = (item: ConversationActivityItem): ReactNode => {
    if (item.kind === 'GROUP') return <ActivityGroup item={item} key={item.id} activityFiles={activityFiles}/>;
    if (item.kind === 'CONTEXT') return <ContextActivity item={item} key={item.id}/>;
    if (item.kind === 'NARRATIVE') return <NarrativeBlock text={item.text} sequence={item.sequence} timestamp={item.occurredAt} key={item.id} activityFiles={activityFiles}/>;
    if (item.kind === 'PHASE') return <TimestampHover timestamp={item.occurredAt} key={item.id}><p className="conversation-activity-phase" data-activity-sequence={item.sequence}>{item.title}</p></TimestampHover>;
    if (approval?.id === item.approvalId && onDecision && !item.completedAt) {
      const tool = tools.find(candidate => candidate.id === item.toolCallId) ?? null;
      return <AgentApproval key={item.id} tool={tool} summary={approvalSummary} busy={busy} onDecision={onDecision}/>;
    }
    return <ActivityApprovalRecord item={item} key={item.id}/>;
  };
  return <div className="conversation-activity-stream" data-testid="conversation-activity-stream" data-activity-count={visibleItems.length}>
    {visibleItems.map(renderItem)}
    {liveNarrative && <NarrativeBlock text={liveNarrative} streaming activityFiles={activityFiles}/>}

  </div>;
}

function durableRunPhase(events: readonly AgentEventView[]): string {
  for (const event of [...events].reverse()) {
    if (!['PHASE_CHANGED', 'STEP_STARTED'].includes(event.kind) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue;
    const payload = event.payload as Record<string, unknown>;
    const phase = typeof payload.active_phase === 'string' ? payload.active_phase : typeof payload.phase === 'string' ? payload.phase : '';
    if (phase) return phase;
  }
  return '';
}

function currentRunStateLabel(run: AgentRunView, events: readonly AgentEventView[], tools: readonly AgentToolCallView[], thinking: boolean): string {
  if (run.status === 'WAITING_APPROVAL') return '等待批准';
  if (run.status === 'PAUSED') return run.error_code === 'AGENT_USER_INPUT_REQUIRED' ? '等待你的回答' : '已暂停';
  if (thinking) return '正在思考';
  const phase = durableRunPhase(events);
  if (phase === 'VERIFY') return '正在验证';
  if (phase === 'LOCATE') return '正在定位';
  if (phase === 'EDIT') return '正在编辑';
  if (phase === 'FINALIZE') return '正在整理结果';
  const activeTool = [...tools].reverse().find((tool) => ['PROPOSED', 'WAITING_APPROVAL', 'RUNNING'].includes(tool.status));
  if (activeTool?.effect === 'PROCESS' && activeTool.name === 'run_command') return '正在执行命令';
  return '正在执行';
}

function AgentProgressSummary({ run, tools, busy, onResume, onStop }: {
  run: AgentRunView; tools: AgentToolCallView[]; busy: boolean;
  onResume?: () => void; onStop?: () => void;
}) {
  const clarification = run.error_code === 'AGENT_USER_INPUT_REQUIRED'
    ? [...tools].reverse().find(tool => tool.name === 'request_user_input' && tool.status === 'COMPLETED')?.arguments as { question?: string; reason?: string } | undefined : undefined;
  return <div className="agent-progress-summary" data-testid="agent-execution-status" data-execution-stage={run.status}>
    <div className="agent-pause-notice" data-testid="agent-pause-notice">
      {clarification?.question && <div data-testid="agent-visible-question">{clarification.reason && <p>{clarification.reason}</p>}<p>{clarification.question}</p></div>}
      <p>{(run.error_code === 'AGENT_VERIFICATION_REQUIRED' ? browserLoadPauseReason(tools) : null) ?? agentPausePresentation(run).reason}</p>
      <div className="agent-pause-actions" aria-busy={busy}>
        {onResume && agentPausePresentation(run).canResume && <button type="button" className="agent-resume-action is-primary" disabled={busy} onClick={onResume}>{agentPausePresentation(run).action}</button>}
        {onStop && <button type="button" className="agent-resume-action" disabled={busy} onClick={onStop}>停止任务</button>}
      </div>
    </div>
  </div>;
}

function AgentApproval({ tool, summary, busy, onDecision }: {
  tool: AgentToolCallView | null;
  summary: string;
  busy: boolean;
  onDecision: (decision: 'DENY' | 'ALLOW_ONCE') => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mcpActivation = tool?.name === 'mcp.activate_connection';
  const install = tool?.name === 'tools.install' && tool.arguments && typeof tool.arguments === 'object'
    ? (tool.arguments as Record<string, unknown>)._installation_preview as Record<string, unknown> | undefined : undefined;
  const connectionId = mcpActivation && tool?.arguments && typeof tool.arguments === 'object' && 'connection_id' in tool.arguments
    ? String((tool.arguments as { connection_id?: unknown }).connection_id ?? '') : '';
  return <section className="agent-turn-approval" data-testid="agent-approval">
    <p>{install ? `安装工具 ${String(install.name)}${install.version ? ` ${String(install.version)}` : ''}` : mcpActivation ? `Start local MCP Server “${connectionId}” for this Run` : '我已经定位到需要执行的下一步。'}</p>
    {install && <dl className="agent-install-preview" data-testid="agent-install-preview">
      <dt>来源</dt><dd>{String(install.source_url)}</dd>
      <dt>下载大小</dt><dd>{Number(install.archive_bytes) < 1024 * 1024 ? `${Number(install.archive_bytes).toLocaleString()} 字节` : `${(Number(install.archive_bytes) / 1024 / 1024).toFixed(2)} MiB`}</dd>
      <dt>安装位置</dt><dd>{String(install.target_path)}</dd>
      <dt>SHA-256</dt><dd>{String(install.archive_sha256)}</dd>
      <dt>影响</dt><dd>仅解包到项目隔离目录；不修改系统或 PATH，不运行安装脚本。安装后另行检查兼容性。</dd>
      <dt>需要确认</dt><dd>{install.source_trust !== 'OFFICIAL_PROVIDER' ? '来源未列入可信供应商。' : '下载超过 20 MiB，或当前权限要求审批。'}</dd>
    </dl>}
    {!install && <p>{mcpActivation ? '这会启动已配置的本地进程并发现有界 Tools；不会授予后续 Tool 权限。' : summary || (tool ? `${toolTitle(tool.name)} · ${toolDetail(tool)}` : '只会执行当前列出的操作，不会扩大范围。')}</p>}
    {detailsOpen && tool && <OperationDetail entry={{ id: `tool-${tool.id}`, kind: 'TOOL', toolId: tool.id, tool, status: tool.status, activityKind: 'OTHER', sequence: 0, occurredAt: tool.created_at, completedAt: null }}/>}
    <div><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>{install ? '查看执行详情' : '查看修改范围'}</button><button type="button" onClick={() => onDecision('DENY')} disabled={busy}>拒绝</button><button type="button" className="agent-primary-action" onClick={() => onDecision('ALLOW_ONCE')} disabled={busy} data-testid="agent-allow-once">{install ? '允许本次安装' : approvalActionLabel(tool)}</button></div>
  </section>;
}

function fileName(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path;
}

function ChangedFiles({ review, onReview, onReviewFile }: {
  review: AgentReviewSummary;
  onReview?: () => void;
  onReviewFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewLimit = 3;
  const visibleFiles = expanded ? review.files : review.files.slice(0, previewLimit);
  const remainingFiles = Math.max(0, review.files.length - visibleFiles.length);
  const undoFile = review.files.find(file => file.artifactId && file.revisionId && file.undoAvailability === 'AVAILABLE');
  return <section className={`agent-result-changes file-delivery-card${expanded ? ' is-expanded' : ''}`} data-testid="agent-result-changed-files" data-file-count={review.files.length} data-additions={review.additions} data-deletions={review.deletions}>
    <header className="agent-result-changes-header">
      <span className="agent-result-changes-icon"><AppIcon name="reviewChanges"/></span>
      <span className="agent-result-changes-title"><strong>已编辑 {review.files.length} 个文件</strong><button type="button" className="file-delivery-view" onClick={onReview} disabled={!onReview}>查看更改<AppIcon name="openAction"/></button></span>
      <div className="file-delivery-actions">
        {undoFile && onReviewFile && <button type="button" className="file-delivery-undo" title="打开审阅，检查并撤销文件修改" onClick={() => onReviewFile(undoFile.path)}>撤销<AppIcon name="fileUndo"/></button>}
        {onReview && <button type="button" className="agent-full-review-action" onClick={onReview}>审核</button>}
      </div>
    </header>
    <div className="agent-result-file-list" data-testid="agent-inline-files-expanded">
      {visibleFiles.map((file) => <button type="button" key={file.path} title={file.path} onClick={() => onReviewFile?.(file.path)} disabled={!onReviewFile} data-review-path={file.path}>
        <span className="file-delivery-path">{file.path.slice(0, -fileName(file.path).length)}<strong>{fileName(file.path)}</strong></span><em><b>+{file.additions}</b><i>−{file.deletions}</i></em>
      </button>)}
    </div>
    {review.files.length > previewLimit && <button type="button" className="agent-result-changes-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} data-testid="agent-changed-files-toggle">
      <span>{expanded ? '收起文件' : `再显示 ${remainingFiles} 个文件`}</span><AppIcon name="chevronDown"/>
    </button>}
  </section>;
}

function AgentTerminalResult({ run, status, message, presentation, tools, partial, review, onRetry, onReview, onReviewFile, onOpenReference, onOpenImage }: {
  run: AgentRunView | null;
  status: AgentTerminalStatus;
  message: ConversationMessageView | null;
  presentation: AgentPresentation | null;
  tools: AgentToolCallView[];
  partial: boolean;
  review: AgentReviewSummary | null;
  onRetry?: () => void;
  onReview?: () => void;
  onReviewFile?: (path: string) => void;
  onOpenReference?: (reference: ResultReference) => void;
  onOpenImage?: (preview: ResultImagePreviewView) => void;
}) {
  const result = buildAgentResultViewModel(status, message?.content ?? '', presentation, tools);
  const editedReview = appliedAgentReview(review);
  const markdown = message?.content || result.detail;
  const failureReason = activityFailureReason(run);
  return <div className="agent-terminal-result" data-testid="agent-terminal-result" data-result-outcome={presentation?.outcome ?? status}>
    {run?.error_code && <p className="agent-run-error-detail">结束原因：<code>{run.error_code}</code></p>}
    {failureReason && <p className="agent-failure-reason" data-testid="agent-failure-reason"><AppIcon name="info"/><span>{failureReason}</span></p>}
    <TimestampHover timestamp={message?.created_at}><div className="agent-terminal-body"><MarkdownMessage content={markdown} references={message?.references ?? []} onOpenReference={onOpenReference} onOpenImage={onOpenImage} modernStatusMarkers/></div></TimestampHover>
    {editedReview && editedReview.files.length > 0 && <ChangedFiles review={editedReview} onReview={onReview} onReviewFile={onReviewFile}/>}
    <div className="agent-terminal-actions">
      {result.evidence.filter((item) => !editedReview?.files.length || !/文件/.test(item)).map((item) => <span className="agent-terminal-meta" key={item}>{item}</span>)}
      {status === 'FAILED' && onRetry && <button type="button" className="agent-primary-action" onClick={onRetry} data-testid="agent-retry">{partial ? '继续完成' : '重新尝试'}</button>}
    </div>
  </div>;
}

export function AgentTurn({
  run, requestText = '', userMessageId, terminalMessage, events = [], tools = [], approval = null, approvalSummary = '', review = null,
  streamingContent = '', streamingStep = 0, busy = false, stopping = false, copied = false, onResume, onStop, onDecision, onRetry, onReview, onReviewFile, onCopy, onCopyError, onOpenReference, onOpenImage,
  onOpenActivityFile, mcpRuntime = null, mcpBusyConnectionId = '', onActivateMcp,
}: AgentTurnProps) {
  const [disclosures, setDisclosures] = useState<Record<string, OperationDisclosure>>({});
  const disclosureScope = run?.id ?? 'historical';
  const disclosure = {
    states: Object.fromEntries(Object.entries(disclosures).filter(([id]) => id.startsWith(`${disclosureScope}:`)).map(([id, value]) => [id.slice(disclosureScope.length + 1), value])),
    update: (id: string, value: OperationDisclosure) => setDisclosures(previous => ({ ...previous, [`${disclosureScope}:${id}`]: value })),
  };
  const terminal = Boolean(terminalMessage) || isTerminalRun(run);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!run || terminal || run.status === 'PAUSED') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.status, terminal]);
  const requestKind = agentRequestKind(run?.task ?? requestText);
  const answerOnly = requestKind === 'ANSWER';
  const presentation = useMemo(() => run ? buildAgentPresentation(run, events, tools, now) : null, [events, now, run, tools]);
  const activityFiles = useMemo<ActivityFileContext>(() => ({ resolve: (target) => resolveActivityFileLink(target, tools), open: onOpenActivityFile }), [tools, onOpenActivityFile]);
  const activityItems = useMemo(() => buildConversationActivityProjection(events, tools), [events, tools]);
  const textOnlyAnswer = answerOnly && activityItems.length === 0 && tools.length === 0;
  const liveNarrative = useMemo(() => {
    if (terminal || run?.status !== 'RUNNING') return '';
    return reconcileLiveNarrative(activityItems, streamingContent, streamingStep);
  }, [activityItems, streamingContent, streamingStep, terminal, run?.status]);
  const status = terminalStatus(run, terminalMessage);
  const partial = Boolean(status === 'FAILED' && presentation && presentation.changedFiles > 0);
  const messageId = terminalMessage?.id ?? `agent-turn-${run?.id ?? 'historical'}`;
  const thinking = Boolean(run?.status === 'RUNNING' && !terminal && agentModelIsActive(events, tools));
  const invocationTime = [...events].reverse().find(event => event.kind === 'MODEL_STARTED')?.created_at;
  const activeToolId = run?.status === 'RUNNING' && !terminal ? [...tools].reverse().find(tool => ['PROPOSED', 'RUNNING'].includes(tool.status))?.id ?? null : null;

  return <ActivityRunningContext.Provider value={Boolean(run?.status === 'RUNNING' && !terminal)}><ActivityActiveToolContext.Provider value={activeToolId}><ActivityNarrativeTimeContext.Provider value={invocationTime}><ActivityDisclosureContext.Provider value={disclosure}><section
    className={`message assistant agent-turn${answerOnly ? ' agent-answer' : ''}${terminal ? ' is-terminal' : run?.status === 'PAUSED' ? ' is-paused' : ' is-running'}`}
    data-message-id={messageId}
    data-testid="message-assistant"
    data-agent-turn="true"
    data-agent-run-id={run?.id ?? terminalMessage?.invocation_id ?? ''}
    data-user-message-id={userMessageId ?? ''}
    data-agent-state={status ?? run?.status ?? 'RUNNING'}
    data-agent-kind={requestKind}
    data-agent-display="unified"
  >
    {textOnlyAnswer && <div className="agent-answer-body" data-testid="agent-answer">
      {(terminalMessage?.content || streamingContent) && (
        <TimestampHover timestamp={terminalMessage?.created_at}><MarkdownMessage content={terminalMessage?.content || streamingContent} streaming={!terminal} onCopyError={onCopyError} references={terminalMessage?.references ?? []} onOpenReference={onOpenReference} onOpenImage={onOpenImage}/></TimestampHover>
      )}
    </div>}
    {!textOnlyAnswer && run && presentation && <>
      <div className="agent-terminal-runtime agent-running-header" data-testid="agent-running-header"><span>{status === 'CANCELLED' ? '已停止 · ' : status === 'FAILED' ? '已中断 · ' : ''}已处理 {presentation.elapsed}</span></div>
      <div className="agent-execution-detail is-history" data-testid="agent-execution-detail">
        <ConversationActivityStream items={activityItems} tools={tools} approval={approval} approvalSummary={approvalSummary} busy={busy} onDecision={onDecision} liveNarrative={liveNarrative} activityFiles={activityFiles}/>
      </div>
      {!terminal && <div className="agent-current-action" data-testid="agent-current-action"><span className={thinking && !stopping ? 'agent-running-label is-working' : 'agent-running-label'} data-testid="agent-running-label">{stopping ? '正在停止' : run.status === 'RUNNING' ? currentCompactAction(activityItems, tools, events) : currentRunStateLabel(run, events, tools, false)}</span></div>}
      {!terminal && approval && onDecision && !activityItems.some(item => item.kind === 'APPROVAL' && item.approvalId === approval.id) && <AgentApproval tool={tools.find(tool => tool.id === approval.tool_call_id) ?? null} summary={approvalSummary} busy={busy} onDecision={onDecision}/>}
      {!terminal && run.status === 'PAUSED' && <AgentProgressSummary run={run} tools={tools} busy={busy} onResume={onResume} onStop={onStop}/>}
      {!terminal && <CurrentRunMcp runtime={mcpRuntime} busyConnectionId={mcpBusyConnectionId} onActivate={onActivateMcp}/>}
    </>}
    {!textOnlyAnswer && terminal && status && (
      <AgentTerminalResult run={run} status={status} message={terminalMessage} presentation={presentation} tools={tools} partial={partial} review={review} onRetry={onRetry} onReview={onReview} onReviewFile={onReviewFile} onOpenReference={onOpenReference} onOpenImage={onOpenImage}/>
    )}
    {terminalMessage && onCopy && <footer className={`message-actions agent-turn-message-actions ${copied ? 'copy-confirmed' : ''}`}><button type="button" className={copied ? 'copied' : ''} aria-label={copied ? '消息已复制' : '复制消息'} title={copied ? '已复制' : '复制'} onClick={onCopy} data-testid="message-copy"><AppIcon name={copied ? 'check' : 'copy'}/>{copied && <span role="status" aria-live="polite">已复制</span>}</button></footer>}
  </section></ActivityDisclosureContext.Provider></ActivityNarrativeTimeContext.Provider></ActivityActiveToolContext.Provider></ActivityRunningContext.Provider>;
}
