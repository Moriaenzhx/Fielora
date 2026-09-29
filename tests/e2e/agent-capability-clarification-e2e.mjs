import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-clarification-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-capability-clarification/dev'));
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
  await mkdir(projectRoot); await mkdir(evidence, {recursive:true});
  await writeFile(path.join(projectRoot,'settings.js'),base);
  await writeFile(path.join(projectRoot,'verify-clarification.cjs'), "require('node:assert/strict').equal(require('node:fs').readFileSync('clarified.txt','utf8'),'fixture-approved-source');\n");
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  await launch();
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Clarification fixture',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',default_model:'__fielora_agent_fixture_turn_context__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'暂停与澄清回归',goal:null,root_path:${JSON.stringify(projectRoot)}});return {provider,project}})()`);
  const conversation=await create('安装需要补充来源');
  const run=await start(conversation,'安装澄清回归样例');
  const paused=await settled(run);
  await writeFile(path.join(evidence,'paused.json'),JSON.stringify(paused,null,2));
  assert.equal(paused.run.error_code,'AGENT_USER_INPUT_REQUIRED');
  assert.equal(paused.run.status,'PAUSED');
  assert.equal(paused.tools.length,4);
  assert.equal(paused.tools.find(t=>t.name==='capability_status').receipt.web_research.status,'UNSUPPORTED_CAPABILITY');
  assert.ok(paused.tools.some(t=>t.error_code==='AGENT_TOOL_IS_NOT_PROGRAM'));
  assert.ok(paused.tools.some(t=>t.error_code==='AGENT_PROGRAM_NOT_FOUND'));
  assert.ok(!paused.events.some(e=>e.kind==='RUN_COMPLETED'));
  await assert.rejects(readFile(path.join(projectRoot,'must-not-exist.txt')));
  const original=await cdp.eval(`window.fielora.conversation.listMessages({conversation_id:${JSON.stringify(conversation.id)}})`);
  // Resume without an answer and attempts to reuse old, foreign or assistant messages must fail.
  const question=original.find(m=>m.role==='ASSISTANT'&&m.content.includes('可信来源'));
  assert.ok(question);
  const foreign=await create('无关对话');
  const foreignMessage=await cdp.eval(`window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(foreign.id)},role:'USER',content:'fixture-approved-source',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]})`);
  for (const messageId of [null,original.find(m=>m.role==='USER').id,question.id,foreignMessage.id]) {
    const failure=await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(run.id)},${messageId?`user_message_id:${JSON.stringify(messageId)}`:''}}).then(()=>null,e=>String(e))`);
    assert.ok(failure,`unexpected resume accepted ${messageId}`);
  }
  console.log('CLARIFICATION_PAUSED_AND_INVALID_ANSWERS_REJECTED');
  await restartApp();
  await show(conversation);
  await wait("document.body.innerText.includes('可信来源') && document.querySelector('[data-testid=agent-pause-notice]')");
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=stop-agent], [data-testid=stop-agent-secondary], .agent-status-indicator.is-active, .agent-current-activity').length"),0);
  assert.equal(await cdp.eval("document.querySelector('[data-testid=send-message]').getAttribute('aria-label')"),'回答并继续');
  assert.equal(await cdp.eval("document.querySelector('[data-testid=send-message]').disabled"),true);
  await captureScreenshot(cdp,path.join(evidence,'waiting-question.png'));
  await cdp.eval(`(()=>{const el=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'fixture-approved-source');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait("!document.querySelector('[data-testid=send-message]').disabled");
  await cdp.eval("document.querySelector('[data-testid=send-message]').click()");
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(r=>r.status==='COMPLETED'||r.status==='FAILED'||r.current_step>4)`);
  const complete=await settled(run);
  await writeFile(path.join(evidence,'complete.json'),JSON.stringify(complete,null,2));
  assert.equal(complete.run.status,'COMPLETED');
  assert.equal(await readFile(path.join(projectRoot,'clarified.txt'),'utf8'),'fixture-approved-source');
  await assert.rejects(readFile(path.join(projectRoot,'must-not-exist.txt')));
  assert.ok(complete.events.some(e=>e.payload.kind==='USER_INPUT_RECEIVED'));
  assert.ok(complete.tools.some(t=>t.name==='run_command'&&t.receipt?.success===true));
  await wait("document.body.innerText.includes('这不是实际 Archify 安装')");
  await captureScreenshot(cdp,path.join(evidence,'answered-result.png'));
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(conversation.id)}})`)).length,1);
  const replay=await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(run.id)},user_message_id:${JSON.stringify(foreignMessage.id)}}).then(()=>null,e=>String(e))`);
  assert.ok(replay);
  await rm(path.join(projectRoot,'clarified.txt'));
  // Reproduce the user's actual counterquestion, including an unexplained
  // repeated model proposal and a later effect in that rejected batch.
  const counterConversation=await create('联网反问后重新判断');
  const counterRun=await start(counterConversation,'联网反问澄清回归样例');
  assert.equal((await settled(counterRun)).run.error_code,'AGENT_USER_INPUT_REQUIRED');
  await restartApp();
  await show(counterConversation);
  async function answerVisibleQuestion(text) {
    await wait("document.querySelector('[data-testid=agent-pause-notice]')");
    await cdp.eval(`(()=>{const el=document.querySelector('textarea[name=prompt]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait("!document.querySelector('[data-testid=send-message]').disabled");
    await cdp.eval("document.querySelector('[data-testid=send-message]').click()");
  }
  await answerVisibleQuestion('这个你不可以联网搜索吗');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(counterRun.id)}}).then(r=>r.current_step>=4)`);
  const counterPaused=await settled(counterRun);
  assert.equal(counterPaused.run.status,'PAUSED');
  assert.equal(counterPaused.run.error_code,'AGENT_USER_INPUT_REQUIRED');
  assert.ok(counterPaused.tools.some(t=>t.error_code==='AGENT_CLARIFICATION_REPEATED'));
  assert.equal(counterPaused.tools.filter(t=>t.name==='request_user_input'&&t.status==='COMPLETED').length,2);
  assert.ok(!counterPaused.tools.some(t=>t.arguments.path==='must-not-exist.txt'));
  await assert.rejects(readFile(path.join(projectRoot,'must-not-exist.txt')));
  const counterMessages=await cdp.eval(`window.fielora.conversation.listMessages({conversation_id:${JSON.stringify(counterConversation.id)}})`);
  assert.equal(counterMessages.filter(m=>m.role==='ASSISTANT').length,2);
  assert.ok(counterMessages.at(-1).content.includes('没有注册 web.search/web.fetch'));
  const answeredMessage=counterMessages.find(m=>m.content==='这个你不可以联网搜索吗');
  const counterCalls=counterPaused.events.filter(e=>e.kind==='MODEL_COMPLETED'&&e.payload.step>=2);
  assert.ok(counterCalls.length>=3);
  for(const event of counterCalls) {
    assert.equal(event.payload.prompt.user_input.replies.at(-1).source_user_message_id,answeredMessage.id);
    assert.ok(event.payload.prompt.visible_tool_names.includes('capability_status'));
    assert.ok(!event.payload.prompt.visible_tool_names.includes('web.search'));
  }
  await wait("document.body.innerText.includes('没有注册 web.search/web.fetch')");
  await captureScreenshot(cdp,path.join(evidence,'counterquestion-explained.png'));
  await writeFile(path.join(evidence,'counterquestion.json'),JSON.stringify(counterPaused,null,2));
  await restartApp();
  await show(counterConversation);
  await answerVisibleQuestion('fixture-approved-source');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(counterRun.id)}}).then(r=>r.current_step>=5)`);
  const counterCompleted=await settled(counterRun);
  assert.equal(counterCompleted.run.status,'COMPLETED');
  assert.equal((await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(counterConversation.id)}})`)).length,1);
  assert.ok(counterCompleted.tools.some(t=>t.name==='run_command'&&t.receipt?.success===true));
  console.log('CLARIFICATION_COUNTERQUESTION_RESTART_REJECTION_EXPLANATION_PASS');
  const regularConversation=await create('普通暂停按钮');
  const regular=await settled(await start(regularConversation,'修复失败样例'));
  assert.equal(regular.run.status,'PAUSED');
  await show(regularConversation);
  await wait("document.querySelectorAll('.agent-pause-actions button').length===2");
  const layout=await cdp.eval(`(()=>{const buttons=[...document.querySelectorAll('.agent-pause-actions button')].map(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}});return {buttons,spinners:document.querySelectorAll('.agent-status-indicator.is-active,[data-testid=stop-agent]').length,preview:document.querySelectorAll('.agent-current-activity').length}})()`);
  assert.equal(layout.spinners,0);assert.equal(layout.preview,0);
  assert.equal(layout.buttons[0].y,layout.buttons[1].y);
  assert.ok(layout.buttons.every(b=>b.height>=30&&b.height<=40));
  assert.ok(layout.buttons[1].x-layout.buttons[0].x-layout.buttons[0].width>=7);
  await captureScreenshot(cdp,path.join(evidence,'paused-buttons.png'));
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:701,deviceScaleFactor:1,mobile:false});
  await captureScreenshot(cdp,path.join(evidence,'paused-narrow.png'));
  await cdp.eval("document.querySelector('.agent-pause-actions .is-primary').click()");
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(regular.run.id)}}).then(r=>r.current_step>${regular.run.current_step}&&r.status==='PAUSED')`);
  await wait("[...document.querySelectorAll('.agent-pause-actions button')].some(b=>b.textContent==='停止任务'&&!b.disabled)");
  await cdp.eval("[...document.querySelectorAll('.agent-pause-actions button')].find(b=>b.textContent==='停止任务').click()");
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(regular.run.id)}}).then(r=>r.status==='CANCELLED')`);
  await wait("document.querySelectorAll('.agent-pause-actions button,[data-testid=stop-agent]').length===0");
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify({status:'PASS',fixture:'deterministic; no actual Archify installation or provider call',sameRun:run.id,restart:true,invalidAnswersRejected:4,noPostQuestionMutation:true,counterquestion:{run:counterRun.id,unexplainedRepeatRejected:true,explainedRepeatVisible:true,nativeLatestReply:true,noPostRejectionMutation:true,restart:true,verifiedFixtureCompletion:true},resumeAndStopButtons:true,layout},null,2));
  console.log('AGENT_CAPABILITY_CLARIFICATION_E2E=PASS');
} catch (error) {
  if(cdp) { await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});await writeFile(path.join(evidence,'failure-ui.txt'),await cdp.eval('document.body.innerText').catch(()=>'')); }
  throw error;
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close();await cleanupElectronProcess(child);
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
