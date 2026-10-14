import assert from 'node:assert/strict';
import test from 'node:test';
import { validateComputerPreview, localPreviewPng, computerPreviewMessage } from './computer-preview-types.ts';

test('preview IPC accepts only receipt identities and an explicit capture flag', () => {
  const request = { run_id: '018f84cb-7c4e-7a12-a6d4-3c441f80a227', tool_call_id: '018f84cb-7c4e-7a12-a6d4-3c441f80a228' };
  assert.deepEqual(validateComputerPreview(request), { ...request, capture: false });
  assert.deepEqual(validateComputerPreview({ ...request, capture: true }), { ...request, capture: true });
  for (const bad of [null, [], { ...request, capture: 'true' }, { ...request, run_id: '' }, { ...request, app_id: 'com.apple.Safari' }, { ...request, pid: 1 }, { ...request, window_id: 2 }, { ...request, target: {} }]) {
    assert.throws(() => validateComputerPreview(bad));
  }
});

test('preview images are bounded local PNGs, never URLs or SVG markup', () => {
  assert.equal(localPreviewPng('data:image/png;base64,YQ=='), 'data:image/png;base64,YQ==');
  for (const image of ['https://example.com/icon.png', 'file:///tmp/window.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,<script>', 'data:image/png;base64,YQ==\n', null]) {
    assert.equal(localPreviewPng(image), undefined);
  }
  assert.equal(localPreviewPng('data:image/png;base64,YQ==', 10), undefined);
  assert.match(computerPreviewMessage('COMPUTER_SCREEN_RECORDING_REQUIRED'), /系统设置/);
  assert.match(computerPreviewMessage('COMPUTER_PREVIEW_RUN_INACTIVE'), /停止/);
  assert.equal(computerPreviewMessage('sensitive unknown error'), computerPreviewMessage());
});
