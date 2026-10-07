import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const mode = process.argv[2] ?? 'dev';
const packaged = mode !== 'dev';
const appPath = process.env.FIELORA_PACKAGED_APP ?? path.join(root, 'apps', 'desktop', 'out', 'Fielora-win32-x64', 'Fielora.exe');
const dataRoot = await mkdtemp(path.join(tmpdir(), `fielora-phase04-${mode}-`));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts', 'phase04');
let child;
let port;
const output = [];

class Cdp {
  constructor(url) { this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); }
  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((ok, no) => {
      this.socket.addEventListener('open', ok, { once: true });
      this.socket.addEventListener('error', no, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const value = JSON.parse(String(event.data));
      if (!value.id) return;
      const pending = this.pending.get(value.id);
      if (!pending) return;
      this.pending.delete(value.id);
      value.error ? pending.no(new Error(value.error.message)) : pending.ok(value.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((ok, no) => {
      this.pending.set(id, { ok, no });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function freePort() {
  const server = createServer();
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
  const value = server.address().port;
  await new Promise((ok) => server.close(ok));
  return value;
}

async function launch() {
  port = await freePort();
  const env = { ...process.env, LOCALAPPDATA: dataRoot, FIELORA_E2E: '1', FIELORA_E2E_DEBUG_PORT: String(port), ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/' };
  const launched = packaged
    ? spawn(appPath, [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm --filter @fielora/desktop start'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  launched.stdout.on('data', (chunk) => output.push(String(chunk)));
  launched.stderr.on('data', (chunk) => output.push(String(chunk)));
  return launched;
}

async function connect() {
  const started = Date.now();
  let lastTargets = [];
  while (Date.now() - started < 60000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      lastTargets = list.map((item) => ({ type: item.type, url: item.url, title: item.title }));
      const target = list.find((item) => item.type === 'page' && (item.url.startsWith('fielora://app') || item.url.includes('main_window')));
      if (target) {
        const cdp = new Cdp(target.webSocketDebuggerUrl);
        await cdp.open();
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        return cdp;
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`Electron target timeout\ntargets=${JSON.stringify(lastTargets)}\n${output.join('')}`);
}

async function wait(cdp, expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await cdp.eval(`Boolean(${expression})`)) return; } catch {}
    await new Promise((ok) => setTimeout(ok, 75));
  }
  throw new Error(`wait failed: ${expression}\n${output.join('')}`);
}

async function quit(cdp) {
  await cdp.eval('void window.fielora.core.quit()');
  cdp.close();
  await Promise.race([
    new Promise((ok) => child.once('exit', ok)),
    new Promise((_, no) => setTimeout(() => no(new Error('quit timeout')), 8000)),
  ]);
}

async function contains(rootPath, needle) {
  for (const name of await readdir(rootPath)) {
    const item = path.join(rootPath, name);
    const info = await stat(item);
    if (info.isDirectory()) { if (await contains(item, needle)) return true; }
    else if ((await readFile(item)).includes(Buffer.from(needle))) return true;
  }
  return false;
}

const secret = `phase04-e2e-secret-${crypto.randomUUID()}`;
const modelInput = `phase04-model-input-${crypto.randomUUID()}`;
const hiddenTail = `phase04-inbox-hidden-tail-${crypto.randomUUID()}`;
let ids;

try {
  child = await launch();
  let cdp = await connect();
  await wait(cdp, `document.querySelector('[data-testid="project-workspace"]')`);
  await cdp.eval(`document.querySelector('[data-testid="now-nav"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="now-screen"]')`);
  assert.equal((await cdp.eval('window.fielora.core.getHealth()')).schema_version, 19);

  ids = await cdp.eval(`(async()=>{
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Phase 04 Fixture',base_url:'https://example.com/v1',default_model:'__fielora_fixture__',custom_endpoint_acknowledged:true});
    const active=await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:${JSON.stringify(secret)}});
    const field=await window.fielora.field.create({title:'Phase 04 Desktop',goal:'Provider and capture'});
    async function run(modelId,cancel){
      const events=[];let resolveDone;const done=new Promise((resolve)=>{resolveDone=resolve;});
      const stop=window.fielora.core.subscribe((event)=>{if(event.event==='event.model.invocation'){events.push(event);if(['COMPLETED','CANCELLED','FAILED'].includes(event.kind)){stop();resolveDone();}}});
      const invocation=await window.fielora.model.start({provider_config_id:provider.id,model_id:modelId,intent:'ASK',user_input:${JSON.stringify(modelInput)},context_package:[{kind:'CURRENT_FIELD',source_identity:field.id,source_revision_or_navigation_generation:'1',display_label:'Current Field',content:'renderer-forged-value',sensitivity:'NORMAL',completeness:'COMPLETE'}],response_mode:'TEXT'});
      if(cancel)await window.fielora.model.cancel({invocation_id:invocation.invocation_id});
      await done;return{invocation,events};
    }
    const complete=await run(null,false);const cancelled=await run(null,true);const failed=await run('__fielora_fixture_failure__',false);
    const capture=await window.fielora.capture.create({kind:'MODEL_OUTPUT',title:'Accepted result',content:'Fielora fixture response',source:{kind:'MODEL_RESPONSE',title:null,uri:null,field_id:null,resource_type:null,resource_id:null,resource_revision:null,provider_config_id:provider.id,provider_model_id:'__fielora_fixture__',provider_invocation_id:complete.invocation.invocation_id,is_partial:false}});
    const attached=await window.fielora.capture.attach({capture_id:capture.id,field_id:field.id,expected_revision:capture.revision});
    const promoted=await window.fielora.capture.promote({capture_id:capture.id,field_id:field.id,expected_revision:attached.revision});
    const inboxCapture=await window.fielora.capture.create({kind:'PAGE',title:'Compressed Inbox Capture',content:'Visible preview '+('content '.repeat(40))+${JSON.stringify(hiddenTail)},source:{kind:'REMOTE_PAGE',title:'Compressed Inbox Capture',uri:'https://example.com/long-page',field_id:null,resource_type:null,resource_id:null,resource_revision:null,provider_config_id:null,provider_model_id:null,provider_invocation_id:null,is_partial:false}});
    return{providerId:provider.id,fieldId:field.id,captureId:capture.id,inboxCaptureId:inboxCapture.id,active,completeEvents:complete.events,cancelledEvents:cancelled.events,failedEvents:failed.events,promoted};
  })()`);

  assert.equal(ids.active.credential_present, true);
  assert.deepEqual(ids.completeEvents.map((event) => event.kind), ['STARTED', 'OUTPUT_TEXT_DELTA', 'USAGE', 'COMPLETED']);
  assert.deepEqual(ids.cancelledEvents.map((event) => event.kind), ['STARTED', 'CANCELLED']);
  assert.deepEqual(ids.failedEvents.map((event) => event.kind), ['STARTED', 'FAILED']);
  assert.equal(ids.failedEvents.at(-1).error_code, 'PROVIDER_RATE_LIMITED');
  assert.equal(ids.promoted.promoted_as, 'IDEA_CANDIDATE');

  await mkdir(evidence, { recursive: true });
  await cdp.eval(`document.querySelector('[data-testid="inbox-nav"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="inbox-surface"]')`);
  const inboxText = await cdp.eval(`document.querySelector('[data-testid="inbox-surface"]').innerText`);
  assert.equal(inboxText.includes(hiddenTail), false, 'Inbox must not dump full capture content by default');
  assert.equal(inboxText.includes('IDEA_CANDIDATE'), false);
  assert.equal(inboxText.includes('Attach 到 Field'), false);
  assert.equal(inboxText.includes('Promote'), false);
  const previewLengths = await cdp.eval(`[...document.querySelectorAll('[data-testid="capture-preview"]')].map((item)=>[...item.innerText].length)`);
  assert.equal(previewLengths.every((length) => length <= 181), true);
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, `${mode}-phase04-inbox.png`), Buffer.from(shot.data, 'base64'));
  await cdp.eval(`(()=>{const card=[...document.querySelectorAll('[data-testid="inbox-capture-card"]')].find((item)=>item.querySelector('h3')?.innerText==='Compressed Inbox Capture');card.querySelector('.capture-expand').click();})()`);
  await wait(cdp, `document.querySelector('[data-testid="capture-full-content"]')?.innerText.includes(${JSON.stringify(hiddenTail)})`);
  shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, `${mode}-phase04-inbox-expanded.png`), Buffer.from(shot.data, 'base64'));
  await cdp.eval(`document.querySelector('[data-testid="inbox-surface"] > header [aria-label="关闭"]').click()`);

  await cdp.eval(`window.dispatchEvent(new CustomEvent('fielora:open-provider-setup'))`);
  await wait(cdp, `document.querySelector('[data-testid="provider-setup"]')`);
  const providerText = await cdp.eval(`document.querySelector('[data-testid="provider-setup"]').innerText`);
  assert.equal(providerText.includes(secret), false);
  assert.equal(providerText.includes('__fielora_fixture__'), true);
  assert.equal(providerText.includes('遵循服务方政策'), true);
  shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, `${mode}-phase04-provider-setup.png`), Buffer.from(shot.data, 'base64'));
  await cdp.eval(`document.querySelector('[data-testid="settings-back"]').click()`);

  await quit(cdp);
  assert.equal(await contains(dataRoot, secret), false, 'credential leaked outside Credential Manager');
  assert.equal(await contains(dataRoot, modelInput), false, 'model input leaked to local files');

  child = await launch();
  cdp = await connect();
  await wait(cdp, `document.querySelector('[data-testid="project-workspace"]')`);
  await cdp.eval(`document.querySelector('[data-testid="now-nav"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="now-screen"]')`);
  const resumed = await cdp.eval(`window.fielora.capture.get({capture_id:${JSON.stringify(ids.captureId)}})`);
  assert.equal(resumed.placement_status, 'PROMOTED');
  assert.equal(resumed.promoted_as, 'IDEA_CANDIDATE');
  await cdp.eval(`window.fielora.provider.remove({provider_config_id:${JSON.stringify(ids.providerId)}})`);
  await cdp.eval(`window.dispatchEvent(new CustomEvent('fielora:open-provider-setup'))`);
  await wait(cdp, `document.querySelector('[data-testid="provider-setup"]')`);
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="provider-setup"]').innerText.includes('添加模型服务')`), true);
  await quit(cdp);

  await writeFile(path.join(evidence, `${mode.toUpperCase()}_PHASE_04_ACCEPTANCE.json`), `${JSON.stringify({
    status: 'PASS',
    schema_version: 19,
    checks: [
      'provider_config', 'wincred_write_read_delete', 'fixture_started_delta_usage_completed',
      'fixture_started_cancelled', 'fixture_started_failed_stable_error', 'context_core_reread',
      'provider_setup_independent_surface', 'provider_model_retention_cost_disclosure',
      'independent_inbox', 'inbox_bounded_preview',
      'user_language_hides_domain_terms', 'capture_attach_promote', 'restart_resume',
      'secret_not_in_files', 'model_input_not_in_files',
    ],
    provider_external_requests: 0,
    dxe_surface_runtime: 'NOT_IMPLEMENTED',
    captured_at: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`Phase 04 Desktop E2E (${mode}): PASS`);
} finally {
  if (child && child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  if (ids?.providerId) spawnSync('cmdkey.exe', [`/delete:Fielora/provider/${ids.providerId}`], { windowsHide: true, stdio: 'ignore' });
  await new Promise((ok) => setTimeout(ok, 150));
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
}
