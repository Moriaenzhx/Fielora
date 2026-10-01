import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

export function packagedApplication(root) {
  const output = path.join(root, 'apps', 'desktop', 'out', `Fielora-${process.platform}-${process.arch}`);
  return process.platform === 'darwin' ? path.join(output, 'Fielora.app', 'Contents', 'MacOS', 'Fielora') : path.join(output, process.platform === 'win32' ? 'Fielora.exe' : 'Fielora');
}

export function launchDesktop(root, appPath, packaged, env, args = []) {
  const localData = env.LOCALAPPDATA;
  const isolatedEnv = { ...env, FIELORA_DATA_DIR: env.FIELORA_DATA_DIR ?? path.join(localData, 'Fielora'), FIELORA_E2E_USER_DATA: env.FIELORA_E2E_USER_DATA ?? path.join(localData, 'electron-profile') };
  const options = { cwd: root, env: isolatedEnv, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  if (packaged) return spawn(appPath, args, options);
  return process.platform === 'win32'
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm --filter @fielora/desktop start'], options)
    : spawn('pnpm', ['--filter', '@fielora/desktop', 'start'], options);
}

// Only call for a child launched by this harness in its own process group.
export function killTestProcess(pid) {
  if (process.platform === 'win32') return spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  try { process.kill(-Number(pid), 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export function deleteTestCredential(providerId) {
  const target = `Fielora/provider/${providerId}`;
  if (process.platform === 'win32') return spawnSync('cmdkey.exe', [`/delete:${target}`], { windowsHide: true, stdio: 'ignore' });
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/security', ['delete-generic-password', '-s', 'Fielora', '-a', target], { stdio: 'ignore' });
    if (result.error || (result.status !== 0 && result.status !== 44)) throw result.error ?? new Error(`Test credential cleanup failed: ${result.status}`);
  }
}

export function processExecutable(pid) {
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)}).Path`], { encoding: 'utf8' })
    : spawnSync('/bin/ps', ['-p', String(Number(pid)), '-o', 'comm='], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error('Process path unavailable');
  return result.stdout.trim();
}
