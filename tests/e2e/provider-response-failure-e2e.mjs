import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

// Real desktop/Core failure handling with a deterministic ModelError fixture.
// HTTP parsing has separate wire tests; this is not real-provider acceptance.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-response-failure-'));
const evidence = await mkdtemp(path.join(tmpdir(), 'fielora-response-failure-evidence-'));
const output = [], q = JSON.stringify;
let child, cdp, db;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs:60000 });
const click = async selector => { await wait(`document.querySelector(${q(selector)})`); await cdp.eval(`document.querySelector(${q(selector)}).click()`); };
const reload = async () => { await cdp.eval('window.__responseReload=true'); await cdp.send('Page.reload'); await wait("window.__responseReload!==true && window.fielora && document.querySelector('[data-testid=settings-nav]')"); };
try {
  const projectRoot = path.join(dataRoot, 'project'); await mkdir(projectRoot);
  execFileSync('git',['init'],{cwd:projectRoot,stdio:'ignore'});
  const launched = await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start']});
  child = launched.child;
  cdp = await connectToFieloraApp({port:launched.port,output,enablePage:true,timeoutMs:120000});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1180,height:760,deviceScaleFactor:1,mobile:false});
  const ids = await cdp.eval(`(async()=>{
    let p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'模型响应测试',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_output_limit__',custom_endpoint_acknowledged:true});
    p=await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-response-only'});
    const project=await window.fieloraTest.createProject({title:'工作室项目',goal:null,root_path:${q(projectRoot)}});
    return {provider:p.id,field:project.field_id};
  })()`);
  await reload(); await click(`[data-testid="project-${ids.field}"]`);
  await wait('document.querySelector("textarea[name=prompt]")');
  await cdp.eval(`(()=>{const e=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'请检查当前项目，并创建项目管理器。');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('[data-testid=composer-permission]'); await click('[data-testid=composer-permission-option-FULL_CONTROL]');
  await click('[data-testid=send-message]');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('长度上限')");
  db = new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'));
  const run = db.prepare('SELECT id,conversation_id,status,current_step,error_code FROM agent_runs').get();
  assert.equal(run.status,'PAUSED'); assert.equal(run.error_code,'PROVIDER_OUTPUT_LIMIT'); assert.equal(run.current_step,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_tool_calls').get().n,0,'No partial tool can execute');
  assert.deepEqual(await readdir(projectRoot),['.git']);
  const events = db.prepare('SELECT kind,payload_json AS payload FROM agent_events WHERE run_id=? ORDER BY sequence').all(run.id).map(e=>({...e,payload:JSON.parse(e.payload)}));
  const failure = events.find(e=>e.kind==='MODEL_FAILED');
  assert.equal(failure.payload.http_status,200);
  assert.equal(failure.payload.response_diagnostics.finish_reason,'OUTPUT_LIMIT');
  assert.equal(failure.payload.response_diagnostics.output_tokens,4096);
  assert.equal(events.filter(e=>e.payload.kind==='MODEL_RETRY').length,0);
  assert.ok(!JSON.stringify(events).includes('synthetic-response-only'));
  assert.equal(await cdp.eval("document.querySelector('.agent-pause-actions .is-primary').textContent"),'继续工作');
  assert.match(await cdp.eval("document.querySelector('[data-testid=agent-pause-notice]').textContent"),/已有进展会保留/);
  await captureScreenshot(cdp,path.join(evidence,'output-limit.png'));
  for (let attempt = 1; attempt <= 2; attempt++) {
    await click('.agent-pause-actions .is-primary');
    await wait(`window.fielora.agent.list({conversation_id:${q(run.conversation_id)}}).then(rs=>rs.some(r=>r.id===${q(run.id)} && r.status==='PAUSED' && r.current_step===${attempt+1}))`);
    await wait(`document.querySelector('.conversation-activity-phase')?.textContent.includes('已尝试继续 ${attempt} 次')`);
  }
  assert.equal(await cdp.eval("document.querySelectorAll('.conversation-activity-phase').length"),1,'Retries must not fill the conversation with repeated status rows');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_tool_calls').get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_events WHERE run_id=? AND kind='RUN_RESUMED'").get(run.id).n,2,'Compaction must preserve durable history');
  await captureScreenshot(cdp,path.join(evidence,'retries-collapsed.png'));
  await reload(); await click(`[data-testid="conversation-${run.conversation_id}"]`);
  await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('长度上限')");
  await wait("document.querySelector('.conversation-activity-phase')?.textContent.includes('已尝试继续 2 次')");
  const retryEvents = db.prepare('SELECT kind,payload_json AS payload FROM agent_events WHERE run_id=? ORDER BY sequence').all(run.id).map(e=>({...e,payload:JSON.parse(e.payload)}));
  // Isolated fixture replay of the historical generic error, without inventing its cause.
  db.prepare("UPDATE agent_runs SET error_code='PROVIDER_PROTOCOL_ERROR' WHERE id=?").run(run.id);
  await reload(); await click(`[data-testid="conversation-${run.conversation_id}"]`);
  await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('无法确定具体原因')");
  assert.doesNotMatch(await cdp.eval("document.querySelector('[data-testid=agent-pause-notice]').textContent"),/已有修改/);
  await captureScreenshot(cdp,path.join(evidence,'historical-unknown.png'));
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({status:'PASS',run,events,retryEvents,retryRowsAfterReload:1,resumeHistoryCount:2,scope:'isolated synthetic model error; no real provider'},null,2));
  console.log(`PROVIDER_RESPONSE_FAILURE=PASS evidence=${evidence}`);
} catch(error) {
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-3000)); throw error;
} finally {
  db?.close();
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();}
  if(child) await cleanupElectronProcess(child);
  await rm(dataRoot,{recursive:true,force:true});
}
