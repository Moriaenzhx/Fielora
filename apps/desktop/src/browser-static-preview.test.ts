import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserStaticPreview } from './browser-static-preview.ts';

test('actual bounded static responses produce input facts; unknown requests and changed bytes cannot', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fielora-static-'));
  const preview = new BrowserStaticPreview();
  try {
    for (const name of ['index.html', 'app.js', 'style.css', 'data.md', 'README.md']) await writeFile(path.join(root, name), name);
    await preview.start(root, '.');
    const requests = [preview.url, ...['app.js', 'style.css', 'data.md'].map(p => preview.url + p)];
    for (const url of requests) {
      const response = await fetch(url); assert.equal(response.status, 200);
      assert.equal(response.headers.get('connection-allowlist'), '(response-origin)');
      await response.text();
    }
    const scope = preview.scope(preview.url, requests, false)!;
    assert.deepEqual((scope.files as { path: string }[]).map(f => f.path), ['app.js', 'data.md', 'index.html', 'style.css']);
    await writeFile(path.join(root, 'README.md'), 'unrelated update');
    assert.deepEqual(preview.scope(preview.url, requests, false), scope);
    assert.equal(preview.scope(preview.url, requests, true), undefined, 'Unattributed worker/external request');
    assert.equal(preview.scope(preview.url, [...requests, preview.url + 'unseen.js'], false), undefined);
    await writeFile(path.join(root, 'style.css'), 'changed'); await fetch(preview.url + 'style.css');
    assert.equal(preview.scope(preview.url, requests, false), undefined, 'Mixed versions in one server lifetime stay conservative');
  } finally { preview.stop(); await rm(root, { recursive: true, force: true }); }
});

test('static preview rejects escape, symlinks, hidden files, oversized files and non-GET', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fielora-static-boundary-'));
  const preview = new BrowserStaticPreview();
  try {
    await mkdir(path.join(root, 'site')); await writeFile(path.join(root, 'private'), 'private');
    await writeFile(path.join(root, 'site/index.html'), 'hello');
    await writeFile(path.join(root, 'site/.env'), 'hidden');
    await writeFile(path.join(root, 'site/big'), Buffer.alloc(2 * 1024 * 1024 + 1));
    await symlink(path.join(root, 'private'), path.join(root, 'site/link'));
    await assert.rejects(preview.start(root, '../'), /BROWSER_STATIC_DIRECTORY/);
    await preview.start(root, 'site');
    assert.equal((await fetch(preview.url)).status, 200);
    for (const name of ['.env', 'link', 'big', '%2e%2e%2fprivate']) assert.equal((await fetch(preview.url + name)).status, 404);
    assert.equal((await fetch(preview.url, { method: 'POST' })).status, 404);
  } finally { preview.stop(); await rm(root, { recursive: true, force: true }); }
});

test('root-relative subresources map into the owned mount without exposing a public root alias', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fielora-static-root-assets-'));
  const preview = new BrowserStaticPreview();
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
    await writeFile(path.join(root, 'assets/app.js'), 'import "./chunk.js";');
    await writeFile(path.join(root, 'assets/chunk.js'), 'export const ready = true;');
    await preview.start(root, '.');
    const url = new URL('/assets/app.js?v=1', preview.url).href;
    assert.equal((await fetch(url)).status, 404, 'Unattributed/direct root access stays denied');
    const mapped = preview.redirectSubresource(url, 'GET', 'script', preview.url)!;
    assert.equal(mapped, preview.url + 'assets/app.js?v=1');
    assert.equal((await fetch(mapped)).status, 200);
    const chunk = new URL('./chunk.js', mapped).href;
    assert.equal((await fetch(chunk)).status, 200);
    await fetch(preview.url);
    assert.deepEqual((preview.scope(preview.url, [preview.url, mapped, chunk], false)!.files as { path: string }[])
      .map(f => f.path), ['assets/app.js', 'assets/chunk.js', 'index.html']);
    for (const [target, method, type] of [
      [mapped, 'GET', 'script'], [url, 'POST', 'xhr'], [url, 'GET', 'mainFrame'],
      [url, 'GET', 'subFrame'], ['http://127.0.0.1:1/assets/app.js', 'GET', 'script'],
      [new URL('/favicon.ico', preview.url).href, 'GET', 'image'],
      [url.replace('127.0.0.1', 'user:secret@127.0.0.1'), 'GET', 'script'],
    ]) assert.equal(preview.redirectSubresource(target!, method!, type!, preview.url), undefined);
    assert.equal(preview.redirectSubresource(url, 'GET', 'script', 'https://example.com/'), undefined);
    assert.equal(preview.redirectSubresource(url, 'GET', 'script', new URL('/foreign/', preview.url).href), undefined);
    const escaped = preview.redirectSubresource(new URL('/%2e%2e%2fprivate', preview.url).href, 'GET', 'xhr', preview.url)!;
    assert.equal((await fetch(escaped)).status, 404, 'Mapping cannot bypass file containment');
  } finally { preview.stop(); await rm(root, { recursive: true, force: true }); }
});
