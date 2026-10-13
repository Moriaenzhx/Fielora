import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureScreenshot,
  cleanupElectronProcess,
  connectToFieloraApp,
  launchElectron,
  waitForChildExit,
  waitForExpression,
} from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-settings-extensions-'));
const projectRoot = path.join(dataRoot, 'project');
const pluginRoot = path.join(dataRoot, 'declarative-plugin');
const configRoot = path.join(dataRoot, 'Fielora', 'config');
const evidenceRoot = path.join(root, 'artifacts', 'settings-capability-extensions');
const output = [];
let child;

const wait = (cdp, expression, timeout = 30_000) => waitForExpression(cdp, expression, { timeoutMs: timeout, output });
const click = (cdp, selector) => cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
const screenshot = (cdp, name) => captureScreenshot(cdp, path.join(evidenceRoot, name));

async function pollValue(cdp, expression, predicate, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await cdp.eval(expression);
      if (predicate(value)) return value;
    } catch {
      // Core startup may briefly reject requests before the sidecar is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`poll timeout: ${expression}\n${output.join('')}`);
}

try {
  await Promise.all([
    mkdir(path.join(projectRoot, '.agents', 'skills', 'project-settings-skill'), { recursive: true }),
    mkdir(path.join(pluginRoot, 'skills', 'plugin-settings-skill'), { recursive: true }),
    mkdir(configRoot, { recursive: true }),
    mkdir(evidenceRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(projectRoot, '.agents', 'skills', 'project-settings-skill', 'SKILL.md'), '---\nname: project-settings-skill\ndescription: Project Skill settings fixture.\n---\nPROJECT_SKILL_BODY_STAYS_LAZY\n'),
    writeFile(path.join(pluginRoot, 'fielora.json'), `${JSON.stringify({ id: 'fixture.settings-plugin', name: 'Settings Declarative Plugin', version: '1.0.0', publisher: 'fixture', engines: { fielora: '>=0.1' }, contributes: { skills: ['skills/plugin-settings-skill'] } }, null, 2)}\n`),
    writeFile(path.join(pluginRoot, 'skills', 'plugin-settings-skill', 'SKILL.md'), '---\nname: plugin-settings-skill\ndescription: Plugin Skill settings fixture.\n---\nPLUGIN_SKILL_BODY_STAYS_LAZY\n'),
    writeFile(path.join(configRoot, 'mcp.json'), `${JSON.stringify({ mcpServers: { 'local-settings': { command: process.execPath, args: ['--version'] } } }, null, 2)}\n`),
  ]);

  const launched = await launchElectron({ root, dataRoot, output });
  child = launched.child;
  const cdp = await connectToFieloraApp({ ...launched, enablePage: true });
  await pollValue(cdp, `window.fielora.core.getHealth().then((health)=>health.state)`, (state) => state === 'READY', 60_000);
  await cdp.eval(`window.fieloraTest.resizeWindow({width:1600,height:1000})`);
  const project = await cdp.eval(`window.fieloraTest.createProject({title:'能力设置验证',goal:null,root_path:${JSON.stringify(projectRoot)}})`);
  await cdp.eval('location.reload()');
  await wait(cdp, `document.querySelector('[data-testid="project-${project.field_id}"]')`, 60_000);
  await click(cdp, '[data-testid="settings-nav"]');
  await wait(cdp, `document.querySelector('[data-testid="settings-general"]')`);

  const navigation = await cdp.eval(`(()=>{const nav=document.querySelector('.settings-navigation nav');return{labels:[...nav.querySelectorAll(':scope > button span')].map((item)=>item.textContent),icons:[...nav.querySelectorAll(':scope > button .shell-icon')].map((item)=>item.dataset.icon),groupHeadings:nav.querySelectorAll('h2,.settings-nav-group').length}})()`);
  assert.deepEqual(navigation.labels, ['常规', '外观', '模型与服务', '能力与扩展', '存储与数据', '键盘快捷键', '关于']);
  assert.deepEqual(navigation.icons, ['settings', 'appearance', 'models', 'extensions', 'storage', 'keyboard', 'info']);
  assert.equal(navigation.groupHeadings, 0);

  await click(cdp, '[data-testid="settings-category-extensions"]');
  await wait(cdp, `document.querySelector('[data-testid="settings-capability-extensions"]')`);
  assert.equal(await cdp.eval(`document.querySelectorAll('[role="tablist"] [role="tab"]').length`), 4);
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="settings-capability-extensions"] > header').innerText`), '能力与扩展');

  await click(cdp, '[data-testid="settings-extension-tab-plugins"]');
  await wait(cdp, `document.querySelector('[data-testid="settings-plugins"]')`);
  await cdp.eval(`(()=>{const input=document.querySelector('[data-testid="plugin-root-input"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,${JSON.stringify(pluginRoot)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click(cdp, '[data-testid="plugin-register-local"]');
  await wait(cdp, `document.querySelector('[data-plugin-status="AVAILABLE"]')`);
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="settings-extension-tab-plugins"]').getAttribute('aria-selected')`), 'true');
  await screenshot(cdp, '03-plugins-tab.png');

  await click(cdp, '[data-testid="settings-extension-tab-skills"]');
  await wait(cdp, `document.querySelector('[data-testid="settings-skill-project-settings-skill"]')&&document.querySelector('[data-testid="settings-skill-plugin-settings-skill"]')`);
  assert.equal(await cdp.eval(`document.body.innerHTML.includes('PROJECT_SKILL_BODY_STAYS_LAZY')||document.body.innerHTML.includes('PLUGIN_SKILL_BODY_STAYS_LAZY')`), false);
  assert.equal(await cdp.eval(`document.querySelectorAll('#settings-extension-panel > .settings-extension-pane').length`), 1);
  await screenshot(cdp, '01-skills-tab.png');

  await click(cdp, '[data-testid="settings-extension-tab-mcp"]');
  await wait(cdp, `document.querySelector('[data-testid="mcp-connection-local-settings"]')`);
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="settings-extension-tab-mcp"]').getAttribute('aria-selected')`), 'true');
  await screenshot(cdp, '02-mcp-tab.png');

  await cdp.eval('void window.fielora.core.quit()');
  cdp.close();
  await waitForChildExit(child);
  console.log(`settings capability extensions e2e: PASS\nEVIDENCE: ${evidenceRoot}\nMODEL_REQUESTS: 0\nPUBLIC_NETWORK_REQUESTS: 0`);
} finally {
  await cleanupElectronProcess(child);
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
