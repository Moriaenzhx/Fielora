import type { BrowserRuntime } from './browser-runtime';
import type { WorkspaceRuntime } from './workspace-runtime';
import { browserServerAddress, probeBrowserServer } from './agent-browser-health.ts';

type Request = { request_id: string; run_id: string; conversation_id: string; tool_call_id: string; name: string; arguments: Record<string, unknown>; project_root?: string; field_id?: string };
const actions = ['open', 'inspect', 'reload', 'click', 'fill', 'select', 'scroll', 'screenshot', 'resize', 'request_login'];
const properties = ['text', 'value', 'visible', 'enabled', 'readonly', 'before', 'contains', 'absent'];
function bounded(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
export function browserServerCommand(args: Record<string, unknown>): string {
  if (typeof args.program !== 'string' || !/^(node|npm|pnpm|yarn)(\.exe|\.cmd)?$/.test(args.program)
    || !Array.isArray(args.argv) || args.argv.length > 64 || !args.argv.every(a => typeof a === 'string' && a.length <= 2000 && !/[\0\r\n]/.test(a))) throw new Error('BROWSER_SERVER_ARGUMENTS');
  const program = ['npm', 'pnpm', 'yarn'].includes(args.program) ? `${args.program}.cmd` : args.program;
  return `& ${[program, ...args.argv].map(a => `'${String(a).replaceAll("'", "''")}'`).join(' ')}`;
}
export function browserHttpUrl(value: unknown): string {
  if (!bounded(value, 4096)) throw new Error('BROWSER_URL_REJECTED');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('BROWSER_URL_REJECTED');
  return url.href;
}

export class AgentBrowserHost {
  private readonly pending = new Map<string, AbortController>();
  private readonly plans = new Map<string, { url: string; cases: { id: string; requirement: string }[] }>();
  private readonly servers = new Map<string, string>();
  private readonly workspace: (() => WorkspaceRuntime) | undefined;
  // Serializing native page actions prevents two runs switching the active view midway.
  private queue: Promise<unknown> = Promise.resolve();
  private readonly runtime: () => BrowserRuntime;
  private readonly request: (method: string, params: unknown) => Promise<unknown>;
  private readonly reveal: (runId: string, conversationId: string) => void;
  constructor(runtime: () => BrowserRuntime,
    request: (method: string, params: unknown) => Promise<unknown>,
    reveal: (runId: string, conversationId: string) => void, workspace?: () => WorkspaceRuntime) { this.runtime = runtime; this.request = request; this.reveal = reveal; this.workspace = workspace; }

  cancel(id: string): void { this.pending.get(id)?.abort(); }
  reset(): void { for (const controller of this.pending.values()) controller.abort(); this.plans.clear(); for (const id of this.servers.values()) void this.workspace?.().stopAgentServer(id).catch(() => undefined); this.servers.clear(); }

  handle(input: Request): void {
    if (!bounded(input.request_id, 100) || !bounded(input.run_id, 100) || !bounded(input.tool_call_id, 100)) return;
    const controller = new AbortController();
    this.pending.set(input.request_id, controller);
    const deadline = setTimeout(() => controller.abort(), 25_000);
    const work = this.queue.then(() => this.execute(input, controller.signal));
    this.queue = work.catch(() => undefined);
    void work.catch(error => {
      if (process.env.FIELORA_E2E === '1') console.warn('[agent-browser-fixture]', input.name, error instanceof Error ? error.message : 'unknown');
      const code = error instanceof Error && /^BROWSER_[A-Z_]+$/.test(error.message) ? error.message : 'BROWSER_OPERATION_FAILED';
      const guidance = code === 'BROWSER_INVALID_ARGUMENTS'
        ? 'No input was dispatched. click/fill/select/scroll require an observed ref such as e12. scroll means reveal that element (scrollIntoView), not a direction: supply action=scroll, snapshot_id from the latest inspect, and ref. fill/select also require value.'
        : code === 'BROWSER_STALE_SNAPSHOT'
          ? 'No input was dispatched. Supply snapshot_id from the latest inspect and an observed element ref for input actions. An omitted snapshot_id is an argument error; repeating inspect without using its id cannot fix it.'
          : undefined;
      return { kind: 'BROWSER', success: false, error_code: code, input_state: 'NOT_DISPATCHED', outcome_unknown: false, ...(guidance ? { guidance } : {}) };
    })
      .then(result => this.request('host.browser.complete', { request_id: input.request_id, result }))
      .catch(() => undefined).finally(() => { clearTimeout(deadline); this.pending.delete(input.request_id); });
  }

  private async execute(input: Request, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (signal.aborted) throw new Error('BROWSER_CANCELLED');
    const args = input.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('BROWSER_INVALID_ARGUMENTS');
    if (input.name === 'browser_server') {
      if (args.url !== undefined) browserServerAddress(args.url);
      if (!this.workspace || !input.project_root || !input.field_id) throw new Error('BROWSER_SERVER_UNAVAILABLE');
      const workspace = this.workspace();
      let id = this.servers.get(input.run_id);
      if (args.action === 'start') {
        if (id && workspace.agentServerStatus(id).status === 'RUNNING') throw new Error('BROWSER_SERVER_ALREADY_RUNNING');
        if (id) await workspace.stopAgentServer(id);
        id = await workspace.startAgentServer(input.project_root, input.field_id, browserServerCommand(args));
        this.servers.set(input.run_id, id);
        if (signal.aborted) { await workspace.stopAgentServer(id); throw new Error('BROWSER_CANCELLED'); }
      } else if (args.action === 'stop') {
        if (id) await workspace.stopAgentServer(id);
        return { kind: 'BROWSER', action: 'server-stop', success: true, status: 'STOPPED' };
      } else if (args.action !== 'status') throw new Error('BROWSER_SERVER_ARGUMENTS');
      if (!id) {
        if (args.url !== undefined) return { kind: 'BROWSER', action: 'server-status', success: true,
          process_tracking: 'NOT_MANAGED', ...await probeBrowserServer(args.url, signal), verification_eligible: false };
        return { kind: 'BROWSER', action: 'server-status', success: false, error_code: 'BROWSER_SERVER_NOT_TRACKED',
          process_tracking: 'NOT_MANAGED', readiness: 'NOT_CHECKED', verification_eligible: false,
          guidance: 'This host has no run-owned process handle, possibly after restart. This does not prove the development server is stopped. Check the configured address with status and url before starting another process; reuse the recorded startup command if a start is actually needed.' };
      }
      const state = workspace.agentServerStatus(id);
      const readiness = state.status === 'RUNNING' && args.url !== undefined
        ? await probeBrowserServer(args.url, signal)
        : { readiness: state.status === 'RUNNING' ? 'NOT_CHECKED' : 'PROCESS_STOPPED', guidance: 'RUNNING means the process is alive, not that a website is ready. Read the referenced dev-server configuration for its host, port and protocol; status with url checks a local listening socket. Do not guess the port from arbitrary flags.' };
      return { kind: 'BROWSER', action: `server-${String(args.action)}`, success: state.status === 'RUNNING', ...state, ...readiness, verification_eligible: false };
    }
    if (input.name === 'browser_plan') {
      browserHttpUrl(args.url);
      if (!Array.isArray(args.cases) || args.cases.length < 1 || args.cases.length > 24
        || !args.cases.every(c => c && bounded(c.id, 80) && bounded(c.requirement, 600) && c.requirement.length >= 8)
        || new Set(args.cases.map(c => c.id)).size !== args.cases.length) throw new Error('BROWSER_INVALID_PLAN');
      const plan = { url: args.url as string, cases: args.cases as { id: string; requirement: string }[] };
      this.plans.set(input.run_id, plan);
      return { kind: 'BROWSER', action: 'plan', success: true, ...plan };
    }
    const verify = input.name === 'browser_verify';
    if (!verify && (input.name !== 'browser' || !actions.includes(String(args.action)))) throw new Error('BROWSER_INVALID_ARGUMENTS');
    const action = verify ? 'verify' : String(args.action);
    if (action === 'open') browserHttpUrl(args.url);
    if (action === 'resize' && (!Number.isInteger(args.width) || !Number.isInteger(args.height) || Number(args.width) < 640 || Number(args.width) > 2560 || Number(args.height) < 480 || Number(args.height) > 1600)) throw new Error('BROWSER_INVALID_VIEWPORT');
    if (['click', 'fill', 'select', 'scroll', 'verify', 'request_login'].includes(action) && !bounded(args.snapshot_id, 100)) throw new Error('BROWSER_STALE_SNAPSHOT');
    if (['click', 'fill', 'select', 'scroll'].includes(action) && (!bounded(args.ref, 20) || !/^e\d{1,3}$/.test(args.ref))) throw new Error('BROWSER_INVALID_ARGUMENTS');
    if (['fill', 'select'].includes(action) && (typeof args.value !== 'string' || args.value.length > 4096)) throw new Error('BROWSER_INVALID_ARGUMENTS');
    const plan = this.plans.get(input.run_id);
    if (verify && (!plan?.cases.some(c => c.id === args.case_id) || !Array.isArray(args.checks)
      || args.checks.length < 1 || args.checks.length > 32 || !args.checks.every(c => c && properties.includes(c.property)
        && typeof c.expected === 'string' && c.expected.length <= 2000 && (!['contains', 'absent'].includes(c.property) || c.expected.length > 0)))) throw new Error('BROWSER_INVALID_CHECK');
    if (['open', 'inspect', 'screenshot', 'request_login'].includes(action) || verify) this.reveal(input.run_id, input.conversation_id);
    const runtime = this.runtime();
    const result = await runtime.executeAgent(input.run_id, { action, url: args.url as string | undefined, width: args.width as number | undefined, height: args.height as number | undefined,
      snapshot_id: args.snapshot_id as string | undefined, next_snapshot_id: '', ref: args.ref as string | undefined,
      value: args.value as string | undefined, checks: args.checks as { ref?: string; property: string; expected: string }[] | undefined }, signal);
    if (result.success === false && result.error_code) return { kind: 'BROWSER', action, ...result, case_id: args.case_id, plan_url: plan?.url };
    if (verify && browserHttpUrl(result.url) !== browserHttpUrl(plan!.url)) throw new Error('BROWSER_WRONG_TARGET');
    let screenshot: unknown;
    if (verify || action === 'screenshot') {
      try {
        const capture = await runtime.captureCurrentViewport({ signal });
        if (signal.aborted) throw new Error('BROWSER_CANCELLED');
        if (capture.page_id !== result.page_id || capture.navigation_generation !== result.navigation_generation || capture.captured_url !== result.url) throw new Error('BROWSER_STALE_PAGE');
        screenshot = await this.request('command.screenshot_evidence.create', { ...capture,
          conversation_id: input.conversation_id, run_id: input.run_id, tool_call_id: input.tool_call_id, verification_receipt_id: null });
      } catch {
        // Preserve measured checks and the new snapshot even if the independent
        // evidence capture fails. The case remains unverified until retried.
        return { kind: 'BROWSER', action, ...result, success: false, error_code: 'BROWSER_SCREENSHOT_FAILED', case_id: args.case_id, plan_url: plan?.url };
      }
    }
    return { kind: 'BROWSER', action, ...result, ...(verify ? { case_id: args.case_id, plan_url: plan!.url, requirement: plan!.cases.find(c => c.id === args.case_id)!.requirement } : {}), ...(screenshot ? { screenshot } : {}) };
  }
}
