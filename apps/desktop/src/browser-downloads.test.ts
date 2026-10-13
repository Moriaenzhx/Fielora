import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { DownloadItem, Event, WebContents } from 'electron';
import { BrowserDownloads, MAX_BROWSER_DOWNLOAD_BYTES } from './browser-downloads.ts';

class Item extends EventEmitter {
  saved = ''; cancelled = false; total = 0; received = 0;
  getFilename() { return '../../outside.json'; }
  getURL() { return 'https://example.com/export?secret=excluded'; }
  getMimeType() { return 'application/json'; }
  getTotalBytes() { return this.total; }
  getReceivedBytes() { return this.received; }
  setSavePath(value: string) { this.saved = value; }
  cancel() { this.cancelled = true; this.emit('done', {}, 'cancelled'); }
}
const signal = () => new AbortController().signal;
const contents = (id: number) => ({ id } as WebContents);
function start(manager: BrowserDownloads, item: Item, id = 1) {
  let prevented = false;
  manager.handle({ preventDefault: () => { prevented = true; } } as Event, item as unknown as DownloadItem, contents(id));
  return prevented;
}

test('capture stores exact bytes under a generated private target, never the suggested path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'download-unit-'));
  const manager = new BrowserDownloads(id => id === 1), item = new Item();
  const bytes = Buffer.from('{"module":"R","count":24}');
  try {
    const result = await manager.capture(1, root, signal(), async () => {
      assert.equal(start(manager, item), false);
      assert.equal(path.dirname(path.dirname(item.saved)), root);
      assert.equal(path.basename(item.saved), 'download');
      await writeFile(item.saved, bytes); item.emit('done', {}, 'completed');
      return { success: true, input_state: 'DISPATCHED' };
    });
    const d = result.download as Record<string, unknown>;
    assert.equal(result.success, true); assert.deepEqual(await readFile(String(d.artifact_path)), bytes);
    assert.equal(d.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(d.contents_verified, false); assert.equal(d.source_url, 'https://example.com/export');
    assert.equal((await stat(item.saved)).mode & 0o777, 0o600);
    assert.equal(item.listenerCount('done') + item.listenerCount('updated'), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unarmed and late Agent downloads are cancelled; ordinary Browse is untouched', () => {
  const manager = new BrowserDownloads(id => id === 1);
  assert.equal(start(manager, new Item()), true);
  assert.equal(manager.notice(1)?.error_code, 'BROWSER_DOWNLOAD_NOT_ARMED');
  const ordinary = new Item();
  assert.equal(start(manager, ordinary, 2), false); assert.equal(ordinary.saved, '');
});

test('timeout, abort, oversized, interrupted and multiple downloads keep no partial files', async () => {
  for (const mode of ['timeout', 'abort', 'header', 'received', 'interrupted', 'multiple', 'native-error']) {
    const root = await mkdtemp(path.join(tmpdir(), 'download-unit-'));
    const manager = new BrowserDownloads(id => id === 1), item = new Item(), controller = new AbortController();
    try {
      const result = await manager.capture(1, root, controller.signal, async () => {
        if (mode === 'header') item.total = MAX_BROWSER_DOWNLOAD_BYTES + 1;
        if (mode === 'native-error') item.setSavePath = () => { throw new Error('native failure'); };
        if (mode !== 'timeout') start(manager, item);
        if (item.saved) await writeFile(item.saved, 'partial');
        if (mode === 'abort') controller.abort();
        if (mode === 'received') { item.received = MAX_BROWSER_DOWNLOAD_BYTES + 1; item.emit('updated', {}, 'progressing'); }
        if (mode === 'interrupted') item.emit('updated', {}, 'interrupted');
        if (mode === 'multiple') assert.equal(start(manager, new Item()), true);
        return { success: true, input_state: 'DISPATCHED' };
      }, 30);
      assert.equal(result.success, false, mode); assert.equal(result.input_state, 'DISPATCHED');
      assert.deepEqual(await readdir(root), [], mode);
      assert.equal(start(manager, new Item()), true, 'Late download must not open a save dialog');
      assert.equal(item.listenerCount('done') + item.listenerCount('updated'), 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('a symlink download root never dispatches input', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'download-unit-'));
  try {
    await symlink(parent, path.join(parent, 'link'));
    let clicked = false;
    await assert.rejects(new BrowserDownloads(() => true).capture(1, path.join(parent, 'link'), signal(), async () => {
      clicked = true; return { success: true };
    }), /UNAVAILABLE/);
    assert.equal(clicked, false);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
