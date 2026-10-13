import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-operation-approval-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(dataRoot, 'evidence');
const project = path.join(dataRoot, 'project'), q = JSON.stringify, output = [];
const bytes = Buffer.from('{"customer":"synthetic fixture only","count":24}\n');
const received = [];
const server = http.createServer((request, response) => {
  const chunks=[]; request.on('data',chunk=>chunks.push(chunk)); request.on('end',()=>{received.push({method:request.method,url:request.url,bytes:Buffer.concat(chunks)});response.end('received');});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const receiver=`http://127.0.0.1:${server.address().port}/fixture-upload`;
let child, cdp, ids;
async function stop() {
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();cdp=null;}
  if(child){await cleanupElectronProcess(child);child=null;}
}
async function launch() {
  const launched=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{FIELORA_OPERATION_NODE:process.execPath,FIELORA_OPERATION_RECEIVER:receiver}});
  child=launched.child;cdp=await connectToFieloraApp({port:launched.port,output,enablePage:true,timeoutMs:120000});
  await waitForExpression(cdp,"window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')",{output,timeoutMs:120000});
}
async function selectConversation(){
  await cdp.send('Page.reload');
  await waitForExpression(cdp,`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`,{output,timeoutMs:30000});
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
}
async function clickVisibleApproval(screenshotName){
  const point=await cdp.eval(`(async()=>{
    const button=document.querySelector('[data-testid=agent-allow-once]');
    button.scrollIntoView({block:'center',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=button.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    if(button.disabled||!hit||!(hit===button||button.contains(hit)))throw new Error('Approval button must be visible and unobscured');
    return {x,y};
  })()`);
  await captureScreenshot(cdp,path.join(evidence,screenshotName));
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
}
const snapshot=()=>cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(ids.run)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(ids.run)}}),events:await window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})}))()`);
const waiting=()=>waitForExpression(cdp,`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['WAITING_APPROVAL','PAUSED','FAILED'].includes(r.status))`,{output,timeoutMs:60000});
try {
  await Promise.all([mkdir(path.join(project,'clear-me'),{recursive:true}),mkdir(path.join(project,'data'),{recursive:true}),mkdir(evidence,{recursive:true})]);
  await writeFile(path.join(project,'clear-me','keep-until-second.txt'),'preserve after first confirmation');
  await writeFile(path.join(project,'data','customer.json'),bytes);
  await launch();
  ids=await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_operation_approval__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Operation approval fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'Operation approval acceptance',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Two confirmations and data upload',provider_config_id:p.id,model_id:model});
    const task='In this isolated fixture, run an ordinary command, clear the explicitly prepared temporary clear-me directory with two human confirmations, then send synthetic data/customer.json to the provided loopback receiver with separate consent.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {conversation:c.id,start:{field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:16,attachments:[]}};
  })()`);
  await selectConversation();ids.run=(await cdp.eval(`window.fielora.agent.start(${q(ids.start)})`)).id;
  await waiting();
  const first=await snapshot();await writeFile(path.join(evidence,'before-first.json'),q(first));
  assert.equal(first.run.status,'WAITING_APPROVAL',q(first.run));
  assert.equal(await readFile(path.join(project,'ordinary.txt'),'utf8'),'ordinary command ran');
  assert.equal(first.events.filter(e=>e.kind==='APPROVAL_REQUESTED').length,1,'Ordinary command must not ask');
  const firstApproval=first.events.findLast(e=>e.kind==='APPROVAL_REQUESTED').payload.approval;
  assert.equal(firstApproval.confirmation_stage,1);assert.equal(firstApproval.required_confirmations,2);
  assert.equal(received.length,0);
  await waitForExpression(cdp,"document.querySelector('[data-testid=agent-allow-once]')?.textContent.includes('进入第二次确认')",{output});
  await clickVisibleApproval('first-confirmation.png');
  await waitForExpression(cdp,"document.querySelector('[data-testid=agent-allow-once]')?.textContent.includes('再次确认并执行')",{output});
  const second=await snapshot();const secondApproval=second.events.findLast(e=>e.kind==='APPROVAL_REQUESTED').payload.approval;
  assert.equal(second.run.status,'WAITING_APPROVAL');assert.equal(secondApproval.id,firstApproval.id);assert.notEqual(secondApproval.nonce,firstApproval.nonce);
  assert.equal(await readFile(path.join(project,'clear-me','keep-until-second.txt'),'utf8'),'preserve after first confirmation');
  assert.equal(second.tools.find(t=>t.arguments?.program==='/bin/rm').status,'WAITING_APPROVAL');assert.equal(received.length,0);
  await writeFile(path.join(evidence,'after-first.json'),q(second));
  await stop();await launch();await selectConversation();
  await waitForExpression(cdp,"document.querySelector('[data-testid=agent-allow-once]')?.textContent.includes('再次确认并执行')",{output});
  const restored=await snapshot();assert.equal(restored.run.status,'WAITING_APPROVAL');
  assert.equal(restored.tools.length,second.tools.length,'Restart must not replay any action');
  await clickVisibleApproval('second-confirmation-after-restart.png');
  for(let upload=0;upload<5;upload++){
    await waitForExpression(cdp,`window.fielora.agent.toolCalls({run_id:${q(ids.run)}}).then(tools=>tools.filter(t=>t.arguments?.program==='/usr/bin/curl').length===${upload+1}&&tools.some(t=>t.arguments?.program==='/usr/bin/curl'&&t.status==='WAITING_APPROVAL'))`,{output,timeoutMs:60000});
    await assert.rejects(stat(path.join(project,'clear-me')),e=>e.code==='ENOENT');
    assert.equal(received.length,upload,'Each upload must not start before its own approval');
    await waitForExpression(cdp,"document.querySelector('[data-testid=agent-allow-once]')?.textContent.includes('允许本次发送')",{output});
    await clickVisibleApproval(`upload-consent-${upload}.png`);
  }
  await waitForExpression(cdp,`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`,{output,timeoutMs:60000});
  const result=await snapshot();await writeFile(path.join(evidence,'run.json'),q(result));
  assert.equal(result.run.error_code,'AGENT_USER_INPUT_REQUIRED',q(result.run));
  assert.equal(result.tools.at(-1).arguments.reason,'FIXTURE_OPERATION_COMPLETE');
  assert.equal(received.length,5);assert.equal(received[0].method,'PUT');assert.deepEqual(received[0].bytes,bytes);
  for(const item of received.slice(1))assert.equal(item.method,'POST');
  assert.deepEqual(received[1].bytes,Buffer.from(bytes.toString().trimEnd()));
  assert.deepEqual(received[2].bytes,bytes);
  assert.equal(new URLSearchParams(received[3].bytes.toString()).get('field'),bytes.toString());
  assert.ok(received[4].bytes.includes(bytes),'Multipart <file must contain the actual synthetic file');
  assert.equal(result.events.filter(e=>e.kind==='APPROVAL_REQUESTED').length,7);
  assert.equal(result.tools.filter(t=>t.name==='run_command').length,7);
  await writeFile(path.join(evidence,'validation.json'),q({status:'PASS',run:ids.run,ordinary_command:'AUTOMATIC',clear_first_confirmation:'NO_EFFECT',clear_second_confirmation:'ACTUAL_DIRECTORY_REMOVAL',cold_restart:'SECOND_NONCE_RESTORED_NO_REPLAY',data_upload:'ACTUAL_LOOPBACK_BYTES_AFTER_SEPARATE_CONSENT',upload_spellings:['-T','-d@','--json','--data-urlencode','-F field=<file'],uploaded_bytes:bytes.length,scope:'Deterministic model and actual UI/Core/native commands on disposable fixture only; not arbitrary-program isolation or real-model acceptance.'}));
  console.log('OPERATION_APPROVAL_E2E=PASS evidence='+evidence);
}catch(error){if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});console.error(output.join('').slice(-1500));throw error;}
finally{await stop();await new Promise(resolve=>server.close(resolve));}
