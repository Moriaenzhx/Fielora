import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';
import { deleteTestCredential } from '../support/platform.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-intervention-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-intervention/dev'));
const output = []; const providers = []; let child; let cdp; let project;
const j = JSON.stringify;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs: 60000, output });
async function launch() {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
  });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, timeoutMs: 120000, enablePage: true });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function restart() {
  await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true');
  await Promise.race([new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(Error('App did not exit normally')), 15000))]);
  cdp.close(); cdp = null; await cleanupElectronProcess(child); child = null;
  await launch();
}
async function provider(model) {
  const result = await cdp.eval(`(async()=>{const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:${j(model)},base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',default_model:${j(model)},custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});return p})()`);
  providers.push(result); return result;
}
async function conversation(p, title) {
  return cdp.eval(`window.fielora.conversation.create({field_id:${j(project.field_id)},title:${j(title)},provider_config_id:${j(p.id)},model_id:${j(p.default_model)}})`);
}
async function start(p, c, task, permission = 'FULL_CONTROL') {
  return cdp.eval(`(async()=>{const m=await window.fielora.conversation.createMessage({conversation_id:${j(c.id)},role:'USER',content:${j(task)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return window.fielora.agent.start({field_id:${j(project.field_id)},conversation_id:m.conversation_id,user_message_id:m.id,provider_config_id:${j(p.id)},model_id:${j(p.default_model)},task:${j(task)},permission:${j(permission)},max_steps:20})})()`);
}
async function snapshot(id) {
  return cdp.eval(`(async()=>{const run_id=${j(id)};return {run:await window.fielora.agent.get({run_id}),tools:await window.fielora.agent.toolCalls({run_id}),events:await window.fielora.agent.events({run_id,after_sequence:null,limit:500})}})()`);
}
async function show(c) {
  await cdp.eval('window.__interventionReload=true'); await cdp.send('Page.reload');
  await wait("typeof window.__interventionReload==='undefined' && window.fieloraTest");
  await wait(`document.querySelector('[data-testid="conversation-${c.id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${c.id}"]').click()`);
  await wait('document.querySelector(".conversation-composer textarea")');
}
async function queue(text) {
  await cdp.eval(`(()=>{const el=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${j(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait("document.querySelector('[data-testid=\"send-steering\"]') && !document.querySelector('[data-testid=\"send-steering\"]').disabled");
  await cdp.eval("document.querySelector('[data-testid=\"send-steering\"]').click()");
  await wait(`Array.from(document.querySelectorAll('[data-testid="queued-follow-up-card"]')).some(el=>el.textContent.includes(${j(text)}))`);
}
async function stopped(id) { await wait(`window.fielora.agent.get({run_id:${j(id)}}).then(r=>r.status==='CANCELLED')`); }

try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(projectRoot, 'verify-direction.cjs'), "const a=require('node:assert/strict'),f=require('node:fs');a.equal(f.readFileSync(process.argv[2],'utf8'),'verified direction\\n');console.log('direction file verified');\n");
  assert.equal(spawnSync('git', ['init'], { cwd: projectRoot }).status, 0);
  await launch();
  project = await cdp.eval(`window.fieloraTest.createProject({title:'任务控制回归',goal:null,root_path:${j(projectRoot)}})`);
  const slow = await provider('__fielora_agent_fixture_slow__');
  const direction = await provider('__fielora_agent_fixture_intervention__');
  const c = await conversation(slow, '停止后保留队列');
  const run = await start(slow, c, '回答一条简单问题。');
  await show(c);
  await queue('下一条独立任务：简短回答。');
  await cdp.eval("document.querySelector('[data-testid=\"stop-agent\"]').click()");
  await stopped(run.id);
  await wait("document.querySelector('[data-testid=\"queued-follow-up-status\"]')?.textContent.includes('等待你继续处理')");
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${j(c.id)}})`)).length, 1);
  await restart(); await show(c);
  await wait("document.querySelector('[data-testid=\"queued-follow-up-card\"]')?.textContent.includes('下一条独立任务')");
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${j(c.id)}})`)).length, 1);
  await captureScreenshot(cdp, path.join(evidence, 'stopped-queue-restored.png'));
  await cdp.eval("document.querySelector('[data-testid=\"queued-follow-up-apply\"]').click()");
  await wait(`window.fielora.agent.list({conversation_id:${j(c.id)}}).then(r=>r.length===2&&r.some(x=>x.status==='COMPLETED'))`);
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=\"queued-follow-up-card\"]').length"), 0);
  await writeFile(path.join(evidence, 'stop.json'), j(await snapshot(run.id)));

  // A real pending write approval is invalidated by the same-Run direction.
  const corrected = await conversation(direction, '纠正待批准的旧动作');
  const original = await start(direction, corrected, '创建 old-direction.txt 并检查文件内容。', 'READ_ONLY');
  await wait(`window.fielora.agent.get({run_id:${j(original.id)}}).then(r=>r.status==='WAITING_APPROVAL')`);
  const before = await snapshot(original.id);
  const oldApproval = before.events.find(e => e.kind === 'APPROVAL_REQUESTED').payload.approval;
  await show(corrected);
  await queue('改为创建 new-direction.txt，不要创建 old-direction.txt，并检查文件内容。');
  await cdp.eval("document.querySelector('[data-testid=\"queued-follow-up-apply\"]').click()");
  await wait(`window.fielora.agent.events({run_id:${j(original.id)},after_sequence:null,limit:500}).then(e=>e.some(x=>x.payload.kind==='USER_DIRECTION_RECEIVED'))`);
  const admitted = await snapshot(original.id);
  const receipt = admitted.events.find(e => e.payload.kind === 'USER_DIRECTION_RECEIVED');
  assert.equal(receipt.payload.resource_budget_reset, undefined);
  assert.equal(admitted.run.max_steps, original.max_steps);
  assert.equal(admitted.run.task, original.task);
  assert.equal(admitted.tools.find(t => t.id === oldApproval.tool_call_id).status, 'CANCELLED');
  const rejected = await cdp.eval(`window.fielora.agent.resolveApproval({run_id:${j(original.id)},approval_id:${j(oldApproval.id)},nonce:${j(oldApproval.nonce)},decision:'ALLOW_ONCE'}).then(()=>false,()=>true)`);
  assert.equal(rejected, true);
  // READ_ONLY is the stable wire value for the user-facing approval preset.
  // New proposals still require the unchanged policy after correction.
  await wait(`window.fielora.agent.get({run_id:${j(original.id)}}).then(r=>r.status==='WAITING_APPROVAL')`);
  let state = await snapshot(original.id);
  const freshApproval = state.events.filter(e => e.kind === 'APPROVAL_REQUESTED').at(-1).payload.approval;
  assert.notEqual(freshApproval.id, oldApproval.id);
  assert.equal(state.tools.find(t => t.id === freshApproval.tool_call_id).arguments.path, 'new-direction.txt');
  await restart(); await show(corrected);
  const restored = await snapshot(original.id);
  assert.equal(restored.events.filter(e => e.payload.kind === 'USER_DIRECTION_RECEIVED').length, 1);
  assert.equal(restored.tools.find(t => t.id === freshApproval.tool_call_id).status, 'WAITING_APPROVAL');
  if (restored.run.status === 'PAUSED') await cdp.eval(`window.fielora.agent.resume({run_id:${j(original.id)}})`);
  await cdp.eval(`window.fielora.agent.resolveApproval({run_id:${j(original.id)},approval_id:${j(freshApproval.id)},nonce:${j(freshApproval.nonce)},decision:'ALLOW_ONCE'})`);
  await wait(`window.fielora.agent.get({run_id:${j(original.id)}}).then(r=>r.status==='WAITING_APPROVAL')`);
  state = await snapshot(original.id);
  const verifyApproval = state.events.filter(e => e.kind === 'APPROVAL_REQUESTED').at(-1).payload.approval;
  assert.equal(state.tools.find(t => t.id === verifyApproval.tool_call_id).name, 'run_command');
  await cdp.eval(`window.fielora.agent.resolveApproval({run_id:${j(original.id)},approval_id:${j(verifyApproval.id)},nonce:${j(verifyApproval.nonce)},decision:'ALLOW_ONCE'})`);
  await wait(`window.fielora.agent.get({run_id:${j(original.id)}}).then(r=>r.status==='COMPLETED')`);
  state = await snapshot(original.id);
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${j(corrected.id)}})`)).length, 1);
  assert.equal(await readFile(path.join(projectRoot, 'new-direction.txt'), 'utf8'), 'verified direction\n');
  await assert.rejects(access(path.join(projectRoot, 'old-direction.txt')));
  const duplicate = await cdp.eval(`window.fielora.agent.resume({run_id:${j(original.id)},direction_message_id:${j(receipt.payload.user_message_id)}})`);
  assert.equal(duplicate.next_sequence, state.run.next_sequence);
  assert.equal(duplicate.status, 'COMPLETED');
  await writeFile(path.join(evidence, 'direction.json'), JSON.stringify(state, null, 2));
  await captureScreenshot(cdp, path.join(evidence, 'direction-completed.png'));

  // Simulate the durable state left by a lost admission acknowledgement. The
  // UI must reconcile the actual ledger, not replay this consumed message.
  await cdp.eval(`localStorage.setItem('fielora:queued-follow-ups:${corrected.id}',JSON.stringify([{id:'lost-ack',messageId:${j(receipt.payload.user_message_id)},content:'改为创建 new-direction.txt，不要创建 old-direction.txt，并检查文件内容。',afterRunId:${j(original.id)},selectedFilePath:null,permission:'READ_ONLY',createdAt:Date.now()}]));localStorage.setItem('fielora:queued-follow-ups-paused:${corrected.id}','true')`);
  await show(corrected);
  // Reload restores the queue before the asynchronous Run projection. Wait
  // for the intended completed Run and its enabled continuation action;
  // merely finding the button can dispatch against an unhydrated selection.
  await wait(`document.querySelector('[data-agent-run-id="${original.id}"]')?.dataset.agentState === 'COMPLETED' && (()=>{const button=document.querySelector('[data-testid="queued-follow-up-apply"]');return button && !button.disabled && button.textContent.includes('继续处理')})()`);
  await cdp.eval("document.querySelector('[data-testid=\"queued-follow-up-apply\"]').click()");
  await wait("!document.querySelector('[data-testid=\"queued-follow-up-card\"]')");
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${j(corrected.id)}})`)).length, 1);
  assert.equal((await snapshot(original.id)).run.next_sequence, state.run.next_sequence);

  const approvalStop = await conversation(direction, '等待审批也能停止');
  const approvalRun = await start(direction, approvalStop, '创建 old-direction.txt 并检查文件内容。', 'READ_ONLY');
  await wait(`window.fielora.agent.get({run_id:${j(approvalRun.id)}}).then(r=>r.status==='WAITING_APPROVAL')`);
  await show(approvalStop);
  await wait("document.querySelector('[data-testid=\"stop-agent\"]') && !document.querySelector('[data-testid=\"stop-agent\"]').disabled");
  await cdp.eval("document.querySelector('[data-testid=\"stop-agent\"]').click()");
  await stopped(approvalRun.id);
  await assert.rejects(access(path.join(projectRoot, 'old-direction.txt')));

  const auto = await conversation(slow, '完成后自动接续');
  await start(slow, auto, '先回答第一个问题。');
  await show(auto); await queue('再回答第二个问题。');
  await wait(`window.fielora.agent.list({conversation_id:${j(auto.id)}}).then(r=>r.length===2&&r.every(x=>x.status==='COMPLETED'))`);
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=\"queued-follow-up-card\"]').length"), 0);

  // Stop must remain usable while the UI is waiting for a safe direction boundary.
  const racing = await conversation(slow, '纠正等待中停止');
  const active = await start(slow, racing, '回答即可。');
  await show(racing); await queue('不要继续旧任务，回答新的问题。');
  await cdp.eval("document.querySelector('[data-testid=\"queued-follow-up-apply\"]').click()");
  await wait("document.querySelector('[data-testid=\"queued-follow-up-status\"]')?.textContent.includes('正在等待')");
  assert.equal(await cdp.eval("document.querySelector('[data-testid=\"stop-agent\"]').disabled"), false);
  await cdp.eval("document.querySelector('[data-testid=\"stop-agent\"]').click()");
  await stopped(active.id);
  const race = await snapshot(active.id);
  assert.equal(race.events.filter(e => e.payload.kind === 'USER_DIRECTION_RECEIVED').length, 0);
  await wait("document.querySelector('[data-testid=\"queued-follow-up-apply\"]')?.textContent.includes('继续处理')");
  await cdp.eval("document.querySelector('[aria-label=\"删除排队消息\"]').click()");
  await wait("!document.querySelector('[data-testid=\"queued-follow-up-card\"]')");
  await restart(); await show(racing);
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${j(racing.id)}})`)).length, 1);
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=\"queued-follow-up-card\"]').length"), 0);
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ status: 'PASS', provider: 'deterministic fixture; no external calls', sameRun: original.id,
    stopPreservesQueue: true, restartPreservesHold: true, explicitQueueContinuation: true, staleApprovalRejected: true,
    correctionReachesActualModelInput: true, fileContentVerified: true, stopWhileBusy: true, deletedQueueDoesNotReturn: true,
    directionRestoredAfterRestart: true, lostAcknowledgementDoesNotReplay: true, completedQueueAutoContinues: true, stopWhileAwaitingApproval: true }, null, 2));
  console.log('AGENT_INTERVENTION_E2E=PASS');
} catch (error) {
  if (cdp && project) await writeFile(path.join(evidence, 'failure-runs.json'), JSON.stringify(await cdp.eval(`(async()=>{const cs=await window.fielora.conversation.list({field_id:${j(project.field_id)}});return Promise.all(cs.map(async c=>({conversation:c,runs:await window.fielora.agent.list({conversation_id:c.id})})))})()`).catch(() => null), null, 2)).catch(() => {});
  if (cdp) { await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(() => {});
    await writeFile(path.join(evidence, 'failure-ui.txt'), await cdp.eval('document.body.innerText').catch(() => '')).catch(() => {}); }
  throw error;
} finally {
  await writeFile(path.join(evidence, 'electron.log'), output.join('')).catch(() => {});
  cdp?.close(); await cleanupElectronProcess(child);
  for (const p of providers) deleteTestCredential(p.id);
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
}
