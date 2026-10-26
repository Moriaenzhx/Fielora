import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentToolCallView } from '@fielora/contracts';
import type { ConversationActivityGroupItem, ConversationActivityItem } from './agent-activity-projection.ts';
import { conversationTimelineSections, conversationToolPresentation, conversationToolStatus, conversationGroupIcon } from './conversation-presentation.ts';

function tool(id: string, name = 'read_file', status: AgentToolCallView['status'] = 'COMPLETED', args: Record<string, unknown> = {}, receipt: Record<string, unknown> | null = null): AgentToolCallView {
  return { id, run_id: 'run', name, effect: 'OBSERVE', status, policy_decision: 'ALLOW', arguments: args, receipt, error_code: null, created_at: 1, updated_at: 2 };
}
function narrative(index: number): ConversationActivityItem {
  return { id: `n-${index}`, kind: 'NARRATIVE', sequence: index, occurredAt: index, step: index, text: `说明 ${index}` };
}
function group(index: number, calls: AgentToolCallView[], completedAt: number | null = 2): ConversationActivityGroupItem {
  return { id: `g-${index}`, kind: 'GROUP', sequence: index, occurredAt: index, completedAt, groupKind: 'OTHER', title: '操作',
    entries: calls.map(call => ({ id: `tool-${call.id}`, kind: 'TOOL', sequence: index, occurredAt: index, completedAt,
      activityKind: 'OTHER', tool: call, status: call.status, toolId: call.id })) };
}

test('asking, searching and external fallback never imply a paused task', () => {
  for (const status of ['COMPLETED', 'RUNNING', 'FAILED', 'WAITING_APPROVAL'] as const) {
    const question = conversationToolPresentation(tool('ask', 'request_user_input', status));
    assert.equal(question.icon, 'question');
    assert.match(question.label, /向你提问/);
    assert.doesNotMatch(question.label, /request_user_input|任务已暂停/);
    assert.equal(conversationToolPresentation(tool('search', 'search_text', status)).icon, 'search');
    assert.equal(conversationToolPresentation(tool('web', 'web.search', status)).icon, 'search');
    assert.equal(conversationToolPresentation(tool('unknown', 'custom.search', status)).icon, 'tools', 'Unknown tool metadata does not establish a search operation');
  }
  assert.equal(conversationToolPresentation(tool('ask', 'request_user_input')).label, '已向你提问');
  assert.equal(conversationToolPresentation(tool('git', 'git_read', 'COMPLETED', { operation: 'diff' })).icon, 'fileDiff');
  assert.equal(conversationToolPresentation(tool('git', 'git_read', 'COMPLETED', { operation: 'log' })).icon, 'history');
});

test('group glyph follows its visible lead action or represents the complete mixed group', () => {
  const mixed = group(1, [tool('unknown', 'custom.inspect'), tool('search', 'web.search')]).entries;
  assert.equal(conversationGroupIcon(mixed), 'operations');
  assert.equal(conversationGroupIcon(mixed, mixed[1]), 'search', 'A web-led summary cannot borrow the first generic tool glyph');
  assert.equal(conversationGroupIcon([...mixed].reverse()), 'operations', 'Mixed group semantics do not depend on order');
  assert.equal(conversationGroupIcon(group(1, [tool('a'), tool('b')]).entries), 'file');
  assert.equal(conversationGroupIcon(group(1, [tool('a', 'run_command'), tool('b', 'run_command')]).entries), 'terminal', 'Verification commands still depict the actual operation');
});

test('tool labels describe the actual plan and server action without claiming readiness or verification', () => {
  assert.equal(conversationToolPresentation(tool('plan', 'work_plan')).label, '已更新工作计划');
  assert.equal(conversationToolPresentation(tool('plan', 'work_plan')).icon, 'plan');
  const start = conversationToolPresentation(tool('server', 'browser_server', 'COMPLETED', { action: 'start', url: 'http://localhost:4321/page?token=private#key' }, { success: true, readiness: 'NOT_CHECKED' }));
  assert.equal(start.label, '已启动服务进程 · localhost:4321');
  assert.equal(start.icon, 'server');
  assert.doesNotMatch(start.label, /已管理|验证|就绪|private|token/);
  assert.equal(conversationToolPresentation(tool('server', 'browser_server', 'COMPLETED', { action: 'status' })).label, '已检查开发服务');
  assert.equal(conversationToolPresentation(tool('server', 'browser_server', 'RUNNING', { action: 'stop' })).label, '正在停止开发服务');
});

test('long inline commands retain executable and invocation form without revealing source or inventing a purpose', () => {
  const source = 'const privateValue = "sensitive"; '.repeat(80);
  const inline = conversationToolPresentation(tool('cmd', 'run_command', 'COMPLETED', { program: '/private/runtime/bin/node', argv: ['--input-type=module', '-e', source] }, { exit_code: 0 }));
  assert.equal(inline.label, '已运行命令 · node --input-type=module -e …');
  assert.equal(inline.icon, 'terminal');
  assert.equal(inline.command, true);
  assert.doesNotMatch(inline.label, /sensitive|privateValue|验证|测试/);
  assert.equal(conversationToolPresentation(tool('cmd', 'run_command', 'COMPLETED', { program: 'node', argv: ['--eval=' + source] })).detail, 'node --eval …');
  assert.equal(conversationToolPresentation(tool('cmd', 'run_command', 'COMPLETED', { program: 'pnpm', argv: ['test', '--filter', 'desktop'] })).detail, 'pnpm test --filter desktop');
  const address = conversationToolPresentation(tool('cmd', 'run_command', 'COMPLETED', { program: 'curl', argv: ['https://user:password@example.com/page?secret=value#token'] }));
  assert.equal(address.detail, 'curl https://example.com/page');
  assert.doesNotMatch(address.label, /password|secret|value|token/);
});

test('completed transport cannot turn failed or unknown operation receipts into success', () => {
  for (const receipt of [{ success: false }, { timed_out: true }, { exit_code: 2 }]) {
    const presentation = conversationToolPresentation(tool('cmd', 'run_command', 'COMPLETED', { program: 'node', argv: ['script.cjs'] }, receipt));
    assert.equal(presentation.status, 'FAILED');
    assert.equal(presentation.succeeded, false);
    assert.match(presentation.label, /未成功/);
    assert.doesNotMatch(presentation.label, /^已/);
  }
  assert.equal(conversationToolStatus(tool('unknown', 'run_command', 'CANCELLED', {}, { outcome_unknown: true })), 'UNKNOWN');
  const external = conversationToolPresentation(tool('external', 'custom.do_work', 'COMPLETED'));
  assert.equal(external.label, '已调用 custom.do_work');
  assert.doesNotMatch(external.label, /修改项目|验证通过|写入/);
});

test('read and native rows keep actual range and receipt identity', () => {
  const read = conversationToolPresentation(tool('read', 'read_file', 'COMPLETED', { path: 'src/app.ts', line_start: 30, line_end: 60 }));
  assert.equal(read.icon, 'file');
  assert.match(read.label, /src\/app.ts · 行 30–60/);
  assert.equal(conversationToolPresentation(tool('read', 'read_file', 'COMPLETED', { path: 'src/app.ts' })).label, '已读取文件 · src/app.ts');
  assert.equal(conversationToolPresentation(tool('read', 'read_file', 'COMPLETED', { path: 'https://example.com/file?token=secret#fragment' })).label, '已读取文件 · https://example.com/file');
  const native = conversationToolPresentation(tool('native', 'computer', 'COMPLETED', { action: 'observe', app_id: 'fictional' }, { kind: 'COMPUTER', action: 'observe', success: true, target: { app_id: 'actual', name: 'Notes', bundle_id: 'actual' } }));
  assert.equal(native.label, 'Notes · 已读取应用窗口');
  assert.equal(native.icon, 'application');
  assert.doesNotMatch(native.label, /fictional/);
});

test('short processes stay expanded; long processes retain exactly the latest eight original items', () => {
  const short = Array.from({ length: 14 }, (_, index) => narrative(index));
  assert.ok(conversationTimelineSections(short).every(section => section.kind === 'ITEM'));
  const long = [...short, narrative(14), narrative(15), narrative(16)];
  const sections = conversationTimelineSections(long);
  assert.equal(sections.length, 9);
  const archive = sections[0]!;
  assert.equal(archive.kind, 'ARCHIVE');
  if (archive.kind !== 'ARCHIVE') throw new Error('archive expected');
  assert.equal(archive.items.length, 9);
  assert.equal(archive.summary.narrativeCount, 9);
  assert.equal(archive.summary.label, '较早过程 · 9 段说明');
  const restored = sections.flatMap(section => section.kind === 'ITEM' ? [section.item] : section.items);
  assert.deepEqual(restored, long);
  restored.forEach((item, index) => assert.equal(item, long[index]));
  assert.deepEqual(sections.slice(-8).map(section => section.kind === 'ITEM' && section.item), long.slice(-8));
});

test('approvals, pending groups and context remain visible and split archives into chronological intervals', () => {
  const pendingGroup = group(3, [tool('pending', 'run_command', 'RUNNING')], null);
  const unknownGroup = group(5, [tool('unknown', 'computer', 'COMPLETED', {}, { outcome_unknown: true })]);
  const pendingContext: ConversationActivityItem = { id: 'ctx', kind: 'CONTEXT', sequence: 7, occurredAt: 7, completedAt: null, beforeBytes: 400, afterBytes: null };
  const approval: ConversationActivityItem = { id: 'approval', kind: 'APPROVAL', sequence: 1, occurredAt: 1, completedAt: null, approvalId: 'approval-id', toolCallId: 'call', decision: null };
  const decided: ConversationActivityItem = { ...approval, id: 'decided', sequence: 9, completedAt: 10, decision: 'ALLOW_ONCE' };
  const nestedContext = group(11, [tool('read')]); nestedContext.contextNotes = [{ ...pendingContext, id: 'nested' }];
  const items: ConversationActivityItem[] = [narrative(0), approval, narrative(2), pendingGroup, narrative(4), unknownGroup, narrative(6), pendingContext, narrative(8), decided, narrative(10), nestedContext,
    ...Array.from({ length: 9 }, (_, index) => narrative(12 + index))];
  const before = JSON.stringify(items);
  const sections = conversationTimelineSections(items);
  const visible = sections.flatMap(section => section.kind === 'ITEM' ? [section.item.id] : []);
  for (const item of [approval, pendingGroup, unknownGroup, pendingContext, decided, nestedContext]) assert.ok(visible.includes(item.id), item.id);
  const flattened = sections.flatMap(section => section.kind === 'ITEM' ? [section.item] : section.items);
  assert.deepEqual(flattened, items);
  assert.equal(JSON.stringify(items), before);
  for (const section of sections) if (section.kind === 'ARCHIVE') {
    const indexes = section.items.map(item => items.indexOf(item));
    indexes.forEach((index, offset) => assert.equal(index, indexes[0]! + offset));
  }
});

test('archived failures stay counted with their latest recorded reason, separate from the concise summary label', () => {
  const failed = tool('failed', 'browser', 'COMPLETED', { action: 'open' }, { success: false, error_code: 'BROWSER_NAVIGATION_FAILED' });
  const denied = tool('denied', 'run_command', 'DENIED');
  const stopped = tool('stopped', 'run_command', 'CANCELLED');
  const laterFailed = tool('later', 'run_command', 'COMPLETED', {}, { exit_code: 7 });
  const items = [group(0, [failed, denied]), narrative(1), group(2, [stopped, laterFailed]), ...Array.from({ length: 15 }, (_, index) => narrative(index + 3))];
  const archive = conversationTimelineSections(items)[0]!;
  assert.equal(archive.kind, 'ARCHIVE');
  if (archive.kind !== 'ARCHIVE') throw new Error('archive expected');
  assert.equal(archive.summary.operationCount, 4);
  assert.equal(archive.summary.failedCount, 2);
  assert.equal(archive.summary.deniedCount, 1);
  assert.equal(archive.summary.cancelledCount, 1);
  assert.equal(archive.summary.latestFailure, '命令退出码 7');
  assert.doesNotMatch(archive.summary.label, /失败|未成功|退出码|已拒绝|已停止/);
  assert.equal(archive.items[0], items[0]);
});

test('invalid display options keep safe defaults and never prune an item', () => {
  const items = Array.from({ length: 18 }, (_, index) => narrative(index));
  for (const options of [{ threshold: NaN, recentCount: 0 }, { threshold: -1, recentCount: 1.5 }]) {
    assert.deepEqual(conversationTimelineSections(items, options), conversationTimelineSections(items));
  }
  assert.deepEqual(conversationTimelineSections([], {}), []);
  assert.ok(conversationTimelineSections(items, { recentCount: 20 }).every(section => section.kind === 'ITEM'));
});

test('failure summaries reuse known explanations and exit codes but preserve unknown errors without guessing', () => {
  const reason = (call: AgentToolCallView): string | null => {
    const items = [group(0, [call]), ...Array.from({ length: 15 }, (_, index) => narrative(index + 1))];
    const first = conversationTimelineSections(items)[0]!;
    assert.equal(first.kind, 'ARCHIVE');
    return first.kind === 'ARCHIVE' ? first.summary.latestFailure : null;
  };
  assert.equal(reason({ ...tool('cmd', 'run_command', 'FAILED', {}, { exit_code: 9 }), error_code: 'AGENT_PROCESS_FAILED' }), '命令退出码 9');
  assert.equal(reason({ ...tool('cmd', 'run_command', 'FAILED'), error_code: 'AGENT_PROCESS_FAILED' }), 'AGENT_PROCESS_FAILED');
  assert.equal(reason(tool('browser', 'browser', 'COMPLETED', {}, { success: false, error_code: 'BROWSER_SURFACE_NOT_READY' })), '浏览器工作面尚未就绪');
  assert.match(reason(tool('browser', 'browser', 'COMPLETED', {}, { success: false, error_code: 'BROWSER_NAVIGATION_FAILED' }))!, /目标页面加载失败/);
  assert.equal(reason({ ...tool('search', 'web.search', 'FAILED'), error_code: 'UNRECOGNIZED_PROVIDER_FAILURE' }), 'UNRECOGNIZED_PROVIDER_FAILURE');
  assert.equal(reason(tool('browser', 'browser', 'COMPLETED', {}, { success: false, error_code: 'BROWSER_DOWNLOAD_UNRECOGNIZED' })), 'BROWSER_DOWNLOAD_UNRECOGNIZED');
});
