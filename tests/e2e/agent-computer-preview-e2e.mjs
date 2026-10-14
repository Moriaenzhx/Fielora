import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-computer-preview-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(dataRoot, 'evidence');
const project = path.join(dataRoot, 'project'), targetRoot = path.join(dataRoot, 'native-target');
const output = [], q = JSON.stringify;
let child, target, cdp, validationWritten = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function record(value) {
  await writeFile(path.join(evidence, 'validation.json'), JSON.stringify(value, null, 2));
  validationWritten = true;
}
async function click(testId) {
  await waitForExpression(cdp, `document.querySelector('[data-testid="${testId}"]')`, { output });
  const point = await cdp.eval(`(async()=>{
    const button=document.querySelector('[data-testid="${testId}"]');
    button.scrollIntoView({block:'center',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=button.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    if(button.disabled||!hit||!(hit===button||button.contains(hit)))throw new Error('Expected visible unblocked control');
    return {x,y};
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function preview(run, tool, capture = true) {
  let result;
  for (let attempt = 0; attempt < 8; attempt++) {
    result = await cdp.eval(`window.fielora.agent.computerPreview(${q({ run_id: run, tool_call_id: tool, capture })})`);
    if (result.error_code !== 'COMPUTER_BUSY') return result;
    await delay(150);
  }
  return result;
}
function unavailable(value, message) {
  assert.equal(value.state, 'UNAVAILABLE', message);
  assert.ok(value.error_code, message + ': a stable reason is required');
  assert.equal(value.image_data_url, undefined, message + ': no pixels');
}
async function pixelFacts(dataUrl) {
  return cdp.eval(`(async()=>{
    const image=new Image();image.src=${q(dataUrl)};await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    const data=context.getImageData(0,0,canvas.width,canvas.height).data;
    const colors=[[221,48,67],[44,180,124],[38,118,215],[244,187,50]],counts=[0,0,0,0];
    for(let i=0;i<data.length;i+=4)for(let j=0;j<colors.length;j++)if(colors[j].every((value,k)=>Math.abs(data[i+k]-value)<=8))counts[j]++;
    return {width:canvas.width,height:canvas.height,ratios:counts.map(count=>count/(canvas.width*canvas.height))};
  })()`);
}
async function stop() {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
  if (target) { await cleanupElectronProcess(target); target = null; }
}

try {
  assert.equal(process.platform, 'darwin', 'This test verifies actual macOS window capture; it does not substitute a screenshot on unsupported hosts');
  await Promise.all([mkdir(project), mkdir(targetRoot), mkdir(evidence, { recursive: true })]);
  const targetEnv = { ...process.env }; delete targetEnv.ELECTRON_RUN_AS_NODE;
  target = spawn(createRequire(import.meta.url)('electron'), [path.join(root, 'tests/fixtures/computer-preview-target.cjs'), targetRoot], {
    env: targetEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  target.stdout.on('data', value => output.push(value.toString()));
  target.stderr.on('data', value => output.push(value.toString()));
  let identity;
  for (let i = 0; i < 150; i++) {
    try { identity = JSON.parse(await readFile(path.join(targetRoot, 'target-ready.json'), 'utf8')); break; } catch { await delay(100); }
  }
  assert.ok(identity?.pid, 'Independent synthetic native window must be ready');
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { FIELORA_AGENT_COMPUTER_TARGET: String(identity.pid), FIELORA_AGENT_COMPUTER_PREVIEW_TEST: '1', FIELORA_DATA_DIR: path.join(dataRoot, 'Fielora'), FIELORA_E2E_USER_DATA: path.join(dataRoot, 'electron-profile') } });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  await waitForExpression(cdp, "window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')", { output, timeoutMs: 120000 });
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_computer__';
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Local native preview fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});
    const field=await window.fieloraTest.createProject({title:'Native preview acceptance',goal:null,root_path:${q(project)}});
    const result=[];
    for(const title of ['Native preview current conversation','Foreign preview conversation']){
      const conversation=await window.fielora.conversation.create({field_id:field.field_id,title,provider_config_id:provider.id,model_id:model});
      const task='Observe only the independent synthetic native preview application and wait while the local desktop preview is checked.';
      const message=await window.fielora.conversation.createMessage({conversation_id:conversation.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
      result.push({conversation:conversation.id,start:{field_id:field.field_id,conversation_id:conversation.id,user_message_id:message.id,provider_config_id:provider.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:20,attachments:[]}});
    }
    return result;
  })()`);
  const current = ids[0], foreign = ids[1];
  await waitForExpression(cdp, 'document.readyState==="complete"', { output });
  await cdp.send('Page.reload');
  await click(`conversation-${current.conversation}`);
  current.run = (await cdp.eval(`window.fielora.agent.start(${q(current.start)})`)).id;
  foreign.run = (await cdp.eval(`window.fielora.agent.start(${q(foreign.start)})`)).id;
  const snapshot = run => cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(run)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(run)}}),events:await window.fielora.agent.events({run_id:${q(run)},after_sequence:null,limit:500})}))()`);
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(current.run)}}).then(run=>['WAITING_APPROVAL','PAUSED','FAILED'].includes(run.status))`, { output, timeoutMs: 60000 });
  const before = await snapshot(current.run);
  await writeFile(path.join(evidence, 'before-consent.json'), JSON.stringify(before, null, 2));
  assert.equal(before.run.status, 'WAITING_APPROVAL', q(before.run));
  const status = before.tools.find(tool => tool.name === 'computer' && tool.arguments.action === 'status');
  assert.equal(status?.status, 'COMPLETED', 'Status must be a real completed capability call');
  assert.equal(status?.receipt?.kind, 'COMPUTER');
  assert.equal(typeof status?.receipt?.available, 'boolean', 'Status reports actual adapter readiness, not a successful content observation');
  const statusPreview = await preview(current.run, status.id);
  unavailable(statusPreview, 'Status enumeration must never authorize capture');
  // Direct fixture setup can finish while the initially selected conversation
  // is still loading. Enter each prepared conversation through the real UI so
  // its persisted approval is the visible source of truth before approving.
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(foreign.run)}}).then(run=>run.status==='WAITING_APPROVAL')`, { output, timeoutMs: 60000 });
  await click(`conversation-${foreign.conversation}`);
  await waitForExpression(cdp, 'document.querySelector(".conversation-heading h2")?.textContent==="Foreign preview conversation"&&document.querySelector("[data-testid=agent-allow-once]")', { output });
  await click(`conversation-${current.conversation}`);
  await waitForExpression(cdp, 'document.querySelector(".conversation-heading h2")?.textContent==="Native preview current conversation"&&document.querySelector("[data-testid=agent-allow-once]")', { output });
  await click('agent-allow-once');
  await waitForExpression(cdp, `window.fielora.agent.toolCalls({run_id:${q(current.run)}}).then(tools=>tools.some(tool=>tool.name==='run_command'&&tool.status==='RUNNING')||tools.some(tool=>tool.name==='request_user_input'))`, { output, timeoutMs: 60000 });
  const observed = await snapshot(current.run);
  const observation = observed.tools.find(tool => tool.name === 'computer' && tool.arguments.action === 'observe');
  if (!observation?.receipt?.success) {
    await record({ status: 'BLOCKED', reason: observation?.receipt?.error_code ?? observed.run.error_code, scope: 'Actual native observation failed; no substitute image or OS permission change used.' });
    throw new Error('Native observation unavailable: ' + q(observation?.receipt?.error_code));
  }
  const metadata = await preview(current.run, observation.id, false);
  assert.equal(metadata.state, 'AVAILABLE', q(metadata));
  assert.equal(metadata.image_data_url, undefined, 'Metadata-only query must not capture pixels');
  assert.equal(metadata.target.app_id, observation.receipt.target.app_id);
  assert.equal(metadata.snapshot_id, observation.receipt.snapshot_id);
  assert.ok(metadata.target.name, 'Application name comes from the native target identity');
  assert.match(metadata.icon_data_url, /^data:image\/png;base64,/, 'Native application icon must be returned');
  const foreignPreview = await preview(foreign.run, observation.id);
  unavailable(foreignPreview, 'Another Run must not borrow this observation');
  await waitForExpression(cdp, 'document.querySelector("[data-testid=application-preview] [aria-busy]")?.getAttribute("aria-busy")==="false"', { output });
  const frame = await preview(current.run, observation.id);
  if (frame.state !== 'AVAILABLE') {
    unavailable(frame, 'Unavailable capture must carry no pixels');
    await record({ status: 'BLOCKED', reason: frame.error_code, metadata: { name: metadata.target.name, bundle_id: metadata.target.bundle_id }, status_rejected: true, foreign_rejected: true,
      scope: 'Actual macOS capture unavailable; metadata and request binding checked, but native image and successful UI preview remain unverified. No OS permissions changed or synthetic image fallback used.' });
    await captureScreenshot(cdp, path.join(evidence, 'capture-blocked-ui.png'));
    throw new Error('Actual native window capture unavailable: ' + frame.error_code);
  }
  assert.match(frame.image_data_url, /^data:image\/png;base64,/);
  assert.ok(frame.width > 0 && frame.width <= 960 && frame.height > 0 && frame.height <= 640);
  assert.ok(frame.image_data_url.length <= 3 * 1024 * 1024, 'Window image is bounded');
  assert.ok(frame.captured_at, 'Preview must identify capture time');
  const pixels = await pixelFacts(frame.image_data_url);
  assert.equal(pixels.width, frame.width); assert.equal(pixels.height, frame.height);
  assert.ok(pixels.width / pixels.height > 1.25 && pixels.width / pixels.height < 1.5, 'Captured aspect ratio must match the synthetic window, not the whole display');
  assert.ok(pixels.ratios.every(ratio => ratio > 0.08), q(pixels));
  await writeFile(path.join(evidence, 'native-window.png'), Buffer.from(frame.image_data_url.split(',')[1], 'base64'));
  await waitForExpression(cdp, 'document.querySelector("[data-testid=application-preview-image]")?.naturalWidth>0', { output });
  await captureScreenshot(cdp, path.join(evidence, 'preview-visible.png'));
  const rendered = await pixelFacts(await cdp.eval('document.querySelector("[data-testid=application-preview-image]").src'));
  assert.ok(rendered.ratios.every(ratio => ratio > 0.08), 'Displayed image must contain the actual native target pixels');
  if (process.env.FIELORA_PACKAGED_EXE) {
    const originalSize = await cdp.eval('({width:Math.max(900,outerWidth),height:Math.max(620,outerHeight)})');
    await cdp.eval('window.fieloraTest.resizeWindow({width:900,height:640})');
    await waitForExpression(cdp, 'innerWidth<=900&&document.querySelector("[data-testid=application-preview-image]")?.naturalWidth>0', { output });
    const narrow = await cdp.eval(`(()=>{
      const panel=document.querySelector('[data-testid=application-preview]'),rect=panel.getBoundingClientRect();
      return {viewport:{width:innerWidth,height:innerHeight},panel:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},
        controls:[...panel.querySelectorAll('header button')].map(button=>{const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,hit:hit===button||button.contains(hit)}})};
    })()`);
    assert.ok(narrow.panel.left>=0&&narrow.panel.top>=0&&narrow.panel.right<=narrow.viewport.width&&narrow.panel.bottom<=narrow.viewport.height, q(narrow));
    assert.ok(narrow.panel.width/narrow.viewport.width<=0.5, 'Narrow preview must remain a secondary surface');
    assert.ok(narrow.controls.length===3&&narrow.controls.every(control=>control.hit&&control.left>=0&&control.top>=0&&control.right<=narrow.viewport.width&&control.bottom<=narrow.viewport.height), q(narrow));
    await captureScreenshot(cdp, path.join(evidence, 'preview-narrow.png'));
    await writeFile(path.join(evidence, 'narrow-layout.json'), JSON.stringify(narrow, null, 2));
    await cdp.eval(`window.fieloraTest.resizeWindow(${q(originalSize)})`);
  }
  await click('application-preview-minimize');
  await waitForExpression(cdp, '!document.querySelector("[data-testid=application-preview-image]")&&document.querySelector("[data-testid=application-preview-reopen]")', { output });
  await click('application-preview-reopen');
  await waitForExpression(cdp, 'document.querySelector("[data-testid=application-preview-image]")?.naturalWidth>0', { output });
  await click('application-preview-refresh');
  await waitForExpression(cdp, 'document.querySelector("[data-testid=application-preview-image]")?.naturalWidth>0', { output });
  await click('application-preview-close');
  await waitForExpression(cdp, '!document.querySelector("[data-testid=application-preview]")&&!document.querySelector("[data-testid=application-preview-image]")', { output });
  await click(`agent-application-preview-${observation.id}`);
  await waitForExpression(cdp, 'document.querySelector("[data-testid=application-preview-image]")?.naturalWidth>0', { output });
  await click(`conversation-${foreign.conversation}`);
  await waitForExpression(cdp, '!document.querySelector("[data-testid=application-preview]")&&!document.querySelector("[data-testid=application-preview-image]")', { output });
  await click(`conversation-${current.conversation}`);
  await waitForExpression(cdp, `window.fielora.agent.toolCalls({run_id:${q(current.run)}}).then(tools=>tools.filter(tool=>tool.name==='computer'&&tool.arguments.action==='observe'&&tool.receipt?.success).length===2)`, { output, timeoutMs: 100000 });
  const refreshed = await snapshot(current.run);
  const latest = refreshed.tools.filter(tool => tool.name === 'computer' && tool.arguments.action === 'observe').at(-1);
  const stalePreview = await preview(current.run, observation.id);
  unavailable(stalePreview, 'An earlier snapshot cannot capture the current target');
  assert.notEqual(latest.receipt.snapshot_id, observation.receipt.snapshot_id);
  await cdp.eval(`window.fielora.agent.pause({run_id:${q(current.run)}})`);
  // Pause cooperates at the existing command receipt boundary; unlike Stop it
  // does not interrupt the fixture process.
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(current.run)}}).then(run=>run.status==='PAUSED')`, { output, timeoutMs: 90000 });
  const pausedPreview = await preview(current.run, latest.id);
  unavailable(pausedPreview, 'A paused Run must not capture another frame');
  await waitForExpression(cdp, '!document.querySelector("[data-testid=application-preview-image]")', { output });
  const after = await snapshot(current.run);
  assert.doesNotMatch(q({ tools: after.tools, events: after.events }), /data:image\/(png|jpeg)|image_data_url|icon_data_url/, 'Local pixels and icons must never enter durable execution records');
  const manifests = after.events.map(event => event.payload?.prompt).filter(prompt => Array.isArray(prompt?.image_manifest));
  assert.ok(manifests.length > 0, 'Actual model input manifests must be available');
  assert.ok(manifests.every(manifest => manifest.image_count === 0 && manifest.image_manifest.length === 0), 'Local UI capture must never become a model image');
  await writeFile(path.join(evidence, 'run.json'), JSON.stringify(after, null, 2));
  // The second Run already exists, waiting for its own genuine observation
  // consent. Its fresh snapshot lets us exercise Stop concurrently with real OS
  // capture, without reviving or falsifying the paused Run's state.
  await click(`conversation-${foreign.conversation}`);
  await click('agent-allow-once');
  await waitForExpression(cdp, `window.fielora.agent.toolCalls({run_id:${q(foreign.run)}}).then(tools=>tools.some(tool=>tool.name==='run_command'&&tool.status==='RUNNING'))`, { output, timeoutMs: 60000 });
  const stopping = await snapshot(foreign.run);
  const stopObservation = stopping.tools.find(tool => tool.name === 'computer' && tool.arguments.action === 'observe' && tool.receipt?.success);
  assert.ok(stopObservation, 'Stop race requires a real current native observation');
  await waitForExpression(cdp, 'document.querySelector("[data-testid=application-preview-image]")?.naturalWidth>0', { output });
  // The initial UI capture has settled. Keep that visible frame while a direct
  // native capture overlaps Stop; an extra refresh would compete for the same
  // native single-flight slot and mask this race with COMPUTER_BUSY.
  const stopRace = await cdp.eval(`(async()=>{
    const request=${q({ run_id: foreign.run, tool_call_id: stopObservation.id, capture: true })};
    const started=performance.now();
    const capture=window.fielora.agent.computerPreview(request).then(view=>({
      elapsed_ms:performance.now()-started,state:view.state,error_code:view.error_code,has_pixels:Boolean(view.image_data_url)
    }));
    await new Promise(resolve=>setTimeout(resolve,20));
    const stopStarted=performance.now();
    const cancelled=await window.fielora.agent.cancel({run_id:${q(foreign.run)}});
    const stopFinished=performance.now();
    const result=await capture;
    return {cancel_status:cancelled.status,cancel_ms:stopFinished-stopStarted,cancel_started_ms:stopStarted-started,cancel_finished_ms:stopFinished-started,capture:result};
  })()`);
  stopRace.late_capture_result_check = stopRace.capture.elapsed_ms >= stopRace.cancel_finished_ms
    ? 'EXERCISED_AFTER_STOP_ACK' : 'NOT_EXERCISED_RESULT_PRECEDED_STOP_ACK';
  await writeFile(path.join(evidence, 'stop-race.json'), JSON.stringify(stopRace, null, 2));
  // Active cancellation acknowledges its signal with the current Run view;
  // durable CANCELLED follows when the existing execution loop exits.
  assert.ok(stopRace.cancel_ms < 1500, 'Stop must not wait for an in-flight window capture: ' + q(stopRace));
  if (stopRace.capture.elapsed_ms >= stopRace.cancel_finished_ms) {
    assert.equal(stopRace.capture.state, 'UNAVAILABLE', 'A capture settling after Stop acknowledgement cannot return pixels');
    assert.equal(stopRace.capture.has_pixels, false, 'Late capture pixels must be discarded');
  }
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(foreign.run)}}).then(run=>run.status==='CANCELLED')`, { output, timeoutMs: 10000 });
  await waitForExpression(cdp, '!document.querySelector("[data-testid=application-preview]")&&!document.querySelector("[data-testid=application-preview-image]")', { output });
  await cdp.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=application-preview-image]"))'), false, 'Settled late capture must not reopen a stopped preview');
  const stoppedPreview = await preview(foreign.run, stopObservation.id);
  unavailable(stoppedPreview, 'Stopped Run cannot obtain another frame');
  const cancelledSnapshot = await snapshot(foreign.run);
  assert.doesNotMatch(q({ tools: cancelledSnapshot.tools, events: cancelledSnapshot.events }), /data:image\/(png|jpeg)|image_data_url|icon_data_url/, 'Concurrent capture does not persist its pixels');
  await writeFile(path.join(evidence, 'cancelled-run.json'), JSON.stringify(cancelledSnapshot, null, 2));
  await writeFile(path.join(evidence, 'stop-race.json'), JSON.stringify(stopRace, null, 2));
  await record({ status: 'PASS', run: current.run, native_target: { name: metadata.target.name, bundle_id: metadata.target.bundle_id }, pixels,
    status_rejected: statusPreview.error_code, foreign_rejected: foreignPreview.error_code, stale_rejected: stalePreview.error_code, paused_rejected: pausedPreview.error_code, stopped_rejected: stoppedPreview.error_code, stop_race: stopRace,
    scope: 'Deterministic model through real governed macOS observation and single-window capture, rendered by isolated Electron. Real mouse controls verify minimize, reopen, refresh, close and conversation isolation. Concurrent native capture/Stop measures response latency; late_capture_result_check states whether the late direct-query rejection assertion actually ran. UI close/switch/terminal clearing is checked, but this run does not force a delayed React callback. Measured timing does not prove every OS capture delay. No OS permission changes, native target DOM automation, production data or real model used. Windows and normally launched production Fielora acceptance remain separate.' });
  console.log('COMPUTER_PREVIEW_E2E=PASS evidence=' + evidence);
} catch (error) {
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(() => {});
  if (!validationWritten) await record({ status: 'FAIL', error: String(error.message), scope: 'No fake image or OS permission fallback used.' }).catch(() => {});
  console.error(output.join('').slice(-1500));
  throw error;
} finally { await stop(); }
