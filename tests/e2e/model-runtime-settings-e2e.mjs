import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packagedApplication, deleteTestCredential } from '../support/platform.mjs';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess, waitForChildExit } from './harness/electron-cdp-harness.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const mode=process.argv[2]??'dev';assert.ok(['dev','packaged'].includes(mode));
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-model-runtime-'));
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR??await mkdtemp(path.join(tmpdir(),'fielora-model-runtime-evidence-'));
await mkdir(evidence,{recursive:true});
let launched,cdp,providerId,fixtureId;
const value=v=>JSON.stringify(v);
async function launch(){launched=await launchElectron({root,dataRoot,executablePath:mode==='packaged'?packagedApplication(root):''});cdp=await connectToFieloraApp(launched);await waitForExpression(cdp,"window.fielora.core.getHealth().then(h=>h.state==='READY')");await waitForExpression(cdp,"document.querySelector('[data-testid=settings-nav]')");await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});}
async function click(selector){await waitForExpression(cdp,`document.querySelector(${value(selector)})`);await cdp.eval(`document.querySelector(${value(selector)}).click()`);}
async function setInput(selector,text){await cdp.eval(`(()=>{const e=document.querySelector(${value(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${value(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function get(){return cdp.eval(`window.fielora.provider.get({provider_config_id:${value(providerId)}})`);}
async function quit(){await cdp.eval('void window.fielora.core.quit()');cdp.close();cdp=null;assert.equal(await waitForChildExit(launched.child),0);launched=null;}
async function openSettings(){if(!await cdp.eval("!!document.querySelector('[data-testid=settings-screen]')"))await click('[data-testid=settings-nav]');await click('[data-testid=settings-category-models]');await click(`[data-testid="provider-select-${providerId}"]`);}
try{
 await launch();
 const created=await cdp.eval("window.fielora.provider.create({provider_kind:'OPENAI',display_name:'模型配置验收（无真实请求）',base_url:null,default_model:'gpt-4.1-mini',custom_endpoint_acknowledged:false})");providerId=created.id;
 await cdp.eval(`window.fielora.provider.storeCredential({provider_config_id:${value(providerId)},secret:'synthetic-only-not-a-real-key'})`);
 // New saves reject the old invalid combination at the IPC boundary.
 for(const provider_kind of ['OPENAI','ANTHROPIC']){
   assert.match(await cdp.eval(`window.fielora.provider.create({provider_kind:${value(provider_kind)},display_name:'must reject',base_url:null,default_model:'Qwen3.7-Plus',custom_endpoint_acknowledged:false}).then(()=>'',e=>String(e))`),/PROVIDER_MODEL_MISMATCH/);
 }
 let before=await get();
 assert.match(await cdp.eval(`window.fielora.provider.update({provider_config_id:${value(providerId)},expected_revision:${before.revision},display_name:'must reject',base_url:null,default_model:'Qwen3.7-Plus',custom_endpoint_acknowledged:false}).then(()=>'',e=>String(e))`),/PROVIDER_MODEL_MISMATCH/);
 assert.equal((await get()).revision,before.revision);assert.equal((await get()).credential_present,true);
 // Seed a historical wrong-protocol row only in this isolated, stopped fixture DB.
 await quit();
 const db=new DatabaseSync(path.join(dataRoot,'Fielora','data','fielora.db'));
 try{assert.equal(db.prepare('UPDATE provider_configs SET default_model=? WHERE id=?').run('Qwen3.7-Plus',providerId).changes,1);}finally{db.close();}
 await launch();assert.equal((await get()).default_model,'Qwen3.7-Plus');
 await openSettings();await click('[data-testid="provider-repair-connection"]');
 await waitForExpression(cdp,`document.querySelector('[data-testid="provider-config-mismatch"]')`);
 assert.equal(await cdp.eval(`document.querySelector('[data-testid="provider-form-save"]').disabled`),true);
 await captureScreenshot(cdp,path.join(evidence,`${mode}-wrong-protocol-blocked.png`));
 await click('[data-testid="provider-use-matched-vendor"]');
 assert.equal(await cdp.eval(`document.querySelector('[name="default_model"]').value`),'qwen3.7-plus');

 await waitForExpression(cdp,`document.querySelectorAll('[data-testid^="provider-preset-"]').length===10`);
 assert.equal(await cdp.eval(`document.querySelector('[role="dialog"][data-testid="provider-setup"]')===null && !!document.querySelector('[data-testid="settings-screen"]')`),true);
 const catalog=await cdp.eval('window.fielora.provider.catalog()');assert.equal(catalog.length,10);
 for(const preset of catalog){
   await click(`[data-testid="provider-preset-${preset.id.toLowerCase()}"]`);
   await waitForExpression(cdp,`document.querySelector('[name="default_model"]').value===${value(preset.model_ids[0])}`);
   assert.equal(await cdp.eval(`document.querySelector('[name="base_url"]').value`),preset.base_url);
   assert.equal(await cdp.eval(`document.querySelector('[name="secret"]').value`),'');
 }
 await click('[data-testid="provider-preset-spark"]');
 const spark=catalog.find(p=>p.id==='SPARK');assert.equal(spark.versions.length,3);
 await click('[data-testid="provider-model-preset"]');await click(`[data-testid="provider-model-preset-option-${spark.versions[1].id}"]`);
 assert.equal(await cdp.eval(`document.querySelector('[name="base_url"]').value`),'https://spark-api-open.xf-yun.com/agent/v1');
 assert.equal(await cdp.eval(`document.querySelector('[name="default_model"]').value`),'spark-x');
 await click('[data-testid="provider-preset-qwen"]');
 await click('[data-testid="provider-qwen-plan"]');await click('[data-testid="provider-qwen-plan-option-CODING"]');
 await captureScreenshot(cdp,path.join(evidence,`${mode}-unified-provider-editor.png`));
 await click('.model-endpoint-ack input');await click('[data-testid="provider-form-save"]');
 await waitForExpression(cdp,`!document.querySelector('[data-testid="provider-form"]')`);
 let corrected=await get();assert.equal(corrected.id,providerId);assert.equal(corrected.provider_kind,'OPENAI_COMPATIBLE');assert.equal(corrected.endpoint_class,'CUSTOM');assert.equal(corrected.credential_present,true);assert.equal(corrected.default_model,'qwen3.7-plus');
 assert.equal(corrected.model_runtime.profile.source,'OFFICIAL_DOCUMENTATION');assert.deepEqual(corrected.model_runtime.profile.reasoning_modes,['PROVIDER_DEFAULT','OFF','ON']);
 // A stale or unacknowledged protocol change must not partially update the configuration.
 for(const request of [{provider_kind:'ANTHROPIC',expected_revision:created.revision,base_url:null,custom_endpoint_acknowledged:false},{provider_kind:'OPENAI_COMPATIBLE',expected_revision:corrected.revision,base_url:'https://api.moonshot.cn/v1',custom_endpoint_acknowledged:false}]){
   assert.equal(await cdp.eval(`window.fielora.provider.update({...${value(request)},provider_config_id:${value(providerId)},display_name:'invalid',default_model:'invalid'}).then(()=>false,()=>true)`),true);
 }
 assert.equal((await get()).revision,corrected.revision);
 await click(`[data-testid="reasoning-${providerId}"]`);await click(`[data-testid="reasoning-${providerId}-option-ON"]`);
 await setInput(`[data-testid="output-limit-${providerId}"]`,'2048');await click(`[data-testid="runtime-save-${providerId}"]`);
 await waitForExpression(cdp,`window.fielora.provider.get({provider_config_id:${value(providerId)}}).then(p=>p.model_runtime.settings.reasoning==='ON')`);
 let saved=await get();assert.deepEqual(saved.model_runtime.effective_parameters,{max_tokens:2048,enable_thinking:true});
 await captureScreenshot(cdp,path.join(evidence,`${mode}-reasoning-settings.png`));
 // IPC rejects unsupported modes, not just the select menu.
 const rejected=await cdp.eval(`window.fielora.provider.updateRuntime({provider_config_id:${value(providerId)},expected_provider_revision:${saved.revision},expected_revision:${saved.model_runtime.revision},settings:{reasoning:'MAX',max_output_tokens:2048}}).then(()=>false,()=>true)`);assert.equal(rejected,true);
 await quit();await launch();saved=await get();assert.equal(saved.model_runtime.settings.reasoning,'ON');assert.equal(saved.model_runtime.settings.max_output_tokens,2048);
 // The SAME official endpoint and ID entered manually must remain unoptimized after restart.
 await openSettings();await click(`[data-testid="settings-edit-${providerId}"]`);
 await click('[data-testid="provider-model-preset"]');await click('[data-testid="provider-model-preset-option-CUSTOM"]');
 await setInput('[name="default_model"]','qwen3.7-plus');
 assert.equal(await cdp.eval(`document.querySelector('[name="default_model"]').type`),'text');
 await click('[data-testid="provider-form-save"]');await waitForExpression(cdp,`!document.querySelector('[data-testid="provider-form"]')`);
 saved=await get();assert.equal(saved.model_optimization,false);assert.equal(saved.model_runtime.profile.source,'CUSTOM_OPENAI');assert.deepEqual(saved.model_runtime.effective_parameters,{max_tokens:4096});assert.equal(saved.credential_present,true);
 assert.equal(await cdp.eval(`window.fielora.provider.updateRuntime({provider_config_id:${value(providerId)},expected_provider_revision:${saved.revision},expected_revision:${saved.model_runtime.revision},settings:{reasoning:'ON',max_output_tokens:2048}}).then(()=>false,()=>true)`),true);
 await captureScreenshot(cdp,path.join(evidence,`${mode}-custom-standard-model.png`));
 await quit();await launch();saved=await get();assert.equal(saved.model_optimization,false);assert.equal(saved.model_runtime.profile.source,'CUSTOM_OPENAI');
 // Selecting the built-in version restores its separate settings and keeps the credential.
 await openSettings();await click(`[data-testid="settings-edit-${providerId}"]`);await click('[data-testid="provider-preset-qwen"]');
 await click('[data-testid="provider-qwen-plan"]');await click('[data-testid="provider-qwen-plan-option-CODING"]');await click('.model-endpoint-ack input');await click('[data-testid="provider-form-save"]');
 await waitForExpression(cdp,`!document.querySelector('[data-testid="provider-form"]')`);saved=await get();assert.equal(saved.model_optimization,true);assert.equal(saved.model_runtime.settings.reasoning,'ON');assert.equal(saved.credential_present,true);
 // An identical model name on another endpoint does not inherit the declaration or saved override.
 saved=await cdp.eval(`window.fielora.provider.update({provider_config_id:${value(providerId)},expected_revision:${saved.revision},display_name:'未知端点验证',base_url:'https://fielora-model-test.invalid/v1',default_model:'qwen3.7-plus',custom_endpoint_acknowledged:true})`);
 assert.equal(saved.model_runtime.profile.tools,'UNKNOWN');assert.equal(saved.model_runtime.settings.reasoning,'PROVIDER_DEFAULT');assert.equal(saved.model_runtime.validation,null);
 saved=await cdp.eval(`window.fielora.provider.storeCredential({provider_config_id:${value(providerId)},secret:'synthetic-only-not-a-real-key'})`);
 await cdp.eval("window.dispatchEvent(new CustomEvent('fielora:providers-changed'))");await openSettings();
 await click(`[data-testid="runtime-validate-${providerId}"]`);
 await waitForExpression(cdp,`window.fielora.provider.get({provider_config_id:${value(providerId)}}).then(p=>!!p.model_runtime.validation)`,{timeoutMs:100000});
 saved=await get();assert.equal(saved.model_runtime.validation.checks[0].status,'FAILED');assert.ok(saved.model_runtime.validation.checks.slice(1).every(c=>c.status==='NOT_TESTED'));
 await waitForExpression(cdp,`document.querySelector('[data-testid="runtime-report-${providerId}"]')`);
 await captureScreenshot(cdp,path.join(evidence,`${mode}-bounded-failure.png`));
 await cdp.eval("(()=>{const p=JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')||'{}');p.appearance={...p.appearance,themePreference:'DARK'};localStorage.setItem('fielora.ui.preferences.v2',JSON.stringify(p));window.__runtimeReload=true})()");
 await cdp.send('Page.reload');await waitForExpression(cdp,"typeof window.__runtimeReload==='undefined' && document.documentElement.dataset.appearanceMode==='dark' && document.querySelector('[data-testid=settings-nav]')");
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:920,height:760,deviceScaleFactor:1,mobile:false});await openSettings();
 assert.equal(await cdp.eval('document.documentElement.scrollWidth<=window.innerWidth'),true);
 await captureScreenshot(cdp,path.join(evidence,`${mode}-dark-narrow.png`));
 saved=await cdp.eval(`window.fielora.provider.updateRuntime({provider_config_id:${value(providerId)},expected_provider_revision:${saved.revision},expected_revision:${saved.model_runtime.revision},settings:{reasoning:'PROVIDER_DEFAULT',max_output_tokens:1024}})`);
 assert.equal(saved.model_runtime.validation,null);
 // Existing real Harness fixture proves the configuration enters the Run ledger and stays fixed.
 const projectRoot=path.join(dataRoot,'project');await mkdir(projectRoot);execFileSync('git',['init'],{cwd:projectRoot,stdio:'ignore'});
 const fixture=await cdp.eval(`(async()=>{let p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Harness settings fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture__',custom_endpoint_acknowledged:true});p=await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});p=await window.fielora.provider.updateRuntime({provider_config_id:p.id,expected_provider_revision:p.revision,expected_revision:0,settings:{reasoning:'PROVIDER_DEFAULT',max_output_tokens:2048}});const project=await window.fieloraTest.createProject({title:'Model runtime fixture',root_path:${value(projectRoot)},goal:null});const c=await window.fielora.conversation.create({field_id:project.field_id,title:'Settings snapshot',provider_config_id:p.id,model_id:p.default_model});const message=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:'FIELORA_AGENT_FIXTURE_CREATE',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null});const run=await window.fielora.agent.start({user_message_id:message.id,field_id:project.field_id,conversation_id:c.id,provider_config_id:p.id,model_id:p.default_model,task:'FIELORA_AGENT_FIXTURE_CREATE',permission:'FULL_CONTROL',max_steps:16});return {provider:p,run};})()`);fixtureId=fixture.provider.id;
 await waitForExpression(cdp,`window.fielora.agent.get({run_id:${value(fixture.run.id)}}).then(r=>['COMPLETED','FAILED','PAUSED'].includes(r.status))`,{timeoutMs:60000});
 const facts=await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${value(fixture.run.id)}}),events:await window.fielora.agent.events({run_id:${value(fixture.run.id)},after_sequence:null,limit:500})}))()`);
 assert.equal(facts.run.status,'COMPLETED');const snapshot=facts.events.filter(e=>e.payload.kind==='MODEL_RUNTIME_SETTINGS_V1');assert.equal(snapshot.length,1);assert.equal(snapshot[0].payload.settings.max_output_tokens,2048);assert.deepEqual(snapshot[0].payload.effective_parameters,{max_tokens:2048});
 await cdp.eval(`window.fielora.provider.updateRuntime({provider_config_id:${value(fixtureId)},expected_provider_revision:${fixture.provider.revision},expected_revision:${fixture.provider.model_runtime.revision},settings:{reasoning:'PROVIDER_DEFAULT',max_output_tokens:4096}})`);
 await quit();await launch();const persisted=await cdp.eval(`window.fielora.agent.events({run_id:${value(fixture.run.id)},after_sequence:null,limit:500})`);assert.equal(persisted.find(e=>e.payload.kind==='MODEL_RUNTIME_SETTINGS_V1').payload.settings.max_output_tokens,2048);
 await quit();
 await writeFile(path.join(evidence,`${mode}-MODEL_RUNTIME_ACCEPTANCE.json`),JSON.stringify({status:'PASS',mode,external_model_requests:0,checks:['official-protocol-mismatch-rejected-by-core','legacy-config-readable-repairable-and-save-blocked','ten-vendor-setup-catalog','spark-version-endpoint-selection','explicit-custom-standard-mode-and-restart','custom-mode-rejects-vendor-overrides','unified-settings-entry','protocol-correction-keeps-provider-and-credential','stale-and-unacknowledged-update-rejected','declared-profile-from-core','reasoning-ui-save','wire-parameter-preview','unsupported-mode-rejected-by-core','restart-settings','unknown-endpoint-isolation','bounded-validation-failure-not-false-pass','changed-settings-invalidate-evidence','harness-settings-snapshot','snapshot-survives-provider-edit-and-restart']},null,2));
 console.log(`Model runtime E2E (${mode}): PASS evidence=${evidence}`);
} catch(error) {
 if(cdp){await captureScreenshot(cdp,path.join(evidence,`${mode}-failure.png`)).catch(()=>{});console.error(await cdp.eval('document.body.innerText').catch(()=>''));console.error(await cdp.eval("window.fielora.provider.catalog().then(v=>JSON.stringify(v),e=>String(e))").catch(()=>''));}
 console.error(`Failure evidence=${evidence}`);throw error;
} finally{cdp?.close();await cleanupElectronProcess(launched?.child);if(providerId)deleteTestCredential(providerId);if(fixtureId)deleteTestCredential(fixtureId);await rm(dataRoot,{recursive:true,force:true});}
