import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

// Deterministic DNS/HTTP error in the existing model substitute; real Core writes,
// verification and restart. This substitute returns after the model retry
// boundary; retry classification is covered by the Core unit test.
// No production credential or DNS call.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-dns-recovery-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-dns-evidence-'));
const output = [], q = JSON.stringify;
const httpCase = process.env.FIELORA_HTTP_RECOVERY_CASE;
if (httpCase && !['rate', 'timeout'].includes(httpCase)) throw new Error('Unknown HTTP recovery case');
const marker = httpCase === 'rate' ? 'HTTP_RATE' : httpCase === 'timeout' ? 'HTTP_TIMEOUT' : 'DNS';
const expectedCode = httpCase === 'rate' ? 'PROVIDER_RATE_LIMITED' : httpCase === 'timeout' ? 'PROVIDER_REQUEST_TIMEOUT' : 'PROVIDER_DNS_FAILED';
const expectedReason = httpCase === 'rate' ? '返回限流响应' : httpCase === 'timeout' ? '请求超时' : '无法解析';
let child, cdp;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 45000 });
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
  await writeFile(path.join(projectRoot, 'login.js'), 'exports.ready = false;\n');
  await writeFile(path.join(projectRoot, 'verify.cjs'), 'require("node:assert/strict").equal(require("./login.js").ready,true);\n');
  await writeFile(path.join(projectRoot, 'evidence.txt'), Array.from({length:20},(_,i)=>`Evidence ${i+1}`).join('\n'));
  await launch();
  const task = `FIELORA_AGENT_FIXTURE_MODEL_RECOVERY ${marker} 修复 ready 并运行断言验证。`;
  const ids = await cdp.eval(`(async()=>{
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'DNS recovery fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_pause__',custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'域名故障恢复',goal:null,root_path:${q(projectRoot)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'域名故障后继续同一任务',provider_config_id:p.id,model_id:p.default_model});
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:${q(task)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:p.default_model,task:${q(task)},permission:'FULL_CONTROL',max_steps:50,attachments:[]});
    return {run:r.id,conversation:c.id};
  })()`);
  await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  const paused = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  assert.equal(paused.status, 'PAUSED'); assert.equal(paused.error_code, expectedCode);
  const events = await cdp.eval(`window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})`);
  const failures = events.filter(e=>e.kind==='MODEL_FAILED' && e.payload.error_code===expectedCode);
  assert.equal(failures.length, 1);
  if (httpCase) {
    assert.equal(failures[0].payload.http_status, httpCase === 'rate' ? 429 : 408);
    assert.equal(failures[0].payload.response_diagnostics.retry_after_seconds, 90);
  }
  assert.equal(events.filter(e=>e.kind==='RUN_FAILED').length, 0);
  await cdp.eval('window.__dnsReload=true'); await cdp.send('Page.reload');
  await wait(`!window.__dnsReload && document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  await wait(`document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes(${q(expectedReason)})`);
  if (httpCase) await wait(`document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('90 秒')`);
  await cdp.eval(`document.querySelector('[data-testid=agent-pause-notice]').scrollIntoView({block:'center'})`);
  await wait(`(()=>{const r=document.querySelector('[data-testid=agent-pause-notice]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`);
  await captureScreenshot(cdp, path.join(evidence, 'dns-paused.png'));
  await stop(); await launch();
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  await wait(`document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes(${q(expectedReason)})`);
  let calls = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  assert.equal(calls.filter(t=>t.name==='replace_text').length, 1);
  await cdp.eval(`window.fielora.agent.resume({run_id:${q(ids.run)}})`);
  await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['COMPLETED','FAILED','PAUSED'].includes(r.status))`);
  const completed = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  assert.equal(completed.status, 'COMPLETED', q(completed));
  calls = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  assert.equal(calls.filter(t=>t.name==='replace_text').length, 1, 'Never replay the saved edit');
  assert.equal(calls.filter(t=>t.name==='run_command' && t.receipt?.exit_code===0).length, 1);
  assert.match(await readFile(path.join(projectRoot,'login.js'),'utf8'), /ready = true/);
  await writeFile(path.join(evidence,'results.json'),q({status:'PASS',case:marker,error:expectedCode,scope:'Deterministic model error after retry boundary; real Electron/Core/command/restart. Wire adapter and automatic retry delay covered separately by unit tests.',run:ids.run,editCount:1,verifiedCommandCount:1}));
  console.log(`AGENT_${marker}_RECOVERY=PASS evidence=`+evidence);
} catch (error) {
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-1500)); throw error;
} finally { await stop(); await rm(dataRoot,{recursive:true,force:true}); }
