import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';
const root=path.resolve(import.meta.dirname,'../..'), q=JSON.stringify;
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-outcome-handoff-'));
const projectRoot=path.join(dataRoot,'project');
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(),'fielora-outcome-handoff-evidence-'));
const output=[]; let child,cdp,ids;
const wait=expression=>waitForExpression(cdp,expression,{output,timeoutMs:90000});
async function launch(){
 const x=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start']});
 child=x.child;cdp=await connectToFieloraApp({port:x.port,output,enablePage:true,timeoutMs:120000});
 await wait('window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==="READY")');
}
async function stop(){if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();cdp=null;}if(child){await cleanupElectronProcess(child);child=null;}}
async function start(suffix,max=20){
 await rm(path.join(projectRoot,'result.txt'),{force:true});
 return cdp.eval(`(async()=>{const task=${q('OUTCOME_HANDOFF_'+suffix)};const c=await window.fielora.conversation.create({field_id:${q(ids.field)},title:task,provider_config_id:${q(ids.provider)},model_id:${q(ids.model)}});if(task.includes('_PRESSURE_')){for(let i=0;i<6;i++){for(const role of ['USER','ASSISTANT'])await window.fielora.conversation.createMessage({conversation_id:c.id,role,content:role==='USER'?'PRIOR_USER_CONSTRAINT: preserve existing user files.':'OLD_ASSISTANT_REPORT '+('Already inspected; I will inspect again. '.repeat(230)),status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});}}const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return window.fielora.agent.start({field_id:${q(ids.field)},conversation_id:c.id,user_message_id:m.id,provider_config_id:${q(ids.provider)},model_id:${q(ids.model)},task,permission:'FULL_CONTROL',max_steps:${max},attachments:[]});})()`);
}
async function settle(run){await wait(`window.fielora.agent.get({run_id:${q(run.id)}}).then(r=>['COMPLETED','PAUSED','FAILED'].includes(r.status))`);return cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(run.id)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(run.id)}}),events:await window.fielora.agent.events({run_id:${q(run.id)},after_sequence:null,limit:500})}))()`);}
try{
 await mkdir(projectRoot);await mkdir(evidence,{recursive:true});execFileSync('git',['init'],{cwd:projectRoot,stdio:'ignore'});
 await writeFile(path.join(projectRoot,'verify-result.cjs'),"require('node:assert/strict').equal(require('node:fs').readFileSync('result.txt','utf8'),'correct');\n");
 await writeFile(path.join(projectRoot,'context.txt'),'SOURCE_BODY_SENTINEL '+('retained execution context. '.repeat(900)));
 await launch();ids=await cdp.eval(`(async()=>{const model='__fielora_agent_fixture_outcomes__';const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Raw outcome fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});const f=await window.fieloraTest.createProject({title:'Outcome handoff',goal:null,root_path:${q(projectRoot)}});return {provider:p.id,field:f.field_id,model};})()`);
 for(const suffix of ['JSON','NATIVE','CONTINUE','PRESSURE_CONTINUE']){
  const result=await settle(await start(suffix));await writeFile(path.join(evidence,suffix+'.json'),q(result));
  assert.equal(result.run.status,'COMPLETED',q(result.run));
  const final=result.tools.findLast(t=>t.name==='finish_task');assert.equal(final.status,'COMPLETED');assert.match(final.arguments.summary,/DRAFT_BODY_SENTINEL/);
  assert.equal(result.tools.filter(t=>t.name==='create_file').length,1,'A draft must never replay the write');
  assert.equal(result.tools.filter(t=>t.name==='run_command').length,1);
  assert.ok(result.events.some(e=>e.payload.kind==='TASK_OUTCOME_HANDOFF_V1'));
  if(suffix==='PRESSURE_CONTINUE'){assert.equal(result.tools.filter(t=>t.name==='read_file').length,1,'Continue must restore the source without rereading');const prompts=result.events.filter(e=>e.kind==='MODEL_COMPLETED').map(e=>e.payload.prompt);assert.ok(prompts.some(p=>p.request_phase==='OUTCOME_HANDOFF'));assert.ok(prompts.some(p=>p.request_phase==='EXECUTION'));}
  if(suffix.endsWith('CONTINUE'))assert.ok(result.tools.some(t=>t.name==='finish_task'&&t.error_code==='AGENT_VERIFICATION_REQUIRED'),'False report must be rejected before the actual check');
 }
 const cold=await start('COLD',3);const paused=await settle(cold);assert.equal(paused.run.status,'PAUSED');await stop();await launch();await cdp.eval(`window.fielora.agent.resume({run_id:${q(cold.id)}})`);const recovered=await settle(cold);await writeFile(path.join(evidence,'cold.json'),q(recovered));
 assert.equal(recovered.run.status,'COMPLETED');const last=recovered.tools.findLast(t=>t.name==='finish_task');assert.match(last.arguments.summary,/Cold recovery/);assert.ok(!last.arguments.use_draft_summary);assert.equal(recovered.tools.filter(t=>t.name==='create_file').length,1);
 const blocked=await start('BLOCKED');const blockedState=await settle(blocked);assert.equal(blockedState.run.error_code,'AGENT_TASK_BLOCKED');
 await stop();await launch();await cdp.eval(`window.fielora.agent.resume({run_id:${q(blocked.id)}})`);
 const resumed=await settle(blocked);await writeFile(path.join(evidence,'blocked-resume.json'),q(resumed));
 assert.equal(resumed.run.status,'COMPLETED',q(resumed.run));
 assert.ok(resumed.tools.some(t=>t.error_code==='AGENT_RESUME_OBSERVATION_REQUIRED'),'Old successful Node receipt must not complete a blocked resume');
 assert.equal(resumed.tools.filter(t=>t.name==='create_file').length,1,'Resume must preserve the previous write');
 assert.equal(resumed.tools.filter(t=>t.name==='run_command').length,2,'Only the safe current assertion is re-executed');
 const resumedAt=resumed.events.findLastIndex(e=>e.kind==='RUN_RESUMED');
 assert.ok(resumed.events.slice(resumedAt).filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.request_phase==='EXECUTION'),'Blocked cold recovery must not restore the old handoff');
 const mixed=await settle(await start('MIXED'));assert.equal(mixed.run.error_code,'AGENT_TASK_OUTCOME_REQUIRED');assert.equal(mixed.tools.length,2);await assert.rejects(access(path.join(projectRoot,'must-not-exist.txt')));await writeFile(path.join(evidence,'mixed.json'),q(mixed));
 const ignored=await settle(await start('IGNORE'));assert.equal(ignored.run.error_code,'AGENT_TASK_OUTCOME_REQUIRED');assert.equal(ignored.run.current_step,3);assert.equal(ignored.tools.length,0);
 await writeFile(path.join(evidence,'ignored.json'),q(ignored));
 await cdp.eval('window.__outcomeReload=true');await cdp.send('Page.reload');await wait('!window.__outcomeReload && window.fielora');await wait(`document.querySelector('[data-testid="conversation-${cold.conversation_id}"]')`);await cdp.eval(`document.querySelector('[data-testid="conversation-${cold.conversation_id}"]').click()`);await wait(`document.body.innerText.includes('Cold recovery:')`);await cdp.eval(`document.querySelector('[data-agent-run-id="${cold.id}"]').scrollIntoView({block:'end',behavior:'instant'})`);await captureScreenshot(cdp,path.join(evidence,'completed.png'));
 await writeFile(path.join(evidence,'results.json'),q({status:'PASS',scope:'Raw model substitute; native/JSON handoff, real write/check, false completion rejection, explicit continuation, cold restart, bounded noncompliance. No real-model claim.'}));
 console.log('AGENT_OUTCOME_HANDOFF=PASS evidence='+evidence);
}finally{await stop();await writeFile(path.join(evidence,'electron.log'),output.join(''));await rm(dataRoot,{recursive:true,force:true});}
