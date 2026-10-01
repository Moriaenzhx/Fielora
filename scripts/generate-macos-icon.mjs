import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
if (process.platform !== 'darwin') throw new Error('macOS icon generation requires sips and iconutil');
const assets = path.resolve(import.meta.dirname, '../apps/desktop/assets');
const temporary = mkdtempSync(path.join(tmpdir(), 'fielora-icon-'));
const iconset = path.join(temporary, 'Fielora.iconset');
mkdirSync(iconset);
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), path.join(assets, 'fielora-brand-mark.png'), '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'fielora.icns')]);
  console.log('Generated fielora.icns from the canonical brand PNG');
} finally { rmSync(temporary, { recursive: true, force: true }); }
