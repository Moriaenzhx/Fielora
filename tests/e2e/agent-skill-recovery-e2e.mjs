import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-skill-recovery-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-skill-recovery/dev'));
const output = []; let child; let cdp; let ids;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs: 60000, output });
const base = Array.from({ length: 18 }, (_, i) => `// setting evidence ${i + 1} ${'context '.repeat(260)}`).join('\n') + "\nexports.value = 'wrong';\n";
async function launch() {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { Path: `${path.dirname(process.execPath)};${process.env.Path ?? ''}` },
  });
  child=launched.child;
  cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:701,deviceScaleFactor:1,mobile:false});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
}
async function restartApp() {
  await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true');
  await Promise.race([new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error('test app did not exit normally')),15000))]);
  cdp.close();cdp=null;await cleanupElectronProcess(child);child=null;
  await launch();
}
async function create(title) {
  return cdp.eval(`window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:${JSON.stringify(title)},provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)}})`);
}
async function start(conversation, task, attachments = [], maxSteps = null) {
  return cdp.eval(`(async()=>{const message=await window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(conversation.id)},role:'USER',content:${JSON.stringify(task)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:message.conversation_id,user_message_id:message.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task:${JSON.stringify(task)},permission:'FULL_CONTROL',max_steps:${JSON.stringify(maxSteps)},attachments:${JSON.stringify(attachments)}})})()`);
}
async function settled(run) {
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(r=>['COMPLETED','FAILED','PAUSED'].includes(r.status))`);
  return cdp.eval(`(async()=>{const id=${JSON.stringify(run.id)};return {run:await window.fielora.agent.get({run_id:id}),events:await window.fielora.agent.events({run_id:id,after_sequence:null,limit:500}),tools:await window.fielora.agent.toolCalls({run_id:id})}})()`);
}
async function show(conversation) {
  await cdp.eval('window.__intentReload=true');
  await cdp.send('Page.reload');
  await wait("typeof window.__intentReload==='undefined' && window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await wait(`document.querySelector('[data-testid="conversation-${conversation.id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${conversation.id}"]').click()`);
}
try {
  await mkdir(projectRoot); await mkdir(evidence,{recursive:true});
  await writeFile(path.join(projectRoot,'verify-unrelated.cjs'), "console.log('unrelated green check');\n");
  await writeFile(path.join(projectRoot,'verify-mixed.cjs'), "require('node:assert/strict').equal(require('node:fs').readFileSync('mixed-change.txt','utf8'),'expected');\n");
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  await launch();
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Skill recovery fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_outcomes__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'Skill 安装恢复',goal:null,root_path:${JSON.stringify(projectRoot)}});return {provider,project}})()`);
  const conversation=await create('缺资源、错误验收与重启修复');
  const paused=await settled(await start(conversation,'安装 Skill 的缺失资源修复回归'));
  await writeFile(path.join(evidence,'paused.json'),JSON.stringify(paused,null,2));
  assert.equal(paused.run.status,'PAUSED'); assert.equal(paused.run.error_code,'AGENT_TASK_BLOCKED');
  assert.equal(paused.run.current_step,7);
  assert.equal(paused.tools.filter(t=>t.name==='finish_task'&&t.error_code==='AGENT_VERIFICATION_REQUIRED').length,2);
  const incomplete=paused.tools.find(t=>t.name==='verify_skill').receipt;
  assert.equal(incomplete.success,false); assert.equal(incomplete.diagnostics.length,3);
  const listing=paused.tools.find(t=>t.name==='list_files').receipt;
  assert.ok(listing.paths.includes('.agents/skills/sample-repair/SKILL.md')); assert.equal(listing.truncated,false);
  assert.ok(paused.events.some(e=>e.kind==='VERIFICATION_RECORDED'&&e.payload.receipt.check_kind==='SKILL_INSTALLATION'&&e.payload.receipt.outcome==='FAIL'));
  assert.ok(!paused.events.some(e=>e.kind==='RUN_COMPLETED'));
  await show(conversation); await wait("document.body.innerText.includes('安装缺少程序、schema 和模板')");
  await captureScreenshot(cdp,path.join(evidence,'missing-resources.png'));
  await restartApp();
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(paused.run.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(paused.run.id)}}).then(r=>r.current_step>7)`);
  const repaired=await settled(paused.run);
  await writeFile(path.join(evidence,'repaired.json'),JSON.stringify(repaired,null,2));
  assert.equal(repaired.run.status,'COMPLETED'); assert.equal(repaired.run.current_step,16);
  assert.ok(repaired.events.some(e=>e.kind==='CHECKPOINT_CREATED'&&e.payload.kind==='EXECUTION_BUILD_PROVENANCE'&&e.payload.build_provenance.agent_core_fingerprint), 'Resumed execution records the current build without rewriting the original RunStarted');
  assert.equal(repaired.tools.filter(t=>t.name==='finish_task'&&t.error_code==='AGENT_VERIFICATION_REQUIRED').length,3);
  assert.ok(repaired.tools.some(t=>t.name==='run_command'&&t.arguments.argv[1]==='doctor'&&t.receipt.success&&t.receipt.verification_eligible));
  assert.ok(repaired.tools.some(t=>t.name==='load_skill'&&t.status==='COMPLETED'));
  assert.equal(repaired.tools.filter(t=>t.name==='create_file').length,4);
  assert.ok(repaired.events.some(e=>e.kind==='VERIFICATION_RECORDED'&&e.payload.receipt.check_kind==='SKILL_INSTALLATION'&&e.payload.receipt.outcome==='PASS'));
  await show(conversation); await wait("document.body.innerText.includes('结构与 doctor 检查通过')");
  await captureScreenshot(cdp,path.join(evidence,'verified-installation.png'));
  const capability=await settled(await start(await create('能力目录事实'),'检查当前能力目录事实'));
  await writeFile(path.join(evidence,'capability-catalog.json'),JSON.stringify(capability,null,2));
  assert.equal(capability.run.status,'COMPLETED');
  const queries=capability.tools.filter(t=>t.name==='capability_status');
  assert.equal(queries.length,7);
  assert.ok(queries.every(t=>t.status==='COMPLETED'));
  assert.equal(queries[0].receipt.catalog_page.returned,2);
  assert.equal(queries[1].receipt.catalog_page.offset,2);
  assert.equal(queries[0].receipt.catalog_page.catalog_sha256,queries[1].receipt.catalog_page.catalog_sha256);
  assert.equal(queries[2].receipt.tool_detail.definition.name,'skills.prepare');
  assert.equal(queries[2].receipt.tool_detail.facts.permission,'REQUIRES_INVOCATION_CHECK');
  assert.equal(queries[2].receipt.tool_detail.facts.target_reachability,'NOT_PROBED');
  assert.equal(queries[3].receipt.tool_detail.permanent_unsupported,false);
  assert.equal(queries[4].receipt.candidate_resolution.matches,2);
  assert.equal(queries[4].receipt.candidate_resolution.selection,'NONE');
  assert.equal(queries[4].receipt.candidate_resolution.grants_authority,false);
  assert.equal(queries[4].receipt.catalog_page.query_sha256,queries[5].receipt.catalog_page.query_sha256);
  assert.equal(queries[4].receipt.catalog_page.catalog_sha256,queries[5].receipt.catalog_page.catalog_sha256);
  assert.equal(queries[5].receipt.catalog_page.offset,1);
  assert.deepEqual([queries[4],queries[5]].flatMap(t=>t.receipt.tool_catalog.map(r=>r.name)).sort(),['skills.prepare','skills.search']);
  assert.ok([queries[4],queries[5]].every(t=>t.receipt.tool_catalog.every(r=>r.effect==='NETWORK'&&r.permission==='REQUIRES_INVOCATION_CHECK'&&r.target_reachability==='NOT_PROBED')));
  assert.equal(queries[6].receipt.candidate_resolution.matches,0);
  assert.equal(queries[6].receipt.candidate_resolution.permanent_unsupported,false);
  assert.equal(queries[6].receipt.skill_acquisition.status,'AVAILABLE');
  for (const result of [paused,repaired,capability]) {
    const contexts=result.events.filter(e=>e.kind==='CONTEXT_COMPILED');
    assert.ok(contexts.length>0);
    assert.ok(contexts.every(e=>e.payload.idr_participation==='IDR_DISABLED' && e.payload.idr_contribution_present===false && e.payload.idr_human_model_revision===null));
  }
  const acquired=await settled(await start(await create('完整包获取安装'),'完整 Skill 获取安装回归'));
  await writeFile(path.join(evidence,'acquisition.json'),JSON.stringify(acquired,null,2));
  assert.equal(acquired.run.status,'COMPLETED');
  assert.ok(acquired.tools.some(t=>t.name==='skills.install'&&t.error_code==='AGENT_SKILL_PREPARATION_REQUIRED'));
  const prepared=acquired.tools.find(t=>t.name==='skills.prepare'&&t.status==='COMPLETED');
  const published=acquired.tools.find(t=>t.name==='skills.install'&&t.status==='COMPLETED');
  assert.equal(prepared.receipt.provenance.network_verified,false);
  assert.equal(published.receipt.prepared_tool_call_id,prepared.id);
  assert.equal(published.receipt.file_count,4);
  assert.equal(published.receipt.scripts_executed,false);
  assert.equal(published.receipt.verification_eligible,false);
  assert.deepEqual([...await readFile(path.join(projectRoot,'.agents/skills/sample-acquire/assets/data.bin'))],[0,255,128]);
  assert.match(await readFile(path.join(projectRoot,'.agents/skills/sample-acquire/unreferenced.txt'),'utf8'),/whole Skill/);
  assert.ok(acquired.tools.some(t=>t.name==='finish_task'&&t.error_code==='AGENT_VERIFICATION_REQUIRED'));
  assert.ok(acquired.tools.some(t=>t.name==='verify_skill'&&t.receipt?.success));
  assert.ok(acquired.tools.some(t=>t.name==='run_command'&&t.receipt?.success&&t.receipt.verification_eligible));
  assert.ok(acquired.tools.some(t=>t.name==='load_skill'&&t.status==='COMPLETED'));
  const loop=await settled(await start(await create('观察不能重置失败'),'安装 Skill 的重复结束回归'));
  await writeFile(path.join(evidence,'loop.json'),JSON.stringify(loop,null,2));
  assert.equal(loop.run.status,'PAUSED'); assert.equal(loop.run.current_step,6);
  assert.equal(loop.tools.filter(t=>t.name==='finish_task').length,3);
  assert.ok(!loop.events.some(e=>e.kind==='RUN_COMPLETED'));
  const mixed=await settled(await start(await create('检查范围不能混用'),'Skill 检查不能代替其他修改验证'));
  await writeFile(path.join(evidence,'mixed.json'),JSON.stringify(mixed,null,2));
  assert.equal(mixed.run.status,'COMPLETED'); assert.equal(mixed.run.current_step,6);
  assert.equal(mixed.tools.filter(t=>t.name==='finish_task'&&t.error_code==='AGENT_VERIFICATION_REQUIRED').length,1);
  assert.ok(mixed.tools.some(t=>t.name==='verify_skill'&&t.receipt.success&&t.receipt.runtime_check_required===false));

  const inspect=await settled(await start(await create('已有 Skill 只读检查'),'只检查已有 Skill，不修改文件'));
  await writeFile(path.join(evidence,'inspect-existing.json'),JSON.stringify(inspect,null,2));
  assert.equal(inspect.run.status,'COMPLETED'); assert.equal(inspect.run.current_step,2);
  assert.ok(inspect.tools.every(t=>t.effect==='OBSERVE'));
  assert.equal(inspect.tools.find(t=>t.name==='verify_skill').receipt.success,true);

  // Reproduce the user's new status question in the same conversation as an
  // unfinished, cancelled installation. The negative check must remain FAIL.
  const statusConversation=await create('未安装完整也能回答状态');
  const historical=await settled(await start(statusConversation,'需要你安装一下archify的skill 你可以自己去安装吗'));
  assert.equal(historical.run.status,'PAUSED');
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(historical.run.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(historical.run.id)}}).then(r=>r.status==='CANCELLED')`);
  const oldBefore=await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(historical.run.id)}})`);
  const incompleteEntry='---\nname: archify\ndescription: Isolated negative status fixture, not upstream Archify.\n---\nRequired `assets/template.html`, `bin/archify.mjs`, `examples/`, `references/authoring-contract.md`, `references/brand-marks.md`, `references/delivery-contract.md`, `references/viewer-runtime.md`, `renderers/shared/geometry.mjs`, `renderers/workflow/README.md`, `schemas/`, `schemas/common.schema.json`, `scripts/check-update.mjs`.\n';
  const entryPath=path.join(projectRoot,'.agents/skills/archify/SKILL.md');
  await mkdir(path.dirname(entryPath),{recursive:true});await writeFile(entryPath,incompleteEntry);
  const negative=await settled(await start(statusConversation,'现在有装好archify这个skill吗'));
  await writeFile(path.join(evidence,'negative-status.json'),JSON.stringify(negative,null,2));
  assert.equal(negative.run.status,'COMPLETED');assert.equal(negative.run.current_step,3);
  assert.deepEqual(negative.tools.map(t=>t.name),['verify_skill','record_request_intent','finish_task']);
  assert.ok(negative.tools.every(t=>t.effect==='OBSERVE'&&t.status==='COMPLETED'));
  assert.equal(negative.tools[0].receipt.success,false);assert.equal(negative.tools[0].receipt.diagnostics.length,12);
  const terminal=negative.events.find(e=>e.kind==='RUN_COMPLETED').payload;
  assert.equal(terminal.completion_basis,'ANSWER');assert.equal(terminal.completion_scope,'CURRENT_REQUEST');
  assert.equal(terminal.verification_passed,false);assert.equal(terminal.historical_goals_updated,false);
  assert.ok(negative.events.some(e=>e.kind==='VERIFICATION_RECORDED'&&e.payload.receipt.outcome==='FAIL'));
  assert.ok(!negative.events.some(e=>e.kind==='VERIFICATION_RECORDED'&&e.payload.receipt.outcome==='PASS'));
  const answerCheckpoints=negative.events.filter(e=>e.kind==='CHECKPOINT_CREATED'&&e.payload.request_interpretation==='answer_only');
  assert.ok(answerCheckpoints.length>0);
  assert.ok(answerCheckpoints.every(e=>e.payload.goal.status!=='REPAIRING'));
  assert.equal(await readFile(entryPath,'utf8'),incompleteEntry);
  await show(statusConversation);await wait("document.body.innerText.includes('archify 尚未完整安装')");
  await captureScreenshot(cdp,path.join(evidence,'negative-status-answer.png'));
  await restartApp();await show(statusConversation);
  await wait("document.body.innerText.includes('archify 尚未完整安装')");
  const oldAfter=await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(historical.run.id)}})`);
  assert.equal(oldAfter.status,'CANCELLED');assert.equal(oldAfter.updated_at,oldBefore.updated_at);
  assert.equal(await readFile(entryPath,'utf8'),incompleteEntry);
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify({status:'PASS',scope:'deterministic model substitute with actual Electron/Core/files/process/restart; not a real-model or external Archify installation',missingResourcesRejected:true,unrelatedGreenCheckRejected:true,explicitListingTruthful:true,currentCatalogReloaded:true,doctorRequiredAndExecuted:true,sameRunRestartRepair:true,observationLoopPausedAtStep:6,mixedWorkspaceChangeRequiresSeparateCheck:true,existingSkillCheckedWithoutMutation:true,negativeStatusAnswerCompletedWithoutRepair:true,failedCheckNotPromotedToPass:true,historicalInstallationUnchanged:true,negativeAnswerPersistsAcrossRestart:true},null,2));
  console.log('AGENT_SKILL_RECOVERY_E2E=PASS');
} catch(error) {
  if(cdp){await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});await writeFile(path.join(evidence,'failure-ui.txt'),await cdp.eval('document.body.innerText').catch(()=>''));}
  throw error;
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close();await cleanupElectronProcess(child);
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
