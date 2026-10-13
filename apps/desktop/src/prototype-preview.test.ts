import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { allowPrototypeFrameNavigation, isPrototypeUrl, MAX_PROTOTYPE_BYTES, MAX_PROTOTYPE_PREVIEWS, PrototypePreviewRegistry, sameFrameIdentity } from './prototype-preview.ts';
import { validatePrototypePreview, validateReleasePrototype } from './validation.ts';
import { WorkspaceRuntime } from './workspace-runtime.ts';

const fieldId = '018f84cb-7c4e-7a12-a6d4-3c441f80a227';
const origin = 'fielora://app';
function file(content = '<!doctype html><button onclick="this.textContent=\'clicked\'">Try</button>') {
  return { relative_path: 'prototype.html', content, size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
}

test('prototype snapshots preserve exact bytes until explicit release', async () => {
  const registry = new PrototypePreviewRegistry();
  const source = file();
  const preview = registry.create(source, source.sha256);
  const original = source.content;
  source.content = 'mutated after registration';
  assert.ok(isPrototypeUrl(preview.url));
  assert.equal(await registry.response(preview.url, 'GET', origin).text(), original);
  assert.equal(registry.response(`${preview.url}?extra=1`, 'GET', origin).status, 404);
  assert.equal(registry.response(`${preview.url}#extra`, 'GET', origin).status, 404);
  assert.equal(registry.response(preview.url, 'POST', origin).status, 404);
  registry.release(preview.url);
  registry.release(preview.url);
  assert.equal(registry.response(preview.url, 'GET', origin).status, 404);
});

test('prototype content and origin policies do not inherit trusted app authority', () => {
  const registry = new PrototypePreviewRegistry();
  const source = file();
  const preview = registry.create(source, source.sha256);
  const headers = registry.response(preview.url, 'GET', origin).headers;
  const csp = headers.get('content-security-policy') ?? '';
  for (const directive of ["sandbox allow-scripts", "default-src 'none'", "connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", 'frame-ancestors fielora://app']) assert.ok(csp.split('; ').includes(directive), directive);
  assert.doesNotMatch(csp, /allow-same-origin|allow-popups|allow-downloads|unsafe-eval|https:/);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('connection-allowlist'), '()');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('access-control-allow-origin'), null);
  assert.equal(allowPrototypeFrameNavigation(preview.url, true, false, registry), true);
  assert.equal(allowPrototypeFrameNavigation(preview.url, true, true, registry), false);
  assert.equal(allowPrototypeFrameNavigation(preview.url, false, false, registry), false);
  for (const target of ['https://example.com', 'file:///tmp/secret', 'fielora://app/index.html', 'data:text/html,bad', 'javascript:alert(1)', 'about:blank']) assert.equal(allowPrototypeFrameNavigation(target, true, false, registry), false);
  registry.clear();
  assert.equal(allowPrototypeFrameNavigation(preview.url, true, false, registry), false);
});

test('native frame identity does not depend on Electron JS wrapper identity', () => {
  assert.equal(sameFrameIdentity({ processId: 3, routingId: 12 }, { processId: 3, routingId: 12 }), true);
  assert.equal(sameFrameIdentity({ processId: 4, routingId: 12 }, { processId: 3, routingId: 12 }), false);
  assert.equal(sameFrameIdentity({ processId: 3, routingId: 13 }, { processId: 3, routingId: 12 }), false);
  assert.equal(sameFrameIdentity(null, { processId: 3, routingId: 12 }), false);
  assert.equal(sameFrameIdentity(undefined, undefined), false);
});

test('prototype admission rejects wrong versions, unsupported bytes and exhausted registry', () => {
  const registry = new PrototypePreviewRegistry();
  const source = file();
  assert.throws(() => registry.create(source, '0'.repeat(64)), /PROTOTYPE_CHANGED/);
  assert.throws(() => registry.create({ ...source, relative_path: 'prototype.svg' }, source.sha256), /PROTOTYPE_UNAVAILABLE/);
  assert.throws(() => registry.create({ ...source, size: 10 }, source.sha256), /PROTOTYPE_CHANGED/);
  const oversized = file('x'.repeat(MAX_PROTOTYPE_BYTES + 1));
  assert.throws(() => registry.create(oversized, oversized.sha256), /PROTOTYPE_TOO_LARGE/);
  const binary = file('bad\0html');
  assert.throws(() => registry.create(binary, binary.sha256));
  for (let i = 0; i < MAX_PROTOTYPE_PREVIEWS; i++) registry.create(source, source.sha256);
  assert.throws(() => registry.create(source, source.sha256), /PROTOTYPE_TOO_MANY/);
  registry.clear();
  assert.ok(registry.create(source, source.sha256).url);
});

test('prototype bridge rejects paths, URL aliases and arbitrary extra fields', () => {
  const request = { field_id: fieldId, relative_path: 'demos/test.HTML', expected_sha256: 'a'.repeat(64) };
  assert.deepEqual(validatePrototypePreview(request), request);
  for (const relative_path of ['../secret.html', '/tmp/secret.html', 'C:\\secret.html', 'dir\\..\\secret.html', 'demo.svg', 'demo.html?query', '']) assert.throws(() => validatePrototypePreview({ ...request, relative_path }));
  assert.throws(() => validatePrototypePreview({ ...request, expected_sha256: null }));
  assert.throws(() => validatePrototypePreview({ ...request, html: '<script>bad</script>' }));
  const url = `fielora-prototype://${'a'.repeat(32)}/index.html`;
  assert.deepEqual(validateReleasePrototype({ url }), { url });
  for (const invalid of [`${url}?query`, `${url}#hash`, url.replace('index.html', '../index.html'), 'https://example.com', 'fielora://app/index.html']) assert.throws(() => validateReleasePrototype({ url: invalid }));
  assert.throws(() => validateReleasePrototype({ url, path: 'ignored' }));
});

test('prototype acquisition uses contained project files and preserves BOM hashes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fielora-prototype-'));
  const root = path.join(directory, 'project');
  const runtime = new WorkspaceRuntime(() => undefined);
  try {
    await mkdir(root);
    const source = '\uFEFF<!doctype html><p>prototype</p>';
    await writeFile(path.join(root, 'bom.html'), source);
    await writeFile(path.join(directory, 'secret.html'), 'not in project');
    const read = await runtime.readFile(root, 'bom.html');
    const registry = new PrototypePreviewRegistry();
    const preview = registry.create(read, read.sha256);
    const bytes = new Uint8Array(await registry.response(preview.url, 'GET', origin).arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), read.sha256);
    await assert.rejects(runtime.readFile(root, '../secret.html'));
    if (process.platform !== 'win32') {
      await symlink(path.join(directory, 'secret.html'), path.join(root, 'escape.html'));
      await assert.rejects(runtime.readFile(root, 'escape.html'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
