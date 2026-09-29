import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-turn-context-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-turn-context/dev'));
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
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:800,deviceScaleFactor:1,mobile:false});
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
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(projectRoot, 'settings.js'), base);
  await writeFile(path.join(projectRoot, 'verify.cjs'), "require('node:assert/strict').equal(require('./settings.js').value, 'right');\n");
  await writeFile(path.join(projectRoot, 'evidence.txt'), 'Original screenshot evidence.\n');
  assert.equal(spawnSync('git.exe', ['init'], { cwd: projectRoot, windowsHide: true }).status, 0);
  await launch();
  ids = await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Turn context fixture',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',default_model:'__fielora_agent_fixture_turn_context__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'目标驱动回归',goal:null,root_path:${JSON.stringify(projectRoot)}});return {provider,project}})()`);

  const conversation = await create('失败后追问原因');
  const failed = await settled(await start(conversation, '修复失败样例'));
  assert.equal(failed.run.status,'PAUSED');
  assert.ok(failed.tools.some(t=>t.name==='replace_text'&&t.status==='FAILED'&&t.error_code==='AGENT_TEXT_MATCH_FAILED'));
  assert.ok(!failed.tools.some(t=>t.effect==='WORKSPACE_WRITE'&&t.status==='COMPLETED'));
  // A paused Run owns this conversation until the user stops it. Stopping is
  // not successful completion; the following question must not resume it.
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(failed.run.id)}})`);
  const stopped=await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(failed.run.id)}})`);
  assert.equal(stopped.status,'CANCELLED');
  const before = await readFile(path.join(projectRoot,'settings.js'),'utf8');
  await restartApp();
  const explanation = await settled(await start(conversation,'为什么这次没有改成功'));
  await writeFile(path.join(evidence,'explanation.json'),JSON.stringify(explanation,null,2));
  assert.equal(explanation.run.status,'COMPLETED');
  assert.equal(explanation.run.current_step,2);
  assert.deepEqual(explanation.tools.map(t=>t.name),['read_run_history','finish_task']);
  assert.equal(explanation.tools[0].name,'read_run_history');
  assert.equal(explanation.tools[0].receipt.history.run.run_id,failed.run.id);
  assert.equal(explanation.tools[0].receipt.history.completed_workspace_writes,0);
  assert.equal(explanation.tools[0].receipt.verification_eligible,false);
  const completion = explanation.events.find(e=>e.kind==='RUN_COMPLETED').payload;
  assert.equal(completion.completion_basis,'ANSWER');
  assert.equal(completion.verification_passed,false);
  assert.equal(completion.completion_scope,'CURRENT_REQUEST');
  assert.equal(completion.historical_goals_updated,false);
  assert.equal(completion.protocol,'EXPLICIT_TASK_OUTCOME_V1');
  const prompts = explanation.events.filter(e=>e.kind==='MODEL_COMPLETED').map(e=>e.payload.prompt);
  assert.equal(prompts.length,2);
  for (const prompt of prompts) {
    assert.ok(prompt.context.source_user_message_id);
    assert.ok(prompt.context.indexed_run_ids.includes(failed.run.id));
    assert.match(prompt.system_sha256,/^[a-f0-9]{64}$/);
    assert.equal(prompt.message_manifest.length,prompt.message_count);
  }
  assert.equal(await readFile(path.join(projectRoot,'settings.js'),'utf8'),before);
  const priorAfter=await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(failed.run.id)}})`);
  assert.equal(priorAfter.status,'CANCELLED');assert.equal(priorAfter.next_sequence,stopped.next_sequence);
  await show(conversation);
  await wait("document.body.innerText.includes('待替换文本没有匹配')");
  await captureScreenshot(cdp,path.join(evidence,'cause-answer.png'));
  // Historical fixture encodes its first terminal attempt using the new protocol,
  // then the same provider loop supplies a current-request interpretation.
  // Pause after that receipt and restart Core to prove it is durably scoped.
  const attachments=await cdp.eval(`(()=>{const c=document.createElement('canvas');c.width=400;c.height=180;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,400,180);x.fillStyle='black';x.fillText('KPI columns',10,40);x.strokeStyle='red';x.beginPath();x.moveTo(10,40);x.lineTo(200,40);x.stroke();const data_url=c.toDataURL('image/png');return [{id:'marked-report',filename:'report.png',mime_type:'image/png',size:atob(data_url.split(',')[1]).length,width:400,height:180,source:'clipboard',data_url}];})()`);
  await cdp.eval(`window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(conversation.id)},role:'ASSISTANT',content:'旧的错误解读：红线表示勾选后应保留。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]})`);
  const exact='对啊 为什么你之前做的检查不是被红色划线标记（应隐藏/删除）这部分';
  const checkpointed=await settled(await start(conversation,exact,attachments,2));
  assert.equal(checkpointed.run.status,'PAUSED');
  assert.equal(checkpointed.run.error_code,'AGENT_BUDGET_EXHAUSTED');
  assert.equal(checkpointed.tools.length,2);
  assert.equal(checkpointed.tools[0].name,'finish_task');
  assert.equal(checkpointed.tools[0].status,'FAILED');
  assert.equal(checkpointed.tools[1].name,'record_request_intent');
  assert.equal(checkpointed.tools[1].receipt.intent,'answer_only');
  await restartApp();
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(checkpointed.run.id)}})`);
  const answered=await settled(checkpointed.run);
  assert.equal(answered.run.status,'COMPLETED');
  assert.equal(answered.tools.filter(t=>t.name==='record_request_intent').length,1,'resume must not replay interpretation');
  const terminalProposals=answered.tools.filter(t=>t.name==='finish_task');
  assert.equal(terminalProposals.length,2);
  assert.equal(terminalProposals[0].status,'FAILED');
  assert.equal(terminalProposals[1].status,'COMPLETED');
  assert.equal(terminalProposals[1].receipt.proposal.intent,'answer_only');
  assert.equal(terminalProposals[1].receipt.verification_passed,false);
  assert.equal(answered.events.find(e=>e.kind==='RUN_COMPLETED').payload.protocol,'EXPLICIT_TASK_OUTCOME_V1');
  assert.ok(answered.events.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.image_count===1));
  assert.equal(answered.events.find(e=>e.kind==='RUN_COMPLETED').payload.completion_basis,'ANSWER');
  assert.equal(await readFile(path.join(projectRoot,'settings.js'),'utf8'),before);
  await writeFile(path.join(evidence,'intent-exact-restart.json'),JSON.stringify(answered,null,2));
  for(const task of ['为什么之前删除了它？','你说修改好了，依据是什么？','Explain why the previous delete failed']) {
    const result=await settled(await start(conversation,task));
    assert.equal(result.run.status,'COMPLETED');
    assert.equal(result.tools.filter(t=>t.name==='record_request_intent').length,1);
    assert.equal(result.tools.find(t=>t.name==='record_request_intent').receipt.intent,'answer_only');
    assert.equal(result.tools.at(-1).name,'finish_task');
    assert.equal(result.tools.at(-1).status,'COMPLETED');
    assert.equal(result.events.find(e=>e.kind==='RUN_COMPLETED').payload.verification_passed,false);
    assert.ok(result.events.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.image_count===1));
  }
  const mixed=await settled(await start(conversation,'解释原因并删除错误配置'));
  assert.equal(mixed.run.status,'PAUSED');
  assert.equal(mixed.run.error_code,'AGENT_VERIFICATION_REQUIRED');
  assert.equal(mixed.tools.find(t=>t.name==='record_request_intent').receipt.intent,'workspace_change');
  assert.ok(!mixed.events.some(e=>e.kind==='RUN_COMPLETED'));
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(mixed.run.id)}})`);
  const unverified=await settled(await start(conversation,'FIELORA_INTENT_UNVERIFIED 修改后只解释'));
  assert.equal(unverified.run.status,'PAUSED');
  assert.equal(unverified.run.error_code,'AGENT_VERIFICATION_REQUIRED');
  assert.ok(unverified.tools.some(t=>t.name==='replace_text'&&t.status==='COMPLETED'));
  assert.ok(unverified.tools.some(t=>t.name==='record_request_intent'&&t.receipt.intent==='answer_only'));
  assert.ok(!unverified.events.some(e=>e.kind==='RUN_COMPLETED'));
  await writeFile(path.join(evidence,'intent-obligation-guards.json'),JSON.stringify({mixed,unverified},null,2));
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(unverified.run.id)}})`);
  await writeFile(path.join(projectRoot,'settings.js'),before);
  await show(conversation);
  await wait("document.body.innerText.includes('此前检查目标偏离了该要求')");
  await captureScreenshot(cdp,path.join(evidence,'intent-answer.png'));

  // Reproduce the actual follow-up after a historical implementation. The
  // provider deliberately proposes three forbidden effects before the read,
  // and another write after it. Neither FULL_CONTROL nor history grants them.
  const referenceRoot = path.join(dataRoot, 'reference source');
  await mkdir(referenceRoot);
  await writeFile(path.join(referenceRoot, 'view.js'), 'REFERENCE_CONTENT\n');
  const accessTask = `"${referenceRoot}" 我现在给你这个地址，这是猎头项目的地址 你能看到里面的项目内容吗`;
  const access = await settled(await start(conversation, accessTask));
  await writeFile(path.join(evidence,'access-question.json'),JSON.stringify(access,null,2));
  assert.equal(access.run.status,'COMPLETED');
  assert.equal(access.run.current_step,1, 'success must stop further model calls');
  assert.equal(access.tools.length,4);
  assert.equal(access.tools.filter(t=>t.status==='DENIED'&&t.error_code==='AGENT_CURRENT_REQUEST_SCOPE_DENIED').length,3);
  assert.ok(access.tools.some(t=>t.name==='read_file'&&t.status==='COMPLETED'&&t.receipt.workspace_scope==='REFERENCE'));
  assert.ok(!access.tools.some(t=>t.effect!=='OBSERVE'&&t.status==='COMPLETED'));
  assert.equal(access.events.find(e=>e.kind==='RUN_COMPLETED').payload.access_confirmed,true);
  assert.equal(await readFile(path.join(projectRoot,'settings.js'),'utf8'),before);
  await assert.rejects(readFile(path.join(projectRoot,'escaped.txt')));
  assert.equal(await readFile(path.join(referenceRoot,'view.js'),'utf8'),'REFERENCE_CONTENT\n');
  await show(conversation);
  await wait("document.body.innerText.includes('本次仅确认读取能力，没有修改文件')");
  await captureScreenshot(cdp,path.join(evidence,'access-answer.png'));
  const missingTask = `"${path.join(dataRoot,'missing-reference')}" 你能看到里面的项目内容吗`;
  const missing = await settled(await start(conversation, missingTask));
  assert.equal(missing.run.status,'COMPLETED');
  assert.equal(missing.events.find(e=>e.kind==='RUN_COMPLETED').payload.access_confirmed,false);
  assert.ok(missing.tools.some(t=>t.name==='read_file'&&t.status==='FAILED'));
  assert.equal(await readFile(path.join(projectRoot,'settings.js'),'utf8'),before);
  await writeFile(path.join(evidence,'missing-access.json'),JSON.stringify(missing,null,2));
  const repair=await settled(await start(conversation,'现在请修复它'));
  await writeFile(path.join(evidence,'repair.json'),JSON.stringify(repair,null,2));
  assert.equal(repair.run.status,'COMPLETED');
  assert.ok(repair.tools.some(t=>t.name==='replace_text'&&t.status==='COMPLETED'));
  assert.ok(repair.tools.some(t=>t.name==='run_command'&&t.receipt.success===true));
  assert.ok((await readFile(path.join(projectRoot,'settings.js'),'utf8')).includes("value = 'right'"));
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify({status:'PASS',model:'deterministic fixture; no real provider',failed:failed.run.id,explanation:explanation.run.id,access:access.run.id,accessWrites:0,deniedEffects:3,accessModelCalls:1,repair:repair.run.id,explanationTools:explanation.tools.length,explanationWrites:0,coreRestart:true,requestIntent:{exact:answered.run.id,restored:true,paraphrases:3,mixedGuard:mixed.run.id,unverifiedWriteGuard:unverified.run.id,visualSemantics:'NOT_TESTED; fixture asserts prompt inputs, not model understanding'}},null,2));
  console.log('AGENT_TURN_CONTEXT_E2E=PASS');

} finally {
  await writeFile(path.join(evidence, 'electron.log'), output.join('')).catch(() => {});
  cdp?.close(); await cleanupElectronProcess(child);
  if (ids?.provider) spawnSync('cmdkey.exe', [`/delete:Fielora/provider/${ids.provider.id}`], { windowsHide: true, stdio: 'ignore' });
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
}
