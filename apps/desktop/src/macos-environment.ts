import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';

/** Finder does not inherit a terminal's PATH. Read only the user's shell PATH;
 * keep the launch environment first (including an explicit `nvm use`). */
export async function prepareMacEnvironment(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const shell = process.env.SHELL ?? userInfo().shell ?? '/bin/zsh';
  if (shell !== '/bin/zsh' && shell !== '/bin/bash') return;
  const marker = '__FIELORA_LOGIN_PATH__';
  const shellPath = await new Promise<string | null>(resolve => {
    execFile(shell, ['-ilc', `printf '\\n${marker}%s\\n' "$PATH"`], {
      timeout: 5000, maxBuffer: 64 * 1024, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) { resolve(null); return; }
      resolve(stdout.split(/\r?\n/).find(line => line.startsWith(marker))?.slice(marker.length) ?? null);
    });
  });
  if (shellPath) process.env.PATH = [...new Set([...(process.env.PATH ?? '').split(':'), ...shellPath.split(':')].filter(value => value.startsWith('/')))].join(':');
}
