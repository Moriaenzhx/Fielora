import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { windowSurfaceColors } from './window-surface.ts';

test('native titlebar surface stays identical to the renderer Brand Chrome edge in both themes', () => {
  const tokens = readFileSync(path.join(import.meta.dirname, 'renderer', 'styles', 'tokens.css'), 'utf8').toLowerCase();
  for (const theme of ['LIGHT', 'DARK'] as const) {
    const surface = windowSurfaceColors(theme);
    assert.match(tokens, new RegExp(`--fl-brand-chrome-caption:\\s*${surface.background}`));
    assert.equal(surface.height, 44);
  }
  assert.notEqual(windowSurfaceColors('LIGHT').symbols, windowSurfaceColors('DARK').symbols);
  assert.equal(windowSurfaceColors('LIGHT', '#ddeeff').background, '#ddeeff');
});

test('native 44px caption plane stays continuous while workspace controls remain content-owned', () => {
  const rendererRoot = path.join(import.meta.dirname, 'renderer');
  const chrome = readFileSync(path.join(rendererRoot, 'DesktopChrome.tsx'), 'utf8');
  const styles = readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
  const materials = readFileSync(path.join(rendererRoot, 'styles', 'materials.css'), 'utf8');
  assert.match(chrome, /<header className="desktop-chrome"[\s\S]*?data-chrome-plane="window"[\s\S]*?<div className="chrome-drag-region" \/>[\s\S]*?<\/header>/);
  assert.match(chrome, /<div ref=\{workAreaRef\}[\s\S]*?className=\{`utility-control-dock/);
  assert.match(styles, /\.desktop-frame \{[^}]*grid-template-rows: 44px minmax\(0,1fr\)/);
  assert.match(styles, /\.desktop-chrome \{[^}]*padding: 0 146px 0 10px/);
  assert.match(styles, /\.utility-control-dock \{ right: 10px;[^}]*-webkit-app-region: no-drag/);
  assert.match(chrome, /data-chrome-plane="window" data-brand-chrome="top"/);
  assert.match(materials, /data-chrome-plane="window"\]\[data-brand-chrome="top"\][\s\S]*?background: transparent;[\s\S]*?backdrop-filter: none/);
  assert.match(materials, /data-brand-chrome="top"\]::after \{[\s\S]*?env\(titlebar-area-width,[\s\S]*?width: 96px;[\s\S]*?var\(--fl-brand-chrome-caption\)/);
});
