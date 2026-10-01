import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ApplyWorkspaceFileRequest, TerminalEvent, TerminalRunResult, WorkspaceFileEntry,
  WorkspaceEnvironmentView, WorkspaceFileView, WorkspaceImagePreview,
} from './workspace-types';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 2_500;
const MAX_DEPTH = 16;
const MAX_TERMINAL_OUTPUT_BYTES = 512 * 1024;
const IGNORED_DIRECTORIES = new Set(['.git', '.webpack', 'node_modules', 'target', 'dist', 'build', 'out']);

interface TerminalRun {
  child: ChildProcessWithoutNullStreams;
  fieldId: string;
  cancelled: boolean;
  emittedBytes: number;
  truncated: boolean;
  tail: string;
  terminated: boolean;
}

// All Unix terminals are launched in their own group. Never signal the app's group.
function terminateRun(run: TerminalRun): void {
  if (run.terminated || !run.child.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/PID', String(run.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    } else {
      process.kill(-run.child.pid, 'SIGKILL');
    }
    run.terminated = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH' || run.child.exitCode !== null || run.child.signalCode !== null) run.terminated = true;
    else throw error;
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeRelative(value: string): string {
  if (!value || value.length > 4_096 || value.includes('\0') || path.isAbsolute(value)) {
    throw new Error('Invalid project-relative path');
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('Invalid project-relative path');
  }
  return normalized;
}

function terminalDirectoryTarget(command: string): string | null {
  const match = /^(cd|chdir|sl|set-location)(.*)$/i.exec(command.trim());
  if (!match) return null;
  const suffix = match[2] ?? '';
  if (!suffix || !/^[\s.\\/~'"]/.test(suffix) || /[;|&]/.test(suffix)) return null;
  let target = suffix.trim().replace(/^\/d\s+/i, '').trim();
  if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) target = target.slice(1, -1);
  return target || null;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new Error('Binary files are not supported');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Only UTF-8 text files are supported');
  }
}

function imageMime(relativePath: string, bytes: Uint8Array): WorkspaceImagePreview['mime_type'] | null {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.png' && bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if ((extension === '.jpg' || extension === '.jpeg') && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'image/jpeg';
  if (extension === '.gif' && ['GIF87a', 'GIF89a'].includes(Buffer.from(bytes.subarray(0, 6)).toString('ascii'))) return 'image/gif';
  if (extension === '.webp' && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export class WorkspaceRuntime {
  readonly #runs = new Map<string, TerminalRun>();
  readonly #agentServers = new Set<string>();
  readonly #terminalResults = new Map<string, { status: string; output: string; exit_code: number | null }>();

  async startAgentServer(root: string, fieldId: string, command: string): Promise<string> {
    if (this.#agentServers.size >= 4) throw new Error('BROWSER_SERVER_LIMIT');
    const result = await this.runTerminal(root, fieldId, command);
    this.#agentServers.add(result.run_id);
    return result.run_id;
  }

  agentServerStatus(id: string): { status: string; output: string; exit_code: number | null } {
    const run = this.#runs.get(id);
    return run ? { status: 'RUNNING', output: run.tail, exit_code: null } : this.#terminalResults.get(id) ?? { status: 'STOPPED', output: '', exit_code: null };
  }

  async stopAgentServer(id: string): Promise<void> {
    if (!this.#agentServers.has(id)) return;
    const run = this.#runs.get(id);
    if (run?.child.pid && run.child.exitCode === null) {
      run.cancelled = true;
      terminateRun(run);
    }
    this.#agentServers.delete(id);
  }
  readonly #emit: (event: TerminalEvent) => void;

  constructor(emit: (event: TerminalEvent) => void) { this.#emit = emit; }

  async #root(rootPath: string): Promise<string> {
    const root = await realpath(rootPath);
    if (!(await stat(root)).isDirectory()) throw new Error('Project root is unavailable');
    return root;
  }

  async #file(rootPath: string, relativePath: string): Promise<{ root: string; target: string; relative: string }> {
    const root = await this.#root(rootPath);
    const relative = safeRelative(relativePath);
    const candidate = path.resolve(root, ...relative.split('/'));
    if (!inside(root, candidate)) throw new Error('Project path escaped its root');
    const target = await realpath(candidate);
    if (!inside(root, target) || !(await lstat(target)).isFile()) throw new Error('Project file is unavailable');
    return { root, target, relative };
  }

  async listFiles(rootPath: string): Promise<WorkspaceFileEntry[]> {
    const root = await this.#root(rootPath);
    const files: WorkspaceFileEntry[] = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(absolute, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const info = await stat(absolute);
        const image = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(entry.name).toLowerCase());
        if (info.size > (image ? MAX_IMAGE_PREVIEW_BYTES : MAX_FILE_BYTES)) continue;
        files.push({ relative_path: path.relative(root, absolute).replaceAll('\\', '/'), size: info.size });
      }
    };
    await walk(root, 0);
    return files;
  }

  async readFile(rootPath: string, relativePath: string): Promise<WorkspaceFileView> {
    const file = await this.#file(rootPath, relativePath);
    const bytes = await readFile(file.target);
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('File is too large');
    return {
      relative_path: file.relative,
      size: bytes.byteLength,
      content: decodeText(bytes),
      sha256: digest(bytes),
    };
  }

  async previewImage(rootPath: string, relativePath: string): Promise<WorkspaceImagePreview> {
    const file = await this.#file(rootPath, relativePath);
    const bytes = await readFile(file.target);
    if (bytes.byteLength > MAX_IMAGE_PREVIEW_BYTES) throw new Error('Image preview is too large');
    const mimeType = imageMime(file.relative, bytes);
    if (!mimeType) throw new Error('Unsupported image preview');
    return {
      kind: 'IMAGE',
      relative_path: file.relative,
      size: bytes.byteLength,
      mime_type: mimeType,
      data_url: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
    };
  }

  async applyFile(rootPath: string, request: ApplyWorkspaceFileRequest): Promise<WorkspaceFileView> {
    if (!/^[0-9a-f]{64}$/.test(request.expected_sha256)) throw new Error('Invalid expected file hash');
    const encoded = new TextEncoder().encode(request.content);
    if (encoded.byteLength > MAX_FILE_BYTES || request.content.includes('\0')) throw new Error('File content is too large or binary');
    const file = await this.#file(rootPath, request.relative_path);
    const current = await readFile(file.target);
    if (digest(current) !== request.expected_sha256) throw new Error('FILE_CHANGED_SINCE_REVIEW');
    const info = await stat(file.target);
    const temporary = path.join(path.dirname(file.target), `.fielora-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, encoded, { flag: 'wx' });
      await chmod(temporary, info.mode);
      await rename(temporary, file.target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return this.readFile(rootPath, request.relative_path);
  }

  async getEnvironment(rootPath: string): Promise<WorkspaceEnvironmentView> {
    const root = await this.#root(rootPath);
    const git = (args: string[]) => new Promise<string>((resolve, reject) => {
      execFile(process.platform === 'win32' ? 'git.exe' : 'git', args, { cwd: root, windowsHide: true, timeout: 5_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) reject(error); else resolve(stdout.trim());
      });
    });
    try {
      await git(['rev-parse', '--is-inside-work-tree']);
    } catch {
      return { is_git_repository: false, branch: null, upstream: null, changed_files: 0, ahead: 0, behind: 0 };
    }
    const [branch, status, upstream] = await Promise.all([
      git(['branch', '--show-current']).catch(() => ''),
      git(['status', '--porcelain=v1']).catch(() => ''),
      git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => ''),
    ]);
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = await git(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).catch(() => '0\t0');
      const [remoteCount, localCount] = counts.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0);
      behind = remoteCount ?? 0;
      ahead = localCount ?? 0;
    }
    return {
      is_git_repository: true,
      branch: branch || null,
      upstream: upstream || null,
      changed_files: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
      ahead,
      behind,
    };
  }

  async runTerminal(rootPath: string, fieldId: string, command: string, workingDirectory = rootPath): Promise<TerminalRunResult> {
    const root = await this.#root(rootPath);
    if (!command.trim() || command.length > 8_000 || command.includes('\0')) throw new Error('Invalid terminal command');
    const currentDirectory = await realpath(workingDirectory || root);
    if (!(await stat(currentDirectory)).isDirectory()) throw new Error('Terminal working directory is unavailable');
    const runId = `run_${randomUUID()}`;
    const directoryCommand = terminalDirectoryTarget(command);
    if (directoryCommand !== null) {
      const target = directoryCommand === '~'
        ? process.env.USERPROFILE ?? process.env.HOME ?? currentDirectory
        : path.resolve(currentDirectory, directoryCommand);
      const nextDirectory = await realpath(target);
      if (!(await stat(nextDirectory)).isDirectory()) throw new Error('Terminal directory is unavailable');
      return { run_id: runId, working_directory: nextDirectory };
    }
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
    const args = process.platform === 'win32'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
      : ['-c', command];
    const child = spawn(shell, args, {
      cwd: currentDirectory,
      env: process.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const run: TerminalRun = { child, fieldId, cancelled: false, emittedBytes: 0, truncated: false, tail: '', terminated: false };
    this.#runs.set(runId, run);
    this.#emit({ event: 'event.workspace.terminal', run_id: runId, field_id: fieldId, kind: 'STARTED', stream: null, text: null, exit_code: null });
    const output = (stream: 'STDOUT' | 'STDERR', bytes: Buffer): void => {
      // The display cap must never freeze operational feedback at an old build
      // message. Keep draining the child and retaining only its bounded tail.
      run.tail = (run.tail + bytes.toString('utf8')).slice(-8192);
      if (run.emittedBytes >= MAX_TERMINAL_OUTPUT_BYTES) {
        if (!run.truncated) {
          run.truncated = true;
          this.#emit({ event: 'event.workspace.terminal', run_id: runId, field_id: fieldId, kind: 'OUTPUT', stream: 'STDERR', text: '\n[Fielora truncated terminal output at 512 KiB]\n', exit_code: null });
        }
        return;
      }
      const remaining = MAX_TERMINAL_OUTPUT_BYTES - run.emittedBytes;
      const chunk = bytes.subarray(0, remaining);
      run.emittedBytes += chunk.byteLength;
      this.#emit({ event: 'event.workspace.terminal', run_id: runId, field_id: fieldId, kind: 'OUTPUT', stream, text: chunk.toString('utf8'), exit_code: null });
    };
    child.stdout.on('data', (bytes: Buffer) => output('STDOUT', bytes));
    child.stderr.on('data', (bytes: Buffer) => output('STDERR', bytes));
    child.on('error', (error) => {
      this.#agentServers.delete(runId);
      this.#terminalResults.set(runId, { status: 'FAILED', output: run.tail, exit_code: null });
      this.#runs.delete(runId);
      this.#emit({ event: 'event.workspace.terminal', run_id: runId, field_id: fieldId, kind: run.cancelled ? 'CANCELLED' : 'FAILED', stream: null, text: run.cancelled ? null : error.message, exit_code: null });
    });
    child.on('exit', () => { terminateRun(run); });
    child.on('close', (code) => {
      this.#agentServers.delete(runId);
      if (!this.#runs.delete(runId)) return;
      this.#terminalResults.set(runId, { status: run.cancelled ? 'STOPPED' : code === 0 ? 'COMPLETED' : 'FAILED', output: run.tail, exit_code: code });
      if (this.#terminalResults.size > 32) this.#terminalResults.delete(this.#terminalResults.keys().next().value!);
      this.#emit({
        event: 'event.workspace.terminal', run_id: runId, field_id: fieldId,
        kind: run.cancelled ? 'CANCELLED' : code === 0 ? 'COMPLETED' : 'FAILED',
        stream: null, text: null, exit_code: code,
      });
    });
    child.stdin.end();
    return { run_id: runId, working_directory: null };
  }

  cancelTerminal(runId: string): void {
    const run = this.#runs.get(runId);
    if (!run) throw new Error('Terminal run is not active');
    run.cancelled = true;
    terminateRun(run);
  }

  dispose(): void {
    for (const id of this.#agentServers) void this.stopAgentServer(id).catch(() => undefined);
    for (const run of this.#runs.values()) {
      if ([...this.#agentServers].some(id => this.#runs.get(id) === run)) continue;
      run.cancelled = true;
      terminateRun(run);
    }
    this.#runs.clear();
  }
}
