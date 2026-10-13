import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResultReference } from '@fielora/contracts';
import { prototypeErrorMessage, prototypeReferences } from './interactive-prototype.ts';

function reference(path: string, hash: string | null = 'a'.repeat(64)): ResultReference {
  return {
    id: `resultref_${'1'.repeat(32)}`, label: '原型',
    target: { kind: 'PROJECT_FILE', field_id: 'project', relative_path: path, expected_sha256: hash },
    provenance: { kind: 'PROJECT_CONTEXT' },
  };
}

test('only complete version-bound HTML references offer previews; source and other result types stay inert', () => {
  const html = reference('prototypes/example.HTML');
  const candidates: ResultReference[] = [html, reference('source.ts'), reference('old.html', null), reference('bad.html', 'guess'), {
    ...reference('example.html'), target: { kind: 'WEB_REFERENCE', field_id: 'project', reference_id: 'remote', https_url: 'https://example.com/example.html' },
  }];
  assert.deepEqual(prototypeReferences(candidates, false), [html]);
  assert.deepEqual(prototypeReferences(candidates, true), []);
  assert.deepEqual(prototypeReferences([], false), []);
});

test('repeated links share one preview while different versions and projects remain distinct and bounded', () => {
  const html = reference('index.html');
  const duplicate = { ...html, id: `resultref_${'2'.repeat(32)}`, label: '再次打开' };
  const newer = reference('index.html', 'b'.repeat(64));
  const otherProject = { ...reference('index.html'), target: { ...html.target, field_id: 'other' } } as ResultReference;
  assert.deepEqual(prototypeReferences([html, duplicate, newer, otherProject], false), [html, newer, otherProject]);
  assert.equal(prototypeReferences(Array.from({ length: 20 }, (_, i) => reference(`${i}.htm`)), false).length, 4);
});

test('preview errors distinguish changed bytes without exposing host paths or raw exceptions', () => {
  assert.match(prototypeErrorMessage(new Error('Error invoking: PROTOTYPE_CHANGED')), /旧版本/);
  assert.match(prototypeErrorMessage(new Error('PROTOTYPE_TOO_LARGE')), /256 KiB/);
  assert.match(prototypeErrorMessage(new Error('PROTOTYPE_TOO_MANY')), /关闭其他/);
  assert.equal(prototypeErrorMessage(new Error('ENOENT /private/user-file')), prototypeErrorMessage(null));
});
