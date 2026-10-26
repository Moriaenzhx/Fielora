import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { CdpConnection, launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-dialog-'));
const project = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(dataRoot, 'evidence'));
const q = JSON.stringify, output = [];
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>Dialog recovery fixture</title>
    <style>body{font:18px system-ui;padding:40px}button{padding:24px}</style>
    <button onclick="clicks++;result.textContent=(confirm('Isolated confirmation: no external effects')?'accepted:':'cancelled:')+clicks">Confirm fixture</button>
    <output id="result">initial</output><script>let clicks=0;</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let child, cdp, page, port;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 60000 });
async function launch() {
  const app = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { FIELORA_AGENT_BROWSER_FIXTURE_URL: url } });
  child = app.child; port = app.port;
  cdp = await connectToFieloraApp({ port, output, enablePage: true, timeoutMs: 120000 });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.eval('window.fieloraTest.resizeWindow({width:1478,height:900})');
}
async function stop() {
  page?.close(); page = null;
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
}
const snapshot = id => cdp.eval(`(async()=>{const run_id=${q(id)};return {run:await window.fielora.agent.get({run_id}),tools:await window.fielora.agent.toolCalls({run_id}),events:await window.fielora.agent.events({run_id,after_sequence:null,limit:500})};})()`);
async function startCase(label) {
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_browser_dialog__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:${q(label)},base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:${q(label)},goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:${q(label)},provider_config_id:p.id,model_id:model});
    const task='Exercise the isolated browser confirm dialog and observe cancellation without claiming task completion.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {conversation:c.id,start:{field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:20,attachments:[]}};
  })()`);
  await cdp.send('Page.reload');
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  ids.run = (await cdp.eval(`window.fielora.agent.start(${q(ids.start)})`)).id;
  await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>r.status==='PAUSED')`);
  const ready = await snapshot(ids.run);
  assert.equal(ready.tools.at(-1).arguments.reason, 'FIXTURE_READY_TO_CLICK');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const observedUrl = ready.tools.find(t => t.name === 'browser' && t.arguments.action === 'open').receipt.url;
  const candidates = targets.filter(t => t.url === observedUrl);
  assert.equal(candidates.length, 1, 'Unique same-Run observed URL identifies the actual target'); page?.close();
  page = new CdpConnection(candidates[0].webSocketDebuggerUrl); await page.open();
  await page.send('Page.enable');
  await cdp.eval(`(async()=>{
    const m=await window.fielora.conversation.createMessage({conversation_id:${q(ids.conversation)},role:'USER',content:'Continue the isolated dialog check.',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return window.fielora.agent.resume({run_id:${q(ids.run)},user_message_id:m.id});
  })()`);
  await wait(`window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500}).then(es=>es.some(e=>e.payload.kind==='BROWSER_DIALOG_WAIT'&&e.payload.state==='OPEN'))`);
  await wait("document.querySelector('[data-testid=agent-current-action]')?.textContent.includes('网页弹窗')");
  return ids;
}
try {
  await mkdir(project); await mkdir(evidence, { recursive: true }); await launch();
  const first = await startCase('Dialog wait');
  const before = await snapshot(first.run); const elapsed = await cdp.eval("document.querySelector('.agent-elapsed')?.textContent");
  await new Promise(resolve => setTimeout(resolve, 31500));
  const waiting = await snapshot(first.run);
  await writeFile(path.join(evidence, 'waiting.json'), q(waiting));
  assert.equal(waiting.run.status, 'RUNNING'); assert.equal(waiting.tools.at(-1).status, 'RUNNING');
  assert.equal(waiting.events.filter(e => e.kind === 'MODEL_STARTED').length, before.events.filter(e => e.kind === 'MODEL_STARTED').length);
  assert.equal(await cdp.eval("document.querySelector('.agent-elapsed')?.textContent"), elapsed, 'human wait is not displayed as execution time');
  await page.send('Page.handleJavaScriptDialog', { accept: false });
  await wait(`window.fielora.agent.get({run_id:${q(first.run)}}).then(r=>r.status==='PAUSED')`);
  const done = await snapshot(first.run); await writeFile(path.join(evidence, 'completed-input.json'), q(done));
  assert.equal(done.run.error_code, 'AGENT_USER_INPUT_REQUIRED');
  assert.equal(done.tools.at(-1).arguments.reason, 'FIXTURE_DIALOG_VERIFIED');
  const click = done.tools.find(t => t.name === 'browser' && t.arguments.action === 'click');
  assert.equal(click.status, 'COMPLETED'); assert.equal(click.receipt.input_state, 'DISPATCHED');
  assert.ok(click.receipt.human_wait_ms >= 31000);
  assert.equal(await page.eval('clicks'), 1);
  assert.equal(done.events.filter(e => e.payload.kind === 'BROWSER_INPUT_DELIVERY_ACKNOWLEDGED').length, 1);
  await captureScreenshot(cdp, path.join(evidence, 'after-dialog.png'));
  page.close(); page = null;
  const second = await startCase('Dialog stop');
  await cdp.eval(`window.fielora.agent.cancel({run_id:${q(second.run)}})`);
  await wait(`window.fielora.agent.get({run_id:${q(second.run)}}).then(r=>r.status==='CANCELLED')`);
  await page.send('Page.handleJavaScriptDialog', { accept: false });
  await wait(`window.fielora.agent.events({run_id:${q(second.run)},after_sequence:null,limit:500}).then(es=>es.some(e=>e.payload.kind==='BROWSER_INPUT_DELIVERY_ACKNOWLEDGED'))`);
  const stopped = await snapshot(second.run); await writeFile(path.join(evidence, 'stopped-late.json'), q(stopped));
  assert.equal(stopped.run.status, 'CANCELLED'); assert.equal(await page.eval('clicks'), 1);
  assert.equal(stopped.tools.filter(t => t.name === 'browser' && t.arguments.action === 'click').length, 1);
  const steps = stopped.events.filter(e => e.kind === 'MODEL_STARTED').length;
  await stop(); await launch();
  const cold = await snapshot(second.run); await writeFile(path.join(evidence, 'cold.json'), q(cold));
  assert.equal(cold.run.status, 'CANCELLED'); assert.equal(cold.tools.length, stopped.tools.length);
  assert.equal(cold.events.filter(e => e.kind === 'MODEL_STARTED').length, steps);
  assert.equal(cold.events.filter(e => e.payload.kind === 'BROWSER_INPUT_DELIVERY_ACKNOWLEDGED').length, 1);
  await writeFile(path.join(evidence, 'summary.json'), q({ status: 'PASS', dataRoot, longNativeWait: true, actualClicks: [1, 1], lateAckNoResume: true, coldNoReplay: true,
    build: done.events.find(e => e.payload.kind === 'EXECUTION_BUILD_PROVENANCE')?.payload }));
  console.log('BROWSER_DIALOG_RECOVERY=PASS');
} catch (error) {
  await writeFile(path.join(evidence, 'failure.txt'), `${error.stack}\n${output.join('')}`); throw error;
} finally { await stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
