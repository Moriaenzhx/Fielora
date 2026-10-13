import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..'), q = JSON.stringify;
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-repair-freshness-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-repair-evidence-'));
const output = []; let child, cdp, db;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 90000 });
async function launch() {
  const result = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = result.child;
  cdp = await connectToFieloraApp({ port: result.port, output, enablePage: true, timeoutMs: 120000 });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function stop() {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
}
const calls = id => db.prepare('SELECT * FROM agent_tool_calls WHERE run_id=? ORDER BY created_at').all(id).map(t => ({ ...t, args: JSON.parse(t.arguments_json), receipt: JSON.parse(t.receipt_json ?? 'null') })).filter(t=>t.name!=='capability_status');
const events = id => db.prepare('SELECT kind,payload_json FROM agent_events WHERE run_id=? ORDER BY sequence').all(id).map(e => ({ kind:e.kind, payload:JSON.parse(e.payload_json) }));
const terminal = id => wait(`window.fielora.agent.get({run_id:${q(id)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive:true });
  execFileSync('git', ['init'], { cwd:projectRoot, stdio:'ignore' });
  await writeFile(path.join(projectRoot,'input.csv'), 'id,value\n1,original\n');
  await writeFile(path.join(projectRoot,'script.py'), `import os
def check():
    src = '.'
    if src.exists():
        return 1
if __name__ == '__main__':
    assert check() == 2, 'current failure: wrong value'
`);
  await writeFile(path.join(projectRoot,'test_repair.py'), `import unittest, script
class Repair(unittest.TestCase):
    def test_current_value(self): self.assertEqual(script.check(), 2)
`);
  await writeFile(path.join(projectRoot,'noise.txt'), ('Unrelated already observed data '+ 'x'.repeat(100)+'\n').repeat(800));
  await launch();
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_repair_freshness__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:model,base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-only'});
    const f=await window.fieloraTest.createProject({title:'修复证据时效',goal:null,root_path:${q(projectRoot)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'修复后继续当前检查',provider_config_id:p.id,model_id:model});
    const text='修复脚本并验证当前结果，保留 input.csv。';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:text,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task:text,permission:'FULL_CONTROL',max_steps:60,attachments:[]});
    return {run:r.id,conversation:c.id};})()`);
  await terminal(ids.run);
  db = new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'), { readOnly:true });
  let tools = calls(ids.run), history = events(ids.run);
  await writeFile(path.join(evidence,'before-restart.json'),q({ tools, history }));
  assert.equal(tools.length,11,q(tools.map(t=>[t.name,t.status,t.error_code])));
  assert.equal(tools[4].error_code,'AGENT_EDIT_ALREADY_CURRENT');
  assert.equal(tools[4].receipt.workspace_changed,false);
  assert.equal(tools[5].error_code,'AGENT_TOOL_ARGUMENTS_INVALID');
  assert.match(tools[5].receipt.recovery,/expected_sha256/);
  const obsolete = history.find(e=>e.payload.guidance_status==='HISTORICAL_INPUTS_REASSESS');
  assert.ok(obsolete,'Already-stale review must be archived, not active repair guidance');
  assert.equal(obsolete.payload.obsolete_evidence[0].applicability.state,'INPUTS_CHANGED_RECHECK_REQUIRED');
  assert.ok(history.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.budget.fits),'Full request stays in the shared budget');
  const changedBefore = await readFile(path.join(projectRoot,'script.py'),'utf8');
  assert.match(changedBefore,/os.path.exists/); assert.match(changedBefore,/return 1/);
  await stop(); await launch();
  assert.equal(calls(ids.run).length,11,'Restart cannot replay mutations');
  await cdp.eval(`window.fielora.agent.resume({run_id:${q(ids.run)}})`);
  await terminal(ids.run);
  const final = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  tools = calls(ids.run); history = events(ids.run);
  await writeFile(path.join(evidence,'result.json'),q({ final, tools, history }));
  assert.equal(final.status,'COMPLETED',q({final,tools:tools.map(t=>[t.name,t.status,t.error_code])}));
  assert.deepEqual(tools.filter(t=>t.name==='run_command').map(t=>t.receipt.exit_code),[1,1,1,0,0]);
  assert.equal(tools[11].name,'run_command','Cold resume checks the repaired version instead of rereading');
  assert.equal(tools.filter(t=>t.name==='replace_text').length,2,'One repair for each actual defect');
  assert.equal(tools.at(-1).name,'finish_task');
  assert.equal(tools.at(-1).receipt.verification_passed,true);
  assert.equal(await readFile(path.join(projectRoot,'input.csv'),'utf8'),'id,value\n1,original\n');
  await cdp.eval('window.__repairReload=true'); await cdp.send('Page.reload');
  await wait('window.__repairReload!==true && window.fieloraTest');
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  await wait('document.body.innerText.includes("脚本已修复")');
  await wait('document.querySelector("[data-testid=agent-history-toggle]")');
  await captureScreenshot(cdp,path.join(evidence,'completed.png'));
  await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]").click()');
  await wait('document.querySelector("[data-testid=operation-group-toggle]")');
  assert.equal(await cdp.eval('document.body.innerText.includes("WRONG_OLD_REPAIR")'),false,'Historical review cannot tell the user to repeat an obsolete repair');
  await wait('document.body.innerText.includes("旧复盘保留为历史记录")');
  await cdp.eval('Array.from(document.querySelectorAll("[data-testid=operation-group-toggle][aria-expanded=false]")).filter(b=>b.getAttribute("aria-controls").startsWith("operations-")).forEach(b=>b.click())');
  await wait('Array.from(document.querySelectorAll("button.operation-summary")).some(b=>b.textContent.startsWith("内容已一致"))');
  await cdp.eval('Array.from(document.querySelectorAll("button.operation-summary")).find(b=>b.textContent.startsWith("内容已一致")).click()');
  await wait('document.body.innerText.includes("本次没有写入。是否修复成功仍以当前版本的检查结果为准")');
  await cdp.eval('Array.from(document.querySelectorAll("[data-testid=operation-detail]")).find(n=>n.textContent.includes("本次没有写入")).scrollIntoView({block:"center",behavior:"instant"})');
  await captureScreenshot(cdp,path.join(evidence,'unchanged-edit.png'));
  await cdp.eval('Array.from(document.querySelectorAll("button.operation-summary")).find(b=>b.textContent.startsWith("内容已一致")).click()');
  await wait('Array.from(document.querySelectorAll("button.operation-summary")).some(b=>b.textContent.includes("内容已一致 · script.py"))');
  await cdp.eval('Array.from(document.querySelectorAll("button.operation-summary")).find(b=>b.textContent.startsWith("内容已一致")).scrollIntoView({block:"center",behavior:"instant"})');
  await captureScreenshot(cdp,path.join(evidence,'unchanged-row.png'));
  await writeFile(path.join(evidence,'summary.json'),q({status:'PASS',scope:'Deterministic model; actual guarded files/Python, stale review, compaction, cold resume, distinct new failure, fresh assertions and unchanged input. No real-provider acceptance.'}));
  console.log('AGENT_REPAIR_FRESHNESS=PASS evidence='+evidence);
} catch(error) {
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-3000)); throw error;
} finally { db?.close(); await stop(); await rm(dataRoot,{recursive:true,force:true}); }
