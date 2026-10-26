import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPageErrors, BrowserResourceErrors } from './browser-page-errors.ts';

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

test('resource failures bind to observed document requests, redact URL secrets and reset on navigation', () => {
  const errors = new BrowserResourceErrors();
  const request = { id: 1, url: 'https://u:password@example.com/assets/app.js?token=secret#private', resourceType: 'script' };
  errors.begin(request); errors.complete({ id: 1, statusCode: 404 });
  assert.deepEqual(errors.snapshot(), [{ url: 'https://example.com/assets/app.js', resource_type: 'script', status_code: 404 }]);
  errors.begin({ ...request, id: 2 }); errors.reset(); errors.complete({ id: 2, statusCode: 503 });
  assert.deepEqual(errors.snapshot(), [], 'Old navigation cannot report a late failure');
  errors.begin({ ...request, id: 3 }); errors.complete({ id: 3, statusCode: 200 });
  errors.complete({ id: 999, error: 'net::ERR_CONNECTION_REFUSED' });
  assert.deepEqual(errors.snapshot(), [], 'Success or unobserved requests are not failures');
  for (let id = 4; id < 24; id++) {
    errors.begin({ ...request, id, url: `http://localhost/assets/${id}.js?secret` });
    errors.complete({ id, error: 'net::ERR_CONNECTION_REFUSED' });
  }
  assert.equal(errors.snapshot().length, 8);
  assert.ok(errors.snapshot().every(e => e.network_error === 'net::ERR_CONNECTION_REFUSED' && !e.url.includes('?')));
  errors.begin({ ...request, id: 24 }); errors.complete({ id: 24, error: 'untrusted raw content' });
  assert.equal(errors.snapshot().at(-1)?.network_error, 'NETWORK_ERROR');
});
