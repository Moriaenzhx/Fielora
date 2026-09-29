import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, glob } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-input-drafts-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root,'artifacts/agent-context-drafts'));
const output = [];
let child; let cdp; let ids;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs:45000, output });
async function click(selector) {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function textInput(value) {
  await cdp.eval(`(()=>{const e=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
const draftText = () => cdp.eval("document.querySelector('.conversation-composer textarea').value");
const images = () => cdp.eval("document.querySelectorAll('[data-testid=attachment-thumbnail-composer]').length");
async function pasteImages() {
  await cdp.eval(`(async()=>{
    const transfer=new DataTransfer();
    for(let index=0;index<2;index++){
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=160;
      const ctx=canvas.getContext('2d');ctx.fillStyle=index?'#def3f0':'#eff0fe';ctx.fillRect(0,0,320,160);
      ctx.fillStyle='#263344';ctx.font='20px sans-serif';ctx.fillText(index?'期望：已到账金额':'实际：客户抬头',20,80);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      transfer.items.add(new File([blob],index?'expected.png':'actual.png',{type:'image/png'}));
    }
    document.querySelector('.conversation-composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
  })()`);
  await wait("document.querySelectorAll('[data-testid=attachment-thumbnail-composer]').length===2");
}
async function openConversation(id) { await click(`[data-testid="conversation-${id}"]`); }
try {
  await mkdir(projectRoot);await mkdir(evidence,{recursive:true});
  await writeFile(path.join(projectRoot,'evidence.txt'),'Original screenshot comparison: labels must match the requested controls.\n');
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  const launched=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{Path:`${path.dirname(process.execPath)};${process.env.Path??''}`},
  });
  child=launched.child;
  cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:800,deviceScaleFactor:1,mobile:false});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  ids=await cdp.eval(`(async()=>{
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Input continuity fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_images__',custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});
    const project=await window.fieloraTest.createProject({title:'图片与草稿回归',goal:null,root_path:${JSON.stringify(projectRoot)}});
    const make=title=>window.fielora.conversation.create({field_id:project.field_id,title,provider_config_id:provider.id,model_id:provider.default_model});
    const first=await make('保留图片草稿'),second=await make('另一个对话');
    for(const c of [first,second]) await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:c.title,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {provider,project,first,second};
  })()`);
  await cdp.eval('window.__draftReload=true');await cdp.send('Page.reload');
  await wait('typeof window.__draftReload==="undefined" && window.fieloraTest');
  await openConversation(ids.first.id);
  await textInput('原对话尚未发送的文字');await pasteImages();
  await openConversation(ids.second.id);
  assert.equal(await draftText(),'');assert.equal(await images(),0);
  await textInput('另一个对话的独立草稿');
  await openConversation(ids.first.id);
  assert.equal(await draftText(),'原对话尚未发送的文字');assert.equal(await images(),2);
  await captureScreenshot(cdp,path.join(evidence,'restored-conversation-draft.png'));

  // Also cover the project new-conversation draft: sending transfers it to the created conversation.
  await click(`[data-testid="project-new-conversation-${ids.project.field_id}"]`);
  await wait("document.querySelector('.conversation-heading h2')?.textContent==='新对话'");
  await textInput('新对话尚未发送的文字');await pasteImages();
  await openConversation(ids.second.id);
  assert.equal(await draftText(),'另一个对话的独立草稿');assert.equal(await images(),0);
  await click(`[data-testid="project-new-conversation-${ids.project.field_id}"]`);
  await wait("document.querySelector('.conversation-heading h2')?.textContent==='新对话'");
  assert.equal(await draftText(),'新对话尚未发送的文字');assert.equal(await images(),2);
  await captureScreenshot(cdp,path.join(evidence,'restored-new-conversation-draft.png'));
  await textInput('FIELORA_AGENT_FIXTURE_INPUT_RETENTION 分析并保留两张原始图片');
  await wait("!document.querySelector('[data-testid=send-message]').disabled");
  await click('[data-testid=send-message]');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  const conversations=await cdp.eval(`window.fielora.conversation.list({field_id:${JSON.stringify(ids.project.field_id)}})`);
  const conversation=conversations.find(item=>![ids.first.id,ids.second.id].includes(item.id));
  assert.ok(conversation);
  const [paused]=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(conversation.id)}})`);
  assert.equal(paused.status,'PAUSED');assert.equal(paused.error_code,'AGENT_TIME_BUDGET_EXHAUSTED');
  assert.equal(await draftText(),'');assert.equal(await images(),0);
  let events=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(paused.id)},after_sequence:null,limit:500})`);
  const stored=events.find(e=>e.payload.kind==='RUN_INPUT_ATTACHMENTS_V1');
  assert.equal(stored.payload.count,2);assert.ok(stored.payload.blob_ref);
  assert.ok(!JSON.stringify(stored).includes('base64'));
  assert.equal(events.find(e=>e.kind==='MODEL_COMPLETED').payload.prompt.image_count,2);
  await captureScreenshot(cdp,path.join(evidence,'images-budget-paused.png'));
  const beforePid=await cdp.eval('window.fielora.core.getHealth().then(h=>h.pid)');
  await cdp.eval('window.fieloraTest.killCore()');
  await wait(`window.fielora.core.getHealth().then(h=>h.state==='READY'&&h.pid!==${beforePid})`);
  // No renderer-supplied images: this proves durable Core inputs survive the restart.
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(paused.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(paused.id)}}).then(r=>r.status==='COMPLETED')`);
  events=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(paused.id)},after_sequence:null,limit:500})`);
  const calls=events.filter(e=>e.kind==='MODEL_COMPLETED');
  assert.equal(calls.length,2);assert.ok(calls.every(e=>e.payload.prompt.image_count===2));
  const tools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(paused.id)}})`);
  assert.equal(tools.filter(t=>t.name==='read_file').length,1);
  await openConversation(conversation.id);
  await wait("document.body.textContent.includes('续跑仍保留两张原始图片')");
  await captureScreenshot(cdp,path.join(evidence,'images-resumed-after-core-restart.png'));
  await openConversation(ids.first.id);
  assert.equal(await draftText(),'原对话尚未发送的文字');assert.equal(await images(),2);
  await textInput('FIELORA_AGENT_FIXTURE_INPUT_RETENTION 再次分析原始两张图片');
  await click('[data-testid=send-message]');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  const [uiPaused]=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.first.id)}})`);
  assert.equal(uiPaused.error_code,'AGENT_TIME_BUDGET_EXHAUSTED');
  // Build a pre-input-persistence history only in this disposable test database.
  // Production immutable-event behavior is restored before continuing the run.
  const databases=[];
  for await (const entry of glob('**/fielora.db',{cwd:dataRoot})) databases.push(path.join(dataRoot,entry));
  assert.equal(databases.length,1);
  const db=new DatabaseSync(databases[0]);
  try {
    const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='agent_events_immutable_update'").get().sql;
    db.exec('BEGIN IMMEDIATE; DROP TRIGGER agent_events_immutable_update;');
    db.prepare("UPDATE agent_events SET payload_json=json_remove(payload_json,'$.input_attachment_count') WHERE run_id=? AND kind='RUN_CREATED'").run(uiPaused.id);
    db.prepare("UPDATE agent_events SET payload_json=json_set(payload_json,'$.kind','PRE_INPUT_PERSISTENCE_FIXTURE') WHERE run_id=? AND json_extract(payload_json,'$.kind')='RUN_INPUT_ATTACHMENTS_V1'").run(uiPaused.id);
    db.exec(trigger);db.exec('COMMIT');
  }finally{db.close();}
  const uiBeforePid=await cdp.eval('window.fielora.core.getHealth().then(h=>h.pid)');
  await cdp.eval('window.fieloraTest.killCore()');
  await wait(`window.fielora.core.getHealth().then(h=>h.state==='READY'&&h.pid!==${uiBeforePid})`);
  await openConversation(ids.first.id);
  await wait("document.querySelector('[data-testid=agent-pause-notice] .agent-resume-action')");
  await click('[data-testid=agent-pause-notice] .agent-resume-action');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(uiPaused.id)}}).then(r=>r.status==='COMPLETED')`);
  const legacyEvents=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(uiPaused.id)},after_sequence:null,limit:500})`);
  assert.equal(legacyEvents.filter(e=>e.payload.kind==='RUN_INPUT_ATTACHMENTS_V1').length,1);
  await captureScreenshot(cdp,path.join(evidence,'images-resumed-via-ui.png'));
  // A text-only NEW turn must restore the original gallery, not only resume the old run.
  await wait("document.querySelector('[data-agent-state=COMPLETED]')");
  await textInput('FIELORA_AGENT_FIXTURE_INPUT_RETENTION 分析上面的图片');
  await wait("!document.querySelector('[data-testid=send-message]').disabled");
  await click('[data-testid=send-message]');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  const [followUp]=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.first.id)}})`);
  assert.notEqual(followUp.id,uiPaused.id);
  assert.equal(followUp.error_code,'AGENT_TIME_BUDGET_EXHAUSTED');
  const followUpEvents=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(followUp.id)},after_sequence:null,limit:500})`);
  assert.equal(followUpEvents.find(e=>e.kind==='MODEL_COMPLETED').payload.prompt.image_count,2);
  assert.ok(!followUpEvents.some(e=>e.payload.kind==='REFERENCED_INPUTS_RESTORED'),'renderer restored the legacy gallery before Core fallback');
  await captureScreenshot(cdp,path.join(evidence,'historical-images-new-turn.png'));
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(followUp.id)}})`);
  await openConversation(ids.second.id);
  assert.equal(await draftText(),'另一个对话的独立草稿');assert.equal(await images(),0);
  await openConversation(ids.first.id);

  // Reproduce the reported path: legacy gallery -> failed TEXT-ONLY follow-up -> Retry.
  // Only this disposable DB is amended, with immutable-event enforcement restored immediately.
  function legacyFixture(runIds, failedId) {
    const fixtureDb=new DatabaseSync(databases[0]);
    try {
      const trigger=fixtureDb.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='agent_events_immutable_update'").get().sql;
      fixtureDb.exec('BEGIN IMMEDIATE; DROP TRIGGER agent_events_immutable_update;');
      for(const runId of runIds){
        fixtureDb.prepare("UPDATE agent_events SET payload_json=json_remove(payload_json,'$.input_attachment_count') WHERE run_id=? AND kind='RUN_CREATED'").run(runId);
        fixtureDb.prepare("UPDATE agent_events SET payload_json=json_set(payload_json,'$.kind','PRE_INPUT_PERSISTENCE_FIXTURE') WHERE run_id=? AND json_extract(payload_json,'$.kind')='RUN_INPUT_ATTACHMENTS_V1'").run(runId);
      }
      if(failedId){
        fixtureDb.prepare("UPDATE agent_runs SET status='FAILED', current_step=16, error_code='AGENT_MAX_STEPS_REACHED', finished_at=updated_at WHERE id=?").run(failedId);
        fixtureDb.prepare("UPDATE agent_events SET kind='RUN_FAILED',payload_json=? WHERE run_id=? AND kind='RUN_PAUSED'").run(JSON.stringify({error_code:'AGENT_MAX_STEPS_REACHED'}),failedId);
      }
      fixtureDb.exec(trigger);fixtureDb.exec('COMMIT');
    }finally{fixtureDb.close();}
  }
  async function restartCoreAndReload(){
    // Full app restart also clears volatile renderer state. Do not exhaust the
    // supervisor's crash-loop protection by repeatedly killing its sidecar.
    const galleries=await cdp.eval("Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('fielora:conversation-message-attachments:')).map(k=>[k,localStorage.getItem(k)]))");
    await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true');
    await Promise.race([new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error('app did not exit normally')),15000))]);
    cdp.close();cdp=null;await cleanupElectronProcess(child);child=null;
    const launched=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
      executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,
      args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
      extraEnv:{Path:`${path.dirname(process.execPath)};${process.env.Path??''}`},
    });
    child=launched.child;
    cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:800,deviceScaleFactor:1,mobile:false});
    await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
    assert.deepEqual(await cdp.eval("Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('fielora:conversation-message-attachments:')).map(k=>[k,localStorage.getItem(k)]))"),galleries,'gallery references must survive application restart');
    await openConversation(ids.first.id);
  }
  async function startMissingReference(){
    const result=await cdp.eval(`(async()=>{
      const task='FIELORA_AGENT_FIXTURE_INPUT_RETENTION 分析上面的图片，继续核对';
      const message=await window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(ids.first.id)},role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
      const run=await window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:message.conversation_id,user_message_id:message.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task,permission:'FULL_CONTROL',max_steps:null,attachments:[]});
      return {message,run};
    })()`);
    await wait(`window.fielora.agent.get({run_id:${JSON.stringify(result.run.id)}}).then(r=>r.status==='PAUSED')`);
    const run=await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(result.run.id)}})`);
    assert.equal(run.error_code,'AGENT_REFERENCED_IMAGES_UNAVAILABLE');assert.equal(run.current_step,0);
    const events=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(run.id)},after_sequence:null,limit:500})`);
    assert.equal(events.filter(e=>e.kind==='MODEL_STARTED').length,0);
    return result;
  }
  legacyFixture([uiPaused.id,followUp.id]);
  const failedReference=await startMissingReference();
  legacyFixture([],failedReference.run.id);
  await restartCoreAndReload();
  await click('[data-testid=agent-retry]');
  await wait(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.first.id)}}).then(r=>r[0].id!==${JSON.stringify(failedReference.run.id)}&&r[0].status==='PAUSED')`);
  const [retried]=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.first.id)}})`);
  assert.equal(retried.error_code,'AGENT_TIME_BUDGET_EXHAUSTED');
  const retryEvents=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(retried.id)},after_sequence:null,limit:500})`);
  assert.equal(retryEvents.find(e=>e.kind==='MODEL_COMPLETED').payload.prompt.image_count,2);
  assert.ok(!retryEvents.some(e=>e.payload.kind==='REFERENCED_INPUTS_RESTORED'),'UI retry restored legacy gallery');
  assert.ok(retryEvents.some(e=>e.payload.kind==='RETRY_STARTED'));
  await captureScreenshot(cdp,path.join(evidence,'legacy-text-reference-retried.png'));
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(retried.id)}})`);

  // Existing modern step-zero pauses recover with Continue, without stopping/re-uploading.
  legacyFixture([retried.id]);
  const missingReference=await startMissingReference();
  const originalMessageId=legacyEvents.find(e=>e.kind==='RUN_CREATED').payload.user_message_id;
  await cdp.eval(`(async()=>{
    const later=await window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(ids.first.id)},role:'USER',content:'这张新图片属于另一个问题',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const gallery=JSON.parse(localStorage.getItem('fielora:conversation-message-attachments:'+${JSON.stringify(originalMessageId)}));
    localStorage.setItem('fielora:conversation-message-attachments:'+later.id,JSON.stringify(gallery.slice(0,1)));
  })()`);
  await restartCoreAndReload();
  await click('[data-testid=agent-pause-notice] .agent-resume-action');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(missingReference.run.id)}}).then(r=>r.status==='PAUSED'&&r.current_step===1)`);
  const restoredEvents=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(missingReference.run.id)},after_sequence:null,limit:500})`);
  assert.equal(restoredEvents.find(e=>e.kind==='MODEL_COMPLETED').payload.prompt.image_count,2,'later single-image gallery must not replace the original pair');
  assert.equal(restoredEvents.find(e=>e.payload.kind==='RUN_INPUT_ATTACHMENTS_V1').payload.count,2);
  await captureScreenshot(cdp,path.join(evidence,'missing-reference-resumed.png'));
  await restartCoreAndReload();
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(missingReference.run.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(missingReference.run.id)}}).then(r=>r.status==='COMPLETED')`);
  const restoredCalls=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(missingReference.run.id)},after_sequence:null,limit:500})`);
  assert.deepEqual(restoredCalls.filter(e=>e.kind==='MODEL_COMPLETED').map(e=>e.payload.prompt.image_count),[2,2]);

  // A normal text-only paused task still cannot acquire unrelated images on resume.
  const noImages=await cdp.eval(`window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:${JSON.stringify(ids.second.id)},provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task:'FIELORA_AGENT_FIXTURE_RESOURCE 分析当前说明',permission:'FULL_CONTROL',max_steps:1,attachments:[]})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(noImages.id)}}).then(r=>r.status==='PAUSED')`);
  const mismatch=await cdp.eval(`(async()=>{
    const gallery=JSON.parse(localStorage.getItem('fielora:conversation-message-attachments:'+${JSON.stringify(originalMessageId)}));
    const attachments=await Promise.all(gallery.map(async i=>({id:i.id,filename:i.name,mime_type:i.mime_type,size:i.size,width:i.width,height:i.height,source:i.source,data_url:(await window.fielora.workspace.readAttachment({content_ref:i.content_ref})).data_url})));
    try{await window.fielora.agent.resume({run_id:${JSON.stringify(noImages.id)},attachments});return 'unexpected success';}catch(e){return String(e);}
  })()`);
  assert.match(mismatch,/AGENT_INPUT_MISMATCH/);
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(noImages.id)}})`);

  // Core-only fallback must also ignore a later run with a different image set.
  const laterSource=await cdp.eval(`(async()=>{
    const gallery=JSON.parse(localStorage.getItem('fielora:conversation-message-attachments:'+${JSON.stringify(originalMessageId)}));
    const i=gallery[0],stored=await window.fielora.workspace.readAttachment({content_ref:i.content_ref});
    const task='FIELORA_AGENT_FIXTURE_RESOURCE 分析另一个问题';
    const message=await window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(ids.first.id)},role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:message.conversation_id,user_message_id:message.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task,permission:'FULL_CONTROL',max_steps:1,attachments:[{id:i.id,filename:i.name,mime_type:i.mime_type,size:i.size,width:i.width,height:i.height,source:i.source,data_url:stored.data_url}]});
  })()`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(laterSource.id)}}).then(r=>r.status==='PAUSED')`);
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(laterSource.id)}})`);
  const boundedFallback=await cdp.eval(`window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:${JSON.stringify(ids.first.id)},user_message_id:${JSON.stringify(missingReference.message.id)},provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task:${JSON.stringify(missingReference.run.task)},permission:'FULL_CONTROL',max_steps:null,attachments:[]})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(boundedFallback.id)}}).then(r=>r.status==='PAUSED')`);
  const fallbackEvents=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(boundedFallback.id)},after_sequence:null,limit:500})`);
  assert.equal(fallbackEvents.find(e=>e.payload.kind==='REFERENCED_INPUTS_RESTORED').payload.source_run_id,missingReference.run.id);
  assert.equal(fallbackEvents.find(e=>e.kind==='MODEL_COMPLETED').payload.prompt.image_count,2);
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(boundedFallback.id)}})`);
  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:'PASS',host:process.env.FIELORA_PACKAGED_EXE?'packaged':'development',conversationDraftIsolation:true,newConversationDraftRestored:true,sendMovesAndClearsCorrectDraft:true,originalInputsDurableAcrossCoreRestart:true,legacyUiResumeRestoresMessageAttachments:true,textOnlyNewTurnRestoresHistoricalImages:true,legacyTextOnlyRetryRestoresImages:true,missingReferencePauseResumesSameRun:true,laterGalleryExcluded:true,coreFallbackExcludesLaterRuns:true,recoveredImagesSurviveRestart:true,unrelatedResumeInputsRejected:true,sameRunContinuation:true,noRepeatedRead:true,externalModelRequests:0,productionTransactions:0},null,2));
  console.log(`PASS Agent image continuity and drafts: ${evidence}`);
}catch(error){
  console.error(error,output.slice(-5).join(''));process.exitCode=1;
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
}finally{
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close();await cleanupElectronProcess(child);
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
