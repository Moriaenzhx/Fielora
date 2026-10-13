import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot, pollUntil } from './harness/electron-cdp-harness.mjs';

// Actual Electron/Core persistence and native Chromium input. The documents and
// typed references are deterministic UI fixtures, not a claim of model output.
const root = path.resolve(import.meta.dirname, '../..'), q = JSON.stringify;
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-prototype-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-prototype-evidence-'));
const output = [], contexts = new Map(), frameSessions = new Map(), downloads = [], networkRequests = [], udpRequests = [], browserLogs = [], navigationAttempts = [], navigationOutcomes = [], inheritedDocumentProbes = [];
let child, cdp, ids, securityProbe;
const hash = content => createHash('sha256').update(content).digest('hex');
const card = id => `[data-testid="interactive-prototype"][data-reference-id="${id}"]`;
const frameSelector = id => `${card(id)} [data-testid="prototype-frame"]`;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 45000 });
const network = createServer((request, response) => {
  networkRequests.push(request.url);
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<html><body id="network-escape">NETWORK ESCAPE</body></html>');
});
await new Promise(resolve => network.listen(0, '127.0.0.1', resolve));
const networkUrl = `http://127.0.0.1:${network.address().port}`;
const udp = createSocket('udp4');
udp.on('message', packet => udpRequests.push(packet.length));
await new Promise(resolve => udp.bind(0, '127.0.0.1', resolve));
const stunUrl = `stun:127.0.0.1:${udp.address().port}`;

const demo = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>拾梦交互原型</title><style>body{margin:0;background:#f8f4fd;color:#312743;font:17px system-ui;padding:24px;box-sizing:border-box}h1{font-size:25px}input,button{font:inherit;padding:10px 14px;border:1px solid #d9cbe7;border-radius:10px}input{width:55%;background:white}button{background:#7451a1;color:white;cursor:pointer}nav{margin:18px 0}#reflection{background:white;padding:18px;border-radius:12px}#result{margin-top:16px;min-height:25px}</style>
<body id="fixture-demo"><h1>拾梦 · 梦境解读</h1><p>从几个梦的片段，发现新的联想。</p>
<label>你梦见了什么？ <input id="dream" placeholder="海边、飞起来"></label> <button id="interpret">解读这个梦</button>
<nav><button id="switch">切换到情绪回顾</button></nav><section id="reflection">民俗趣解（娱乐参考）</section><output id="result"></output>
<script>document.querySelector('#interpret').addEventListener('click',()=>{document.querySelector('#result').textContent='你记录了：'+document.querySelector('#dream').value});document.querySelector('#switch').addEventListener('click',()=>{document.querySelector('#reflection').textContent='情绪回顾：醒来时你的感受是什么？'});document.body.dataset.ready='true';</script></body></html>`;

const security = `<!doctype html><html><meta charset="utf-8"><title>Isolation probes</title><style>body{font:16px system-ui;padding:16px}button,a{display:inline-block;margin:5px;padding:8px;border:1px solid #888}pre{font-size:11px;white-space:pre-wrap}</style>
<body id="fixture-security"><h1>Isolation probes</h1><button id="navigate">Self navigation</button><button id="popup">Popup</button><button id="top">Parent navigation</button><a id="download" download="must-not-download.txt" href="data:text/plain,blocked-download">Download</a><form action="${networkUrl}/form" method="post"><button id="submit">Submit form</button></form><pre id="probes"></pre>
<script>
const denied=fn=>{try{fn();return false}catch{return true}};
const probes={navigationAttempts:0,downloadClicked:false,formAttempt:false,node:typeof process==='undefined'&&typeof require==='undefined'&&typeof Buffer==='undefined',bridge:typeof window.fielora==='undefined'&&typeof window.fieloraTest==='undefined',parentDom:denied(()=>parent.document.body.dataset.compromised='yes'),parentBridge:denied(()=>parent.fielora),localStorage:denied(()=>localStorage.setItem('escaped','1')),sessionStorage:denied(()=>sessionStorage.setItem('escaped','1')),cookie:denied(()=>document.cookie='escaped=1')};
document.querySelector('#navigate').onclick=()=>{probes.navigationAttempts++;console.info('prototype-navigation-attempt',window.attackTarget);render();try{location.href=window.attackTarget}catch{}};
document.querySelector('#popup').onclick=()=>{probes.popup=window.open('${networkUrl}/popup')===null;render()};
document.querySelector('#top').onclick=()=>{probes.top=denied(()=>top.location.href='${networkUrl}/top');render()};
document.querySelector('#download').onclick=()=>{probes.downloadClicked=true;render()};
document.querySelector('#submit').onclick=()=>{probes.formAttempt=true;render()};
function render(){document.querySelector('#probes').textContent=JSON.stringify(probes)}
fetch('${networkUrl}/fetch').then(()=>{probes.fetch=false;render()},()=>{probes.fetch=true;render()});
const img=new Image();img.src='${networkUrl}/image';document.body.append(img);
const nested=document.createElement('iframe');nested.src='${networkUrl}/nested';document.body.append(nested);
const style=document.createElement('link');style.rel='stylesheet';style.href='${networkUrl}/style';document.head.append(style);
try{indexedDB.open('escaped');probes.indexedDB=false}catch{probes.indexedDB=true}
try{probes.webRTCStage='construct';const peer=new RTCPeerConnection({iceServers:[{urls:'${stunUrl}'}]});probes.webRTCStage='channel';peer.createDataChannel('egress');probes.webRTCStage='offer';peer.createOffer().then(offer=>{probes.webRTCStage='local-description';return peer.setLocalDescription(offer)}).then(()=>{probes.webRTC='offer-created';render();setTimeout(()=>peer.close(),1500)},error=>{probes.webRTC=error.name;render()})}catch(error){probes.webRTC=error.name}
render();document.body.dataset.ready='true';
</script></body></html>`;

async function launch() {
  contexts.clear(); frameSessions.clear();
  const x = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = x.child;
  cdp = await connectToFieloraApp({ port: x.port, output, enablePage: true, timeoutMs: 120000 });
  cdp.socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (value.method === 'Runtime.executionContextCreated') contexts.set(`${value.sessionId??''}:${value.params.context.id}`, { ...value.params.context, sessionId:value.sessionId });
    if (value.method === 'Runtime.executionContextDestroyed') contexts.delete(`${value.sessionId??''}:${value.params.executionContextId}`);
    if (value.method === 'Runtime.executionContextsCleared') for (const [key,context] of contexts) if (context.sessionId===value.sessionId) contexts.delete(key);
    if (value.method === 'Page.downloadWillBegin' || value.method === 'Browser.downloadWillBegin') downloads.push(value.params);
    if (value.method === 'Log.entryAdded') browserLogs.push(value.params.entry);
    if (value.method === 'Runtime.consoleAPICalled' && value.params.args[0]?.value==='prototype-navigation-attempt') navigationAttempts.push(value.params.args[1]?.value);
  });
  // Re-enable after subscribing so existing main-world context identities are known.
  await cdp.send('Runtime.disable'); await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await wait('window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==="READY")');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1050, deviceScaleFactor: 1, mobile: false });
}
async function stop() {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
}
function sendSession(sessionId, method, params = {}) {
  if (!sessionId) return cdp.send(method, params);
  const id = ++cdp.id;
  return new Promise((resolve,reject) => {
    const timeout = setTimeout(()=>{cdp.pending.delete(id);reject(new Error(`Frame CDP timeout: ${method}`))},10000);
    cdp.pending.set(id,{resolve:r=>{clearTimeout(timeout);resolve(r)},reject:e=>{clearTimeout(timeout);reject(e)}});
    cdp.socket.send(JSON.stringify({id,sessionId,method,params}));
  });
}
async function evaluateFrame(contextKey, expression) {
  const context = contexts.get(contextKey);
  if (!context) throw new Error(`Frame context disappeared: ${contextKey}`);
  const r = await sendSession(context.sessionId, 'Runtime.evaluate', { contextId:context.id, expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function frameContext(id, fixture) {
  const url = await cdp.eval(`document.querySelector(${q(frameSelector(id))})?.src`);
  return pollUntil(async () => {
    // Sandboxed custom-protocol documents may be out-of-process frames. Attach
    // through CDP, never weaken the production frame's origin to inspect it.
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const target of targetInfos.filter(t=>t.type==='iframe'&&t.url===url)) {
      if (frameSessions.has(target.targetId)) continue;
      const { sessionId } = await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      frameSessions.set(target.targetId,sessionId);
      await sendSession(sessionId,'Runtime.enable'); await sendSession(sessionId,'Log.enable');
    }
    for (const [contextId, context] of contexts) {
      if (!context.auxData?.isDefault) continue;
      try { if (await evaluateFrame(contextId, `location.href===${q(url)}&&document.body?.id===${q(fixture)}&&document.body.dataset.ready==='true'`)) return contextId; } catch {}
    }
    return false;
  }, { timeoutMs: 15000, intervalMs: 70, errorMessage: () => `Prototype frame did not execute: ${url}; contexts=${q([...contexts.values()])}` });
}
async function mouse(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function click(selector) {
  await cdp.eval(`document.querySelector(${q(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  let previous = '', stable = 0;
  const box = await pollUntil(async()=>{
    const point=await cdp.eval(`(()=>{const e=document.querySelector(${q(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`);
    const identity=q(point); stable=identity===previous ? stable+1 : 0; previous=identity;
    return point.hit && stable>=3 ? point : false;
  },{timeoutMs:5000,intervalMs:50,errorMessage:`App control did not settle: ${selector}`});
  await cdp.send('Page.captureScreenshot', { format:'png' });
  await mouse(box.x, box.y);
}
async function clickFrame(id, contextId, selector) {
  await cdp.eval(`document.querySelector(${q(frameSelector(id))}).scrollIntoView({block:'center',behavior:'instant'})`);
  await evaluateFrame(contextId, `document.querySelector(${q(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await evaluateFrame(contextId, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const frame = await cdp.eval(`(()=>{const r=document.querySelector(${q(frameSelector(id))}).getBoundingClientRect();return{x:r.x,y:r.y}})()`);
  const box = await evaluateFrame(contextId, `(()=>{const r=document.querySelector(${q(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  assert.equal(await evaluateFrame(contextId, `Boolean(document.elementFromPoint(${box.x},${box.y})?.closest(${q(selector)}))`), true, `Native target is obscured: ${selector}`);
  // Let Chromium commit the newly revealed OOPIF surface before native input.
  await cdp.send('Page.captureScreenshot', { format:'png' });
  await mouse(frame.x + box.x, frame.y + box.y);
}
async function open(id, fixture) {
  await click(`${card(id)} [data-testid="prototype-open"]`);
  await wait(`document.querySelector(${q(frameSelector(id))})`);
  return frameContext(id, fixture);
}
async function rejectPreview(relativePath, expectedHash, expectedCode) {
  const error = await cdp.eval(`window.fielora.workspace.previewPrototype({field_id:${q(ids.field)},relative_path:${q(relativePath)},expected_sha256:${q(expectedHash)}}).then(()=>null,e=>String(e.message))`);
  assert.ok(error?.includes(expectedCode), `${relativePath}: ${error}`);
}
async function verifyLocalDocument(frameId) {
  const contextKey=await pollUntil(()=>[...contexts].find(([,context])=>context.auxData?.isDefault&&context.auxData.frameId===frameId)?.[0],
    {timeoutMs:5000,intervalMs:50,errorMessage:'Local opaque document context is missing'});
  const inspect=()=>evaluateFrame(contextKey, `(async()=>{
    const refusal=fn=>{try{fn();return 'ALLOWED'}catch(error){return error.name}};
    const result={origin:self.origin,node:typeof require!=='undefined'||typeof process!=='undefined',bridge:typeof window.fielora!=='undefined',parent:refusal(()=>parent.document.body),parentBridge:refusal(()=>parent.fielora),localStorage:refusal(()=>localStorage.setItem('escaped','1')),sessionStorage:refusal(()=>sessionStorage.setItem('escaped','1')),cookie:refusal(()=>document.cookie='escaped=1'),indexedDB:refusal(()=>indexedDB.open('escaped')),inline:window.__replacementInline===true};
    result.rtcStage='construct';try{const p=new RTCPeerConnection({iceServers:[{urls:${q(stunUrl)}}]});result.rtcStage='offer';p.createDataChannel('egress');await p.setLocalDescription(await p.createOffer());result.rtc='ALLOWED';p.close()}catch(error){result.rtc=error.name}
    result.fetch=await fetch(${q(networkUrl+'/local-document-fetch')}).then(()=>'ALLOWED',error=>error.name);
    return result;
  })()`);
  for(const stage of ['about:blank','document.open']) {
    if(stage==='document.open') await evaluateFrame(contextKey, `document.open();document.write('<!doctype html><body id="local-replacement"><script>window.__replacementInline=true<'+ '/script></body>');document.close();true`);
    const probe=await inspect(); inheritedDocumentProbes.push({stage,...probe});
    assert.equal(probe.origin,'null',stage); assert.equal(probe.node,false,stage); assert.equal(probe.bridge,false,stage);
    for(const key of ['parent','parentBridge','localStorage','sessionStorage','cookie','indexedDB']) assert.equal(probe[key],'SecurityError',stage+':'+key);
    assert.equal(probe.rtcStage,'construct',stage); assert.equal(probe.rtc,'NotAllowedError',stage); assert.equal(probe.fetch,'TypeError',stage);
    if(stage==='document.open') assert.equal(probe.inline,true,'Replacement inline script must actually execute');
    assert.deepEqual(networkRequests,[],stage); assert.deepEqual(udpRequests,[],stage);
  }
}

try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(projectRoot, 'dream.html'), demo);
  await writeFile(path.join(projectRoot, 'security.htm'), security);
  await writeFile(path.join(projectRoot, 'plain.txt'), demo);
  const oversized = '<!doctype html>' + 'x'.repeat(256 * 1024);
  await writeFile(path.join(projectRoot, 'oversized.html'), oversized);
  await writeFile(path.join(dataRoot, 'outside.html'), '<html>outside project</html>');
  await symlink(path.join(dataRoot, 'outside.html'), path.join(projectRoot, 'escape.html'));
  await launch();
  ids = await cdp.eval(`(async()=>{const p=await window.fieloraTest.createProject({title:'原型交互验收',goal:null,root_path:${q(projectRoot)}});const c=await window.fielora.conversation.create({field_id:p.field_id,title:'拾梦 · 可交互原型',provider_config_id:null,model_id:null});return{field:p.field_id,conversation:c.id}})()`);
  const refs = [
    { id: 'resultref_11111111111111111111111111111111', label: '拾梦', target: { kind: 'PROJECT_FILE', field_id: ids.field, relative_path: 'dream.html', expected_sha256: hash(demo) }, provenance: { kind: 'PROJECT_CONTEXT' } },
    { id: 'resultref_22222222222222222222222222222222', label: '隔离检查', target: { kind: 'PROJECT_FILE', field_id: ids.field, relative_path: 'security.htm', expected_sha256: hash(security) }, provenance: { kind: 'PROJECT_CONTEXT' } },
    { id: 'resultref_33333333333333333333333333333333', label: '旧版普通链接', target: { kind: 'PROJECT_FILE', field_id: ids.field, relative_path: 'dream.html', expected_sha256: null }, provenance: { kind: 'PROJECT_CONTEXT' } },
  ];
  const content = `点击打开可交互原型。此页面为确定性验收样例。\n\n[拾梦](fielora-reference:${refs[0].id})\n\n[隔离检查](fielora-reference:${refs[1].id})\n\n[旧版普通链接](fielora-reference:${refs[2].id})\n\n\`\`\`html\n<script>window.codeFenceExecuted=true</script>\n\`\`\`\n\n[未经解析的 HTML](fielora-project-file:dream.html)`;
  await cdp.eval(`window.fielora.conversation.createMessage({conversation_id:${q(ids.conversation)},role:'USER',content:'展示可交互的梦境原型。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]})`);
  await cdp.eval(`window.fielora.conversation.createMessage({conversation_id:${q(ids.conversation)},role:'ASSISTANT',content:${q(content)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:${q(refs)}})`);
  await wait('document.readyState==="complete" && document.querySelector("[data-testid=project-workspace]")');
  await cdp.eval('window.__prototypeBeforeReload=true');
  await cdp.send('Page.reload');
  await wait('!window.__prototypeBeforeReload && document.readyState==="complete" && document.querySelector("[data-testid=project-workspace]")');
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await click(`[data-testid="conversation-${ids.conversation}"]`);
  await wait('document.querySelectorAll("[data-testid=interactive-prototype]").length===2');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=prototype-frame]").length'), 0, 'Generated code must require an explicit open');
  assert.equal(await cdp.eval('Boolean(window.codeFenceExecuted)'), false);
  assert.equal(await cdp.eval(`document.querySelector(${q(`${card(refs[2].id)}`)})===null`), true, 'Legacy references without a hash remain ordinary file links');

  const demoId = refs[0].id, securityId = refs[1].id;
  let demoContext = await open(demoId, 'fixture-demo');
  assert.equal(await cdp.eval(`document.querySelector(${q(frameSelector(demoId))}).getAttribute('sandbox')`), 'allow-scripts');
  await clickFrame(demoId, demoContext, '#dream');
  assert.equal(await evaluateFrame(demoContext,'document.activeElement.id'),'dream');
  await sendSession(contexts.get(demoContext).sessionId, 'Input.insertText', { text: '海边、飞起来' });
  await clickFrame(demoId, demoContext, '#interpret');
  assert.equal(await evaluateFrame(demoContext, 'document.querySelector("#result").textContent'), '你记录了：海边、飞起来');
  await clickFrame(demoId, demoContext, '#switch');
  assert.match(await evaluateFrame(demoContext, 'document.querySelector("#reflection").textContent'), /情绪回顾/);
  await captureScreenshot(cdp, path.join(evidence, 'interactive.png'));
  const firstUrl = await cdp.eval(`document.querySelector(${q(frameSelector(demoId))}).src`);
  await click(`${card(demoId)} [data-testid="prototype-reset"]`);
  await wait(`document.querySelector(${q(frameSelector(demoId))}) && document.querySelector(${q(frameSelector(demoId))}).src!==${q(firstUrl)}`);
  demoContext = await frameContext(demoId, 'fixture-demo');
  assert.equal(await evaluateFrame(demoContext, 'document.querySelector("#dream").value'), '');
  assert.equal(await evaluateFrame(demoContext, 'document.querySelector("#result").textContent'), '');
  await click(`${card(demoId)} [data-testid="prototype-source"]`);
  await wait('document.querySelector(".right-dock-view:not([hidden]) [data-testid=file-editor]")?.textContent.includes("fixture-demo")');
  await click(`${card(demoId)} [data-testid="prototype-close"]`);
  await wait(`!document.querySelector(${q(frameSelector(demoId))})`);

  const initialTargets = await cdp.send('Target.getTargets');
  const mainUrl = await cdp.eval('location.href');
  let securityContext = await open(securityId, 'fixture-security');
  await pollUntil(async () => (await evaluateFrame(securityContext, 'JSON.parse(document.querySelector("#probes").textContent)')).fetch,
    { timeoutMs: 5000, intervalMs: 50, errorMessage: 'Fetch did not settle as blocked' });
  const probes = await evaluateFrame(securityContext, 'JSON.parse(document.querySelector("#probes").textContent)');
  for (const key of ['node','bridge','parentDom','parentBridge','localStorage','sessionStorage','cookie','indexedDB','fetch']) assert.equal(probes[key], true, key);
  await pollUntil(async () => (await evaluateFrame(securityContext, 'JSON.parse(document.querySelector("#probes").textContent)')).webRTC,
    { timeoutMs:5000, intervalMs:50, errorMessage:'WebRTC probe did not settle' });
  securityProbe=await evaluateFrame(securityContext, 'JSON.parse(document.querySelector("#probes").textContent)');
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.deepEqual(udpRequests, [], 'Sandboxed WebRTC must not send STUN packets');
  assert.ok(['SecurityError','NotAllowedError'].includes(securityProbe.webRTC), `WebRTC must be rejected before constructing an offer: ${securityProbe.webRTC}`);
  assert.equal(securityProbe.webRTCStage, 'construct', 'WebRTC constructor must enforce the document network boundary');
  await clickFrame(securityId, securityContext, '#popup');
  await clickFrame(securityId, securityContext, '#top');
  await clickFrame(securityId, securityContext, '#download');
  await clickFrame(securityId, securityContext, '#submit');
  const afterClicks = await evaluateFrame(securityContext, 'JSON.parse(document.querySelector("#probes").textContent)');
  assert.equal(afterClicks.popup, true); assert.equal(afterClicks.top, true);
  assert.equal(afterClicks.downloadClicked, true); assert.equal(afterClicks.formAttempt, true);
  const navigations = [networkUrl+'/navigate','file://'+path.join(dataRoot,'outside.html'),'fielora://app/index.html','about:blank','data:text/html,<body id="escaped">escape</body>'];
  for (const [index,target] of navigations.entries()) {
    const frameId=contexts.get(securityContext).auxData.frameId;
    await evaluateFrame(securityContext, `window.attackTarget=${q(target)}`);
    await clickFrame(securityId, securityContext, '#navigate');
    await pollUntil(()=>navigationAttempts[index]===target,{timeoutMs:5000,intervalMs:50,errorMessage:`Navigation probe was not dispatched: ${target}`});
    await new Promise(resolve => setTimeout(resolve, 180));
    const tree=await cdp.send('Page.getFrameTree');
    const descendants=node=>(node.childFrames??[]).flatMap(child=>[child.frame,...descendants(child)]);
    const frames=descendants(tree.frameTree);
    const targets=(await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='iframe');
    for (const candidate of targets) {
      let sessionId=frameSessions.get(candidate.targetId);
      if (!sessionId) { ({sessionId}=await cdp.send('Target.attachToTarget',{targetId:candidate.targetId,flatten:true}));frameSessions.set(candidate.targetId,sessionId); }
      const targetTree=await sendSession(sessionId,'Page.getFrameTree');
      const observation=await sendSession(sessionId,'Runtime.evaluate',{expression:`({documentUrl:document.URL,appBridge:typeof window.fielora!=='undefined',node:typeof require!=='undefined'||typeof process!=='undefined',escaped:!!document.querySelector('#network-escape,#escaped')||document.body?.textContent==='outside project'})`,returnByValue:true});
      assert.ok(!observation.exceptionDetails, 'Blocked frame must remain inspectable as an unprivileged document');
      assert.equal(observation.result.value.appBridge,false);
      assert.equal(observation.result.value.node,false);
      assert.equal(observation.result.value.escaped,false);
      targetTree.frameTree.frame.documentObservation=observation.result.value;
      frames.push(targetTree.frameTree.frame,...descendants(targetTree.frameTree));
    }
    navigationOutcomes.push({target,previousFrameId:frameId,frames,targets:targets.map(t=>({id:t.targetId,url:t.url}))});
    // A blocked cross-process navigation may detach the old context entirely.
    // Inspect current documents, not the continued existence of that context.
    if(target==='about:blank') {
      const local=frames.find(frame=>frame.url===target&&!frame.unreachableUrl);
      assert.ok(local,'Expected local blank document for inherited-policy probes');
      await verifyLocalDocument(local.id);
    } else assert.ok(!frames.some(frame=>frame.url===target&&!frame.unreachableUrl), `Forbidden document committed: ${q(frames)}`);
    const currentUrl=await cdp.eval(`document.querySelector(${q(frameSelector(securityId))}).src`);
    await click(`${card(securityId)} [data-testid="prototype-reset"]`);
    await wait(`document.querySelector(${q(frameSelector(securityId))}) && document.querySelector(${q(frameSelector(securityId))}).src!==${q(currentUrl)}`);
    securityContext=await frameContext(securityId,'fixture-security');
  }
  assert.equal(await cdp.eval('location.href'), mainUrl);
  assert.equal(await cdp.eval('document.body.dataset.compromised ?? null'), null);
  assert.deepEqual(networkRequests, [], 'Generated documents must make zero external requests');
  assert.deepEqual(udpRequests, [], 'Navigation/reset must not restore WebRTC network access');
  assert.deepEqual(downloads, [], 'Generated documents cannot start a download');
  const finalTargets = await cdp.send('Target.getTargets');
  assert.equal(finalTargets.targetInfos.filter(t=>t.type==='page').length, initialTargets.targetInfos.filter(t=>t.type==='page').length, 'Popup target must not exist');
  await captureScreenshot(cdp, path.join(evidence, 'isolation.png'));
  await click(`${card(securityId)} [data-testid="prototype-close"]`);

  // The first reset retired this handle. A trusted parent still cannot reload
  // released bytes: registry lifetime is enforced in the host, not only React.
  await cdp.eval(`(()=>{const f=document.createElement('iframe');f.id='retired-prototype';f.sandbox='allow-scripts';f.src=${q(firstUrl)};document.body.append(f)})()`);
  await new Promise(resolve => setTimeout(resolve, 250));
  const retiredTree = await cdp.send('Page.getFrameTree');
  assert.equal(retiredTree.frameTree.childFrames?.some(f=>f.frame.url===firstUrl) ?? false, false, 'Retired preview handle cannot load');
  for(const target of (await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='iframe'&&t.url===firstUrl)) {
    let sessionId=frameSessions.get(target.targetId);
    if(!sessionId)({sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true}));
    const {frameTree}=await sendSession(sessionId,'Page.getFrameTree');
    assert.ok(frameTree.frame.url!==firstUrl||frameTree.frame.unreachableUrl===firstUrl,'Retired out-of-process preview cannot load');
  }
  await cdp.eval('document.querySelector("#retired-prototype").remove()');

  await rejectPreview('dream.html', '0'.repeat(64), 'PROTOTYPE_CHANGED');
  await rejectPreview('dream.html', 'bad-hash', 'PROTOTYPE_UNAVAILABLE');
  await rejectPreview('plain.txt', hash(demo), 'PROTOTYPE_UNAVAILABLE');
  await rejectPreview('../outside.html', hash('<html>outside project</html>'), 'PROTOTYPE_UNAVAILABLE');
  await rejectPreview('escape.html', hash('<html>outside project</html>'), 'PROTOTYPE_UNAVAILABLE');
  await rejectPreview('oversized.html', hash(oversized), 'PROTOTYPE_TOO_LARGE');
  await rejectPreview(path.join(dataRoot, 'outside.html'), hash('<html>outside project</html>'), 'PROTOTYPE_UNAVAILABLE');
  const handles = await cdp.eval(`(async()=>{const items=[];for(let i=0;i<32;i++)items.push(await window.fielora.workspace.previewPrototype({field_id:${q(ids.field)},relative_path:'dream.html',expected_sha256:${q(hash(demo))}}));return items})()`);
  await rejectPreview('dream.html', hash(demo), 'PROTOTYPE_TOO_MANY');
  await cdp.eval(`Promise.all(${q(handles)}.map(item=>window.fielora.workspace.releasePrototype({url:item.url})))`);

  const durable = await cdp.eval(`window.fielora.conversation.listMessages({conversation_id:${q(ids.conversation)}})`);
  await stop(); await launch();
  assert.deepEqual(await cdp.eval(`window.fielora.conversation.listMessages({conversation_id:${q(ids.conversation)}})`), durable);
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await click(`[data-testid="conversation-${ids.conversation}"]`);
  await wait('document.querySelectorAll("[data-testid=interactive-prototype]").length===2');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=prototype-frame]").length'), 0);
  demoContext = await open(demoId, 'fixture-demo');
  assert.equal(await evaluateFrame(demoContext, 'document.querySelector("#dream").value'), '');
  await click(`${card(demoId)} [data-testid="prototype-close"]`);
  await writeFile(path.join(projectRoot, 'dream.html'), demo.replace('拾梦交互原型', '已修改的原型'));
  await click(`${card(demoId)} [data-testid="prototype-open"]`);
  await wait(`document.querySelector(${q(`${card(demoId)} [data-testid="prototype-error"]`)})?.textContent.includes('文件已修改')`);
  assert.equal(await cdp.eval(`document.querySelector(${q(frameSelector(demoId))})===null`), true);
  await captureScreenshot(cdp, path.join(evidence, 'changed-version.png'));
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ status:'PASS', scope:'Actual Electron and Core persistence; fixture references, native input and UI state, source, reset, cold restart, version refusal, path/hash/size/symlink checks, opaque sandbox, HTTP/STUN egress and external/file/app/data navigation refusal; about:blank and document.open retain policy while inline script executes. No real model or generation-quality claim.', probes:afterClicks, navigations, navigationAttempts, navigationOutcomes, inheritedDocumentProbes, networkRequests, udpRequests, downloads }, null, 2));
  console.log('INTERACTIVE_PROTOTYPE_E2E=PASS evidence='+evidence);
} catch (error) {
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(()=>{});
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ error:String(error), browserLogs, networkRequests, udpRequests, securityProbe, navigationAttempts, navigationOutcomes, inheritedDocumentProbes, contexts:[...contexts.values()] }, null, 2));
  console.error(output.join('').slice(-2500)); throw error;
} finally {
  await stop(); await writeFile(path.join(evidence, 'electron.log'), output.join(''));
  await new Promise(resolve => network.close(resolve));
  await new Promise(resolve => udp.close(resolve));
  await rm(dataRoot, { recursive:true, force:true });
}
