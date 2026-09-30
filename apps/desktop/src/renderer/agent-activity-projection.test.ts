import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentEventKind, AgentEventView, AgentToolCallView } from '@fielora/contracts';
import { buildConversationActivityProjection, compactOperationTimeline, reconcileLiveNarrative } from './agent-activity-projection.ts';

test('compact process preserves narrative order and stable operation identity as results arrive', () => {
  const events = [event(1, 'TOOL_PROPOSED', { tool_call_id: 'a' }), event(2, 'ASSISTANT_NARRATIVE', { text: 'A progress note', step: 1 }), event(3, 'TOOL_PROPOSED', { tool_call_id: 'b' })];
  const raw = buildConversationActivityProjection(events, [tool('a','read_file','OBSERVE','COMPLETED'), tool('b','read_file','OBSERVE','RUNNING')]);
  const before = compactOperationTimeline(raw);
  const after = compactOperationTimeline(buildConversationActivityProjection([...events, event(4,'ASSISTANT_NARRATIVE',{text:'Next note',step:2})], [tool('a','read_file','OBSERVE','COMPLETED'), tool('b','read_file','OBSERVE','FAILED')]));
  assert.deepEqual(before.map(item=>item.kind), ['GROUP','NARRATIVE','GROUP']);
  assert.deepEqual(before.map(item=>item.id), after.slice(0,3).map(item=>item.id));
  assert.equal(after[2]?.kind === 'GROUP' && after[2].entries[0]?.status, 'FAILED');
  assert.equal(after[3]?.kind === 'NARRATIVE' && after[3].text, 'Next note');
  assert.deepEqual(raw.map(item=>item.kind), ['GROUP','NARRATIVE','GROUP']);
  assert.deepEqual(compactOperationTimeline(after), after);
});

test('all progress prose and context boundaries remain visible, including repeated preparation', () => {
  const events = [event(1,'ASSISTANT_NARRATIVE',{text:'让我读取当前文件。',step:1}),
    event(2,'TOOL_PROPOSED',{tool_call_id:'a'}),
    event(3,'ASSISTANT_NARRATIVE',{text:'让我读取当前文件。',step:2}),
    event(4,'TOOL_PROPOSED',{tool_call_id:'b'}), event(5,'RUN_PAUSED')];
  const raw = buildConversationActivityProjection(events,[tool('a','read_file','OBSERVE','COMPLETED'),tool('b','read_file','OBSERVE','COMPLETED')]);
  const snapshot = JSON.stringify(raw);
  assert.deepEqual(compactOperationTimeline(raw).map(item => item.kind), ['NARRATIVE','GROUP','NARRATIVE','GROUP','PHASE']);
  assert.equal(JSON.stringify(raw), snapshot);
  const narrative = buildConversationActivityProjection([events[0]!], []);
  assert.deepEqual(compactOperationTimeline(narrative), narrative);
});

test('eight mixed operations form one scope; lifecycle events do not multiply calls or remove retries', () => {
  const tools = Array.from({length:8}, (_, i) => tool(`call-${i}`, i % 2 ? 'run_command' : 'read_file', i % 2 ? 'PROCESS' : 'OBSERVE', 'COMPLETED', {path:'same-path'}));
  const events = tools.flatMap((t,i) => [event(i*3+1,'TOOL_PROPOSED',{tool_call_id:t.id}), event(i*3+2,'TOOL_STARTED',{tool_call_id:t.id}),event(i*3+3,'TOOL_COMPLETED',{tool_call_id:t.id})]);
  const result = compactOperationTimeline(buildConversationActivityProjection(events, tools));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind === 'GROUP' && result[0].entries.length, 8);
  assert.equal(result[0]?.id, 'operations-tool-call-0');
  const appended = compactOperationTimeline(buildConversationActivityProjection([...events,event(25,'TOOL_PROPOSED',{tool_call_id:'ninth'})],[...tools,tool('ninth','read_file','OBSERVE','RUNNING')]));
  assert.equal(appended[0]?.id,result[0]?.id);
});

test('execution scope, failures, questions and run boundaries prevent merging', () => {
  for (const barrier of ['PHASE_CHANGED','TOOL_FAILED','RUN_PAUSED','RUN_STARTED','RECOVERY_STARTED'] as AgentEventKind[]) {
    const events = [event(1,'TOOL_PROPOSED',{tool_call_id:'a'}),event(2,barrier,{tool_call_id:'a'}),event(3,'TOOL_PROPOSED',{tool_call_id:'b'})];
    const result=compactOperationTimeline(buildConversationActivityProjection(events,[tool('a','read_file','OBSERVE','FAILED'),tool('b','read_file','OBSERVE','COMPLETED')]));
    assert.equal(result.filter(item=>item.kind==='GROUP').length,2,barrier);
  }
  const question=[tool('a','read_file','OBSERVE','COMPLETED'),tool('q','request_user_input','OBSERVE','COMPLETED',{question:'选择哪个？'}),tool('b','read_file','OBSERVE','COMPLETED')];
  const result=compactOperationTimeline(buildConversationActivityProjection(question.flatMap((t,i)=>[event(i*2+1,'TOOL_PROPOSED',{tool_call_id:t.id}),event(i*2+2,'TOOL_COMPLETED',{tool_call_id:t.id})]),question));
  assert.equal(result.filter(item=>item.kind==='GROUP').length,3);
});

test('a control operation completing cannot remove the first row or change disclosure identity', () => {
  const events = [event(1, 'TOOL_PROPOSED', { tool_call_id: 'plan' }), event(2, 'TOOL_PROPOSED', { tool_call_id: 'read' })];
  const project = (status: AgentToolCallView['status']) => compactOperationTimeline(buildConversationActivityProjection(events, [tool('plan', 'work_plan', 'OBSERVE', status), tool('read', 'read_file', 'OBSERVE', 'COMPLETED')]));
  const before = project('RUNNING');
  const after = project('COMPLETED');
  assert.equal(after[0]?.id, before[0]?.id);
  assert.deepEqual(after[0]?.kind === 'GROUP' && after[0].entries.map(entry => entry.id), ['tool-plan', 'tool-read']);
});

test('progress Markdown preserves leading code indentation and trailing whitespace', () => {
  const text = '    Get-Content README.md -Raw\n\n让我先读取文件。  \n';
  const items = buildConversationActivityProjection([event(1, 'ASSISTANT_NARRATIVE', { text })], []);
  assert.equal(items[0]?.kind === 'NARRATIVE' && items[0].text, text);
});

function event(sequence: number, kind: AgentEventKind, payload: Record<string, unknown> = {}): AgentEventView {
  return { id: `event-${sequence}`, run_id: 'run-1', sequence, schema_version: 1, kind, payload, created_at: sequence * 1_000 };
}

test('context compression pairs real lifecycle events and retains legacy completed records', () => {
  const start = event(1, 'CHECKPOINT_CREATED', { kind: 'GENERAL_CONTEXT_REDUCTION_STARTED', before_bytes: 90000 });
  const done = event(3, 'CHECKPOINT_CREATED', { kind: 'GENERAL_CONTEXT_REDUCED', before_bytes: 90000, after_bytes: 38000 });
  const pending = buildConversationActivityProjection([start], []);
  assert.equal(pending[0]?.kind, 'CONTEXT');
  assert.equal(pending[0]?.kind === 'CONTEXT' && pending[0].completedAt, null);
  const complete = buildConversationActivityProjection([done, start], []);
  assert.equal(complete.length, 1);
  assert.deepEqual(complete[0], { id: 'context-1', kind: 'CONTEXT', sequence: 1, occurredAt: 1000, completedAt: 3000, beforeBytes: 90000, afterBytes: 38000 });
  assert.equal(buildConversationActivityProjection([done], [])[0]?.kind, 'CONTEXT');
  assert.deepEqual(buildConversationActivityProjection([event(1, 'MODEL_STARTED'), event(2, 'CHECKPOINT_CREATED', { kind: 'GENERAL_WORK_STATE_V1' })], []), []);
  const resumed = buildConversationActivityProjection([start, event(2, 'RUN_PAUSED'), event(3, 'RUN_RESUMED')], []);
  assert.equal(resumed[0]?.kind === 'CONTEXT' && resumed[0].interrupted, true, 'resuming a run must not animate an old interrupted reduction');
});

function tool(id: string, name: string, effect: AgentToolCallView['effect'], status: AgentToolCallView['status'], argumentsValue: Record<string, unknown> = {}, receipt: Record<string, unknown> | null = null): AgentToolCallView {
  return { id, run_id: 'run-1', name, effect, status, policy_decision: 'ALLOW', arguments: argumentsValue, receipt, error_code: status === 'FAILED' ? 'FIXTURE_FAILED' : null, created_at: 1_000, updated_at: 30_000 };
}

test('a completed browser call with failed assertions is presented as failed', () => {
  const history = buildConversationActivityProjection([event(1, 'TOOL_PROPOSED', { tool_call_id: 'check' }), event(2, 'TOOL_COMPLETED', { tool_call_id: 'check' })], [tool('check', 'browser_verify', 'NETWORK', 'COMPLETED', {}, { verification_eligible: true, success: false })]);
  const group = history.find(item => item.kind === 'GROUP');
  assert.ok(group && group.kind === 'GROUP');
  assert.equal(group.entries[0]?.status, 'FAILED');
});

test('narrative is the activity boundary and the real event sequence is never regrouped by activity type', () => {
  const tools = [
    tool('read-a', 'read_file', 'OBSERVE', 'COMPLETED', { path: 'README.md' }),
    tool('command-a', 'run_command', 'PROCESS', 'COMPLETED', { program: 'rg', argv: ['AgentTurn'] }),
    tool('edit-b', 'replace_text', 'WORKSPACE_WRITE', 'COMPLETED', { path: 'src/AgentTurn.tsx' }),
    tool('test-b', 'run_command', 'PROCESS', 'FAILED', { program: 'pnpm', argv: ['test'] }, { verification_eligible: true }),
    tool('read-c', 'read_file', 'OBSERVE', 'COMPLETED', { path: 'src/AgentTurn.tsx' }),
    tool('edit-c', 'replace_text', 'WORKSPACE_WRITE', 'COMPLETED', { path: 'src/AgentTurn.tsx' }),
    tool('test-c', 'run_command', 'PROCESS', 'COMPLETED', { program: 'pnpm', argv: ['test', 'targeted'] }, { verification_eligible: true }),
  ];
  const events = [
    event(1, 'ASSISTANT_NARRATIVE', { step: 1, text: 'Narrative A' }),
    event(2, 'TOOL_PROPOSED', { tool_call_id: 'read-a' }),
    event(3, 'TOOL_COMPLETED', { tool_call_id: 'read-a' }),
    event(4, 'TOOL_PROPOSED', { tool_call_id: 'command-a' }),
    event(5, 'TOOL_COMPLETED', { tool_call_id: 'command-a' }),
    event(6, 'ASSISTANT_NARRATIVE', { step: 2, text: 'Narrative B' }),
    event(7, 'TOOL_PROPOSED', { tool_call_id: 'edit-b' }),
    event(8, 'TOOL_COMPLETED', { tool_call_id: 'edit-b' }),
    event(9, 'TOOL_PROPOSED', { tool_call_id: 'test-b' }),
    event(10, 'VERIFICATION_RECORDED', { receipt: { tool_call_id: 'test-b', outcome: 'FAIL' } }),
    event(11, 'TOOL_FAILED', { tool_call_id: 'test-b' }),
    event(12, 'ASSISTANT_NARRATIVE', { step: 3, text: 'Narrative C' }),
    event(13, 'TOOL_PROPOSED', { tool_call_id: 'read-c' }),
    event(14, 'TOOL_COMPLETED', { tool_call_id: 'read-c' }),
    event(15, 'TOOL_PROPOSED', { tool_call_id: 'edit-c' }),
    event(16, 'TOOL_COMPLETED', { tool_call_id: 'edit-c' }),
    event(17, 'TOOL_PROPOSED', { tool_call_id: 'test-c' }),
    event(18, 'VERIFICATION_RECORDED', { receipt: { tool_call_id: 'test-c', outcome: 'PASS' } }),
    event(19, 'TOOL_COMPLETED', { tool_call_id: 'test-c' }),
  ];

  const projection = buildConversationActivityProjection([...events].reverse(), tools);
  assert.deepEqual(projection.map((item) => [item.kind, item.sequence]), [
    ['NARRATIVE', 1], ['GROUP', 2],
    ['NARRATIVE', 6], ['GROUP', 7],
    ['NARRATIVE', 12], ['GROUP', 13],
  ]);
  assert.deepEqual(projection.filter((item) => item.kind === 'NARRATIVE').map((item) => item.text), ['Narrative A', 'Narrative B', 'Narrative C']);
  const groups = projection.filter((item) => item.kind === 'GROUP');
  assert.deepEqual(groups.map((group) => group.entries.map((entry) => entry.kind === 'TOOL' ? entry.tool.name : entry.title)), [
    ['read_file', 'run_command'],
    ['replace_text', 'run_command'],
    ['read_file', 'replace_text', 'run_command'],
  ]);
  assert.equal(groups[0]?.title, '已读取相关文件并运行了命令');
  assert.match(groups[1]?.title ?? '', /已编辑 1 个文件.*验证/);
  assert.match(groups[2]?.title ?? '', /已读取相关文件.*已编辑 1 个文件.*验证/);
});

test('failed edits are described as attempts and excluded from edited file totals', () => {
  const failed = tool('failed', 'replace_text', 'WORKSPACE_WRITE', 'FAILED', { path: 'src/login.js' });
  const succeeded = tool('succeeded', 'replace_text', 'WORKSPACE_WRITE', 'COMPLETED', { path: 'src/ready.js' });
  const events = [event(1, 'TOOL_PROPOSED', { tool_call_id: failed.id }), event(2, 'TOOL_FAILED', { tool_call_id: failed.id })];
  const failedGroup = buildConversationActivityProjection(events, [failed])[0];
  assert.equal(failedGroup?.kind, 'GROUP');
  if (failedGroup?.kind === 'GROUP') {
    assert.match(failedGroup.title, /尝试修改文件/);
    assert.doesNotMatch(failedGroup.title, /已编辑/);
  }
  const mixed = buildConversationActivityProjection([...events,
    event(3, 'TOOL_PROPOSED', { tool_call_id: succeeded.id }), event(4, 'TOOL_COMPLETED', { tool_call_id: succeeded.id }),
  ], [failed, succeeded])[1];
  assert.equal(mixed?.kind, 'GROUP');
  if (mixed?.kind === 'GROUP') assert.match(mixed.title, /已编辑 1 个文件/);
});

test('approved tools remain after the approval anchor and carry persisted terminal time', () => {
  const edit = tool('edit', 'replace_text', 'WORKSPACE_WRITE', 'COMPLETED', { path: 'src/AgentTurn.tsx' });
  const approvalEvents = [
    event(1, 'ASSISTANT_NARRATIVE', { step: 1, text: '需要修改文件。' }),
    event(2, 'TOOL_PROPOSED', { tool_call_id: 'edit' }),
    event(3, 'APPROVAL_REQUESTED', { approval: { id: 'approval-1', tool_call_id: 'edit' } }),
    event(4, 'APPROVAL_RESOLVED', { approval_id: 'approval-1', tool_call_id: 'edit', decision: 'ALLOW_ONCE' }),
    event(5, 'TOOL_STARTED', { tool_call_id: 'edit' }),
    event(6, 'TOOL_COMPLETED', { tool_call_id: 'edit' }),
  ];
  const projection = buildConversationActivityProjection(approvalEvents, [edit]);
  assert.deepEqual(projection.map((item) => item.kind), ['NARRATIVE', 'APPROVAL', 'GROUP']);
  const approval = projection.find((item): item is Extract<(typeof projection)[number], { kind: 'APPROVAL' }> => item.kind === 'APPROVAL');
  const activity = projection.find((item): item is Extract<(typeof projection)[number], { kind: 'GROUP' }> => item.kind === 'GROUP');
  assert.equal(approval?.decision, 'ALLOW_ONCE');
  assert.equal(approval?.completedAt, 4_000);
  assert.equal(activity?.sequence, 5);
  assert.equal(activity?.completedAt, 6_000);
});

test('internal delegate bookkeeping and transient delta event kinds do not become durable conversation activity', () => {
  const internal = tool('delegate', 'delegate_readonly', 'OBSERVE', 'COMPLETED', { objective: 'inspect' });
  const projection = buildConversationActivityProjection([
    event(1, 'MODEL_TEXT_DELTA', { text_delta: 'transient only' }),
    event(2, 'TOOL_PROPOSED', { tool_call_id: 'delegate' }),
    event(3, 'TOOL_COMPLETED', { tool_call_id: 'delegate' }),
  ], [internal]);
  assert.deepEqual(projection, []);
});

test('live narrative is replaced by the matching durable model turn without duplication', () => {
  const live = '我先确认相关实现。';
  assert.equal(reconcileLiveNarrative([], live, 2), live);
  assert.equal(reconcileLiveNarrative([
    { id: 'narrative-8', kind: 'NARRATIVE', sequence: 8, occurredAt: 8, step: 2, text: live },
  ], live, 2), '');
  assert.equal(reconcileLiveNarrative([
    { id: 'narrative-4', kind: 'NARRATIVE', sequence: 4, occurredAt: 4, step: 1, text: '上一轮说明' },
  ], live, 2), live);
});
