import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

assert.equal(process.platform, 'darwin', 'This desktop regression currently targets macOS.');
const root = path.resolve(import.meta.dirname, '../..');
const outcomeCase = process.env.FIELORA_TEST_SERVICE_OUTCOME === '1';
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-python-server-'));
const evidence = await mkdtemp(path.join(tmpdir(), 'fielora-python-server-evidence-'));
const projectRoot = path.join(dataRoot, 'Python project');
await mkdir(projectRoot);
execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
execFileSync('/usr/bin/python3', ['-m', 'venv', path.join(projectRoot, '.venv')]);
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${reservation.address().port}/`;
await new Promise(resolve => reservation.close(resolve));
await writeFile(path.join(projectRoot, 'server.py'), `import sqlite3,sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit
with sqlite3.connect('probe.db') as db:
 db.execute('create table if not exists items (id integer primary key)')
 db.executemany('insert or ignore into items values (?)', [(1,),(2,),(3,)])
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  with sqlite3.connect('probe.db') as db:
   count = db.execute('select count(*) from items').fetchone()[0]
  body = ('<!doctype html><html><meta charset="utf-8"><title>Python service regression</title><style>body{font:20px system-ui;padding:36px;color:#20222a}main{padding:24px;background:#f4f1fb;border-radius:16px}</style><main><h1>Managed Python service</h1><p>SQLite rows: %d</p></main></html>' % count).encode()
  self.send_response(200)
  self.send_header('Content-Type','text/html; charset=utf-8')
  self.send_header('Content-Length',str(len(body)))
  self.end_headers()
  self.wfile.write(body)
HTTPServer(('127.0.0.1',urlsplit(sys.argv[1]).port),Handler).serve_forever()
`);
await writeFile(path.join(projectRoot, 'check_http.py'), `import sys,time,urllib.request
for attempt in range(30):
 try:
  with urllib.request.urlopen(sys.argv[1], timeout=1) as response:
   assert response.status == 200
   assert b'SQLite rows: 3' in response.read()
  break
 except OSError:
  if attempt == 29: raise
  time.sleep(.1)
print('HTTP and SQLite result checked at',sys.argv[1])
`);
const output = [], q = JSON.stringify;
let child, cdp, db;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 90000 });
const click = async selector => { await wait(`document.querySelector(${q(selector)})`); await cdp.eval(`document.querySelector(${q(selector)}).click()`); };
const launch = async () => {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.eval('window.fieloraTest.resizeWindow({width:1478,height:850})');
  await cdp.send('Page.bringToFront');
};
const stop = async () => {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
};
try {
  await launch();
  await cdp.eval(`(async()=>{
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Python 服务验证',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_command_permissions__',custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-python-server-only'});
  })()`);
  const field = await cdp.eval(`window.fieloraTest.createProject({title:'Python managed service',goal:null,root_path:${q(projectRoot)}}).then(p=>p.field_id)`);
  await cdp.eval('window.__pythonReload=true'); await cdp.send('Page.reload');
  await wait("window.__pythonReload!==true && document.querySelector('[data-testid=settings-nav]')");
  await click(`[data-testid="project-${field}"]`);
  await wait('document.querySelector("textarea[name=prompt]")');
  await cdp.eval(`(()=>{const e=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${q(`运行 ${outcomeCase?'PYTHON_SERVER_OUTCOME':'PYTHON_SERVER'} 托管、HTTP 和页面验证 ${url}`)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('[data-testid=composer-permission]');
  await click('[data-testid=composer-permission-option-FULL_CONTROL]');
  await click('[data-testid=send-message]');
  const terminalVisible = outcomeCase ? "document.body.innerText.includes('Python 服务与完成证据回归通过')"
    : "document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('Python 服务回归已完成')";
  await wait(terminalVisible);
  db = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'), { readOnly: true });
  const run = db.prepare('SELECT id,conversation_id,status,error_code,current_step FROM agent_runs WHERE field_id=?').get(field);
  const calls = db.prepare('SELECT name,status,policy_decision,receipt_json FROM agent_tool_calls WHERE run_id=? ORDER BY created_at').all(run.id)
    .map(({receipt_json,...rest}) => ({ ...rest, receipt: receipt_json ? JSON.parse(receipt_json) : null }));
  assert.equal(run.status, outcomeCase ? 'COMPLETED' : 'PAUSED');
  assert.equal(db.prepare('SELECT count(*) n FROM agent_approvals WHERE run_id=?').get(run.id).n, 0);
  for (const name of ['browser_server', 'run_command', 'browser', 'browser_verify']) {
    const call = calls.find(c => c.name === name);
    assert.equal(call?.status, 'COMPLETED', name);
    assert.equal(call.receipt?.success, true, JSON.stringify(call));
  }
  assert.equal(calls.find(c => c.name === 'browser_server').receipt.verification_eligible, false);
  assert.equal(calls.find(c => c.name === 'browser_verify').receipt.verification_eligible, true);
  if (outcomeCase) {
    const service = calls.filter(c => c.name === 'browser_server').at(-1);
    assert.equal(service.receipt.status, 'RUNNING'); assert.equal(service.receipt.exit_code, null);
    assert.equal(service.receipt.verification_eligible, false);
    assert.equal(calls.filter(c => c.name === 'finish_task').length, 1);
    assert.equal(calls.find(c => c.name === 'finish_task').status, 'COMPLETED');
  }
  const shot = calls.find(c => c.name === 'browser_verify').receipt.screenshot;
  const preview = await cdp.eval(`window.fielora.screenshot.preview({screenshot_evidence_id:${q(shot.id)},expected_content_sha256:${q(shot.content_sha256)}})`);
  const pixels = await cdp.eval(`(async()=>{const image=new Image();image.src=${q(preview.data_url)};await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);return Array.from(x.getImageData(Math.round(55*image.width/635),Math.round(55*image.width/635),1,1).data);})()`);
  assert.deepEqual(pixels, [244,241,251,255], 'Screenshot conversion must preserve the rendered sRGB surface color');
  await writeFile(path.join(evidence, 'native-page-evidence.png'), Buffer.from(preview.data_url.split(',')[1], 'base64'));
  assert.match(await (await fetch(url)).text(), /SQLite rows: 3/);
  await captureScreenshot(cdp, path.join(evidence, 'python-managed-page.png'));
  await stop();
  await assert.rejects(fetch(url), 'Owned service must stop on normal desktop exit');
  await launch();
  await click(`[data-testid="conversation-${run.conversation_id}"]`);
  await wait(terminalVisible);
  await assert.rejects(fetch(url), 'Restart must not silently replay the historical start command');
  assert.equal(db.prepare('SELECT count(*) n FROM agent_tool_calls WHERE run_id=?').get(run.id).n, calls.length);
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({status:'PASS',host:process.env.FIELORA_PACKAGED_EXE?'packaged':'dev',scope:'Real Python/SQLite/HTTP/Electron/Core; deterministic model, isolated data; not original business acceptance',run,calls,checks:{cross_tool_lifetime:true,rendered_checks:true,normal_exit_stops:true,restart_no_replay:true,live_service_outcome:outcomeCase}}, null, 2));
  console.log(`PYTHON_MANAGED_SERVER=PASS evidence=${evidence}`);
} catch (error) {
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(()=>{});
  if (!db) { try { db = new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'),{readOnly:true}); } catch {} }
  if (db) await writeFile(path.join(evidence, 'failure-ledger.json'), JSON.stringify({runs:db.prepare('SELECT id,status,error_code,current_step FROM agent_runs').all(),tools:db.prepare('SELECT name,status,arguments_json,receipt_json,error_code FROM agent_tool_calls').all()},null,2));
  console.error(`Failure evidence: ${evidence}`); console.error(output.join('').slice(-3500)); throw error;
} finally {
  await stop(); db?.close(); await rm(dataRoot, { recursive: true, force: true });
}
