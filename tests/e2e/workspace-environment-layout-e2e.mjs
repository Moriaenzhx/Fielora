import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

// Real Git status, native window resizing and pointer input. No provider calls
// or production projects; this exercises the mounted desktop, not mocked DOM.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-environment-ui-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-environment-evidence-'));
const output = [], metrics = [];
let child, cdp;
const wait = expression => waitForExpression(cdp, expression, { output });
const paint = () => cdp.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const click = async id => { await wait(`document.querySelector('[data-testid="${id}"]')`); await cdp.eval(`document.querySelector('[data-testid="${id}"]').click()`); await paint(); };
const resize = async width => {
  await cdp.eval(`window.fieloraTest.resizeWindow({width:${width},height:860})`);
  await wait(`innerWidth === ${width}`);
  await wait('!document.querySelector("[data-workspace-motion=true]")');
  await paint();
};
try {
  const projectRoot = path.join(dataRoot, 'project');
  const cleanRoot = path.join(dataRoot, 'clean-project');
  await mkdir(projectRoot); await mkdir(cleanRoot); await mkdir(evidence, { recursive: true });
  const git = args => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
  git(['init', '-b', 'feature/studio-delivery']);
  await writeFile(path.join(projectRoot, 'README.md'), '# 工作室项目\n');
  git(['add', 'README.md']);
  git(['-c', 'user.name=UI Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  await writeFile(path.join(projectRoot, 'README.md'), '# 工作室项目\n已完成项目与回款管理。\n');
  await writeFile(path.join(projectRoot, 'app.py'), 'print("fixture")\n');
  const launch = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = launch.child;
  cdp = await connectToFieloraApp({ port: launch.port, output, enablePage: true, timeoutMs: 120000 });
  await wait('window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==="READY")');
  const ids = await cdp.eval(`(async()=>{
    const p=await window.fieloraTest.createProject({title:'工作室管理器',goal:null,root_path:${JSON.stringify(projectRoot)}});
    const clean=await window.fieloraTest.createProject({title:'空白项目',goal:null,root_path:${JSON.stringify(cleanRoot)}});
    const c=await window.fielora.conversation.create({field_id:p.field_id,title:'工作室项目与回款管理器：检查交付成果与项目变更',provider_config_id:null,model_id:null});
    await window.fielora.conversation.createMessage({conversation_id:c.id,role:'ASSISTANT',content:'已完成工作室项目与回款管理器。\\n\\n可以在这里查看项目变更，继续审阅文件或打开终端。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {project:p.field_id,clean:clean.field_id,conversation:c.id};
  })()`);
  await cdp.send('Page.reload');
  await wait('document.querySelector(".conversation-heading h2")?.textContent.includes("工作室项目与回款管理器")');
  await resize(1600);
  await wait('document.querySelector("[data-testid=environment-panel]")?.textContent.includes("2 个文件")');
  assert.match(await cdp.eval('document.querySelector("[data-testid=environment-panel]").textContent'), /feature\/studio-delivery/);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=environment-summary]").textContent.includes("2 个变更")'), true);
  const layout = await cdp.eval(`(()=>{
    const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
    return {title:box('.conversation-title-line'),controls:box('[data-testid=project-context-controls]'),panel:box('[data-testid=environment-panel]'),messages:box('.message-list'),composer:box('[data-testid=conversation-composer]'),overflow:document.documentElement.scrollWidth>innerWidth};
  })()`);
  assert.ok(layout.title.right <= layout.controls.left, 'Title and toolbar must not overlap');
  assert.ok(layout.messages.right <= layout.panel.left, 'Changes must occupy their own reading gutter');
  assert.ok(layout.composer.right <= layout.panel.left, 'Composer must not extend below the changes panel');
  assert.equal(layout.overflow, false); metrics.push({ width:1600, ...layout });
  // Cross group boundaries, move away and clear focus: controls stay visible.
  for (const id of ['environment-menu-toggle', 'rail-terminal', 'chrome-tools', null]) {
    const point = id ? await cdp.eval(`(()=>{const r=document.querySelector('[data-testid="${id}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) : {x:600,y:400};
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
    await cdp.eval('document.activeElement?.blur()'); await paint();
    assert.deepEqual(await cdp.eval(`[...document.querySelectorAll('.project-context-controls,.utility-control-dock')].map(e=>getComputedStyle(e).opacity)`), ['1','1']);
  }
  await captureScreenshot(cdp,path.join(evidence,'wide-changes.png'));
  await click('environment-menu-toggle'); await wait('!document.querySelector("[data-testid=environment-panel]")');
  await click('environment-menu-toggle'); await wait('document.querySelector("[data-testid=environment-panel]")');
  await resize(1240);
  await wait('document.querySelector("[data-testid=environment-summary]") && !document.querySelector("[data-testid=environment-panel]")');
  await captureScreenshot(cdp,path.join(evidence,'header-summary.png'));
  await click('environment-changes-summary');
  await wait('document.querySelector("[data-testid=terminal-output]")?.textContent.includes("README.md") && document.querySelector("[data-testid=terminal-output]")?.textContent.includes("app.py")');
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=environment-popover]"))'),false,'Git changes must open status directly, not the environment menu');
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=agent-review]"))'),false,'Git-only changes must not open an empty task review');
  await captureScreenshot(cdp,path.join(evidence,'git-changes-direct.png'));
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:close-workspace-dock"))');
  await wait('!document.querySelector(".project-layout.workspace-open")');
  await resize(920);
  await wait('!document.querySelector("[data-testid=environment-summary]") && !document.querySelector("[data-testid=environment-panel]")');
  await click('environment-menu-toggle'); await wait('document.querySelector("[data-testid=environment-popover]")');
  assert.match(await cdp.eval('document.querySelector("[data-testid=environment-popover]").textContent'), /2 个文件/);
  await captureScreenshot(cdp,path.join(evidence,'narrow-menu.png'));
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('!document.querySelector("[data-testid=environment-popover]")');
  assert.equal(await cdp.eval('document.activeElement.dataset.testid'),'environment-menu-toggle');
  await resize(1600);
  await click('chrome-tools');
  await wait('document.querySelector(".project-layout.workspace-open") && !document.querySelector("[data-testid=environment-panel]")');
  await wait('!document.querySelector("[data-workspace-motion=true]")');
  await click('rail-focus'); await wait('document.body.dataset.workspaceDockFocus === "true"');
  assert.equal(await cdp.eval('getComputedStyle(document.querySelector("[data-testid=utility-rail]")).opacity'), '1');
  await click('rail-focus'); await click('chrome-tools');
  await wait('document.querySelector("[data-testid=environment-panel]")');
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:open-settings",{detail:"GENERAL"}))');
  await wait('document.querySelector("[data-testid=settings-back]")');
  await wait('document.querySelector("[data-testid=project-context-controls]")?.hidden');
  await click('settings-back'); await wait('document.querySelector("[data-testid=environment-panel]")');
  // External edits refresh on focus, including a dirty-to-clean transition.
  await rm(path.join(projectRoot, 'app.py')); git(['restore', 'README.md']);
  await cdp.eval('window.dispatchEvent(new Event("focus"))');
  await wait('!document.querySelector("[data-testid=environment-panel]") && !document.querySelector("[data-testid=environment-summary]")');
  await click('environment-menu-toggle'); await wait('document.querySelector("[data-testid=environment-popover]")?.textContent.includes("0 个文件")');
  await click(`project-${ids.clean}`);
  await wait('document.querySelector("[data-testid=project-empty-conversation]")?.textContent.includes("空白项目")');
  await click('environment-menu-toggle');
  await wait('document.querySelector("[data-testid=environment-popover]")?.textContent.includes("此文件夹未使用 Git")');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=environment-popover]").textContent.includes("feature/studio-delivery")'),false);
  await writeFile(path.join(evidence,'metrics.json'),JSON.stringify({status:'PASS',metrics,verified:['real Git changes','Git-only changes opens terminal status directly','wide automatic panel','medium summary','narrow menu','no toolbar/title/content overlap','pointer stability','dock/focus routing','settings return','external refresh','clean and non-Git states']},null,2));
  console.log('WORKSPACE_ENVIRONMENT_LAYOUT=PASS evidence='+evidence);
} catch(error) {
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-2500));throw error;
} finally {
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();}
  if(child)await cleanupElectronProcess(child);
  await rm(dataRoot,{recursive:true,force:true});
}
