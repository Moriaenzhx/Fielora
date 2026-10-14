import { BrowserWindow, screen } from 'electron';
import type { AgentRunView, AgentToolCallView } from '@fielora/contracts';
import { ComputerFeedbackActivity, computerActionLabels, computerPointerFeedback } from './computer-feedback';

const cursorSvg = '<svg width="38" height="42" viewBox="0 0 38 42" xmlns="http://www.w3.org/2000/svg"><path d="M5 3L5 31L13 24L19 37L25 34L19 22L30 21Z" fill="rgba(122,94,230,.42)" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><path d="M5 3L5 31L13 24L19 37L25 34L19 22L30 21Z" fill="none" stroke="#7756d9" stroke-width="1" stroke-linejoin="round"/></svg>';
const head = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'none\'"><style>html,body{margin:0;background:transparent;font-family:system-ui,sans-serif;overflow:hidden}*{box-sizing:border-box}</style>';
const pointerHtml = head + '<title>Fielora Computer Pointer</title><div data-testid="computer-pointer-feedback" style="filter:drop-shadow(0 2px 3px #35245566)">' + cursorSvg + '</div></html>';
const badgeHtml = head + '<title>Fielora Computer Control</title><style>body{padding:4px}.bar{height:40px;display:flex;align-items:center;gap:9px;padding:0 11px;color:#fff;background:#493c70ed;border:1px solid #ffffff44;border-radius:13px;box-shadow:0 2px 4px #0002;font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:#b7a3ff;flex:none}.text{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}a{color:inherit;padding:4px 7px;border-radius:6px;text-decoration:none;background:#ffffff20}a:hover,a:focus{background:#ffffff40;outline:1px solid #fff}</style><div class="bar"><span class="dot"></span><span class="text" data-testid="computer-control-status">Fielora · 电脑操作</span><a href="fielora-control-stop://current" data-testid="computer-control-stop" aria-label="停止电脑操作任务">停止</a></div></html>';

/** Ephemeral presentation of the existing ledger. No renderer bridge, image
 * input, execution authority or independent task state is introduced. */
export class ComputerControlOverlay {
  private badge?: BrowserWindow;
  private pointer?: BrowserWindow;
  private badgeReady: Promise<void> = Promise.resolve();
  private pointerReady: Promise<void> = Promise.resolve();
  private epoch = 0;
  private runId = '';
  private readonly suspended = new Set<string>();
  private readonly activity = new ComputerFeedbackActivity();
  private pointerTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly request: (method: string, params: unknown) => Promise<unknown>) {}

  resume(runId: string): void { this.suspended.delete(runId); }
  suspend(runId: string): void { this.suspended.add(runId); if (this.runId === runId) this.clear(); }
  changed(value: unknown): void {
    const event = value as { run_id?: string; status?: string } | null;
    if (event?.run_id && event.status !== 'RUNNING') {
      this.activity.runEnded(event.run_id);
      if (event.run_id === this.runId) this.clear();
    }
  }
  clear(): void {
    this.epoch += 1; this.runId = '';
    clearTimeout(this.pointerTimer); clearTimeout(this.idleTimer);
    if (this.pointer && !this.pointer.isDestroyed()) this.pointer.hide();
    if (this.badge && !this.badge.isDestroyed()) this.badge.hide();
  }
  prepare(runId: string, toolId: string): boolean {
    this.activity.begin(runId, toolId);
    this.clear();
    return (!this.pointer || this.pointer.isDestroyed() || !this.pointer.isVisible())
      && (!this.badge || this.badge.isDestroyed() || !this.badge.isVisible());
  }
  dispose(): void {
    this.clear(); this.suspended.clear(); this.activity.reset();
    if (this.pointer && !this.pointer.isDestroyed()) this.pointer.destroy();
    if (this.badge && !this.badge.isDestroyed()) this.badge.destroy();
    this.pointer = this.badge = undefined;
  }
  private makeWindow(title: string, width: number, height: number, ignoreMouse: boolean): BrowserWindow {
    const window = new BrowserWindow({ width, height, title, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        devTools: process.env.FIELORA_E2E === '1', partition: 'fielora-computer-feedback' } });
    window.setAlwaysOnTop(true, 'floating');
    window.setIgnoreMouseEvents(ignoreMouse);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (!ignoreMouse && url === 'fielora-control-stop://current' && this.runId) {
        const runId = this.runId;
        this.suspend(runId);
        const epoch = this.epoch;
        void this.request('command.agent.cancel', { run_id: runId }).catch(async () => {
          if (epoch !== this.epoch || !this.badge || this.badge.isDestroyed()) return;
          this.runId = runId;
          await this.badge.webContents.executeJavaScript('document.querySelector("[data-testid=computer-control-status]").textContent="停止尚未确认，请重试"').catch(() => undefined);
          if (epoch === this.epoch) this.badge.showInactive();
        });
      }
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    return window;
  }
  private ensureWindows(): void {
    if (!this.badge || this.badge.isDestroyed()) {
      this.badge = this.makeWindow('Fielora Computer Control', 340, 48, false);
      this.badgeReady = this.badge.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(badgeHtml)}`);
    }
    if (!this.pointer || this.pointer.isDestroyed()) {
      this.pointer = this.makeWindow('Fielora Computer Pointer', 42, 46, true);
      this.pointerReady = this.pointer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pointerHtml)}`);
    }
  }
  async handle(value: unknown): Promise<void> {
    if (process.platform !== 'darwin') return;
    const event = value as { run_id?: string; tool_call_id?: string; phase?: string } | null;
    if (!event?.run_id || !event.tool_call_id) return;
    if (event.phase === 'TOOL_STARTED') { this.clear(); return; }
    this.activity.completed(event.run_id, event.tool_call_id);
    if (this.activity.busy || this.suspended.has(event.run_id)) return;
    const epoch = ++this.epoch;
    this.runId = event.run_id;
    clearTimeout(this.pointerTimer); clearTimeout(this.idleTimer);
    this.pointer?.hide(); // Never let presentation interfere with the next native hit test.
    try {
      const [run, tools] = await Promise.all([
        this.request('query.agent.get', { run_id: event.run_id }) as Promise<AgentRunView>,
        this.request('query.agent.tool_calls', { run_id: event.run_id }) as Promise<AgentToolCallView[]>,
      ]);
      if (epoch !== this.epoch || this.suspended.has(event.run_id) || run.status !== 'RUNNING') return;
      const tool = tools.find(item => item.id === event.tool_call_id && item.run_id === run.id && item.name === 'computer');
      if (!tool || tool.status === 'RUNNING') return;
      const receipt = tool.receipt as Record<string, unknown> | null;
      const args = tool.arguments as Record<string, unknown>;
      const action = typeof receipt?.action === 'string' ? receipt.action : String(args.action ?? '');
      if (action === 'status') { this.clear(); return; }
      const native = receipt?.kind === 'COMPUTER';
      const target = native ? receipt?.target as Record<string, unknown> | undefined : undefined;
      const appName = typeof target?.name === 'string' ? target.name.slice(0, 80) : '应用';
      const successful = tool.status === 'COMPLETED' && native && receipt?.success === true && receipt?.outcome_unknown !== true;
      const phrase = computerActionLabels[action] ?? '操作应用';
      const label = `Fielora · ${appName} · ${successful ? '已' : '未完成'}${phrase}`;
      const feedback = computerPointerFeedback(tool);
      this.ensureWindows();
      await this.badgeReady;
      if (epoch !== this.epoch || !this.badge || this.badge.isDestroyed()) return;
      const display = screen.getDisplayNearestPoint(feedback ? { x: Math.round(feedback.x), y: Math.round(feedback.y) } : screen.getCursorScreenPoint());
      this.badge.setPosition(Math.round(display.workArea.x + (display.workArea.width - 340) / 2), display.workArea.y + 8, false);
      await this.badge.webContents.executeJavaScript(`document.querySelector('[data-testid="computer-control-status"]').textContent=${JSON.stringify(label)};document.body.dataset.state=${JSON.stringify(tool.status)}`);
      if (epoch !== this.epoch) return;
      this.badge.showInactive();
      if (feedback) {
        await this.pointerReady;
        if (epoch !== this.epoch || !this.pointer || this.pointer.isDestroyed()) return;
        this.pointer.setPosition(Math.round(feedback.x - 5), Math.round(feedback.y - 3), false);
        await this.pointer.webContents.executeJavaScript(`Object.assign(document.querySelector('[data-testid="computer-pointer-feedback"]').dataset,${JSON.stringify({ action: feedback.action, x: String(feedback.x), y: String(feedback.y), state: 'DISPATCHED', coordinateSpace: 'SCREEN_POINTS' })})`);
        if (epoch !== this.epoch) return;
        this.pointer.showInactive();
        this.pointerTimer = setTimeout(() => this.pointer?.hide(), 1500);
      }
      // Quiet model work must not look like continuous OS input.
      this.idleTimer = setTimeout(() => { if (epoch === this.epoch) this.clear(); }, 8000);
    } catch { if (epoch === this.epoch) this.clear(); }
  }
}
