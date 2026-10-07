import assert from 'node:assert/strict';
import test from 'node:test';
import type { StartAgentRunRequest } from '@fielora/contracts';
import { startAgentWithReconciliation } from './agent-start.ts';

const input: StartAgentRunRequest = { field_id: 'project', conversation_id: 'conversation', provider_config_id: 'provider', user_message_id: 'message', model_id: 'model', task: 'Build the project', permission: 'FULL_CONTROL', max_steps: null, attachments: [] };
test('lost start acknowledgement reconnects to the exact durable message without issuing another start', async () => {
  const calls: string[] = [];
  const result = await startAgentWithReconciliation(async (method, params) => {
    calls.push(method);
    if (method === 'command.agent.start') throw new Error('FIPC request timed out: command.agent.start');
    if (method === 'query.agent.list') return [
      { ...input, id: 'other-message', created_at: Date.now(), status: 'RUNNING' },
      { ...input, id: 'accepted', created_at: Date.now(), status: 'PAUSED' },
    ];
    return [{ payload: { user_message_id: (params as {run_id: string}).run_id === 'accepted' ? 'message' : 'other' } }];
  }, input);
  assert.equal(result.id, 'accepted');
  assert.equal(result.status, 'PAUSED');
  assert.equal(calls.filter(method => method === 'command.agent.start').length, 1);
});
test('unavailable Core or a stale run leaves start status unknown instead of retrying or claiming failure', async () => {
  for (const unavailable of [false, true]) {
    let starts = 0;
    await assert.rejects(startAgentWithReconciliation(async method => {
      if (method === 'command.agent.start') { starts++; throw new Error('FIPC request timed out: command.agent.start'); }
      if (unavailable) throw new Error('Core unavailable');
      return [{ ...input, id: 'old', created_at: 1 }];
    }, input), /AGENT_START_STATUS_UNKNOWN/);
    assert.equal(starts, 1);
  }
});
test('credential errors remain actionable and do not trigger reconciliation', async () => {
  let calls = 0;
  await assert.rejects(startAgentWithReconciliation(async () => { calls++; throw new Error('CREDENTIAL_REENTRY_REQUIRED'); }, input), /CREDENTIAL_REENTRY_REQUIRED/);
  assert.equal(calls, 1);
});
