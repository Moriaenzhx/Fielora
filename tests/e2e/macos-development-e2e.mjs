import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { packagedApplication, deleteTestCredential } from '../support/platform.mjs';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess, waitForChildExit } from './harness/electron-cdp-harness.mjs';

assert.equal(process.platform, 'darwin', 'This acceptance test targets macOS');
const root = path.resolve(import.meta.dirname, '../..');
const mode = process.argv[2] ?? 'dev';
assert.ok(['dev', 'packaged'].includes(mode));
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-macos-development-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-macos-evidence-'));
await mkdir(projectRoot);
execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
await mkdir(evidence, { recursive: true });
let launched, cdp, providerId;
async function launch() {
  launched = await launchElectron({ root, dataRoot, executablePath: mode === 'packaged' ? packagedApplication(root) : '' });
  cdp = await connectToFieloraApp(launched);
  await waitForExpression(cdp, `window.fielora.core.getHealth().then(health=>health.state==='READY')`, { output: launched.output });
  await waitForExpression(cdp, `document.querySelector('[data-testid="chrome-sidebar-toggle"]')`, { output: launched.output });
}
async function quit() {
  await cdp.eval('void window.fielora.core.quit()');
  cdp.close();
  assert.equal(await Promise.race([waitForChildExit(launched.child), new Promise((_, reject) => setTimeout(() => reject(new Error('Quit timed out')), 10000))]), 0);
}
async function commandKey(key, code, virtualKey) {
  for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey, modifiers: 4 });
}
try {
  await launch();
  const chrome = await cdp.eval(`(()=>{const button=document.querySelector('[data-testid="chrome-sidebar-toggle"]');return{platform:document.documentElement.dataset.platform,left:button.getBoundingClientRect().left,title:button.title}})()`);
  assert.equal(chrome.platform, 'macos');
  assert.ok(chrome.left >= 84);
  assert.match(chrome.title, /⌘B/);
  await commandKey('b', 'KeyB', 66);
  await waitForExpression(cdp, `document.body.dataset.sidebarCollapsed==='true'`);
  await commandKey('b', 'KeyB', 66);
  await waitForExpression(cdp, `document.body.dataset.sidebarCollapsed==='false'`);
  const identity = await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'macOS synthetic fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:${JSON.stringify(`mac-fixture-${randomUUID()}`)}});const project=await window.fieloraTest.createProject({title:'Mac development acceptance',root_path:${JSON.stringify(projectRoot)},goal:null});const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'Mac native workflow',provider_config_id:provider.id,model_id:provider.default_model});return{provider,project,conversation};})()`);
  providerId = identity.provider.id;
  const targets = await cdp.eval(`window.fielora.workspace.getOpenTargets({field_id:${JSON.stringify(identity.project.field_id)}})`);
  assert.equal(targets.find(target => target.target === 'FILE_EXPLORER')?.label, 'Finder');
  const user = await cdp.eval(`window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(identity.conversation.id)},role:'USER',content:'FIELORA_AGENT_FIXTURE_CREATE',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null})`);
  const run = await cdp.eval(`window.fielora.agent.start({user_message_id:${JSON.stringify(user.id)},field_id:${JSON.stringify(identity.project.field_id)},conversation_id:${JSON.stringify(identity.conversation.id)},provider_config_id:${JSON.stringify(providerId)},model_id:'__fielora_agent_fixture__',task:'FIELORA_AGENT_FIXTURE_CREATE',permission:'FULL_CONTROL',max_steps:16})`);
  await waitForExpression(cdp, `window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(run=>['COMPLETED','FAILED','PAUSED'].includes(run.status))`, { timeoutMs: 60000 });
  const finished = await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}})`);
  assert.equal(finished.status, 'COMPLETED', JSON.stringify(finished));
  const tools = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(run.id)}})`);
  assert.ok(tools.some(tool => tool.name === 'run_command' && tool.status === 'COMPLETED'));
  await cdp.eval(`window.__macTerminal=[];window.fielora.workspace.subscribe(event=>window.__macTerminal.push(event))`);
  const terminal = await cdp.eval(`window.fielora.workspace.runTerminal({field_id:${JSON.stringify(identity.project.field_id)},working_directory:${JSON.stringify(projectRoot)},command:"node --version && printf 'MAC_TERMINAL_OK\\n'"})`);
  await waitForExpression(cdp, `window.__macTerminal.some(event=>event.run_id===${JSON.stringify(terminal.run_id)}&&['COMPLETED','FAILED'].includes(event.kind))`);
  const terminalEvents = await cdp.eval('window.__macTerminal');
  assert.equal(terminalEvents.at(-1).kind, 'COMPLETED');
  assert.match(terminalEvents.map(event => event.text ?? '').join(''), /MAC_TERMINAL_OK/);
  await commandKey(',', 'Comma', 188);
  await waitForExpression(cdp, `document.querySelector('[data-testid="settings-screen"]')`);
  await captureScreenshot(cdp, path.join(evidence, `${mode}-macos-settings.png`));
  await quit();
  await launch();
  const restored = await cdp.eval(`(async()=>({projects:await window.fielora.project.list(),provider:await window.fielora.provider.get({provider_config_id:${JSON.stringify(providerId)}}),run:await window.fielora.agent.get({run_id:${JSON.stringify(run.id)}})}))()`);
  assert.ok(restored.projects.some(project => project.id === identity.project.id));
  assert.equal(restored.provider.lifecycle_status, 'ACTIVE');
  assert.equal(restored.run.status, 'COMPLETED');
  await captureScreenshot(cdp, path.join(evidence, `${mode}-macos-restarted.png`));
  await quit();
  await writeFile(path.join(evidence, `${mode}-MACOS_ACCEPTANCE.json`), JSON.stringify({ status: 'PASS', platform: process.platform, arch: process.arch, mode, external_model_requests: 0, checks: ['traffic-light-inset', 'command-sidebar', 'command-settings', 'keychain-backed-fixture', 'agent-file-command-verification', 'zsh-terminal-node', 'finder-target', 'persistent-project-provider-run', 'clean-quit-restart'] }, null, 2));
  console.log(`macOS development E2E (${mode}): PASS evidence=${evidence}`);
} finally {
  cdp?.close();
  await cleanupElectronProcess(launched?.child);
  if (providerId) deleteTestCredential(providerId);
  await rm(dataRoot, { recursive: true, force: true });
}
