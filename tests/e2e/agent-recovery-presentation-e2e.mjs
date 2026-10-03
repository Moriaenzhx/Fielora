import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-recovery-presentation-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-recovery-presentation'));
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
  await writeFile(path.join(projectRoot,'login.js'),'exports.ready = false;\n');
  await writeFile(path.join(projectRoot,'verify.cjs'),"require('node:assert/strict').equal(require('./login.js').ready,true);\n");
  await writeFile(path.join(projectRoot,'evidence.txt'),Array.from({length:30},(_,i)=>`Observation ${i+1}`).join('\n'));
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  await launch();
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Recovery fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_pause__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'任务恢复与过程体验',goal:null,root_path:${JSON.stringify(projectRoot)}});const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'恢复并验证已有修改',provider_config_id:provider.id,model_id:provider.default_model});return {provider,project,conversation};})()`);
  await reload(); await openConversation();
  await click('[data-testid=composer-permission]'); await click('[data-testid=composer-permission-option-FULL_CONTROL]');
  await send('FIELORA_AGENT_FIXTURE_MODEL_RECOVERY 修复登录流程并验证');
  await wait("document.querySelector('[data-testid=agent-progress-summary]')");
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=conversation-activity-thinking]').length"),0);
  await wait("document.querySelector('[data-testid=agent-current-activity]')?.textContent.includes('第 5 项')");
  assert.ok(await cdp.eval("document.querySelectorAll('[data-testid=agent-current-activity] [data-testid=conversation-narrative]').length<=1"));
  assert.equal(await cdp.eval("document.querySelector('[data-testid=agent-progress-summary]').getAttribute('aria-expanded')"),'false');
  await captureScreenshot(cdp,path.join(evidence,'running-compact.png'));
  await click('[data-testid=agent-progress-summary]');
  await wait("document.querySelectorAll('[data-testid=agent-run-details] .activity-note').length>=5");
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=agent-run-mcp]').length"),0,'missing optional MCP configuration is not an error card');
  await captureScreenshot(cdp,path.join(evidence,'running-history.png'));
  await click('[data-testid=agent-progress-summary]');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('模型响应异常')");
  const paused=(await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}})`))[0];
  assert.equal(paused.status,'PAUSED'); assert.equal(paused.current_step,11);
  await captureScreenshot(cdp,path.join(evidence,'model-paused.png'));
  cdp.close();cdp=null;await cleanupElectronProcess(child);child=null;
  await launch();await openConversation();
  await click('[data-testid=agent-pause-notice] .agent-resume-action');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(paused.id)}}).then(r=>r.status==='COMPLETED')`);
  await wait("document.body.textContent.includes('已有修改保留')");
  const tools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(paused.id)}})`);
  assert.equal(tools.filter(t=>t.name==='replace_text').length,1);
  assert.equal(tools.filter(t=>t.name==='read_file').length,9);
  assert.ok(tools.some(t=>t.name==='run_command'&&t.status==='COMPLETED'));
  assert.match(await readFile(path.join(projectRoot,'login.js'),'utf8'),/ready = true/);
  await captureScreenshot(cdp,path.join(evidence,'resumed-verified.png'));

  await writeFile(path.join(projectRoot,'login.js'),'exports.ready = false;\n');
  await click(`[data-testid="project-new-conversation-${ids.project.field_id}"]`);
  await wait("document.querySelector('.conversation-heading h2')?.textContent==='新对话'");
  await send('FIELORA_AGENT_FIXTURE_MODEL_RECOVERY LEGACY 修复登录流程并验证');
  await wait("document.querySelector('[data-testid=agent-retry]')");
  await captureScreenshot(cdp,path.join(evidence,'legacy-failed-result.png'));
  assert.equal(await cdp.eval("getComputedStyle(document.querySelector('[data-testid=agent-retry]'),'::before').content"),'none');
  await click('[data-testid=agent-retry]');
  await wait("document.body.textContent.includes('已有修改保留')");
  const legacyConversation=(await cdp.eval(`window.fielora.conversation.list({field_id:${JSON.stringify(ids.project.field_id)}})`)).find(c=>c.id!==ids.conversation.id);
  const attempts=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(legacyConversation.id)}})`);
  assert.equal(attempts.length,2);
  assert.ok(attempts.some(r=>r.status==='FAILED'));assert.ok(attempts.some(r=>r.status==='COMPLETED'));
  const done=attempts.find(r=>r.status==='COMPLETED');
  const remainingTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(done.id)}})`);
  assert.ok(remainingTools.length>0&&remainingTools.every(t=>t.name==='run_command'),'legacy continuation only performs remaining verification');
  assert.equal(await cdp.eval("document.querySelector('[data-testid=agent-prior-attempts]').open"),false);
  assert.ok(await cdp.eval("(()=>{const old=document.querySelector('[data-testid=agent-prior-attempts]'),latest=[...document.querySelectorAll('[data-agent-turn]')].find(e=>!old.contains(e));return Boolean(latest && (old.compareDocumentPosition(latest)&Node.DOCUMENT_POSITION_FOLLOWING))})()"),'latest attempt follows collapsed history');
  await captureScreenshot(cdp,path.join(evidence,'legacy-continued.png'));
  await reload();
  await click(`[data-testid="conversation-${legacyConversation.id}"]`);
  await wait("document.querySelector('[data-agent-state=COMPLETED]') && document.querySelector('[data-testid=agent-prior-attempts]')");
  assert.equal(await cdp.eval("document.querySelector('[data-testid=agent-prior-attempts]').open"),false);
  await click('[data-testid=agent-prior-attempts] > summary');
  await wait("document.querySelector('[data-testid=agent-prior-attempts] [data-agent-state=FAILED]')");
  await captureScreenshot(cdp,path.join(evidence,'legacy-history-expanded.png'));
  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:'PASS',host:process.env.FIELORA_PACKAGED_EXE?'packaged':'development',externalModelRequests:0,boundedLivePreview:true,expandableHistory:true,noDuplicatePreparation:true,optionalMcpAbsent:true,sameRunAfterRestart:true,noRepeatedReadsOrWrites:true,freshVerification:true,legacyLinkedContinuation:true},null,2));
  console.log(`PASS Agent recovery and presentation: ${evidence}`);
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
