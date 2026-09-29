import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-goal-lifecycle-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-goal-lifecycle'));
const output = []; let child; let cdp; let ids;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs: 60000, output });
const base = Array.from({ length: 18 }, (_, i) => `// setting evidence ${i + 1} ${'context '.repeat(260)}`).join('\n') + "\nexports.value = 'wrong';\n";
async function create(title) {
  return cdp.eval(`window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:${JSON.stringify(title)},provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)}})`);
}
async function start(conversation, task, attachments = []) {
  return cdp.eval(`(async()=>{const message=await window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(conversation.id)},role:'USER',content:${JSON.stringify(task)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:message.conversation_id,user_message_id:message.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task:${JSON.stringify(task)},permission:'FULL_CONTROL',max_steps:null,attachments:${JSON.stringify(attachments)}})})()`);
}
async function settled(run) {
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(r=>['COMPLETED','FAILED','PAUSED'].includes(r.status))`);
  return cdp.eval(`(async()=>{const id=${JSON.stringify(run.id)};return {run:await window.fielora.agent.get({run_id:id}),events:await window.fielora.agent.events({run_id:id,after_sequence:null,limit:500}),tools:await window.fielora.agent.toolCalls({run_id:id})}})()`);
}
async function show(conversation) {
  await cdp.send('Page.reload');
  await wait(`document.querySelector('[data-testid="conversation-${conversation.id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${conversation.id}"]').click()`);
}
try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(projectRoot, 'settings.js'), base);
  await writeFile(path.join(projectRoot, 'verify.cjs'), "require('node:assert/strict').equal(require('./settings.js').value, 'right');\n");
  await writeFile(path.join(projectRoot, 'evidence.txt'), 'Original screenshot evidence.\n');
  assert.equal(spawnSync('git.exe', ['init'], { cwd: projectRoot, windowsHide: true }).status, 0);
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { Path: `${path.dirname(process.execPath)};${process.env.Path ?? ''}` },
  });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, timeoutMs: 120000, enablePage: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1478, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  ids = await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Goal lifecycle fixture',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',default_model:'__fielora_agent_fixture_images__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'目标驱动回归',goal:null,root_path:${JSON.stringify(projectRoot)}});return {provider,project}})()`);

  // Same filenames in two explicitly supplied references must not resolve to
  // the target. A premature final after only one reference remains incomplete.
  const referenceProject = path.join(dataRoot,'reference project');
  await mkdir(referenceProject); await writeFile(path.join(referenceProject,'package.json'),'{}');
  const referenceRoots = [path.join(referenceProject,'src/list'),path.join(referenceProject,'src/info')];
  for (const ref of referenceRoots) { await mkdir(ref,{recursive:true}); await writeFile(path.join(ref,'settings.js'),"exports.value = 'right';\n"); }
  const referenceTask = `FIELORA_AGENT_FIXTURE_GOAL_LIFECYCLE REFERENCE_SOURCE 对照 \`${referenceRoots[0]}\` 和 \`${referenceRoots[1]}\` 的源码修改当前项目，接口不变`;
  const referenceConversation = await create('跨项目参考源码');
  const referenceResult = await settled(await start(referenceConversation,referenceTask));
  await writeFile(path.join(evidence,'reference-source.json'),JSON.stringify(referenceResult,null,2));
  assert.equal(referenceResult.run.status,'COMPLETED'); assert.equal(referenceResult.run.current_step,7);
  const referenceReads = referenceResult.tools.filter(t=>t.receipt?.workspace_scope==='REFERENCE');
  assert.equal(referenceReads.length,2); assert.ok(referenceReads.every(t=>t.status==='COMPLETED'));
  assert.equal(new Set(referenceReads.map(t=>t.receipt.path)).size,2);
  assert.equal(new Set(referenceReads.map(t=>t.receipt.reference_root)).size,1);
  assert.equal(referenceResult.tools.filter(t=>t.name==='replace_text').length,1);
  assert.ok(referenceResult.tools.some(t=>t.name==='run_command'&&t.receipt.success));
  assert.ok(!referenceResult.tools.some(t=>t.name.startsWith('browser')));
  for (const ref of referenceRoots) assert.equal(await readFile(path.join(ref,'settings.js'),'utf8'),"exports.value = 'right';\n");
  await writeFile(path.join(projectRoot,'settings.js'),base);

  const focused = await create('持续修正直到验证');
  const focusedResult = await settled(await start(focused, 'FIELORA_AGENT_FIXTURE_GOAL_LIFECYCLE 调整配置字段'));
  await writeFile(path.join(evidence, 'focused.json'), JSON.stringify(focusedResult, null, 2));
  assert.equal(focusedResult.events.find(e => e.kind === 'RUN_STARTED').payload.task_class, 'FOCUSED_EDIT');
  assert.equal(focusedResult.events.find(e => e.kind === 'RUN_STARTED').payload.model_family, 'Qwen');
  assert.equal(focusedResult.run.status, 'COMPLETED'); assert.equal(focusedResult.run.current_step, 25);
  assert.ok(!focusedResult.events.some(e => ['RUN_FAILED', 'RUN_PAUSED'].includes(e.kind)));
  const checks = focusedResult.tools.filter(t => t.name === 'run_command');
  assert.equal(checks.length, 2); assert.equal(checks[0].receipt.success, false); assert.equal(checks[1].receipt.success, true);
  assert.equal(focusedResult.tools.filter(t => t.name === 'replace_text' && t.status === 'COMPLETED').length, 2);
  const states = focusedResult.events.filter(e => e.payload.kind === 'GENERAL_WORK_STATE_V1').map(e => e.payload.goal?.status);
  assert.ok(focusedResult.events.some(e => e.payload.kind === 'GENERAL_CONTEXT_REDUCED'), 'Focused uses shared context reduction before finishing');
  assert.ok(states.includes('REPAIRING')); assert.ok(states.includes('READY_TO_FINALIZE'));
  assert.ok((await readFile(path.join(projectRoot, 'settings.js'), 'utf8')).includes("value = 'right'"));
  await show(focused); await wait("document.querySelector('[data-agent-state=COMPLETED]')");
  await wait("document.querySelector('[data-testid=agent-execution-detail-toggle]')");
  // Conversation hydration can replace the terminal card after the first click.
  // Ensure the read-only details panel is open without toggling an open panel shut.
  await wait("(()=>{const b=document.querySelector('[data-testid=agent-execution-detail-toggle]');if(b?.getAttribute('aria-expanded')==='false')b.click();return document.querySelector('[data-testid=agent-goal-progress]')})()");
  await captureScreenshot(cdp, path.join(evidence, 'verified-after-failed-check.png'));

  await writeFile(path.join(projectRoot, 'settings.js'), base);
  const fast = await create('局部策略接续');
  const fastResult = await settled(await start(fast, 'FIELORA_AGENT_FIXTURE_GOAL_LIFECYCLE HANDOFF 删除配置字段'));
  await writeFile(path.join(evidence, 'handoff.json'), JSON.stringify(fastResult, null, 2));
  assert.equal(fastResult.events.find(e => e.kind === 'RUN_STARTED').payload.task_class, 'FAST_EDIT');
  assert.ok(fastResult.events.some(e => e.payload.kind === 'STRATEGY_ESCALATED'));
  assert.equal(fastResult.run.status, 'COMPLETED'); assert.ok(fastResult.run.current_step > 4);
  assert.ok(!fastResult.events.some(e => e.kind === 'RUN_FAILED'));

  // A verification pause near the input budget must receive a fresh allowance
  // on explicit resume, including after Core loses its in-memory transcript.
  await writeFile(path.join(projectRoot, 'settings.js'), base);
  const allowance = await create('验证暂停后继续同一任务');
  const allowancePaused = await settled(await start(allowance, 'FIELORA_AGENT_FIXTURE_RESUME_ALLOWANCE 调整配置字段'));
  assert.equal(allowancePaused.run.status,'PAUSED'); assert.equal(allowancePaused.run.error_code,'AGENT_VERIFICATION_REQUIRED');
  assert.equal(allowancePaused.run.current_step,5);
  await show(allowance);
  const allowancePid = await cdp.eval('window.fielora.core.getHealth().then(h=>h.pid)');
  await cdp.eval('window.fieloraTest.killCore()');
  await wait(`window.fielora.core.getHealth().then(h=>h.state==='READY'&&h.pid!==${allowancePid})`);
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(allowancePaused.run.id)}})`);
  const allowanceDone = await settled(allowancePaused.run);
  assert.equal(allowanceDone.run.id,allowancePaused.run.id); assert.equal(allowanceDone.run.status,'COMPLETED');
  assert.equal(allowanceDone.run.current_step,9);
  const renewed=allowanceDone.events.find(e=>e.kind==='RUN_RESUMED').payload.resource_budget_reset;
  assert.equal(renewed.source,'EXPLICIT_USER_RESUME'); assert.equal(renewed.previous_pause_reason,'AGENT_VERIFICATION_REQUIRED');
  assert.ok(allowanceDone.events.filter(e=>e.kind==='MODEL_COMPLETED').reduce((n,e)=>n+(e.payload.usage?.input_tokens??0),0)>2_000_000);
  assert.equal(allowanceDone.tools.filter(t=>t.name==='replace_text').length,1);
  assert.equal(allowanceDone.tools.filter(t=>t.name==='run_command'&&t.receipt.success).length,1);
  await writeFile(path.join(evidence,'renewed-after-verification.json'),JSON.stringify(allowanceDone,null,2));

  // An empty image reference is an input blocker: do not let the model guess.
  const missing = await create('缺失原图');
  const missingResult = await settled(await start(missing, '上面的图片中 modal 字段需要继续调整'));
  assert.equal(missingResult.run.status, 'PAUSED');
  assert.equal(missingResult.run.error_code, 'AGENT_REFERENCED_IMAGES_UNAVAILABLE');
  assert.ok(!missingResult.events.some(e => e.kind === 'MODEL_STARTED'));
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(missingResult.run.id)}})`);

  // A local translation fix can be established from source. The check exercises
  // the actual lookup semantics and all field bindings, without starting a site.
  const receiptSource = `const labels = ['发票ID','已到账金额','剩余未到账金额','到账日期','本次到账金额','到账后剩余金额','开户银行'];
const keys = [10408,12045,12046,10900,12043,12047,12048];
const dictionary = require('./cn.json');
const bindings = ['invoiceId','received','remaining','date','amount','after','bank'];
exports.dictionary=dictionary;
exports.fields=labels.map((fallback,i)=>({label:keys[i] ? dictionary[keys[i]] || fallback : fallback,binding:bindings[i]}));
`;
  const dictionarySource=JSON.stringify({padding:'fixture-padding-'.repeat(5000),10408:'发票ID',12045:'Excel导出',12046:'正在导出，请稍候！',10900:'到账日期',12043:'本次到账金额',12047:'基本工资',12048:'知识管理',11985:'开户银行'});
  await writeFile(path.join(projectRoot,'cn.json'),dictionarySource);
  await writeFile(path.join(projectRoot,'receipt.cjs'),receiptSource);
  await writeFile(path.join(projectRoot,'verify-receipt.cjs'),`const a=require('node:assert/strict'),r=require('./receipt.cjs');
a.deepEqual(r.fields.map(f=>f.label),['发票ID','已到账金额','剩余未到账金额','到账日期','本次到账金额','到账后剩余金额','开户银行']);
a.deepEqual(r.fields.map(f=>f.binding),['invoiceId','received','remaining','date','amount','after','bank']);
a.equal(r.dictionary[12045],'Excel导出');a.equal(r.dictionary[12048],'知识管理');
`);
  assert.notEqual(spawnSync(process.execPath,['verify-receipt.cjs'],{cwd:projectRoot,windowsHide:true}).status,0,'Negative control: wrong translation keys fail');
  const sourceOnly = await create('字段修改通过代码检查完成');
  const sourceResult = await settled(await start(sourceOnly,'FIELORA_AGENT_FIXTURE_GOAL_LIFECYCLE SOURCE_LABELS 调整到账确认 modal 字段翻译，保持接口和数据绑定不变'));
  await writeFile(path.join(evidence,'source-only-labels.json'),JSON.stringify(sourceResult,null,2));
  assert.equal(sourceResult.run.status,'COMPLETED',JSON.stringify(sourceResult.run));
  assert.equal(sourceResult.run.current_step,5);
  assert.equal(sourceResult.tools.find(t=>t.receipt?.kind==='JSON_READ').receipt.truncated,false);
  assert.equal(await readFile(path.join(projectRoot,'cn.json'),'utf8'),dictionarySource);
  assert.equal(sourceResult.tools.filter(t=>t.name==='replace_text'&&t.status==='COMPLETED').length,1);
  assert.ok(!sourceResult.tools.some(t=>t.name.startsWith('browser')));
  assert.equal(sourceResult.tools.find(t=>t.name==='run_command').receipt.success,true);
  assert.equal(sourceResult.events.find(e=>e.kind==='RUN_STARTED').payload.browser_verification_required,false);
  assert.equal(spawnSync(process.execPath,['verify-receipt.cjs'],{cwd:projectRoot,windowsHide:true}).status,0);

  // Successful UI writes and a passing command still do not prove the rendered result.
  await writeFile(path.join(projectRoot, 'settings.js'), base);
  const unchecked = await create('不能只凭构建完成弹窗');
  const uncheckedResult = await settled(await start(unchecked, 'FIELORA_AGENT_FIXTURE_GOAL_LIFECYCLE 调整 modal 字段，并执行浏览器验证'));
  assert.equal(uncheckedResult.run.status, 'PAUSED'); assert.equal(uncheckedResult.run.error_code, 'AGENT_VERIFICATION_REQUIRED');
  assert.ok(uncheckedResult.tools.some(t => t.name === 'run_command' && t.receipt.success));
  assert.ok(!uncheckedResult.tools.some(t => t.error_code === 'AGENT_WORK_PLAN_REQUIRED'));
  assert.ok(uncheckedResult.tools.some(t => t.name === 'replace_text' && t.status === 'COMPLETED'));
  assert.ok(!uncheckedResult.events.some(e => e.kind === 'RUN_COMPLETED'));
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(uncheckedResult.run.id)}})`);

  const images = await cdp.eval(`(async()=>{const result=[];for(let i=0;i<2;i++){const c=document.createElement('canvas');c.width=240;c.height=100;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,240,100);x.fillStyle='black';x.fillText(i?'已到账金额':'客户抬头',12,40);const data_url=c.toDataURL('image/png');result.push({id:'image-'+i,filename:'image-'+i+'.png',mime_type:'image/png',size:atob(data_url.split(',')[1]).length,width:240,height:100,source:'clipboard',data_url});}return result})()`);
  const inputConversation = await create('跨轮引用原图');
  const original = await settled(await start(inputConversation, 'FIELORA_AGENT_FIXTURE_INPUT_RETENTION 分析两张图片', images));
  assert.equal(original.run.status, 'PAUSED');
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(original.run.id)}})`);
  const previousPid = await cdp.eval('window.fielora.core.getHealth().then(h=>h.pid)');
  await cdp.eval('window.fieloraTest.killCore()');
  await wait(`window.fielora.core.getHealth().then(h=>h.state==='READY'&&h.pid!==${previousPid})`);
  const inherited = await settled(await start(inputConversation, 'FIELORA_AGENT_FIXTURE_INPUT_RETENTION 分析上面的图片'));
  assert.equal(inherited.run.status, 'PAUSED'); assert.equal(inherited.run.error_code, 'AGENT_TIME_BUDGET_EXHAUSTED');
  assert.equal(inherited.events.find(e => e.payload.kind === 'REFERENCED_INPUTS_RESTORED').payload.source_run_id, original.run.id);
  assert.equal(inherited.events.find(e => e.kind === 'MODEL_COMPLETED').payload.prompt.image_count, 2);
  await cdp.eval(`window.fielora.agent.cancel({run_id:${JSON.stringify(inherited.run.id)}})`);
  await writeFile(path.join(projectRoot, 'settings.js'), base);
  const searchRecovery = await create('重复搜索后的修复验证');
  const recovered = await settled(await start(searchRecovery, 'FIELORA_AGENT_FIXTURE_SEARCH_RECOVERY Fix settings.js configuration value and verify the existing node check.'));
  await writeFile(path.join(evidence, 'search-recovery.json'), JSON.stringify(recovered, null, 2));
  assert.equal(recovered.run.status, 'COMPLETED', JSON.stringify(recovered.run));
  assert.equal(recovered.run.current_step, 8);
  assert.equal(recovered.tools[0].receipt.match_mode, 'REGEX_FALLBACK');
  assert.equal(recovered.tools[0].receipt.matches, 1);
  assert.equal(recovered.tools.filter(t => t.name === 'read_file').length, 4, 'all repeated reads really executed');
  assert.ok(recovered.events.filter(e => e.payload.kind === 'GENERAL_DUPLICATE_OBSERVATIONS_REDUCED').reduce((n,e) => n+e.payload.exchanges,0)>=3);
  assert.equal(recovered.tools.filter(t => t.name === 'replace_text' && t.status === 'COMPLETED').length, 1);
  assert.equal(recovered.tools.find(t => t.name === 'run_command').receipt.success, true);
  assert.ok((await readFile(path.join(projectRoot, 'settings.js'), 'utf8')).includes("value = 'right'"));
  await show(searchRecovery); await wait("document.querySelector('[data-agent-state=COMPLETED]')");
  await captureScreenshot(cdp, path.join(evidence, 'search-recovery-completed.png'));
  await writeFile(path.join(evidence, 'validation.json'), JSON.stringify({ status: 'PASS', referenceSourceAccessAndCompletionCoverage: true, referenceProjectsRemainUnchanged: true, repeatedObservationsRecoverToVerifiedEdit: true, regexSearchAndDuplicateContextReduction: true, host: process.env.FIELORA_PACKAGED_EXE ? 'packaged' : 'development', focusedContinues25Steps: true, focusedContextReduction: true, qwenProfileHasBrowserAndVerificationTools: true, prematureCompletionRejected: true, failedCheckRepaired: true, fastHandoffSameRun: true, missingImagesStopBeforeModel: true, explicitBrowserRequestCannotBeSkipped: true, sourceLabelCheckCompletesWithoutBrowser: true, historicalImagesRestoredAcrossRunsAndRestart: true, explicitVerificationResumeRenewsAllowance: true, resumeContextDeduplicated: true, externalModelRequests: 0, productionTransactions: 0 }, null, 2));
  console.log(`PASS Agent goal lifecycle: ${evidence}`);
} catch (error) {
  console.error(error, output.slice(-4).join('')); process.exitCode = 1;
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(() => {});
} finally {
  await writeFile(path.join(evidence, 'electron.log'), output.join('')).catch(() => {});
  cdp?.close(); await cleanupElectronProcess(child);
  if (ids?.provider) spawnSync('cmdkey.exe', [`/delete:Fielora/provider/${ids.provider.id}`], { windowsHide: true, stdio: 'ignore' });
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
}
