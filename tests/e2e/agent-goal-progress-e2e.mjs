import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-goal-progress-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-goal-progress'));
const output = [];
let child; let cdp; let ids;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs:45_000, output });
async function launch() {
  const launched = await launchElectron({ root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{Path:`${path.dirname(process.execPath)};${process.env.Path??''}`},
  });
  child=launched.child;
  cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120_000,enablePage:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:800,deviceScaleFactor:1,mobile:false});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function reload() {
  await cdp.eval('window.__recoveryReload=true'); await cdp.send('Page.reload');
  await wait('typeof window.__recoveryReload === "undefined" && window.fieloraTest');
}
async function click(selector) {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  const hover=await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=(e.closest('.project-item-row')??e).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});
  await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`);
  const point=await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
  assert.ok(point.hit, `${selector} is clickable`);
  for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
}
async function send(task) {
  await cdp.eval(`(()=>{const e=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(task)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait("!document.querySelector('[data-testid=send-message]').disabled");
  await click('[data-testid=send-message]');
}
async function openConversation() {
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation.id}"]')`);
  await click(`[data-testid="conversation-${ids.conversation.id}"]`);
}
try {
  await mkdir(projectRoot); await mkdir(evidence,{recursive:true});
  await writeFile(path.join(projectRoot,'login.js'),'exports.ready = true;\n');
  await writeFile(path.join(projectRoot,'verify.cjs'),"require('node:assert/strict').equal(require('./login.js').ready,true);\n");
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  await launch();
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Goal fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_pause__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'目标核验与稳定进度',goal:null,root_path:${JSON.stringify(projectRoot)}});const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'核验已有功能',provider_config_id:provider.id,model_id:provider.default_model});return {provider,project,conversation};})()`);
  await reload(); await openConversation();
  await click('[data-testid=composer-permission]'); await click('[data-testid=composer-permission-option-FULL_CONTROL]');
  await cdp.eval(`(()=>{window.__goalFrames=[];const sample=()=>{const live=document.querySelector('[data-testid=agent-current-activity]');if(live){const n=live.querySelector('.agent-current-narrative'),o=live.querySelector('.agent-current-operations'),g=o?.querySelector('[data-activity-group-kind]');if(n&&o&&g){const nr=n.getBoundingClientRect(),or=o.getBoundingClientRect();window.__goalFrames.push({narrative:n.textContent,kind:g.dataset.activityGroupKind,streaming:!!n.querySelector('.is-streaming'),nTop:nr.top,nBottom:nr.bottom,oTop:or.top,groupTop:g.getBoundingClientRect().top,height:nr.height});}}window.__goalRaf=requestAnimationFrame(sample)};sample()})()`);
  await send('FIELORA_AGENT_FIXTURE_GOAL_SCOPE CHECK 参考外部项目，把当前功能改成支持分批处理');
  await wait("document.querySelector('[data-testid=agent-current-activity] [data-activity-group-kind=SEARCH]')");
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=conversation-activity-thinking]').length"),0);
  await captureScreenshot(cdp,path.join(evidence,'search-progress.png'));
  await wait("document.querySelector('[data-testid=agent-current-activity] [data-activity-group-kind=MIXED]')");
  await captureScreenshot(cdp,path.join(evidence,'merged-progress.png'));
  await wait("document.querySelector('[data-agent-state=COMPLETED]')");
  const frames=await cdp.eval('cancelAnimationFrame(window.__goalRaf); window.__goalFrames');
  await writeFile(path.join(evidence,'frames.json'),JSON.stringify(frames,null,2));
  assert.ok(frames.some(f=>f.streaming)&&frames.some(f=>!f.streaming),'observe both streaming and durable presentation');
  assert.ok(frames.every(f=>f.nBottom<=f.oTop+1),'narrative always stays above operations');
  assert.ok(Math.max(...frames.map(f=>f.height))-Math.min(...frames.map(f=>f.height))<2,'short progress retains a stable narrative slot');
  const run=(await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}})`))[0];
  assert.equal(run.status,'COMPLETED');
  const tools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(run.id)}})`);
  assert.equal(tools.length,6);assert.equal(tools.at(-1).name,'finish_task');assert.ok(tools.every(t=>t.effect!=='WORKSPACE_WRITE'));
  assert.ok(tools.some(t=>t.name==='run_command'&&t.receipt?.verification_eligible&&t.receipt?.workspace_revision));
  await wait("document.querySelector('.agent-terminal-body .markdown-status-marker svg')");
  assert.equal(await cdp.eval("document.querySelector('.agent-terminal-body h2').textContent.includes('✅')"),false);
  assert.ok(await cdp.eval("document.querySelector('.agent-terminal-body pre').textContent.includes('✅ 示例原文')"),'code content is not rewritten');
  await captureScreenshot(cdp,path.join(evidence,'verified-existing-result.png'));
  await click('[data-testid=agent-execution-detail-toggle]');
  await wait("document.querySelector('[data-testid=agent-execution-detail] [data-activity-group-kind=MIXED]')");
  const groupSelector='[data-testid=agent-execution-detail] [data-activity-group-kind=MIXED]';
  assert.equal(await cdp.eval(`document.querySelectorAll('${groupSelector}').length`),1);
  await click(`${groupSelector} > summary`);
  await wait(`document.querySelector('${groupSelector}').open`);
  const history=await cdp.eval(`(()=>{const e=document.querySelector('${groupSelector}');return {entries:e.querySelectorAll('[data-activity-entry]').length,notes:e.querySelectorAll('.activity-note').length,icons:[...e.querySelectorAll('[data-activity-entry] .app-icon')].map(i=>i.outerHTML)}})()`);
  assert.equal(history.entries,4);assert.ok(history.notes>=4);
  assert.ok(new Set(history.icons).size>=3,'search, directory and reading use distinct glyphs');
  await captureScreenshot(cdp,path.join(evidence,'merged-history.png'));
  await click(`[data-testid="project-new-conversation-${ids.project.field_id}"]`);
  await wait("document.querySelector('.conversation-heading h2')?.textContent==='新对话'");
  await send('FIELORA_AGENT_FIXTURE_GOAL_SCOPE 把当前功能改成支持分批处理');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  assert.equal(await cdp.eval("document.querySelectorAll('[data-agent-state=COMPLETED]').length"),0,'unverified claim does not become a completed result');
  await captureScreenshot(cdp,path.join(evidence,'unverified-claim-paused.png'));
  await writeFile(path.join(evidence,'frames.json'),JSON.stringify(frames,null,2));
  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:'PASS',host:process.env.FIELORA_PACKAGED_EXE?'packaged':'development',externalModelRequests:0,stableNarrativeSlot:true,oneInspectionGroup:true,semanticIcons:true,historyNotes:history.notes,verifiedNoChange:true,unverifiedClaimPaused:true,neutralResultMarker:true,codeContentPreserved:true},null,2));
  console.log(`PASS Agent goal and progress: ${evidence}`);
} catch(error) {
  console.error(error,output.slice(-4).join(''));process.exitCode=1;
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close();await cleanupElectronProcess(child);
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
