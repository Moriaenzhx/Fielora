import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-model-usage-'));
const projectRoot=path.join(dataRoot,'project');
const evidence=path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR??path.join(root,'artifacts/model-usage-statistics'));
const output=[];
let child,cdp,ids;
const wait=expression=>waitForExpression(cdp,expression,{timeoutMs:45000,output});
async function click(selector){await wait(`document.querySelector(${JSON.stringify(selector)})`);await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function input(selector,value){await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function reload(){await cdp.eval('window.__usageReload=true');await cdp.send('Page.reload');await wait('typeof window.__usageReload==="undefined" && window.fieloraTest && !document.querySelector("[data-testid=startup-screen]") && document.querySelector(".conversation-composer")');}
async function settings(){await cdp.eval("window.dispatchEvent(new CustomEvent('fielora:open-settings'))");await click('[data-testid=settings-category-models]');await click('[data-testid=settings-model-tab-usage]');await wait('document.querySelector("[data-testid=usage-total]")');}
const query=()=>cdp.eval('window.fielora.agent.usage({since:null,offset:0,limit:100})');
async function send(){await input('.conversation-composer textarea','请分析 sample.txt 并解释其中的内容。');await click('[data-testid=send-message]');}
try {
  await mkdir(projectRoot);await mkdir(evidence,{recursive:true});await writeFile(path.join(projectRoot,'sample.txt'),'A deterministic usage fixture, without external model calls.');
  const launched=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],extraEnv:{Path:`${path.dirname(process.execPath)};${process.env.Path??''}`}});
  child=launched.child;cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1380,height:850,deviceScaleFactor:1,mobile:false});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await settings();assert.equal((await query()).total_tasks,0);assert.equal(await cdp.eval('document.querySelector("[data-testid=usage-total]").textContent'),'0');
  await captureScreenshot(cdp,path.join(evidence,'usage-empty.png'));
  ids=await cdp.eval(`(async()=>{
    const make=async(name,model)=>{const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:name,base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});return p};
    const a=await make('Usage fixture A','__fielora_agent_fixture_usage_a__'),b=await make('Usage fixture B','__fielora_agent_fixture_usage_b__');
    const project=await window.fieloraTest.createProject({title:'模型用量回归',goal:null,root_path:${JSON.stringify(projectRoot)}});
    const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'切换模型归账',provider_config_id:a.id,model_id:a.default_model});return {a,b,project,conversation};
  })()`);
  await reload();
  await wait("document.body.innerText.includes('切换模型归账')");
  await send();
  await settings();
  await wait('document.querySelector("[data-testid=usage-live]").textContent.includes("__fielora_agent_fixture_usage_a__")');
  await wait('window.fielora.agent.usage({since:null,offset:0,limit:100}).then(r=>r.usage.input_tokens===1000&&r.active.length===1)');
  await wait('document.querySelector("[data-testid=usage-total]").textContent.replaceAll(",","")==="1100"');
  await captureScreenshot(cdp,path.join(evidence,'usage-live.png'));
  await wait('window.fielora.agent.usage({since:null,offset:0,limit:100}).then(r=>r.usage.input_tokens===2000&&r.active.length===0)');
  let report=await query();assert.equal(report.tasks.length,1);assert.equal(report.tasks[0].provider_config_id,ids.a.id);assert.equal(report.tasks[0].usage.output_tokens,200);
  await click('[data-testid=usage-rate-model]');
  await click(`[data-testid=${JSON.stringify(`usage-rate-model-option-${JSON.stringify([ids.a.id,ids.a.default_model])}`)}]`);
  await input('[data-testid=usage-input-price]','2');await input('[data-testid=usage-output-price]','10');await click('[data-testid=usage-save-rate]');
  await wait('document.querySelector("[data-testid=usage-cost]").textContent.includes("0.0060")');
  await click('[data-testid=settings-back]');await click(`[data-testid="conversation-${ids.conversation.id}"]`);
  await click('[data-testid=conversation-model]');await click(`[data-testid="conversation-model-option-${ids.b.id}"]`);
  await wait(`window.fielora.conversation.get({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(c=>c.provider_config_id===${JSON.stringify(ids.b.id)})`);
  await send();await settings();
  await wait('document.querySelector("[data-testid=usage-selection]").textContent.includes("__fielora_agent_fixture_usage_b__")');
  await wait('window.fielora.agent.usage({since:null,offset:0,limit:100}).then(r=>r.total_tasks===2&&r.active.length===0)');
  report=await query();assert.equal(report.usage.input_tokens,6000);assert.equal(report.usage.output_tokens,600);assert.equal(report.models.length,2);assert.equal(report.models.find(m=>m.provider_config_id===ids.a.id).usage.input_tokens,2000);assert.equal(report.models.find(m=>m.provider_config_id===ids.b.id).usage.input_tokens,4000);
  await wait('document.querySelector("[data-testid=usage-total]").textContent.replaceAll(",","")==="6600"');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=usage-tasks] tbody tr").length'),2);
  await cdp.eval('document.querySelector(".settings-content").scrollTop=0');
  await captureScreenshot(cdp,path.join(evidence,'usage-light.png'));
  await cdp.eval('document.querySelector(".usage-rates").scrollIntoView({block:"end"})');
  await captureScreenshot(cdp,path.join(evidence,'usage-task-rates.png'));
  // Renderer reload must preserve pricing and read the exact same totals.
  await reload();await settings();
  assert.deepEqual((await query()).usage,report.usage);
  assert.ok(await cdp.eval('localStorage.getItem("fielora:model-usage-rates:v1").includes("CNY")'));
  // Core restart proves the usage source is durable SQLite, not renderer counters.
  const pid=await cdp.eval('window.fielora.core.getHealth().then(h=>h.pid)');await cdp.eval('window.fieloraTest.killCore()');await wait(`window.fielora.core.getHealth().then(h=>h.state==='READY'&&h.pid!==${pid})`);
  assert.deepEqual((await query()).usage,report.usage);
  await cdp.eval(`(()=>{const p=JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')||'{"version":2,"startupDestination":"PROJECTS","languagePreference":"ZH_CN"}');p.appearance={...p.appearance,themePreference:'DARK'};localStorage.setItem('fielora.ui.preferences.v2',JSON.stringify(p))})()`);
  await reload();await settings();
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:650,deviceScaleFactor:1,mobile:false});
  await wait('document.documentElement.dataset.appearanceMode==="dark"');
  await captureScreenshot(cdp,path.join(evidence,'usage-dark-compact.png'));
  await cdp.eval('document.querySelector(".usage-chart-section").scrollIntoView({block:"start"})');
  await captureScreenshot(cdp,path.join(evidence,'usage-dark-chart.png'));
  const bounds=await cdp.eval('(()=>{const e=document.querySelector(".settings-content");return {width:e.clientWidth,scroll:e.scrollWidth,chart:document.querySelector("[data-testid=usage-chart]").getBoundingClientRect().width}})()');
  assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));assert.ok(bounds.chart>100);
  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:'PASS',report,bounds,externalModelRequests:0,checks:['empty state','live receipt refresh','model switch attribution','rates','renderer reload','Core restart','light/dark compact layout']},null,2));
  console.log('MODEL_USAGE_SETTINGS_E2E=PASS');
} catch(error){await writeFile(path.join(evidence,'failure.log'),`${error.stack}\n${output.join('')}`);if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});throw error;}
finally{cdp?.close();await cleanupElectronProcess(child);}
