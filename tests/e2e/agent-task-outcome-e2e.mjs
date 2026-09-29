import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-task-outcomes-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-task-outcomes/dev'));
const output = []; let child; let cdp; let ids;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs: 60000, output });
const base = Array.from({ length: 18 }, (_, i) => `// setting evidence ${i + 1} ${'context '.repeat(260)}`).join('\n') + "\nexports.value = 'wrong';\n";
async function launch() {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { Path: `${path.dirname(process.execPath)};${process.env.Path ?? ''}` },
  });
  child=launched.child;
  cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:701,deviceScaleFactor:1,mobile:false});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function restartApp() {
  await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true');
  await Promise.race([new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error('test app did not exit normally')),15000))]);
  cdp.close();cdp=null;await cleanupElectronProcess(child);child=null;
  await launch();
}
async function create(title) {
  return cdp.eval(`window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:${JSON.stringify(title)},provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)}})`);
}
async function start(conversation, task, attachments = [], maxSteps = null) {
  return cdp.eval(`(async()=>{const message=await window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(conversation.id)},role:'USER',content:${JSON.stringify(task)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:message.conversation_id,user_message_id:message.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task:${JSON.stringify(task)},permission:'FULL_CONTROL',max_steps:${JSON.stringify(maxSteps)},attachments:${JSON.stringify(attachments)}})})()`);
}
async function settled(run) {
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(r=>['COMPLETED','FAILED','PAUSED'].includes(r.status))`);
  return cdp.eval(`(async()=>{const id=${JSON.stringify(run.id)};return {run:await window.fielora.agent.get({run_id:id}),events:await window.fielora.agent.events({run_id:id,after_sequence:null,limit:500}),tools:await window.fielora.agent.toolCalls({run_id:id})}})()`);
}
async function show(conversation) {
  await cdp.eval('window.__intentReload=true');
  await cdp.send('Page.reload');
  await wait("typeof window.__intentReload==='undefined' && window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await wait(`document.querySelector('[data-testid="conversation-${conversation.id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${conversation.id}"]').click()`);
}
try {
  await mkdir(projectRoot); await mkdir(evidence,{recursive:true});
  await writeFile(path.join(projectRoot,'verify-clarification.cjs'), "require('node:assert/strict').equal(require('node:fs').readFileSync('clarified.txt','utf8'),'fixture-approved-source');\n");
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  await launch();
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Outcome fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_outcomes__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'明确结果回归',goal:null,root_path:${JSON.stringify(projectRoot)}});return {provider,project}})()`);
  const conversation=await create('原始安装请求首轮假完成');
  const run=await start(conversation,'需要你安装一下archify的skill 你可以自己去安装吗');
  const paused=await settled(run);
  assert.equal(paused.run.status,'PAUSED');
  assert.equal(paused.run.error_code,'AGENT_USER_INPUT_REQUIRED');
  assert.ok(!paused.events.some(e=>e.kind==='RUN_COMPLETED'));
  assert.ok(paused.events.some(e=>e.payload.reason==='AGENT_TASK_OUTCOME_REQUIRED'));
  assert.ok(paused.tools.some(t=>t.name==='finish_task'&&t.error_code==='AGENT_ACTION_REQUIRED'));
  const capabilities=paused.tools.find(t=>t.name==='capability_status').receipt;
  assert.equal(capabilities.web_research.status,'UNSUPPORTED_CAPABILITY');
  assert.equal(capabilities.browser_research.status,'AVAILABLE');
  await writeFile(path.join(evidence,'original-request-paused.json'),JSON.stringify(paused,null,2));
  await restartApp();await show(conversation);
  await wait("document.querySelector('[data-testid=agent-pause-notice]') && document.body.innerText.includes('安装尚未完成')");
  await captureScreenshot(cdp,path.join(evidence,'original-request-waits.png'));
  await cdp.eval(`(()=>{const el=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'fixture-approved-source');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait("!document.querySelector('[data-testid=send-message]').disabled");
  await cdp.eval("document.querySelector('[data-testid=send-message]').click()");
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(r=>r.current_step>=5)`);
  const completed=await settled(run);
  assert.equal(completed.run.status,'COMPLETED');
  assert.ok(completed.tools.some(t=>t.name==='run_command'&&t.receipt?.success===true));
  assert.equal(completed.events.find(e=>e.kind==='RUN_COMPLETED').payload.protocol,'EXPLICIT_TASK_OUTCOME_V1');
  assert.equal(await readFile(path.join(projectRoot,'clarified.txt'),'utf8'),'fixture-approved-source');
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(conversation.id)}})`)).length,1);
  await writeFile(path.join(evidence,'original-request-completed.json'),JSON.stringify(completed,null,2));
  const pure=await settled(await start(await create('纯解释'),'解释技能的含义，不修改文件'));
  assert.equal(pure.run.status,'COMPLETED');assert.equal(pure.run.current_step,1);
  assert.deepEqual(pure.tools.map(t=>t.name),['finish_task']);
  const noProtocol=await settled(await start(await create('纯文本不算完成'),'纯文本循环回归'));
  assert.equal(noProtocol.run.status,'PAUSED');assert.equal(noProtocol.run.error_code,'AGENT_TASK_OUTCOME_REQUIRED');
  assert.equal(noProtocol.run.current_step,3);assert.equal(noProtocol.tools.length,0);
  const batch=await settled(await start(await create('终止混批'),'检查终止混批，不修改文件'));
  assert.equal(batch.run.status,'COMPLETED');
  assert.ok(batch.events.some(e=>e.payload.reason==='AGENT_OUTCOME_BATCH_INVALID'));
  assert.ok(!batch.tools.some(t=>t.name==='create_file'));
  await assert.rejects(readFile(path.join(projectRoot,'must-not-exist.txt')));
  const blockedConversation=await create('受阻与恢复');
  const blocked=await settled(await start(blockedConversation,'任务阻塞回归'));
  assert.equal(blocked.run.status,'PAUSED');assert.equal(blocked.run.error_code,'AGENT_TASK_BLOCKED');
  assert.ok(blocked.tools.some(t=>t.error_code==='AGENT_BLOCKER_EVIDENCE_REQUIRED'));
  assert.ok(!blocked.events.some(e=>e.kind==='RUN_COMPLETED'));
  await show(blockedConversation);
  await wait("document.body.innerText.includes('外部服务条件仍未满足') && document.body.innerText.includes('任务尚未完成')");
  await captureScreenshot(cdp,path.join(evidence,'blocked.png'));
  await restartApp();await show(blockedConversation);
  await wait("document.body.innerText.includes('外部服务条件仍未满足')");
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(blocked.run.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(blocked.run.id)}}).then(r=>r.current_step>3)`);
  const resumed=await settled(blocked.run);
  assert.equal(resumed.run.status,'PAUSED');assert.equal(resumed.run.error_code,'AGENT_TASK_BLOCKED');
  assert.ok(!resumed.events.some(e=>e.kind==='RUN_COMPLETED'));
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify({status:'PASS',fixture:'raw adversarial model substitute; no actual provider call or Archify installation',originalRequest:run.id,zeroToolFalseSuccessRejected:true,falseActionProposalRejected:true,currentCapabilities:true,sameRunRestartAndVerification:true,pureAnswerNoMutation:true,untypedLoopBounded:true,mixedTerminalBatchNotExecuted:true,evidencedBlockerPausedAcrossRestart:true},null,2));
  console.log('AGENT_TASK_OUTCOME_E2E=PASS');
} catch(error) {
  if(cdp){await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});await writeFile(path.join(evidence,'failure-ui.txt'),await cdp.eval('document.body.innerText').catch(()=>''));}
  throw error;
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close();await cleanupElectronProcess(child);
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
