import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-tools-e2e-'));
const projectRoot=path.join(dataRoot,'project');
const evidence=path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root,'artifacts/tool-acquisition-20260925/desktop'));
const output=[]; let child,cdp,ids;
const wait=expression=>waitForExpression(cdp,expression,{timeoutMs:90000,output});
const calls=run=>cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(run.id)}})`);
async function launch() {
  const launched=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    // Deliberately preserve ordinary inherited PATH; do not inject modern Node.
  });
  child=launched.child; cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:850,deviceScaleFactor:1,mobile:false});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function start(task) {
  return cdp.eval(`(async()=>{const conversation=await window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:${JSON.stringify(task)},provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_outcomes__'});const message=await window.fielora.conversation.createMessage({conversation_id:conversation.id,role:'USER',content:${JSON.stringify(task)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});const run=await window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:conversation.id,user_message_id:message.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_outcomes__',task:${JSON.stringify(task)},permission:'FULL_CONTROL',max_steps:12,attachments:[]});return {run,conversation}})()`);
}
async function show(conversation) {
  await cdp.eval('window.__toolsReload=true'); await cdp.send('Page.reload');
  await wait("typeof window.__toolsReload==='undefined' && window.fieloraTest");
  await wait(`document.querySelector('[data-testid="conversation-${conversation.id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${conversation.id}"]').click()`);
}
async function approval(run) {
  await wait(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(run.id)}}).then(ts=>ts.some(t=>t.name==='tools.install' && t.policy_decision==='ASK'))`);
}
try {
  await mkdir(projectRoot); await mkdir(evidence,{recursive:true});
  await writeFile(path.join(projectRoot,'verify-runtime.cjs'),"require('node:assert/strict').ok(Number(process.versions.node.split('.')[0])>=18);console.log('compatible Node '+process.version);\n");
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  await launch();
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Tool acquisition fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_outcomes__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'工具发现与审批',goal:null,root_path:${JSON.stringify(projectRoot)}});return {provider,project}})()`);
  const denied=await start('便携工具安装审批回归'); await approval(denied.run); await show(denied.conversation);
  await wait("document.querySelector('[data-testid=agent-install-preview]')");
  const preview=await cdp.eval("document.querySelector('[data-testid=agent-install-preview]').innerText");
  assert.ok(preview.includes('https://example.com/fixture-tool.zip')); assert.ok(preview.includes('来源未列入可信供应商'));
  assert.ok(preview.includes('字节'));
  assert.equal(await cdp.eval("document.querySelector('[data-testid=agent-allow-once]').textContent"),'允许本次安装');
  await assert.rejects(access(path.join(projectRoot,'.fielora/tools')));
  await captureScreenshot(cdp,path.join(evidence,'installation-approval.png'));
  await cdp.eval("Array.from(document.querySelectorAll('[data-testid=agent-approval] button')).find(b=>b.textContent==='拒绝').click()");
  await wait(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(denied.run.id)}}).then(ts=>ts.some(t=>t.name==='tools.install' && t.status==='DENIED'))`);
  await assert.rejects(access(path.join(projectRoot,'.fielora/tools')));
  const allowed=await start('便携工具安装审批回归'); await approval(allowed.run); await show(allowed.conversation);
  await wait("document.querySelector('[data-testid=agent-allow-once]')"); await cdp.eval("document.querySelector('[data-testid=agent-allow-once]').click()");
  await wait(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(allowed.run.id)}}).then(ts=>ts.some(t=>t.name==='tools.install' && t.status==='COMPLETED'))`);
  const installedCalls=await calls(allowed.run); const installed=installedCalls.find(t=>t.name==='tools.install');
  assert.equal(installed.policy_decision,'ASK'); assert.equal(installed.arguments._installation_preview.source_trust,'UNVERIFIED');
  assert.equal(installed.receipt.runtime_verified,false); await access(installed.receipt.executables[0]);
  const runtime=await start('现有 Node 版本发现回归');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(runtime.run.id)}}).then(r=>['COMPLETED','FAILED','PAUSED'].includes(r.status))`);
  const runtimeRun=await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(runtime.run.id)}})`);
  const runtimeCalls=await calls(runtime.run);
  const runtimeEvents=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(runtime.run.id)},after_sequence:null,limit:500})`);
  await writeFile(path.join(evidence,'runtime.json'),JSON.stringify({run:runtimeRun,tools:runtimeCalls,events:runtimeEvents},null,2));
  assert.equal(runtimeRun.status,'COMPLETED');
  const discovery=runtimeCalls.find(t=>t.name==='environment.inspect').receipt;
  assert.ok(discovery.candidates.length>=2,'This host probe requires multiple installed Node candidates');
  const verified=runtimeCalls.find(t=>t.name==='run_command' && t.arguments.argv[0]==='verify-runtime.cjs');
  assert.equal(verified.receipt.success,true); assert.ok(path.isAbsolute(verified.arguments.program));
  assert.notEqual(verified.arguments.program,discovery.candidates[0].program,'Ordinary default old Node must not be silently replaced by the test');
  await show(runtime.conversation); await captureScreenshot(cdp,path.join(evidence,'runtime-discovery.png'));
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify({status:'PASS',scope:'deterministic model fixture; real packaged Core/Policy/Approval/filesystem/process; network fixture only for approval',denied:await calls(denied.run),installed:installedCalls,runtime:runtimeCalls},null,2));
  console.log('AGENT_TOOL_ACQUISITION_E2E=PASS');
} catch(error) {
  if(cdp){await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});await writeFile(path.join(evidence,'failure-ui.txt'),await cdp.eval('document.body.innerText').catch(()=>''));}
  throw error;
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close(); await cleanupElectronProcess(child);
  if(ids?.provider) spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
