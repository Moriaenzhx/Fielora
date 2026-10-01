import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const lane = process.argv[2] ?? 'PreMerge';
if (!['Docs', 'Ui', 'Core', 'Cross', 'PreMerge'].includes(lane)) throw new Error(`Unknown development lane: ${lane}`);
process.chdir(path.resolve(import.meta.dirname, '..'));
function gate(name, command, args) {
  const started = Date.now();
  console.log(`GATE_START ${name}`);
  const result = command === 'pnpm' && process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], { stdio: 'inherit' })
    : spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`GATE_PASS ${name} duration_ms=${Date.now() - started}`);
}
const pnpm = name => gate(name, 'pnpm', [name]);
gate('node-version', process.execPath, ['scripts/check-node-version.cjs']);
console.log(`DEVELOPMENT_GATE_START lane=${lane}`);
if (['Docs', 'Cross', 'PreMerge'].includes(lane)) pnpm('audit:context');
if (['Cross', 'PreMerge'].includes(lane)) pnpm('contracts:verify-current');
if (['Ui', 'Cross', 'PreMerge'].includes(lane)) for (const name of ['typecheck', 'lint', 'test:ts']) pnpm(name);
if (['Core', 'Cross', 'PreMerge'].includes(lane)) {
  gate('rust-fmt', 'cargo', ['fmt', '--all', '--', '--check']);
  gate('rust-unit', 'cargo', ['test', '--workspace', '--locked', '--offline']);
  gate('rust-clippy', 'cargo', ['clippy', '--workspace', '--all-targets', '--locked', '--offline', '--', '-D', 'warnings']);
}
if (['Cross', 'PreMerge'].includes(lane)) pnpm('test:integration');
if (lane === 'PreMerge') {
  // Keep failure evidence outside the repository without deleting diagnostic files.
  process.env.FIELORA_E2E_EVIDENCE_DIR = mkdtempSync(path.join(tmpdir(), 'fielora-premerge-evidence-'));
  process.env.FIELORA_AGENT_TURN_EVIDENCE_DIR = path.join(process.env.FIELORA_E2E_EVIDENCE_DIR, 'agent-turn');
  process.env.FIELORA_E2E_TARGET_TIMEOUT_MS = '120000';
  console.log(`E2E_EVIDENCE=${process.env.FIELORA_E2E_EVIDENCE_DIR}`);
  for (const name of ['test:e2e', 'test:e2e:browse', 'test:e2e:desktop-foundation']) pnpm(name);
}
console.log(`DEVELOPMENT_GATE=PASS lane=${lane}`);
