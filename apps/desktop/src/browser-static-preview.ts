import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 16 * 1024 * 1024;
const MIME: Record<string, string> = { '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' };
type FileFact = { path: string; sha256: string; bytes: number };

/** A mode of the existing run-owned preview server, never a project mutation. */
export class BrowserStaticPreview {
  readonly files = new Map<string, FileFact>();
  readonly responses = new Map<string, string>();
  private invalid = false;
  private total = 0;
  private server: Server | undefined;
  private root = '';
  private prefix = '';
  url = '';

  async start(project: string, directory: unknown): Promise<void> {
    if (typeof directory !== 'string' || directory.length > 1024 || path.isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) throw new Error('BROWSER_STATIC_DIRECTORY');
    const projectRoot = await realpath(project);
    this.root = await realpath(path.join(projectRoot, directory));
    if ((this.root !== projectRoot && !this.root.startsWith(projectRoot + path.sep)) || !(await stat(this.root)).isDirectory()) throw new Error('BROWSER_STATIC_DIRECTORY');
    this.prefix = `/${randomUUID()}/`;
    this.server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', this.url);
        if (req.headers.host === new URL(this.url).host && req.method === 'GET' && url.pathname === '/favicon.ico') {
          this.responses.set(url.href, ''); res.writeHead(204); res.end(); return;
        }
        // A random mount avoids reusing previous origin Service Worker scopes.
        if (req.headers.host !== new URL(this.url).host || req.method !== 'GET' || !url.pathname.startsWith(this.prefix)) { res.writeHead(404); res.end(); return; }
        const relative = decodeURIComponent(url.pathname.slice(this.prefix.length)) || 'index.html';
        if (relative.split(/[\\/]/).some(p => p === '..' || p.startsWith('.')) || path.isAbsolute(relative)) throw new Error('path');
        const candidate = path.join(this.root, relative);
        const canonical = await realpath(candidate);
        if (!canonical.startsWith(this.root + path.sep) || canonical !== candidate) throw new Error('path');
        const info = await stat(canonical);
        if (!info.isFile() || info.size > MAX_FILE) throw new Error('size');
        const bytes = await readFile(canonical);
        if (bytes.length > MAX_FILE) throw new Error('size');
        const fact = { path: relative, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
        const previous = this.files.get(relative);
        if (previous && previous.sha256 !== fact.sha256) this.invalid = true;
        if (!previous) this.total += bytes.length;
        if (this.files.size >= 64 || this.total > MAX_TOTAL) { this.invalid = true; throw new Error('limit'); }
        this.files.set(relative, fact);
        this.responses.set(url.href, relative);
        res.writeHead(200, { 'Content-Type': `${MIME[path.extname(relative).toLowerCase()] ?? 'application/octet-stream'}; charset=utf-8`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          // This explicit static mode excludes workers/plugins/frames, whose
          // independent requests could otherwise escape page resource accounting.
          'Content-Security-Policy': "worker-src 'none'; frame-src 'none'; object-src 'none'",
          'Connection-Allowlist': '(response-origin)' });
        res.end(bytes);
      })().catch(() => { this.invalid = true; if (!res.headersSent) res.writeHead(404); res.end(); });
    });
    this.server.on('upgrade', (_req, socket) => { this.invalid = true; socket.destroy(); });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve); });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('BROWSER_STATIC_START');
    this.url = `http://127.0.0.1:${address.port}${this.prefix}`;
  }

  scope(url: string, requests: readonly string[], unknown: boolean): Record<string, unknown> | undefined {
    if (this.invalid || unknown || !url.startsWith(this.url) || requests.length < 1 || requests.length > 128
      || !requests.includes(url) || requests.some(request => !this.responses.has(request))) return undefined;
    const used = new Set(requests.map(request => this.responses.get(request)!).filter(Boolean));
    const files = [...used].sort().map(file => this.files.get(file)!);
    return { version: 'STATIC_PREVIEW_HTTP_V1', root: this.root, url, files,
      closure: 'HOST_STATIC_RESPONSES_NATIVE_PAGE_REQUESTS', scope: 'RECORDED_ASSERTION_INPUTS_ONLY' };
  }

  isBuiltinEmptyIcon(url: string, method: string): boolean {
    try { const requested = new URL(url); return method === 'GET' && requested.origin === new URL(this.url).origin && requested.pathname === '/favicon.ico'; }
    catch { return false; }
  }

  stop(): void { this.server?.closeAllConnections(); this.server?.close(); this.server = undefined; }
}
