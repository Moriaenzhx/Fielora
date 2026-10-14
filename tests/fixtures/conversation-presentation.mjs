import { randomUUID } from 'node:crypto';

// Presentation replay only: writes the caller's isolated test ledger. These
// records exercise Core projections and are not evidence of actual tool work.
export const fixtureId = () => { const id = randomUUID(); return id.slice(0, 14) + '7' + id.slice(15); };
export const narrativeMarkers = Array.from({ length: 20 }, (_, index) => `检查记录 ${String(index + 1).padStart(2, '0')}`);

export function seedPresentationRun(db, ids, kind, origin) {
  const run = fixtureId(), start = Date.now() - 1_800_000;
  const status = kind === 'approval' ? 'WAITING_APPROVAL' : kind === 'working' ? 'RUNNING' : kind === 'sources' ? 'PAUSED' : kind === 'failed' ? 'FAILED' : kind === 'cancelled' ? 'CANCELLED' : 'COMPLETED';
  const error = status === 'FAILED' ? 'AGENT_MAX_STEPS_REACHED' : status === 'CANCELLED' ? 'AGENT_CANCELLED' : null;
  db.prepare(`INSERT INTO agent_runs(id,field_id,conversation_id,provider_config_id,model_id,task,permission,status,current_step,max_steps,next_sequence,error_code,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(run, ids.field, ids.conversation, ids.provider, 'presentation-replay', '核对工作室资料、项目实现与验证结果', 'FULL_CONTROL', status, 40, status === 'FAILED' ? 40 : 4096, 1, error, start, start + 100_000, ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? start + 100_000 : null);
  let sequence = 0;
  const toolIds = [], narrativeSequences = [];
  const event = (eventKind, payload = {}) => {
    const seq = ++sequence;
    db.prepare('INSERT INTO agent_events VALUES(?,?,?,?,?,?,?)').run(fixtureId(), run, seq, 1, eventKind, JSON.stringify(payload), start + seq * 100);
    return seq;
  };
  const narrative = text => narrativeSequences.push(event('ASSISTANT_NARRATIVE', { step: narrativeSequences.length + 1, text }));
  const tool = (name, args, receipt, toolStatus = 'COMPLETED', toolError = null) => {
    const id = fixtureId(), pending = ['RUNNING', 'WAITING_APPROVAL'].includes(toolStatus);
    db.prepare('INSERT INTO agent_tool_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, run, name, name === 'run_command' ? 'PROCESS' : name.startsWith('web.') ? 'NETWORK' : 'OBSERVE', toolStatus, toolStatus === 'WAITING_APPROVAL' ? 'ASK' : 'ALLOW', JSON.stringify(args), receipt === null ? null : JSON.stringify(receipt), toolError, start + sequence * 100, start + (sequence + 2) * 100, pending ? null : start + (sequence + 2) * 100);
    event('TOOL_PROPOSED', { tool_call_id: id, name });
    if (toolStatus !== 'WAITING_APPROVAL') event('TOOL_STARTED', { tool_call_id: id });
    if (!pending) event(toolStatus === 'FAILED' ? 'TOOL_FAILED' : 'TOOL_COMPLETED', { tool_call_id: id });
    toolIds.push(id);
    return id;
  };
  event('RUN_CREATED', { user_message_id: ids.user });
  event('RUN_STARTED', { task_class: 'GENERAL' });
  let approvalId, runningId;
  if (kind === 'working') {
    // An unresolved checkpoint is deliberately old in the replay to exercise
    // the disclosure boundary; there is no concurrently running model here.
    event('CHECKPOINT_CREATED', { kind: 'GENERAL_CONTEXT_REDUCTION_STARTED', before_bytes: 90000 });
    narrative('正在整理较早的上下文，保留当前工作目标和近期证据。');
  }
  if (kind !== 'sources') {
    for (const [index, marker] of narrativeMarkers.entries()) {
      narrative(`${marker}：${['读取项目说明并核对已有实现。', '确认数据与页面中的对应关系，避免把推测写成结果。', '记录本轮执行结果，并继续核对剩余检查。'][index % 3]}`);
      if (index === 2 || index === 5) {
        tool('run_command', { program: 'python3', argv: ['-m', 'unittest', index === 2 ? 'test_import' : 'test_summary'], cwd: '.' }, { kind: 'COMMAND', success: false, exit_code: 1, stderr: index === 2 ? 'ModuleNotFoundError: fixture dependency unavailable' : 'AssertionError: expected 15000, observed 12000', duration_ms: 24 }, 'FAILED', 'AGENT_PROCESS_FAILED');
      } else {
        tool('read_file', { path: `src/review-${String(index + 1).padStart(2, '0')}.ts` }, { kind: 'FILE_READ', bytes: 120 });
      }
    }
  }
  const sources = Array.from({ length: 5 }, (_, index) => ({
    title: ['官方说明与功能边界', '导出格式与数据可携性', '团队协作与权限', '本地文件与版本记录', '价格说明与适用范围'][index],
    url: `${origin}/source/${index + 1}`,
    published_at: '2026-10-13',
    snippet: `来源 ${index + 1} 的已保存摘录：仅代表这次实际保存的文本。` + '需要结合完整页面判断适用条件。'.repeat(10) + ` 摘录末尾 ${index + 1}。`,
    snippet_truncated: true,
  }));
  let searchId, fetchId;
  if (kind === 'sources' || kind === 'completed') {
    narrative('资料已检索，接下来逐项核对原文。搜索命中与实际返回正文分开标注。');
    searchId = tool('web.search', { query: '工作室项目管理工具 导出 权限 官方说明' }, { kind: 'WEB_SEARCH', success: true, provider_id: 'exa.search.v1', retrieved_at: start + 2000, result_count: 5, sources });
    narrative('已经读取第一条来源，其余来源仍需按需要继续核对。');
    fetchId = tool('web.fetch', { url: sources[0].url }, { kind: 'WEB_FETCH', success: true, requested_url: sources[0].url, final_url: sources[0].url, title: sources[0].title, text_returned_chars: 3240, excerpt: '这是页面中保存的正文摘录。' + '正文内容需要结合上下文理解。'.repeat(20) + ' 正文摘录末尾。', excerpt_truncated: true, truncated: true, retrieved_at: start + 3000 });
  }
  if (kind === 'approval') {
    narrative('下一步需要运行安装命令。请检查命令与范围，批准后才会执行。');
    const args = { program: 'python3', argv: ['-m', 'pip', 'install', '-r', 'requirements.txt'], cwd: '.' };
    const id = tool('run_command', args, null, 'WAITING_APPROVAL');
    approvalId = fixtureId();
    const created = start + (sequence + 1) * 100, nonce = randomUUID().replaceAll('-', '');
    db.prepare('INSERT INTO agent_approvals VALUES(?,?,?,?,?,?,?)').run(approvalId, run, id, null, nonce, created, null);
    event('APPROVAL_REQUESTED', { approval: { id: approvalId, run_id: run, tool_call_id: id, nonce, created_at: created, decision: null, resolved_at: null }, tool: { id, name: 'run_command', effect: 'PROCESS', arguments: args } });
  } else if (kind === 'working') {
    narrative('前面的失败仍需要核对，当前命令尚未返回结果。');
    runningId = tool('run_command', { program: 'python3', argv: ['-m', 'unittest', 'test_regression'], cwd: '.' }, null, 'RUNNING');
  } else if (kind === 'cancelled') {
    event('CHECKPOINT_CREATED', { kind: 'GENERAL_WORK_STATE_V1', current_work: { requirement_coverage: 'UNKNOWN', verification: {
      passed: false, checks: [{ tool_call_id: toolIds[5], program: 'python3', argv: ['-m', 'unittest', 'test_summary'], display_directory: '.', state: 'FAILED' }],
    } } });
    event('RUN_CANCELLED', { error_code: error });
  } else if (kind === 'sources') event('RUN_PAUSED', { reason: 'USER_PAUSE' });
  else event(status === 'FAILED' ? 'RUN_FAILED' : 'RUN_COMPLETED', status === 'FAILED' ? { error_code: error } : { completion_basis: 'UNVERIFIED' });
  db.prepare('UPDATE agent_runs SET next_sequence=? WHERE id=?').run(sequence + 1, run);
  return { ...ids, run, status, toolIds, narrativeSequences, searchId, fetchId, sources, approvalId, runningId };
}
