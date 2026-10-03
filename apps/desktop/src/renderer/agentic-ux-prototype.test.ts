import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AGENTIC_UX_PROTOTYPE_VIEWS, AGENTIC_UX_REVIEW_FILES, prototypeViewFromHash } from './agentic-ux-prototype-data.ts';

test('agentic UX prototype exposes every requested state and review', () => {
  assert.deepEqual(AGENTIC_UX_PROTOTYPE_VIEWS.map((view) => view.id), [
    'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'NO_CHANGE', 'APPROVAL', 'REVIEW',
  ]);
  assert.equal(prototypeViewFromHash('#agentic-ux-prototype'), 'RUNNING');
  assert.equal(prototypeViewFromHash('#agentic-ux-prototype/NO_CHANGE'), 'NO_CHANGE');
  assert.equal(prototypeViewFromHash('#agentic-ux-prototype/UNKNOWN'), 'RUNNING');
  assert.equal(prototypeViewFromHash('#unrelated'), null);
});

test('human review fixture carries semantic and raw representations', () => {
  assert.equal(AGENTIC_UX_REVIEW_FILES.length, 2);
  assert.equal(AGENTIC_UX_REVIEW_FILES[0].beforeValue, 'iContacter = 1');
  assert.equal(AGENTIC_UX_REVIEW_FILES[0].afterValue, 'iContacter = 0');
  for (const file of AGENTIC_UX_REVIEW_FILES) {
    assert.match(file.rawDiff, /^@@/);
    assert.match(file.rawDiff, /^-/m);
    assert.match(file.rawDiff, /^\+/m);
  }
});

test('prototype remains mock-only and its feature stylesheet uses semantic colors', () => {
  const rendererRoot = import.meta.dirname;
  const component = readFileSync(path.join(rendererRoot, 'AgenticUXPrototype.tsx'), 'utf8');
  const stylesheet = readFileSync(path.join(rendererRoot, 'styles/agentic-ux-prototype.css'), 'utf8');
  assert.doesNotMatch(component, /window\.fielora|@fielora\/contracts/);
  assert.doesNotMatch(stylesheet, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i);
  for (const label of ['查看步骤', '可视化', '原始 Diff', '允许修改', '恢复本次修改']) assert.match(component, new RegExp(label));
});

test('agent conversation typography stays on the shared readable scale', () => {
  const rendererRoot = import.meta.dirname;
  const tokens = readFileSync(path.join(rendererRoot, 'styles/tokens.css'), 'utf8');
  const productionStyles = readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
  const typographyStyles = readFileSync(path.join(rendererRoot, 'styles/typography.css'), 'utf8');
  const prototypeStyles = readFileSync(path.join(rendererRoot, 'styles/agentic-ux-prototype.css'), 'utf8');
  const productionComponent = [
    readFileSync(path.join(rendererRoot, 'ProjectWorkspace.tsx'), 'utf8'),
    readFileSync(path.join(rendererRoot, 'AgentTurn.tsx'), 'utf8'),
  ].join('\n');
  const prototypeComponent = readFileSync(path.join(rendererRoot, 'AgenticUXPrototype.tsx'), 'utf8');

  for (const declaration of [
    '--fl-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;',
    '--fl-font-mono: ui-monospace, "SFMono-Regular", Menlo, "Cascadia Code", Consolas, monospace;',
    '--fl-font-agent-sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;',
    '--fl-font-agent-mono: ui-monospace, "SFMono-Regular", Menlo, "Cascadia Code", Consolas, monospace;',
    '--fl-font-size-agent-meta: calc(12.5px * var(--fl-ui-font-scale));',
    '--fl-font-size-agent-execution: calc(14px * var(--fl-ui-font-scale));',
    '--fl-font-size-agent-body: calc(15px * var(--fl-ui-font-scale));',
    '--fl-font-size-agent-lead: calc(16px * var(--fl-ui-font-scale));',
    '--fl-font-size-agent-title: calc(17px * var(--fl-ui-font-scale));',
    '--fl-font-size-agent-button: calc(13.5px * var(--fl-ui-font-scale));',
    '--fl-font-weight-regular: 400;',
    '--fl-font-weight-medium: 500;',
    '--fl-font-weight-semibold: 600;',
    '--fl-line-height-agent-body: 1.7;',
  ]) assert.ok(tokens.includes(declaration), `missing typography token: ${declaration}`);

  assert.match(productionComponent, /agent-terminal-result/);
  assert.doesNotMatch(prototypeComponent, /prototype-speaker[^>]*>\s*Fielora\s*</);
  assert.match(productionStyles, /\.markdown-body\s*\{[^}]*font-size:\s*var\(--fl-font-size-agent-body\)[^}]*font-weight:\s*var\(--fl-font-weight-regular\)[^}]*line-height:\s*var\(--fl-line-height-agent-body\)/s);
  assert.match(productionStyles, /\.agent-terminal-result h2\s*\{[^}]*font-size:\s*var\(--fl-font-size-agent-title\)[^}]*font-weight:\s*var\(--fl-font-weight-result-title\)/s);
  assert.match(productionStyles, /\.message-list button, \.conversation-composer button\s*\{[^}]*font-size:\s*var\(--fl-font-size-agent-button\)[^}]*font-weight:\s*var\(--fl-font-weight-medium\)/s);
  assert.match(productionStyles, /\.human-review-raw\s*\{[^}]*font-family:\s*var\(--fl-font-agent-mono\)/s);
  assert.match(prototypeStyles, /\.prototype-assistant-turn\s*\{[^}]*font-size:\s*var\(--fl-font-size-agent-body\)[^}]*font-weight:\s*var\(--fl-font-weight-regular\)[^}]*line-height:\s*var\(--fl-line-height-agent-body\)/s);
  assert.match(prototypeStyles, /\.prototype-terminal-result h2\s*\{[^}]*font-size:\s*var\(--fl-font-size-agent-title\)[^}]*font-weight:\s*var\(--fl-font-weight-semibold\)/s);

  assert.match(typographyStyles, /:where\(\.conversation-column, \.settings-content, \.right-workspace-dock\) \{[^}]*font-family: var\(--fl-font-sans\)/s);
  assert.doesNotMatch(typographyStyles, /font-weight:\s*(?:700|800)\b/);
  assert.doesNotMatch(typographyStyles, /font-size:\s*\d+(?:\.\d+)?px/);
  assert.doesNotMatch([productionComponent, prototypeComponent].join('\n'), /fontFamily\s*:/);
});
