import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { TimestampHover } from './UiPrimitives';
import type { AgentEventView, AgentRunView, AgentToolCallView, ApprovalView, ConversationMessageView, McpConnectionRuntimeView, ResultReference } from '@fielora/contracts';
import type { ResultImagePreviewView } from '../workspace-types';
import { appliedAgentReview, buildAgentReview, type AgentReviewSummary } from './agent-review';
import {
  buildConversationActivityProjection,
  applicationActivityGroups,
  computerApplicationActivity,
  compactOperationTimeline,
  reconcileLiveNarrative,
  type ConversationActivityEntry,
  type ConversationActivityGroupItem,
  type ConversationActivityGroupKind,
  type ConversationActivityItem,
} from './agent-activity-projection';

const ActivityRunningContext = createContext(false);
const ActivityActiveToolContext = createContext<string | null>(null);
const ActivityToolsContext = createContext<readonly AgentToolCallView[]>([]);
const ActivityNarrativeTimeContext = createContext<number | undefined>(undefined);
const ActivityReviewContext = createContext<((path: string) => void) | undefined>(undefined);
const ActivityApplicationContext = createContext<{
  icons?: Readonly<Record<string, string>>;
  onPreview?: (tool: AgentToolCallView) => void;
}>({});
type OperationDisclosure = { open: boolean; selected: string | null };
const ActivityDisclosureContext = createContext<{
  states: Record<string, OperationDisclosure>;
  update: (id: string, value: OperationDisclosure) => void;
}>({ states: {}, update: () => undefined });
import {
  agentRequestKind,
  commandApprovalReason,
  agentModelIsActive,
  agentPausePresentation,
  agentPendingChecks,
  agentCompletionTimeLabel,
  agentResultMarkdown,
  approvalActionLabel,
  buildAgentResultViewModel,
  buildAgentPresentation,
  toolDetail,
  toolTitle,
  type AgentPresentation,
  type AgentTerminalStatus,
} from './agent-presentation';
import { MarkdownMessage, type ActivityFileContext } from './MarkdownMessage';
import { webActivity, activityDetailFields, activityStatusLabel, activityFailureReason, activityToolIssue, browserLoadPauseReason, resolveActivityFileLink, shouldShowMcpRuntime, type ActivityFileLink } from './agent-activity-detail';
import { WebResearchActivity, WebResearchSummary } from './WebResearchActivity';
import { conversationToolPresentation, conversationTimelineSections } from './conversation-presentation';
import { ActivityApplicationIdentity } from './ActivityApplicationIdentity';
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
  onPreviewApplication?: (tool: AgentToolCallView) => void;
  applicationIcons?: Readonly<Record<string, string>>;
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

function activityTimestamp(timestamp: number): string {
  return agentCompletionTimeLabel(timestamp).replace(/^(?:完成于|结束于)\s+/, '');
}

function operationLabel(entry: ConversationActivityEntry): string {
  return entry.kind === 'TOOL' ? conversationToolPresentation(entry.tool).label : entry.title;
}

function operationIcon(entry: ConversationActivityEntry): AppIconName {
  return entry.kind === 'TOOL' ? conversationToolPresentation(entry.tool).icon : activityIcon(entry.activityKind);
}

function operationStatus(entry: ConversationActivityEntry) {
  return entry.kind === 'TOOL' ? conversationToolPresentation(entry.tool).status : entry.status;
}

function OperationDetail({ entry, activityFiles }: { entry: ConversationActivityEntry; activityFiles?: ActivityFileContext }) {
  const [copied, setCopied] = useState('');
  const displayStatus = operationStatus(entry);
  const fields = entry.kind === 'TOOL' ? activityDetailFields(entry.tool) : [{ label: '验证回执', text: entry.detail }];
  const issue = entry.kind === 'TOOL' ? activityToolIssue(entry.tool) : null;
  const path = fields.find(field => field.label === '操作对象')?.text;
  const file = path ? activityFiles?.resolve(`fielora-project-file:${path}`) : null;
  const command = entry.kind === 'TOOL' && entry.tool.name === 'run_command';
  const primary = new Set(['命令', '标准输出', '标准错误', '输出', '错误', '错误码']);
  const renderField = (field: (typeof fields)[number]) => <div className={`operation-detail-field${field.code ? ' is-code' : ''}`} key={field.label}>
    <div className="operation-detail-heading"><span>{field.label}</span><button type="button" aria-label={`复制${field.label}`} onClick={() => {
      void window.fielora.clipboard.writeText(field.text).then(() => setCopied(`${field.label}已复制`), () => setCopied(`${field.label}复制失败`));
    }}><AppIcon name="copy"/></button>{field.label === '操作对象' && file && activityFiles?.open && <button type="button" onClick={() => activityFiles.open?.(file)}>打开文件</button>}</div>
    {field.code ? <pre tabIndex={0}>{field.text}</pre> : <div className="operation-detail-value">{field.text}</div>}
  </div>;
  return <section className="operation-detail" id={`detail-${entry.id}`} data-testid="operation-detail" aria-label="操作详情">
    {!command && <header className="operation-detail-title"><AppIcon name={operationIcon(entry)}/><strong>{operationLabel(entry)}</strong><span data-status={displayStatus}>{activityStatusLabel(displayStatus, entry.kind === 'TOOL' ? entry.tool.error_code : null)}</span></header>}
    {fields.length === 0 && <p>该历史记录未保存执行详情。</p>}
    {fields.filter(field => field.label !== '回执' && (!command || primary.has(field.label))).map(renderField)}
    {command && !fields.some(field => ['标准输出', '标准错误', '输出'].includes(field.label)) && <p className="operation-output-note">该记录未保存命令输出正文。</p>}
    {issue && <p>{issue}</p>}
    {(command || fields.some(field => field.label === '回执')) && <details className="operation-receipt"><summary>{command ? '执行信息与回执' : '原始回执'}<AppIcon name="chevronDown"/></summary>{fields.filter(field => field.label === '回执' || (command && !primary.has(field.label))).map(renderField)}</details>}
    <footer><span>{activityStatusLabel(displayStatus, entry.kind === 'TOOL' ? entry.tool.error_code : null)}</span>{entry.occurredAt > 0 && <time>开始于 {activityTimestamp(entry.occurredAt)}</time>}{entry.completedAt !== null && <time>结束于 {activityTimestamp(entry.completedAt)}</time>}</footer>
    {copied && <span role="status">{copied}</span>}
  </section>;
}

function OperationRow({ entry, expanded, toggle, activityFiles, single = false }: {
  entry: ConversationActivityEntry; expanded: boolean; toggle: () => void; activityFiles?: ActivityFileContext; single?: boolean;
}) {
  const onReviewFile = useContext(ActivityReviewContext);
  const applications = useContext(ActivityApplicationContext);
  const tool = entry.kind === 'TOOL' ? entry.tool : null;
  const application = tool ? computerApplicationActivity(tool) : null;
  const args = tool?.arguments as Record<string, unknown> | null;
  const readPath = tool?.name === 'read_file' && typeof args?.path === 'string' ? args.path : '';
  const succeeded = operationStatus(entry) === 'COMPLETED';
  const read = readPath && tool && succeeded ? resolveActivityFileLink(`fielora-project-file:${readPath}`, [tool]) : null;
  const changes = tool && succeeded ? buildAgentReview([tool]).files : [];
  const linked = Boolean((read && activityFiles?.open) || (changes.length && onReviewFile));
  const label = operationLabel(entry);
  const toggleProps = { 'aria-expanded': expanded, 'aria-controls': `detail-${entry.id}`, onClick: toggle };
  if (application?.target && tool) return <>
    <div className="operation-row-content application-operation-row" data-operation-status={operationStatus(entry)}>
      <ActivityApplicationIdentity target={application.target} iconDataUrl={applications.icons?.[application.target.appId]} detail={application.label} previewToolId={tool.id} onPreview={application.canPreview && applications.onPreview ? () => applications.onPreview?.(tool) : undefined}/>
      <span className="operation-label">{application.label}</span>
      <button type="button" className="operation-disclosure" data-testid={single ? 'operation-group-toggle' : 'operation-detail-toggle'} aria-label={`${expanded ? '收起' : '展开'}${label}的执行详情`} {...toggleProps}><AppIcon name="chevronDown"/></button>
    </div>
    {expanded && <OperationDetail entry={entry} activityFiles={activityFiles}/>}
  </>;
  return <>
    <div className="operation-row-content" data-operation-status={operationStatus(entry)}>
      {linked ? <>
        <AppIcon name={operationIcon(entry)}/>
        <span className="operation-file-action">{read ? '已读取' : tool?.name === 'create_file' ? '已创建' : tool?.name === 'delete_file' ? '已删除' : tool?.name === 'move_file' ? '已移动' : '已编辑'}</span>
        <span className="operation-file-targets">
          {read ? <button type="button" className="operation-file-link" title={read.path} onClick={() => activityFiles?.open?.(read)}>{read.path}</button>
            : changes.map(file => <span className="operation-file-change" key={file.path}><button type="button" className="operation-file-link" title={file.path} onClick={() => onReviewFile?.(file.path)}>{file.path}</button>{(file.additions > 0 || file.deletions > 0) && <small>+{file.additions} −{file.deletions}</small>}</span>)}
        </span>
        <button type="button" className="operation-disclosure" data-testid={single ? 'operation-group-toggle' : 'operation-detail-toggle'} aria-label={`${expanded ? '收起' : '展开'}${label}的执行详情`} {...toggleProps}><AppIcon name="chevronDown"/></button>
      </> : <button type="button" className="operation-summary" data-testid={single ? 'operation-group-toggle' : 'operation-detail-toggle'} {...toggleProps} title={label}>
        <AppIcon name={operationIcon(entry)}/><span className="operation-label">{label}</span><AppIcon name="chevronDown"/>
      </button>}
    </div>
    {expanded && <OperationDetail entry={entry} activityFiles={activityFiles}/>}
  </>;
}

function CompactActivityGroup({ item, activityFiles }: { item: ConversationActivityGroupItem; activityFiles?: ActivityFileContext }) {
  const running = useContext(ActivityRunningContext);
  const tools = useContext(ActivityToolsContext);
  const activeToolId = useContext(ActivityActiveToolContext);
  const disclosure = useContext(ActivityDisclosureContext);
  const applicationContext = useContext(ActivityApplicationContext);
  const applications = applicationActivityGroups(item.entries);
  const state = disclosure.states[item.id] ?? { open: false, selected: null };
  const single = item.entries.length === 1;
  const first = item.entries[0]!;
  const active = running && item.entries.some(entry => entry.kind === 'TOOL' && entry.toolId === activeToolId);
  const issues = [...new Set(item.entries.filter(entry => ['FAILED', 'UNKNOWN', 'DENIED', 'CANCELLED', 'WAITING_APPROVAL'].includes(operationStatus(entry))).map(entry => activityStatusLabel(operationStatus(entry), entry.kind === 'TOOL' ? entry.tool.error_code : null)))];
  const categories: Record<ConversationActivityGroupKind, string> = { INSPECT: '读取信息', SEARCH: '搜索', DIRECTORY: '查看目录', CHANGE: '编辑文件', COMMAND: '运行命令', VERIFY: '执行检查', VERSION: '版本操作', NETWORK: '访问服务', OTHER: '工具操作', MIXED: '工具操作' };
  const kinds = [...new Set(item.entries.map(entry => entry.kind === 'TOOL' && entry.tool.name === 'computer' ? '应用操作' : entry.kind === 'TOOL' && entry.tool.name === 'run_command' ? '运行命令' : entry.kind === 'TOOL' && entry.tool.name === 'read_file' ? '读取文件' : categories[entry.activityKind]))];
  const completed = item.entries.every(entry => operationStatus(entry) === 'COMPLETED');
  const lastWeb = [...item.entries].reverse().find(entry => entry.kind === 'TOOL' && webActivity(entry.tool));
  const label = lastWeb ? `${operationLabel(lastWeb)} · 共 ${item.entries.length} 项操作`
    : `${completed ? '已执行' : '执行记录'} ${item.entries.length} 项操作 · ${kinds.slice(0, 2).join('、')}${kinds.length > 2 ? '等' : ''}`;
  if (single && first.kind === 'TOOL' && ['web.search', 'web.fetch'].includes(first.tool.name)) return <div className="operation-group research-operation" data-testid="compact-category" data-single="true" data-activity-sequence={item.sequence}>
    <WebResearchActivity tool={first.tool} tools={tools} running={running}/>
    <button type="button" className="research-detail-toggle" data-testid="operation-group-toggle" aria-expanded={state.open} aria-controls={`detail-${first.id}`} onClick={() => disclosure.update(item.id, { open: !state.open, selected: first.id })}>执行详情<AppIcon name="chevronDown"/></button>
    {state.open && <OperationDetail entry={first} activityFiles={activityFiles}/>}
  </div>;
  return <div className={`operation-group${active ? ' is-working' : ''}`} data-testid="compact-category" data-single={single} data-activity-sequence={item.sequence}>
    {single ? <OperationRow entry={first} single expanded={state.open} toggle={() => disclosure.update(item.id, { open: !state.open, selected: first.id })} activityFiles={activityFiles}/> : <>
    <div className={applications.length ? 'application-operation-summary' : undefined}>
      {applications.map(application => <ActivityApplicationIdentity key={application.target.appId || application.target.bundleId} target={application.target} iconDataUrl={applicationContext.icons?.[application.target.appId]} detail={application.label} previewToolId={application.previewTool?.id} onPreview={application.previewTool && applicationContext.onPreview ? () => applicationContext.onPreview?.(application.previewTool!) : undefined}/>)}
    <button type="button" className="operation-summary" title={label} data-testid="operation-group-toggle" aria-expanded={state.open} aria-controls={`operations-${item.id}`} onClick={() => disclosure.update(item.id, { ...state, open: !state.open })}>
      {!applications.length && <AppIcon name={operationIcon(first)}/>}<span className="operation-label">{label}</span>
      {issues.length > 0 && <span className="operation-issue">{issues.join('、')}</span>}
      {active && <span>执行中</span>}<AppIcon name="chevronDown"/>
    </button>
    </div>
    <div id={`operations-${item.id}`} hidden={!state.open}>
      {state.open && <ol className="operation-list" data-testid="operation-list" aria-label="操作列表">{item.entries.map(entry => <li key={entry.id} data-testid="operation-row" data-activity-entry={entry.kind.toLowerCase()} data-activity-status={operationStatus(entry)}>
        <OperationRow entry={entry} expanded={state.selected === entry.id} toggle={() => disclosure.update(item.id, { open: true, selected: state.selected === entry.id ? null : entry.id })} activityFiles={activityFiles}/>
      </li>)}</ol>}
    </div>
    </>}
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
    <span>{item.decision === 'ALLOW_ONCE' ? item.requiredConfirmations === 2 && item.confirmationStage === 1 ? '已确认范围，尚未执行' : '已允许本次操作' : item.decision === 'DENY' ? '已拒绝本次操作' : '等待操作确认'}</span>{label && <small>{label}</small>}
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
  const sections = useMemo(() => conversationTimelineSections(visibleItems), [visibleItems]);
  const [openArchives, setOpenArchives] = useState<Record<string, boolean>>({});
  const historyScope = useId();
  const renderItem = (item: ConversationActivityItem): ReactNode => {
    if (item.kind === 'GROUP') return <ActivityGroup item={item} key={item.id} activityFiles={activityFiles}/>;
    if (item.kind === 'CONTEXT') return <ContextActivity item={item} key={item.id}/>;
    if (item.kind === 'NARRATIVE') return <NarrativeBlock text={item.text} sequence={item.sequence} timestamp={item.occurredAt} key={item.id} activityFiles={activityFiles}/>;
    if (item.kind === 'PHASE') return <TimestampHover timestamp={item.occurredAt} key={item.id}><p className="conversation-activity-phase" data-activity-sequence={item.sequence}><AppIcon name={item.phase === 'PAUSED' ? 'pause' : item.phase === 'VERIFY' ? 'verified' : item.phase === 'EDIT' ? 'edit' : item.phase === 'RESUMED' ? 'run' : 'history'}/><span>{item.title}</span></p></TimestampHover>;
    if (approval?.id === item.approvalId && onDecision && !item.completedAt) {
      const tool = tools.find(candidate => candidate.id === item.toolCallId) ?? null;
      return <AgentApproval key={`${item.id}:${approval.nonce}`} approval={approval} tool={tool} summary={approvalSummary} busy={busy} onDecision={onDecision}/>;
    }
    return <ActivityApprovalRecord item={item} key={item.id}/>;
  };
  return <div className="conversation-activity-stream" data-testid="conversation-activity-stream" data-activity-count={visibleItems.length}>
    {sections.map(section => {
      if (section.kind === 'ITEM') return renderItem(section.item);
      const open = Boolean(openArchives[section.id]);
      const summary = section.summary;
      const regionId = `history-${historyScope}-${section.id}`;
      return <section className="activity-history" key={section.id} data-testid="activity-history" data-activity-sequence={section.items[0]?.sequence}>
        <button type="button" className="activity-history-toggle" data-testid="activity-history-toggle" aria-expanded={open} aria-controls={regionId} onClick={() => setOpenArchives(previous => ({ ...previous, [section.id]: !open }))}>
          <AppIcon name="history"/><strong>{summary.label}</strong><span className="activity-history-action">{open ? '收起' : '展开'}</span><AppIcon name="chevronDown"/>
        </button>
        {(summary.failedCount > 0 || summary.unknownCount > 0 || summary.deniedCount > 0 || summary.cancelledCount > 0) && <div className="activity-failure-summary" data-testid="activity-failure-summary">
          <AppIcon name="warning"/><span>{[summary.failedCount > 0 ? `${summary.failedCount} 次执行失败` : '', summary.unknownCount > 0 ? `${summary.unknownCount} 次结果未知` : '', summary.deniedCount > 0 ? `${summary.deniedCount} 次被拒绝` : '', summary.cancelledCount > 0 ? `${summary.cancelledCount} 次取消` : ''].filter(Boolean).join(' · ')}{summary.latestFailure && <small>最近一次：{summary.latestFailure}</small>}</span>
        </div>}
        <div className="activity-history-region" id={regionId} data-testid="activity-history-region" hidden={!open}>{open && section.items.map(renderItem)}</div>
      </section>;
    })}
    {liveNarrative && <NarrativeBlock text={liveNarrative} streaming activityFiles={activityFiles}/>}

  </div>;
}

function AgentProgressSummary({ run, tools, events, busy, onResume, onStop }: {
  run: AgentRunView; tools: AgentToolCallView[]; events: AgentEventView[]; busy: boolean;
  onResume?: () => void; onStop?: () => void;
}) {
  const pending = agentPendingChecks(run, events);
  const clarification = run.error_code === 'AGENT_USER_INPUT_REQUIRED'
    ? [...tools].reverse().find(tool => tool.name === 'request_user_input' && tool.status === 'COMPLETED')?.arguments as { question?: string; reason?: string } | undefined : undefined;
  return <div className="agent-progress-summary" data-testid="agent-execution-status" data-execution-stage={run.status}>
    <div className="agent-pause-notice" data-testid="agent-pause-notice">
      <div className="agent-pause-heading"><AppIcon name={clarification ? 'conversation' : 'pause'}/><strong>{clarification ? '需要你的回答' : '任务已暂停'}</strong></div>
      {clarification?.question && <div className="agent-user-question" data-testid="agent-visible-question">{clarification.reason && <p>{clarification.reason}</p>}<p>{clarification.question}</p></div>}
      <p>{(run.error_code === 'AGENT_VERIFICATION_REQUIRED' ? browserLoadPauseReason(tools) : null) ?? agentPausePresentation(run, events).reason}</p>
      {pending.length > 0 && <div className="agent-pending-list" data-testid="agent-pending-checks"><strong>待解决的检查</strong><ul>{pending.map((check, index) => <li key={`${index}-${check}`}><AppIcon name="warning"/><span>{check}</span></li>)}</ul></div>}
      <div className="agent-pause-actions" aria-busy={busy}>
        {onResume && agentPausePresentation(run).canResume && <button type="button" className="agent-resume-action is-primary" disabled={busy} onClick={onResume}>{agentPausePresentation(run).action}</button>}
        {onStop && <button type="button" className="agent-resume-action" disabled={busy} onClick={onStop}>停止任务</button>}
      </div>
    </div>
  </div>;
}

function AgentApproval({ approval, tool, summary, busy, onDecision }: {
  approval: ApprovalView;
  tool: AgentToolCallView | null;
  summary: string;
  busy: boolean;
  onDecision: (decision: 'DENY' | 'ALLOW_ONCE') => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const policy = tool?.arguments && typeof tool.arguments === 'object' ? (tool.arguments as Record<string, unknown>)._operation_policy as Record<string, unknown> | undefined : undefined;
  const facts = policy?.facts as Record<string, unknown> | undefined;
  const second = approval.required_confirmations === 2 && approval.confirmation_stage === 2;
  const operationTitle = policy?.kind === 'CLEAR_SCOPE' ? (second ? '再次确认清空范围' : '确认清空范围（第 1 次）') : policy?.kind === 'LOCAL_DATA_UPLOAD' ? '确认发送本地数据' : policy?.kind === 'COMPUTER_OBSERVATION' ? (facts?.modality === 'WINDOW_IMAGE' ? '允许模型查看此应用的窗口画面' : '允许本任务查看此应用') : null;
  const commandReason = commandApprovalReason(tool);
  const mcpActivation = tool?.name === 'mcp.activate_connection';
  const install = tool?.name === 'tools.install' && tool.arguments && typeof tool.arguments === 'object'
    ? (tool.arguments as Record<string, unknown>)._installation_preview as Record<string, unknown> | undefined : undefined;
  const fontInstall = tool?.name === 'fonts.install' && tool.arguments && typeof tool.arguments === 'object'
    ? (tool.arguments as Record<string, unknown>)._installation_preview as { source: string; install_directory: string; font: { families: Array<{ family: string }>; bytes: number; sha256: string } } | undefined : undefined;
  const connectionId = mcpActivation && tool?.arguments && typeof tool.arguments === 'object' && 'connection_id' in tool.arguments
    ? String((tool.arguments as { connection_id?: unknown }).connection_id ?? '') : '';
  return <section className="agent-turn-approval" data-testid="agent-approval">
    <p>{operationTitle ?? (fontInstall ? `安装字体 ${fontInstall.font.families.map(f => f.family).join("、")}` : install ? `安装工具 ${String(install.name)}${install.version ? ` ${String(install.version)}` : ''}` : mcpActivation ? `Start local MCP Server “${connectionId}” for this Run` : commandReason ? '此命令需要批准' : '我已经定位到需要执行的下一步。')}</p>
    {operationTitle && <div className="agent-operation-preview" data-testid="operation-approval-preview">
      <p>{String(facts?.disclosure ?? facts?.description ?? '')}</p>
      {policy?.kind === 'CLEAR_SCOPE' && <p>{second ? '第一次确认已记录，尚未执行。再次确认后才会清空以下范围；取消将保留现有内容。' : '本次确认不会执行删除，之后仍需你再次明确确认。'}</p>}
      {Array.isArray(facts?.targets) && facts.targets.map((target, index) => <p key={index}>{String((target as Record<string, unknown>).path)}</p>)}
      {Array.isArray(facts?.sources) && facts.sources.map((source, index) => <p key={index}>{String((source as Record<string, unknown>).path)} · {String((source as Record<string, unknown>).bytes ?? '未知')} 字节</p>)}
      {Array.isArray(facts?.destinations) && <p>发送至：{facts.destinations.map(String).join('、')}</p>}
      {policy?.kind === 'COMPUTER_OBSERVATION' && <><p>应用：{String((facts?.target as Record<string, unknown>)?.name ?? '')} · 模型：{String(facts?.model ?? '')}</p><p>接收服务：{String(facts?.receiving_service ?? '当前模型服务')}</p>{detailsOpen && <p>{String((facts?.target as Record<string, unknown>)?.executable ?? '')} · PID {String((facts?.target as Record<string, unknown>)?.pid ?? '')}</p>}</>}
    </div>}
    {!operationTitle && commandReason && <p data-testid="command-approval-reason">{commandReason}</p>}
    {install && <dl className="agent-install-preview" data-testid="agent-install-preview">
      <dt>来源</dt><dd>{String(install.source_url)}</dd>
      <dt>下载大小</dt><dd>{Number(install.archive_bytes) < 1024 * 1024 ? `${Number(install.archive_bytes).toLocaleString()} 字节` : `${(Number(install.archive_bytes) / 1024 / 1024).toFixed(2)} MiB`}</dd>
      <dt>安装位置</dt><dd>{String(install.target_path)}</dd>
      <dt>SHA-256</dt><dd>{String(install.archive_sha256)}</dd>
      <dt>影响</dt><dd>仅解包到项目隔离目录；不修改系统或 PATH，不运行安装脚本。安装后另行检查兼容性。</dd>
      <dt>需要确认</dt><dd>{install.source_trust !== 'OFFICIAL_PROVIDER' ? '来源未列入可信供应商。' : '下载超过 20 MiB，或当前权限要求审批。'}</dd>
    </dl>}
    {fontInstall && <dl className="agent-install-preview" data-testid="agent-font-install-preview">
      <dt>来源</dt><dd>{fontInstall.source}</dd><dt>大小</dt><dd>{(fontInstall.font.bytes / 1024).toFixed(1)} KB</dd>
      <dt>安装位置</dt><dd>{fontInstall.install_directory}</dd><dt>SHA-256</dt><dd>{fontInstall.font.sha256}</dd>
      <dt>影响</dt><dd>安装到当前用户的系统字体目录，供其他软件使用。不覆盖已有文件，不运行脚本。</dd>
    </dl>}
    {!install && !fontInstall && <p>{mcpActivation ? '这会启动已配置的本地进程并发现有界 Tools；不会授予后续 Tool 权限。' : summary || (tool ? `${toolTitle(tool.name)} · ${toolDetail(tool)}` : '只会执行当前列出的操作，不会扩大范围。')}</p>}
    {detailsOpen && tool && <OperationDetail entry={{ id: `tool-${tool.id}`, kind: 'TOOL', toolId: tool.id, tool, status: tool.status, activityKind: 'OTHER', sequence: 0, occurredAt: tool.created_at, completedAt: null }}/>}
    <div><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>{fontInstall ? '查看安装详情' : install || commandReason ? '查看执行详情' : '查看修改范围'}</button><button type="button" onClick={() => onDecision('DENY')} disabled={busy}>拒绝</button><button type="button" className="agent-primary-action" onClick={() => onDecision('ALLOW_ONCE')} disabled={busy} data-testid="agent-allow-once">{operationTitle ? policy?.kind === 'CLEAR_SCOPE' ? second ? '再次确认并执行清空' : '确认范围，进入第二次确认' : policy?.kind === 'LOCAL_DATA_UPLOAD' ? '允许本次发送' : '允许本任务查看此应用' : install || fontInstall ? '允许本次安装' : approvalActionLabel(tool)}</button></div>
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
      <span className="agent-result-changes-title"><strong>已编辑 {review.files.length} 个文件</strong><span className="file-delivery-totals" aria-label={`新增 ${review.additions} 行，删除 ${review.deletions} 行`}><b>+{review.additions}</b><i>−{review.deletions}</i></span></span>
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

function AgentTerminalResult({ run, status, message, presentation, tools, partial, review, onRetry, onReview, onReviewFile, onOpenReference, onOpenImage, activityFiles }: {
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
  activityFiles?: ActivityFileContext;
}) {
  const result = buildAgentResultViewModel(status, message?.content ?? '', presentation, tools);
  const editedReview = appliedAgentReview(review);
  const markdown = agentResultMarkdown(status, message?.content || result.detail);
  const failureReason = activityFailureReason(run);
  return <div className="agent-terminal-result" data-testid="agent-terminal-result" data-result-outcome={presentation?.outcome ?? status}>
    <TimestampHover timestamp={message?.created_at}><div className="agent-terminal-body"><MarkdownMessage content={markdown} references={message?.references ?? []} onOpenReference={onOpenReference} onOpenImage={onOpenImage} activityFiles={activityFiles} modernStatusMarkers/></div></TimestampHover>
    {failureReason && <p className="agent-failure-reason" data-testid="agent-failure-reason">{failureReason}</p>}
    {result.verificationEvidence && <details className="agent-result-verification" data-testid="agent-result-verification">
      <summary><span>{result.verificationEvidence.label}</span><AppIcon name="chevronDown"/></summary>
      <p>{result.verificationEvidence.detail}</p>
      <ul>{result.verificationEvidence.checks.map(check => <li key={check.id}><span>{check.state}</span><code>{check.command}</code></li>)}</ul>
    </details>}
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
  onOpenActivityFile, mcpRuntime = null, mcpBusyConnectionId = '', onActivateMcp, onPreviewApplication, applicationIcons,
}: AgentTurnProps) {
  const [disclosures, setDisclosures] = useState<Record<string, OperationDisclosure>>({});
  const disclosureScope = run?.id ?? 'historical';
  const disclosure = {
    states: Object.fromEntries(Object.entries(disclosures).filter(([id]) => id.startsWith(`${disclosureScope}:`)).map(([id, value]) => [id.slice(disclosureScope.length + 1), value])),
    update: (id: string, value: OperationDisclosure) => setDisclosures(previous => ({ ...previous, [`${disclosureScope}:${id}`]: value })),
  };
  const terminal = Boolean(terminalMessage) || isTerminalRun(run);
  // Keep the live stream mounted, but start each terminal result collapsed.
  // A terminal message may arrive after the status event; neither should reset
  // an explicit user disclosure or hide a later resumed/approval state.
  const [historyDisclosures, setHistoryDisclosures] = useState<Record<string, boolean>>({});
  const historyKey = `${disclosureScope}:${run?.finished_at ?? terminalMessage?.id ?? 'active'}`;
  const historyOpen = !terminal || Boolean(historyDisclosures[historyKey]);
  const historyId = `agent-history-${disclosureScope}`;
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
  const pausedReview = run?.status === 'PAUSED' ? appliedAgentReview(review ?? buildAgentReview(tools)) : null;
  const currentAction = stopping ? '正在停止' : run?.status === 'RUNNING' ? currentCompactAction(activityItems, tools, events) : '';

  return <ActivityApplicationContext.Provider value={{ icons: applicationIcons, onPreview: onPreviewApplication }}><ActivityToolsContext.Provider value={tools}><ActivityReviewContext.Provider value={onReviewFile}><ActivityRunningContext.Provider value={Boolean(run?.status === 'RUNNING' && !terminal)}><ActivityActiveToolContext.Provider value={activeToolId}><ActivityNarrativeTimeContext.Provider value={invocationTime}><ActivityDisclosureContext.Provider value={disclosure}><section
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
      {terminal ? <button type="button" className="agent-terminal-runtime agent-running-header agent-history-toggle" data-testid="agent-history-toggle" aria-label={`${status === 'CANCELLED' ? '已停止' : status === 'FAILED' ? '已中断' : '本轮结束'}，用时 ${presentation.elapsed}，${historyOpen ? '收起' : '展开'}过程`} aria-expanded={historyOpen} aria-controls={historyId} onClick={() => setHistoryDisclosures(previous => ({ ...previous, [historyKey]: !historyOpen }))}>
        <span className="agent-elapsed">用时 {presentation.elapsed}</span><AppIcon name="chevronDown"/>
      </button> : <div className="agent-terminal-runtime agent-running-header" data-testid="agent-running-header"><span className="agent-run-state" data-status={run.status}><AppIcon name={run.status === 'PAUSED' ? 'pause' : run.status === 'WAITING_APPROVAL' ? 'permissionAsk' : 'now'}/>{run.status === 'PAUSED' ? '已暂停' : run.status === 'WAITING_APPROVAL' ? '等待确认' : '任务进行中'}</span><span className="agent-elapsed">已处理 {presentation.elapsed}</span></div>}
      <div className="agent-execution-detail is-history" data-testid="agent-execution-detail" id={historyId} hidden={!historyOpen}>
        <ConversationActivityStream key={run.id} items={activityItems} tools={tools} approval={approval} approvalSummary={approvalSummary} busy={busy} onDecision={onDecision} liveNarrative={liveNarrative} activityFiles={activityFiles}/>
        {terminal && run.error_code && <p className="agent-run-error-detail">结束原因：<code>{run.error_code}</code></p>}
      </div>
      {!terminal && currentAction && <div className="agent-current-action" data-testid="agent-current-action"><span className={thinking && !stopping ? 'agent-running-label is-working' : 'agent-running-label'} data-testid="agent-running-label">{currentAction}</span></div>}
      {!terminal && approval && onDecision && !activityItems.some(item => item.kind === 'APPROVAL' && item.approvalId === approval.id) && <AgentApproval approval={approval} tool={tools.find(tool => tool.id === approval.tool_call_id) ?? null} summary={approvalSummary} busy={busy} onDecision={onDecision}/>}
      {!terminal && run.status === 'PAUSED' && <AgentProgressSummary run={run} tools={tools} events={events} busy={busy} onResume={onResume} onStop={onStop}/>}
      {!terminal && pausedReview && pausedReview.files.length > 0 && <ChangedFiles review={pausedReview} onReview={onReview} onReviewFile={onReviewFile}/>}
      {!terminal && <CurrentRunMcp runtime={mcpRuntime} busyConnectionId={mcpBusyConnectionId} onActivate={onActivateMcp}/>}
    </>}
    {!textOnlyAnswer && terminal && status && (
      <AgentTerminalResult run={run} status={status} message={terminalMessage} presentation={presentation} tools={tools} partial={partial} review={review} onRetry={onRetry} onReview={onReview} onReviewFile={onReviewFile} onOpenReference={onOpenReference} onOpenImage={onOpenImage} activityFiles={activityFiles}/>
    )}
    {!textOnlyAnswer && terminal && !historyOpen && <WebResearchSummary tools={tools}/>}
    {terminalMessage && onCopy && <footer className={`message-actions agent-turn-message-actions ${copied ? 'copy-confirmed' : ''}`}><button type="button" className={copied ? 'copied' : ''} aria-label={copied ? '消息已复制' : '复制消息'} title={copied ? '已复制' : '复制'} onClick={onCopy} data-testid="message-copy"><AppIcon name={copied ? 'check' : 'copy'}/>{copied && <span role="status" aria-live="polite">已复制</span>}</button></footer>}
  </section></ActivityDisclosureContext.Provider></ActivityNarrativeTimeContext.Provider></ActivityActiveToolContext.Provider></ActivityRunningContext.Provider></ActivityReviewContext.Provider></ActivityToolsContext.Provider></ActivityApplicationContext.Provider>;
}
