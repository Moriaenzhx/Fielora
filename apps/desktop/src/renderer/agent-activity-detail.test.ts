import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDetailFields, activityStatusLabel } from './agent-activity-detail.ts';

test('execution detail only displays existing fields and copies the same redacted DTO text', () => {
  const value = { name: 'run_command', arguments: { program: 'pwsh', argv: ['-Command', '[REDACTED]'], cwd: 'project' }, receipt: { exit_code: 0, duration_ms: 1250, stdout: 'visible [REDACTED]', stderr: '' }, error_code: null } as AgentToolCallView;
  const fields = activityDetailFields(value);
  assert.equal(fields.find(field => field.label === '命令')?.text, 'pwsh -Command [REDACTED]');
  assert.equal(fields.find(field => field.label === '标准输出')?.text, 'visible [REDACTED]');
  assert.ok(!fields.some(field => ['标准错误', '执行环境', '参数'].includes(field.label)));
  assert.equal(fields.find(field => field.label === '耗时')?.text, '1250 ms');
  assert.deepEqual(activityDetailFields({ ...value, arguments: {}, receipt: null }), []);
  assert.equal(activityStatusLabel('UNKNOWN'), '执行状态待确认');
  assert.equal(activityStatusLabel('CANCELLED'), '已停止');
  assert.equal(activityStatusLabel('WAITING_APPROVAL'), '等待批准');
});
import type { AgentRunView, AgentToolCallView, AgentEventView } from '@fielora/contracts';
import { goalProgressLabel, activityFailureReason, activityNarrativePreview, activityToolDescription, activityToolIssue, browserLoadPauseReason, resolveActivityFileLink } from './agent-activity-detail.ts';

const read = { name: 'read_file', status: 'COMPLETED', arguments: { path: 'src/login.js', line_start: 180, line_end: 280 }, receipt: { sha256: 'a'.repeat(64) } } as AgentToolCallView;

test('failed and legacy uncommitted browser loads explain the verification pause', () => {
  const failed = { ...read, name: 'browser', receipt: { error_code: 'BROWSER_NAVIGATION_FAILED', success: false } } as AgentToolCallView;
  assert.match(activityToolIssue(failed)!, /不能证明需要登录/);
  assert.match(browserLoadPauseReason([failed, read])!, /目标页面未能加载/);
  const loaded = { ...failed, receipt: { success: true, navigation_generation: 1, text: '到账确认' } } as AgentToolCallView;
  assert.equal(browserLoadPauseReason([failed, loaded]), null);
  assert.match(browserLoadPauseReason([{ ...failed, receipt: { success: true, navigation_generation: 0, text: '' } }])!, /尚未完成/);
});

test('plan records explain their next action and evidence issues without implying verification', () => {
  const plan = { ...read, name: 'work_plan', arguments: { next_step: { action: '对照原图核对当前弹窗' } }, receipt: { plan: { evidence_issues: [{ code: 'AGENT_WORK_QUOTE_MISMATCH' }] } } } as AgentToolCallView;
  assert.equal(activityToolDescription(plan), '对照原图核对当前弹窗');
  assert.match(activityToolIssue(plan)!, /1 条引用.*尚未验证/);
  assert.match(activityToolIssue({ ...plan, error_code: 'AGENT_WORK_SCOPE_MISMATCH' })!, /旧版计划/);
  assert.equal(activityToolIssue(read), null);
});

test('adjacent reads and searches remain distinguishable in collapsed operation rows', () => {
  assert.match(activityToolDescription(read), /180–280/);
  assert.match(activityToolDescription({ ...read, arguments: { path: 'src/login.js', line_start: 280, line_end: 450 } }), /280–450/);
  assert.match(activityToolDescription({ ...read, name: 'search_text', arguments: { path: 'src', query: 'initData' } }), /src.*initData/);
});

test('long analysis has a bounded original-text preview while concise progress stays visible', () => {
  assert.equal(activityNarrativePreview('正在检查登录后的初始化流程。'), null);
  const text = '正在检查初始化。\n\n```js\n' + 'const value = 1;\n'.repeat(50) + '```';
  assert.equal(activityNarrativePreview(text), '正在检查初始化。');
  assert.ok(activityNarrativePreview('分析'.repeat(500))!.length <= 181);
});

test('budget failure is explained from the persisted status without inventing a pause', () => {
  const run = { status: 'FAILED', current_step: 24, max_steps: 24, error_code: 'AGENT_MAX_STEPS_REACHED' } as AgentRunView;
  assert.match(activityFailureReason(run)!, /整体执行额度.*尚未完成/);
  assert.equal(activityFailureReason({ ...run, status: 'RUNNING' }), null);
  assert.match(activityFailureReason({ ...run, current_step: 16, max_steps: 4096 })!, /旧版局部策略.*尚未完成/);
  assert.ok(!activityFailureReason({ ...run, current_step: 16, max_steps: 4096 })!.includes('额度'));
});

test('historical file links require same-run successful read evidence and preserve the SHA guard', () => {
  assert.deepEqual(resolveActivityFileLink('fielora-project-file:src/login.js#L180-L200', [read]), { path: 'src/login.js', expectedSha256: 'a'.repeat(64), lineStart: 180, lineEnd: 200 });
  for (const target of ['fielora-project-file:../secret', 'fielora-project-file:C:/secret', 'fielora-project-file:/secret', 'fielora-project-file:src/other.js', 'fielora-project-file:src/login.js#L200-L180', 'file:///src/login.js']) {
    assert.equal(resolveActivityFileLink(target, [read]), null);
  }
  assert.equal(resolveActivityFileLink('fielora-project-file:src/login.js', [{ ...read, status: 'FAILED' }]), null);
  assert.equal(resolveActivityFileLink('fielora-project-file:src/login.js', [{ ...read, receipt: null }]), null);
});


test('saving an edit does not claim that verification is running', () => {
  const events = [{kind:'CHECKPOINT_CREATED',payload:{kind:'GENERAL_WORK_STATE_V1',goal:{status:'AWAITING_VERIFICATION'}}}] as AgentEventView[];
  assert.equal(goalProgressLabel(events),'修改已保存，等待验证');
});
