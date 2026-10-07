import type { AgentEventView, AgentRunView, AgentToolCallView } from '@fielora/contracts';
import { providerResponseReason } from './provider-response-errors.ts';

export function activityStatusLabel(status: AgentToolCallView['status']): string {
  return { PROPOSED: '等待执行', RUNNING: '执行中', WAITING_APPROVAL: '等待批准', COMPLETED: '已完成', FAILED: '执行失败', DENIED: '已拒绝', CANCELLED: '已停止', UNKNOWN: '执行状态待确认' }[status];
}

export interface ActivityDetailField { label: string; text: string; code?: boolean }

/** Only the existing renderer DTO is used, including its upstream redaction.
 * Display and clipboard share exactly these strings; never fetch raw logs.
 */
export function activityDetailFields(tool: AgentToolCallView): ActivityDetailField[] {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const args = object(tool.arguments);
  const receipt = object(tool.receipt);
  const fields: ActivityDetailField[] = [];
  const present = (value: unknown) => value !== null && value !== undefined && value !== '' && !(typeof value === 'object' && Object.keys(value).length === 0);
  const add = (label: string, value: unknown, code = false) => {
    if (present(value)) fields.push({ label, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2), code });
  };
  add('操作对象', args.path ?? args.paths ?? args.url ?? receipt.path);
  add('工作目录', receipt.cwd ?? args.cwd);
  add('执行环境', receipt.environment ?? args.environment);
  if (tool.name === 'run_command') {
    if (receipt.execution_boundary === 'MACOS_WORKSPACE_WRITE_SANDBOX') {
      add('命令隔离', 'macOS 项目写入沙箱：可写项目和临时目录；不隔离本机文件读取。');
      add('命令网络', receipt.network_policy === 'DENIED' ? '禁止联网' : '允许联网');
    } else if (receipt.execution_boundary === 'CURRENT_USER_HOST') {
      add('命令隔离', '当前用户权限运行，不使用命令沙箱。');
    } else if (receipt.execution_boundary === 'CONTROLLED_WORKSPACE_EXECUTION') {
      add('命令隔离', '旧版受控执行记录；不能据此确认操作系统沙箱。');
    }
  }
  if (tool.name === 'run_command') add('命令', activityToolDescription(tool), true);
  const remainingArgs = Object.fromEntries(Object.entries(args).filter(([key, value]) => present(value) && !['path', 'paths', 'url', 'cwd', 'environment', '_command_policy', ...(tool.name === 'run_command' ? ['program', 'argv'] : [])].includes(key)));
  add('参数', remainingArgs, true);
  for (const [key, label] of [['stdout', '标准输出'], ['stderr', '标准错误'], ['output', '输出'], ['error', '错误']] as const) add(label, receipt[key], true);
  add('错误码', tool.error_code);
  const remainingReceipt = Object.fromEntries(Object.entries(receipt).filter(([key, value]) => present(value) && !['stdout', 'stderr', 'output', 'error', 'cwd', 'environment', 'duration_ms'].includes(key)));
  add('回执', remainingReceipt, true);
  if (typeof receipt.duration_ms === 'number') add('耗时', `${receipt.duration_ms} ms`);
  return fields;
}

export function goalProgressLabel(events: readonly AgentEventView[]): string | null {
  const latest = [...events].reverse().find(event => event.kind === 'CHECKPOINT_CREATED'
    && (event.payload as Record<string, unknown>)?.kind === 'GENERAL_WORK_STATE_V1');
  const goal = (latest?.payload as Record<string, unknown> | undefined)?.goal as Record<string, unknown> | undefined;
  const labels: Record<string, string> = {
    UNDERSTANDING: '正在确认任务目标', DIAGNOSING: '正在定位问题', VERIFYING: '正在验证当前修改', AWAITING_VERIFICATION: '修改已保存，等待验证',
    REPAIRING: '验证未通过，继续修正', READY_TO_FINALIZE: '当前验收已通过，正在整理结果',
    RECOVERY_REQUIRED: '有操作结果待确认，任务尚未完成',
  };
  return typeof goal?.status === 'string' ? labels[goal.status] ?? null : null;
}

export function shouldShowMcpRuntime(runtime: { connections: readonly unknown[]; diagnostics: readonly { code: string }[] } | null): boolean {
  return Boolean(runtime && (runtime.connections.length > 0 || runtime.diagnostics.some((item) => item.code !== 'CONFIG_NOT_FOUND')));
}

export interface ActivityFileLink {
  path: string;
  expectedSha256: string;
  lineStart?: number;
  lineEnd?: number;
}

export function resolveActivityFileLink(target: string, tools: readonly AgentToolCallView[]): ActivityFileLink | null {
  const match = /^fielora-project-file:([^#]+)(?:#L([1-9]\d*)(?:-L?([1-9]\d*))?)?$/.exec(target);
  if (!match) return null;
  const path = match[1] ?? '';
  if (/[:\\]/.test(path) || [...path].some((part) => part.charCodeAt(0) < 32) || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  const tool = [...tools].reverse().find((item) => item.name === 'read_file' && item.status === 'COMPLETED'
    && item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
    && (item.arguments as Record<string, unknown>).path === path);
  const receipt = tool?.receipt as Record<string, unknown> | null;
  const hash = receipt?.sha256;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return null;
  const lineStart = match[2] ? Number(match[2]) : undefined;
  const lineEnd = match[3] ? Number(match[3]) : lineStart;
  if (lineStart !== undefined && (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd) || lineEnd! < lineStart)) return null;
  return { path, expectedSha256: hash, lineStart, lineEnd };
}

/** Presentation only: preserve the recorded action, including its range and failure. */
export function activityToolDescription(tool: AgentToolCallView): string {
  const args = tool.arguments && typeof tool.arguments === 'object' && !Array.isArray(tool.arguments)
    ? tool.arguments as Record<string, unknown> : {};
  const path = typeof args.path === 'string' ? args.path : '';
  if (tool.name === 'work_plan') {
    const next = args.next_step as Record<string, unknown> | undefined;
    return typeof next?.action === 'string' ? next.action : '保留目标与下一步，计划可调整';
  }
  if (tool.name === 'read_file') {
    const start = Number.isSafeInteger(args.line_start) ? Number(args.line_start) : 1;
    const end = Number.isSafeInteger(args.line_end) ? Number(args.line_end) : null;
    return `${path}${end ? ` · 行 ${start}–${end}` : ' · 文件内容'}`;
  }
  if (tool.name === 'search_text') {
    const query = typeof args.query === 'string' ? args.query
      : Array.isArray(args.queries) ? args.queries.filter((item) => typeof item === 'string').join(' / ') : '';
    return [path, query && `“${query}”`].filter(Boolean).join(' · ');
  }
  if (tool.name === 'run_command') {
    return [args.program, ...(Array.isArray(args.argv) ? args.argv : [])]
      .filter((item) => typeof item === 'string').join(' ');
  }
  return path;
}

export function activityToolIssue(tool: AgentToolCallView): string | null {
  const receipt = tool.receipt as Record<string, unknown> | null;
  if (receipt?.user_action_required === 'LOGIN') return '请在右侧浏览器完成登录，然后继续页面验证。';
  if (receipt?.error_code === 'BROWSER_LOGIN_NOT_OBSERVED') return '当前页面未观察到登录所需的密码输入框，请重新检查页面。';
  if (receipt?.error_code === 'BROWSER_SERVER_NOT_TRACKED' || receipt?.error_code === 'BROWSER_SERVER_NOT_STARTED') return '当前任务未关联服务进程；已有服务可能仍在运行，需要检查实际地址。';
  if (receipt?.error_code === 'BROWSER_NAVIGATION_FAILED') return '目标页面加载失败，未取得可验证的页面内容；这不能证明需要登录。';
  if (tool.name === 'browser_server' && receipt?.readiness === 'NOT_CHECKED') return '进程已启动，网站地址尚未检查。';
  if (tool.name === 'browser_server' && receipt?.readiness === 'STARTING') return '服务进程已启动，正在初始化；稍后检查就绪状态。';
  if (receipt?.error_code === 'BROWSER_SERVER_ALREADY_RUNNING') return '该任务的服务进程已在运行，无需重复启动。';
  if (tool.name === 'browser_server' && receipt?.readiness === 'NOT_LISTENING') return '该地址未接受连接，需要核对开发服务的地址和启动状态。';
  const labels: Record<string, string> = {
    AGENT_WORK_EVIDENCE_STALE: '引用对应的文件已变化；这条旧证据需要重新核对。',
    AGENT_WORK_QUOTE_MISMATCH: '引用未匹配文件内容，未作为已确认事实。',
    AGENT_WORK_EVIDENCE_REQUIRED: '引用未关联成功的文件读取，未作为已确认事实。',
    AGENT_WORK_EVIDENCE_RANGE_INVALID: '引用行号超出已读取范围，未作为已确认事实。',
    AGENT_WORK_SCOPE_MISMATCH: '旧版计划范围曾阻止这次操作；当前版本允许按任务需要调整。',
    AGENT_WORK_PLAN_REQUIRED: '旧版曾要求先填写计划；当前版本的计划为可选辅助记录。',
    AGENT_WORK_PLAN_AMENDMENT_REQUIRED: '旧版曾阻止计划更新；当前版本允许修正计划。',
  };
  if (tool.error_code && labels[tool.error_code]) return labels[tool.error_code]!;
  if (tool.name !== 'work_plan') return null;
  const plan = receipt?.plan as Record<string, unknown> | undefined;
  const issues = Array.isArray(plan?.evidence_issues) ? plan.evidence_issues : [];
  return issues.length ? `计划已记录，${issues.length} 条引用未确认为当前证据；任务尚未验证。` : null;
}

export function browserLoadPauseReason(tools: readonly AgentToolCallView[]): string | null {
  const last = [...tools].reverse().find(tool => tool.name === 'browser');
  const receipt = last?.receipt as Record<string, unknown> | null;
  return receipt && (receipt.error_code === 'BROWSER_NAVIGATION_FAILED' || (receipt.navigation_generation === 0 && receipt.text === ''))
    ? '目标页面未能加载，尚未完成页面验证。已保留加载失败的记录，可继续排查服务地址与启动状态。' : null;
}

export function activityNarrativePreview(text: string): string | null {
  if (text.length <= 420 && !text.includes('```') && text.split('\n').length <= 6) return null;
  const paragraph = text.split(/\r?\n\s*\r?\n|```/)[0]?.trim() ?? '';
  const plain = paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`#]/g, '').replace(/\s+/g, ' ');
  return plain ? `${plain.slice(0, 180)}${plain.length > 180 ? '…' : ''}` : '查看详细分析';
}

export function activityFailureReason(run: AgentRunView | null): string | null {
  if (run?.status !== 'FAILED' || !run.error_code) return null;
  const labels: Record<string, string> = {
    AGENT_MAX_STEPS_REACHED: run.current_step < run.max_steps ? '旧版局部策略提前结束，任务尚未完成' : '已达到本轮整体执行额度，任务尚未完成',
    AGENT_TEXT_MATCH_FAILED: '待替换内容未能唯一匹配，修改未生效',
    AGENT_FILE_CHANGED: '文件内容已变化，需要重新核对修改',
    PROVIDER_RATE_LIMITED: '模型服务暂时限流',
    PROVIDER_MODEL_MISMATCH: '模型与协议不匹配。请在模型配置中编辑连接，选择对应服务商和套餐后重试。',
    MODEL_CONFIGURATION_UNSUPPORTED: '模型服务或推理设置已变化，无法沿用此任务的配置。请检查模型设置后创建新任务。',
    PROVIDER_PROTOCOL_ERROR: '模型服务未正确返回响应',
    PROVIDER_REQUEST_REJECTED: '模型服务拒绝了请求',
    CREDENTIAL_REJECTED: '模型凭据未通过验证',
    AGENT_VERIFICATION_STALE: '当前修改尚未获得有效验证',
  };
  return providerResponseReason(run.error_code) ?? labels[run.error_code] ?? '执行中断，详情中保留了失败代码';
}
