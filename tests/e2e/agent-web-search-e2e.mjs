import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

// Actual desktop/Core/credential mediation/restart with deterministic search and
// model. The model fixture rejects missing page content or lost search sources.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-web-search-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-web-search-evidence-'));
const output = [], q = JSON.stringify;
let child, cdp;
const customRequests = [];
const customServer = createServer((request,response) => {
  customRequests.push({url:request.url,authorization:request.headers.authorization});
  response.writeHead(200,{'Content-Type':'application/json'});
  response.end(JSON.stringify({results:[{title:'Self-hosted Rust fixture',url:'https://www.rust-lang.org/learn',content:'SELF_HOSTED_JSON_SOURCE'}]}));
});
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 90000 });
const click = selector => cdp.eval(`document.querySelector(${q(selector)}).click()`);
async function launch() {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    extraEnv: { FIELORA_WEB_SEARCH_FIXTURE: '1', FIELORA_DATA_DIR: path.join(dataRoot, 'Fielora'), FIELORA_E2E_USER_DATA: path.join(dataRoot, 'electron-profile') },
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
async function saveKey(key) {
  await cdp.eval(`document.querySelector('[data-testid="web-search-key"]').value=${q(key)}`);
  await click('[data-testid="web-search-save"]');
  await wait(`document.querySelector('[data-testid="web-search-key"]').value==='' && !document.querySelector('[data-testid="web-search-save"]').disabled`);
  assert.ok(!(await cdp.eval('document.body.innerHTML')).includes(key));
}
async function testSearch(expected) {
  await click('[data-testid="web-search-test"]');
  await wait(`document.querySelector('[data-testid="web-search-probe"]')?.innerText.includes(${q(expected)})`);
}
async function searchSettings() {
  await wait('document.querySelector("[data-testid=settings-nav]")');
  await click('[data-testid="settings-nav"]');
  await wait('document.querySelector("[data-testid=settings-category-extensions]")');
  await click('[data-testid="settings-category-extensions"]');
  await wait('document.querySelector("[data-testid=settings-extension-tab-web_search]")');
  await click('[data-testid="settings-extension-tab-web_search"]');
  await wait('document.querySelector("[data-testid=web-search-provider]") && document.querySelector("[data-testid=web-search-test]") && !document.querySelector("[data-testid=web-search-test]").disabled');
}
async function chooseProvider(provider) {
  await click('[data-testid="web-search-provider"]');
  await wait('document.querySelectorAll("[data-testid=web-search-provider-menu] [role=option]").length === 3');
  await click(`[data-testid="web-search-provider-option-${provider}"]`);
  await wait(`document.querySelector('[data-testid="web-search-provider"]').parentElement.dataset.value===${q(provider)}`);
}
async function configureProvider(provider) {
  await click('[data-testid="web-search-configure"]');
  await wait(`window.fielora.webSearch.config().then(c=>c.provider_id===${q(provider)})`);
  await wait('!document.querySelector("[data-testid=web-search-test]").disabled');
}
try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  await new Promise(resolve=>customServer.listen(0,'127.0.0.1',resolve));
  await launch();
  const defaults = await cdp.eval('window.fielora.webSearch.config()');
  assert.equal(defaults.provider_id,'exa.search.v1'); assert.equal(defaults.available,true); assert.equal(defaults.credential_present,false);
  assert.deepEqual(defaults.providers.map(p=>p.provider_id),['exa.search.v1','brave.search.v1','searxng.search.v1']);
  await searchSettings();
  await wait('document.querySelector("[data-testid=web-search-test]") && !document.querySelector("[data-testid=web-search-test]").disabled');
  await testSearch('搜索请求成功');
  await saveKey('synthetic-exa-invalid');
  await testSearch('无效');
  await click('[data-testid="web-search-delete"]');
  await wait('window.fielora.webSearch.config().then(c=>!c.credential_present)');
  await testSearch('搜索请求成功');
  await saveKey('synthetic-exa-valid');
  await testSearch('搜索请求成功');
  await chooseProvider('brave.search.v1'); await configureProvider('brave.search.v1');
  await testSearch('尚未配置 API Key');
  await saveKey('synthetic-brave-valid'); await testSearch('搜索请求成功');
  assert.ok((await cdp.eval('window.fielora.webSearch.config()')).providers.filter(p=>p.credential_present).length===2);
  await captureScreenshot(cdp,path.join(evidence,'brave-settings.png'));
  await stop(); await launch();
  assert.equal((await cdp.eval('window.fielora.webSearch.config()')).provider_id,'brave.search.v1');
  await searchSettings(); await testSearch('搜索请求成功');
  await chooseProvider('searxng.search.v1');
  const customEndpoint = `http://127.0.0.1:${customServer.address().port}/search`;
  await cdp.eval(`(()=>{const el=document.querySelector('[data-testid="web-search-endpoint"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${q(customEndpoint)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await configureProvider('searxng.search.v1'); await testSearch('搜索请求成功');
  assert.equal(new URL(customRequests.at(-1).url,'http://fixture').searchParams.get('format'),'json');
  assert.equal(customRequests.at(-1).authorization,undefined);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=web-search-key]")'),null);
  await captureScreenshot(cdp,path.join(evidence,'custom-settings.png'));
  await stop(); await launch();
  assert.equal((await cdp.eval('window.fielora.webSearch.config()')).provider_id,'searxng.search.v1');
  await searchSettings(); await testSearch('搜索请求成功');
  await chooseProvider('exa.search.v1'); await configureProvider('exa.search.v1');
  await testSearch('搜索请求成功');
  await captureScreenshot(cdp, path.join(evidence,'settings.png'));
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_web_search__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Web research fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'联网研究回归',goal:null,root_path:${q(projectRoot)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'搜索、阅读和恢复',provider_config_id:p.id,model_id:model});
    const task='Research workshop tools and export formats, citing sources.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:3,attachments:[]});
    return {run:r.id,conversation:c.id};
  })()`);
  const settled = () => wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  await settled();
  const paused = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  const initialCalls = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  await writeFile(path.join(evidence,'paused.json'),q({paused,initialCalls}));
  assert.equal(paused.status,'PAUSED',q(paused));
  assert.deepEqual(initialCalls.map(t=>t.name),['web.search','web.fetch','web.search']);
  assert.ok(initialCalls.every(t=>t.status==='COMPLETED'),q(initialCalls));
  await click('[data-testid="settings-back"]');
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await click(`[data-testid="conversation-${ids.conversation}"]`);
  await wait('document.querySelectorAll("[data-testid=web-research-activity]").length === 3');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=operation-group-toggle][aria-expanded=true]").length'),0);
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=research-excerpt]").length'),0);
  await click('[data-testid="web-research-activity"] [data-testid="research-excerpt-toggle"]');
  assert.ok(await cdp.eval('document.querySelector("[data-testid=research-excerpt]").innerText.includes("SOURCE_DISCOVERY")'));
  assert.ok(await cdp.eval('document.querySelector("[data-testid=web-research-activity]").innerText.includes("已返回正文")'));
  assert.equal(await cdp.eval('document.querySelectorAll(".research-domain-badge").length'),3);
  await captureScreenshot(cdp,path.join(evidence,'visible-paused-sources.png'));
  await stop(); await launch();
  assert.equal((await cdp.eval('window.fielora.webSearch.config()')).credential_present,true);
  await cdp.eval(`window.fielora.agent.resume({run_id:${q(ids.run)}})`);
  await settled();
  const run = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  const calls = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  const events = await cdp.eval(`window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})`);
  await writeFile(path.join(evidence,'run.json'),q({run,calls,events}));
  assert.equal(run.status,'COMPLETED',q(run));
  assert.deepEqual(calls.map(t=>t.name),['web.search','web.fetch','web.search','web.fetch','finish_task']);
  for (const call of calls.filter(t=>t.name==='web.search')) {
    assert.equal(call.receipt.result_count,1);
    assert.equal(call.receipt.sources[0].published_at,'2026-10-11');
    assert.ok(call.receipt.retrieved_at);
    assert.ok(call.receipt.sources[0].snippet.length > 0 && Buffer.byteLength(call.receipt.sources[0].snippet) <= 480);
  }
  assert.ok(!q({run,calls,events}).includes('synthetic-exa-valid'));
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await click(`[data-testid="conversation-${ids.conversation}"]`);
  await wait('document.body.innerText.includes("根据实际读取的测试来源")');
  await wait('document.querySelector("[data-testid=web-research-summary] a")');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]").getAttribute("aria-expanded")'),'false');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=web-research-summary] a").length'),2);
  await captureScreenshot(cdp,path.join(evidence,'collapsed-sources.png'));
  await click('[data-testid="agent-history-toggle"]');
  await wait('document.querySelector("[data-testid=web-research-activity] a")');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=web-research-activity] a").href'),'https://example.com/workshop-tools');
  await cdp.eval('for (const button of document.querySelectorAll("[data-testid=research-excerpt-toggle][aria-expanded=false]")) button.click()');
  assert.ok(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").innerText.includes("SOURCE_EXPORT_BODY")'));
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=operation-group-toggle][aria-expanded=true]").length'),0);
  await captureScreenshot(cdp,path.join(evidence,'sources.png'));
  await click('[data-testid="web-research-activity"] a');
  await wait('window.fielora.browser.getState().then(s=>s.url === "https://example.com/workshop-tools")');
  await writeFile(path.join(evidence,'results.json'),q({status:'PASS',scope:'Deterministic Exa/Brave/model; actual Electron settings switches, independent keys, cold persistence, real loopback SearXNG JSON protocol, source rendering/click and search-read-refine continuity. No live Brave/SearXNG upstream or original-task claim.',customRequests}));
  console.log('AGENT_WEB_SEARCH=PASS evidence='+evidence);
} catch (error) {
  if (cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-1800)); throw error;
} finally { await stop(); customServer.closeAllConnections(); await new Promise(resolve=>customServer.close(resolve)); await rm(dataRoot,{recursive:true,force:true}); }
