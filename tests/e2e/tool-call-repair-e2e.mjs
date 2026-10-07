import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

// Real desktop/Core retry loop; synthetic model responses, no remote credentials.
// Model separately validates large code and malformed JSON over local HTTP/SSE.
const root = path.resolve(import.meta.dirname, '../..');
const evidence = await mkdtemp(path.join(tmpdir(), 'fielora-tool-repair-evidence-'));
const q = JSON.stringify;
for (const rejected of [false, true]) {
  const label = rejected ? 'rejected' : 'repaired';
  const dataRoot = await mkdtemp(path.join(tmpdir(), `fielora-tool-${label}-`));
  const output = [];
  let child, cdp, db;
  try {
    const projectRoot = path.join(dataRoot, 'project'); await mkdir(projectRoot);
    execFileSync('git', ['init'], {cwd:projectRoot, stdio:'ignore'});
    const launched = await launchElectron({root:path.join(root,'apps/desktop'), dataRoot, output,
      executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
      args:process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start']});
    child=launched.child;
    cdp=await connectToFieloraApp({port:launched.port,output,enablePage:true,timeoutMs:120000});
    const wait=expression=>waitForExpression(cdp,expression,{output,timeoutMs:60000});
    const click=async selector=>{await wait(`document.querySelector(${q(selector)})`);await cdp.eval(`document.querySelector(${q(selector)}).click()`);};
    const reload=async()=>{await cdp.eval('window.__repairReload=true');await cdp.send('Page.reload');await wait("window.__repairReload!==true && window.fielora && document.querySelector('[data-testid=settings-nav]')");};
    await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1180,height:760,deviceScaleFactor:1,mobile:false});
    const field=await cdp.eval(`(async()=>{
      const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'调用纠正测试',base_url:'https://example.com/v1',default_model:${q(rejected?'__fielora_agent_fixture_tool_repair_rejected__':'__fielora_agent_fixture_tool_repair__')},custom_endpoint_acknowledged:true});
      await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-tool-repair-only'});
      return (await window.fieloraTest.createProject({title:'工具参数纠正',goal:null,root_path:${q(projectRoot)}})).field_id;
    })()`);
    await reload();await click(`[data-testid="project-${field}"]`);
    await wait('document.querySelector("textarea[name=prompt]")');
    await cdp.eval(`(()=>{const e=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'创建 requirements.txt 和 app.py，保留已经完成的写入。');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-testid=composer-permission]');await click('[data-testid=composer-permission-option-FULL_CONTROL]');
    await click('[data-testid=send-message]');
    await wait(`document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes(${q(rejected?'纠正要求':'测试已收到有效的纠正调用')})`);
    db=new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'));
    const run=db.prepare('SELECT id,conversation_id,status,error_code,current_step FROM agent_runs').get();
    const events=db.prepare('SELECT kind,payload_json FROM agent_events WHERE run_id=? ORDER BY sequence').all(run.id).map(e=>({kind:e.kind,payload:JSON.parse(e.payload_json)}));
    const retries=events.filter(e=>e.payload.kind==='MODEL_RETRY');
    assert.equal(retries.length,1,'Only one automatic retry');
    assert.equal(retries[0].payload.tool_validation_feedback,true);
    assert.equal(retries[0].payload.response_diagnostics.failure_stage,'TOOL_ARGUMENTS_JSON');
    assert.equal(retries[0].payload.response_diagnostics.argument_json_error.category,'SYNTAX');
    assert.notDeepEqual(retries[0].payload.previous_prompt,retries[0].payload.retry_prompt,'Correction must change the model input');
    assert.equal(await readFile(path.join(projectRoot,'requirements.txt'),'utf8'),'Flask==3.0.0\n');
    const tools=db.prepare('SELECT name,status,arguments_json FROM agent_tool_calls WHERE run_id=? ORDER BY created_at').all(run.id).map(t=>({...t,args:JSON.parse(t.arguments_json)}));
    assert.equal(tools.filter(t=>t.name==='create_file'&&t.args.path==='requirements.txt').length,1,'Never replay the successful write');
    assert.ok(tools.every(t=>t.status==='COMPLETED'));
    if(rejected) {
      assert.deepEqual((await readdir(projectRoot)).sort(),['.git','requirements.txt']);
      assert.equal(events.filter(e=>e.kind==='MODEL_FAILED').length,1);
      await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('纠正要求')");
    } else {
      assert.match(await readFile(path.join(projectRoot,'app.py'),'utf8'),/repair verified/);
      assert.equal(tools.filter(t=>t.name==='create_file'&&t.args.path==='app.py').length,1);
      assert.equal(events.filter(e=>e.kind==='MODEL_FAILED').length,0);
    }
    await reload();await click(`[data-testid="conversation-${run.conversation_id}"]`);
    await wait("document.querySelector('[data-testid=agent-pause-notice]')");
    if(rejected) {
      await click('.agent-pause-actions .is-primary');
      await wait(`window.fielora.agent.list({conversation_id:${q(run.conversation_id)}}).then(rs=>rs.some(r=>r.id===${q(run.id)} && r.status==='PAUSED' && r.current_step>${run.current_step}))`);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_events WHERE run_id=? AND kind='RUN_RESUMED'").get(run.id).n,1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_tool_calls WHERE run_id=? AND name='create_file'").get(run.id).n,1);
      assert.deepEqual((await readdir(projectRoot)).sort(),['.git','requirements.txt']);
      await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('纠正要求')");
    }
    await captureScreenshot(cdp,path.join(evidence,`${label}.png`));
    assert.ok(!JSON.stringify(events).includes('synthetic-tool-repair-only'));
    const finalRun=db.prepare('SELECT id,conversation_id,status,error_code,current_step FROM agent_runs WHERE id=?').get(run.id);
    const finalEvents=db.prepare('SELECT kind,payload_json FROM agent_events WHERE run_id=? ORDER BY sequence').all(run.id).map(e=>({kind:e.kind,payload:JSON.parse(e.payload_json)}));
    await writeFile(path.join(evidence,`${label}.json`),JSON.stringify({status:'PASS',scope:'isolated synthetic model/Core retry; not real-provider business acceptance',run,events,tools,finalRun,finalEvents,explicitResumeVerified:rejected},null,2));
  } catch(error) {
    if(cdp)await captureScreenshot(cdp,path.join(evidence,`${label}-failure.png`)).catch(()=>{});
    console.error(output.join('').slice(-4000));throw error;
  } finally {
    db?.close();
    if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();}
    if(child)await cleanupElectronProcess(child);
    await rm(dataRoot,{recursive:true,force:true});
  }
}
console.log(`TOOL_CALL_REPAIR=PASS evidence=${evidence}`);
