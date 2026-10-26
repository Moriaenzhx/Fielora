import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { Debugger } from 'electron';
import { browserInputLifecycle, BrowserOperationDeadline } from './browser-input-lifecycle.ts';
import { dispatchBrowserClick } from './browser-agent-input.ts';

test('cancellation releases the caller, retains late mouseUp acknowledgement, and never replays input', async () => {
  const emitter = new EventEmitter(); let attached = false;
  const debug = Object.assign(emitter, { isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; }, sendCommand: async () => ({}) }) as unknown as Debugger;
  const controller = new AbortController(); const execution = { inputState: 'NOT_DISPATCHED' };
  const sent: string[] = []; const progress: unknown[] = []; const settled: unknown[] = [];
  let acknowledge!: () => void;
  let up!: () => void; const released = new Promise<void>(resolve => { up = resolve; });
  const call = browserInputLifecycle(debug, controller.signal, () => dispatchBrowserClick(execution, async type => {
    sent.push(type);
    if (type === 'mouseUp') { up(); await new Promise<void>(resolve => { acknowledge = resolve; }); }
  }, async () => ({ success: false })), value => progress.push(value), late => settled.push({ late, state: execution.inputState }));
  await released;
  emitter.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'private', defaultPrompt: 'secret' });
  controller.abort(); await assert.rejects(call, /BROWSER_CANCELLED/);
  assert.equal(execution.inputState, 'DISPATCHING'); assert.equal(attached, true);
  assert.deepEqual(settled, []);
  emitter.emit('message', {}, 'Page.javascriptDialogClosed', { result: false, userInput: 'secret' });
  acknowledge(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, ['mouseMove', 'mouseDown', 'mouseUp']);
  assert.deepEqual(settled, [{ late: true, state: 'DISPATCHED' }]);
  assert.deepEqual(progress, [{ state: 'OPEN', dialog_type: 'confirm' }, { state: 'CLOSED', accepted: false }]);
  assert.equal(attached, false); assert.equal(emitter.listenerCount('message'), 0);
});

test('dialog waiting suspends only the ordinary deadline; total wait and cancellation stay bounded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let expired = 0; const clock = new BrowserOperationDeadline(() => expired++, 25, 600);
  t.mock.timers.tick(20); clock.dialog('OPEN'); t.mock.timers.tick(100);
  assert.equal(expired, 0);
  clock.dialog('CLOSED'); t.mock.timers.tick(20); clock.dialog('CLOSED'); t.mock.timers.tick(6);
  assert.equal(expired, 1, 'duplicate close cannot extend active execution');
  clock.clear(); clock.dialog('CLOSED'); t.mock.timers.tick(1000); assert.equal(expired, 1);
  const total = new BrowserOperationDeadline(() => expired++, 25, 600);
  total.dialog('OPEN'); t.mock.timers.tick(600); assert.equal(expired, 2); total.clear();
});
