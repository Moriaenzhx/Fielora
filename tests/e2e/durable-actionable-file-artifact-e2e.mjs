import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cleanupElectronProcess,
  captureScreenshot,
  connectToFieloraApp,
  launchElectron,
  waitForChildExit,
  waitForExpression,
} from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-durable-file-artifact-'));
const projectRoot = path.join(dataRoot, 'project');
const configPath = path.join(projectRoot, 'src', 'config.js');
const before = 'export const columns = {\n  name: true,\n  stage: true,\n  status: true,\n};\n';
const after = 'export const columns = {\n  name: true,\n  status: true,\n};\n';
const output = [];
let child;
let cdp;

async function pollValue(expression, predicate, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await cdp.eval(expression);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`poll timeout: ${expression}\n${output.join('')}`);
}

async function openApp() {
  const launched = await launchElectron({ root, dataRoot, output, executablePath: process.env.FIELORA_PACKAGED_EXE });
  child = launched.child;
  cdp = await connectToFieloraApp({ ...launched, enablePage: true });
  await waitForExpression(cdp, `document.querySelector('[data-testid="project-workspace"]') && window.fieloraTest`, { timeoutMs: 60_000, output });
}

async function quitApp() {
  await cdp.eval('void window.fielora.core.quit()');
  cdp.close();
  await Promise.race([
    waitForChildExit(child),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Fielora quit timeout')), 10_000)),
  ]);
  child = undefined;
  cdp = undefined;
}

async function reloadConversation(conversationId) {
  await cdp.eval('window.__reviewReload=true');
  await cdp.send('Page.reload');
  await waitForExpression(cdp, `typeof window.__reviewReload==='undefined' && window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')`, { timeoutMs: 60_000, output });
  await waitForExpression(cdp, `document.querySelector('[data-testid="conversation-${conversationId}"]')`, { timeoutMs: 60_000, output });
  await cdp.eval(`document.querySelector('[data-testid="conversation-${conversationId}"]').click()`);
}

async function openRunReview(runId) {
  const selector = `[data-agent-run-id="${runId}"] [data-review-path="src/config.js"]`;
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})`, { timeoutMs: 30_000, output });
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await waitForExpression(cdp, `document.querySelector('[data-testid="agent-review"]')?.innerText.includes('config.js')`, { timeoutMs: 30_000, output });
}

try {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, before);
  assert.equal(spawnSync('git', ['init'], { cwd: projectRoot, windowsHide: true, stdio: 'ignore' }).status, 0);
  await openApp();
  assert.equal((await cdp.eval('window.fielora.core.getHealth()')).schema_version, 16);

  const setup = await cdp.eval(`(async()=>{
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Durable File Fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture__',custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'durable-file-fixture-secret'});
    const project=await window.fieloraTest.createProject({title:'Durable File Artifact Project',goal:null,root_path:${JSON.stringify(projectRoot)}});
    const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'Durable file review',provider_config_id:provider.id,model_id:'__fielora_agent_fixture__'});
    localStorage.setItem('fielora:conversation-permission:'+conversation.id,'FULL_CONTROL');
    const task='FIELORA_AGENT_FIXTURE_FAST_EDIT 删除列表中的 stage 字段配置';
    const message=await window.fielora.conversation.createMessage({conversation_id:conversation.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const run=await window.fielora.agent.start({field_id:project.field_id,conversation_id:conversation.id,user_message_id:message.id,provider_config_id:provider.id,model_id:provider.default_model,task,permission:'FULL_CONTROL',max_steps:20,attachments:[]});
    return {fieldId:project.field_id,conversationId:conversation.id,runId:run.id};
  })()`);
  await reloadConversation(setup.conversationId);

  const runId = setup.runId;
  let terminal = await pollValue(
    `window.fielora.agent.get({run_id:${JSON.stringify(runId)}}).then((run)=>run.status)`,
    (value) => ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_APPROVAL'].includes(value),
  );
  if (terminal === 'WAITING_APPROVAL') {
    await waitForExpression(cdp, `document.querySelector('[data-agent-run-id="${runId}"] [data-testid="agent-approval"]')`, { timeoutMs: 30_000, output });
    await cdp.eval(`document.querySelector('[data-agent-run-id="${runId}"] [data-testid="agent-allow-once"]')?.click()`);
    terminal = await pollValue(
      `window.fielora.agent.get({run_id:${JSON.stringify(runId)}}).then((run)=>run.status)`,
      (value) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(value),
    );
  }
  if (terminal !== 'COMPLETED') {
    const diagnostic = await cdp.eval(`Promise.all([window.fielora.agent.get({run_id:${JSON.stringify(runId)}}),window.fielora.agent.toolCalls({run_id:${JSON.stringify(runId)}})])`);
    throw new Error(`fixture run ended as ${terminal}: ${JSON.stringify(diagnostic)}`);
  }
  assert.equal(await readFile(configPath, 'utf8'), after);

  const durable = await cdp.eval(`window.fielora.artifact.listFileReviews({run_id:${JSON.stringify(runId)}})`);
  assert.equal(durable.revisions.length, 1);
  const revision = durable.revisions[0];
  assert.equal(revision.operation, 'MODIFY');
  assert.equal(revision.before_text, before);
  assert.equal(revision.after_text, after);
  assert.equal(revision.review_state, 'UNREVIEWED');
  assert.equal(revision.applicability, 'CURRENT');
  assert.equal(revision.undo_availability, 'AVAILABLE');
  assert.equal(revision.verifications.length, 1);
  assert.equal(revision.verifications[0].outcome, 'PASS');
  assert.equal(revision.verifications[0].subject.kind, 'ARTIFACT_REVISION');
  assert.equal(revision.verifications[0].subject.artifact_id, revision.artifact_id);
  assert.equal(revision.verifications[0].subject.revision_id, revision.revision_id);
  assert.equal((await cdp.eval(`window.fielora.artifact.list({cursor:null,limit:100,include_archived:true})`)).artifacts.length, 0);

  await openRunReview(runId);
  await waitForExpression(cdp, `document.querySelector('.human-diff-row.is-remove')`, { timeoutMs: 30_000, output });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1478, height: 859, deviceScaleFactor: 1, mobile: false });
  assert.equal(await cdp.eval(`document.querySelector('.human-diff-row.is-remove .human-diff-line-number').textContent`), '3');
  assert.equal(await cdp.eval(`document.querySelector('.human-diff-row.is-remove code').textContent`), '  stage: true,');
  assert.equal(await cdp.eval(`['agent-review-mark-reviewed','agent-review-undo'].every(id=>document.querySelector('[data-testid="'+id+'"]').classList.contains('ui-button'))`), true);
  if (process.env.FIELORA_E2E_EVIDENCE_DIR) await captureScreenshot(cdp, path.join(process.env.FIELORA_E2E_EVIDENCE_DIR, 'review-light.png'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  assert.equal(await cdp.eval(`(()=>{const e=document.querySelector('[data-testid="agent-review"]');return e.scrollWidth<=e.clientWidth+1})()`), true);
  if (process.env.FIELORA_E2E_EVIDENCE_DIR) await captureScreenshot(cdp, path.join(process.env.FIELORA_E2E_EVIDENCE_DIR, 'review-narrow.png'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1478, height: 859, deviceScaleFactor: 1, mobile: false });
  await cdp.eval(`document.querySelector('[data-testid="agent-review-raw"]')?.click()`);
  await waitForExpression(cdp, `document.querySelector('[data-testid="agent-review-diff"]')`, { timeoutMs: 30_000, output });
  assert.match(await cdp.eval(`document.querySelector('[data-testid="agent-review-diff"]').innerText`), /-  stage: true,/u);
  await cdp.eval(`document.querySelector('[data-testid="agent-review-mark-reviewed"]').click()`);
  await pollValue(
    `window.fielora.artifact.listFileReviews({run_id:${JSON.stringify(runId)}}).then((value)=>value.revisions[0]?.review_state)`,
    (value) => value === 'REVIEWED',
  );

  await writeFile(configPath, 'newer human work\n');
  await reloadConversation(setup.conversationId);
  await openRunReview(runId);
  await waitForExpression(cdp, `document.querySelector('[data-testid="agent-review-stale"]') && document.querySelector('[data-testid="agent-review-undo-blocked"]') && !document.querySelector('[data-testid="agent-review-undo"]')`, { timeoutMs: 30_000, output });
  const blocked = await cdp.eval(`window.fielora.artifact.undoFileRevision({source_run_id:${JSON.stringify(runId)},artifact_id:${JSON.stringify(revision.artifact_id)},revision_id:${JSON.stringify(revision.revision_id)}}).then(()=>null,(error)=>String(error))`);
  assert.match(blocked, /FILE_ARTIFACT_UNDO_CHANGED_SINCE/u);
  assert.equal(await readFile(configPath, 'utf8'), 'newer human work\n');

  await writeFile(configPath, after);
  await reloadConversation(setup.conversationId);
  await openRunReview(runId);
  await waitForExpression(cdp, `document.querySelector('[data-testid="agent-review-undo"]')`, { timeoutMs: 30_000, output });
  await cdp.eval(`document.querySelector('[data-testid="agent-review-undo"]').click()`);
  const undoRun = await pollValue(
    `window.fielora.agent.list({conversation_id:${JSON.stringify(setup.conversationId)}}).then((runs)=>runs.find((run)=>run.id!==${JSON.stringify(runId)}&&run.task==='[HUMAN_COMMAND FILE_ARTIFACT_UNDO]')??null)`,
    (value) => value?.status === 'COMPLETED',
  );
  assert.equal(await readFile(configPath, 'utf8'), before);
  const undoRevisions = await cdp.eval(`window.fielora.artifact.listFileReviews({run_id:${JSON.stringify(undoRun.id)}})`);
  assert.equal(undoRevisions.revisions.length, 1);
  assert.equal(undoRevisions.revisions[0].artifact_id, revision.artifact_id);
  assert.equal(undoRevisions.revisions[0].operation, 'RESTORE');
  assert.equal(undoRevisions.revisions[0].sequence, 2);
  assert.equal(undoRevisions.revisions[0].applicability, 'CURRENT');
  assert.equal(undoRevisions.revisions[0].verifications.length, 0);

  await quitApp();
  await openApp();
  const afterRestart = await cdp.eval(`Promise.all([
    window.fielora.artifact.listFileReviews({run_id:${JSON.stringify(runId)}}),
    window.fielora.artifact.listFileReviews({run_id:${JSON.stringify(undoRun.id)}})
  ])`);
  assert.equal(afterRestart[0].revisions[0].review_state, 'REVIEWED');
  assert.equal(afterRestart[0].revisions[0].before_text, before);
  assert.equal(afterRestart[0].revisions[0].after_text, after);
  assert.equal(afterRestart[0].revisions[0].applicability, 'CHANGED_SINCE');
  assert.equal(afterRestart[1].revisions[0].applicability, 'CURRENT');

  await quitApp();
  console.log('Durable actionable file Artifact E2E: PASS');
} finally {
  if (cdp) cdp.close();
  await cleanupElectronProcess(child);
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(dataRoot, { recursive: true, force: true });
}
