import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { app } from 'electron';
import type { CoreHealthState, HealthDTO, HelloResponse } from '@fielora/contracts';
import { FipcClient } from './fipc';

const HELLO_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;
const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS = 3;

export class CoreProcessSupervisor extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private client?: FipcClient;
  private stopping = false;
  private restartTimes: number[] = [];
  private state: CoreHealthState = 'STARTING';
  private health?: HealthDTO;

  constructor(private readonly environment: () => NodeJS.ProcessEnv = () => process.env) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.stopping = false;
    this.setState('STARTING');
    const corePath = this.resolveCorePath();
    const args = app.isPackaged ? [] : ['--development'];
    const child = spawn(corePath, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.environment(),
    });
    this.child = child;
    child.stderr.on('data', (chunk) => console.warn(`[core] ${String(chunk).trimEnd()}`));
    const client = new FipcClient(child);
    this.client = client;
    client.on('notification', (message) => this.emit('notification', message));
    client.on('request-completed', (metric) => {
      this.emit('fipc-metric', metric);
      if (process.env.FIELORA_AGENT_PERFORMANCE_TRACE === '1') {
        console.info(`[agent-performance] ${JSON.stringify({ layer: 'FIPC', ...metric })}`);
      }
    });
    child.once('exit', (code, signal) => this.onExit(child, code, signal));

    try {
      const hello = await this.withTimeout(
        client.request('system.hello', {}, HELLO_TIMEOUT_MS) as Promise<HelloResponse>,
        HELLO_TIMEOUT_MS,
      );
      if (hello.protocol.major !== 1) throw new Error('FIPC protocol major mismatch');
      this.health = await client.request('system.health') as HealthDTO;
      this.setState('READY');
    } catch (error) {
      if (this.child === child) child.kill();
      this.setState('UNAVAILABLE', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.state !== 'READY' || !this.client) {
      throw new Error('Fielora Core is unavailable');
    }
    return this.client.request(method, params);
  }

  getHealth(): HealthDTO {
    return this.health ?? {
      state: this.state,
      core_version: '0.1.0',
      protocol: { major: 1, minor: 0 },
      schema_version: 0,
      pid: this.child?.pid ?? 0,
      db_path: '',
    };
  }

  async retry(): Promise<void> {
    if (this.child) this.child.kill();
    this.child = undefined;
    this.client = undefined;
    await this.start();
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.setState('SHUTTING_DOWN');
    const child = this.child;
    if (!child) return;
    try {
      await this.client?.request('system.shutdown', {}, SHUTDOWN_TIMEOUT_MS);
    } catch {
      // Parent-pipe EOF remains the authoritative fallback.
    }
    this.client?.closeParentPipe();
    await this.waitForExit(child, SHUTDOWN_TIMEOUT_MS);
    if (child.exitCode === null) child.kill();
    this.child = undefined;
    this.client = undefined;
  }

  async runMaintenance(arguments_: string[]): Promise<void> {
    const executable = this.resolveCorePath();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, arguments_, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.environment(),
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0 && stdout.trim() === 'PASS') resolve();
        else reject(new Error(stderr.trim() || `Core maintenance failed (${code ?? 'unknown'})`));
      });
    });
  }

  killForTest(): void {
    if (process.env.FIELORA_E2E !== '1') throw new Error('Test controls are disabled');
    this.child?.kill();
  }

  private resolveCorePath(): string {
    const executable = process.platform === 'win32' ? 'fielora-core.exe' : 'fielora-core';
    if (app.isPackaged) return path.join(process.resourcesPath, executable);
    const override = process.env.FIELORA_CORE_PATH;
    if (override) return path.resolve(override);
    return path.resolve(app.getAppPath(), '..', '..', 'target', 'debug', executable);
  }

  private onExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.client = undefined;
    if (this.stopping) return;
    this.setState('UNAVAILABLE', new Error(`Core exited (${code ?? signal ?? 'unknown'})`));
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((time) => now - time < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= MAX_RESTARTS) {
      this.setState('DEGRADED', new Error('Core restart limit reached'));
      return;
    }
    this.restartTimes.push(now);
    setTimeout(() => void this.start().catch(() => undefined), 250 * this.restartTimes.length);
  }

  private setState(state: CoreHealthState, error?: Error): void {
    this.state = state;
    if (this.health) this.health = { ...this.health, state };
    this.emit('health', { state, error: error?.message });
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Core startup timed out')), timeoutMs);
      promise.then(
        (value) => { clearTimeout(timeout); resolve(value); },
        (error) => { clearTimeout(timeout); reject(error); },
      );
    });
  }

  private async waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
    if (child.exitCode !== null) return;
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}
