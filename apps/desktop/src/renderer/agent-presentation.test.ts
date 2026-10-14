import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentEventView, AgentRunView, AgentToolCallView } from '@fielora/contracts';
import { agentActiveDurationMs, agentModelIsActive, agentPausePresentation, agentPendingChecks, agentCompletionTimeLabel, agentOpeningNarrative, agentRequestKind, agentResultMarkdown, agentTerminalBody, agentTerminalTitle, approvalActionLabel, buildAgentPresentation, buildAgentResultViewModel, stripTerminalHeading } from './agent-presentation.ts';

test('result presentation removes only redundant matching status headings and preserves authored content', () => {
  const body = '任务已经停止；修改仍保留。\n\n[查看文件](./report.md)\n\n## 尚待完成\n\n- 运行验证';
  assert.equal(agentResultMarkdown('CANCELLED', `## 已停止\n\n${body}`), body);
  assert.equal(agentResultMarkdown('COMPLETED', `## 选型结论\n\n${body}`), `## 选型结论\n\n${body}`);
  assert.equal(agentResultMarkdown('FAILED', `## 已完成\n\n${body}`), `## 已完成\n\n${body}`, 'Do not hide a conflicting model claim');
  assert.equal(agentResultMarkdown('CANCELLED', '## 已停止\n'), '## 已停止\n', 'Never turn a heading-only legacy result into empty content');
});

function run(status: AgentRunView['status'], errorCode: string | null = null): AgentRunView {
  return {
    id: 'run-1', field_id: 'field-1', conversation_id: 'conversation-1', provider_config_id: 'provider-1',
    model_id: 'model', task: 'task', permission: 'REVIEW_CHANGES', status, current_step: 2, max_steps: 24,
    next_sequence: 8, error_code: errorCode, created_at: 1_000, updated_at: 6_000,
    finished_at: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? 6_000 : null,
  };
}

function tool(overrides: Partial<AgentToolCallView>): AgentToolCallView {
  return {
    id: 'tool-1', run_id: 'run-1', name: 'read_file', effect: 'OBSERVE', status: 'COMPLETED', policy_decision: 'ALLOW',
    arguments: { path: 'src/app.ts' }, receipt: null, error_code: null, created_at: 2_000, updated_at: 3_000,
    ...overrides,
  };
}

test('completion timestamp uses stable local date and distinguishes incomplete terminal work', () => {
  const timestamp = new Date(2026, 7, 25, 14, 3, 7).getTime();
  assert.equal(agentCompletionTimeLabel(timestamp), '完成于 2026/08/25 14:03:07');
  assert.equal(agentCompletionTimeLabel(timestamp, false), '结束于 2026/08/25 14:03:07');
  assert.equal(agentCompletionTimeLabel(Number.NaN), '');
});

function phaseEvent(activePhase: 'LOCATE' | 'EDIT' | 'VERIFY' | 'FINALIZE', phases: Record<string, string>, fact: Record<string, unknown> = {}): AgentEventView {
  return { id: 'event-phase', run_id: 'run-1', sequence: 7, schema_version: 1, kind: 'PHASE_CHANGED', payload: { active_phase: activePhase, phases, fact }, created_at: 4_000 };
}

test('running work is translated into a human work narrative', () => {
  const presentation = buildAgentPresentation(run('RUNNING'), [], [tool({ name: 'replace_text', effect: 'WORKSPACE_WRITE', status: 'RUNNING' })], 5_000);
  assert.equal(presentation.headline, '正在修改项目');
  assert.match(presentation.narrative, /确认修改范围/);
  assert.equal(presentation.phases.find((phase) => phase.id === 'MODIFY')?.state, 'active');
  assert.equal(presentation.phases.length, 5);
  assert.equal(presentation.activeStep, 3);
});

test('completed work summarizes files and verification without exposing runtime codes', () => {
  const presentation = buildAgentPresentation(run('COMPLETED'), [], [
    tool({ id: 'write-1', name: 'replace_text', effect: 'WORKSPACE_WRITE', arguments: { path: 'src/app.ts' } }),
    tool({ id: 'test-1', name: 'run_command', effect: 'PROCESS', arguments: { program: 'pnpm', argv: ['test'] }, receipt: { verification_eligible: true, success: true } }),
  ]);
  assert.equal(presentation.headline, '已经完成');
  assert.equal(presentation.changedFiles, 1);
  assert.equal(presentation.passedVerifications, 1);
  assert.deepEqual(presentation.summary, ['5 秒', '1 个文件修改', '1 项验证通过']);
  assert.equal(presentation.phases.at(-1)?.label, '核对修改与验证结果');
  assert.equal(presentation.phases.at(-1)?.state, 'completed');
});

test('failure explains impact in plain language while technical codes stay out of the narrative', () => {
  const presentation = buildAgentPresentation(run('FAILED', 'PROVIDER_PROTOCOL_ERROR'), [], []);
  assert.equal(presentation.headline, '这次没有完成');
  assert.match(presentation.narrative, /已执行的操作保留/);
  assert.doesNotMatch(presentation.narrative, /项目文件没有发生变化/);
  assert.doesNotMatch(presentation.narrative, /PROVIDER_PROTOCOL_ERROR/);
});

test('response failures give a cause without inventing changes or retry success', () => {
  const legacy = agentPausePresentation(run('PAUSED', 'PROVIDER_PROTOCOL_ERROR'));
  assert.match(legacy.reason, /无法确定具体原因/);
  assert.doesNotMatch(legacy.reason, /已有修改|已恢复/);
  const limit = agentPausePresentation(run('PAUSED', 'PROVIDER_OUTPUT_LIMIT'));
  assert.match(limit.reason, /长度上限/);
  assert.match(limit.reason, /已有进展会保留/);
  assert.equal(limit.action, '继续工作');
  for (const [code, cause] of [
    ['PROVIDER_INVALID_TOOL_CALL', /工具调用未通过校验/],
    ['PROVIDER_STREAM_INCOMPLETE', /结束标记/],
    ['PROVIDER_STREAM_INTERRUPTED', /连接中断/],
    ['PROVIDER_INVALID_RESPONSE', /数据格式/],
    ['PROVIDER_STREAM_ERROR', /回复过程中返回了错误/],
    ['PROVIDER_CONTENT_FILTERED', /拦截/],
    ['PROVIDER_EMPTY_RESPONSE', /没有返回可用/],
  ] as const) {
    assert.match(agentPausePresentation(run('PAUSED', code)).reason, cause);
    assert.match(buildAgentPresentation(run('FAILED', code), [], []).narrative, cause);
  }
});

test('model HTTP pause uses current same-run facts and keeps legacy uncertainty', () => {
  const paused = run('PAUSED', 'PROVIDER_RATE_LIMITED');
  const failure = (payload: Record<string, unknown>, overrides = {}) => ({
    id: 'failure', run_id: paused.id, sequence: 7, kind: 'MODEL_FAILED', created_at: 5_000,
    payload: { step: paused.current_step, error_code: paused.error_code, http_status: 429, response_diagnostics: { retry_after_seconds: 90 }, ...payload }, ...overrides,
  }) as AgentEventView;
  const reason = agentPausePresentation(paused, [failure({})]).reason;
  assert.match(reason, /返回限流响应/);
  assert.match(reason, /90 秒/);
  assert.match(reason, /不能据此判断额度/);
  for (const events of [[], [failure({ step: 1 })], [failure({}, { run_id: 'other' })]]) {
    const old = agentPausePresentation(paused, events).reason;
    assert.match(old, /旧版.*合并记录/);
    assert.doesNotMatch(old, /90 秒/);
  }
  for (const retry_after_seconds of ['private-secret', -1, 1.5, Number.MAX_VALUE]) {
    const invalid = agentPausePresentation(paused, [failure({ response_diagnostics: { retry_after_seconds } })]).reason;
    assert.match(invalid, /未提供可用的重试间隔/);
    assert.doesNotMatch(invalid, /private-secret/);
  }
  const timeout = agentPausePresentation(run('PAUSED', 'PROVIDER_REQUEST_TIMEOUT')).reason;
  assert.match(timeout, /请求超时/);
  assert.doesNotMatch(timeout, /限流/);
});

test('step-limit failure stays concise and counts every file in a batch patch', () => {
  const presentation = buildAgentPresentation(run('FAILED', 'AGENT_MAX_STEPS_REACHED'), [], [
    tool({
      name: 'apply_patches', effect: 'WORKSPACE_WRITE', status: 'COMPLETED', arguments: {
        patches: [
          { path: 'src/one.html', expected_sha256: 'one', line_edits: [] },
          { path: 'src/two.ts', expected_sha256: 'two', replacements: [] },
        ],
      },
    }),
  ]);
  assert.equal(presentation.changedFiles, 2);
  assert.deepEqual(presentation.summary, ['5 秒', '2 个文件修改']);
  assert.match(presentation.narrative, /步骤上限/);
  assert.doesNotMatch(presentation.summary.join(' '), /项操作/);
});

test('approval labels describe the concrete effect', () => {
  assert.equal(approvalActionLabel(tool({ effect: 'WORKSPACE_WRITE' })), '允许修改');
  assert.equal(approvalActionLabel(tool({ effect: 'PROCESS' })), '允许运行');
  assert.equal(approvalActionLabel(tool({ effect: 'DESTRUCTIVE' })), '允许删除');
});

test('canonical phase state is the only source for FAST_EDIT presentation', () => {
  const presentation = buildAgentPresentation(run('RUNNING'), [phaseEvent('VERIFY', {
    LOCATE: 'SUCCEEDED', EDIT: 'SUCCEEDED', VERIFY: 'RUNNING', FINALIZE: 'NOT_STARTED',
  }, { narrative_key: 'VERIFYING', target_entity: '进行阶段', changed_files: 3 })], [
    tool({ name: 'read_file', effect: 'OBSERVE', status: 'RUNNING' }),
    tool({ id: 'write', name: 'apply_patches', effect: 'WORKSPACE_WRITE', status: 'COMPLETED', arguments: { patches: [{ path: 'a.ts' }] } }),
  ]);
  assert.equal(presentation.canonicalPhase, true);
  assert.equal(presentation.headline, '正在验证修改');
  assert.match(presentation.narrative, /没有残留/);
  assert.deepEqual(presentation.phases.map((phase) => phase.id), ['INSPECT', 'MODIFY', 'VERIFY', 'FINISH']);
  assert.equal(presentation.phases.find((phase) => phase.id === 'MODIFY')?.state, 'completed');
  assert.equal(presentation.phases.find((phase) => phase.id === 'VERIFY')?.state, 'active');
  assert.equal(presentation.phases.length, 4);
});

test('failed canonical edit blocks verification instead of presenting it as completed', () => {
  const presentation = buildAgentPresentation(run('FAILED', 'FAST_EDIT_PATCH_RETRY_EXHAUSTED'), [phaseEvent('FINALIZE', {
    LOCATE: 'SUCCEEDED', EDIT: 'FAILED', VERIFY: 'BLOCKED', FINALIZE: 'RUNNING',
  })], [tool({ name: 'apply_patches', effect: 'WORKSPACE_WRITE', status: 'FAILED' })]);
  assert.equal(presentation.phases.find((phase) => phase.id === 'MODIFY')?.state, 'failed');
  assert.equal(presentation.phases.find((phase) => phase.id === 'VERIFY')?.state, 'blocked');
  assert.notEqual(presentation.phases.find((phase) => phase.id === 'VERIFY')?.state, 'completed');
});

test('already satisfied is a completed outcome with edit and verify skipped, not a failed workflow', () => {
  const presentation = buildAgentPresentation(run('COMPLETED'), [phaseEvent('FINALIZE', {
    LOCATE: 'SUCCEEDED', EDIT: 'SKIPPED', VERIFY: 'SKIPPED', FINALIZE: 'SUCCEEDED',
  }, { narrative_key: 'ALREADY_SATISFIED', target_entity: '进行阶段', changed_files: 0, no_change: true, evidence_files: 2 })], []);
  assert.equal(presentation.headline, '目标状态已经满足');
  assert.deepEqual(presentation.phases.map((phase) => [phase.id, phase.state]), [
    ['INSPECT', 'completed'], ['MODIFY', 'skipped'], ['VERIFY', 'skipped'], ['FINISH', 'completed'],
  ]);
});

test('terminal result presentation replaces persisted legacy headings without losing useful body content', () => {
  const failed = buildAgentPresentation(run('FAILED', 'PROVIDER_PROTOCOL_ERROR'), [], []);
  assert.equal(agentTerminalTitle('FAILED', failed), '这次没有完成');
  assert.match(agentTerminalBody('FAILED', '## 模型响应失败\n\n旧的持久化说明', failed), /模型服务没有接受/);
  assert.doesNotMatch(agentTerminalBody('FAILED', '## 模型响应失败\n\n旧的持久化说明', failed), /模型响应失败/);
  assert.equal(stripTerminalHeading('## 已完成\n\n保留这段结果'), '保留这段结果');
});

test('terminal result keeps natural prose and drops generated report scaffolding', () => {
  const completed = buildAgentPresentation(run('COMPLETED'), [], [
    tool({ name: 'replace_text', effect: 'WORKSPACE_WRITE', arguments: { path: 'src/form.ts' } }),
  ]);
  const body = agentTerminalBody('COMPLETED', [
    '## 已完成',
    '',
    '“用户”字段现在允许为空，其他表单校验保持不变。',
    '',
    '- 修改：1 个文件',
    '',
    '**验证**：通过',
  ].join('\n'), completed);
  assert.equal(agentTerminalTitle('COMPLETED', completed), '已完成修改');
  assert.equal(body, '“用户”字段现在允许为空，其他表单校验保持不变。');
  assert.doesNotMatch(body, /修改：|验证/);

  const reportOnly = agentTerminalBody('COMPLETED', [
    '## 任务完成',
    '',
    '**变更：**',
    '- ✅ 创建 `acceptance.js`',
    '',
    '**验证：**',
    '- ✅ `node --check acceptance.js` 通过',
  ].join('\n'), completed);
  assert.equal(reportOnly, completed.narrative);
  assert.doesNotMatch(reportOnly, /变更：|验证：|✅/);
});

test('structured terminal result owns title, evidence and hierarchy independently of model Markdown', () => {
  const completed = buildAgentPresentation(run('COMPLETED'), [], [
    tool({ name: 'create_file', effect: 'WORKSPACE_WRITE', arguments: { path: 'src/new.ts', content: 'export {}' } }),
    tool({ id: 'verify', name: 'run_command', effect: 'PROCESS', receipt: { verification_eligible: true, success: true } }),
  ]);
  const result = buildAgentResultViewModel('COMPLETED', '## 超大标题\n\n**已创建目标文件。**\n\n- 模型自定义报表', completed);
  assert.equal(result.title, '已经创建文件');
  assert.equal(result.detail, '已创建目标文件。');
  assert.deepEqual(result.evidence, ['1 个文件新增', '已记录检查通过 · 覆盖范围未确认']);
  assert.doesNotMatch(result.detail, /##|\*\*|模型自定义报表/);
});

test('generic action plan stays stable as tools arrive and contains three to six user-facing steps', () => {
  const before = buildAgentPresentation(run('RUNNING'), [], [], 2_000);
  const after = buildAgentPresentation(run('RUNNING'), [], [
    tool({ name: 'search_text', effect: 'OBSERVE', status: 'COMPLETED' }),
    tool({ id: 'write', name: 'replace_text', effect: 'WORKSPACE_WRITE', status: 'RUNNING' }),
  ], 4_000);
  assert.deepEqual(before.phases.map((phase) => [phase.id, phase.label]), after.phases.map((phase) => [phase.id, phase.label]));
  assert.ok(before.phases.length >= 3 && before.phases.length <= 6);
});

test('action plan names the real project file and verification command without another model turn', () => {
  const task = '在当前 web Project 根目录新建 fielora-plan-review-polish.js，内容仅为 export const fieloraPlanReview = true;，不要修改其他文件；完成后运行 node --check fielora-plan-review-polish.js 验证。';
  const specificRun = { ...run('RUNNING'), task };
  const before = buildAgentPresentation(specificRun, [], [], 2_000);
  const after = buildAgentPresentation(specificRun, [], [
    tool({ name: 'stat_path', effect: 'OBSERVE', arguments: { path: 'fielora-plan-review-polish.js' } }),
    tool({ id: 'write', name: 'create_file', effect: 'WORKSPACE_WRITE', status: 'RUNNING', arguments: { path: 'fielora-plan-review-polish.js', content: 'export const fieloraPlanReview = true;' } }),
  ], 4_000);
  assert.deepEqual(before.phases.map((phase) => phase.label), [
    '定位 web 项目根目录',
    '确认没有同名 fielora-plan-review-polish.js',
    '创建 fielora-plan-review-polish.js',
    '运行 node --check fielora-plan-review-polish.js',
    '核对只新增 1 个文件',
  ]);
  assert.deepEqual(after.phases.map((phase) => phase.label), before.phases.map((phase) => phase.label));
});

test('structured result uses exact mutation and verification facts instead of generic completion prose', () => {
  const completed = buildAgentPresentation({ ...run('COMPLETED'), task: '新建 acceptance.js 后运行 node --check acceptance.js' }, [], [
    tool({ name: 'create_file', effect: 'WORKSPACE_WRITE', arguments: { path: 'acceptance.js', content: 'export const accepted = true;' } }),
    tool({ id: 'verify', name: 'run_command', effect: 'PROCESS', arguments: { program: 'node', argv: ['--check', 'acceptance.js'] }, receipt: { verification_eligible: true, success: true } }),
  ]);
  const result = buildAgentResultViewModel('COMPLETED', '## 已完成\n\n任务已经完成。', completed, [
    tool({ name: 'create_file', effect: 'WORKSPACE_WRITE', arguments: { path: 'acceptance.js', content: 'export const accepted = true;' } }),
    tool({ id: 'verify', name: 'run_command', effect: 'PROCESS', arguments: { program: 'node', argv: ['--check', 'acceptance.js'] }, receipt: { verification_eligible: true, success: true } }),
  ]);
  assert.equal(result.title, '已创建 acceptance.js');
  assert.equal(result.detail, '文件内容为 `export const accepted = true;`，并已通过 `node --check acceptance.js`；没有修改其他文件。');
  assert.doesNotMatch(result.detail, /任务已经完成|变更：|验证：/);
});

test('verified optional finalization failure projects as success with warning', () => {
  const completed = buildAgentPresentation(run('COMPLETED'), [{
    id: 'completed-warning', run_id: 'run-1', sequence: 9, schema_version: 1, kind: 'RUN_COMPLETED',
    payload: { outcome: 'SUCCESS_WITH_WARNING', goal_satisfied: true, verification_passed: true }, created_at: 6_000,
  }], [
    tool({ name: 'replace_text', effect: 'WORKSPACE_WRITE', arguments: { path: 'src/form.ts' } }),
    tool({ id: 'verify', name: 'run_command', effect: 'PROCESS', receipt: { verification_eligible: true, success: true } }),
  ]);
  assert.equal(completed.outcome, 'SUCCESS_WITH_WARNING');
  assert.equal(agentTerminalTitle('COMPLETED', completed), '已完成修改');
});

test('running presentation supplies one natural opening narrative', () => {
  const presentation = buildAgentPresentation(run('RUNNING'), [], [tool({ name: 'search_text', effect: 'OBSERVE', status: 'RUNNING' })], 5_000);
  assert.match(agentOpeningNarrative(presentation), /^我/);
  assert.doesNotMatch(agentOpeningNarrative(presentation), /已处理|Tool|Event/);
});

test('explicit answer-only requests bypass the action lifecycle while real work keeps it', () => {
  assert.equal(agentRequestKind('请用一句话概括当前 web Project 的用途和主要前端技术栈；只回答，不修改文件。'), 'ANSWER');
  assert.equal(agentRequestKind('解释一下这个 Project 的主要技术栈'), 'ANSWER');
  assert.equal(agentRequestKind('把用户字段改成非必填并运行验证'), 'ACTION');
  assert.equal(agentRequestKind('只修改三处注释文本，不要修改其他文件'), 'ACTION');
  assert.equal(agentRequestKind('搜索并检查这个页面的实现'), 'ACTION');
});

test('budget pauses expose the explicit allowance and do not promise completion', () => {
  const paused = { ...run('PAUSED', 'AGENT_BUDGET_EXHAUSTED'), current_step: 64, max_steps: 64 };
  assert.match(agentPausePresentation(paused).reason, /任务尚未完成/);
  assert.equal(agentPausePresentation(paused).action, '继续工作（增加 24 步）');
  assert.equal(agentPausePresentation({ ...paused, current_step: 4096, max_steps: 4096 }).canResume, false);
  assert.equal(agentPausePresentation(run('PAUSED')).action, '继续工作');
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_VERIFICATION_REQUIRED')).reason, /未解决项/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_OUTCOME_EVIDENCE_INVALID')).reason, /完成依据未通过校验/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_OUTCOME_QUOTE_REQUIRED')).reason, /请求引用与当前任务不匹配/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_OUTCOME_ARGUMENTS_INVALID')).reason, /具体字段原因/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_TIME_BUDGET_EXHAUSTED')).reason, /60 分钟/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_REPEATED_ACTIONS')).reason, /重复相同操作/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_BROWSER_LOGIN_REQUIRED')).reason, /右侧浏览器完成登录/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_BROWSER_OUTCOME_REVIEW_REQUIRED')).reason, /没有重放操作/);
  assert.match(agentPausePresentation(run('PAUSED', 'AGENT_COMPUTER_OUTCOME_REVIEW_REQUIRED')).reason, /部分输入可能已经发生.*没有重放操作.*核对应用中的实际状态/);
});

test('paused time does not accrue as execution time, including after continuation', () => {
  const paused = { ...run('PAUSED'), updated_at: 6000 };
  const events: AgentEventView[] = [{ id: 'pause', run_id: paused.id, sequence: 1, schema_version: 1, kind: 'RUN_PAUSED', payload: {}, created_at: 6000 }];
  assert.equal(buildAgentPresentation(paused, events, [], 6000).elapsed, buildAgentPresentation(paused, events, [], 66000).elapsed);
  events.push({ id: 'resume', run_id: paused.id, sequence: 2, schema_version: 1, kind: 'RUN_RESUMED', payload: {}, created_at: 66000 });
  assert.equal(buildAgentPresentation({ ...paused, status: 'RUNNING' }, events, [], 67000).elapsed, buildAgentPresentation(run('RUNNING'), [], [], 7000).elapsed);
});

test('approval waits freeze immediately and are excluded after resolution or cancellation', () => {
  const event = (sequence: number, kind: AgentEventView['kind'], created_at: number): AgentEventView => ({id:`e-${sequence}`,run_id:'run-1',sequence,schema_version:1,kind,payload:{},created_at});
  const waiting = run('WAITING_APPROVAL');
  const events = [event(1, 'APPROVAL_REQUESTED', 6000)];
  assert.equal(agentActiveDurationMs(waiting, events, 86_400_000), 5000);
  assert.equal(agentActiveDurationMs(waiting, [], 86_400_000), 5000, 'Partial loading must not keep ticking');
  assert.equal(agentActiveDurationMs({...waiting, status:'CANCELLED', finished_at:66000}, events), 5000);
  events.push(event(2,'APPROVAL_RESOLVED',66000));
  assert.equal(agentActiveDurationMs({...waiting,status:'RUNNING'}, events, 68000), 7000);
  events.push(event(3,'APPROVAL_REQUESTED',68000),event(4,'RUN_PAUSED',69000),event(5,'APPROVAL_RESOLVED',70000),event(6,'RUN_RESUMED',80000));
  assert.equal(agentActiveDurationMs({...waiting,status:'COMPLETED',finished_at:82000}, events.reverse()), 9000, 'Overlapping waits count once; ledger sequence wins over arrival order');
});

test('reported overnight Run totals 10m42s rather than a day of execution', () => {
  const current = {...run('WAITING_APPROVAL'),created_at:1791121039561,updated_at:1791126984955};
  const events: AgentEventView[] = [
    ['RUN_PAUSED',1791121276881],['RUN_RESUMED',1791126580249],['APPROVAL_REQUESTED',1791126984955],
  ].map(([kind,created_at],i)=>({id:`prod-shape-${i}`,run_id:current.id,sequence:i+1,schema_version:1,kind:kind as AgentEventView['kind'],payload:{},created_at:created_at as number}));
  assert.equal(agentActiveDurationMs(current, events, current.updated_at+24*60*60*1000), 642026);
  assert.equal(buildAgentPresentation(current, events, [], current.updated_at+24*60*60*1000).elapsed, '10 分 42 秒');
});


test('current assessment overrides historical passes and preserves unknown coverage', () => {
  const paused = run('PAUSED', 'AGENT_VERIFICATION_REQUIRED');
  const events: AgentEventView[] = [{ id:'assessment', run_id:paused.id, sequence:20, schema_version:1, kind:'CHECKPOINT_CREATED', created_at:6000,
    payload:{kind:'GENERAL_WORK_STATE_V1',current_work:{requirement_coverage:'UNKNOWN',unresolved_checks:[],verification:{passed:false,blockers:[{reason:'STALE_FAILED',details:{program:'python3',argv:['-m','unittest','specific_test']}}]}}} }];
  const tools = [tool({ name:'run_command',effect:'PROCESS',receipt:{verification_eligible:true,success:true} })];
  assert.equal(buildAgentPresentation(paused,events,tools).passedVerifications,0,'An old green receipt cannot override a current blocker');
  assert.deepEqual(agentPendingChecks(paused,events),['先前失败的检查需要重验：-m unittest specific_test']);
  assert.deepEqual(agentPendingChecks({...paused,error_code:'AGENT_TIME_BUDGET_EXHAUSTED'},events),agentPendingChecks(paused,events),'Budget pauses retain the actual unresolved check');
  const scratchEvents: AgentEventView[] = [{...events[0]!,payload:{kind:'GENERAL_WORK_STATE_V1',current_work:{verification:{passed:false,blockers:[{reason:'FAILED',details:{argv:['-m','unittest','specific_test'],display_directory:'_scratch'}}]}}}}];
  assert.deepEqual(agentPendingChecks(paused,scratchEvents),['检查未通过（_scratch）：-m unittest specific_test'],'Same command in an isolated copy has a visible target');
  events.push({id:'terminal',run_id:paused.id,sequence:21,schema_version:1,kind:'RUN_COMPLETED',created_at:7000,payload:{goal_satisfied:null,requirement_coverage:'UNKNOWN',acceptance:{requirement_coverage:'UNKNOWN',verification:{passed:true,checks:[{state:'PASSED'},{state:'RETIRED_TARGET'}]}}}});
  const presentation=buildAgentPresentation(run('COMPLETED'),events,tools);
  assert.equal(presentation.passedVerifications,1);
  const result = buildAgentResultViewModel('COMPLETED','所有需求全部验证通过，未完成项无。',presentation,tools);
  assert.equal(result.verificationEvidence?.label, '已记录检查通过 · 需求覆盖未确认');
  assert.match(result.verificationEvidence?.detail ?? '', /完成结论由模型提供/);
  assert.deepEqual(result.evidence, [], 'No duplicate verification badge below the report');
});

test('result evidence uses the current Run assessment and keeps target states after reload', () => {
  const current = run('COMPLETED');
  const event: AgentEventView = {id:'verified',run_id:current.id,sequence:12,schema_version:1,kind:'RUN_COMPLETED',created_at:7000,
    payload:{acceptance:{requirement_coverage:'UNKNOWN',verification:{passed:false,checks:[
      {tool_call_id:'a',program:'python3',argv:['-m','unittest','test_detector'],display_directory:'.',state:'STALE_FAILED'},
      {tool_call_id:'b',program:'python3',argv:['-m','unittest','test_detector'],display_directory:'scratch',state:'PASSED'},
      {tool_call_id:'c',program:3,argv:[],state:'PASSED'},
    ]}}}};
  const otherRun = {...event, id:'foreign', run_id:'another-run', sequence:99, payload:{acceptance:{verification:{passed:true}}}};
  const presentation = buildAgentPresentation(current, JSON.parse(JSON.stringify([otherRun,event])), []);
  assert.equal(presentation.passedVerifications,0);
  assert.equal(presentation.verificationEvidence?.label,'检查尚未通过 · 查看执行结果');
  assert.deepEqual(presentation.verificationEvidence?.checks,[
    {id:'a',command:'python3 -m unittest test_detector',state:'失败后待重验'},
    {id:'b',command:'python3 -m unittest test_detector（scratch）',state:'通过'},
  ]);
  const noChecks = {...event, payload:{acceptance:{verification:{passed:false,checks:[],blockers:[]}}}};
  assert.equal(buildAgentPresentation(current,[noChecks],[]).verificationEvidence,undefined,
    'An answer without a required or recorded check must not acquire a failed-check notice');
});

test('thinking tracks actual model intervals and never fills tool or failure gaps', () => {
  const event = (sequence: number, kind: AgentEventView['kind']): AgentEventView => ({ id: `event-${sequence}`, run_id:'run-1', sequence, schema_version:1, kind, payload:{}, created_at:sequence*1000 });
  const start=event(1,'MODEL_STARTED'), end=event(2,'MODEL_COMPLETED');
  assert.equal(agentModelIsActive([], []), false);
  assert.equal(agentModelIsActive([event(1,'STEP_STARTED')], []), false);
  assert.equal(agentModelIsActive([start,event(2,'MODEL_TEXT_DELTA')], []), true);
  assert.equal(agentModelIsActive([end,start], []), false, 'sequence, not arrival order');
  for (const kind of ['TOOL_PROPOSED','TOOL_STARTED','TOOL_PROGRESS','TOOL_COMPLETED','TOOL_FAILED','MODEL_FAILED','APPROVAL_REQUESTED','RUN_PAUSED','RUN_RESUMED','RECOVERY_STARTED'] as const) {
    assert.equal(agentModelIsActive([start,event(3,kind)], []), false, kind);
  }
  for (const status of ['PROPOSED','RUNNING','WAITING_APPROVAL'] as const) assert.equal(agentModelIsActive([start],[tool({status})]),false);
  assert.equal(agentModelIsActive([start,end,event(3,'TOOL_FAILED'),event(4,'MODEL_STARTED')], [tool({status:'FAILED'})]),true,'fresh model invocation after a tool failure can think again');
});


test('pause lists only the latest unresolved checks without reviving old hypotheses', () => {
  const paused = run('PAUSED', 'AGENT_ACCEPTANCE_SCOPE_REQUIRED');
  const checkpoint = (sequence: number, unresolved: unknown[]): AgentEventView => ({
    id: `e-${sequence}`, run_id: paused.id, sequence, schema_version: 1, kind: 'CHECKPOINT_CREATED', created_at: 1,
    payload: { kind: 'GENERAL_WORK_STATE_V1', current_work: { unresolved_checks: unresolved } },
  });
  const stale = checkpoint(10, [{expected: '重启后仍保留冲突', check: {status: 'stale'}}]);
  assert.deepEqual(agentPendingChecks(paused, [stale]), ['重启后仍保留冲突（输入已变化）']);
  assert.deepEqual(agentPendingChecks(paused, [checkpoint(11, []), stale]), []);
  assert.deepEqual(agentPendingChecks({...paused, status: 'COMPLETED'}, [stale]), []);
  assert.deepEqual(agentPendingChecks(paused, [{...stale, run_id: 'another-run'}]), []);
  assert.match(agentPausePresentation(paused).reason, /仍有已记录的检查未解决/);
});
