import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

// Real Electron controls and Core context compilation; deterministic model
// consumes only the compiled request for live refs/values. No production data.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-browser-continuity-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(dataRoot, 'evidence');
const output = [], q = JSON.stringify;
const plateau = process.env.FIELORA_BROWSER_PROGRESS_CASE === 'plateau';
const cases = process.env.FIELORA_BROWSER_PROGRESS_CASE === 'cases';
const targetRecovery = process.env.FIELORA_AGENT_BROWSER_TARGET_RECOVERY === '1';
const caseFocus = process.env.FIELORA_AGENT_BROWSER_CASE_FOCUS === '1';
const html = `<!doctype html><meta charset="utf-8"><title>Context continuity</title>
<label>Module <select aria-label="Module" id="module"><option>R</option>${Array.from({length:36},(_,i)=>`<option>R${i}</option>`).join('')}</select></label>
<label>Teacher <select aria-label="Teacher" id="teacher"><option>Free</option><option>Lin</option></select></label>
<button id="save">Save</button><output id="state">Unsaved</output>
<script>
const moduleControl=document.getElementById('module'),teacher=document.getElementById('teacher'),state=document.getElementById('state');
const saved=JSON.parse(localStorage.getItem('selection')||'null');
if(saved){moduleControl.value=saved.module;teacher.value=saved.teacher;state.textContent='Saved '+saved.module+' / '+saved.teacher;}
document.getElementById('save').onclick=()=>{const value={module:moduleControl.value,teacher:teacher.value};localStorage.setItem('selection',JSON.stringify(value));state.textContent='Saved '+value.module+' / '+value.teacher;};
</script><p>${'Observed schedule context. '.repeat(400)}</p>`;
const server = createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let child, cdp;
try {
  await mkdir(evidence,{recursive:true});
  const project = path.join(dataRoot,'project'); await mkdir(project);
  const launch = restarted => launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{FIELORA_AGENT_BROWSER_FIXTURE_URL:url,FIELORA_AGENT_BROWSER_RESTARTED:restarted?'1':'0'}});
  let launched = await launch(false);
  child=launched.child;
  cdp=await connectToFieloraApp({port:launched.port,output,enablePage:true,timeoutMs:120000});
  const wait=expression=>waitForExpression(cdp,expression,{output,timeoutMs:120000});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.eval('window.fieloraTest.resizeWindow({width:1400,height:900})');
  await cdp.send('Page.bringToFront');
  const ids=await cdp.eval(`(async()=>{
    const model=${q(plateau ? '__fielora_agent_fixture_browser_plateau__' : cases ? '__fielora_agent_fixture_browser_cases__' : '__fielora_agent_fixture_browser_continuity__')};
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Browser continuity fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'跨压缩继续操作',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Browser continuity',provider_config_id:p.id,model_id:model});
    const task='Exercise changing selections until context reduction, then save Module R and Teacher Lin and verify persistence after reload. Keep the original task and these notes. '+ 'Pinned user note. '.repeat(80);
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {start:{field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:40,attachments:[]},conversation:c.id};
  })()`);
  // Fixture setup writes through Core outside the UI creation flow. Load that
  // durable state explicitly; do not race the shell's initial project query.
  await cdp.send('Page.reload');
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  ids.run=(await cdp.eval(`window.fielora.agent.start(${q(ids.start)})`)).id;
  await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  if(cases){
    const paused=await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
    assert.equal(paused.status,'PAUSED');
    assert.equal(paused.error_code,'PROVIDER_UNAVAILABLE');
    await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true'); cdp.close(); cdp=null;
    await cleanupElectronProcess(child); child=null;
    launched=await launch(true); child=launched.child;
    cdp=await connectToFieloraApp({port:launched.port,output,enablePage:true,timeoutMs:120000});
    await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
    await cdp.eval('window.fieloraTest.resizeWindow({width:1400,height:900})');
    await cdp.send('Page.bringToFront');
    await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
    await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
    await cdp.eval(`window.fielora.agent.resume({run_id:${q(ids.run)}})`);
    await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  }
  const result=await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(ids.run)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(ids.run)}}),events:await window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})}))()`);
  await writeFile(path.join(evidence,'run.json'),JSON.stringify(result,null,2));
  if(plateau) {
    assert.equal(result.run.status,'PAUSED');
    assert.equal(result.run.error_code,'AGENT_REPEATED_ACTIONS',q({step:result.run.current_step,error:result.run.error_code}));
    const checks=result.tools.filter(t=>t.name==='browser_verify');
    assert.equal(checks.length,13,'One initial check plus the existing 12 unchanged-turn allowance');
    assert.ok(checks.every(t=>t.receipt.success===true));
    assert.equal(new Set(checks.map(t=>t.receipt.snapshot_id)).size,13,'Real host returns fresh snapshots');
    assert.ok(result.events.some(e=>e.payload.kind==='GENERAL_REPLAN_REQUESTED'));
    assert.ok(!result.tools.some(t=>t.name==='finish_task'));
    await captureScreenshot(cdp,path.join(evidence,'paused.png'));
    await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:'PASS',scope:'Real browser repeatedly passes the same check with fresh snapshots; unchanged existing recovery/pause boundary stops model substitute. No business completion.',run:ids.run,checks:checks.length},null,2));
    console.log(`BROWSER_PROGRESS_E2E=PASS evidence=${evidence}`);
  } else {
  assert.equal(result.run.error_code,'AGENT_USER_INPUT_REQUIRED',q({status:result.run.status,step:result.run.current_step,error:result.run.error_code}));
  assert.equal(result.tools.at(-1).arguments.reason,'FIXTURE_CONTINUITY_VERIFIED');
  const reduced=result.events.filter(e=>e.kind==='MODEL_COMPLETED' && e.payload.prompt?.budget?.reduced);
  assert.ok(reduced.length>0,'Actual compiled model request must cross reduction');
  assert.ok(reduced.every(e=>e.payload.prompt.message_manifest.some(m=>m.role==='tool')),'Latest complete tool result survives reduction');
  assert.ok(result.tools.every(t=>t.status==='COMPLETED'));
  assert.equal(result.tools.filter(t=>t.arguments.action==='open').length,cases?2:1);
  assert.equal(result.tools.filter(t=>t.arguments.action==='inspect').length,0,'No reread to recover dropped refs');
  assert.equal(result.tools.filter(t=>t.arguments.action==='click').length,1);
  assert.equal(result.tools.filter(t=>t.arguments.action==='reload').length,1);
  const verified=result.tools.findLast(t=>t.name==='browser_verify');
  assert.equal(verified.receipt.success,true,q(verified.receipt));
  if(caseFocus){
    const anchor = result.tools.find(t=>t.name==='browser' && t.arguments.case_purpose);
    assert.equal(anchor?.arguments.case_id,'persisted');
    assert.ok(anchor.arguments.case_purpose.includes('Temporary selections are test setup'));
    const continuing = result.tools.filter(t=>t.name==='browser' && t.id!==anchor.id);
    assert.ok(continuing.length>1);
    assert.ok(continuing.every(t=>t.arguments.case_id==='persisted' && !t.arguments.case_purpose),
      'Repeated IDs without purpose must retain the original setup through reduction and restart');
  }
  if(cases){
    assert.deepEqual(result.tools.filter(t=>t.name==='browser_verify').map(t=>t.arguments.case_id),targetRecovery?['initial','initial','persisted']:['initial','persisted'],'No replay of the already executed case except deliberate wrong-target negative control');
    assert.equal(result.tools.filter(t=>t.name==='browser_plan').length,targetRecovery?4:2);
    if(targetRecovery){
      const wrong=result.tools.filter(t=>t.receipt?.success===false);
      assert.equal(wrong.length,1);
      assert.equal(wrong[0].receipt.error_code,'BROWSER_WRONG_TARGET');
      assert.equal(wrong[0].receipt.target_matches_plan,false);
      assert.ok(wrong[0].receipt.snapshot_id && wrong[0].receipt.elements.length);
      assert.notEqual(wrong[0].receipt.url,wrong[0].receipt.plan_url);
      assert.equal(wrong[0].receipt.screenshot,undefined);
    }
  }
  await captureScreenshot(cdp,path.join(evidence,'desktop.png'));
  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:'PASS',scope:'Deterministic model; real Electron native selection, context reduction, save, reload and browser verification. Original real-model workshop not accepted.',caseContinuity:cases,targetRecovery,caseFocusRecoveredFromCompiledContext:caseFocus,rawCasePurposeExchangeAbsentAfterReload:caseFocus,actionHistoryRecoveredFromCompiledContext:cases,rawModuleSetupExchangeAbsentAfterReload:cases&&!targetRecovery,run:ids.run,reductions:reduced.length,toolCalls:result.tools.length},null,2));
  console.log(`BROWSER_CONTINUITY_E2E=PASS evidence=${evidence}`);
  }
} catch(error) {
  console.error(output.join('').slice(-6000));
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  throw error;
} finally {
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();}
  if(child)await cleanupElectronProcess(child);
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
