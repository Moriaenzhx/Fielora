import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceAttachmentView } from '../workspace-types';
import { attachmentsForCapabilities, messageAttachments, persistMessageAttachments } from './attachment-pipeline.ts';
import type { ModelCapabilities } from './model-capabilities.ts';

const image: WorkspaceAttachmentView = {
  id: 'image', name: 'paste.png', size: 100, kind: 'IMAGE', mime_type: 'image/png', status: 'READY', content: null,
  data_url: 'data:image/png;base64,AA==', sha256: 'hash', reason: null, width: 20, height: 10,
  source: 'clipboard', content_ref: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png',
};
const capableSet = { textInput: true, imageInput: true, videoInput: false, fileInput: true, toolCalling: true };
const base: ModelCapabilities = {
  imageSupport: 'UNSUPPORTED', toolSupport: 'SUPPORTED',
  ...capableSet, imageInput: false, model: { ...capableSet, imageInput: false }, provider: capableSet,
  transport: capableSet, imageInputReason: '当前模型不支持图片输入',
};

test('clipboard image attachment is rejected without mutating its preview payload when capability is absent', () => {
  const [blocked] = attachmentsForCapabilities([image], base);
  assert.equal(blocked?.status, 'UNSUPPORTED');
  assert.equal(blocked?.data_url, image.data_url);
  assert.match(blocked?.reason ?? '', /不支持图片输入/);
});

test('the same attachment pipeline keeps images ready for an image-capable model', () => {
  const [ready] = attachmentsForCapabilities([image], { ...base, imageInput: true, imageInputReason: null });
  assert.equal(ready?.status, 'READY');
});

test('conversation metadata persistence keeps a safe content reference without duplicating the image data URL', () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } } });
  persistMessageAttachments('message-1', [image]);
  const restored = messageAttachments('message-1');
  assert.equal(restored[0]?.content_ref, image.content_ref);
  assert.equal(restored[0]?.data_url, null);
  assert.doesNotMatch([...values.values()][0] ?? '', /data:image/);
  Reflect.deleteProperty(globalThis, 'window');
});
