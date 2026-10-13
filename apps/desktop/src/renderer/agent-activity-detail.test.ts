import assert from 'node:assert/strict';
import test from 'node:test';
import { webActivity, activityDetailFields, activityStatusLabel } from './agent-activity-detail.ts';

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

test('computer activity distinguishes OS consent, stale focus and unknown dispatch', () => {
  const computer = { ...read, name: 'computer', arguments: { action: 'type', app_id: 'example.editor' }, receipt: { success: true, verification_passed: false } } as AgentToolCallView;
  assert.equal(activityToolDescription(computer), '输入文字 · example.editor');
  assert.equal(activityToolIssue(computer), null);
  assert.match(activityToolIssue({ ...computer, receipt: { success: false, error_code: 'COMPUTER_ACCESSIBILITY_REQUIRED' } })!, /完全访问不会替代系统授权/);
  assert.match(activityToolIssue({ ...computer, receipt: { success: false, error_code: 'COMPUTER_FOCUS_CHANGED' } })!, /未派发输入/);
  assert.match(activityToolIssue({ ...computer, status: 'UNKNOWN', receipt: { outcome_unknown: true } })!, /不能自动重复/);
  assert.match(activityToolIssue({ ...computer, receipt: { success: false, error_code: 'COMPUTER_GOVERNED_OPERATION_REQUIRED' } })!, /不能.*绕过确认/);
});

test('no-change edit is described accurately without claiming verification', () => {
  const unchanged = { ...read, name: 'write_file', status: 'FAILED', error_code: 'AGENT_EDIT_ALREADY_CURRENT' } as AgentToolCallView;
  assert.equal(activityStatusLabel(unchanged.status, unchanged.error_code), '内容已一致');
  assert.match(activityToolIssue(unchanged)!, /没有写入.*当前版本的检查/);
  assert.equal(activityStatusLabel('FAILED', 'AGENT_FILE_CHANGED'), '执行失败');
});

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

test('historical endpoint rejection does not assert a DNS diagnosis or configuration defect', () => {
  const run = { status: 'FAILED', error_code: 'CUSTOM_ENDPOINT_REJECTED' } as AgentRunView;
  assert.match(activityFailureReason(run)!, /旧版记录未区分 DNS/);
  assert.match(activityFailureReason({ ...run, error_code: 'PROVIDER_DNS_FAILED' })!, /无法解析.*尚未发送/);
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


test('web progress names actual sites and returned text without inventing search or verification', () => {
  const browser = { ...read, name: 'browser', arguments: { action: 'open', url: 'https://example.com/a?secret=private' }, receipt: { success: true, url: 'https://www.example.com/page', text_returned_chars: 2024 } } as AgentToolCallView;
  assert.deepEqual(webActivity(browser), { action: '打开网页', target: 'www.example.com', detail: 'www.example.com · 已返回 2024 字符' });
  assert.ok(!activityToolDescription(browser).includes('secret'));
  assert.equal(webActivity({ ...browser, status: 'RUNNING', receipt: null })?.target, 'example.com');
  assert.ok(!activityToolDescription({ ...browser, status: 'FAILED', receipt: { success: false, text_returned_chars: 2024 } }).includes('已返回'));
  assert.equal(webActivity({ ...browser, name: 'web.fetch' })?.action, '读取网页正文');
  assert.equal(webActivity({ ...browser, name: 'web.search', arguments: { query: 'official docs' } })?.action, '搜索网页');
  assert.equal(webActivity({ ...browser, status: 'RUNNING', arguments: { action: 'open', url: 'https://user:secret@example.com/' } })?.target, '');
});

test('browser downloads distinguish captured bytes from page text and cancelled clicks', () => {
  const download = { ...read, name: 'browser', arguments: { action: 'download' }, receipt: {
    success: true, url: 'http://localhost:8771', text_returned_chars: 4000,
    download: { status: 'COMPLETED', bytes: 123, contents_verified: false },
  } } as AgentToolCallView;
  assert.equal(webActivity(download)?.detail, 'localhost · 已下载 123 字节');
  assert.ok(!activityToolDescription(download).includes('验证通过'));
  const failed = { ...download, status: 'FAILED', receipt: { success: false, error_code: 'BROWSER_DOWNLOAD_TOO_LARGE' } } as AgentToolCallView;
  assert.ok(!activityToolDescription(failed).includes('已下载'));
  assert.match(activityToolIssue(failed)!, /16 MiB.*未保留/);
  assert.match(activityToolIssue({ ...download, receipt: { success: true, download_notice: { error_code: 'BROWSER_DOWNLOAD_NOT_ARMED' } } })!, /尚未保存文件/);
});
