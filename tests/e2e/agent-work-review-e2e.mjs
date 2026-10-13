import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {launchElectron,connectToFieloraApp,waitForExpression,captureScreenshot,cleanupElectronProcess} from './harness/electron-cdp-harness.mjs';
const root=path.resolve(import.meta.dirname,'../..'), q=JSON.stringify;
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-review-'));
const projectRoot=path.join(dataRoot,'project');
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR??await mkdtemp(path.join(tmpdir(),'fielora-review-evidence-'));
await mkdir(evidence,{recursive:true});
await mkdir(projectRoot); execFileSync('git',['init'],{cwd:projectRoot,stdio:'ignore'});
const source='id,value\n1,original\n';await writeFile(path.join(projectRoot,'input.csv'),source);
await writeFile(path.join(projectRoot,'source.txt'),'one\n');
await writeFile(path.join(projectRoot,'recovery.txt'),Array.from({length:42},(_,i)=>`Observed source range ${i}\n`).join(''));
await writeFile(path.join(projectRoot,'print_check.py'),"print('FAIL: this only prints; it does not assert anything')\n");
await writeFile(path.join(projectRoot,'test_acceptance.py'),`import unittest,pathlib,tempfile,sqlite3
class Cases(unittest.TestCase):
 def test_source(self):
  self.assertIn(pathlib.Path('source.txt').read_text(), ['one\\n','two\\n'])
 def test_isolated_import(self):
  original=pathlib.Path('input.csv').read_bytes()
  with tempfile.TemporaryDirectory() as directory:
   with sqlite3.connect(str(pathlib.Path(directory)/'fixture.db')) as c:
    c.execute('CREATE TABLE items(id INTEGER PRIMARY KEY, amount INTEGER)')
    for repeat in range(2):
     c.executemany('INSERT OR IGNORE INTO items VALUES (?,?)',[(1,200),(2,300)])
    self.assertEqual(c.execute('SELECT count(*),sum(amount) FROM items').fetchone(),(2,500))
  self.assertEqual(pathlib.Path('input.csv').read_bytes(),original)
`);
for(const name of ['contract-a.txt','contract-b.txt'])await writeFile(path.join(projectRoot,name),Array.from({length:550},(_,i)=>`Contract ${name} ${i}: /receipt uses client_id; URL encode query text.\n`).join(''));
await writeFile(path.join(projectRoot,'check.py'),`import sys,tempfile,pathlib
if sys.argv[1]!='corrected':
 print('Rejected test assumption: '+sys.argv[1])
 sys.exit(1)
assert pathlib.Path('input.csv').read_text()=='id,value\\n1,original\\n'
with tempfile.TemporaryDirectory(dir='.') as d:
 p=pathlib.Path(d)/'fixture.csv';p.write_text('id,value\\n2,test\\n');assert '2,test' in p.read_text()
print('Isolated check passed; original input preserved')
`);
let child,cdp,db;const output=[];
const wait=e=>waitForExpression(cdp,e,{output,timeoutMs:90000});
async function launch(){
 const r=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start']});child=r.child;
 cdp=await connectToFieloraApp({port:r.port,output,enablePage:true,timeoutMs:120000});
 await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function stop(){if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();cdp=null;}if(child){await cleanupElectronProcess(child);child=null;}}
const events=id=>db.prepare('SELECT kind,payload_json FROM agent_events WHERE run_id=? ORDER BY sequence').all(id).map(e=>({kind:e.kind,payload:JSON.parse(e.payload_json)}));
const calls=id=>db.prepare('SELECT name,status,arguments_json,receipt_json FROM agent_tool_calls WHERE run_id=? ORDER BY created_at').all(id).map(t=>({...t,args:JSON.parse(t.arguments_json),receipt:JSON.parse(t.receipt_json??'null')}));
async function start(invalid=false, live=false, acceptance=false, feedback=false){return cdp.eval(`(async()=>{
 const model=${q(feedback==='resume'?'__fielora_agent_fixture_resume_reads__':feedback?'__fielora_agent_fixture_review_feedback__':acceptance?'__fielora_agent_fixture_acceptance__':live?'__fielora_agent_fixture_review_live__':invalid?'__fielora_agent_fixture_review_invalid__':'__fielora_agent_fixture_review__')};
 const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:model,base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
 await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-review-only'});
 const f=await window.fieloraTest.createProject({title: ${q(invalid?'拒绝复盘夹带动作':'继续任务保留纠正')},goal:null,root_path:${q(projectRoot)}});
 const c=await window.fielora.conversation.create({field_id:f.field_id,title:'失败后的纠错验证',provider_config_id:p.id,model_id:model});
 const text='执行隔离验证，保留原始输入。';
 const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:text,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
 const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task:text,permission:'FULL_CONTROL',max_steps:60,attachments:[]});
 return {run:r,provider:p,conversation:c};})()`);}
try{
 await launch();
 const recovery=await start(false,false,false,'resume');
 await wait(`window.fielora.agent.get({run_id:${q(recovery.run.id)}}).then(r=>r.status==='PAUSED')`);
 db=new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'),{readOnly:true});
 assert.equal(calls(recovery.run.id).filter(t=>t.name==='read_file').length,14);
 await stop();await launch();
 assert.equal(calls(recovery.run.id).length,14,'Restart must not replay tools');
 await cdp.eval(`window.fielora.agent.resume({run_id:${q(recovery.run.id)}})`);
 await wait(`window.fielora.agent.get({run_id:${q(recovery.run.id)}}).then(r=>['COMPLETED','PAUSED','FAILED'].includes(r.status))`);
 const recoveryFinal=await cdp.eval(`window.fielora.agent.get({run_id:${q(recovery.run.id)}})`);
 assert.equal(recoveryFinal.status,'COMPLETED',q(recoveryFinal));
 for (const e of events(recovery.run.id).filter(e=>e.kind==='MODEL_COMPLETED')) {
  assert.equal(e.payload.prompt.context_sections.current_work.count,1,'Exactly one current projection reaches execution');
  assert.equal(e.payload.prompt.context_sections.review_evidence.count,0,'Successful source reacquisition keeps execution tools and omits review-only context');
  assert.equal(e.payload.prompt.context_sections.legacy_work_plan.count,0);
 }

 assert.equal(calls(recovery.run.id).filter(t=>t.name==='read_file').length,28);
 assert.equal(calls(recovery.run.id).filter(t=>t.name==='run_command').length,1);
 await writeFile(path.join(evidence,'resume-reads.json'),q({status:'PASS',scope:'Deterministic model, real cold restart and range reads; not real-provider convergence',run:recoveryFinal,build:events(recovery.run.id).findLast(e=>e.payload.kind==='EXECUTION_BUILD_PROVENANCE')?.payload.build_provenance}));
 const feedback=await start(false,false,false,true);
 await wait(`window.fielora.agent.get({run_id:${q(feedback.run.id)}}).then(r=>['COMPLETED','PAUSED','FAILED'].includes(r.status))`);
 const feedbackFinal=await cdp.eval(`window.fielora.agent.get({run_id:${q(feedback.run.id)}})`);
 assert.equal(feedbackFinal.status,'COMPLETED',q(feedbackFinal));
 const feedbackEvents=events(feedback.run.id), feedbackReviews=feedbackEvents.filter(e=>e.payload.kind==='WORK_REVIEW_V1');
 assert.deepEqual(feedbackReviews.map(e=>e.payload.status),['INVALID_REVIEW','INVALID_REVIEW']);
 assert.equal(feedbackReviews.at(-1).payload.repair_pending,false);
 assert.ok(feedbackEvents.slice(feedbackEvents.lastIndexOf(feedbackReviews.at(-1))+1).some(e=>e.payload.kind==='GENERAL_REPLAN_REQUESTED'),'Execution feedback survives review throttling');
 assert.equal(calls(feedback.run.id).filter(t=>t.name==='run_command').length,1,'No unnecessary rerun of a passing unchanged check');
 assert.ok(!feedbackEvents.some(e=>e.kind==='RUN_PAUSED'));
 assert.equal(await readFile(path.join(projectRoot,'input.csv'),'utf8'),source);
 await writeFile(path.join(evidence,'feedback.json'),q({status:'PASS',scope:'Deterministic model with real checks; not real-provider convergence',run:feedbackFinal,reviews:feedbackReviews.map(e=>e.payload)}));
 const first=await start();
 await wait(`window.fielora.agent.get({run_id:${q(first.run.id)}}).then(r=>r.status==='PAUSED')`);
 let before=events(first.run.id);const reviews=before.filter(e=>e.payload.kind==='WORK_REVIEW_V1');
 const reviewSteps=before.filter(e=>e.kind==='STEP_STARTED'&&e.payload.phase==='REVIEW').map(e=>e.payload.step);
 assert.equal(reviewSteps.length,0,'Optional review must not replace the execution catalog');
 assert.ok(before.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.visible_tool_names.includes('replace_text')));
 assert.equal(reviews.length,1);assert.equal(reviews[0].payload.status,'RECORDED');
 assert.equal(reviews[0].payload.verification_eligible,false);assert.equal(reviews[0].payload.grants_authority,false);
 assert.ok(before.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.budget.fits),'Shared request budget enforced; pressure compaction is covered by agent-coding-loop-e2e');
 assert.equal(calls(first.run.id).filter(t=>t.name==='run_command').length,3);
 await cdp.eval(`(async()=>{const p=await window.fielora.provider.get({provider_config_id:${q(first.provider.id)}});await window.fielora.provider.updateRuntime({provider_config_id:p.id,expected_provider_revision:p.revision,expected_revision:p.model_runtime.revision,settings:{reasoning:'PROVIDER_DEFAULT',max_output_tokens:8192}});})()`);
 await stop();await launch();
 assert.equal(events(first.run.id).filter(e=>e.payload.kind==='MODEL_RUNTIME_SETTINGS_V1').length,1,'Restart alone must not replay work or refresh settings');
 await cdp.eval(`window.fielora.agent.resume({run_id:${q(first.run.id)}})`);
 await wait(`window.fielora.agent.get({run_id:${q(first.run.id)}}).then(r=>['COMPLETED','PAUSED','FAILED'].includes(r.status))`);
 const final=await cdp.eval(`window.fielora.agent.get({run_id:${q(first.run.id)}})`);
 assert.equal(final.status,'COMPLETED',q(final));
 const after=events(first.run.id), executed=calls(first.run.id);
 assert.equal(after.filter(e=>e.payload.kind==='WORK_REVIEW_V1').length,1,'No new work means no duplicate review on resume');
 assert.deepEqual(after.filter(e=>e.payload.kind==='MODEL_RUNTIME_SETTINGS_V1').map(e=>e.payload.settings.max_output_tokens),[4096,8192]);
 assert.equal(executed.filter(t=>t.name==='run_command').length,4,'Failed approaches are not replayed');
 assert.equal(executed.find(t=>t.args.argv?.[1]==='corrected').receipt.success,true);
 assert.equal(await readFile(path.join(projectRoot,'input.csv'),'utf8'),source);
 await cdp.eval('window.__reviewReload=true');await cdp.send('Page.reload');
 await wait("window.__reviewReload!==true && window.fielora && document.querySelector('[data-testid=settings-nav]')");
 await wait(`document.querySelector('[data-testid="conversation-${first.conversation.id}"]')`);
 await cdp.eval(`document.querySelector('[data-testid="conversation-${first.conversation.id}"]').click()`);
 await wait('document.querySelector("[data-testid=agent-history-toggle]")');
 assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]").getAttribute("aria-expanded")'),'false');
 await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]").click()');
 await wait("document.body.innerText.includes('已复盘之前的尝试，接下来验证')");
 await captureScreenshot(cdp,path.join(evidence,'restored-review.png'));

 const invalid=await start(true);await wait(`window.fielora.agent.get({run_id:${q(invalid.run.id)}}).then(r=>r.status==='PAUSED')`);
 const rejected=events(invalid.run.id).filter(e=>e.payload.kind==='WORK_REVIEW_V1');
 assert.equal(rejected.length,1);assert.equal(rejected[0].payload.status,'INVALID_REVIEW');
 assert.ok(!calls(invalid.run.id).some(t=>t.name==='create_file'));await assert.rejects(access(path.join(projectRoot,'must-not-exist.txt')));
 assert.equal(rejected[0].payload.rejection_code,'REVIEW_MIXED_CALLS');
 const live=await start(false,true);
 await wait(`window.fielora.agent.get({run_id:${q(live.run.id)}}).then(r=>['COMPLETED','PAUSED','FAILED'].includes(r.status))`);
 const liveFinal=await cdp.eval(`window.fielora.agent.get({run_id:${q(live.run.id)}})`);
 assert.equal(liveFinal.status,'COMPLETED',q(liveFinal));
 const liveEvents=events(live.run.id), liveReviews=liveEvents.filter(e=>e.payload.kind==='WORK_REVIEW_V1');
 assert.deepEqual(liveReviews.map(e=>[e.payload.status,e.payload.reason,e.payload.tool_count]),[
  ['INVALID_REVIEW','MODEL_IDENTIFIED_CORRECTION',2],['RECORDED','MODEL_IDENTIFIED_CORRECTION',2]
 ]);
 assert.equal(liveReviews[0].payload.rejection_code,'REVIEW_SCHEMA_INVALID');
 assert.ok(!liveEvents.some(e=>['RUN_PAUSED','RUN_RESUMED'].includes(e.kind)),'Correction must work within the running task');
 assert.equal(calls(live.run.id).filter(t=>t.name==='run_command').length,2,'One failed approach then one corrected check');
 assert.equal(await readFile(path.join(projectRoot,'input.csv'),'utf8'),source);
 const acceptance=await start(false,false,true);
 await wait(`window.fielora.agent.get({run_id:${q(acceptance.run.id)}}).then(r=>r.status==='PAUSED')`);
 const plansBefore=calls(acceptance.run.id).filter(t=>t.name==='work_plan');
 assert.equal(plansBefore.length,2);
 assert.equal(plansBefore[0].receipt.plan.criteria[0].check.status,'pending','Print-only script must not establish acceptance');
 assert.equal(plansBefore[1].receipt.plan.criteria[0].check.status,'passed');
 assert.equal(plansBefore[1].receipt.verification_eligible,false,'A plan never creates verification authority');
 await stop();await launch();
 await cdp.eval(`window.fielora.agent.resume({run_id:${q(acceptance.run.id)}})`);
 await wait(`window.fielora.agent.get({run_id:${q(acceptance.run.id)}}).then(r=>['COMPLETED','PAUSED','FAILED'].includes(r.status))`);
 const acceptanceFinal=await cdp.eval(`window.fielora.agent.get({run_id:${q(acceptance.run.id)}})`);
 assert.equal(acceptanceFinal.status,'COMPLETED',q(acceptanceFinal));
 const acceptanceCalls=calls(acceptance.run.id), finalPlan=acceptanceCalls.filter(t=>t.name==='work_plan').at(-1).receipt.plan;
 assert.deepEqual(finalPlan.criteria.map(c=>c.check.status),['passed','passed']);
 assert.equal(acceptanceCalls.filter(t=>t.name==='finish_task').length,2,'Premature completion is rejected before reconciliation');
 const finishReceipt=acceptanceCalls.filter(t=>t.name==='finish_task').at(-1).receipt;
 assert.equal(finishReceipt.acceptance.requirement_coverage,'UNKNOWN','A tool check never proves full semantic coverage');
 assert.deepEqual(finishReceipt.acceptance.unresolved_checks,[]);
 const checkpoints=events(acceptance.run.id).filter(e=>e.payload.kind==='GENERAL_WORK_STATE_V1');
 assert.ok(checkpoints.some(e=>e.payload.goal.status==='RESOLVE_RECORDED_CHECKS' && e.payload.current_work.checks_passed===true),'Checkpoint and completion use the same unresolved cases');

 assert.equal(acceptanceCalls.filter(t=>t.name==='run_command').length,3,'Only stale source case reruns after restart');
 assert.equal(acceptanceCalls.filter(t=>t.name==='run_command').at(-1).args.argv.at(-1),'test_acceptance.Cases.test_source');
 assert.equal(finalPlan.criteria[1].check.tool_call_id,plansBefore[1].receipt.plan.criteria[1].check.tool_call_id,'Unchanged CSV case keeps original evidence');
 assert.equal(await readFile(path.join(projectRoot,'input.csv'),'utf8'),source);
 await writeFile(path.join(evidence,'acceptance.json'),q({status:'PASS',run:acceptanceFinal,plan:finalPlan}));
 await captureScreenshot(cdp,path.join(evidence,'desktop.png'));
 await writeFile(path.join(evidence,'results.json'),q({status:'PASS',scope:'Deterministic model; real Electron/Core/commands/compaction/restart, not real-provider accuracy',first:final,review:reviews[0].payload,rejected:rejected[0].payload,live:{status:liveFinal.status,reviews:liveReviews.map(e=>e.payload)},settings:after.filter(e=>e.payload.kind==='MODEL_RUNTIME_SETTINGS_V1').map(e=>e.payload),commands:executed.filter(t=>t.name==='run_command').map(t=>({args:t.args,success:t.receipt.success}))}));
 console.log(`WORK_REVIEW=PASS evidence=${evidence}`);
}catch(error){if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});if(db)await writeFile(path.join(evidence,'failure.json'),q({runs:db.prepare('select id,status,error_code,current_step from agent_runs').all(),events:db.prepare('select kind,payload_json from agent_events').all(),tools:db.prepare('select name,status,error_code from agent_tool_calls').all()}));console.error(output.join('').slice(-1500));console.error(`evidence=${evidence}`);throw error;
}finally{await stop();db?.close();await rm(dataRoot,{recursive:true,force:true});}
