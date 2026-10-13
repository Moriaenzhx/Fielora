import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..'), q = JSON.stringify;
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-stalled-success-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-stall-evidence-'));
const output = []; let child, cdp, db;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 90000 });
async function launch() {
  const result = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = result.child; cdp = await connectToFieloraApp({ port: result.port, output, enablePage: true, timeoutMs: 120000 });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function stop() {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
}
const calls = id => db.prepare('SELECT * FROM agent_tool_calls WHERE run_id=? ORDER BY created_at').all(id).map(t => ({ ...t, args: JSON.parse(t.arguments_json), receipt: JSON.parse(t.receipt_json ?? 'null') }));
const events = id => db.prepare('SELECT kind,payload_json FROM agent_events WHERE run_id=? ORDER BY sequence').all(id).map(e => ({ kind:e.kind, payload:JSON.parse(e.payload_json) }));
async function start(stubborn) {
  const projectRoot = path.join(dataRoot, stubborn ? 'stubborn' : 'recovered');
  await mkdir(projectRoot); execFileSync('git', ['init'], { cwd:projectRoot, stdio:'ignore' });
  await writeFile(path.join(projectRoot, 'input.csv'), 'name\noriginal\n');
  await writeFile(path.join(projectRoot, 'service.py'), `import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs
STATE = {'name': 'original'}
def restore(data):
    if not data: raise ValueError('invalid backup')
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        form = parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode())
        if self.path != '/backup/restore' or form.get('confirm') != ['RESTORE']:
            self.send_error(422); return
        try:
            restore(json.loads(form['backup'][0]))
        except ValueError:
            STATE['name'] = 'corrupted' # HTTP_ERROR_CORRUPTS_NAME
            self.send_response(400); self.end_headers(); self.wfile.write(b'restore rejected')
        else:
            self.send_response(200); self.end_headers(); self.wfile.write(b'success')
    def log_message(self, *args): pass
`);
  await writeFile(path.join(projectRoot, 'test_direct.py'), `import unittest
import service
class Direct(unittest.TestCase):
    def test_http_named_but_direct(self):
        with self.assertRaises(ValueError): service.restore({}) # DIRECT_CALL_ONLY
`);
  await writeFile(path.join(projectRoot, 'noise.txt'), ('Unrelated observed context. ' + 'x'.repeat(90) + '\n').repeat(600));
  return await cdp.eval(`(async()=>{
    const model=${q(stubborn?'__fielora_agent_fixture_stalled_stubborn__':'__fielora_agent_fixture_stalled_success__')};
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:model,base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-only'});
    const f=await window.fieloraTest.createProject({title:${q(stubborn?'重复保护':'成功读取后的纠偏')},goal:null,root_path:${q(projectRoot)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'检查通过与验收范围',provider_config_id:p.id,model_id:model});
    const text='补齐 HTTP 拒绝恢复时的数据保护断言并修复缺陷。';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:text,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task:text,permission:'FULL_CONTROL',max_steps:60,attachments:[]});
    return {run:r.id,conversation:c.id,projectRoot:${q(projectRoot)}};})()`);
}
async function terminal(id) {
  await wait(`window.fielora.agent.get({run_id:${q(id)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  return await cdp.eval(`window.fielora.agent.get({run_id:${q(id)}})`);
}
try {
  await mkdir(evidence, { recursive:true }); await launch();
  const good = await start(false);
  const final = await terminal(good.run);
  db = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'), { readOnly:true });
  const tools = calls(good.run), history = events(good.run);
  await writeFile(path.join(evidence, 'recovered.json'), q({ final, tools, history }));
  assert.equal(final.status, 'COMPLETED', q({ final, tools:tools.map(t=>[t.name,t.status,t.error_code]) }));
  assert.deepEqual(tools[0].receipt.argument_diagnostics, [{ field:'criteria', constraint:'maxItems', limit:32, actual:33 }]);
  assert.equal(tools[1].receipt.plan.criteria.length, 10);
  const reviews = history.filter(e=>e.payload.kind==='WORK_REVIEW_V1');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].payload.reason, 'MODEL_IDENTIFIED_CORRECTION');
  assert.equal(reviews[0].payload.status, 'RECORDED');
  assert.equal(reviews[0].payload.verification_eligible, false);
  assert.deepEqual(tools.filter(t=>t.name==='run_command').map(t=>t.receipt.exit_code), [0,1,0], 'Weak direct test passes, actual HTTP catches corruption, guarded repair passes');
  assert.equal(tools.filter(t=>t.name==='replace_text').length, 1);
  const reductions = history.filter(e=>e.payload.kind==='GENERAL_CONTEXT_REDUCED').length;
  assert.ok(history.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.budget.fits),'Recovery shares the final request budget; larger pressure is covered separately');
  const result = tools.find(t=>t.name==='finish_task').receipt;
  assert.equal(result.acceptance.requirement_coverage, 'UNKNOWN');
  assert.equal(result.acceptance.unassessed_plan_items.length, 10);
  assert.ok(result.proposal.summary.includes('HTTP rejected restore preserves client name'));
  assert.equal(await readFile(path.join(good.projectRoot,'input.csv'),'utf8'), 'name\noriginal\n');
  // Fixture setup uses the Core API, bypassing the shell's import action.
  // Load the persisted project/conversation before asserting user presentation.
  await cdp.eval('window.__stallReload=true'); await cdp.send('Page.reload');
  await wait('window.__stallReload!==true && window.fieloraTest');
  await wait(`document.querySelector('[data-testid="conversation-${good.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${good.conversation}"]').click()`);
  await wait('document.body.innerText.includes("验收范围说明")');
  await captureScreenshot(cdp, path.join(evidence,'scope-visible.png'));

  const stubborn = await start(true);
  const paused = await terminal(stubborn.run);
  assert.equal(paused.error_code,'AGENT_REPEATED_ACTIONS');
  assert.equal(events(stubborn.run).filter(e=>e.payload.kind==='WORK_REVIEW_V1').length,1);
  const beforeRestart = calls(stubborn.run).length;
  await stop(); await launch();
  assert.equal(calls(stubborn.run).length,beforeRestart,'Cold restart does not replay tools');
  await cdp.eval(`window.fielora.agent.resume({run_id:${q(stubborn.run)}})`);
  const again = await terminal(stubborn.run);
  assert.equal(again.error_code,'AGENT_REPEATED_ACTIONS');
  assert.equal(events(stubborn.run).filter(e=>e.payload.kind==='WORK_REVIEW_V1').length,1,'Same evidence cannot buy another review after cold resume');
  assert.equal(calls(stubborn.run).filter(t=>t.name==='create_file').length,0,'No forced edit or manufactured completion');
  await writeFile(path.join(evidence,'stubborn.json'),q({run:again,events:events(stubborn.run),calls:calls(stubborn.run)}));
  await writeFile(path.join(evidence,'results.json'),q({status:'PASS',reductions,scope:'Deterministic model; real Electron/Core, Python HTTP failure/repair, one recovery per evidence epoch, cold restart and unchanged original input. Real-model acceptance not run.'}));
  console.log('AGENT_STALLED_SUCCESS=PASS evidence='+evidence);
} catch(error) {
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-3000)); throw error;
} finally { db?.close(); await stop(); await rm(dataRoot,{recursive:true,force:true}); }
