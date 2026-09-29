import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AgentDisplayContext } from './agent-display';
import { TimestampHover, TimestampSummary } from './UiPrimitives';
import type { AgentEventView, AgentRunView, AgentToolCallView, ApprovalView, ConversationMessageView, McpConnectionRuntimeView, ResultReference } from '@fielora/contracts';
import type { ResultImagePreviewView } from '../workspace-types';
import { appliedAgentReview, buildAgentReview, type AgentReviewSummary } from './agent-review';
import {
  buildConversationActivityProjection,
  compactOperationTimeline,
  currentActivityPreview,
  reconcileLiveNarrative,
  type ConversationActivityEntry,
  type ConversationActivityGroupItem,
  type ConversationActivityGroupKind,
  type ConversationActivityItem,
} from './agent-activity-projection';

const ActivityRunningContext = createContext(false);
const ActivityActiveToolContext = createContext<string | null>(null);
const ActivityNarrativeTimeContext = createContext<number | undefined>(undefined);
const ActivityReviewContext = createContext<{ review: AgentReviewSummary | null; open?: (path: string) => void }>({ review: null });
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
import { goalProgressLabel, activityFailureReason, activityToolDescription, activityToolIssue, browserLoadPauseReason, resolveActivityFileLink, shouldShowMcpRuntime, type ActivityFileLink } from './agent-activity-detail';
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

function LiveEditedFiles({ review, stable, onReviewFile }: {
  review: AgentReviewSummary;
  stable: boolean;
  onReviewFile?: (path: string) => void;
}) {
  const visible = review.files.slice(0, 6);
  const remaining = Math.max(0, review.files.length - visible.length);
  return <section className="agent-live-files" data-testid="agent-live-edited-files" data-file-count={review.files.length} data-additions={review.additions} data-deletions={review.deletions}>
    <header><span>本轮已更改文件</span><small><b>+{review.additions}</b><i>−{review.deletions}</i></small></header>
    <div>{visible.map((file) => {
      const canOpen = stable && Boolean(onReviewFile);
      return <button type="button" key={file.path} disabled={!canOpen} onClick={() => canOpen && onReviewFile?.(file.path)} data-live-review-path={file.path} title={canOpen ? '打开 Human Review' : '任务完成后可打开 Review'}>
        <span>{fileName(file.path)}</span><small><b>+{file.additions}</b><i>−{file.deletions}</i></small>
      </button>;
    })}</div>
    {remaining > 0 && <p>再显示 {remaining} 个文件</p>}
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
    const title = tool.effect === 'OBSERVE' ? '检查了相关信息'
      : tool.effect === 'WORKSPACE_WRITE' || tool.effect === 'DESTRUCTIVE' ? '更新了项目文件'
        : tool.effect === 'PROCESS' ? '运行了命令'
          : tool.effect === 'NETWORK' ? '访问了外部服务'
            : '执行了一项操作';
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

function activityResult(kind: ConversationActivityGroupKind, entry: ConversationActivityEntry): string {
  if (kind === 'VERIFY' || entry.activityKind === 'VERIFY') {
    if (entry.status === 'COMPLETED') return 'PASS';
    if (['FAILED', 'UNKNOWN', 'DENIED', 'CANCELLED'].includes(entry.status)) return 'FAIL';
    return '';
  }
  if (entry.status === 'FAILED' || entry.status === 'UNKNOWN') return '未完成';
  if (entry.status === 'DENIED') return '已拒绝';
  if (entry.status === 'CANCELLED') return '已取消';
  return '';
}

function activityTimestamp(timestamp: number): string {
  return agentCompletionTimeLabel(timestamp).replace(/^(?:完成于|结束于)\s+/, '');
}

function CompactActivityRows({ item, activityFiles, flat = false }: { item: ConversationActivityGroupItem; activityFiles?: ActivityFileContext; flat?: boolean }) {
  const running = useContext(ActivityRunningContext);
  const review = useContext(ActivityReviewContext);
  const activeToolId = useContext(ActivityActiveToolContext);
  const [copyState, setCopyState] = useState<{ id: string; message: string } | null>(null);
  return <div className="compact-activity-group" data-testid="compact-activity-group">{item.entries.map(entry => {
    const tool = entry.kind === 'TOOL' ? entry.tool : null;
    const presentation = tool ? activityToolPresentation(tool) : { title: entry.kind === 'VERIFICATION' ? entry.title : '', command: false };
    const description = tool ? activityToolDescription(tool) : entry.kind === 'VERIFICATION' ? entry.detail : '';
    const receipt = tool?.receipt as Record<string, unknown> | null;
    const args = tool?.arguments as Record<string, unknown> | undefined;
    const changed = tool && entry.status === 'COMPLETED' && tool.effect === 'WORKSPACE_WRITE' ? buildAgentReview([tool]).files.filter(file => file.state === 'APPLIED') : [];
    const path = typeof args?.path === 'string' ? args.path : changed[0]?.path ?? '';
    const file = changed.find(file => file.path === path);
    const fileLink = path ? activityFiles?.resolve(`fielora-project-file:${path}`) : null;
    const openFile = file && review.open ? () => review.open?.(path) : fileLink && activityFiles?.open ? () => activityFiles.open?.(fileLink) : null;
    const active = running && entry.kind === 'TOOL' && entry.toolId === activeToolId;
    const failed = activityResult(item.groupKind, entry);
    const duration = typeof receipt?.duration_ms === 'number' ? `${Math.max(1, Math.round(receipt.duration_ms / 1000))} 秒` : '';
    const label = presentation.command ? `${active ? '正在运行' : entry.status === 'COMPLETED' ? duration ? `已在 ${duration} 内运行` : '已运行' : '命令'} ${description}`
      : file ? `已编辑 ${fileName(path)}` : `${presentation.title}${description ? ` ${description}` : ''}`;
    return <TimestampHover key={entry.id} timestamp={entry.completedAt ?? entry.occurredAt}><details open={flat || undefined} aria-label={flat ? label : undefined} className={`compact-activity-row${active ? ' is-working' : ''}`} data-testid="compact-activity-row" data-activity-status={entry.status} data-activity-sequence={entry.sequence}>
      <summary hidden={flat} title={path || label}>
        <AppIcon name={tool && isImageActivity(tool) ? 'images' : presentation.command ? 'terminal' : activityIcon(entry.activityKind)}/>
        <span className="compact-activity-label">{openFile ? <><span>{file ? '已编辑 ' : `${presentation.title} `}</span><button type="button" className="compact-file-link" title={path} onClick={event => { event.preventDefault(); event.stopPropagation(); openFile(); }}>{fileName(path)}</button></> : label}</span>
        {file && <small>{changed.length > 1 ? `共 ${changed.length} 个文件` : `+${file.additions} −${file.deletions}`}</small>}
        {failed && failed !== 'PASS' && <em>{failed === 'FAIL' ? '未通过' : failed}</em>}<AppIcon name="chevronDown"/>
      </summary>
      <div className="compact-command-panel" data-testid="compact-operation-detail">
        <div className="compact-panel-heading"><small>{presentation.command ? 'Shell' : presentation.title}</small>{presentation.command && <button type="button" aria-label="复制命令" title={copyState?.id === entry.id ? copyState.message : '复制命令'} onClick={() => { void window.fielora.clipboard.writeText(description).then(() => setCopyState({ id: entry.id, message: '已复制' }), () => setCopyState({ id: entry.id, message: '复制失败' })); }}><AppIcon name={copyState?.id === entry.id && copyState.message === '已复制' ? 'check' : 'copy'}/></button>}</div>
        {description && <pre className={presentation.command ? 'compact-shell-command' : undefined}>{presentation.command ? '$ ' : ''}{description}</pre>}
        {presentation.command && <p className="compact-output-unavailable">此记录未保存终端输出。</p>}
        {changed.length > 1 && changed.map(file => <p key={file.path}><button type="button" className="compact-file-link" disabled={!review.open} onClick={() => review.open?.(file.path)}>{file.path}</button></p>)}
        {tool && <details><summary>参数与执行回执<AppIcon name="chevronDown"/></summary><pre>{JSON.stringify({ arguments: tool.arguments, receipt: tool.receipt }, null, 2)}</pre></details>}
        {tool && activityToolIssue(tool) && <p>{activityToolIssue(tool)}</p>}
        {tool?.error_code && <code>{tool.error_code}</code>}
        <footer>{typeof receipt?.exit_code === 'number' ? `退出码 ${receipt.exit_code}` : active ? '执行中' : entry.status === 'COMPLETED' ? '已完成' : '未完成'}{entry.completedAt ? ` · ${activityTimestamp(entry.completedAt)}` : ''}</footer>
      </div>
    </details></TimestampHover>;
  })}</div>;
}

function compactEntryLabel(entry: ConversationActivityEntry): string {
  if (entry.kind !== 'TOOL') return entry.title;
  const presentation = activityToolPresentation(entry.tool);
  const description = activityToolDescription(entry.tool);
  return presentation.command ? `${['PROPOSED', 'RUNNING'].includes(entry.status) ? '正在运行命令' : '运行了命令'}` : `${presentation.title}${description ? ` ${description}` : ''}`;
}

function CompactActivityGroup({ item, activityFiles }: { item: ConversationActivityGroupItem; activityFiles?: ActivityFileContext }) {
  const running = useContext(ActivityRunningContext);
  const activeToolId = useContext(ActivityActiveToolContext);
  const compacting = running && item.contextNotes?.some(note => note.completedAt === null && !note.interrupted);
  const active = running && (Boolean(compacting) || item.entries.some(entry => entry.kind === 'TOOL' && entry.toolId === activeToolId));
  const latest = item.entries.at(-1)!;
  const unresolved = item.entries.filter((entry,index) => {
    if (!['FAILED', 'UNKNOWN', 'DENIED', 'CANCELLED'].includes(entry.status)) return false;
    if (entry.status !== 'FAILED' || entry.kind !== 'TOOL') return true;
    return !item.entries.slice(index+1).some(next => next.kind === 'TOOL' && next.status === 'COMPLETED'
      && next.tool.name === entry.tool.name && JSON.stringify(next.tool.arguments) === JSON.stringify(entry.tool.arguments));
  });
  const issue = unresolved.length > 0;
  const issueLabel = unresolved.some(entry=>entry.status==='UNKNOWN') ? '结果待确认'
    : unresolved.some(entry=>entry.status==='DENIED') ? '有拒绝记录'
      : latest.status === 'FAILED' ? '执行未成功' : `${unresolved.length} 项异常记录`;
  const single = item.entries.length === 1;
  const entry = item.entries[0]!;
  const groupLabels: Partial<Record<ConversationActivityGroupKind, string>> = { COMMAND: '运行了命令', INSPECT: '查看了文件', CHANGE: '编辑了文件', VERIFY: '检查了结果', NETWORK: '搜索、下载与扩展', VERSION: '检查了版本变更' };
  const label = single ? compactEntryLabel(entry) : `${groupLabels[item.groupKind] ?? item.title} · ${item.entries.length} 项`;
  const icon = single && entry.kind === 'TOOL' && isImageActivity(entry.tool) ? 'images' : item.groupKind === 'COMMAND' ? 'terminal' : activityIcon(single ? entry.activityKind : item.groupKind);
  return <details className={`compact-category${single ? ' is-single' : ''}${active ? ' is-working' : ''}`} data-testid="compact-category" data-category={item.groupKind} data-single={single}>
    <TimestampSummary timestamp={item.completedAt ?? item.occurredAt} title={label}><AppIcon name={icon}/><span className="compact-activity-label">{compacting ? `${label} · 正在压缩上下文` : active && !single ? `${label} · 执行中` : label}</span>{issue && <small>{issueLabel}</small>}<AppIcon name="chevronDown"/></TimestampSummary>
    <div className="compact-category-body">
      <CompactActivityRows item={item} activityFiles={activityFiles} flat={single}/>
      {((item.notes?.length ?? 0) > 0 || (item.contextNotes?.length ?? 0) > 0) && <details className="compact-operation-notes"><summary>过程详情<AppIcon name="chevronDown"/></summary>{[...(item.notes ?? []), ...(item.contextNotes ?? [])].sort((a,b)=>a.sequence-b.sequence).map(note => note.kind === 'CONTEXT' ? <ContextActivity key={note.id} item={note}/> : <NarrativeBlock key={note.id} text={note.text} timestamp={note.occurredAt} sequence={note.sequence} activityFiles={activityFiles}/>)}</details>}
    </div>
  </details>;
}

function currentCompactAction(items: ConversationActivityItem[], tools: AgentToolCallView[], events: AgentEventView[]): string {
  // Execution already has a visible operation row; do not repeat it in the footer.
  if (items.some(item => item.kind === 'CONTEXT' && item.completedAt === null && !item.interrupted)) return '';
  if (tools.some(tool => ['PROPOSED', 'RUNNING', 'WAITING_APPROVAL'].includes(tool.status))) return '';
  return agentModelIsActive(events, tools) ? '正在思考' : '正在处理';
}

function ContextActivity({ item }: { item: Extract<ConversationActivityItem, { kind: 'CONTEXT' }> }) {
  const running = useContext(ActivityRunningContext);
  const detailed = useContext(AgentDisplayContext) === 'DETAILED';
  const active = running && item.completedAt === null && !item.interrupted;
  const label = active ? '正在压缩上下文' : item.completedAt === null ? '上下文压缩已中断，结果待确认'
    : item.beforeBytes !== null && item.beforeBytes === item.afterBytes ? '上下文整理完成，保留原内容' : '上下文已自动压缩';
  return <TimestampHover timestamp={item.completedAt ?? item.occurredAt}><details open={detailed || undefined} className={`compact-activity-row context-activity${active ? ' is-working' : ''}`} data-testid="context-compaction" data-context-state={active ? 'RUNNING' : item.completedAt === null ? 'INTERRUPTED' : 'COMPLETED'}>
    <summary><AppIcon name="contextCompress"/><span className="compact-activity-label">{label}</span><AppIcon name="chevronDown"/></summary>
    <div className="compact-command-panel"><p>整理较早的上下文，保留任务目标与近期证据；聊天记录仍然保留。</p>
      {item.beforeBytes !== null && <p>压缩前：{item.beforeBytes.toLocaleString()} 字节{item.afterBytes !== null && `；压缩后：${item.afterBytes.toLocaleString()} 字节`}。此数值不是 token 用量。</p>}
    </div>
  </details></TimestampHover>;
}

function ActivityGroup({ item, activityFiles }: { item: ConversationActivityGroupItem; activityFiles?: ActivityFileContext }) {
  const detailed = useContext(AgentDisplayContext) === 'DETAILED';
  if (!detailed) return <CompactActivityGroup item={item} activityFiles={activityFiles}/>;
  const inspectionBatch = item.groupKind === 'MIXED' && item.entries.every(entry => ['INSPECT', 'SEARCH', 'DIRECTORY'].includes(entry.activityKind));
  return <details open={detailed || undefined} className={`conversation-activity-group activity-${item.groupKind.toLowerCase()}`} data-testid="conversation-activity-group" data-activity-sequence={item.sequence} data-activity-group-kind={item.groupKind} data-completed-at={item.completedAt ?? undefined}>
    <summary className="conversation-activity-group-summary" data-testid="activity-group-toggle">
      <AppIcon name={inspectionBatch ? 'folderOpen' : activityIcon(item.groupKind)}/><strong>{item.title}</strong><small>{item.entries.length} 项</small><AppIcon name="chevronDown"/>
    </summary>
    <ol className="conversation-activity-entries">{[...item.entries, ...(item.notes ?? [])].sort((left, right) => left.sequence - right.sequence).map((entry) => {
      if (entry.kind === 'NARRATIVE') return <li key={entry.id} className="activity-note" data-activity-sequence={entry.sequence}><MarkdownMessage content={entry.text}/></li>;
      const completion = entry.completedAt ? activityTimestamp(entry.completedAt) : '';
      const presentation = entry.kind === 'TOOL' ? activityToolPresentation(entry.tool) : { title: entry.title, detail: entry.detail, command: false, inlineDetail: false };
      const result = activityResult(item.groupKind, entry);
      const description = entry.kind === 'TOOL' ? activityToolDescription(entry.tool) || presentation.detail : entry.detail;
      const issue = entry.kind === 'TOOL' ? activityToolIssue(entry.tool) : null;
      const errorCode = entry.kind === 'TOOL' ? entry.tool.error_code : null;
      const resultLabel = result === 'PASS' ? '通过' : result === 'FAIL' ? '未通过' : result;
      return <li key={entry.id} data-activity-entry={entry.kind.toLowerCase()} data-activity-sequence={entry.sequence} data-activity-status={entry.status} data-activity-command={presentation.command || undefined} data-completed-at={entry.completedAt ?? undefined}>
        <TimestampHover timestamp={entry.completedAt ?? entry.occurredAt}><details open={detailed || undefined} className="conversation-tool-detail">
          <summary className="conversation-tool-summary" data-testid="activity-tool-toggle">
            {(item.groupKind === 'MIXED' || (entry.kind === 'TOOL' && isImageActivity(entry.tool))) && <AppIcon name={entry.kind === 'TOOL' && isImageActivity(entry.tool) ? 'images' : activityIcon(entry.activityKind)}/>}
            <span>{presentation.command ? description : `${presentation.title}${description ? ` ${description}` : ''}`}</span>
            {resultLabel && <em data-activity-result={result}>{resultLabel}</em>}<AppIcon name="chevronDown"/>
          </summary>
          <div className="conversation-tool-body" data-testid="activity-tool-detail">
            {description && <pre>{description}</pre>}
            {entry.kind === 'TOOL' && <pre className="activity-tool-arguments" data-testid="activity-tool-arguments">{JSON.stringify(entry.tool.arguments, null, 2)}</pre>}
            {issue && <p>{issue}</p>}{errorCode && <code className="activity-error-code">{errorCode}</code>}
            <small>{resultLabel || (entry.status === 'COMPLETED' ? '已完成' : '执行中')}{completion && ` · ${completion}`}</small>
          </div>
        </details></TimestampHover>
      </li>;
    })}</ol>
  </details>;
}

function ActivityApprovalRecord({ item }: { item: Extract<ConversationActivityItem, { kind: 'APPROVAL' }> }) {
  const label = item.completedAt ? agentCompletionTimeLabel(item.completedAt, item.decision === 'ALLOW_ONCE') : '';
  return <div className="conversation-activity-approval-record" data-activity-sequence={item.sequence} data-completed-at={item.completedAt ?? undefined}>
    <span>{item.decision === 'ALLOW_ONCE' ? '已允许本次操作' : item.decision === 'DENY' ? '已拒绝本次操作' : '等待操作确认'}</span>{label && <small>{label}</small>}
  </div>;
}

function NarrativeBlock({ text, streaming = false, sequence, timestamp, activityFiles }: { text: string; streaming?: boolean; sequence?: number; timestamp?: number; activityFiles?: ActivityFileContext }) {
  const invocationTime = useContext(ActivityNarrativeTimeContext);
  const compact = useContext(AgentDisplayContext) === 'COMPACT';
  const expandedContent = compact && (text.length > 360 || /```|~~~/.test(text));
  const preview = text.split(/\n\s*\n|```|~~~/)[0]!.trim().slice(0, 180);
  return <TimestampHover timestamp={timestamp ?? (streaming ? invocationTime : undefined)}><div className={`conversation-narrative${streaming ? ' is-streaming' : ''}`} data-testid="conversation-narrative" data-activity-sequence={sequence}>
    {expandedContent ? <><p className="compact-narrative-preview">{preview || '执行说明'}{preview.length < text.length && preview.length === 180 ? '…' : ''}</p><details className="compact-narrative-overflow"><summary>查看完整说明<AppIcon name="chevronDown"/></summary><MarkdownMessage content={text} activityFiles={activityFiles}/></details></> : <MarkdownMessage content={text} streaming={streaming} activityFiles={activityFiles}/>}
  </div></TimestampHover>;
}

function ConversationActivityStream({ items, tools, approval, approvalSummary, busy, onDecision, onOpenDetails, liveNarrative, activityFiles }: {
  items: ConversationActivityItem[];
  tools: AgentToolCallView[];
  approval: ApprovalView | null;
  approvalSummary: string;
  busy: boolean;
  onDecision?: (decision: 'DENY' | 'ALLOW_ONCE') => void;
  onOpenDetails: () => void;
  liveNarrative?: string;
  activityFiles?: ActivityFileContext;
}) {
  const compact = useContext(AgentDisplayContext) === 'COMPACT';
  const visibleItems = useMemo(() => compact ? compactOperationTimeline(items) : items, [compact, items]);
  const renderItem = (item: ConversationActivityItem): ReactNode => {
    if (item.kind === 'GROUP') return <ActivityGroup item={item} key={item.id} activityFiles={activityFiles}/>;
    if (item.kind === 'CONTEXT') return <ContextActivity item={item} key={item.id}/>;
    if (item.kind === 'NARRATIVE') return <NarrativeBlock text={item.text} sequence={item.sequence} timestamp={item.occurredAt} key={item.id} activityFiles={activityFiles}/>;
    if (item.kind === 'PHASE') return <TimestampHover timestamp={item.occurredAt} key={item.id}><p className="conversation-activity-phase" data-activity-sequence={item.sequence}>{item.title}</p></TimestampHover>;
    if (approval?.id === item.approvalId && onDecision && !item.completedAt) {
      const tool = tools.find(candidate => candidate.id === item.toolCallId) ?? null;
      return <AgentApproval key={item.id} tool={tool} summary={approvalSummary} busy={busy} onDecision={onDecision} onToggleSteps={onOpenDetails}/>;
    }
    return <ActivityApprovalRecord item={item} key={item.id}/>;
  };
  return <div className="conversation-activity-stream" data-testid="conversation-activity-stream" data-activity-count={visibleItems.length}>
    {visibleItems.map(renderItem)}
    {!compact && liveNarrative && <NarrativeBlock text={liveNarrative} streaming activityFiles={activityFiles}/>}

  </div>;
}

function LiveActivityPreview({ items, liveNarrative, tools, activityFiles }: { items: ConversationActivityItem[]; liveNarrative: string; tools: AgentToolCallView[]; activityFiles: ActivityFileContext }) {
  const current = currentActivityPreview(items, liveNarrative);
  const identity = liveNarrative ? `stream-${items.filter((item) => item.kind === 'NARRATIVE').at(-1)?.id ?? 'first'}` : current.map((item) => item.id).join(':');
  const latest = useRef({ identity, items: current, liveNarrative });
  latest.current = { identity, items: current, liveNarrative };
  const [displayed, setDisplayed] = useState(latest.current);
  const changing = displayed.identity !== identity;
  useEffect(() => {
    if (!changing) return;
    const timer = window.setTimeout(() => setDisplayed(latest.current), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [identity, changing]);
  const shown = changing ? displayed : latest.current;
  return <div className={`agent-current-activity${changing ? ' is-retiring' : ''}`} data-testid="agent-current-activity">
    <div className="agent-current-narrative"><ConversationActivityStream items={shown.items.filter(item => item.kind === 'NARRATIVE')} tools={tools} approval={null} approvalSummary="" busy={false} onOpenDetails={() => undefined} liveNarrative={shown.liveNarrative} activityFiles={activityFiles}/></div>
    <div className="agent-current-operations"><ConversationActivityStream items={shown.items.filter(item => item.kind === 'GROUP')} tools={tools} approval={null} approvalSummary="" busy={false} onOpenDetails={() => undefined} activityFiles={activityFiles}/></div>
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

function AgentProgressSummary({ run, busy, presentation, events, tools, review, thinking, detailsOpen, onToggleDetails, onResume, onStop, onReviewFile, mcpRuntime, mcpBusyConnectionId, onActivateMcp, history }: {
  history: ReactNode;
  busy: boolean;
  run: AgentRunView;
  presentation: AgentPresentation;
  events: AgentEventView[];
  tools: AgentToolCallView[];
  review: AgentReviewSummary | null;
  thinking: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onReviewFile?: (path: string) => void;
  mcpRuntime?: McpConnectionRuntimeView | null;
  mcpBusyConnectionId?: string;
  onActivateMcp?: (connectionId: string) => void;
}) {
  const editedReview = appliedAgentReview(review);
  const filesStable = !tools.some((tool) => ['WORKSPACE_WRITE', 'DESTRUCTIVE'].includes(tool.effect) && ['PROPOSED', 'RUNNING', 'WAITING_APPROVAL'].includes(tool.status));
  const changeSummary = editedReview && editedReview.files.length > 0
    ? `${editedReview.files.length} 个文件已修改`
    : presentation.changedFiles > 0 ? `${presentation.changedFiles} 个文件已修改` : '';
  const statusLabel = currentRunStateLabel(run, events, tools, thinking);
  const compact = useContext(AgentDisplayContext) === 'COMPACT';
  const clarification = run.error_code === 'AGENT_USER_INPUT_REQUIRED'
    ? [...tools].reverse().find(tool => tool.name === 'request_user_input' && tool.status === 'COMPLETED')?.arguments as { question?: string; reason?: string } | undefined
    : undefined;
  const activeTool = [...tools].reverse().find(tool => ['PROPOSED', 'RUNNING'].includes(tool.status));
  const currentLabel = compact && run.status === 'RUNNING'
    ? activeTool ? `正在${activeTool.name === 'run_command' ? '运行 ' + activityToolDescription(activeTool) : activityToolPresentation(activeTool).title}`
      : '正在思考'
    : statusLabel;
  const detailId = `agent-run-details-${run.id}`;
  return <div className={`agent-progress-summary${detailsOpen ? ' is-expanded' : ''}${thinking ? ' is-thinking' : ''}`} data-testid="agent-execution-status" data-execution-stage={run.status === 'PAUSED' ? 'PAUSED' : run.status === 'WAITING_APPROVAL' ? 'WAITING_APPROVAL' : thinking ? 'THINKING' : 'ACTIVE'} data-layout="conversation-stream">
    {!compact && detailsOpen && <div className="agent-run-details" id={detailId} data-testid="agent-run-details">
      {!compact && history}
      <CurrentRunMcp runtime={mcpRuntime ?? null} busyConnectionId={mcpBusyConnectionId} onActivate={onActivateMcp}/>
      {editedReview && editedReview.files.length > 0 && <LiveEditedFiles review={editedReview} stable={filesStable} onReviewFile={onReviewFile}/>}
    </div>}
    {run.status === 'PAUSED' && <div className="agent-pause-notice" data-testid="agent-pause-notice">
      {compact && clarification?.question && <div data-testid="agent-visible-question">{clarification.reason && <p>{clarification.reason}</p>}<p>{clarification.question}</p></div>}
      <p>{(run.error_code === 'AGENT_VERIFICATION_REQUIRED' ? browserLoadPauseReason(tools) : null) ?? agentPausePresentation(run).reason}</p>
      <div className="agent-pause-actions" aria-busy={busy}>
      {onResume && agentPausePresentation(run).canResume && <button type="button" className="agent-resume-action is-primary" disabled={busy} onClick={onResume}>{agentPausePresentation(run).action}</button>}
      {onStop && <button type="button" className="agent-resume-action" disabled={busy} onClick={onStop}>停止任务</button>}
      </div>
    </div>}
    {!compact && <button type="button" className={`agent-progress-summary-trigger${compact ? ' is-compact' : ''}${run.status === 'RUNNING' ? ' is-working' : ''}`} onClick={onToggleDetails} aria-expanded={detailsOpen} aria-controls={detailId} data-testid="agent-progress-summary" title={currentLabel}>
      <span className={`agent-status-indicator${!compact && run.status === 'RUNNING' ? ' is-active' : ' is-idle'}`} aria-hidden="true"><AppIcon name={run.status !== 'RUNNING' ? 'pause' : activeTool?.name === 'run_command' ? 'terminal' : 'thinking'}/></span><strong>{currentLabel}</strong>
      <span>· 累计 {presentation.elapsed}</span>{changeSummary && <span>· {changeSummary}</span>}<AppIcon name="chevronDown"/>
    </button>}
  </div>;
}

function AgentApproval({ tool, summary, busy, onDecision, onToggleSteps }: {
  tool: AgentToolCallView | null;
  summary: string;
  busy: boolean;
  onDecision: (decision: 'DENY' | 'ALLOW_ONCE') => void;
  onToggleSteps: () => void;
}) {
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
    <div><button type="button" onClick={onToggleSteps}>{install ? '查看执行详情' : '查看修改范围'}</button><button type="button" onClick={() => onDecision('DENY')} disabled={busy}>拒绝</button><button type="button" className="agent-primary-action" onClick={() => onDecision('ALLOW_ONCE')} disabled={busy} data-testid="agent-allow-once">{install ? '允许本次安装' : approvalActionLabel(tool)}</button></div>
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

function AgentTerminalResult({ run, status, message, presentation, tools, canExpand, partial, review, executionDetail, onRetry, onReview, onReviewFile, onOpenReference, onOpenImage }: {
  run: AgentRunView | null;
  status: AgentTerminalStatus;
  message: ConversationMessageView | null;
  presentation: AgentPresentation | null;
  tools: AgentToolCallView[];
  canExpand: boolean;
  partial: boolean;
  review: AgentReviewSummary | null;
  executionDetail?: ReactNode;
  onRetry?: () => void;
  onReview?: () => void;
  onReviewFile?: (path: string) => void;
  onOpenReference?: (reference: ResultReference) => void;
  onOpenImage?: (preview: ResultImagePreviewView) => void;
}) {
  const displayMode = useContext(AgentDisplayContext);
  const [detailOpen, setDetailOpen] = useState(true);
  useEffect(() => setDetailOpen(true), [displayMode, run?.id]);
  const result = buildAgentResultViewModel(status, message?.content ?? '', presentation, tools);
  const editedReview = appliedAgentReview(review);
  const markdown = message?.content || result.detail;
  const failureReason = activityFailureReason(run);
  return <div className="agent-terminal-result" data-testid="agent-terminal-result" data-result-outcome={presentation?.outcome ?? status}>
    {result.duration && (canExpand
      ? <button type="button" className="agent-terminal-runtime" aria-expanded={detailOpen} data-testid="agent-execution-detail-toggle" onClick={() => setDetailOpen((value) => !value)}><span>已处理 {result.duration}</span><span className="agent-history-label">{detailOpen ? '收起执行记录' : '查看执行记录'}</span><AppIcon name="chevronDown"/></button>
      : <div className="agent-terminal-runtime"><span>已处理 {result.duration}</span></div>)}
    {detailOpen && <>{executionDetail}{run?.error_code && <p className="agent-run-error-detail">结束原因：<code>{run.error_code}</code></p>}</>}
    {failureReason && <p className="agent-failure-reason" data-testid="agent-failure-reason"><AppIcon name="info"/><span>{failureReason}</span></p>}
    <TimestampHover timestamp={message?.created_at}><div className="agent-terminal-body"><MarkdownMessage content={markdown} references={message?.references ?? []} onOpenReference={onOpenReference} onOpenImage={onOpenImage} modernStatusMarkers/></div></TimestampHover>
    {editedReview && editedReview.files.length > 0 && <ChangedFiles review={editedReview} onReview={onReview} onReviewFile={onReviewFile}/>}
    <div className="agent-terminal-actions">
      {result.evidence.filter((item) => !editedReview?.files.length || !/文件/.test(item)).map((item) => <span className="agent-terminal-meta" key={item}>{item}</span>)}
      {status === 'FAILED' && onRetry && <button type="button" className="agent-primary-action" onClick={onRetry} data-testid="agent-retry">{partial ? '继续完成' : '重新尝试'}</button>}
    </div>
  </div>;
}

function CompletedActivityHistory({ items, tools, activityFiles, events }: { events: AgentEventView[]; items: ConversationActivityItem[]; tools: AgentToolCallView[]; activityFiles: ActivityFileContext }) {
  const displayMode = useContext(AgentDisplayContext);
  return <div className="agent-execution-detail is-history" data-testid="agent-execution-detail">
    {displayMode === 'DETAILED' && goalProgressLabel(events) && <p className="agent-goal-progress" data-testid="agent-goal-progress">{goalProgressLabel(events)}</p>}
    <ConversationActivityStream key={displayMode} items={items} tools={tools} approval={null} approvalSummary="" busy={false} onOpenDetails={() => undefined} activityFiles={activityFiles}/>
  </div>;
}

export function AgentTurn({
  run, requestText = '', userMessageId, terminalMessage, events = [], tools = [], approval = null, approvalSummary = '', review = null,
  streamingContent = '', streamingStep = 0, busy = false, copied = false, onResume, onStop, onDecision, onRetry, onReview, onReviewFile, onCopy, onCopyError, onOpenReference, onOpenImage,
  onOpenActivityFile, mcpRuntime = null, mcpBusyConnectionId = '', onActivateMcp,
}: AgentTurnProps) {
  const terminal = Boolean(terminalMessage) || isTerminalRun(run);
  const displayMode = useContext(AgentDisplayContext);
  const [detailsOpen, setDetailsOpen] = useState(displayMode === 'DETAILED');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!run || terminal || run.status === 'PAUSED') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.status, terminal]);
  useEffect(() => {
    if (terminal) setDetailsOpen(false);
  }, [terminal]);
  useEffect(() => {
    setDetailsOpen(displayMode === 'DETAILED');
  }, [run?.id, displayMode]);
  const requestKind = agentRequestKind(run?.task ?? requestText);
  const answerOnly = requestKind === 'ANSWER';
  const presentation = useMemo(() => run ? buildAgentPresentation(run, events, tools, now) : null, [events, now, run, tools]);
  const activityFiles = useMemo<ActivityFileContext>(() => ({ resolve: (target) => resolveActivityFileLink(target, tools), open: onOpenActivityFile }), [tools, onOpenActivityFile]);
  const activityItems = useMemo(() => buildConversationActivityProjection(events, tools), [events, tools]);
  const textOnlyAnswer = answerOnly && activityItems.length === 0 && tools.length === 0;
  const liveNarrative = useMemo(() => {
    if (terminal || answerOnly || run?.status !== 'RUNNING') return '';
    return reconcileLiveNarrative(activityItems, streamingContent, streamingStep);
  }, [activityItems, answerOnly, streamingContent, streamingStep, terminal, run?.status]);
  const status = terminalStatus(run, terminalMessage);
  const canExpand = Boolean(run && (activityItems.length || events.length || tools.length));
  const partial = Boolean(status === 'FAILED' && presentation && presentation.changedFiles > 0);
  const messageId = terminalMessage?.id ?? `agent-turn-${run?.id ?? 'historical'}`;
  const thinking = Boolean(run?.status === 'RUNNING' && !terminal && agentModelIsActive(events, tools));
  const invocationTime = [...events].reverse().find(event => event.kind === 'MODEL_STARTED')?.created_at;
  const activeToolId = run?.status === 'RUNNING' && !terminal ? [...tools].reverse().find(tool => ['PROPOSED', 'RUNNING'].includes(tool.status))?.id ?? null : null;

  return <ActivityRunningContext.Provider value={Boolean(run?.status === 'RUNNING' && !terminal)}><ActivityActiveToolContext.Provider value={activeToolId}><ActivityNarrativeTimeContext.Provider value={invocationTime}><ActivityReviewContext.Provider value={{ review, open: onReviewFile }}><section
    className={`message assistant agent-turn${answerOnly ? ' agent-answer' : ''}${terminal ? ' is-terminal' : run?.status === 'PAUSED' ? ' is-paused' : ' is-running'}`}
    data-message-id={messageId}
    data-testid="message-assistant"
    data-agent-turn="true"
    data-agent-run-id={run?.id ?? terminalMessage?.invocation_id ?? ''}
    data-user-message-id={userMessageId ?? ''}
    data-agent-state={status ?? run?.status ?? 'RUNNING'}
    data-agent-kind={requestKind}
    data-agent-display={displayMode.toLowerCase()}
  >
    {textOnlyAnswer && <div className="agent-answer-body" data-testid="agent-answer">
      {(terminalMessage?.content || streamingContent) && (
        <TimestampHover timestamp={terminalMessage?.created_at}><MarkdownMessage content={terminalMessage?.content || streamingContent} streaming={!terminal} onCopyError={onCopyError} references={terminalMessage?.references ?? []} onOpenReference={onOpenReference} onOpenImage={onOpenImage}/></TimestampHover>
      )}
    </div>}
    {!textOnlyAnswer && !terminal && run && presentation && <>
      {displayMode === 'COMPACT' && <div className="agent-terminal-runtime agent-running-header" data-testid="agent-running-header">
        <span>已处理 {presentation.elapsed}</span>
      </div>}
      {displayMode === 'COMPACT' && <ConversationActivityStream items={activityItems} tools={tools} approval={null} approvalSummary="" busy={busy} onOpenDetails={() => setDetailsOpen(true)} liveNarrative={liveNarrative} activityFiles={activityFiles}/>}
      {displayMode === 'COMPACT' && <div className="agent-current-action" data-testid="agent-current-action"><span className={thinking ? 'agent-running-label is-working' : 'agent-running-label'} data-testid="agent-running-label" title={run.status === 'RUNNING' ? currentCompactAction(activityItems, tools, events) : undefined}>{run.status === 'RUNNING' ? currentCompactAction(activityItems, tools, events) : currentRunStateLabel(run, events, tools, false)}</span></div>}
      {displayMode === 'DETAILED' && !detailsOpen && run.status !== 'PAUSED' && <LiveActivityPreview items={activityItems} tools={tools} liveNarrative={liveNarrative} activityFiles={activityFiles}/>}
      {displayMode === 'DETAILED' && detailsOpen && liveNarrative && <NarrativeBlock text={liveNarrative} streaming activityFiles={activityFiles}/>}
      {approval && onDecision && <AgentApproval tool={tools.find((tool) => tool.id === approval.tool_call_id) ?? null} summary={approvalSummary} busy={busy} onDecision={onDecision} onToggleSteps={() => setDetailsOpen(true)}/>}
      {(displayMode !== 'COMPACT' || run.status === 'PAUSED') && <AgentProgressSummary run={run} busy={busy} presentation={presentation} events={events} tools={tools} review={review} thinking={thinking} detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((value) => !value)} onResume={onResume} onStop={onStop} onReviewFile={onReviewFile} mcpRuntime={mcpRuntime} mcpBusyConnectionId={mcpBusyConnectionId} onActivateMcp={onActivateMcp} history={<CompletedActivityHistory events={events} items={activityItems} tools={tools} activityFiles={activityFiles}/>}/>}
      {displayMode === 'COMPACT' && <CurrentRunMcp runtime={mcpRuntime} busyConnectionId={mcpBusyConnectionId} onActivate={onActivateMcp}/>}
    </>}
    {!textOnlyAnswer && terminal && status && (
      <AgentTerminalResult run={run} status={status} message={terminalMessage} presentation={presentation} tools={tools} canExpand={canExpand} partial={partial} review={review} executionDetail={run && presentation ? <CompletedActivityHistory events={events} items={activityItems} tools={tools} activityFiles={activityFiles}/> : null} onRetry={onRetry} onReview={onReview} onReviewFile={onReviewFile} onOpenReference={onOpenReference} onOpenImage={onOpenImage}/>
    )}
    {terminalMessage && onCopy && <footer className={`message-actions agent-turn-message-actions ${copied ? 'copy-confirmed' : ''}`}><button type="button" className={copied ? 'copied' : ''} aria-label={copied ? '消息已复制' : '复制消息'} title={copied ? '已复制' : '复制'} onClick={onCopy} data-testid="message-copy"><AppIcon name={copied ? 'check' : 'copy'}/>{copied && <span role="status" aria-live="polite">已复制</span>}</button></footer>}
  </section></ActivityReviewContext.Provider></ActivityNarrativeTimeContext.Provider></ActivityActiveToolContext.Provider></ActivityRunningContext.Provider>;
}
