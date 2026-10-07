// Independent bounded output oracles. These do NOT certify the Fielora workflow.
// Run outside the Agent project: node verify.mjs stats|filter|report PROJECT_PATH
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, projectPath] = process.argv.slice(2);
if (!['stats', 'filter', 'report'].includes(mode) || !projectPath) {
  console.error('Usage: node verify.mjs stats|filter|report PROJECT_PATH');
  process.exit(2);
}
const project = path.resolve(projectPath);
const fixtures = [
  { id: 'a', title: 'Fix sidebar', status: 'open', priority: 'high' },
  { id: 'b', title: 'Font import', status: 'done', priority: 'medium' },
  { id: 'c', title: 'Old sidebar', status: 'archived', priority: 'high' },
  { id: 'd', title: 'Scheduler', status: 'open', priority: 'low' },
];
try {
  if (mode === 'report') {
    const result = JSON.parse(await readFile(path.join(project, 'output/summary.json'), 'utf8'));
    assert.deepEqual(result, {
      paid_order_count: 6, total: '395.25',
      by_region: { East: '160.00', West: '200.20', North: '35.05' },
    });
    const report = await readFile(path.join(project, 'output/report.html'), 'utf8');
    assert.ok(report.trim().length > 100, 'Report must be a nonempty artifact; rendered review is separate');
  } else {
    const module = await import(pathToFileURL(path.join(project, 'src/tasks.mjs')).href);
    const before = JSON.stringify(fixtures);
    if (mode === 'stats') {
      assert.deepEqual(module.summarize(fixtures), {
        total: 3, open: 2, done: 1, byPriority: { high: 1, medium: 1, low: 1 },
      });
      assert.deepEqual(module.summarize([]), {
        total: 0, open: 0, done: 0, byPriority: { high: 0, medium: 0, low: 0 },
      });
      assert.equal(module.summarize([fixtures[1]]).open, 0);
      assert.equal(module.summarize([fixtures[2]]).total, 0);
      const variant = Array.from({ length: 9 }, (_, i) => ({ id: String(i), title: `Task ${i}`, status: i < 4 ? 'open' : 'done', priority: 'high' }));
      assert.deepEqual(module.summarize(variant), { total: 9, open: 4, done: 5, byPriority: { high: 9, medium: 0, low: 0 } });
    } else {
      assert.equal(typeof module.filterTasks, 'function');
      const ids = options => module.filterTasks(fixtures, options).map(task => task.id);
      assert.deepEqual(ids({}), ['a', 'b', 'd']);
      assert.deepEqual(ids({ query: ' SIDEBAR ' }), ['a']);
      assert.deepEqual(ids({ status: 'done' }), ['b']);
      assert.deepEqual(ids({ status: 'open', priority: 'low', query: 'schedule' }), ['d']);
      assert.deepEqual(ids({ status: 'done', priority: 'high' }), []);
      assert.deepEqual(module.filterTasks([], {}), []);
    }
    assert.equal(JSON.stringify(fixtures), before, 'Input was mutated');
    assert.equal(await readFile(path.join(project, 'src/user-note.txt'), 'utf8'), 'KEEP_USER_NOTE_20261003\n');
  }
  console.log(JSON.stringify({ mode, oracle: 'PASS', product_acceptance: 'REQUIRES_RUN_EVIDENCE_AND_HUMAN_REVIEW' }));
} catch (error) {
  console.error(JSON.stringify({ mode, oracle: 'FAIL', reason: error.message }));
  process.exitCode = 1;
}
