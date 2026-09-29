import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewDiffRows } from './review-diff.ts';
import type { AgentReviewFile } from './agent-review';

const file = (overrides: Partial<AgentReviewFile>): AgentReviewFile => ({ path: 'src/a.ts', previousPath: null, changeType: 'MODIFY', additions: 1, deletions: 1, diff: '', changes: [], state: 'APPLIED', ...overrides });

test('unified hunks preserve coordinates, whitespace, header-like code and newline markers', () => {
  const rows = reviewDiffRows(file({ diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -12,3 +12,3 @@\n unchanged\n---code\n+++code\n \n\\ No newline at end of file\n@@ -90 +91 @@\n-old\n+new\n' }));
  assert.deepEqual(rows.filter(r => r.kind === 'remove').map(r => [r.text, r.oldLine, r.newLine]), [['--code', 13, null], ['old', 90, null]]);
  assert.deepEqual(rows.filter(r => r.kind === 'add').map(r => [r.text, r.oldLine, r.newLine]), [['++code', null, 13], ['new', null, 91]]);
  assert.deepEqual(rows.filter(r => r.kind === 'context').map(r => [r.text, r.oldLine, r.newLine]), [['unchanged', 12, 12], ['', 14, 14]]);
  assert.equal(rows.filter(r => r.kind === 'meta').length, 1);
});

test('zero-length hunks keep added and deleted line numbers on the correct side', () => {
  const added = reviewDiffRows(file({ diff: '@@ -0,0 +1,2 @@\r\n+first\r\n+\r\n' }));
  assert.deepEqual(added.slice(1).map(r => [r.text, r.oldLine, r.newLine]), [['first', null, 1], ['', null, 2]]);
  const removed = reviewDiffRows(file({ diff: '@@ -8,1 +7,0 @@\n-gone' }));
  assert.equal(removed[1]?.oldLine, 8);
  assert.equal(removed[1]?.newLine, null);
});

test('legacy snippets retain blank lines without inventing source coordinates', () => {
  const rows = reviewDiffRows(file({ changes: [{ before: 'old\n\nvalue', after: '' }, { before: '', after: 'new' }] }));
  assert.deepEqual(rows.filter(r => r.kind === 'remove').map(r => r.text), ['old', '', 'value']);
  assert.ok(rows.every(r => r.oldLine === null && r.newLine === null));
  assert.equal(rows.filter(r => r.kind === 'add').length, 1);
});

test('complete created files start at one and do not add a phantom final line', () => {
  const rows = reviewDiffRows(file({ changeType: 'CREATE', changes: [{ before: null, after: 'hello\n\nworld\n' }] }));
  assert.deepEqual(rows.map(r => [r.text, r.newLine]), [['hello', 1], ['', 2], ['world', 3]]);
  assert.deepEqual(reviewDiffRows(file({})), []);
});
