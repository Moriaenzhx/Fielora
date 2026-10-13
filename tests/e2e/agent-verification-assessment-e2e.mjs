import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..'), q = JSON.stringify;
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-assessment-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-assessment-evidence-'));
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
const calls = id => db.prepare('SELECT * FROM agent_tool_calls WHERE run_id=? ORDER BY created_at').all(id).map(t => ({ ...t, args: JSON.parse(t.arguments_json), receipt: JSON.parse(t.receipt_json ?? 'null') }));
const events = id => db.prepare('SELECT kind,payload_json FROM agent_events WHERE run_id=? ORDER BY sequence').all(id).map(e => ({ kind: e.kind, payload: JSON.parse(e.payload_json) }));
try {
  await mkdir(projectRoot); await mkdir(path.join(dataRoot, 'outside')); await mkdir(evidence, { recursive: true });
  execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  await writeFile(path.join(projectRoot, 'input.csv'), 'id,value\n1,original\n');
  await writeFile(path.join(projectRoot, 'value.py'), 'def valid_name(value): return isinstance(value, str)\n');
  await writeFile(path.join(projectRoot, 'test_baseline.py'), `import unittest,pathlib,value
class Cases(unittest.TestCase):
 def test_rejects_number(self): self.assertFalse(value.valid_name(12345))
 def test_marker(self): self.assertEqual(pathlib.Path('marker.txt').read_text(),'ready\\n')
`);
  await writeFile(path.join(projectRoot, 'test_outer.py'), String.raw`import unittest,pathlib,shutil,tempfile,subprocess,sys,json,sqlite3
TARGET='test_baseline.Cases.test_rejects_number'
def injected(source):
 old='return isinstance(value, str)'
 assert source.count(old)==1, 'Mutation must match exactly once'
 return source.replace(old,'return True')
def detected(result):
 return result['failures']==[TARGET] and result['errors']==[] and result['count']==2 and result['exit_code']==1
class Mutations(unittest.TestCase):
 def test_controlled_negative(self):
  original=pathlib.Path('value.py').read_text()
  with tempfile.TemporaryDirectory(dir='.') as temp:
   p=pathlib.Path(temp)
   for name in ['test_baseline.py','value.py','marker.txt']: shutil.copyfile(name,p/name)
   mutant=injected(original); self.assertNotEqual(mutant,original); (p/'value.py').write_text(mutant)
   code="import unittest,json,sys; s=unittest.defaultTestLoader.loadTestsFromName('test_baseline'); r=unittest.TestResult(); s.run(r); print(json.dumps({'failures':[t.id() for t,e in r.failures], 'errors':[t.id() for t,e in r.errors], 'count':r.testsRun})); sys.exit(0 if r.wasSuccessful() else 1)"
   result=subprocess.run([sys.executable,'-B','-c',code],cwd=p,capture_output=True,text=True)
   self.assertEqual(result.returncode,1,result.stderr)
   self.assertTrue(detected(dict(json.loads(result.stdout),exit_code=result.returncode)),result.stdout)
  self.assertEqual(pathlib.Path('value.py').read_text(),original)
 def test_unrelated_failure_is_not_detection(self):
  self.assertFalse(detected({'failures':['test_unrelated'],'errors':[],'count':2,'exit_code':1}))
  self.assertFalse(detected({'failures':[TARGET],'errors':['import_error'],'count':2,'exit_code':1}))
  self.assertFalse(detected({'failures':[TARGET+'_unrelated'],'errors':[],'count':2,'exit_code':1}))
  self.assertFalse(detected({'failures':[TARGET],'errors':[TARGET],'count':2,'exit_code':1}))
  self.assertFalse(detected({'failures':[TARGET],'errors':[],'count':2,'exit_code':0}))
 def test_noop_mutation_is_rejected(self):
  with self.assertRaises(AssertionError): injected('unrelated source')
class Persistence(unittest.TestCase):
 def test_new_process(self):
  with tempfile.TemporaryDirectory(dir='.') as temp:
   p=str(pathlib.Path(temp)/'test.db')
   with sqlite3.connect(p) as c:
    c.execute('CREATE TABLE issues(detail TEXT)'); c.execute('INSERT INTO issues VALUES (?)',('conflict',))
   c.close()
   result=subprocess.run([sys.executable,'-B','-c',"import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute('select detail from issues').fetchall())); c.close()",p],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
   self.assertEqual(json.loads(result.stdout),[['conflict']])
`);
  await launch();
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_verification__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:model,base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-only'});
    const f=await window.fieloraTest.createProject({title:'检查状态恢复',goal:null,root_path:${q(projectRoot)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'隔离检查与错误反馈',provider_config_id:p.id,model_id:model});
    const text='执行隔离验证，保留原始输入。';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:text,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task:text,permission:'FULL_CONTROL',max_steps:60,attachments:[]});
    return {run:r,conversation:c};})()`);
  await wait(`window.fielora.agent.get({run_id:${q(ids.run.id)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  db = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'), { readOnly: true });
  assert.equal(calls(ids.run.id).length, 8, q(calls(ids.run.id).map(t => [t.name,t.status,t.error_code])));
  let state = events(ids.run.id).findLast(e => e.payload.kind === 'GENERAL_WORK_STATE_V1').payload;
  assert.equal(state.current_work.verification.passed, false);
  assert.ok(state.current_work.verification.blockers.some(b => b.details.tool_call_id === calls(ids.run.id)[6].id));
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation.id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation.id}"]').click()`);
  await wait("document.body.innerText.includes('待解决的检查：检查未通过（_scratch）：-B -m unittest test_baseline -v')");
  await cdp.eval("document.querySelector('[data-testid=agent-pause-notice]').scrollIntoView({block:'center',behavior:'instant'})");
  await wait("(()=>{const notice=document.querySelector('[data-testid=agent-pause-notice]'),composer=document.querySelector('[data-testid=conversation-composer]');return notice && (!composer || notice.getBoundingClientRect().bottom<=composer.getBoundingClientRect().top)})()");
  await captureScreenshot(cdp, path.join(evidence, 'paused-check.png'));
  await stop(); await launch();
  assert.equal(calls(ids.run.id).length, 8, 'Restart cannot replay commands');
  await cdp.eval(`window.fielora.agent.resume({run_id:${q(ids.run.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${q(ids.run.id)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  const final = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run.id)}})`);
  const tools = calls(ids.run.id), history = events(ids.run.id);
  assert.equal(final.status, 'COMPLETED', q({ final, tools:tools.map(t => [t.name,t.status,t.error_code]) }));
  assert.equal(tools.length, 16);
  assert.equal(tools[2].error_code, 'AGENT_WORKSPACE_ESCAPE');
  assert.equal(tools[3].error_code, 'AGENT_VERIFICATION_REQUIRED');
  assert.ok(tools[3].receipt.recovery.includes(tools[2].id), 'Rejection is visible although it is not an assertion failure');
  assert.equal(tools[6].receipt.success, false, 'Negative control actually fails');
  assert.equal(tools[7].receipt.success, true, 'Different cwd passes but cannot mask that failure');
  assert.equal(tools[8].error_code, 'AGENT_VERIFICATION_REQUIRED');
  assert.ok(tools[8].receipt.recovery.includes(tools[6].id), 'The precise blocker survives restart');
  assert.equal(tools[10].receipt.success, true, 'Outer test verifies expected failure, unrelated failure rejection and no-op mutation rejection');
  assert.equal(tools[12].error_code, 'AGENT_ACCEPTANCE_SCOPE_REQUIRED', 'A passing command cannot cover an unresolved requirement');
  assert.equal(tools[13].receipt.success, true);
  const terminal = history.findLast(e => e.kind === 'RUN_COMPLETED').payload;
  assert.equal(terminal.goal_satisfied, null);
  assert.equal(terminal.remaining_required_work, null);
  assert.equal(terminal.requirement_coverage, 'UNKNOWN');
  assert.equal(terminal.acceptance.verification.passed, true);
  assert.ok(terminal.acceptance.verification.checks.some(c => c.state === 'RETIRED_TARGET'));
  assert.equal(await readFile(path.join(projectRoot, 'input.csv'), 'utf8'), 'id,value\n1,original\n');
  assert.equal(await readFile(path.join(projectRoot, 'value.py'), 'utf8'), 'def valid_name(value): return isinstance(value, str)\n');
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation.id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation.id}"]').click()`);
  await wait("document.querySelector('[data-testid=agent-result-verification] summary')?.textContent.includes('需求覆盖未确认')");
  await captureScreenshot(cdp, path.join(evidence, 'completed.png'));
  await writeFile(path.join(evidence, 'results.json'), q({ status:'PASS', scope:'Deterministic model; real Electron, Core, Python, isolated negative controls, SQLite subprocess, cold restart. No real provider acceptance.', run:final, build:history.find(e => e.kind === 'RUN_STARTED')?.payload.build_provenance, terminal, tools:tools.map(t => ({ name:t.name, status:t.status, error:t.error_code, receipt:t.receipt })) }));
  console.log(`VERIFICATION_ASSESSMENT=PASS evidence=${evidence}`);
} catch(error) {
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  if(db) await writeFile(path.join(evidence,'failure.json'),q({runs:db.prepare('select id,status,error_code,current_step from agent_runs').all(),tools:db.prepare('select name,status,arguments_json,receipt_json,error_code from agent_tool_calls').all()}));
  console.error(output.join('').slice(-1800)); console.error(`evidence=${evidence}`); throw error;
} finally { await stop(); db?.close(); await rm(dataRoot,{recursive:true,force:true}); }
