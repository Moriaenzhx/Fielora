import { killTestProcess, deleteTestCredential } from '../support/platform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..', '..');
const core = process.env.FIELORA_CORE_EXE
  ? path.resolve(process.env.FIELORA_CORE_EXE)
  : path.join(root, 'target', 'debug', (process.platform === 'win32' ? 'fielora-core.exe' : 'fielora-core'));

function request(child, id, method, params = {}, protocol = '1.0') {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params, _meta: { protocol, trace_id: randomUUID(), deadline_ms: 10000 } })}\n`);
}

function harness(dataDir) {
  const child = spawn(core, ['--development'], { detached: process.platform !== 'win32', env: { ...process.env, FIELORA_DATA_DIR: dataDir, FIELORA_E2E: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  const queue = [];
  const waiters = [];
  lines.on('line', (line) => {
    const value = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter(value); else queue.push(value);
  });
  return {
    child,
    send(id, method, params = {}, protocol) { request(child, id, method, params, protocol); },
    next() { if (queue.length) return Promise.resolve(queue.shift()); return new Promise((resolve) => waiters.push(resolve)); },
    async exit(timeout = 2000) {
      if (child.exitCode !== null) return child.exitCode;
      return Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Core did not exit')), timeout)),
      ]);
    },
  };
}

test('General Agent preserves work across budget pause and restart, recovers guarded edits, and refuses false completion', { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fielora-general-continuity-'));
  const projectRoot = path.join(dataDir, 'project');
  await mkdir(projectRoot);
  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = false;\r\n// original context\r\n');
  await writeFile(path.join(projectRoot, 'verify.cjs'), "require('node:assert/strict').equal(require('./login.js').ready, true);\n");
  await writeFile(path.join(projectRoot, 'evidence.txt'), Array.from({ length: 100 }, (_, index) => `Evidence line ${index + 1}`).join('\n'));
  assert.equal(spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['init'], { cwd: projectRoot, windowsHide: true }).status, 0);
  let h = harness(dataDir);
  let provider;
  t.after(async () => {
    if (h.child.exitCode === null) { killTestProcess(h.child.pid); await h.exit(); }
    if (provider) deleteTestCredential(provider.id);
    await rm(dataDir, { recursive: true, force: true });
  });
  await hello(h);
  async function call(method, params) {
    const id = randomUUID(); h.send(id, method, params);
    for (;;) { const value = await h.next(); if (value.id !== id) continue; assert.ok(value.result, JSON.stringify(value)); return value.result; }
  }
  async function settled(runId) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const run = await call('query.agent.get', { run_id: runId });
      if (['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('General Agent did not reach a bounded state');
  }
  provider = await call('command.provider.create_config', { provider_kind: 'OPENAI_COMPATIBLE', display_name: 'Continuity fixture', base_url: 'https://example.com/v1', default_model: '__fielora_agent_fixture__', custom_endpoint_acknowledged: true });
  provider = await call('command.provider.store_credential', { provider_config_id: provider.id, secret: `fixture-${randomUUID()}` });
  provider = await call('command.provider.update_model_runtime', {provider_config_id:provider.id,expected_provider_revision:provider.revision,expected_revision:0,settings:{reasoning:'PROVIDER_DEFAULT',max_output_tokens:2048}});
  const project = await call('command.project.create', { title: 'General Agent continuity', root_path: projectRoot, goal: null });
  async function start(task, maxSteps) {
    const conversation = await call('command.conversation.create', { field_id: project.field_id, title: task, provider_config_id: provider.id, model_id: provider.default_model });
    return call('command.agent.start', { field_id: project.field_id, conversation_id: conversation.id, provider_config_id: provider.id, model_id: provider.default_model, task, permission: 'FULL_CONTROL', max_steps: maxSteps });
  }
  const run = await start('FIELORA_AGENT_FIXTURE_CONTINUITY 修复登录初始化并验证', 2);
  const paused = await settled(run.id);
  assert.equal(paused.status, 'PAUSED');
  assert.equal(paused.error_code, 'AGENT_BUDGET_EXHAUSTED');
  assert.equal(paused.current_step, 2);
  const before = await call('query.agent.events', { run_id: run.id, limit: 500 });
  assert.equal(before.find(event => event.payload.kind === 'MODEL_RUNTIME_SETTINGS_V1').payload.settings.max_output_tokens,2048);
  provider = await call('command.provider.update_model_runtime', {provider_config_id:provider.id,expected_provider_revision:provider.revision,expected_revision:provider.model_runtime.revision,settings:{reasoning:'PROVIDER_DEFAULT',max_output_tokens:4096}});
  const checkpoint = before.findLast((event) => event.payload.kind === 'GENERAL_WORK_STATE_V1');
  assert.equal(checkpoint.payload.workspace_changed, false);
  assert.ok(checkpoint.payload.recent_tool_facts.some((fact) => fact.error_code === 'AGENT_TEXT_MATCH_FAILED' && fact.recovery.includes('line_edits')));
  assert.match(checkpoint.payload.model_assessment_unverified, /待验证/);
  killTestProcess(h.child.pid); await h.exit();
  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = false;\r\n// external edit while paused\r\n');
  h = harness(dataDir); await hello(h);
  const resumed = await call('command.agent.resume', { run_id: run.id });
  assert.equal(resumed.id, run.id);
  assert.equal(resumed.max_steps, 26);
  assert.equal(resumed.current_step, 2);
  const completed = await settled(run.id);
  assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed));
  const tools = await call('query.agent.tool_calls', { run_id: run.id });
  assert.equal(tools.filter((tool) => tool.name === 'replace_text').length, 1);
  assert.ok(tools.some((tool) => tool.error_code === 'AGENT_FILE_CHANGED'));
  assert.equal(tools.filter((tool) => tool.name === 'apply_patches' && tool.status === 'COMPLETED').length, 1);
  assert.ok(tools.some((tool) => tool.name === 'run_command' && tool.status === 'COMPLETED'));
  const actual = await readFile(path.join(projectRoot, 'login.js'), 'utf8');
  assert.match(actual, /ready = true/); assert.match(actual, /external edit while paused/);
  const runs = await call('query.agent.list', { conversation_id: run.conversation_id });
  assert.equal(runs.length, 1);
  const doneEvents = await call('query.agent.events', { run_id: run.id, limit: 500 });
  assert.deepEqual(doneEvents.filter(event => event.payload.kind === 'MODEL_RUNTIME_SETTINGS_V1').map(event=>event.payload.settings.max_output_tokens),[2048,4096], 'Explicit resume adopts saved settings without rewriting the earlier snapshot');
  assert.equal(doneEvents.find((event) => event.kind === 'RUN_RESUMED').payload.budget_grant.additional_steps, 24);
  assert.equal(doneEvents.find((event) => event.kind === 'RUN_COMPLETED').payload.verification_passed, true);

  const stalled = await start('FIELORA_AGENT_FIXTURE_STALL 分析证据', 24);
  const stalledResult = await settled(stalled.id);
  assert.equal(stalledResult.status, 'PAUSED'); assert.equal(stalledResult.error_code, 'AGENT_REPEATED_ACTIONS');
  assert.ok(stalledResult.current_step < 24);
  const stallEvents = await call('query.agent.events', { run_id: stalled.id, limit: 500 });
  assert.ok(stallEvents.some((event) => event.payload.kind === 'GENERAL_REPLAN_REQUESTED'));
  assert.equal(stallEvents.find(event => event.payload.kind === 'MODEL_RUNTIME_SETTINGS_V1').payload.settings.max_output_tokens,4096);

  const escaped = await start('FIELORA_AGENT_FIXTURE_STALL_ESCAPE 分析证据', null);
  const escapedResult = await settled(escaped.id);
  assert.equal(escapedResult.status, 'COMPLETED');
  assert.equal(escapedResult.current_step, 9);

  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = false;\r\n// preserve me\r\n');
  const automatic = await start('FIELORA_AGENT_FIXTURE_CONTINUITY_LONG 修复登录初始化并验证', null);
  assert.equal(automatic.max_steps, 4096);
  const automaticResult = await settled(automatic.id);
  assert.equal(automaticResult.status, 'COMPLETED', JSON.stringify(automaticResult));
  assert.equal(automaticResult.current_step, 27);
  const automaticEvents = await call('query.agent.events', { run_id: automatic.id, limit: 500 });
  assert.ok(!automaticEvents.some((event) => ['RUN_PAUSED', 'RUN_RESUMED'].includes(event.kind)));
  assert.equal(automaticEvents.find((event) => event.kind === 'RUN_COMPLETED').payload.verification_passed, true);
  const automaticTools = await call('query.agent.tool_calls', { run_id: automatic.id });
  assert.ok(automaticTools.some((tool) => tool.error_code === 'AGENT_TEXT_MATCH_FAILED'));
  assert.match(await readFile(path.join(projectRoot, 'login.js'), 'utf8'), /ready = true/);

  const resource = await start('FIELORA_AGENT_FIXTURE_RESOURCE 解释证据', null);
  const resourceCompleted = await settled(resource.id);
  assert.equal(resourceCompleted.status, 'COMPLETED');
  const resourceEvents = await call('query.agent.events', { run_id: resource.id, limit: 500 });
  assert.ok(!resourceEvents.some(event => event.kind === 'RUN_PAUSED'), 'High cumulative token usage does not pause the task');

  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = false;\n');
  const modelRecovery = await start('FIELORA_AGENT_FIXTURE_MODEL_RECOVERY 修复并验证登录流程', null);
  const modelPaused = await settled(modelRecovery.id);
  assert.equal(modelPaused.status, 'PAUSED'); assert.equal(modelPaused.error_code, 'PROVIDER_PROTOCOL_ERROR');
  assert.equal(modelPaused.current_step, 11);
  killTestProcess(h.child.pid); await h.exit();
  h = harness(dataDir); await hello(h);
  assert.equal((await call('command.agent.resume', { run_id: modelRecovery.id })).id, modelRecovery.id);
  assert.equal((await settled(modelRecovery.id)).status, 'COMPLETED');
  const recoveredTools = await call('query.agent.tool_calls', { run_id: modelRecovery.id });
  assert.equal(recoveredTools.filter(tool => tool.name === 'replace_text').length, 1);
  assert.equal(recoveredTools.filter(tool => tool.name === 'read_file').length, 9, 'resume should not restart inspection');
  assert.equal(recoveredTools.filter(tool => tool.name === 'run_command' && tool.status === 'COMPLETED').length, 1);

  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = false;\n');
  const legacyTask = 'FIELORA_AGENT_FIXTURE_MODEL_RECOVERY LEGACY 修复并验证登录流程';
  const legacyConversation = await call('command.conversation.create', { field_id: project.field_id, title: 'Legacy failed recovery', provider_config_id: provider.id, model_id: provider.default_model });
  const legacyUser = await call('command.conversation.message.create', { conversation_id: legacyConversation.id, role: 'USER', content: legacyTask, status: 'COMPLETED', provider_config_id:null, model_id:null, invocation_id:null });
  const legacyRequest = { field_id:project.field_id, conversation_id:legacyConversation.id, user_message_id:legacyUser.id, provider_config_id:provider.id, model_id:provider.default_model, task:legacyTask, permission:'FULL_CONTROL', max_steps:null };
  const oldAttempt = await call('command.agent.start', legacyRequest);
  assert.equal((await settled(oldAttempt.id)).status, 'FAILED');
  // A different current file must not inherit a previous modification's truth.
  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = false;\n// changed after failure\n');
  const nextAttempt = await call('command.agent.start', legacyRequest);
  const notVerified = await settled(nextAttempt.id);
  assert.equal(notVerified.status, 'PAUSED');
  assert.ok(['AGENT_VERIFICATION_REQUIRED', 'AGENT_REPEATED_ACTIONS'].includes(notVerified.error_code));
  const nextEvents = await call('query.agent.events', { run_id:nextAttempt.id, limit:500 });
  const linked = nextEvents.find(event => event.payload.kind === 'RETRY_STARTED');
  assert.equal(linked.payload.retry.retry_of, oldAttempt.id);
  assert.deepEqual(linked.payload.retry.changed_paths, ['login.js']);
  assert.equal(linked.payload.retry.work_state.verification_passed, false);
  const nextTools = await call('query.agent.tool_calls', { run_id:nextAttempt.id });
  assert.ok(nextTools.every(tool => tool.name === 'run_command'), 'linked retry should go straight to remaining verification');
  assert.ok(nextTools.some(tool => tool.receipt?.exit_code !== 0));
  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = true;\n// retain user correction\n');
  await call('command.agent.resume', { run_id:nextAttempt.id });
  assert.equal((await settled(nextAttempt.id)).status, 'COMPLETED');
  assert.equal((await call('query.agent.get', { run_id:oldAttempt.id })).status, 'FAILED', 'historical terminal state is immutable');

  const unsupported = await start('FIELORA_AGENT_FIXTURE_PROSE_ONLY 修复业务流程并验证', 8);
  const unsupportedResult = await settled(unsupported.id);
  assert.equal(unsupportedResult.status, 'PAUSED'); assert.equal(unsupportedResult.error_code, 'AGENT_VERIFICATION_REQUIRED');
  const replies = await call('query.conversation.message.list', { conversation_id: unsupported.conversation_id });
  assert.ok(!replies.some((message) => message.invocation_id === unsupported.id && message.status === 'COMPLETED'));

  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = true;\n');
  const falseClaim = await start('FIELORA_AGENT_FIXTURE_GOAL_SCOPE 把当前功能改成支持分批处理', null);
  const falseClaimResult = await settled(falseClaim.id);
  assert.equal(falseClaimResult.status, 'PAUSED');
  assert.equal(falseClaimResult.error_code, 'AGENT_VERIFICATION_REQUIRED');
  assert.ok(!(await call('query.conversation.message.list', { conversation_id:falseClaim.conversation_id })).some(message=>message.invocation_id===falseClaim.id && message.status==='COMPLETED'));
  const existing = await start('FIELORA_AGENT_FIXTURE_GOAL_SCOPE CHECK 把当前功能改成支持分批处理', null);
  assert.equal((await settled(existing.id)).status, 'COMPLETED');
  const existingTools = await call('query.agent.tool_calls', { run_id:existing.id });
  assert.ok(existingTools.every(tool=>tool.effect!=='WORKSPACE_WRITE'));
  assert.ok(existingTools.some(tool=>tool.receipt?.verification_eligible && tool.receipt?.workspace_revision));
  const existingEvents = await call('query.agent.events', { run_id:existing.id, limit:500 });
  assert.equal(existingEvents.find(event=>event.kind==='RUN_COMPLETED').payload.completion_basis,'VERIFIED_EXISTING_STATE');

  await writeFile(path.join(projectRoot, 'verify.cjs'), "require('node:assert/strict').equal(require('./login.js').ready,true);require('node:fs').writeFileSync('login.js','exports.ready = false;');\n");
  const changedDuringCheck = await start('FIELORA_AGENT_FIXTURE_GOAL_SCOPE CHECK 把功能调整为支持分批处理', null);
  assert.equal((await settled(changedDuringCheck.id)).status,'PAUSED');
  const unstableTools = await call('query.agent.tool_calls',{ run_id:changedDuringCheck.id });
  assert.ok(unstableTools.some(tool=>tool.receipt?.verification_state_changed===true));
  await writeFile(path.join(projectRoot, 'verify.cjs'), "require('node:assert/strict').equal(require('./login.js').ready,true);\n");

  const budget = await start('FIELORA_AGENT_FIXTURE_BUDGET 分析各行证据', 64);
  const full = await settled(budget.id);
  assert.equal(full.error_code, 'AGENT_BUDGET_EXHAUSTED'); assert.equal(full.current_step, 64);
  const grant = await call('command.agent.resume', { run_id: budget.id });
  assert.equal(grant.max_steps, 88); assert.equal(grant.current_step, 64);
  await call('command.agent.cancel', { run_id: budget.id });
});

async function hello(h) { h.send('hello', 'system.hello'); return h.next(); }
async function mutation(h, id, method, params) {
  h.send(id, method, params);
  const response = await h.next();
  assert.ok(response.result, JSON.stringify(response));
  const event = await h.next();
  assert.equal(event.method, 'event.field.changed');
  const revision = response.result.field_revision ?? response.result.revision;
  assert.equal(event.params.revision, revision);
  return response.result;
}

test('Core exposes complete build provenance for differential evidence', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fielora-core-provenance-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const h = harness(dataDir);
  const greeting = await hello(h);
  assert.ok(greeting.result.capabilities.includes('system.build_provenance'));
  h.send('provenance', 'query.system.build_provenance');
  const provenance = (await h.next()).result;
  assert.match(provenance.git_head, /^[0-9a-f]{40}$|^UNKNOWN$/);
  assert.equal(typeof provenance.git_dirty, 'boolean');
  assert.match(provenance.source_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(provenance.agent_core_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(provenance.fast_edit_implementation_version, 'FAST_EDIT_BOUNDED_V1');
  assert.equal(provenance.context_compiler_version, 'LEXICAL_REPOSITORY_INDEX_V1');
  h.send('shutdown', 'system.shutdown');
  await h.next();
  await h.exit();
});

test('real Core persists create/focus/snapshot through close and restart', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fielora-core-integration-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const first = harness(dataDir);
  assert.equal((await hello(first)).result.schema_version, 19);
  first.send('create', 'command.field.create', { title: 'Phase 01 Test', goal: 'Persistence' });
  const created = await first.next();
  const event = await first.next();
  assert.equal(event.method, 'event.field.changed');
  first.send('focus', 'command.field.update_focus', { field_id: created.result.id, expected_revision: 1, focus: 'Persistence' });
  const updated = await first.next();
  await first.next();
  assert.equal(updated.result.revision, 2);
  first.send('snapshot', 'command.surface.save_snapshot', { field_id: created.result.id, layout: { primary: 'FIELD' }, open_objects: [] });
  assert.equal((await first.next()).result.observed_field_revision, 2);
  first.send('shutdown', 'system.shutdown');
  await first.next();
  assert.equal(await first.exit(), 0);

  const second = harness(dataDir);
  await hello(second);
  second.send('list', 'query.field.list');
  assert.equal((await second.next()).result[0].current_focus, 'Persistence');
  second.send('resume', 'query.surface.latest_snapshot', { field_id: created.result.id });
  const resume = await second.next();
  assert.equal(resume.result.field.current_focus, 'Persistence');
  assert.equal(resume.result.snapshot.observed_field_revision, 2);
  second.send('shutdown', 'system.shutdown');
  await second.next();
  await second.exit();
});

test('parent-pipe EOF exits within two seconds without explicit shutdown', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fielora-core-eof-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const h = harness(dataDir);
  await hello(h);
  const started = performance.now();
  h.child.stdin.end();
  assert.equal(await h.exit(2000), 0);
  assert.ok(performance.now() - started < 2000);
});

test('Desktop Foundation persists Project, Conversation, provider selection, and messages', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-desktop-foundation-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const projectRoot=path.join(dataDir,'local-project');
  const first=harness(dataDir);const greeting=await hello(first);assert.equal(greeting.result.schema_version,19);
  for(const capability of ['project.create','project.update','project.archive','conversation.create','conversation.message.create'])assert.ok(greeting.result.capabilities.includes(capability));
  first.send('provider','command.provider.create_config',{provider_kind:'OPENAI_COMPATIBLE',display_name:'Desktop fixture',base_url:'https://example.com/v1',default_model:'__fielora_fixture__',custom_endpoint_acknowledged:true});const provider=(await first.next()).result;
  first.send('project','command.project.create',{title:'Local Project',goal:'Persist the coding loop',root_path:projectRoot});const project=(await first.next()).result;assert.equal(project.root_path,projectRoot);
  first.send('rename-project','command.project.update',{field_id:project.field_id,expected_revision:project.revision,title:'Renamed Local Project'});const renamedProject=(await first.next()).result;assert.equal(renamedProject.title,'Renamed Local Project');assert.equal(renamedProject.root_path,projectRoot);
  first.send('conversation','command.conversation.create',{field_id:project.field_id,title:'Build the feature',provider_config_id:provider.id,model_id:'__fielora_fixture__'});let conversation=(await first.next()).result;
  first.send('user-message','command.conversation.message.create',{conversation_id:conversation.id,role:'USER',content:'Inspect the project',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null});assert.equal((await first.next()).result.role,'USER');
  first.send('assistant-message','command.conversation.message.create',{conversation_id:conversation.id,role:'ASSISTANT',content:'Ready to review a bounded change.',status:'COMPLETED',provider_config_id:provider.id,model_id:'__fielora_fixture__',invocation_id:null});assert.equal((await first.next()).result.role,'ASSISTANT');
  first.send('get-conversation','query.conversation.get',{conversation_id:conversation.id});conversation=(await first.next()).result;assert.equal(conversation.revision,3);
  first.send('rename','command.conversation.update',{conversation_id:conversation.id,expected_revision:conversation.revision,title:'Review and test',provider_config_id:provider.id,model_id:'__fielora_fixture__'});conversation=(await first.next()).result;assert.equal(conversation.title,'Review and test');
  first.send('shutdown','system.shutdown');await first.next();await first.exit();

  const second=harness(dataDir);await hello(second);
  second.send('projects','query.project.list');const resumedProjects=(await second.next()).result;assert.equal(resumedProjects[0].field_id,project.field_id);assert.equal(resumedProjects[0].title,'Renamed Local Project');
  second.send('conversations','query.conversation.list',{field_id:project.field_id});const resumed=(await second.next()).result;assert.equal(resumed[0].title,'Review and test');assert.equal(resumed[0].provider_config_id,provider.id);
  second.send('messages','query.conversation.message.list',{conversation_id:conversation.id});assert.deepEqual((await second.next()).result.map((message)=>message.content),['Inspect the project','Ready to review a bounded change.']);
  second.send('archive','command.conversation.archive',{conversation_id:conversation.id,expected_revision:conversation.revision});assert.equal((await second.next()).result.lifecycle_status,'ARCHIVED');
  second.send('active-after-archive','query.conversation.list',{field_id:project.field_id});assert.deepEqual((await second.next()).result,[]);
  second.send('archive-project','command.project.archive',{field_id:project.field_id,expected_revision:renamedProject.revision});assert.equal((await second.next()).result.field_id,project.field_id);
  second.send('projects-after-archive','query.project.list');assert.deepEqual((await second.next()).result,[]);
  second.send('shutdown','system.shutdown');await second.next();await second.exit();
});

test('Phase 02 FIPC reality workflow persists, resumes, and preserves atomic revisions', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-phase02-integration-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const h=harness(dataDir);const helloResponse=await hello(h);
  assert.equal(helloResponse.result.schema_version,19);
  for(const capability of ['state.supersede','reference.archive','relation.attach_reference_source','surface.save_snapshot_v1','field.resume_v1'])assert.ok(helloResponse.result.capabilities.includes(capability));
  const field=await mutation(h,'p2-field','command.field.create',{title:'Phase 02 Reality',goal:'Prove durable truth'});
  const task=await mutation(h,'p2-task','command.state.create',{field_id:field.id,kind:'TASK',content:'Ship Phase 02',confidence:0.8});
  const question=await mutation(h,'p2-question','command.state.create',{field_id:field.id,kind:'QUESTION',content:'Is resume current?',confidence:null});
  const blocker=await mutation(h,'p2-blocker','command.state.create',{field_id:field.id,kind:'BLOCKER',content:'Need evidence',confidence:1});
  assert.deepEqual([task.field_revision,question.field_revision,blocker.field_revision],[2,3,4]);
  let changed=await mutation(h,'p2-resolve','command.state.transition',{field_id:field.id,state_id:blocker.resource.id,expected_state_revision:1,target:'RESOLVED'});assert.equal(changed.field_revision,5);
  changed=await mutation(h,'p2-reopen','command.state.transition',{field_id:field.id,state_id:blocker.resource.id,expected_state_revision:2,target:'ACTIVE'});assert.equal(changed.field_revision,6);
  changed=await mutation(h,'p2-revise','command.state.revise',{field_id:field.id,state_id:blocker.resource.id,expected_state_revision:3,content:'Need packaged evidence',confidence:1});assert.equal(changed.field_revision,7);
  const superseded=await mutation(h,'p2-supersede','command.state.supersede',{field_id:field.id,state_id:blocker.resource.id,expected_state_revision:4,replacement_content:'Evidence captured',replacement_confidence:1});assert.equal(superseded.field_revision,8);
  const reference=await mutation(h,'p2-reference','command.reference.create',{field_id:field.id,title:'Evidence source',url:'HTTPS://Example.COM:443/evidence?q=token'});assert.equal(reference.resource.canonical_url,'https://example.com/evidence?q=token');
  const relation=await mutation(h,'p2-attach','command.relation.attach_reference_source',{field_id:field.id,state_id:superseded.replacement.id,reference_id:reference.resource.id});assert.equal(relation.field_revision,10);
  const mode=await mutation(h,'p2-mode','command.field.update_mode',{field_id:field.id,expected_field_revision:10,mode:'VERIFY'});assert.equal(mode.field_revision,11);
  const focused=await mutation(h,'p2-focus','command.field.set_focus_v1',{field_id:field.id,expected_field_revision:11,focus:{kind:'REFERENCE',object_id:reference.resource.id}});assert.equal(focused.field_revision,12);
  h.send('p2-snapshot','command.surface.save_snapshot_v1',{field_id:field.id,layout:{version:1,template:'PRIMARY_SUPPORT_RIGHT',primary:{pane_id:'primary_task',primitive:'TASK_PANE',binding:{kind:'FIELD_TASKS'},collapsed:false},supporting:[{pane_id:`pane_${reference.resource.id}`,primitive:'REFERENCE_PANE',binding:{kind:'REFERENCE',object_id:reference.resource.id},collapsed:false}],focused_pane_id:'primary_task'}});
  assert.equal((await h.next()).result.observed_field_revision,12);
  h.send('p2-resume-current','query.field.resume_v1',{field_id:field.id});let resume=(await h.next()).result;
  assert.equal(resume.snapshot_freshness,'CURRENT');assert.equal(resume.continuation.reason,'TYPED_FOCUS');assert.deepEqual(resume.open_reference_ids,[reference.resource.id]);
  changed=await mutation(h,'p2-stale','command.state.revise',{field_id:field.id,state_id:task.resource.id,expected_state_revision:1,content:'Ship and verify Phase 02',confidence:1});assert.equal(changed.field_revision,13);
  const archived=await mutation(h,'p2-archive','command.reference.archive',{field_id:field.id,object_id:reference.resource.id,expected_object_revision:1});assert.equal(archived.field_revision,14);
  h.send('p2-resume-stale','query.field.resume_v1',{field_id:field.id});resume=(await h.next()).result;
  assert.equal(resume.snapshot_freshness,'STALE');assert.deepEqual(resume.unavailable_reference_ids,[reference.resource.id]);assert.equal(resume.typed_focus,null);
  const restored=await mutation(h,'p2-restore','command.reference.restore',{field_id:field.id,object_id:reference.resource.id,expected_object_revision:2});assert.equal(restored.field_revision,15);
  h.send('p2-relations','query.relation.list',{field_id:field.id,relation_type:null,lifecycle:'RETRACTED',endpoint:null,cursor:null,limit:100});
  assert.equal((await h.next()).result.items.find((item)=>item.id===relation.resource.id).lifecycle,'RETRACTED');
  h.send('p2-activities','query.activity.list',{field_id:field.id,cursor:null,limit:100});const activities=(await h.next()).result.items;
  assert.equal(activities.length,15);assert.ok(!JSON.stringify(activities).includes('token'));
  const empty=await mutation(h,'empty-field','command.field.create',{title:'Empty task surface',goal:null});
  h.send('empty-resume','query.field.resume_v1',{field_id:empty.id});const emptyResume=(await h.next()).result;
  assert.equal(emptyResume.field_revision,1);assert.equal(emptyResume.layout.template,'PRIMARY_ONLY');assert.deepEqual(emptyResume.active_tasks,[]);
  h.send('shutdown','system.shutdown');await h.next();await h.exit();
});

test('protocol failures recover without crashing and conflict remains conflict', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fielora-core-protocol-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const h = harness(dataDir);
  h.child.stdin.write(Buffer.from([0xff, 0xfe, 0x0a]));
  assert.equal((await h.next()).error.code, -32700);
  h.child.stdin.write('{not-json}\n');
  assert.equal((await h.next()).error.code, -32700);
  await hello(h);
  h.child.stdin.write(`${'x'.repeat(4 * 1024 * 1024 + 1)}\n`);
  assert.equal((await h.next()).error.data.code, 'protocol_error');
  h.send('recovered', 'system.health');
  assert.equal((await h.next()).result.state, 'READY');
  h.send('unknown', 'unknown.method');
  assert.equal((await h.next()).error.code, -32601);
  h.send('wrong', 'system.health', {}, '2.0');
  assert.equal((await h.next()).error.data.code, 'protocol_error');
  h.send('minor', 'system.health', {}, '1.9');
  assert.equal((await h.next()).result.state, 'READY');
  h.send('extra', 'command.field.create', { title: 'No passthrough', goal: null, arbitrary: true });
  assert.equal((await h.next()).error.code, -32602);
  h.send('create', 'command.field.create', { title: 'Conflict', goal: null });
  const created = await h.next(); await h.next();
  h.send('object-focus', 'command.field.update_focus', { field_id: created.result.id, expected_revision: 1, focus: { arbitrary: true } });
  assert.equal((await h.next()).error.code, -32602);
  h.send('first', 'command.field.update_focus', { field_id: created.result.id, expected_revision: 1, focus: 'A' });
  await h.next(); await h.next();
  h.send('stale', 'command.field.update_focus', { field_id: created.result.id, expected_revision: 1, focus: 'B' });
  assert.equal((await h.next()).error.data.code, 'REVISION_CONFLICT');
  h.send('shutdown', 'system.shutdown'); await h.next(); await h.exit();
});

test('Provider preflight checks actual local credentials without invoking a model', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fielora-send-preflight-'));
  const h = harness(dataDir);
  t.after(async () => { if (h.child.exitCode === null) { killTestProcess(h.child.pid); await h.exit(); } await rm(dataDir, {recursive:true,force:true}); });
  await hello(h);
  const events = [];
  async function call(method, params) {
    const id = randomUUID(); h.send(id, method, params);
    for (;;) { const response = await h.next(); if (response.id === id) return response; events.push(response); }
  }
  const {result:provider} = await call('command.provider.create_config', {provider_kind:'OPENAI',display_name:'Local preflight only',base_url:null,default_model:'gpt-4.1-mini',custom_endpoint_acknowledged:false});
  const request = {provider_config_id:provider.id,model_id:null};
  assert.match((await call('command.provider.prepare_send', request)).error.message, /PROVIDER_DISABLED/);
  const secret = `synthetic-preflight-${randomUUID()}`;
  await call('command.provider.store_credential', {...request,model_id:undefined,secret});
  const prepared = await call('command.provider.prepare_send', request);
  assert.equal(prepared.result, null); assert.equal(prepared.error, undefined);
  assert.equal(JSON.stringify(prepared).includes(secret), false);
  assert.match((await call('command.provider.prepare_send', {...request, model_id:'qwen3.7-plus'})).error.message, /PROVIDER_MODEL_MISMATCH/);
  assert.ok((await call('command.provider.prepare_send', {...request, secret})).error, 'No credential input accepted by preflight');
  // Simulate stale presence metadata: only the isolated DB credential is lost.
  const {DatabaseSync} = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'data', 'fielora.db'));
  try { db.prepare('UPDATE local_credentials SET secret=NULL').run(); } finally { db.close(); }
  assert.match((await call('command.provider.prepare_send', request)).error.message, /CREDENTIAL_MISSING/);
  assert.equal(events.some(event => event.method === 'event.model.invocation' || event.method === 'event.agent.run'), false);
  h.send('shutdown','system.shutdown'); await h.next(); await h.exit();
});

test('Phase 04 fixture proves provider-neutral stream, capture lifecycle, and no secret echo', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-phase04-integration-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const h=harness(dataDir);assert.equal((await hello(h)).result.schema_version,19);const notifications=[];
  async function response(id){for(;;){const value=await h.next();if(value.id===id)return value;notifications.push(value);}}
  h.send('provider','command.provider.create_config',{provider_kind:'OPENAI_COMPATIBLE',display_name:'Fixture provider',base_url:'https://example.com/v1',default_model:'__fielora_fixture__',custom_endpoint_acknowledged:true});
  const provider=(await response('provider')).result;t.after(()=>deleteTestCredential(provider.id));assert.equal(provider.lifecycle_status,'DISABLED');assert.equal(JSON.stringify(provider).includes('credential_ref'),false);
  const secret=`phase04-fixture-${randomUUID()}`;h.send('credential','command.provider.store_credential',{provider_config_id:provider.id,secret});const active=(await response('credential')).result;assert.equal(active.lifecycle_status,'ACTIVE');assert.equal(active.credential_present,true);assert.equal(JSON.stringify(active).includes(secret),false);
  h.send('field','command.field.create',{title:'Phase 04 Context',goal:'Prove capture semantics'});const field=(await response('field')).result;
  h.send('blocked-secret','command.model.start',{provider_config_id:provider.id,model_id:null,intent:'ASK',user_input:'do not send sk-abcdefghijklmnopqrstuvwxyz',context_package:[],response_mode:'TEXT'});const blockedSecret=await response('blocked-secret');assert.equal(blockedSecret.error.message,'CONTEXT_BLOCKED');assert.equal(JSON.stringify(blockedSecret).includes('sk-abcdefghijklmnopqrstuvwxyz'),false);
  const smallChip={kind:'USER_NOTE',source_identity:'note',source_revision_or_navigation_generation:'ephemeral',display_label:'Note',content:'bounded',sensitivity:'NORMAL',completeness:'COMPLETE'};h.send('too-many-chips','command.model.start',{provider_config_id:provider.id,model_id:null,intent:'ASK',user_input:'bounded',context_package:Array.from({length:9},()=>smallChip),response_mode:'TEXT'});assert.equal((await response('too-many-chips')).error.message,'CONTEXT_TOO_LARGE');
  h.send('invoke','command.model.start',{provider_config_id:provider.id,model_id:null,intent:'ASK',user_input:'Fixture prompt must not persist',context_package:[{kind:'CURRENT_FIELD',source_identity:field.id,source_revision_or_navigation_generation:'stale',display_label:'Current Field',content:'forged renderer field text',sensitivity:'NORMAL',completeness:'COMPLETE'}],response_mode:'TEXT'});
  const invocation=(await response('invoke')).result;const stream=[];while(!stream.some((event)=>event.params?.kind==='COMPLETED')){const event=notifications.shift()??await h.next();if(event.method==='event.model.invocation'&&event.params.invocation_id===invocation.invocation_id)stream.push(event);}
  assert.deepEqual(stream.map((event)=>event.params.kind),['STARTED','OUTPUT_TEXT_DELTA','USAGE','COMPLETED']);assert.equal(stream.find((event)=>event.params.kind==='OUTPUT_TEXT_DELTA').params.text_delta,'Fielora fixture response');
  h.send('invoke-cancel','command.model.start',{provider_config_id:provider.id,model_id:null,intent:'ASK',user_input:'cancel fixture',context_package:[],response_mode:'TEXT'});const cancelInvocation=(await response('invoke-cancel')).result;h.send('cancel','command.model.cancel',{invocation_id:cancelInvocation.invocation_id});await response('cancel');const cancelled=[];while(!cancelled.some((event)=>event.params?.kind==='CANCELLED')){const event=notifications.shift()??await h.next();if(event.method==='event.model.invocation'&&event.params.invocation_id===cancelInvocation.invocation_id)cancelled.push(event);}assert.deepEqual(cancelled.map((event)=>event.params.kind),['STARTED','CANCELLED']);assert.equal(cancelled.at(-1).params.error_code,'INVOCATION_CANCELLED');
  h.send('invoke-fail','command.model.start',{provider_config_id:provider.id,model_id:'__fielora_fixture_failure__',intent:'ASK',user_input:'failure fixture',context_package:[],response_mode:'TEXT'});const failedInvocation=(await response('invoke-fail')).result;const failed=[];while(!failed.some((event)=>event.params?.kind==='FAILED')){const event=notifications.shift()??await h.next();if(event.method==='event.model.invocation'&&event.params.invocation_id===failedInvocation.invocation_id)failed.push(event);}assert.deepEqual(failed.map((event)=>event.params.kind),['STARTED','FAILED']);assert.equal(failed.at(-1).params.error_code,'PROVIDER_RATE_LIMITED');
  h.send('capture','command.capture.create',{kind:'MODEL_OUTPUT',title:'Saved fixture result',content:'Fielora fixture response',source:{kind:'MODEL_RESPONSE',title:null,uri:null,field_id:null,resource_type:null,resource_id:null,resource_revision:null,provider_config_id:provider.id,provider_model_id:'__fielora_fixture__',provider_invocation_id:invocation.invocation_id,is_partial:false}});const capture=(await response('capture')).result;assert.equal(capture.placement_status,'INBOX');
  h.send('attach','command.capture.attach',{capture_id:capture.id,field_id:field.id,expected_revision:capture.revision});const attached=(await response('attach')).result;assert.equal(attached.placement_status,'ATTACHED');
  h.send('promote','command.capture.promote',{capture_id:capture.id,field_id:field.id,expected_revision:attached.revision});const promoted=(await response('promote')).result;assert.equal(promoted.placement_status,'PROMOTED');assert.equal(promoted.promoted_as,'IDEA_CANDIDATE');
  h.send('list','query.capture.list',{placement:null,lifecycle:'ACTIVE',field_id:field.id,cursor:null,limit:100});assert.equal((await response('list')).result.items[0].id,capture.id);
  h.send('remove','command.provider.remove_config',{provider_config_id:provider.id});await response('remove');
  const serialized=JSON.stringify(notifications);assert.equal(serialized.includes(secret),false);assert.equal(serialized.includes('Fixture prompt must not persist'),false);assert.equal(serialized.includes('forged renderer field text'),false);
  h.send('shutdown','system.shutdown');await response('shutdown');await h.exit();
});

test('Complete Agent executes an approved coding loop with durable tools, verification, and conversation result', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-agent-integration-'));
  const projectRoot=path.join(dataDir,'agent-project');await mkdir(projectRoot,{recursive:true});
  assert.equal(spawnSync('git',['init'],{cwd:projectRoot,windowsHide:true,stdio:'ignore'}).status,0);
  const h=harness(dataDir);t.after(async()=>{if(h.child.exitCode===null){killTestProcess(h.child.pid);}await rm(dataDir,{recursive:true,force:true});});const greeting=await hello(h);for(const capability of ['agent.start','agent.events','agent.resolve_approval'])assert.ok(greeting.result.capabilities.includes(capability));
  const notifications=[];async function response(id){for(;;){const value=await h.next();if(value.id===id)return value;notifications.push(value);}}
  h.send('agent-provider','command.provider.create_config',{provider_kind:'OPENAI_COMPATIBLE',display_name:'Agent fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture__',custom_endpoint_acknowledged:true});const provider=(await response('agent-provider')).result;
  h.send('agent-credential','command.provider.store_credential',{provider_config_id:provider.id,secret:`agent-fixture-${randomUUID()}`});assert.equal((await response('agent-credential')).result.lifecycle_status,'ACTIVE');t.after(()=>deleteTestCredential(provider.id));
  h.send('agent-project','command.project.create',{title:'Agent Project',goal:'Prove a real tool loop',root_path:projectRoot});const project=(await response('agent-project')).result;
  h.send('agent-conversation','command.conversation.create',{field_id:project.field_id,title:'Agent execution',provider_config_id:provider.id,model_id:'__fielora_agent_fixture__'});const conversation=(await response('agent-conversation')).result;
  h.send('agent-user-message','command.conversation.message.create',{conversation_id:conversation.id,role:'USER',content:'FIELORA_AGENT_FIXTURE_CREATE',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null});const userMessage=(await response('agent-user-message')).result;
  h.send('agent-start','command.agent.start',{field_id:project.field_id,conversation_id:conversation.id,user_message_id:userMessage.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture__',task:'FIELORA_AGENT_FIXTURE_CREATE',permission:'READ_ONLY',max_steps:8});const run=(await response('agent-start')).result;

  let sequence=0;let approvalCount=0;let finalRun=null;
  for(let attempt=0;attempt<120;attempt+=1){
    h.send(`agent-get-${attempt}`,'query.agent.get',{run_id:run.id});finalRun=(await response(`agent-get-${attempt}`)).result;
    h.send(`agent-events-${attempt}`,'query.agent.events',{run_id:run.id,after_sequence:sequence,limit:100});const events=(await response(`agent-events-${attempt}`)).result;if(events.length)sequence=events.at(-1).sequence;
    const requested=events.find((event)=>event.kind==='APPROVAL_REQUESTED');
    if(requested){
      const approval=requested.payload.approval;approvalCount+=1;
      h.send(`agent-approve-${approvalCount}`,'command.agent.resolve_approval',{run_id:run.id,approval_id:approval.id,nonce:approval.nonce,decision:'ALLOW_ONCE'});assert.equal((await response(`agent-approve-${approvalCount}`)).result.decision,'ALLOW_ONCE');
    }
    if(['COMPLETED','FAILED','CANCELLED'].includes(finalRun.status))break;
    await new Promise((resolve)=>setTimeout(resolve,25));
  }
  if(finalRun.status!=='COMPLETED'){
    h.send('agent-failure-tools','query.agent.tool_calls',{run_id:run.id});const failureTools=(await response('agent-failure-tools')).result;
    h.send('agent-failure-events','query.agent.events',{run_id:run.id,after_sequence:null,limit:500});const failureEvents=(await response('agent-failure-events')).result;
    assert.fail(JSON.stringify({run:finalRun,tools:failureTools.map((tool)=>({name:tool.name,status:tool.status,error_code:tool.error_code})),events:failureEvents.map((event)=>({sequence:event.sequence,kind:event.kind,payload:event.payload}))}));
  }
  assert.equal(approvalCount,2);
  assert.equal(await readFile(path.join(projectRoot,'fielora-agent-fixture.txt'),'utf8'),'created by the Fielora Agent fixture\n');
  h.send('agent-tools','query.agent.tool_calls',{run_id:run.id});const tools=(await response('agent-tools')).result;assert.deepEqual(tools.map((tool)=>[tool.name,tool.status]),[['create_file','COMPLETED'],['run_command','COMPLETED'],['finish_task','COMPLETED']]);assert.equal(tools[2].effect,'OBSERVE');assert.equal(tools[2].receipt.task_complete,false);assert.equal(tools[1].receipt.success,true);assert.equal(tools[1].receipt.execution_boundary,'CURRENT_USER_HOST');assert.equal(tools[1].receipt.network_policy,'ALLOWED');assert.equal(tools[1].receipt.read_isolation,false);
  h.send('agent-all-events','query.agent.events',{run_id:run.id,after_sequence:null,limit:500});const allEvents=(await response('agent-all-events')).result;const kinds=allEvents.map((event)=>event.kind);for(const kind of ['RUN_CREATED','CONTEXT_COMPILED','ASSISTANT_NARRATIVE','APPROVAL_REQUESTED','TOOL_COMPLETED','VERIFICATION_RECORDED','RUN_COMPLETED'])assert.ok(kinds.includes(kind),kind);assert.equal(allEvents.find((event)=>event.kind==='RUN_CREATED').payload.user_message_id,userMessage.id);const runStarted=allEvents.find((event)=>event.kind==='RUN_STARTED');assert.equal(runStarted.payload.harness_profile,'CODING_V0.1');assert.equal(runStarted.payload.harness_strategy,'GOAL_DRIVEN_AGENT_LOOP_V4');const narratives=allEvents.filter((event)=>event.kind==='ASSISTANT_NARRATIVE');assert.equal(narratives[0].payload.text,'I will create the requested fixture file.');assert.ok(narratives[0].sequence<allEvents.find((event)=>event.kind==='TOOL_PROPOSED').sequence);assert.equal(JSON.stringify(narratives).includes('private fixture reasoning'),false);assert.equal(JSON.stringify(narratives).includes('<think>'),false);
  h.send('agent-messages','query.conversation.message.list',{conversation_id:conversation.id});const messages=(await response('agent-messages')).result;assert.deepEqual(messages.map((message)=>message.role),['USER','ASSISTANT']);assert.equal(messages.filter((message)=>message.role==='ASSISTANT'&&message.invocation_id===run.id).length,1);assert.match(messages[1].content,/completed the task/i);assert.equal(messages[1].invocation_id,run.id);assert.equal(narratives.some((event)=>/completed the task/i.test(event.payload.text)),false);
  h.send('delegate-start','command.agent.start',{field_id:project.field_id,conversation_id:conversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture__',task:'FIELORA_AGENT_FIXTURE_DELEGATE',permission:'FULL_CONTROL',max_steps:8});const delegated=(await response('delegate-start')).result;
  let delegatedRun=null;for(let attempt=0;attempt<80;attempt+=1){h.send(`delegate-get-${attempt}`,'query.agent.get',{run_id:delegated.id});delegatedRun=(await response(`delegate-get-${attempt}`)).result;if(['COMPLETED','FAILED','CANCELLED'].includes(delegatedRun.status))break;await new Promise((resolve)=>setTimeout(resolve,25));}
  if(delegatedRun.status!=='COMPLETED'){
    h.send('delegate-failure-tools','query.agent.tool_calls',{run_id:delegated.id});const failureTools=(await response('delegate-failure-tools')).result;
    h.send('delegate-failure-events','query.agent.events',{run_id:delegated.id,after_sequence:null,limit:500});const failureEvents=(await response('delegate-failure-events')).result;
    assert.fail(JSON.stringify({run:delegatedRun,tools:failureTools.map((tool)=>({name:tool.name,status:tool.status,error_code:tool.error_code})),events:failureEvents.map((event)=>({sequence:event.sequence,kind:event.kind,payload:event.payload}))}));
  }
  h.send('delegate-runs','query.agent.list',{conversation_id:conversation.id});const allRuns=(await response('delegate-runs')).result;const child=allRuns.find((item)=>item.task.startsWith('[SUBAGENT parent='));assert.ok(child);assert.equal(child.permission,'READ_ONLY');assert.equal(child.status,'COMPLETED');
  h.send('delegate-parent-tools','query.agent.tool_calls',{run_id:delegated.id});const delegationTool=(await response('delegate-parent-tools')).result.find((tool)=>tool.name==='delegate_readonly');assert.equal(delegationTool.status,'COMPLETED');assert.equal(delegationTool.receipt.child_run_id,child.id);
  h.send('delegate-child-tools','query.agent.tool_calls',{run_id:child.id});assert.deepEqual((await response('delegate-child-tools')).result.map((tool)=>[tool.name,tool.effect,tool.status]),[['list_files','OBSERVE','COMPLETED']]);
  h.send('cancel-start','command.agent.start',{field_id:project.field_id,conversation_id:conversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture_slow__',task:'Wait until cancelled',permission:'READ_ONLY',max_steps:4});const cancellable=(await response('cancel-start')).result;
  h.send('cancel-agent','command.agent.cancel',{run_id:cancellable.id});await response('cancel-agent');let cancelledRun=null;for(let attempt=0;attempt<50;attempt+=1){h.send(`cancel-get-${attempt}`,'query.agent.get',{run_id:cancellable.id});cancelledRun=(await response(`cancel-get-${attempt}`)).result;if(cancelledRun.status==='CANCELLED')break;await new Promise((resolve)=>setTimeout(resolve,20));}assert.equal(cancelledRun.status,'CANCELLED');assert.equal(cancelledRun.error_code,'AGENT_CANCELLED');h.send('cancel-messages','query.conversation.message.list',{conversation_id:conversation.id});const cancelMessages=(await response('cancel-messages')).result;const cancelledReply=cancelMessages.find((message)=>message.invocation_id===cancellable.id);assert.equal(cancelledReply.status,'CANCELLED');assert.match(cancelledReply.content,/已停止/);
  await rm(path.join(projectRoot,'fielora-agent-fixture.txt'));
  h.send('warning-conversation','command.conversation.create',{field_id:project.field_id,title:'Verified warning',provider_config_id:provider.id,model_id:'__fielora_agent_fixture__'});const warningConversation=(await response('warning-conversation')).result;
  const warningTask='FIELORA_AGENT_FIXTURE_CREATE FIELORA_AGENT_FIXTURE_FINALIZATION_FAILURE';h.send('warning-start','command.agent.start',{field_id:project.field_id,conversation_id:warningConversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture__',task:warningTask,permission:'FULL_CONTROL',max_steps:8});const warningRun=(await response('warning-start')).result;let warningFinal=null;
  for(let attempt=0;attempt<120;attempt+=1){h.send(`warning-get-${attempt}`,'query.agent.get',{run_id:warningRun.id});warningFinal=(await response(`warning-get-${attempt}`)).result;if(['COMPLETED','FAILED','CANCELLED','PAUSED'].includes(warningFinal.status))break;await new Promise((resolve)=>setTimeout(resolve,25));}
  assert.equal(warningFinal.status,'PAUSED');assert.equal(warningFinal.error_code,'PROVIDER_PROTOCOL_ERROR');
  h.send('warning-events','query.agent.events',{run_id:warningRun.id,after_sequence:null,limit:500});const warningEvents=(await response('warning-events')).result;
  assert.ok(!warningEvents.some(event=>event.kind==='RUN_COMPLETED'));
  assert.ok(warningEvents.some(event=>event.kind==='VERIFICATION_RECORDED'),'retain successful verification without claiming the whole task is done');
  h.send('warning-messages','query.conversation.message.list',{conversation_id:warningConversation.id});const warningMessages=(await response('warning-messages')).result;
  assert.ok(!warningMessages.some(message=>message.invocation_id===warningRun.id&&message.status==='COMPLETED'));
  assert.equal(await readFile(path.join(projectRoot,'fielora-agent-fixture.txt'),'utf8'),'created by the Fielora Agent fixture\n');
  h.send('agent-shutdown','system.shutdown');await response('agent-shutdown');await h.exit();
});

test('FAST_EDIT uses the adaptive evidence-bounded pipeline with canonical phases', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-fast-edit-integration-'));const projectRoot=path.join(dataDir,'project');await mkdir(path.join(projectRoot,'src'),{recursive:true});
  await writeFile(path.join(projectRoot,'src/config.js'),'export const columns = {\n  name: true,\n  stage: true,\n  status: true,\n};\n');
  await writeFile(path.join(projectRoot,'verify.cjs'),"const fs=require('node:fs');const value=fs.readFileSync('src/config.js','utf8');if(/stage/.test(value))process.exit(1);\n");
  for(const args of [['init'],['config','user.email','fixture@fielora.local'],['config','user.name','Fielora'],['add','.'],['commit','-m','fixture']])assert.equal(spawnSync('git',args,{cwd:projectRoot,windowsHide:true,stdio:'ignore'}).status,0);
  const h=harness(dataDir);t.after(async()=>{if(h.child.exitCode===null)killTestProcess(h.child.pid);await rm(dataDir,{recursive:true,force:true});});await hello(h);const notices=[];async function response(id){for(;;){const value=await h.next();if(value.id===id)return value;notices.push(value);}}
  h.send('fast-provider','command.provider.create_config',{provider_kind:'OPENAI_COMPATIBLE',display_name:'Fast fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture__',custom_endpoint_acknowledged:true});const provider=(await response('fast-provider')).result;t.after(()=>deleteTestCredential(provider.id));
  h.send('fast-credential','command.provider.store_credential',{provider_config_id:provider.id,secret:`fast-fixture-${randomUUID()}`});await response('fast-credential');
  h.send('fast-project','command.project.create',{title:'Fast Edit',goal:'Bounded pipeline',root_path:projectRoot});const project=(await response('fast-project')).result;
  h.send('fast-conversation','command.conversation.create',{field_id:project.field_id,title:'Fast Edit',provider_config_id:provider.id,model_id:'__fielora_agent_fixture__'});const conversation=(await response('fast-conversation')).result;
  const task='FIELORA_AGENT_FIXTURE_FAST_EDIT 删除列表中的 stage 字段配置';h.send('fast-message','command.conversation.message.create',{conversation_id:conversation.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null});await response('fast-message');
  h.send('fast-start','command.agent.start',{field_id:project.field_id,conversation_id:conversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture__',task,permission:'FULL_CONTROL',max_steps:8});const run=(await response('fast-start')).result;let finalRun;
  for(let attempt=0;attempt<120;attempt+=1){h.send(`fast-get-${attempt}`,'query.agent.get',{run_id:run.id});finalRun=(await response(`fast-get-${attempt}`)).result;if(['COMPLETED','FAILED','CANCELLED'].includes(finalRun.status))break;await new Promise((resolve)=>setTimeout(resolve,25));}
  assert.equal(finalRun.status,'COMPLETED');assert.equal(finalRun.current_step,2);assert.doesNotMatch(await readFile(path.join(projectRoot,'src/config.js'),'utf8'),/stage/);
  h.send('fast-tools','query.agent.tool_calls',{run_id:run.id});const tools=(await response('fast-tools')).result;assert.deepEqual(tools.map((tool)=>[tool.name,tool.status]),[['apply_patches','COMPLETED'],['run_command','COMPLETED'],['git_read','COMPLETED']]);
  h.send('fast-events','query.agent.events',{run_id:run.id,after_sequence:null,limit:500});const events=(await response('fast-events')).result;assert.equal(events.filter((event)=>event.kind==='MODEL_COMPLETED').length,2);const fastRunStarted=events.find((event)=>event.kind==='RUN_STARTED');assert.equal(fastRunStarted.payload.harness_profile,'CODING_V0.1');assert.equal(fastRunStarted.payload.harness_strategy,'FAST_EDIT_ADAPTIVE_V1');const phase=events.filter((event)=>event.kind==='PHASE_CHANGED').at(-1).payload;assert.equal(phase.active_phase,'FINALIZE');assert.deepEqual(phase.phases,{LOCATE:'SUCCEEDED',EDIT:'SUCCEEDED',VERIFY:'SUCCEEDED',FINALIZE:'SUCCEEDED'});assert.equal(events.some((event)=>event.kind==='RUN_COMPLETED'&&event.payload.completion_invariant_passed===true),true);
  await writeFile(path.join(projectRoot,'src/config.js'),'export const columns = {\n  name: true,\n  stage: true,\n  status: true,\n};\n');
  h.send('repair-conversation','command.conversation.create',{field_id:project.field_id,title:'Repair once',provider_config_id:provider.id,model_id:'__fielora_agent_fixture__'});const repairConversation=(await response('repair-conversation')).result;const repairTask='FIELORA_AGENT_FIXTURE_FAST_EDIT_CONFLICT_ONCE 删除列表中的 stage 字段配置';h.send('repair-start','command.agent.start',{field_id:project.field_id,conversation_id:repairConversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture__',task:repairTask,permission:'FULL_CONTROL',max_steps:8});const repairRun=(await response('repair-start')).result;let repairFinal;
  for(let attempt=0;attempt<120;attempt+=1){h.send(`repair-get-${attempt}`,'query.agent.get',{run_id:repairRun.id});repairFinal=(await response(`repair-get-${attempt}`)).result;if(['COMPLETED','FAILED','CANCELLED'].includes(repairFinal.status))break;await new Promise((resolve)=>setTimeout(resolve,25));}
  assert.equal(repairFinal.status,'COMPLETED');assert.equal(repairFinal.current_step,3);h.send('repair-tools','query.agent.tool_calls',{run_id:repairRun.id});const repairTools=(await response('repair-tools')).result;assert.equal(repairTools.filter((tool)=>tool.name==='apply_patches').length,2);assert.equal(repairTools.filter((tool)=>tool.name==='read_file').length,1);assert.equal(repairTools.find((tool)=>tool.name==='apply_patches').status,'FAILED');
  await writeFile(path.join(projectRoot,'src/config.js'),'export const columns = {\n  name: true,\n  stage: true,\n  status: true,\n};\n');
  h.send('stop-conversation','command.conversation.create',{field_id:project.field_id,title:'Stop after retry',provider_config_id:provider.id,model_id:'__fielora_agent_fixture__'});const stopConversation=(await response('stop-conversation')).result;const stopTask='FIELORA_AGENT_FIXTURE_FAST_EDIT_DOUBLE_CONFLICT 删除列表中的 stage 字段配置';h.send('stop-user','command.conversation.message.create',{conversation_id:stopConversation.id,role:'USER',content:stopTask,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null});const stopUser=(await response('stop-user')).result;h.send('stop-start','command.agent.start',{field_id:project.field_id,conversation_id:stopConversation.id,user_message_id:stopUser.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture__',task:stopTask,permission:'FULL_CONTROL',max_steps:8});const stopRun=(await response('stop-start')).result;let stopFinal;
  for(let attempt=0;attempt<120;attempt+=1){h.send(`stop-get-${attempt}`,'query.agent.get',{run_id:stopRun.id});stopFinal=(await response(`stop-get-${attempt}`)).result;if(['COMPLETED','FAILED','CANCELLED','PAUSED'].includes(stopFinal.status))break;await new Promise((resolve)=>setTimeout(resolve,25));}
  assert.equal(stopFinal.status,'PAUSED');
  h.send('stop-tools','query.agent.tool_calls',{run_id:stopRun.id});
  const stopTools=(await response('stop-tools')).result;
  assert.ok(stopTools.filter(tool=>tool.name==='apply_patches').length>=2);
  assert.ok(!stopTools.some(tool=>tool.effect==='WORKSPACE_WRITE'&&tool.status==='COMPLETED'));
  assert.match(await readFile(path.join(projectRoot,'src/config.js'),'utf8'),/stage/);
  h.send('stop-events','query.agent.events',{run_id:stopRun.id,after_sequence:null,limit:500});
  const stopEvents=(await response('stop-events')).result;
  assert.ok(stopEvents.some(event=>event.payload.kind==='STRATEGY_ESCALATED'&&event.payload.reason==='FAST_EDIT_PATCH_RETRY_EXHAUSTED'));
  assert.ok(!stopEvents.some(event=>['RUN_FAILED','RUN_COMPLETED'].includes(event.kind)));
  h.send('stop-messages','query.conversation.message.list',{conversation_id:stopConversation.id});
  const stopMessages=(await response('stop-messages')).result;
  assert.ok(!stopMessages.some(message=>message.invocation_id===stopRun.id&&message.status==='COMPLETED'));
  h.send('stop-cancel','command.agent.cancel',{run_id:stopRun.id});await response('stop-cancel');
  h.send('fast-shutdown','system.shutdown');await response('fast-shutdown');await h.exit();
});

test('Complete Agent reconciles a Core restart to PAUSED without replaying work', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-agent-recovery-'));const projectRoot=path.join(dataDir,'project');await mkdir(projectRoot,{recursive:true});let active;
  t.after(async()=>{if(active?.child.exitCode===null)killTestProcess(active.child.pid);await rm(dataDir,{recursive:true,force:true});});
  const first=harness(dataDir);active=first;await hello(first);const notices=[];async function response(h,id){for(;;){const value=await h.next();if(value.id===id)return value;notices.push(value);}}
  first.send('recovery-provider','command.provider.create_config',{provider_kind:'OPENAI_COMPATIBLE',display_name:'Recovery fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_slow__',custom_endpoint_acknowledged:true});const provider=(await response(first,'recovery-provider')).result;t.after(()=>deleteTestCredential(provider.id));
  first.send('recovery-credential','command.provider.store_credential',{provider_config_id:provider.id,secret:`recovery-${randomUUID()}`});await response(first,'recovery-credential');
  first.send('recovery-project','command.project.create',{title:'Recovery',goal:null,root_path:projectRoot});const project=(await response(first,'recovery-project')).result;
  first.send('recovery-conversation','command.conversation.create',{field_id:project.field_id,title:'Crash recovery',provider_config_id:provider.id,model_id:'__fielora_agent_fixture_slow__'});const conversation=(await response(first,'recovery-conversation')).result;
  first.send('recovery-start','command.agent.start',{field_id:project.field_id,conversation_id:conversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture_slow__',task:'Remain active across the crash',permission:'READ_ONLY',max_steps:4});const run=(await response(first,'recovery-start')).result;
  for(let attempt=0;attempt<30;attempt+=1){first.send(`recovery-running-${attempt}`,'query.agent.get',{run_id:run.id});if((await response(first,`recovery-running-${attempt}`)).result.status==='RUNNING')break;await new Promise((resolve)=>setTimeout(resolve,20));}
  first.send('recovery-first-shutdown','system.shutdown');await response(first,'recovery-first-shutdown');await first.exit();
  const second=harness(dataDir);active=second;await hello(second);second.send('recovery-get','query.agent.get',{run_id:run.id});const recovered=(await response(second,'recovery-get')).result;assert.equal(recovered.status,'PAUSED');assert.equal(recovered.error_code,'CORE_RESTARTED');
  second.send('recovery-events','query.agent.events',{run_id:run.id,after_sequence:null,limit:500});assert.ok((await response(second,'recovery-events')).result.some((event)=>event.kind==='RECOVERY_RECONCILED'));
  second.send('recovery-resume','command.agent.resume',{run_id:run.id});assert.equal((await response(second,'recovery-resume')).result.status,'RUNNING');second.send('recovery-cancel','command.agent.cancel',{run_id:run.id});await response(second,'recovery-cancel');
  let terminal=null;for(let attempt=0;attempt<50;attempt+=1){second.send(`recovery-terminal-${attempt}`,'query.agent.get',{run_id:run.id});terminal=(await response(second,`recovery-terminal-${attempt}`)).result;if(terminal.status==='CANCELLED')break;await new Promise((resolve)=>setTimeout(resolve,20));}assert.equal(terminal.status,'CANCELLED');
  second.send('pause-conversation','command.conversation.create',{field_id:project.field_id,title:'Durable pause',provider_config_id:provider.id,model_id:'__fielora_agent_fixture_slow__'});const pauseConversation=(await response(second,'pause-conversation')).result;
  second.send('pause-start','command.agent.start',{field_id:project.field_id,conversation_id:pauseConversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture_slow__',task:'Pause only at a safe boundary',permission:'READ_ONLY',max_steps:4});const pauseRun=(await response(second,'pause-start')).result;
  second.send('pause-command','command.agent.pause',{run_id:pauseRun.id});await response(second,'pause-command');let paused=null;for(let attempt=0;attempt<350;attempt+=1){second.send(`pause-get-${attempt}`,'query.agent.get',{run_id:pauseRun.id});paused=(await response(second,`pause-get-${attempt}`)).result;if(paused.status==='PAUSED')break;await new Promise((resolve)=>setTimeout(resolve,20));}assert.equal(paused.status,'PAUSED');
  killTestProcess(second.child.pid);await second.exit();
  const third=harness(dataDir);active=third;await hello(third);third.send('paused-after-restart','query.agent.get',{run_id:pauseRun.id});assert.equal((await response(third,'paused-after-restart')).result.status,'PAUSED');
  third.send('pause-resume','command.agent.resume',{run_id:pauseRun.id});assert.equal((await response(third,'pause-resume')).result.status,'RUNNING');third.send('pause-cancel','command.agent.cancel',{run_id:pauseRun.id});await response(third,'pause-cancel');
  let pauseTerminal=null;for(let attempt=0;attempt<80;attempt+=1){third.send(`pause-terminal-${attempt}`,'query.agent.get',{run_id:pauseRun.id});pauseTerminal=(await response(third,`pause-terminal-${attempt}`)).result;if(['CANCELLED','FAILED'].includes(pauseTerminal.status))break;await new Promise((resolve)=>setTimeout(resolve,20));}if(pauseTerminal.status!=='CANCELLED'){third.send('pause-failure-events','query.agent.events',{run_id:pauseRun.id,after_sequence:null,limit:500});assert.fail(JSON.stringify({run:pauseTerminal,events:(await response(third,'pause-failure-events')).result}));}third.send('pause-tools','query.agent.tool_calls',{run_id:pauseRun.id});assert.equal((await response(third,'pause-tools')).result.length,0);
  third.send('recovery-shutdown','system.shutdown');await response(third,'recovery-shutdown');await third.exit();
});

test('Recovered receipt-backed mutation completes only after fresh verification', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-agent-receipt-recovery-'));const projectRoot=path.join(dataDir,'project');await mkdir(projectRoot,{recursive:true});spawnSync('git',['init'],{cwd:projectRoot,windowsHide:true,stdio:'ignore'});let active;
  t.after(async()=>{if(active?.child.exitCode===null)killTestProcess(active.child.pid);await rm(dataDir,{recursive:true,force:true});});
  const notices=[];async function response(h,id){for(;;){const value=await h.next();if(value.id===id)return value;notices.push(value);}}
  const first=harness(dataDir);active=first;await hello(first);
  first.send('receipt-provider','command.provider.create_config',{provider_kind:'OPENAI_COMPATIBLE',display_name:'Receipt recovery fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_pause__',custom_endpoint_acknowledged:true});const provider=(await response(first,'receipt-provider')).result;t.after(()=>deleteTestCredential(provider.id));
  first.send('receipt-credential','command.provider.store_credential',{provider_config_id:provider.id,secret:`receipt-${randomUUID()}`});await response(first,'receipt-credential');
  first.send('receipt-project','command.project.create',{title:'Receipt recovery',goal:null,root_path:projectRoot});const project=(await response(first,'receipt-project')).result;
  first.send('receipt-conversation','command.conversation.create',{field_id:project.field_id,title:'Resume verified work',provider_config_id:provider.id,model_id:'__fielora_agent_fixture_pause__'});const conversation=(await response(first,'receipt-conversation')).result;
  first.send('receipt-start','command.agent.start',{field_id:project.field_id,conversation_id:conversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture_pause__',task:'FIELORA_AGENT_FIXTURE_CREATE',permission:'FULL_CONTROL',max_steps:8});const run=(await response(first,'receipt-start')).result;
  let createdTool=null;for(let attempt=0;attempt<150;attempt+=1){first.send(`receipt-tools-${attempt}`,'query.agent.tool_calls',{run_id:run.id});createdTool=(await response(first,`receipt-tools-${attempt}`)).result.find((tool)=>tool.name==='create_file'&&tool.status==='COMPLETED');if(createdTool)break;await new Promise((resolve)=>setTimeout(resolve,20));}assert.ok(createdTool?.receipt);first.send('receipt-pause','command.agent.pause',{run_id:run.id});await response(first,'receipt-pause');
  let paused=null;for(let attempt=0;attempt<150;attempt+=1){first.send(`receipt-paused-${attempt}`,'query.agent.get',{run_id:run.id});paused=(await response(first,`receipt-paused-${attempt}`)).result;if(paused.status==='PAUSED')break;await new Promise((resolve)=>setTimeout(resolve,20));}assert.equal(paused.status,'PAUSED');
  killTestProcess(first.child.pid);await first.exit();
  const second=harness(dataDir);active=second;await hello(second);second.send('receipt-restart-get','query.agent.get',{run_id:run.id});assert.equal((await response(second,'receipt-restart-get')).result.status,'PAUSED');second.send('receipt-resume','command.agent.resume',{run_id:run.id});assert.equal((await response(second,'receipt-resume')).result.status,'RUNNING');
  let finalRun=null;let sequence=0;for(let attempt=0;attempt<250;attempt+=1){second.send(`receipt-get-${attempt}`,'query.agent.get',{run_id:run.id});finalRun=(await response(second,`receipt-get-${attempt}`)).result;second.send(`receipt-events-${attempt}`,'query.agent.events',{run_id:run.id,after_sequence:sequence,limit:100});const events=(await response(second,`receipt-events-${attempt}`)).result;if(events.length)sequence=events.at(-1).sequence;for(const event of events.filter((item)=>item.kind==='APPROVAL_REQUESTED')){const approval=event.payload.approval;second.send(`receipt-approve-${approval.id}`,'command.agent.resolve_approval',{run_id:run.id,approval_id:approval.id,nonce:approval.nonce,decision:'ALLOW_ONCE'});await response(second,`receipt-approve-${approval.id}`);}if(['COMPLETED','FAILED','CANCELLED'].includes(finalRun.status))break;await new Promise((resolve)=>setTimeout(resolve,20));}
  assert.equal(finalRun.status,'COMPLETED');second.send('receipt-final-tools','query.agent.tool_calls',{run_id:run.id});const tools=(await response(second,'receipt-final-tools')).result;assert.equal(tools.filter((tool)=>tool.name==='create_file').length,1);const verification=tools.find((tool)=>tool.name==='run_command');assert.equal(verification.status,'COMPLETED');assert.equal(verification.receipt.verification_eligible,true);assert.match(verification.receipt.workspace_revision,/^[0-9a-f]{64}$/);second.send('receipt-final-events','query.agent.events',{run_id:run.id,after_sequence:null,limit:500});const events=(await response(second,'receipt-final-events')).result;assert.ok(events.some((event)=>event.kind==='RUN_RESUMED'));assert.ok(events.some((event)=>event.kind==='VERIFICATION_RECORDED'&&event.payload.workspace_revision===verification.receipt.workspace_revision));assert.ok(events.some((event)=>event.kind==='RUN_COMPLETED'&&event.payload.verification_passed===true));
  second.send('receipt-shutdown','system.shutdown');await response(second,'receipt-shutdown');await second.exit();
});

test('Interrupted verification becomes UNKNOWN and is rerun fresh before completion', async (t) => {
  const dataDir=await mkdtemp(path.join(tmpdir(),'fielora-agent-verification-recovery-'));const projectRoot=path.join(dataDir,'project');await mkdir(projectRoot,{recursive:true});await writeFile(path.join(projectRoot,'verify-slow.cjs'),'setTimeout(() => process.exit(0), 3000);\n');let active;
  t.after(async()=>{if(active?.child.exitCode===null)killTestProcess(active.child.pid);await rm(dataDir,{recursive:true,force:true});});const notices=[];async function response(h,id){for(;;){const value=await h.next();if(value.id===id)return value;notices.push(value);}}
  const first=harness(dataDir);active=first;await hello(first);first.send('verify-provider','command.provider.create_config',{provider_kind:'OPENAI_COMPATIBLE',display_name:'Interrupted verification fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture__',custom_endpoint_acknowledged:true});const provider=(await response(first,'verify-provider')).result;t.after(()=>deleteTestCredential(provider.id));first.send('verify-credential','command.provider.store_credential',{provider_config_id:provider.id,secret:`verify-${randomUUID()}`});await response(first,'verify-credential');first.send('verify-project','command.project.create',{title:'Interrupted verification',goal:null,root_path:projectRoot});const project=(await response(first,'verify-project')).result;first.send('verify-conversation','command.conversation.create',{field_id:project.field_id,title:'Fresh verification',provider_config_id:provider.id,model_id:'__fielora_agent_fixture__'});const conversation=(await response(first,'verify-conversation')).result;
  const task='FIELORA_AGENT_FIXTURE_CREATE FIELORA_AGENT_FIXTURE_INTERRUPTED_VERIFICATION';first.send('verify-start','command.agent.start',{field_id:project.field_id,conversation_id:conversation.id,provider_config_id:provider.id,model_id:'__fielora_agent_fixture__',task,permission:'FULL_CONTROL',max_steps:8});const run=(await response(first,'verify-start')).result;let interrupted=null;for(let attempt=0;attempt<200;attempt+=1){first.send(`verify-tools-${attempt}`,'query.agent.tool_calls',{run_id:run.id});interrupted=(await response(first,`verify-tools-${attempt}`)).result.find((tool)=>tool.name==='run_command'&&tool.status==='RUNNING');if(interrupted)break;await new Promise((resolve)=>setTimeout(resolve,20));}assert.ok(interrupted);killTestProcess(first.child.pid);await first.exit();
  const second=harness(dataDir);active=second;await hello(second);second.send('verify-recovered','query.agent.get',{run_id:run.id});assert.equal((await response(second,'verify-recovered')).result.status,'PAUSED');second.send('verify-unknown-tools','query.agent.tool_calls',{run_id:run.id});assert.equal((await response(second,'verify-unknown-tools')).result.find((tool)=>tool.id===interrupted.id).status,'UNKNOWN');second.send('verify-resume','command.agent.resume',{run_id:run.id});assert.equal((await response(second,'verify-resume')).result.status,'RUNNING');
  let finalRun=null;for(let attempt=0;attempt<300;attempt+=1){second.send(`verify-final-${attempt}`,'query.agent.get',{run_id:run.id});finalRun=(await response(second,`verify-final-${attempt}`)).result;if(['COMPLETED','FAILED','CANCELLED'].includes(finalRun.status))break;await new Promise((resolve)=>setTimeout(resolve,20));}assert.equal(finalRun.status,'COMPLETED');second.send('verify-final-tools','query.agent.tool_calls',{run_id:run.id});const tools=(await response(second,'verify-final-tools')).result;assert.equal(tools.filter((tool)=>tool.name==='create_file').length,1);const checks=tools.filter((tool)=>tool.name==='run_command');assert.equal(checks.length,2);assert.equal(checks[0].status,'FAILED');assert.equal(checks[0].error_code,'VERIFICATION_INTERRUPTED');assert.equal(checks[1].status,'COMPLETED');assert.equal(checks[1].receipt.verification_eligible,true);assert.match(checks[1].receipt.workspace_revision,/^[0-9a-f]{64}$/);second.send('verify-recovery-events','query.agent.events',{run_id:run.id,after_sequence:null,limit:500});const events=(await response(second,'verify-recovery-events')).result;for(const kind of ['TOOL_UNKNOWN','RECOVERY_STARTED','RECOVERY_RECONCILED','VERIFICATION_RECORDED','RUN_COMPLETED'])assert.ok(events.some((event)=>event.kind===kind),kind);second.send('verify-shutdown','system.shutdown');await response(second,'verify-shutdown');await second.exit();
});
