import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nextScheduledRun, ScheduledTaskService } from './scheduled-tasks.ts';

test('scheduled tasks persist, pause, resume, run through the supplied AgentRun executor and delete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fielora-scheduled-'));
  const file = path.join(root, 'scheduled-tasks.json');
  let now = new Date(2026, 8, 1, 10, 0, 0, 0).getTime();
  const executed: string[] = [];
  try {
    const service = await ScheduledTaskService.open(file, async (task) => {
      executed.push(`${task.conversation_id}:${task.task}`);
      return `agent-run-${executed.length}`;
    }, () => now);
    const created = await service.create({
      name: '每日回顾', task: '检查项目并汇总进展', field_id: 'project-1', conversation_id: 'conversation-1',
      provider_config_id: 'provider-1', model_id: 'model-1', permission: 'REVIEW_CHANGES', max_steps: 16,
      cadence: 'DAILY', local_time: '11:00', weekday: null, run_at: null, timezone: 'Asia/Shanghai',
    });
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.next_run_at, new Date(2026, 8, 1, 11, 0, 0, 0).getTime());

    const paused = await service.update({ id: created.id, status: 'PAUSED' });
    assert.equal(paused.next_run_at, null);
    now += 5_000;
    const resumed = await service.update({ id: created.id, status: 'ACTIVE' });
    assert.equal(resumed.status, 'ACTIVE');
    assert.ok(resumed.next_run_at && resumed.next_run_at > now);

    const ran = await service.runNow(created.id);
    assert.equal(ran.last_agent_run_id, 'agent-run-1');
    assert.deepEqual(executed, ['conversation-1:检查项目并汇总进展']);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1);

    const reopened = await ScheduledTaskService.open(file, async () => 'unexpected', () => now);
    assert.equal(reopened.list()[0]?.last_agent_run_id, 'agent-run-1');
    await reopened.delete(created.id);
    assert.deepEqual(reopened.list(), []);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test('nextScheduledRun computes one-time, daily and weekly local schedules', () => {
  const monday = new Date(2026, 8, 7, 9, 30, 0, 0).getTime();
  assert.equal(nextScheduledRun({ cadence: 'ONCE', local_time: '00:00', weekday: null, run_at: monday + 1_000 }, monday), monday + 1_000);
  assert.equal(nextScheduledRun({ cadence: 'ONCE', local_time: '00:00', weekday: null, run_at: monday }, monday), null);
  assert.equal(nextScheduledRun({ cadence: 'DAILY', local_time: '10:15', weekday: null, run_at: null }, monday), new Date(2026, 8, 7, 10, 15, 0, 0).getTime());
  assert.equal(nextScheduledRun({ cadence: 'WEEKLY', local_time: '09:00', weekday: 1, run_at: null }, monday), new Date(2026, 8, 14, 9, 0, 0, 0).getTime());
});

test('scheduled execution reuses the existing Conversation message and AgentRun commands', () => {
  const main = readFileSync(path.join(import.meta.dirname, 'main.ts'), 'utf8');
  const start = main.indexOf('async function executeScheduledTask');
  const end = main.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  const executor = main.slice(start, end);
  assert.match(executor, /supervisor\.request\('command\.conversation\.message\.create'/);
  assert.match(executor, /startAgentWithReconciliation/);
  const startCommand = readFileSync(path.join(import.meta.dirname, 'agent-start.ts'), 'utf8');
  assert.match(startCommand, /request\('command\.agent\.start'/);
  assert.doesNotMatch(executor, /new\s+(?:Agent|Core|Runtime)/);
});
