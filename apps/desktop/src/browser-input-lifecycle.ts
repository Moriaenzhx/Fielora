import type { Debugger } from 'electron';

export type BrowserDialogProgress = { state: 'OPEN' | 'CLOSED'; dialog_type?: string; accepted?: boolean };
export type BrowserInputReporter = {
  dialog: (progress: BrowserDialogProgress & { page_id: string }) => void;
  late: (result: Record<string, unknown>) => void;
};

// Chromium can hold the input acknowledgement while a native dialog is open.
// Cancellation releases the caller, not the underlying input. Keep listening
// until it settles; never dispatch a replacement or infer delivery from a dialog.
export async function browserInputLifecycle<T>(debug: Debugger, signal: AbortSignal,
  operation: () => Promise<T>, progress: (value: BrowserDialogProgress) => void,
  settled: (late: boolean) => void): Promise<T> {
  const owned = !debug.isAttached();
  try { if (owned) debug.attach('1.3'); }
  catch (error) { settled(false); throw error; }
  let returnedEarly = false;
  let opened = false;
  const message = (_event: unknown, method: string, params: Record<string, unknown>) => {
    if (method === 'Page.javascriptDialogOpening') {
      opened = true;
      progress({ state: 'OPEN', dialog_type: ['alert', 'confirm', 'prompt', 'beforeunload'].includes(String(params.type)) ? String(params.type) : 'unknown' });
    } else if (method === 'Page.javascriptDialogClosed' && opened) {
      opened = false;
      progress({ state: 'CLOSED', accepted: params.result === true });
    }
  };
  debug.on('message', message);
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => { returnedEarly = true; reject(new Error('BROWSER_CANCELLED')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  const work = (async () => {
    await debug.sendCommand('Page.enable');
    if (signal.aborted) throw new Error('BROWSER_CANCELLED');
    return operation();
  })().finally(() => {
    signal.removeEventListener('abort', abort);
    debug.removeListener('message', message);
    try { if (owned && debug.isAttached()) debug.detach(); } catch { /* destroyed WebContents */ }
    settled(returnedEarly);
  });
  return Promise.race([work, cancelled]);
}

// Both ordinary execution and human waiting are bounded. Closing a dialog gives
// the in-flight command a fresh ordinary deadline; duplicate events do not.
export class BrowserOperationDeadline {
  private timer: ReturnType<typeof setTimeout>;
  private readonly total: ReturnType<typeof setTimeout>;
  private waiting = false;
  private closed = false;
  private readonly expire: () => void;
  private readonly operationMs: number;
  constructor(expire: () => void, operationMs = 25_000, totalMs = 600_000) {
    this.expire = expire;
    this.operationMs = operationMs;
    this.timer = setTimeout(expire, operationMs);
    this.total = setTimeout(expire, totalMs);
  }
  dialog(state: 'OPEN' | 'CLOSED'): void {
    if (this.closed) return;
    if (state === 'OPEN' && !this.waiting) { this.waiting = true; clearTimeout(this.timer); }
    if (state === 'CLOSED' && this.waiting) { this.waiting = false; this.timer = setTimeout(this.expire, this.operationMs); }
  }
  clear(): void { this.closed = true; clearTimeout(this.timer); clearTimeout(this.total); }
}
