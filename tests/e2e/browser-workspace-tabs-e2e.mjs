import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import {
  CdpConnection,
  captureScreenshot,
  cleanupElectronProcess,
  connectToFieloraApp,
  launchElectron,
  waitForChildExit,
  waitForExpression,
} from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-browser-workspace-tabs-'));
const evidenceRoot = process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts', 'browser-workspace-tabs-v01');
const output = [];
let child;
let web;
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><title>浏览器布局验证</title><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;font:16px system-ui;background:#fff;color:#252830}
    h1{font-size:24px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
    article{padding:20px;border:1px solid #ddd;border-radius:10px}button,input{font:inherit;padding:8px;max-width:100%}
    @media(max-width:700px){main{grid-template-columns:1fr}}
    </style></head><body><h1>工作区浏览</h1><p>页面随面板宽度自然排版，保持正常文字大小。</p><main>
    <article><h2>资料研究</h2><input aria-label="名称" value="保留编辑内容"></article>
    <article><h2>数据整理</h2><p>展开后使用整个可用宽度。</p></article>
    <article><h2>结果验证</h2><button onclick="this.textContent='点击成功'">验证交互</button></article>
    </main></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

const wait = (cdp, expression, timeoutMs = 30_000) => waitForExpression(cdp, expression, { timeoutMs, output });

try {
  await mkdir(evidenceRoot, { recursive: true });
  const launched = await launchElectron({
    root,
    dataRoot,
    output,
    executablePath: process.env.FIELORA_PACKAGED_APP ?? '',
  });
  child = launched.child;
  const cdp = await connectToFieloraApp({ ...launched, enablePage: true });
  await wait(cdp, `document.querySelector('[data-testid="project-workspace"]') && window.fieloraTest && window.fielora.core.getHealth().then((health)=>health.state==='READY')`, 60_000);

  const project = await cdp.eval(`window.fieloraTest.createProject({title:'Browser Workspace Tabs',goal:'Focused Browser tab verification',root_path:${JSON.stringify(root)}})`);
  await cdp.eval('location.reload()');
  await wait(cdp, `document.querySelector('[data-testid="project-${project.field_id}"]')`);
  await cdp.eval(`window.dispatchEvent(new CustomEvent('fielora:open-workspace',{detail:'BROWSER'}))`);
  await wait(cdp, `document.querySelector('[data-testid="right-dock-tab-browser"]') && document.querySelector('.right-dock-view-browser:not([hidden]) [data-testid="browser-address"]')`);

  assert.equal(await cdp.eval(`document.querySelector('.right-dock-view-browser:not([hidden]) .browser-page-strip')`), null, 'embedded Browser must not render a second page strip');
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="right-dock-tab-browser"]').closest('[data-testid="right-dock-tabs"]') !== null`), true, 'Browser Page must live in the Workspace Tab Strip');
  assert.equal(await cdp.eval(`document.querySelector('.right-dock-view-browser:not([hidden]) .browse-content').classList.contains('browser-tabs-in-workspace')`), true);

  const surfaceFinish = await cdp.eval(`(()=>{
    const conversation=document.querySelector('.conversation-column');
    const divider=document.querySelector('[data-testid="project-navigation-resizer"]');
    const dividerLine=divider.querySelector('span');
    const rect=divider.getBoundingClientRect();
    return{
      conversationRadius:Number.parseFloat(getComputedStyle(conversation).borderTopLeftRadius),
      divider:{x:rect.left+rect.width/2,y:rect.top+Math.min(180,rect.height/2)},
      dividerOpacity:Number.parseFloat(getComputedStyle(dividerLine).opacity),
    };
  })()`);
  // The current Conversation contract uses the compact 16px corner, while
  // Settings/Scheduled retain the larger Work Surface radius.
  assert.equal(surfaceFinish.conversationRadius, 16, JSON.stringify(surfaceFinish));
  assert.equal(surfaceFinish.dividerOpacity, 0, JSON.stringify(surfaceFinish));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: surfaceFinish.divider.x, y: surfaceFinish.divider.y });
  await wait(cdp, `(()=>{const opacity=Number.parseFloat(getComputedStyle(document.querySelector('[data-testid="project-navigation-resizer"] span')).opacity);return opacity>=.35&&opacity<=.4;})()`);
  const hoveredDivider = await cdp.eval(`(()=>{const style=getComputedStyle(document.querySelector('[data-testid="project-navigation-resizer"] span'));return{opacity:Number.parseFloat(style.opacity),width:style.width};})()`);
  assert.ok(hoveredDivider.opacity <= .4, JSON.stringify(hoveredDivider));
  assert.equal(hoveredDivider.width, '1px');
  await captureScreenshot(cdp, path.join(evidenceRoot, '02-conversation-radius-subtle-divider.png'));

  let baseline = await cdp.eval(`window.fielora.browser.getState()`);
  if (!baseline.active_page_id) {
    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',ctrlKey:true,bubbles:true}))`);
    await wait(cdp, `window.fielora.browser.getState().then((state)=>state.pages.length===1)`);
    baseline = await cdp.eval(`window.fielora.browser.getState()`);
  }
  const baselinePageCount = baseline.pages.length;
  const firstPageId = baseline.active_page_id;
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',ctrlKey:true,bubbles:true}))`);
  await wait(cdp, `window.fielora.browser.getState().then((state)=>state.pages.length===${baselinePageCount + 1})`);
  const secondPageId = await cdp.eval(`window.fielora.browser.getState().then((state)=>state.active_page_id)`);
  assert.notEqual(secondPageId, firstPageId);
  const workspaceTabs = await cdp.eval(`[...document.querySelectorAll('[data-testid="right-dock-tabs"] .browser-workspace-page')].map((tab)=>({id:tab.dataset.tabId,label:tab.innerText,active:tab.classList.contains('active')}))`);
  assert.equal(workspaceTabs.length, baselinePageCount + 1, JSON.stringify(workspaceTabs));
  const activeTabIndicator = await cdp.eval(`getComputedStyle(document.querySelector('[data-testid="right-dock-tabs"] .browser-workspace-page.active'),'::after').content`);
  assert.equal(activeTabIndicator, 'none', 'active workspace tabs must not render a blue/purple underline');

  await cdp.eval(`document.querySelector('[data-tab-id="browser:${firstPageId}"] .right-dock-tab-main').click()`);
  await wait(cdp, `window.fielora.browser.getState().then((state)=>state.active_page_id===${JSON.stringify(firstPageId)})`);
  await cdp.eval(`document.querySelector('[data-testid="browser-close-page-${secondPageId}"]').click()`);
  await wait(cdp, `window.fielora.browser.getState().then((state)=>state.pages.length===${baselinePageCount}&&state.pages.every((page)=>page.id!==${JSON.stringify(secondPageId)}))`);

  await cdp.eval(`window.fielora.browser.navigate({url:${JSON.stringify(fixtureUrl)}})`);
  await wait(cdp, `window.fielora.browser.getState().then(s=>!s.is_loading&&s.title==='浏览器布局验证'&&s.surface.visible)`);
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="right-dock-tab-browser"] [data-icon="browse"]')!==null`), true, 'Browser workspace tabs carry a recognizable globe');
  const targets = await (await fetch(`http://127.0.0.1:${launched.port}/json/list`)).json();
  web = new CdpConnection(targets.find(t => t.url === fixtureUrl).webSocketDebuggerUrl);
  await web.open();
  const widths = [1180, 1440];
  for (const width of widths) {
    await cdp.eval(`window.fieloraTest.resizeWindow({width:${width},height:850})`);
    for (const expanded of [false, true, false]) {
      if (await cdp.eval(`document.body.dataset.workspaceDockFocus==='true'`) !== expanded) {
        await cdp.eval(`document.querySelector('[data-testid="rail-focus"]').click()`);
      }
      await wait(cdp, `!document.querySelector('[data-testid="project-workspace-surface"]').dataset.workspaceMotion`);
      await wait(cdp, `window.fielora.browser.getState().then(s=>{const r=document.querySelector('[data-testid="browse-viewport"]').getBoundingClientRect();return s.surface.visible&&Math.abs(s.surface.bounds.width-r.width)<2&&Math.abs(s.surface.bounds.x-r.x)<2})`);
      const state = await cdp.eval('window.fielora.browser.getState()');
      await waitForExpression(web, `Math.abs(innerWidth-${state.surface.bounds.width})<2&&Math.abs(innerHeight-${state.surface.bounds.height})<2`, { output });
      const geometry = await cdp.eval(`(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();return{toolbar:rect('.browser-toolbar'),address:rect('[data-testid="browser-address"]'),menu:rect('[data-testid="browser-overflow"]'),title:rect('.page-title')}})()`);
      assert.ok(geometry.address.width >= geometry.toolbar.width - 160, JSON.stringify(geometry));
      assert.ok(geometry.menu.right <= geometry.toolbar.right, JSON.stringify(geometry));
      assert.ok(geometry.title.width <= 1, 'Page title must not compete with the address bar');
      assert.equal(await web.eval('visualViewport.scale'), 1);
      assert.equal(await web.eval('document.querySelector("input").value'), '保留编辑内容');
      if (expanded) await captureScreenshot(cdp, path.join(evidenceRoot, `browser-expanded-${width}.png`));
    }
  }

  await captureScreenshot(cdp, path.join(evidenceRoot, '01-browser-pages-in-workspace-tabs.png'));
  web.close(); web = undefined;
  await cdp.eval('void window.fielora.core.quit()');
  cdp.close();
  await Promise.race([waitForChildExit(child), new Promise((resolve) => setTimeout(resolve, 4_000))]);
  console.log('BROWSER_WORKSPACE_TABS_E2E: PASS');
} finally {
  web?.close();
  await cleanupElectronProcess(child);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
}
