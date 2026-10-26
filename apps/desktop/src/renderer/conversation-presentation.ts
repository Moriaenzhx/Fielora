import type { AgentToolCallView } from '@fielora/contracts';
import type { AppIconName } from './ui';
import type { ConversationActivityEntry, ConversationActivityItem, ConversationActivityGroupKind } from './agent-activity-projection.ts';
import { computerApplicationActivity } from './agent-activity-projection.ts';
import { activityToolDescription, activityToolIssue, webActivity } from './agent-activity-detail.ts';
import { toolDetail } from './agent-presentation.ts';

type ToolStatus = AgentToolCallView['status'];

export interface ConversationToolPresentation {
  action: string;
  label: string;
  detail: string;
  icon: AppIconName;
  status: ToolStatus;
  succeeded: boolean;
  command: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function concise(value: unknown, limit = 76): string {
  if (typeof value !== 'string') return '';
  const addresses = value.replace(/https?:\/\/[^\s<>"')]+/g, candidate => {
    try { const url = new URL(candidate); return `${url.protocol}//${url.host}${url.pathname}`; } catch { return '[地址]'; }
  });
  const text = Array.from(addresses, character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character)
    .join('').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** The tool transport can complete with a failed/unknown operation receipt. */
export function conversationToolStatus(tool: AgentToolCallView): ToolStatus {
  const receipt = record(tool.receipt);
  if (receipt.outcome_unknown === true) return 'UNKNOWN';
  if (tool.status !== 'COMPLETED') return tool.status;
  if (receipt.success === false || receipt.timed_out === true
    || (tool.name === 'run_command' && typeof receipt.exit_code === 'number' && receipt.exit_code !== 0)) return 'FAILED';
  return tool.status;
}

function statusAction(action: string, status: ToolStatus): string {
  if (status === 'COMPLETED') return `已${action}`;
  if (status === 'RUNNING') return `正在${action}`;
  if (status === 'PROPOSED') return `准备${action}`;
  const suffix: Record<Exclude<ToolStatus, 'COMPLETED' | 'RUNNING' | 'PROPOSED'>, string> = {
    WAITING_APPROVAL: '等待批准', FAILED: '未成功', DENIED: '已拒绝', CANCELLED: '已停止', UNKNOWN: '结果待确认',
  };
  return `${action} · ${suffix[status]}`;
}

function address(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.host : '';
  } catch { return ''; }
}

/** Name the actual executable/arguments, without guessing why it was run.
 * Inline source belongs in the existing detail disclosure, not the timeline. */
function commandSummary(tool: AgentToolCallView): string {
  const args = record(tool.arguments);
  if (typeof args.program !== 'string') return '';
  const program = args.program.split(/[\\/]/).at(-1) ?? '';
  const argv = Array.isArray(args.argv) ? args.argv.filter((arg): arg is string => typeof arg === 'string') : [];
  const interpreter = /^(?:node(?:\d+)?|nodejs|python(?:\d+(?:\.\d+)?)?|pypy(?:\d+)?|sh|bash|zsh|fish|pwsh|powershell)(?:\.exe)?$/i.test(program);
  if (interpreter) {
    const sourceAt = argv.findIndex(arg => ['-e', '--eval', '-p', '--print', '-c', '-command', '-encodedcommand', '-enc'].includes(arg.toLowerCase())
      || /^(?:--(?:eval|print)=|-[ecp].)/.test(arg));
    if (sourceAt >= 0) {
      const flag = argv[sourceAt]!.replace(/^(--(?:eval|print))=.*/, '$1');
      const safeFlag = /^-[ecp]./.test(flag) && !['-command', '-encodedcommand', '-enc'].includes(flag.toLowerCase()) ? flag.slice(0, 2) : flag;
      return concise([program, ...argv.slice(0, sourceAt), safeFlag, '…'].join(' '), 68);
    }
  }
  // Existing renderer arguments are already redacted upstream; the expanded
  // detail retains their exact content. The summary makes no new OS reads.
  return concise([program, ...argv].join(' '), 68);
}

/** Short, factual actions. These icons describe the operation, not its outcome. */
export function conversationToolPresentation(tool: AgentToolCallView): ConversationToolPresentation {
  const args = record(tool.arguments);
  const receipt = record(tool.receipt);
  const status = conversationToolStatus(tool);
  const application = computerApplicationActivity(tool);
  if (application) {
    return { action: '操作应用', label: [concise(application.target?.name, 48), application.label].filter(Boolean).join(' · '),
      detail: application.target?.name ?? '', icon: 'application', status: application.status,
      succeeded: application.succeeded, command: false };
  }
  let action: string;
  let detail = '';
  let icon: AppIconName;
  const command = tool.name === 'run_command';
  const web = webActivity({ ...tool, status });
  if (web) {
    action = web.action;
    detail = concise(web.detail);
    icon = tool.name === 'web.search' ? 'search' : args.action === 'screenshot' ? 'images' : 'browse';
  } else if (command) {
    action = '运行命令'; detail = commandSummary(tool); icon = 'terminal';
  } else if (tool.name === 'work_plan') {
    action = '更新工作计划'; icon = 'plan';
  } else if (tool.name === 'git_read') {
    const operations: Record<string, [string, AppIconName]> = {
      status: ['检查 Git 状态', 'changes'], diff: ['查看代码差异', 'fileDiff'],
      log: ['查看提交历史', 'history'], show: ['查看提交内容', 'commit'],
    };
    [action, icon] = operations[String(args.operation)] ?? ['查看 Git 信息', 'branch'];
    detail = concise(activityToolDescription(tool));
  } else if (tool.name === 'artifact.set_archive_state') {
    action = args.archived === true ? '归档产物' : args.archived === false ? '恢复产物' : '更新产物归档状态'; icon = 'archive';
  } else if (tool.name === 'browser_server') {
    const actions: Record<string, string> = { start: '启动服务进程', serve: '启动本地预览服务', status: '检查开发服务', stop: '停止开发服务' };
    action = actions[String(args.action)] ?? '操作开发服务'; icon = 'server';
    detail = address(status === 'COMPLETED' ? receipt.url ?? args.url : args.url);
  } else {
    const actions: Record<string, [string, AppIconName]> = {
      list_files: ['查看目录', 'folderOpen'], read_file: ['读取文件', 'file'], search_text: ['搜索代码', 'search'], stat_path: ['检查文件', 'info'],
      create_file: ['创建文件', 'filePlus'], write_file: ['写入文件', 'edit'], replace_text: ['修改文件', 'edit'], apply_patches: ['修改文件', 'fileDiff'],
      delete_file: ['删除文件', 'delete'], move_file: ['移动文件', 'files'],
      git_read: ['查看 Git 信息', 'branch'], git_status: ['检查 Git 状态', 'branch'], git_stage: ['暂存变更', 'changes'], git_unstage: ['取消暂存', 'undo'],
      git_commit: ['提交变更', 'commit'], git_push: ['推送提交', 'cloud'], git_create_branch: ['创建分支', 'branch'], git_switch_branch: ['切换分支', 'branch'],
      browser_plan: ['记录页面检查计划', 'plan'], browser_verify: ['检查页面结果', 'verified'],
      list_skills: ['查看 Skill 清单', 'extensions'], load_skill: ['加载 Skill', 'extensions'], verify_skill: ['检查 Skill 文件', 'verified'],
      capability_status: ['查询可用能力', 'tools'], 'mcp.list_connections': ['查看工具连接', 'connection'], 'mcp.activate_connection': ['连接外部工具', 'connection'],
      'skills.search': ['搜索 Skill 来源', 'search'], 'skills.prepare': ['准备 Skill 包', 'extensions'], 'skills.install': ['安装 Skill', 'extensions'],
      request_user_input: ['向你提问', 'question'], continue_task: ['继续处理任务', 'run'],
      finish_task: ['提交任务结果', 'inbox'], record_request_intent: ['记录当前请求', 'plan'], read_run_history: ['查看执行历史', 'history'],
      record_work_review: ['记录工作复盘', 'plan'],
      delegate_readonly: ['委派只读检查', 'delegate'], 'file.extract': ['提取文档内容', 'source'], 'environment.inspect': ['检查运行环境', 'environment'],
      'fonts.list': ['查看本机字体', 'font'], 'fonts.prepare': ['准备字体文件', 'font'], 'fonts.install': ['安装用户字体', 'font'],
      'tools.prepare': ['准备工具安装', 'tools'], 'tools.install': ['安装工具', 'tools'],
      'artifact.create': ['创建产物', 'objects'], 'artifact.read': ['读取产物', 'source'], 'artifact.list': ['查看产物列表', 'objects'],
      'artifact.update': ['更新产物', 'edit'], 'artifact.history': ['查看产物历史', 'history'], 'artifact.export': ['导出产物', 'download'],
    };
    [action, icon] = actions[tool.name] ?? [`调用 ${concise(tool.name, 40) || '工具'}`, 'tools'];
    const readPath = tool.name === 'read_file' && typeof args.path === 'string' ? args.path : null;
    const start = Number.isSafeInteger(args.line_start) && Number(args.line_start) > 0 ? Number(args.line_start) : 1;
    const range = Number.isSafeInteger(args.line_end) && Number(args.line_end) >= start ? ` · 行 ${start}–${args.line_end}` : '';
    const described = readPath === null ? activityToolDescription(tool) : `${readPath}${range}`;
    const existingDetail = described || (['apply_patches', 'move_file', 'git_create_branch', 'git_switch_branch'].includes(tool.name) ? toolDetail(tool) : '');
    detail = concise(existingDetail);
  }
  const label = tool.error_code === 'AGENT_EDIT_ALREADY_CURRENT' ? '内容已一致' : statusAction(action, status);
  return { action, label: [label, detail].filter(Boolean).join(' · '), detail, icon, status, succeeded: status === 'COMPLETED', command };
}

const ACTIVITY_ICONS: Record<ConversationActivityGroupKind, AppIconName> = {
  SEARCH: 'search', DIRECTORY: 'folderOpen', INSPECT: 'files', CHANGE: 'edit', VERIFY: 'verified',
  COMMAND: 'terminal', VERSION: 'branch', NETWORK: 'browse', OTHER: 'tools', MIXED: 'operations',
};

export function conversationOperationIcon(entry: ConversationActivityEntry): AppIconName {
  return entry.kind === 'TOOL' ? conversationToolPresentation(entry.tool).icon : ACTIVITY_ICONS[entry.activityKind];
}

/** A mixed group must not impersonate its first tool. Match a web-led label to
 * that same web entry; otherwise use a shared action icon or a neutral stack. */
export function conversationGroupIcon(entries: readonly ConversationActivityEntry[], labelEntry?: ConversationActivityEntry): AppIconName {
  if (labelEntry) return conversationOperationIcon(labelEntry);
  const icons = new Set(entries.map(conversationOperationIcon));
  return icons.size === 1 ? [...icons][0]! : 'operations';
}

export interface ConversationArchiveSummary {
  itemCount: number;
  operationCount: number;
  narrativeCount: number;
  contextCount: number;
  failedCount: number;
  unknownCount: number;
  deniedCount: number;
  cancelledCount: number;
  latestFailure: string | null;
  label: string;
}

export type ConversationTimelineSection =
  | { kind: 'ITEM'; id: string; item: ConversationActivityItem }
  | { kind: 'ARCHIVE'; id: string; items: ConversationActivityItem[]; summary: ConversationArchiveSummary };

export interface ConversationTimelineOptions { threshold?: number; recentCount?: number }

function entryStatus(entry: ConversationActivityEntry): ToolStatus {
  return entry.kind === 'TOOL' ? conversationToolStatus(entry.tool) : entry.status;
}

function canArchive(item: ConversationActivityItem): boolean {
  if (item.kind === 'APPROVAL') return false;
  if (item.kind === 'CONTEXT') return item.completedAt !== null;
  if (item.kind !== 'GROUP') return true;
  // Unknown outcomes also stay visible: a finished transport is not a
  // resolved action. Nested pending context must not disappear with a group.
  return item.completedAt !== null
    && item.entries.every(entry => ['COMPLETED', 'FAILED', 'DENIED', 'CANCELLED'].includes(entryStatus(entry)))
    && (item.contextNotes ?? []).every(note => note.completedAt !== null);
}

function failureReason(entry: ConversationActivityEntry): string {
  if (entry.kind !== 'TOOL') return concise(entry.detail || entry.title, 120) || '检查未通过';
  const tool = entry.tool;
  const receipt = record(tool.receipt);
  const code = concise(tool.error_code ?? receipt.error_code, 96);
  const exit = typeof receipt.exit_code === 'number' && Number.isFinite(receipt.exit_code) && receipt.exit_code !== 0;
  if (code === 'AGENT_PROCESS_FAILED' && exit) return `命令退出码 ${receipt.exit_code}`;
  // Reuse established explanations only for their known codes. Generic issue
  // fallbacks (notably search/network) must not guess an unknown error's cause.
  const knownIssues = new Set([
    'COMPUTER_ACCESSIBILITY_REQUIRED', 'COMPUTER_INPUT_PERMISSION_REQUIRED', 'COMPUTER_SCREEN_RECORDING_REQUIRED',
    'COMPUTER_PLATFORM_UNSUPPORTED', 'COMPUTER_UNSUPPORTED_ACTION', 'COMPUTER_STALE_SNAPSHOT', 'COMPUTER_FOCUS_CHANGED',
    'COMPUTER_TARGET_CHANGED', 'COMPUTER_PROTECTED_APPLICATION', 'COMPUTER_PROTECTED_TARGET', 'COMPUTER_PROTECTED_KEY',
    'COMPUTER_GOVERNED_OPERATION_REQUIRED', 'COMPUTER_BUSY',
    'BROWSER_LOGIN_NOT_OBSERVED', 'BROWSER_DOWNLOAD_NOT_ARMED', 'BROWSER_DOWNLOAD_TOO_LARGE',
    'BROWSER_SERVER_NOT_TRACKED', 'BROWSER_SERVER_NOT_STARTED', 'BROWSER_NAVIGATION_FAILED', 'BROWSER_SERVER_ALREADY_RUNNING',
    'AGENT_EDIT_ALREADY_CURRENT', 'AGENT_WORK_EVIDENCE_STALE', 'AGENT_WORK_QUOTE_MISMATCH', 'AGENT_WORK_EVIDENCE_REQUIRED',
    'AGENT_WORK_EVIDENCE_RANGE_INVALID', 'AGENT_WORK_SCOPE_MISMATCH', 'AGENT_WORK_PLAN_REQUIRED', 'AGENT_WORK_PLAN_AMENDMENT_REQUIRED',
    'WEB_SEARCH_TEST_BUSY', 'AGENT_TOOL_RATE_LIMITED', 'AGENT_TOOL_CREDENTIAL_REJECTED', 'AGENT_TOOL_CREDENTIAL_MISSING',
    'AGENT_TOOL_HTTP_CLIENT_ERROR', 'AGENT_TOOL_DESTINATION_REJECTED', 'WEB_SEARCH_CONFIG_INVALID',
    'AGENT_TOOL_REQUEST_TIMEOUT', 'AGENT_TOOL_DNS_FAILED', 'AGENT_TOOL_RESPONSE_MALFORMED',
  ]);
  const issue = (!code || knownIssues.has(code)) ? activityToolIssue({ ...tool, status: conversationToolStatus(tool), error_code: code || tool.error_code }) : null;
  if (issue) return concise(issue, 120);
  const browserReasons: Record<string, string> = {
    BROWSER_SURFACE_NOT_READY: '浏览器工作面尚未就绪',
    BROWSER_DOCUMENT_LOADING: '页面仍在加载，等待已超时',
    BROWSER_PAGE_NOT_ACTIVE: '目标浏览器页面当前未激活',
    BROWSER_PAGE_UNAVAILABLE: '目标浏览器页面当前不可用',
    BROWSER_STALE_SNAPSHOT: '页面观察已过期，需要重新读取',
    BROWSER_WRONG_TARGET: '当前页面与检查计划的目标不一致',
  };
  if (browserReasons[code]) return browserReasons[code]!;
  if (code) return code;
  if (exit) return `命令退出码 ${receipt.exit_code}`;
  if (receipt.timed_out === true) return '操作超时';
  return '操作回执报告未成功';
}

function archiveSummary(items: readonly ConversationActivityItem[]): ConversationArchiveSummary {
  const entries = items.flatMap(item => item.kind === 'GROUP' ? item.entries : []);
  const narrativeCount = items.reduce((count, item) => count + (item.kind === 'NARRATIVE' ? 1 : item.kind === 'GROUP' ? item.notes?.length ?? 0 : 0), 0);
  const contextCount = items.reduce((count, item) => count + (item.kind === 'CONTEXT' ? 1 : item.kind === 'GROUP' ? item.contextNotes?.length ?? 0 : 0), 0);
  const failed = entries.filter(entry => entryStatus(entry) === 'FAILED');
  const unknownCount = entries.filter(entry => entryStatus(entry) === 'UNKNOWN').length;
  const deniedCount = entries.filter(entry => entryStatus(entry) === 'DENIED').length;
  const cancelledCount = entries.filter(entry => entryStatus(entry) === 'CANCELLED').length;
  const failedAt = (entry: ConversationActivityEntry) => entry.completedAt ?? (entry.kind === 'TOOL' ? entry.tool.updated_at : entry.occurredAt);
  const latest = failed.reduce<ConversationActivityEntry | null>((previous, entry) => !previous || failedAt(entry) >= failedAt(previous) ? entry : previous, null);
  const latestFailure = latest ? failureReason(latest) : null;
  const parts = ['较早过程'];
  if (entries.length) parts.push(`${entries.length} 项操作`);
  if (narrativeCount) parts.push(`${narrativeCount} 段说明`);
  if (contextCount) parts.push(`${contextCount} 次上下文整理`);
  if (parts.length === 1) parts.push(`${items.length} 条记录`);
  return { itemCount: items.length, operationCount: entries.length, narrativeCount, contextCount, failedCount: failed.length,
    unknownCount, deniedCount, cancelledCount, latestFailure, label: parts.join(' · ') };
}

/** Call after compactOperationTimeline. No sorting, pruning or regrouping:
 * expanding archives reproduces every original object in its original order. */
export function conversationTimelineSections(
  items: readonly ConversationActivityItem[],
  options: ConversationTimelineOptions = {},
): ConversationTimelineSection[] {
  const positive = (value: number | undefined, fallback: number) => Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
  const recentCount = positive(options.recentCount, 8);
  const threshold = Math.max(recentCount, positive(options.threshold, 14));
  const cutoff = items.length > threshold ? Math.max(0, items.length - recentCount) : 0;
  const result: ConversationTimelineSection[] = [];
  let archive: ConversationActivityItem[] = [];
  const flush = () => {
    if (!archive.length) return;
    result.push({ kind: 'ARCHIVE', id: `archive:${archive[0]!.id}`, items: archive, summary: archiveSummary(archive) });
    archive = [];
  };
  items.forEach((item, index) => {
    if (index < cutoff && canArchive(item)) archive.push(item);
    else { flush(); result.push({ kind: 'ITEM', id: item.id, item }); }
  });
  flush();
  return result;
}
