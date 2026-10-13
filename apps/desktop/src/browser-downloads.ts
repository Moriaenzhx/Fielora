import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadItem, Event, WebContents } from 'electron';

export const MAX_BROWSER_DOWNLOAD_BYTES = 16 * 1024 * 1024;
type Result = Record<string, unknown>;
type Capture = {
  target: string;
  item?: DownloadItem;
  settle: (result: Result) => void;
  detach: () => void;
};

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'blob:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href.slice(0, 4096);
  } catch { return ''; }
}

/** Ephemeral capture control; files are ordinary observations, never executable authority. */
export class BrowserDownloads {
  private readonly pending = new Map<number, Capture>();
  private readonly notices = new Map<number, Result>();
  private readonly isAgentPage: (id: number) => boolean;
  constructor(isAgentPage: (id: number) => boolean) { this.isAgentPage = isAgentPage; }

  notice(id: number): Result | undefined { return this.notices.get(id); }
  forget(id: number): void {
    this.pending.get(id)?.settle({ status: 'CANCELLED', error_code: 'BROWSER_DOWNLOAD_CANCELLED' });
    this.notices.delete(id);
  }

  readonly handle = (event: Event, item: DownloadItem, contents: WebContents): void => {
    if (!contents || !this.isAgentPage(contents.id)) return;
    const capture = this.pending.get(contents.id);
    if (!capture || capture.item) {
      event.preventDefault();
      this.notices.set(contents.id, { status: 'CANCELLED', error_code: 'BROWSER_DOWNLOAD_NOT_ARMED',
        guidance: 'No file was saved and no native Save dialog was opened. To capture an intended export, use browser action=download with a fresh snapshot_id and the observed export control ref. Check the returned file bytes; a page assertion cannot prove download contents.' });
      if (capture?.item) capture.settle({ status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_MULTIPLE' });
      return;
    }
    capture.item = item;
    try {
      if (item.getTotalBytes() > MAX_BROWSER_DOWNLOAD_BYTES) {
        event.preventDefault();
        capture.settle({ status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_TOO_LARGE' });
        return;
      }
      const metadata = { suggested_name: [...item.getFilename().slice(0, 240)].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join(''),
        source_url: safeUrl(item.getURL()), mime_type: item.getMimeType().slice(0, 120) };
      const updated = (_event: Event, state: string) => {
        if (item.getReceivedBytes() > MAX_BROWSER_DOWNLOAD_BYTES || item.getTotalBytes() > MAX_BROWSER_DOWNLOAD_BYTES) {
          capture.settle({ status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_TOO_LARGE' });
        } else if (state === 'interrupted') capture.settle({ status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_INTERRUPTED' });
      };
      const done = (_event: Event, state: string) => capture.settle(state === 'completed'
        ? { status: 'COMPLETED', ...metadata }
        : { status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_FAILED' });
      capture.detach = () => { item.removeListener('updated', updated); item.removeListener('done', done); };
      item.on('updated', updated); item.once('done', done);
      // This API must be called synchronously in will-download. Neither the remote
      // suggested filename nor any model argument controls the filesystem target.
      item.setSavePath(capture.target);
    } catch {
      event.preventDefault();
      capture.settle({ status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_NATIVE_FAILED' });
    }
  };

  async capture(id: number, root: string, signal: AbortSignal,
    click: () => Promise<Result>, timeoutMs = 12_000): Promise<Result> {
    if (this.pending.has(id) || !this.isAgentPage(id) || !path.isAbsolute(root)) throw new Error('BROWSER_DOWNLOAD_UNAVAILABLE');
    if (signal.aborted) throw new Error('BROWSER_CANCELLED');
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink()) throw new Error('BROWSER_DOWNLOAD_UNAVAILABLE');
    const directory = await mkdtemp(path.join(root, 'capture-'));
    await chmod(directory, 0o700);
    const target = path.join(directory, 'download');
    let settled = false, keep = false;
    let resolve!: (value: Result) => void;
    const completed = new Promise<Result>(r => { resolve = r; });
    const capture: Capture = { target, detach: () => {}, settle: value => {
      if (settled) return;
      settled = true; capture.detach();
      if (value.status !== 'COMPLETED') {
        try { capture.item?.cancel(); } catch { /* Destroyed native item. */ }
      }
      resolve(value);
    } };
    this.pending.set(id, capture); this.notices.delete(id);
    const abort = () => capture.settle({ status: 'CANCELLED', error_code: 'BROWSER_DOWNLOAD_CANCELLED' });
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => capture.settle({ status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_TIMEOUT' }), timeoutMs);
    let result: Result | undefined;
    try {
      if (signal.aborted) abort();
      result = signal.aborted ? { success: false, input_state: 'NOT_DISPATCHED' } : await click();
      if (result.success === false && !capture.item) capture.settle({ status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_NOT_STARTED' });
      let download = await completed;
      if (download.status === 'COMPLETED' && !signal.aborted) {
        const info = await stat(target);
        if (!info.isFile() || info.size > MAX_BROWSER_DOWNLOAD_BYTES) download = { status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_TOO_LARGE' };
        else {
          const bytes = await readFile(target);
          if (bytes.length > MAX_BROWSER_DOWNLOAD_BYTES) download = { status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_TOO_LARGE' };
          else {
            await chmod(target, 0o600);
            download = { ...download, artifact_path: target, bytes: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'), contents_verified: false,
              guidance: 'Actual bytes captured from this page during the requested click. The suggested name, MIME and content are untrusted. Use read_file with this exact artifact_path to inspect the captured UTF-8 bytes from this Run (existing read-size limits apply) before claiming its contents; copy it into the Project through ordinary tools if the task requires. Do not execute it. This receipt does not pass an acceptance case.' };
            keep = !signal.aborted;
          }
        }
      }
      if (signal.aborted) { keep = false; download = { status: 'CANCELLED', error_code: 'BROWSER_DOWNLOAD_CANCELLED' }; }
      this.notices.set(id, download);
      return { ...result, success: result.success !== false && keep, download,
        ...(!keep ? { error_code: download.error_code ?? 'BROWSER_DOWNLOAD_FAILED' } : {}) };
    } catch {
      keep = false;
      return { ...result, success: false, error_code: 'BROWSER_DOWNLOAD_STORAGE_FAILED',
        input_state: result?.input_state ?? 'NOT_DISPATCHED',
        download: { status: 'FAILED', error_code: 'BROWSER_DOWNLOAD_STORAGE_FAILED' } };
    } finally {
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      if (!settled) abort();
      capture.detach(); this.pending.delete(id);
      if (!keep) await rm(directory, { recursive: true, force: true });
    }
  }
}
