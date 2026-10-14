import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess, CdpConnection } from './harness/electron-cdp-harness.mjs';

// Deterministic model-boundary probe. The agent gets real screenshot PNGs from
// the production AgentModelRequest, chooses all coordinates by decoding those
// pixels, and invokes the ordinary governed native tool. This is not a live LLM
// acceptance or a test of an external provider's HTTP adapter.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-computer-visual-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-computer-visual-evidence-'));
const targetRoot = path.join(dataRoot, 'target'), project = path.join(dataRoot, 'project');
const output = [], requests = [], frames = [], feedback = [], q = JSON.stringify;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
let child, target, cdp, debugPort, targetPid, targetSetup, runId, previous, visual, staleSnapshot;
let stepIndex = 0, failure = null, stopReady = false, releaseFinal;
const finalHold = new Promise(resolve => { releaseFinal = resolve; });

const offscreen = process.env.FIELORA_VISUAL_WINDOW_MODE === 'offscreen';
const steps = offscreen ? [
  { name: 'capability_status', args: { filter: { text: 'computer' } } },
  { action: 'status' }, { action: 'observe' }, { action: 'screenshot', flags: 0 },
  { action: 'activate' }, { action: 'screenshot', flags: 0 },
  { action: 'click', leftmost: true, rejected: 'COMPUTER_TARGET_OFFSCREEN' },
  { action: 'screenshot', flags: 0 }, { action: 'move', tile: 0 },
  { action: 'screenshot', flags: 0 }, { action: 'click', tile: 0 },
  { action: 'screenshot', flags: 1 },
] : [
  { name: 'capability_status', args: { filter: { text: 'computer' } } },
  { action: 'status' }, { action: 'observe' }, { action: 'screenshot', flags: 0 },
  { action: 'activate' }, { action: 'screenshot', flags: 0 },
  { action: 'move', tile: 0 }, { action: 'screenshot', flags: 0 },
  { action: 'click', tile: 0 }, { action: 'screenshot', flags: 1 },
  { action: 'click', tile: 1 }, { action: 'screenshot', flags: 1 },
  { action: 'type', text: 'VISUAL-INPUT-42' }, { action: 'screenshot', flags: 2 },
  { action: 'press', key: 'enter' }, { action: 'screenshot', flags: 3 },
  { action: 'scroll', tile: 2, direction: 'down', amount: 3 }, { action: 'screenshot', flags: 4 },
  { action: 'drag', tile: 3, endTile: 4 }, { action: 'screenshot', flags: 5 },
  { action: 'click', tile: 5, click_count: 2 }, { action: 'screenshot', flags: 6 },
  { action: 'move', tile: 0, saveStale: true },
  { action: 'click', tile: 0, stale: true }, { action: 'screenshot', flags: 6 },
];
function computerReceipt(request) {
  for (const message of [...request.tool_results].reverse()) {
    if (message.name !== 'computer') continue;
    const line = message.content.split('\n').find(value => value.startsWith('Native desktop receipt: '));
    if (line) return JSON.parse(line.slice('Native desktop receipt: '.length));
  }
  return null;
}
async function pixelLocations(dataUrl) {
  // Decode only the model-delivered image in the Fielora renderer. No target
  // DOM, AX coordinates, window bounds or private snapshot geometry is read.
  return cdp.eval(`(async()=>{
    const image=new Image();image.src=${q(dataUrl)};await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;
    const colors=[[221,48,67],[38,118,215],[44,180,124],[149,84,222],[244,187,50],[239,127,38]];
    const boxes=colors.map(()=>({minX:canvas.width,minY:canvas.height,maxX:0,maxY:0,count:0})),flags=new Uint8Array(canvas.width*canvas.height);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;
      colors.forEach((color,j)=>{if(color.every((v,k)=>Math.abs(bytes[i+k]-v)<=5)){const b=boxes[j];b.minX=Math.min(b.minX,x);b.minY=Math.min(b.minY,y);b.maxX=Math.max(b.maxX,x);b.maxY=Math.max(b.maxY,y);b.count++;}});
      if(bytes[i]<=24&&Math.abs(bytes[i+1]-210)<=20&&Math.abs(bytes[i+2]-210)<=20)flags[y*canvas.width+x]=1;
    }
    // Native Retina downsampling changes a few edge columns. Identify actual
    // 2D cyan rectangles, so edge ringing or isolated pixels cannot add flags.
    const components=[],queue=new Int32Array(flags.length);
    for(let seed=0;seed<flags.length;seed++)if(flags[seed]){
      let head=0,tail=1,minX=canvas.width,maxX=0,minY=canvas.height,maxY=0;queue[0]=seed;flags[seed]=0;
      while(head<tail){const p=queue[head++],x=p%canvas.width,y=Math.floor(p/canvas.width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const n of [x>0?p-1:-1,x+1<canvas.width?p+1:-1,y>0?p-canvas.width:-1,y+1<canvas.height?p+canvas.width:-1])if(n>=0&&flags[n]){flags[n]=0;queue[tail++]=n;}
      }
      const width=maxX-minX+1,height=maxY-minY+1;
      if(tail>1000&&width>60&&height>20)components.push({pixels:tail,width,height});
    }
    return {width:canvas.width,height:canvas.height,complete:components.length,components,tiles:boxes.map(b=>({x:Math.round((b.minX+b.maxX)/2),y:Math.round((b.minY+b.maxY)/2),pixels:b.count}))};
  })()`);
}
async function overlayTarget(title) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  return targets.find(item => item.type === 'page' && item.title === title);
}
async function sampleFeedback(action, expected) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await overlayTarget('Fielora Computer Pointer');
    if (entry) {
      const overlay = new CdpConnection(entry.webSocketDebuggerUrl); await overlay.open();
      try {
        const value = await overlay.eval(`(()=>{const e=document.querySelector('[data-testid=computer-pointer-feedback]');return e?{action:e.dataset.action,x:e.dataset.x,y:e.dataset.y,visibility:document.visibilityState}:null})()`);
        if (value?.action === action && value.visibility === 'visible') {
          assert.ok(Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)));
          assert.ok(Math.abs(Number(value.x) - Number(action === 'drag' ? expected.end_x : expected.x)) <= 1);
          assert.ok(Math.abs(Number(value.y) - Number(action === 'drag' ? expected.end_y : expected.y)) <= 1);
          if (!feedback.some(item => item.action === action)) await captureScreenshot(overlay, path.join(evidence, `pointer-${action}.png`));
          feedback.push(value); return;
        }
      } finally { overlay.close(); }
    }
    await delay(40);
  }
}
async function decide(request) {
  assert.ok(Array.isArray(request.images) && Array.isArray(request.tool_results) && Array.isArray(request.tools), 'Fixture hook must expose the actual model request boundary');
  assert.ok(!q(request.tool_results).includes('data:image'), 'Pixels are separate multimodal input, never ToolResult text');
  const receipt = computerReceipt(request);
  requests.push({ index: requests.length, image_count: request.images.length, tool_results: request.tool_results.length, tools: request.tools.map(tool => tool.name), previous_action: previous?.action ?? previous?.name ?? null });
  if (previous?.action) {
    if (previous.action === 'status') {
      assert.ok(Array.isArray(receipt?.applications), q(receipt));
      assert.ok(receipt.applications.some(app => Number(app.target?.pid) === targetPid && String(app.target?.app_id) === String(targetPid)), 'Target PID must come from actual status inventory');
    } else if (previous.stale || previous.rejected) {
      assert.equal(receipt.success, false); assert.equal(receipt.error_code, previous.rejected ?? 'COMPUTER_STALE_SNAPSHOT');
      assert.notEqual(receipt.input_state, 'DISPATCHED');
    } else {
      assert.equal(receipt?.success, true, q(receipt));
    }
    if (previous.action === 'observe') {
      assert.equal(request.images.length, 0, 'Local preview and AX observe must not become model image input');
      assert.ok(!JSON.stringify(receipt.elements ?? []).includes('CLICK ONCE'), 'Canvas target has no semantic button fallback');
    }
    if (previous.action === 'screenshot') {
      const expected = receipt.screenshot?.content_sha256;
      assert.ok(expected, 'Screenshot receipt must identify its image digest');
      const image = request.images.find(image => image.mime_type === 'image/png' && sha(Buffer.from(image.data_url.split(',')[1], 'base64')) === expected);
      assert.ok(image, 'Exact captured PNG must reach the next AgentModelRequest');
      const file = `model-image-${String(frames.length).padStart(2, '0')}.png`;
      await writeFile(path.join(evidence, file), Buffer.from(image.data_url.split(',')[1], 'base64'));
      const pixels = await pixelLocations(image.data_url);
      frames.push({ file, sha256: expected, snapshot_id: receipt.snapshot_id, pixels });
      assert.equal(pixels.width, receipt.width); assert.equal(pixels.height, receipt.height);
      assert.equal(pixels.width, 820); assert.equal(pixels.height, 660, 'Screenshot includes the full native window and titlebar');
      assert.ok(pixels.tiles.every(tile => tile.pixels > 2000), q(pixels));
      assert.equal(pixels.complete, previous.flags, 'The next visual observation must show the actual input result');
      visual = { snapshot: receipt.snapshot_id, pixels };
    }
    if (['move', 'click', 'drag', 'scroll'].includes(previous.action) && !previous.stale && !previous.rejected) {
      assert.equal(receipt.input_feedback?.coordinate_space, 'SCREEN_POINTS');
      await sampleFeedback(previous.action, receipt.input_feedback);
    }
  }
  if (stepIndex >= steps.length) {
    stopReady = true;
    // Hold one ordinary model turn while the test clicks the real global Stop.
    // The hook must cancel this request; a timeout is an explicit test failure.
    await finalHold;
    return { text: '', tool_calls: [] };
  }
  const step = steps[stepIndex++];
  let args = step.args;
  if (step.action) {
    args = { action: step.action };
    if (step.action !== 'status') args.app_id = String(targetPid);
    if (!['status', 'observe', 'screenshot', 'activate'].includes(step.action)) {
      assert.ok(visual, 'No input decision before the model has received pixels');
      args.snapshot_id = step.stale ? staleSnapshot : visual.snapshot;
      if (step.saveStale) staleSnapshot = visual.snapshot;
      if (step.tile !== undefined) Object.assign(args, { x: visual.pixels.tiles[step.tile].x, y: visual.pixels.tiles[step.tile].y });
      if (step.leftmost) {
        const point = [...visual.pixels.tiles].sort((a, b) => a.x - b.x || a.y - b.y)[0];
        Object.assign(args, { x: point.x, y: point.y });
      }
      if (step.endTile !== undefined) Object.assign(args, { end_x: visual.pixels.tiles[step.endTile].x, end_y: visual.pixels.tiles[step.endTile].y });
      for (const key of ['text', 'key', 'direction', 'amount', 'click_count']) if (step[key] !== undefined) args[key] = step[key];
    }
  }
  previous = step;
  return { text: '', tool_calls: [{ id: `visual-${stepIndex}`, name: step.name ?? 'computer', arguments: args }] };
}
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    const parts = []; let bytes = 0;
    for await (const part of request) { bytes += part.length; assert.ok(bytes <= 16 * 1024 * 1024, 'Bounded fixture request'); parts.push(part); }
    const result = await decide(JSON.parse(Buffer.concat(parts).toString('utf8')));
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(q(result));
  } catch (error) {
    failure = error;
    response.writeHead(500, { 'Content-Type': 'application/json' }); response.end('{"error":"VISUAL_FIXTURE_ASSERTION_FAILED"}');
  }
});
async function click(cdp, selector) {
  await waitForExpression(cdp, `document.querySelector(${q(selector)})`, { output });
  const point = await cdp.eval(`(async()=>{const e=document.querySelector(${q(selector)});e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;const hit=document.elementFromPoint(x,y);if(e.disabled||!e.contains(hit))throw new Error('Control not reachable');return{x,y};})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
}

try {
  assert.equal(process.platform, 'darwin', 'This acceptance requires actual macOS screenshot/input');
  await Promise.all([mkdir(targetRoot), mkdir(project), mkdir(evidence, { recursive: true })]);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const targetEnv = { ...process.env }; delete targetEnv.ELECTRON_RUN_AS_NODE;
  target = spawn(createRequire(import.meta.url)('electron'), [path.join(root, 'tests/fixtures/computer-visual-target.cjs'), targetRoot], { env: targetEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  target.stdout.on('data', chunk => output.push(String(chunk))); target.stderr.on('data', chunk => output.push(String(chunk)));
  for (let i = 0; i < 150; i++) {
    try { targetSetup = JSON.parse(await readFile(path.join(targetRoot, 'target-ready.json'), 'utf8')); targetPid = targetSetup.pid; break; } catch { await delay(100); }
  }
  assert.ok(targetPid);
  assert.equal(targetSetup.nativeTitlebar, true);
  if (offscreen) assert.ok(targetSetup.bounds.x < Math.min(...targetSetup.displays.map(display => display.x)) - 200, 'Actual fixture window must be partially beyond all displays');
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { FIELORA_DATA_DIR: path.join(dataRoot, 'Fielora'), FIELORA_E2E_USER_DATA: path.join(dataRoot, 'electron-profile'), FIELORA_AGENT_COMPUTER_VISUAL_FIXTURE_URL: `http://127.0.0.1:${server.address().port}/` } });
  child = launched.child; debugPort = launched.port;
  cdp = await connectToFieloraApp({ port: debugPort, output, enablePage: true, timeoutMs: 120000 });
  await waitForExpression(cdp, 'window.fieloraTest&&window.fielora.core.getHealth().then(h=>h.state==="READY")', { output });
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_computer_visual__';const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Deterministic visual model boundary fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});const f=await window.fieloraTest.createProject({title:'Canvas native visual acceptance',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Visual canvas and pointer feedback',provider_config_id:p.id,model_id:model});
    const task='In the independent synthetic canvas application PID ${targetPid}, use screenshots to locate visible controls and perform one click, text input, Enter, scrolling, dragging and double-clicking. Observe actual results. The test will exercise one stale input rejection and use Stop after completion.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return{conversation:c.id,start:{field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:64,attachments:[]}};
  })()`);
  await waitForExpression(cdp, 'document.readyState==="complete"', { output });
  await cdp.eval('window.__visualBeforeReload=true'); await cdp.send('Page.reload');
  await waitForExpression(cdp, '!window.__visualBeforeReload&&document.readyState==="complete"&&window.fieloraTest', { output });
  await click(cdp, `[data-testid="conversation-${ids.conversation}"]`);
  runId = (await cdp.eval(`window.fielora.agent.start(${q(ids.start)})`)).id;
  const approvalTexts = [], approvalIds = new Set();
  for (let attempt = 0; attempt < 900 && !stopReady; attempt++) {
    if (failure) throw failure;
    const state = await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(runId)}}),events:await window.fielora.agent.events({run_id:${q(runId)},after_sequence:null,limit:500})}))()`);
    if (['FAILED', 'CANCELLED', 'PAUSED'].includes(state.run.status)) throw new Error('Visual run ended before the observed result: ' + q(state.run));
    if (state.run.status === 'WAITING_APPROVAL') {
      const event = [...state.events].reverse().find(item => item.kind === 'APPROVAL_REQUESTED');
      const id = event?.payload?.approval?.id;
      if (id && !approvalIds.has(id)) {
        assert.ok(approvalIds.size < 2, 'Only AX then WINDOW_IMAGE observation consents are expected');
        await waitForExpression(cdp, 'document.querySelector("[data-testid=agent-allow-once]")', { output });
        const text = await cdp.eval('document.querySelector("[data-testid=agent-approval]").innerText');
        approvalTexts.push(text); approvalIds.add(id);
        if (approvalIds.size === 2) assert.match(text, /截图|图像|窗口画面/);
        await captureScreenshot(cdp, path.join(evidence, `approval-${approvalIds.size}.png`));
        await click(cdp, '[data-testid=agent-allow-once]');
      }
    }
    await delay(100);
  }
  if (failure) throw failure;
  assert.equal(stopReady, true, 'Bounded full visual sequence must reach observed completion');
  assert.equal(approvalIds.size, 2, 'Image consent is separate from prior AX-only consent');
  assert.equal(frames.at(-1).pixels.complete, offscreen ? 1 : 6);
  const actual = JSON.parse(await readFile(path.join(targetRoot, 'target-state.json'), 'utf8'));
  assert.equal(actual.clicks, 1);
  if (!offscreen) {
    assert.equal(actual.text, 'VISUAL-INPUT-42'); assert.equal(actual.submitted, true);
    assert.ok(actual.scrolls > 0); assert.equal(actual.dragged, true); assert.equal(actual.doubleClicks, 1);
  }
  assert.ok(actual.events.length > (offscreen ? 3 : 12) && actual.events.every(event => event.trusted), 'Actual OS input must produce trusted target events');
  for (const action of offscreen ? ['move', 'click'] : ['move', 'click', 'scroll', 'drag']) assert.ok(feedback.some(item => item.action === action), `Actual global pointer feedback must be visible for ${action}`);
  const controlTarget = await overlayTarget('Fielora Computer Control'); assert.ok(controlTarget, 'User must have a global Stop control');
  const control = new CdpConnection(controlTarget.webSocketDebuggerUrl); await control.open();
  try {
    await waitForExpression(control, 'document.querySelector("[data-testid=computer-control-stop]")', { output });
    await captureScreenshot(control, path.join(evidence, 'global-control.png'));
    await click(control, '[data-testid=computer-control-stop]');
  } finally { control.close(); }
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${q(runId)}}).then(r=>r.status==='CANCELLED')`, { output, timeoutMs: 10000 });
  releaseFinal();
  await delay(200);
  const finalState = JSON.parse(await readFile(path.join(targetRoot, 'target-state.json'), 'utf8'));
  assert.deepEqual(finalState, actual, 'No native target input is allowed after Stop');
  const records = await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(runId)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(runId)}}),events:await window.fielora.agent.events({run_id:${q(runId)},after_sequence:null,limit:500})}))()`);
  assert.ok(!q(records).includes('data:image') && !q(records).includes('iVBORw0KGgo'), 'Durable tool/event projections must exclude pixels');
  const database = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'), { readOnly: true });
  try {
    const durable = [...database.prepare('SELECT payload_json FROM agent_events WHERE run_id=?').all(runId), ...database.prepare('SELECT arguments_json,receipt_json FROM agent_tool_calls WHERE run_id=?').all(runId)];
    assert.ok(!q(durable).includes('data:image') && !q(durable).includes('iVBORw0KGgo'), 'Actual SQLite ledger must exclude image payloads');
  } finally { database.close(); }
  await writeFile(path.join(evidence, 'run.json'), JSON.stringify(records, null, 2));
  await writeFile(path.join(evidence, 'validation.json'), JSON.stringify({ status: 'PASS', run_id: runId, scope: 'Actual macOS screenshots, model-request-boundary pixels and native input against independent canvas; deterministic pixel locator, not a real LLM or external provider wire test. No target DOM/AX geometry decisions. Synthetic test screenshots saved only as acceptance evidence.', mode: offscreen ? 'PARTIALLY_OFFSCREEN' : 'FULL_VISUAL_SEQUENCE', setup: targetSetup, approvalTexts, requests, frames, feedback, target: actual }, null, 2));
  console.log(`COMPUTER_VISUAL_E2E=PASS evidence=${evidence}`);
} catch (error) {
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(() => {});
  await readFile(path.join(targetRoot, 'target-state.json')).then(value => writeFile(path.join(evidence, 'target-failure.json'), value)).catch(() => {});
  if (cdp && runId) await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(runId)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(runId)}}),events:await window.fielora.agent.events({run_id:${q(runId)},after_sequence:null,limit:500})}))()`).then(value => writeFile(path.join(evidence, 'run-failure.json'), JSON.stringify(value, null, 2))).catch(() => {});
  await writeFile(path.join(evidence, 'validation.json'), JSON.stringify({ status: 'FAIL', error: String(failure ?? error), run_id: runId, stepIndex, requests, frames, feedback }, null, 2)).catch(() => {});
  console.error(output.join('').slice(-2400)); throw failure ?? error;
} finally {
  releaseFinal();
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); }
  await cleanupElectronProcess(child); await cleanupElectronProcess(target);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(evidence, 'electron.log'), output.join('')).catch(() => {});
  await rm(dataRoot, { recursive: true, force: true });
}
