import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-computer-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(dataRoot, 'evidence');
const project = path.join(dataRoot, 'project'), targetRoot = path.join(dataRoot, 'native-target');
const q = JSON.stringify, output = [];
const expected = '原生电脑控制验收：这是一段超过二十个字符的中文输入🧭';
let child, target, cdp;
async function pause(ms) { await new Promise(resolve => setTimeout(resolve, ms)); }
async function stop() {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
  if (target) { await cleanupElectronProcess(target); target = null; }
}
try {
  await Promise.all([mkdir(project), mkdir(targetRoot), mkdir(evidence, { recursive: true })]);
  const targetEnv = { ...process.env }; delete targetEnv.ELECTRON_RUN_AS_NODE;
  target = spawn(createRequire(import.meta.url)('electron'), [path.join(root, 'tests/fixtures/computer-target.cjs'), targetRoot], { env: targetEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  target.stdout.on('data', value => output.push(value.toString()));
  target.stderr.on('data', value => output.push(value.toString()));
  let identity;
  for (let i = 0; i < 150; i++) {
    try { identity = JSON.parse(await readFile(path.join(targetRoot, 'target-ready.json'), 'utf8')); break; } catch { await pause(100); }
  }
  assert.ok(identity?.pid, 'Separate target app must become ready');
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { FIELORA_AGENT_COMPUTER_TARGET: String(identity.pid) } });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  await waitForExpression(cdp, "window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')", { output, timeoutMs: 120000 });
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_computer__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Native computer fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'Native computer acceptance',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Native computer control',provider_config_id:p.id,model_id:model});
    const task='Use the independent native acceptance application to enter text and save it; use the actual computer capability with scoped consent, not browser DOM automation.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {conversation:c.id,start:{field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:32,attachments:[]}};
  })()`);
  await cdp.send('Page.reload');
  await waitForExpression(cdp, `document.querySelector('[data-testid="conversation-${ids.conversation}"]')`, { output, timeoutMs: 30000 });
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  ids.run = (await cdp.eval(`window.fielora.agent.start(${q(ids.start)})`)).id;
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['WAITING_APPROVAL','PAUSED','FAILED'].includes(r.status))`, { output, timeoutMs: 60000 });
  const snapshot = () => cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(ids.run)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(ids.run)}}),events:await window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})}))()`);
  const before = await snapshot();
  await writeFile(path.join(evidence, 'before-consent.json'), q(before));
  assert.equal(before.run.status, 'WAITING_APPROVAL', q(before.run));
  assert.ok(before.tools.filter(t => t.name === 'computer' && t.arguments.action !== 'status').every(t => t.receipt == null), 'No application content before consent');
  await waitForExpression(cdp, "document.querySelector('[data-testid=operation-approval-preview]')?.textContent.includes('模型')", { output });
  const point = await cdp.eval(`(async()=>{
    const button=document.querySelector('[data-testid=agent-allow-once]');
    button.scrollIntoView({block:'center',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=button.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    if(button.disabled||!hit||!(hit===button||button.contains(hit)))throw new Error('Approval button must be visible and unobscured');
    return {x,y};
  })()`);
  await captureScreenshot(cdp, path.join(evidence, 'consent.png'));
  await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point});
  await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point});
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED','WAITING_APPROVAL'].includes(r.status) && r.current_step>3)`, { output, timeoutMs: 90000 });
  const result = await snapshot();
  await writeFile(path.join(evidence, 'run.json'), q(result));
  const native = result.tools.filter(t => t.name === 'computer'), last = result.tools.at(-1);
  if (last?.arguments?.reason?.startsWith('FIXTURE_NATIVE_FAILED:')) {
    await writeFile(path.join(evidence, 'validation.json'), q({ status: 'BLOCKED', scope: 'Actual OS capability failed; native input not verified.', reason: last.arguments.reason, run: ids.run }));
    throw new Error(last.arguments.reason);
  }
  assert.equal(result.run.error_code, 'AGENT_USER_INPUT_REQUIRED', q(result.run));
  assert.equal(last.arguments.reason, 'FIXTURE_NATIVE_INPUT_COMPLETE', q(last));
  assert.equal(result.events.filter(e => e.kind === 'APPROVAL_REQUESTED').length, 1, 'One consent per run/application/receiver');
  let bytes;
  for (let i = 0; i < 30; i++) { try { bytes = await readFile(path.join(targetRoot, 'native-result.txt'), 'utf8'); break; } catch { await pause(100); } }
  assert.equal(bytes, expected, 'Independent target wrote actual native Unicode input bytes');
  assert.ok(native.slice(1).every(t => t.receipt?.success === true), q(native.map(t => t.receipt?.error_code)));
  assert.ok(native.every(t => t.receipt?.verification_passed === false));
  assert.equal(await readFile(path.join(targetRoot,'native-save-count.txt'),'utf8'),'1');
  await cdp.eval(`(async()=>{
    const message=await window.fielora.conversation.createMessage({conversation_id:${q(ids.conversation)},role:'USER',content:'Continue the isolated acceptance by checking that a pre-pause native snapshot cannot be reused.',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return window.fielora.agent.resume({run_id:${q(ids.run)},user_message_id:message.id});
  })()`);
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>r.status==='PAUSED' && r.current_step>${result.run.current_step})`, {output,timeoutMs:60000});
  const resumed=await snapshot();
  await writeFile(path.join(evidence,'after-resume.json'),q(resumed));
  assert.equal(resumed.tools.at(-1).arguments.reason,'FIXTURE_NATIVE_STALE_REJECTED');
  assert.equal(resumed.tools.at(-2).receipt.error_code,'COMPUTER_STALE_SNAPSHOT');
  assert.equal(resumed.tools.at(-2).receipt.input_state,'NOT_DISPATCHED');
  assert.equal(await readFile(path.join(targetRoot,'native-save-count.txt'),'utf8'),'1','Resume must not reuse the pre-pause snapshot to click Save again');
  await writeFile(path.join(evidence, 'validation.json'), q({ status: 'PASS', run: ids.run, tools: resumed.tools.length, approval_count: 1, actual_unicode_bytes: Buffer.byteLength(bytes), pause_resume:'PRE_PAUSE_SNAPSHOT_REJECTED_ZERO_ADDITIONAL_INPUT', scope: 'Deterministic model through governed Core and macOS AX/CGEvent into a separate application process; actual Chinese/emoji saved bytes. CDP only controls isolated Fielora Shell, never native target. Not real-model or Windows acceptance.' }));
  console.log('COMPUTER_E2E=PASS evidence=' + evidence);
} catch (error) {
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(() => {});
  console.error(output.join('').slice(-1500)); throw error;
} finally { await stop(); }
