import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

// Deterministic model requires actual source in the compacted ACT and focused
// REVIEW prompts. Real isolated files, guarded edit, failing/passing Python
// assertions and durable restart. No production credentials or business data.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-source-continuity-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-source-evidence-'));
const output = [], q = JSON.stringify;
let child, cdp;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 90000 });
async function launch() {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  await wait('window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==="READY")');
}
async function stop() {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
}
try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  const source = '# source context\n'.repeat(400) + '\ndef pending(owed):\n    return max(sum(owed), 0) # SOURCE_AGGREGATION_TAIL\n' + '# later context\n'.repeat(300) + '# SOURCE_RESTORE_TAIL\n';
  const tests = '# test context\n'.repeat(600) + '\nimport unittest\nfrom amount import pending\nclass Cases(unittest.TestCase):\n    def test_overpayment_cannot_offset_other_projects(self):\n        self.assertEqual(pending([15000, -3000]), 15000) # SOURCE_ASSERTIONS_TAIL\n';
  await writeFile(path.join(projectRoot, 'amount.py'), source);
  await writeFile(path.join(projectRoot, 'test_amount.py'), tests);
  await writeFile(path.join(projectRoot, 'noise.txt'), 'Unrelated observed output with no implementation detail.\n'.repeat(1800));
  await launch();
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_source_continuity__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Source continuity fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'压缩后继续修改',goal:null,root_path:${q(projectRoot)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'保留源码后修复与验证',provider_config_id:p.id,model_id:model});
    const task='修复“汇总函数”并运行断言测试。';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:30,attachments:[]});
    return {run:r.id,conversation:c.id};
  })()`);
  await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  const result = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  const events = await cdp.eval(`window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})`);
  const calls = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  await writeFile(path.join(evidence,'events.json'),q(events));
  await writeFile(path.join(evidence,'calls.json'),q(calls));
  assert.equal(result.status,'COMPLETED',q(result));
  const endings=calls.filter(t=>t.name==='finish_task');
  assert.equal(endings.length,1,'Typographic quote differences must not cause repeated terminal proposals');
  assert.equal(endings[0].status,'COMPLETED');
  assert.equal(endings[0].arguments.request_quote,'修复"汇总函数"并运行断言测试。');
  assert.equal(endings[0].receipt.proposal.request_quote,'修复“汇总函数”并运行断言测试。','Persist the original source quote');
  assert.equal(endings[0].receipt.verification_passed,true);
  assert.ok(events.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.budget.fits),'Full request budget holds; larger multi-file pressure is covered by agent-coding-loop-e2e');
  const reviews=events.filter(e=>e.payload.kind==='WORK_REVIEW_V1' && e.payload.status==='RECORDED');
  assert.equal(reviews.length,2);
  assert.equal(reviews[0].payload.review.lessons.length,1);
  assert.equal(reviews[1].payload.review.lessons.length,0,'A review can acknowledge no new mistake without inventing a failed assertion');
  assert.equal(reviews[1].payload.verification_eligible,false,'Review acknowledgment is not verification');
  assert.equal(calls.filter(t=>t.name==='read_file' && t.arguments.path==='amount.py').length,2,'Never reread known source after compaction');
  assert.equal(calls.filter(t=>t.name==='read_file' && t.arguments.path==='test_amount.py').length,1);
  assert.deepEqual(calls.filter(t=>t.name==='run_command').map(t=>t.receipt?.exit_code),[1,0],'An actual failing assertion must pass after repair');
  assert.equal(calls.filter(t=>t.name==='replace_text' && t.status==='COMPLETED').length,1);
  assert.equal(await readFile(path.join(projectRoot,'amount.py'),'utf8'),source.replace('return max(sum(owed), 0)','return sum(max(value, 0) for value in owed)'));
  assert.equal(await readFile(path.join(projectRoot,'test_amount.py'),'utf8'),tests);
  for (const marker of ['SOURCE_AGGREGATION_TAIL','SOURCE_RESTORE_TAIL','SOURCE_ASSERTIONS_TAIL']) {
    assert.ok(!q(events).includes(marker),'Raw source remains in memory, not durable checkpoint events');
  }
  await cdp.eval('window.__continuityReload=true'); await cdp.send('Page.reload');
  await wait(`!window.__continuityReload && document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  await wait('document.body.innerText.includes("隔离测试中的汇总函数已修复并验证")');
  await captureScreenshot(cdp,path.join(evidence,'completed.png'));
  await stop(); await launch();
  const restored = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  assert.equal(restored.status,'COMPLETED');
  const restoredCalls = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  assert.deepEqual(restoredCalls.map(t=>t.id),calls.map(t=>t.id),'Restart must not replay edits or tests');
  await writeFile(path.join(evidence,'results.json'),q({status:'PASS',scope:'Deterministic model; real Electron, files, guarded edit, Python assertions, compaction, review and restart. Real-model task remains unverified.',run:ids.run,reductions:events.filter(e=>e.payload.kind==='GENERAL_CONTEXT_REDUCED').length}));
  console.log('AGENT_SOURCE_CONTINUITY=PASS evidence='+evidence);
} catch(error) {
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-2000)); throw error;
} finally { await stop(); await rm(dataRoot,{recursive:true,force:true}); }
