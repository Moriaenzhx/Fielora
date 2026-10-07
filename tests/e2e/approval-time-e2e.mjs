import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

// Persisted timing replay only. No model invocation, production state, approval
// resolution or installation. Match the reported pause/resume/approval offsets.
const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-approval-time-'));
const evidence=await mkdtemp(path.join(tmpdir(),'fielora-approval-time-evidence-'));
const output=[];
let child,cdp,db;
const wait=expression=>waitForExpression(cdp,expression,{output,timeoutMs:60000});
const click=async selector=>{await wait(`document.querySelector(${JSON.stringify(selector)})`);await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);};
const launch=async()=>{
  const result=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start']});
  child=result.child;cdp=await connectToFieloraApp({port:result.port,output,enablePage:true,timeoutMs:120000});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
};
const stop=async()=>{if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();cdp=null;}if(child){await cleanupElectronProcess(child);child=null;}};
try {
  const projectRoot=path.join(dataRoot,'project');await mkdir(projectRoot);await launch();
  const ids=await cdp.eval(`(async()=>{
    const p=await window.fieloraTest.createProject({title:'审批计时回放',goal:null,root_path:${JSON.stringify(projectRoot)}});
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Timing replay',base_url:'https://example.com/v1',default_model:'timing-replay',custom_endpoint_acknowledged:true});
    const c=await window.fielora.conversation.create({field_id:p.field_id,title:'等待审批不计入处理时间',provider_config_id:provider.id,model_id:'timing-replay'});
    const u=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:'继续项目并保留原始数据。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {field:p.field_id,provider:provider.id,conversation:c.id,user:u.id};
  })()`);
  db=new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const uuid=()=>{const id=randomUUID();return `${id.slice(0,14)}7${id.slice(15)}`;};
  const run=uuid(),tool=uuid(),approval=uuid(),start=Date.now()-26*3600000,end=start+5945394;
  const args={program:'/usr/bin/python3',argv:['-m','pip','install','-r','requirements.txt']};
  db.prepare(`INSERT INTO agent_runs(id,field_id,conversation_id,provider_config_id,model_id,task,permission,status,current_step,max_steps,next_sequence,error_code,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,'FULL_CONTROL','WAITING_APPROVAL',38,4096,7,NULL,?,?,NULL)`).run(run,ids.field,ids.conversation,ids.provider,'timing-replay','继续项目',start,end);
  db.prepare('INSERT INTO agent_tool_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(tool,run,'run_command','PROCESS','WAITING_APPROVAL','ASK',JSON.stringify(args),null,null,end-4,end-2,null);
  const nonce=randomUUID().replaceAll('-','');
  db.prepare('INSERT INTO agent_approvals VALUES(?,?,?,?,?,?,?)').run(approval,run,tool,null,nonce,end,null);
  let seq=0;
  const event=(kind,at,payload={})=>db.prepare('INSERT INTO agent_events VALUES(?,?,?,?,?,?,?)').run(uuid(),run,++seq,1,kind,JSON.stringify(payload),at);
  event('RUN_CREATED',start,{user_message_id:ids.user});event('RUN_STARTED',start+2,{task_class:'GENERAL'});
  event('RUN_PAUSED',start+237320,{reason:'PROVIDER_INVALID_TOOL_CALL'});event('RUN_RESUMED',start+5540688,{reason:'USER_RESUME'});
  event('TOOL_PROPOSED',end-4,{tool_call_id:tool,name:'run_command'});
  event('APPROVAL_REQUESTED',end,{approval:{id:approval,run_id:run,tool_call_id:tool,nonce,created_at:end,decision:null,resolved_at:null},tool:{id:tool,name:'run_command',effect:'PROCESS',arguments:args}});
  const expected='已处理 10 分 42 秒';
  const verify=async label=>{
    await click(`[data-testid="conversation-${ids.conversation}"]`);
    await wait(`document.querySelector('[data-testid=agent-running-header]')?.textContent===${JSON.stringify(expected)}`);
    // Exercise timer ticks without changing the durable timestamps.
    const readings=await cdp.eval("new Promise(resolve=>{const r=[];let n=0;const t=setInterval(()=>{r.push(document.querySelector('[data-testid=agent-running-header]').textContent);if(++n===3){clearInterval(t);resolve(r);}},1100);})");
    assert.deepEqual(readings,[expected,expected,expected]);
    assert.equal(db.prepare('SELECT status FROM agent_runs WHERE id=?').get(run).status,'WAITING_APPROVAL');
    assert.equal(db.prepare('SELECT decision FROM agent_approvals WHERE id=?').get(approval).decision,null);
    await captureScreenshot(cdp,path.join(evidence,`${label}.png`));
  };
  await cdp.send('Page.reload');await verify('waiting');
  await stop();await launch();await verify('restarted');
  await writeFile(path.join(evidence,'results.json'),JSON.stringify({status:'PASS',expected,active_ms:642026,scope:'isolated real desktop/Core, passive ledger replay and process restart; no model or command execution'},null,2));
  console.log(`APPROVAL_TIME=PASS evidence=${evidence}`);
} catch(error) {
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(`evidence=${evidence}\n${output.join('').slice(-2500)}`);throw error;
} finally {await stop();db?.close();await rm(dataRoot,{recursive:true,force:true});}
