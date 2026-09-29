import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-model-budget-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/long-task-budget-20260925/desktop'));
const output = []; let child, cdp, ids;
const large = { max_execution_ms: 14_400_000, max_input_tokens: 0, max_output_tokens: 0 };
const continued = { max_execution_ms: 5_820_000, max_input_tokens: 0, max_output_tokens: 0 };
const wait = expression => waitForExpression(cdp, expression, { timeoutMs: 60000, output });
async function click(selector) { await wait(`document.querySelector(${JSON.stringify(selector)})`); await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function launch() {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { Path: `${path.dirname(process.execPath)};${process.env.Path ?? ''}` } });
  child = launched.child; cdp = await connectToFieloraApp({ port: launched.port, output, timeoutMs: 120000, enablePage: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1478, height: 850, deviceScaleFactor: 1, mobile: false });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function reload() { await cdp.eval('window.__budgetReload=true'); await cdp.send('Page.reload'); await wait('typeof window.__budgetReload==="undefined" && window.fieloraTest && document.querySelector(".conversation-composer")'); }
async function settings(tab='budget') {
  if (!await cdp.eval('Boolean(document.querySelector("[data-testid=settings-screen]"))')) await click('[data-testid=settings-nav]');
  await click('[data-testid=settings-category-models]');
  await click(`[data-testid=settings-model-tab-${tab}]`);
}
async function chooseBudget(value) {
  await click('[data-testid=agent-budget-max_execution_ms]');
  const option = `[data-testid=agent-budget-max_execution_ms-option-${value.max_execution_ms}]`;
  if (await cdp.eval(`Boolean(document.querySelector(${JSON.stringify(option)}))`)) await click(option);
  else {
    await click('[data-testid=agent-budget-max_execution_ms-option-custom]');
    const setMinutes = async number => cdp.eval(`(()=>{const e=document.querySelector('[data-testid=agent-budget-custom-minutes]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(number)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await setMinutes('1441');
    await wait("document.querySelector('[data-testid=agent-budget-custom-apply]').disabled");
    await setMinutes(String(value.max_execution_ms / 60000));
    await click('[data-testid=agent-budget-custom-apply]');
  }
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=agent-budget-max_input_tokens],[data-testid=agent-budget-max_output_tokens]").length'), 0);
}

const saved = () => cdp.eval("JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).agentResourceBudget");
const facts = id => cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${JSON.stringify(id)}}),events:await window.fielora.agent.events({run_id:${JSON.stringify(id)},after_sequence:null,limit:500})}))()`);
try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(projectRoot, 'verify-unrelated.cjs'), "console.log('unrelated green check');\n");
  assert.equal(spawnSync('git.exe', ['init'], { cwd: projectRoot, windowsHide: true }).status, 0);
  await launch();
  await cdp.eval("(()=>{const p=JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')||'{}');p.appearance={...p.appearance,themePreference:'LIGHT'};localStorage.setItem('fielora.ui.preferences.v2',JSON.stringify(p));window.__budgetReload=true})()");
  await cdp.send('Page.reload');
  await wait('typeof window.__budgetReload==="undefined" && window.fieloraTest && document.documentElement.dataset.appearanceMode==="light"');
  await settings();
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=settings-category-models]").length'), 1);
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=settings-category-usage]").length'), 0);
  assert.equal(await cdp.eval('document.querySelectorAll("[role=tablist] [role=tab]").length'), 3);
  await cdp.eval("document.querySelector('[data-testid=settings-model-tab-budget]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");
  await wait("document.querySelector('[data-testid=settings-model-tab-services]').getAttribute('aria-selected')==='true'");
  assert.equal(await cdp.eval('document.activeElement.id'), 'settings-model-tab-services');
  await click('[data-testid=settings-model-tab-budget]'); await chooseBudget(large);
  assert.deepEqual(await saved(), large);
  await captureScreenshot(cdp, path.join(evidence, 'budget-light.png'));
  await click('[data-testid=settings-model-tab-usage]'); await wait('document.querySelector("[data-testid=usage-total]")');
  await captureScreenshot(cdp, path.join(evidence, 'usage-tab.png'));
  ids = await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Budget fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_outcomes__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'任务预算回归',goal:null,root_path:${JSON.stringify(projectRoot)}});const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'任务预算与继续',provider_config_id:provider.id,model_id:provider.default_model});return {provider,project,conversation}})()`);
  await reload();
  // Empty conversations are selected automatically but intentionally omitted from the sidebar.
  await wait("document.body.innerText.includes('任务预算与继续')");
  await click('[data-testid=composer-permission]'); await click('[data-testid=composer-permission-option-FULL_CONTROL]');
  await cdp.eval(`(()=>{const e=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'安装 Skill 的缺失资源修复回归');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('[data-testid=send-message]');
  await wait(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r.length===1&&r[0].status==='PAUSED')`);
  const run = await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
  const before = await facts(run.id);
  assert.deepEqual(before.events.find(e=>e.kind==='RUN_CREATED').payload.resource_budget, large);
  await settings(); await chooseBudget(continued);
  assert.deepEqual((await facts(run.id)).events.find(e=>e.kind==='RUN_CREATED').payload.resource_budget, large, 'Preferences do not rewrite the running grant');
  // Terminate only this isolated test process, then relaunch against the same
  // disposable data. This verifies persisted settings, not graceful shutdown.
  cdp.close(); cdp=null;
  await cleanupElectronProcess(child); child=null; await launch();
  assert.deepEqual(await saved(), continued);
  await click(`[data-testid="conversation-${ids.conversation.id}"]`);
  await click('.agent-resume-action.is-primary');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(r=>r.status==='COMPLETED')`);
  const after = await facts(run.id);
  const resumed = after.events.find(e=>e.kind==='RUN_RESUMED'&&e.payload.resource_budget_reset?.source==='EXPLICIT_USER_RESUME');
  assert.deepEqual(resumed.payload.resource_budget, continued);
  await settings('services'); await captureScreenshot(cdp, path.join(evidence, 'services-tab.png'));
  await click('[data-testid=settings-back]');
  await cdp.eval("window.dispatchEvent(new CustomEvent('fielora:open-settings',{detail:'USAGE'}))");
  await wait("document.querySelector('[data-testid=settings-model-tab-usage]').getAttribute('aria-selected')==='true'");
  await click('[data-testid=settings-model-tab-budget]'); await click('[data-testid=agent-budget-reset]');
  assert.deepEqual(await saved(), {max_execution_ms:3600000,max_input_tokens:0,max_output_tokens:0});
  await chooseBudget(continued);
  await cdp.eval("(()=>{const p=JSON.parse(localStorage.getItem('fielora.ui.preferences.v2'));p.appearance={...p.appearance,themePreference:'DARK'};localStorage.setItem('fielora.ui.preferences.v2',JSON.stringify(p))})()");
  await reload(); await settings();
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:650,deviceScaleFactor:1,mobile:false});
  await wait('document.documentElement.dataset.appearanceMode==="dark"');
  await captureScreenshot(cdp,path.join(evidence,'budget-dark-compact.png'));
  const bounds=await cdp.eval('(()=>{const e=document.querySelector(".settings-content");return {width:e.clientWidth,scroll:e.scrollWidth}})()');
  assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));
  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:'PASS',externalModelRequests:0,bounds,startBudget:large,continueBudget:continued,before,after,checks:['single menu with three tabs','keyboard navigation','legacy usage link','immediate persistence','UI start grant','existing grant unchanged','isolated process termination and restart','UI continue grant','restore defaults','light and dark narrow layouts']},null,2));
  console.log('MODEL_SETTINGS_BUDGET_E2E=PASS');
} catch(error) {
  await writeFile(path.join(evidence,'failure.log'),`${error.stack}\n${output.join('')}`);
  if(cdp) {
    await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
    if(ids) await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}})`).then(async runs=>{for(const run of runs) await writeFile(path.join(evidence,`failure-run-${run.id}.json`),JSON.stringify(await facts(run.id),null,2));}).catch(()=>{});
  }
  throw error;
}
finally { cdp?.close(); await cleanupElectronProcess(child); if(ids) spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true}); if(dataRoot.startsWith(path.join(tmpdir(),'fielora-model-budget-'))) await rm(dataRoot,{recursive:true,force:true,maxRetries:3}); }
