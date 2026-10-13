import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPageErrors } from './browser-page-errors.ts';

test('current document errors are bounded, deduplicated and keep source location without URL secrets', () => {
  const errors = new BrowserPageErrors();
  const entry = { level: 'error', message: 'Uncaught ReferenceError: cIdx is not defined', sourceId: 'https://u:password@example.com/index.html?token=secret#private', lineNumber: 42 };
  errors.observe({ ...entry, level: 'info' }); assert.deepEqual(errors.snapshot(), []);
  errors.observe(entry); errors.observe(entry);
  assert.deepEqual(errors.snapshot(), [{ message: entry.message, source: 'https://example.com/index.html', line: 42 }]);
  const copy = errors.snapshot(); copy[0]!.message = 'changed'; assert.equal(errors.snapshot()[0]!.message, entry.message);
  for (let i = 0; i < 20; i++) errors.observe({ ...entry, message: String(i).padEnd(1000, 'x'), sourceId: 'data:text/plain,private' });
  assert.equal(errors.snapshot().length, 8);
  assert.ok(errors.snapshot().every(e => e.message.length === 800 && e.source === ''));
  errors.reset(); assert.deepEqual(errors.snapshot(), []);
});
