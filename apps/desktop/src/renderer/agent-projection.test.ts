import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentEventView } from '@fielora/contracts';
import { AGENT_PROJECTION_UNAVAILABLE_MESSAGE, agentForConversation, sameAgentSelection, loadCompleteAgentEventSequence, mergeAgentEventPages } from './agent-projection.ts';

test('a paused background run cannot route another conversation or a blank composer into its queue', () => {
  const paused = { runId: 'paused-a', conversationId: 'a', status: 'PAUSED' };
  assert.equal(agentForConversation(paused, 'a'), paused);
  assert.equal(agentForConversation(paused, 'terminal-b'), null);
  assert.equal(agentForConversation(paused, ''), null);
  assert.equal(agentForConversation(null, 'a'), null);
  assert.equal(paused.status, 'PAUSED', 'foreground selection must not cancel or resume the background run');
});

test('late receipts cannot publish after A -> B -> A or a project switch', async () => {
  const requested = { projectId: 'project', conversationId: 'a', generation: 1 };
  let current = requested;
  let resolveReceipt!: (value: string) => void;
  const receipt = new Promise<string>(resolve => { resolveReceipt = resolve; });
  let projection = 'current';
  const publication = receipt.then(value => { if (sameAgentSelection(current, requested)) projection = value; });
  assert.equal(sameAgentSelection(current, requested), true);
  current = { ...requested, conversationId: 'b', generation: 2 };
  assert.equal(sameAgentSelection(current, requested), false);
  current = { ...requested, generation: 3 };
  resolveReceipt('old-a-receipt');
  await publication;
  assert.equal(projection, 'current');
  assert.equal(sameAgentSelection({ ...requested, projectId: 'other-project' }, requested), false);
});

function event(id: string, sequence: number): AgentEventView {
  return {
    id,
    run_id: 'run-1',
    sequence,
    schema_version: 1,
    kind: 'STEP_STARTED',
    payload: {},
    created_at: sequence,
  };
}

test('incremental event pages are ordered and de-duplicated', () => {
  const current = [event('event-1', 1), event('event-2', 2)];
  const merged = mergeAgentEventPages(current, [event('event-2', 2), event('event-3', 3)]);
  assert.deepEqual(merged.map((item) => item.id), ['event-1', 'event-2', 'event-3']);
});

test('projection failure copy does not expose transport errors or claim the run failed', () => {
  assert.equal(AGENT_PROJECTION_UNAVAILABLE_MESSAGE, '运行记录暂时无法更新，Agent 仍会继续工作。');
  assert.doesNotMatch(AGENT_PROJECTION_UNAVAILABLE_MESSAGE, /FIPC|timed out|失败|停止/);
});

test('historical replay follows bounded continuation until every event is restored in sequence', async () => {
  const source = Array.from({ length: 437 }, (_, index) => event(`event-${index + 1}`, index + 1));
  const requests: Array<{ after_sequence: number | null; limit: number | null }> = [];
  const restored = await loadCompleteAgentEventSequence(async (request) => {
    requests.push({ after_sequence: request.after_sequence, limit: request.limit });
    return source.filter((item) => item.sequence > (request.after_sequence ?? 0)).slice(0, request.limit ?? 200);
  }, 'run-1', null, 200);
  assert.equal(restored.length, 437);
  assert.deepEqual(restored.map((item) => item.sequence), source.map((item) => item.sequence));
  assert.deepEqual(requests, [
    { after_sequence: null, limit: 200 },
    { after_sequence: 200, limit: 200 },
    { after_sequence: 400, limit: 200 },
  ]);
});
