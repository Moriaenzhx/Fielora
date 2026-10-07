import { packagedApplication, launchDesktop, killTestProcess, deleteTestCredential, processExecutable } from '../support/platform.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..','..');
const mode=process.argv[2]??'dev';
const packaged=mode==='packaged'||mode==='portable';
const appPath=process.env.FIELORA_PACKAGED_APP??packagedApplication(root);
const localAppData=await mkdtemp(path.join(tmpdir(),`fielora-phase02-${mode}-e2e-`));
const evidenceDir=process.env.FIELORA_E2E_EVIDENCE_DIR?path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR):path.join(root,'artifacts','phase02');
const targetTimeoutMs=Number(process.env.FIELORA_E2E_TARGET_TIMEOUT_MS??60000);
const cdpTimeoutMs=Number(process.env.FIELORA_E2E_CDP_TIMEOUT_MS??15000);
if(!Number.isFinite(targetTimeoutMs)||targetTimeoutMs<=0)throw new Error('FIELORA_E2E_TARGET_TIMEOUT_MS must be a positive number');
if(!Number.isFinite(cdpTimeoutMs)||cdpTimeoutMs<=0)throw new Error('FIELORA_E2E_CDP_TIMEOUT_MS must be a positive number');
const title=`Phase 02 ${mode} Reality`;
let port;let launched;const output=[];const ownedCorePids=new Set();

class Cdp{
  constructor(url){this.socket=new WebSocket(url);this.id=0;this.pending=new Map();this.events=[];}
  async open(){if(this.socket.readyState!==WebSocket.OPEN)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timed out opening CDP websocket after ${cdpTimeoutMs}ms`)),cdpTimeoutMs);this.socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});this.socket.addEventListener('error',(error)=>{clearTimeout(timer);reject(error);},{once:true});});this.socket.addEventListener('message',(event)=>{const message=JSON.parse(String(event.data));if(!message.id){this.events.push(message);return;}const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);});}
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Timed out waiting for CDP ${method} after ${cdpTimeoutMs}ms`));},cdpTimeoutMs);this.pending.set(id,{resolve,reject,timer});try{this.socket.send(JSON.stringify({id,method,params}));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});}
  async evaluate(expression,awaitPromise=true){const result=await this.send('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}
  close(){for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('CDP connection closed'));}this.pending.clear();this.socket.close();}
}
async function availableDebuggingPort(){const probe=createNetServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const address=probe.address();assert.ok(address&&typeof address!=='string');await new Promise((resolve,reject)=>probe.close((error)=>error?reject(error):resolve()));return address.port;}
async function launch(){port=await availableDebuggingPort();const env={...process.env,LOCALAPPDATA:localAppData,FIELORA_E2E:'1',FIELORA_E2E_DEBUG_PORT:String(port),ELECTRON_MIRROR:'https://npmmirror.com/mirrors/electron/'};const child=launchDesktop(root, appPath, packaged, env);child.stdout.on('data',(chunk)=>output.push(String(chunk)));child.stderr.on('data',(chunk)=>output.push(String(chunk)));return child;}
async function waitForTarget(timeoutMs=targetTimeoutMs){const started=Date.now();while(Date.now()-started<timeoutMs){try{const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(Math.min(2000,timeoutMs))})).json();const target=targets.find((item)=>item.type==='page'&&(item.url.startsWith('fielora://app')||item.url.includes('main_window')));if(target)return target;}catch{}await new Promise((resolve)=>setTimeout(resolve,100));}throw new Error(`Electron target did not appear.\n${output.join('')}`);}
async function connect(){const target=await waitForTarget();const cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.open();await cdp.send('Runtime.enable');await cdp.send('Page.enable');return cdp;}
async function waitExpression(cdp,expression,timeoutMs=15000){const started=Date.now();while(Date.now()-started<timeoutMs){try{if(await cdp.evaluate(`Boolean(${expression})`))return;}catch{}await new Promise((resolve)=>setTimeout(resolve,75));}throw new Error(`Timed out waiting for ${expression}\n${output.join('')}`);}
function click(selector){return`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.click();return true;})()`;}
async function waitExit(child,timeoutMs=15000){if(child.exitCode!==null)return child.exitCode;return Promise.race([new Promise((resolve)=>child.once('exit',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Electron did not exit')),timeoutMs))]);}
async function quit(cdp){await cdp.evaluate('void window.fielora.core.quit()',false);cdp.close();assert.equal(await waitExit(launched),0);}

let identifiers;
try{
  launched=await launch();let cdp=await connect();await waitExpression(cdp,`document.querySelector('[data-testid="project-workspace"]')`);await cdp.evaluate(click('[data-testid="now-nav"]'));await waitExpression(cdp,`document.querySelector('[data-testid="scheduled-tasks-screen"]')`);
  const health=await cdp.evaluate('window.fielora.core.getHealth()');ownedCorePids.add(health.pid);assert.equal(health.schema_version,19);
  const origin=await cdp.evaluate('location.origin');
  if(packaged)assert.equal(origin,'fielora://app');else{const parsed=new URL(origin);assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));assert.ok(parsed.port);}
  assert.equal(await cdp.evaluate(`typeof process==='undefined'&&typeof require==='undefined'`),true);
  assert.equal(await cdp.evaluate(`new Promise((resolve)=>{const frame=document.createElement('iframe');frame.src=location.href;frame.onload=async()=>{try{if(!frame.contentWindow.fielora)return resolve(true);await frame.contentWindow.fielora.core.getHealth();resolve(false);}catch{resolve(true);}finally{frame.remove();}};document.body.append(frame);})`),true);
  const beforeNavigation=await cdp.evaluate('location.href');await cdp.evaluate(`void(location.href='https://example.org/')`);await new Promise((resolve)=>setTimeout(resolve,300));assert.equal(await cdp.evaluate('location.href'),beforeNavigation);
  identifiers=await cdp.evaluate(`(async()=>{
    const field=await window.fielora.field.create({title:${JSON.stringify(title)},goal:'Prove durable Field Reality'});
    const task=await window.fielora.state.create({field_id:field.id,kind:'TASK',content:'Ship Phase 02',confidence:0.8});
    await window.fielora.state.create({field_id:field.id,kind:'QUESTION',content:'Is resume authoritative?',confidence:null});
    const blocker=await window.fielora.state.create({field_id:field.id,kind:'BLOCKER',content:'Need evidence',confidence:1});
    const resolved=await window.fielora.state.transition({field_id:field.id,state_id:blocker.resource.id,expected_state_revision:1,target:'RESOLVED'});
    const reopened=await window.fielora.state.transition({field_id:field.id,state_id:blocker.resource.id,expected_state_revision:resolved.resource.revision,target:'ACTIVE'});
    const revised=await window.fielora.state.revise({field_id:field.id,state_id:blocker.resource.id,expected_state_revision:reopened.resource.revision,content:'Need packaged evidence',confidence:1});
    const superseded=await window.fielora.state.supersede({field_id:field.id,state_id:blocker.resource.id,expected_state_revision:revised.resource.revision,replacement_content:'Evidence captured',replacement_confidence:1});
    const reference=await window.fielora.reference.create({field_id:field.id,title:'Acceptance evidence',url:'HTTPS://Example.COM:443/evidence?q=private'});
    const relation=await window.fielora.relation.attachReferenceSource({field_id:field.id,state_id:superseded.replacement.id,reference_id:reference.resource.id});
    const mode=await window.fielora.field.updateMode({field_id:field.id,expected_field_revision:relation.field_revision,mode:'VERIFY'});
    const focus=await window.fielora.field.setFocusV1({field_id:field.id,expected_field_revision:mode.field_revision,focus:{kind:'REFERENCE',object_id:reference.resource.id}});
    await window.fielora.surface.saveSnapshotV1({field_id:field.id,layout:{version:1,template:'PRIMARY_SUPPORT_RIGHT',primary:{pane_id:'primary_task',primitive:'TASK_PANE',binding:{kind:'FIELD_TASKS'},collapsed:false},supporting:[{pane_id:'pane_'+reference.resource.id,primitive:'REFERENCE_PANE',binding:{kind:'REFERENCE',object_id:reference.resource.id},collapsed:false}],focused_pane_id:'primary_task'}});
    return{fieldId:field.id,taskId:task.resource.id,referenceId:reference.resource.id,relationId:relation.resource.id,revision:focus.field_revision,supersedeKinds:[superseded.previous.kind,superseded.replacement.kind],canonicalUrl:reference.resource.canonical_url};
  })()`);
  assert.equal(identifiers.revision,12);
  assert.deepEqual(identifiers.supersedeKinds,['BLOCKER','BLOCKER']);assert.equal(identifiers.canonicalUrl,'https://example.com/evidence?q=private');
  await cdp.evaluate(`window.fielora.field.resumeV1({field_id:${JSON.stringify(identifiers.fieldId)}}).then((resume)=>({revision:resume.field_revision,freshness:resume.snapshot_freshness,continuation:resume.continuation.reason,open:resume.open_reference_ids}))`).then((resume)=>{assert.equal(resume.revision,12);assert.equal(resume.freshness,'CURRENT');assert.equal(resume.continuation,'TYPED_FOCUS');assert.deepEqual(resume.open,[identifiers.referenceId]);});
  await cdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:navigate',{detail:'FIELDS'}))`);await waitExpression(cdp,`document.querySelector('[data-testid="fields-screen"]')`);await waitExpression(cdp,`document.querySelector(${JSON.stringify(`[data-testid="fields-field-${identifiers.fieldId}"]`)})`);await cdp.evaluate(click(`[data-testid="fields-field-${identifiers.fieldId}"]`));
  await waitExpression(cdp,`document.querySelector('[data-testid="task-pane"]') && document.querySelector('[data-testid="reference-pane"]')`);
  assert.equal(await cdp.evaluate(`document.querySelector('[data-testid="context-inspector"]')===null`),true);
  await cdp.evaluate(click('[data-testid="toggle-inspector"]'));await waitExpression(cdp,`document.querySelector('[data-testid="context-inspector"]')`);
  const visibleText=await cdp.evaluate('document.body.innerText');
  for(const internalTerm of ['FIELD · REV','TASK PANE','ACTIVE · r','No mode','SNAPSHOT_V1','LEGACY_PHASE01_FALLBACK','Reality & lineage','Recent activity','Reference unavailable','ON-DEMAND CONTEXT'])assert.equal(visibleText.includes(internalTerm),false,`visible UI leaked ${internalTerm}`);
  assert.equal(visibleText.includes('验证'),true);assert.equal(visibleText.includes('当前上下文'),true);assert.equal(visibleText.includes('参考资料'),true);
  const requested=await cdp.evaluate(`performance.getEntriesByType('resource').map((entry)=>entry.name).filter((name)=>name.startsWith('https://example.com'))`);assert.deepEqual(requested,[]);
  await cdp.evaluate(click('.back'));await waitExpression(cdp,`document.querySelector('[data-testid="scheduled-tasks-screen"]')`);
  const legacyTitle=`Phase 01 legacy focus ${mode}`;
  const legacy=await cdp.evaluate(`(async()=>{const field=await window.fielora.field.create({title:${JSON.stringify(legacyTitle)},goal:'Continue without exposing migration details'});const focused=await window.fielora.field.updateFocus({field_id:field.id,expected_revision:field.revision,focus:'PHASE_01_HUMAN_PASS_TEST'});await window.fielora.surface.saveSnapshot({field_id:field.id,layout:{primary:'FIELD',supporting:[]},open_objects:[]});const task=await window.fielora.state.create({field_id:field.id,kind:'TASK',content:'Phase 02 当前工作',confidence:null});return{fieldId:field.id,revision:task.field_revision,focusRevision:focused.revision};})()`);
  assert.equal(legacy.focusRevision,2);assert.equal(legacy.revision,3);
  await cdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:navigate',{detail:'FIELDS'}))`);await waitExpression(cdp,`document.querySelector('[data-testid="fields-screen"]')`);await waitExpression(cdp,`document.querySelector(${JSON.stringify(`[data-testid="fields-field-${legacy.fieldId}"]`)})`);await cdp.evaluate(click(`[data-testid="fields-field-${legacy.fieldId}"]`));await waitExpression(cdp,`document.querySelector('[data-resume-reason="LEGACY_TEXT_FOCUS"]')`);
  const legacyUi=await cdp.evaluate(`({text:document.body.innerText,cue:document.querySelector('.resume-strip span')?.textContent,label:document.querySelector('[data-testid="current-focus"]')?.textContent})`);
  assert.equal(legacyUi.cue,'上次关注');assert.equal(legacyUi.label,'PHASE_01_HUMAN_PASS_TEST');assert.equal(legacyUi.text.includes('Phase 02 当前工作'),true);assert.equal(legacyUi.text.includes('STALE'),false);assert.equal(legacyUi.text.includes('LEGACY_PHASE01_FALLBACK'),false);
  const legacyScreenshot=await cdp.send('Page.captureScreenshot',{format:'png'});await mkdir(evidenceDir,{recursive:true});await writeFile(path.join(evidenceDir,`${mode}-phase02-legacy-resume.png`),Buffer.from(legacyScreenshot.data,'base64'));
  await quit(cdp);

  launched=await launch();cdp=await connect();await waitExpression(cdp,`document.querySelector('[data-testid="project-workspace"]')`);await cdp.evaluate(click('[data-testid="now-nav"]'));await waitExpression(cdp,`document.querySelector('[data-testid="scheduled-tasks-screen"]')`);ownedCorePids.add((await cdp.evaluate('window.fielora.core.getHealth()')).pid);
  let resume=await cdp.evaluate(`window.fielora.field.resumeV1({field_id:${JSON.stringify(identifiers.fieldId)}})`);assert.equal(resume.field_revision,12);assert.equal(resume.snapshot_freshness,'CURRENT');assert.equal(resume.layout.template,'PRIMARY_SUPPORT_RIGHT');assert.equal(resume.last_activity.action,'FIELD_FOCUS_UPDATED');
  const changed=await cdp.evaluate(`window.fielora.state.revise({field_id:${JSON.stringify(identifiers.fieldId)},state_id:${JSON.stringify(identifiers.taskId)},expected_state_revision:1,content:'Ship and verify Phase 02',confidence:1})`);assert.equal(changed.field_revision,13);
  resume=await cdp.evaluate(`window.fielora.field.resumeV1({field_id:${JSON.stringify(identifiers.fieldId)}})`);assert.equal(resume.snapshot_freshness,'STALE');assert.equal(resume.active_tasks[0].content_excerpt,'Ship and verify Phase 02');
  const archived=await cdp.evaluate(`window.fielora.reference.archive({field_id:${JSON.stringify(identifiers.fieldId)},object_id:${JSON.stringify(identifiers.referenceId)},expected_object_revision:1})`);assert.equal(archived.field_revision,14);
  resume=await cdp.evaluate(`window.fielora.field.resumeV1({field_id:${JSON.stringify(identifiers.fieldId)}})`);assert.deepEqual(resume.unavailable_reference_ids,[identifiers.referenceId]);assert.equal(resume.typed_focus,null);
  const restored=await cdp.evaluate(`window.fielora.reference.restore({field_id:${JSON.stringify(identifiers.fieldId)},object_id:${JSON.stringify(identifiers.referenceId)},expected_object_revision:2})`);assert.equal(restored.field_revision,15);
  const afterRestore=await cdp.evaluate(`Promise.all([window.fielora.field.resumeV1({field_id:${JSON.stringify(identifiers.fieldId)}}),window.fielora.relation.list({field_id:${JSON.stringify(identifiers.fieldId)},relation_type:null,lifecycle:'RETRACTED',endpoint:null,cursor:null,limit:100})])`);assert.equal(afterRestore[0].typed_focus,null);assert.equal(afterRestore[1].items.find((item)=>item.id===identifiers.relationId).lifecycle,'RETRACTED');
  const empty=await cdp.evaluate(`(async()=>{const field=await window.fielora.field.create({title:'Empty Phase 02 Field',goal:null});const resume=await window.fielora.field.resumeV1({field_id:field.id});const activity=await window.fielora.activity.list({field_id:field.id,cursor:null,limit:100});return{field,resume,activity};})()`);assert.equal(empty.resume.field_revision,1);assert.deepEqual(empty.resume.active_tasks,[]);assert.equal(empty.resume.layout.template,'PRIMARY_ONLY');assert.equal(empty.activity.items.length,1);
  await cdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:navigate',{detail:'FIELDS'}))`);await waitExpression(cdp,`document.querySelector('[data-testid="fields-screen"]')`);await waitExpression(cdp,`document.querySelector(${JSON.stringify(`[data-testid="fields-field-${identifiers.fieldId}"]`)})`);await cdp.evaluate(click(`[data-testid="fields-field-${identifiers.fieldId}"]`));await waitExpression(cdp,`document.querySelector('[data-testid="field-screen"]')`);
  const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'});await mkdir(evidenceDir,{recursive:true});await writeFile(path.join(evidenceDir,`${mode}-phase02-resume.png`),Buffer.from(screenshot.data,'base64'));
  await cdp.evaluate('window.fieloraTest.killCore()');await waitExpression(cdp,`document.querySelector('[data-testid="startup-screen"]')`,5000);await waitExpression(cdp,`document.querySelector('[data-testid="field-screen"]')`,10000);const afterCrash=await cdp.evaluate('window.fielora.core.getHealth()');ownedCorePids.add(afterCrash.pid);assert.equal(afterCrash.state,'READY');assert.equal((await cdp.evaluate(`window.fielora.field.resumeV1({field_id:${JSON.stringify(identifiers.fieldId)}})`)).field_revision,15);
  if(packaged){const processPath=processExecutable(afterCrash.pid);assert.equal(path.normalize(processPath),path.join(path.dirname(appPath),process.platform === 'darwin' ? '../Resources' : 'resources',(process.platform === 'win32' ? 'fielora-core.exe' : 'fielora-core')));await writeFile(path.join(evidenceDir,mode==='portable'?'PHASE_02_PORTABLE_ACCEPTANCE.json':'PHASE_02_PACKAGED_ACCEPTANCE.json'),`${JSON.stringify({status:'PASS',application:appPath,database_path:afterCrash.db_path,schema_version:19,field_revision:15,checks:['secure_renderer','typed_preload_allowlist','state_lifecycle','legacy_resume_presentation','no_visible_internal_terms','same_kind_supersede','reference_canonicalization','source_relation','typed_focus_mode','surface_v1','packaged_restart_resume','stale_snapshot','archive_cascade','restore_no_hidden_restore','empty_task_surface','core_crash_restart','no_reference_network'],captured_at:new Date().toISOString()},null,2)}\n`);}
  await quit(cdp);console.log(`Phase 02 Desktop E2E (${mode}): PASS`);
}finally{
  for(const pid of ownedCorePids){try{process.kill(pid,'SIGKILL');}catch{}}
  if(launched&&launched.exitCode===null)killTestProcess(launched.pid);
  await new Promise((resolve)=>setTimeout(resolve,150));try{await rm(localAppData,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){console.warn(`E2E cleanup warning: ${error}`);}
}
