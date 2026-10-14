import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seedPresentationRun, narrativeMarkers } from '../fixtures/conversation-presentation.mjs';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess, CdpConnection } from './harness/electron-cdp-harness.mjs';

// Real Electron/Core/renderer with isolated persisted presentation records.
// No agent.start, model request, credential, production DB or substituted DOM.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-conversation-presentation-'));
const project = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-conversation-presentation-evidence-'));
const output = [], metrics = [], requests = [], q = JSON.stringify;
let child, cdp, db, debugPort;
const server = createServer((request, response) => {
  requests.push(request.url);
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><meta charset="utf-8"><title>本机来源全文</title><style>body{font:18px system-ui;max-width:760px;margin:60px auto;line-height:1.7}</style><h1>本机来源全文</h1><p>SOURCE_FULL_TEXT_LOADED</p><p>这里是专项测试的独立本机来源，点击来源会打开真实网页。</p>');
});
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 30000 });
const paint = () => cdp.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
async function point(selector) {
  await wait(`document.querySelector(${q(selector)})`);
  return cdp.eval(`(async()=>{const e=document.querySelector(${q(selector)});e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);if(e.disabled||!hit||!(hit===e||e.contains(hit)))throw new Error('Control is not reachable: '+${q(selector)});return{x,y};})()`);
}
async function click(selector) {
  const location = await point(selector);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...location, button: 'left', clickCount: 1 });
  await paint();
}
async function shot(name, selector) {
  if (selector) { await cdp.eval(`document.querySelector(${q(selector)}).scrollIntoView({block:'start',behavior:'instant'})`); await paint(); }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await paint();
  await captureScreenshot(cdp, path.join(evidence, `${name}.png`));
}
async function reload() {
  await wait('document.readyState==="complete"');
  await cdp.eval('window.__presentationReload=true');
  await cdp.send('Page.reload');
  await wait('!window.__presentationReload&&window.fieloraTest&&document.readyState==="complete"');
}
async function select(fixture) {
  await click(`[data-testid="conversation-${fixture.conversation}"]`);
  await wait(`document.querySelector('[data-agent-run-id="${fixture.run}"]')`);
}
async function resize(width, height = 840) {
  await cdp.eval(`window.fieloraTest.resizeWindow(${q({ width, height })})`);
  await wait(`innerWidth<=${width}&&innerWidth>=${width - 30}`);
  await paint();
}
async function geometry(label) {
  const value = await cdp.eval(`(()=>{
    const pane=document.querySelector('.conversation-column'),list=document.querySelector('.message-list'),p=pane.getBoundingClientRect();
    const entries=[...pane.querySelectorAll('.activity-history-toggle,.activity-failure-summary,.research-activity,.research-source,.agent-turn-approval,.agent-terminal-body')].filter(e=>e.getBoundingClientRect().width>0);
    return {label:${q(label)},viewport:{width:innerWidth,height:innerHeight},pane:{left:p.left,right:p.right,width:p.width},scrollWidth:list.scrollWidth,clientWidth:list.clientWidth,
      overflow:entries.flatMap(e=>{const r=e.getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1?[{class:e.className,left:r.left,right:r.right}]:[]}),
      font:getComputedStyle(pane.querySelector('.conversation-narrative p,.agent-terminal-body p')).fontSize,
      appearance:document.documentElement.dataset.effectiveAppearance};
  })()`);
  assert.ok(value.scrollWidth <= value.clientWidth + 1, q(value));
  assert.deepEqual(value.overflow, [], q(value));
  metrics.push(value);
  return value;
}
async function expandArchives() {
  let count = 0;
  while (await cdp.eval('Boolean(document.querySelector("[data-testid=activity-history-toggle][aria-expanded=false]"))')) {
    assert.ok(++count <= 30, 'Bounded archive expansion');
    await click('[data-testid=activity-history-toggle][aria-expanded=false]');
  }
  return count;
}
async function assertAllNarratives(fixture) {
  const texts = await cdp.eval('Array.from(document.querySelectorAll("[data-testid=conversation-narrative]")).map(e=>e.innerText)');
  for (const marker of narrativeMarkers) assert.equal(texts.filter(text => text.startsWith(marker + '：')).length, 1, marker + ' must be preserved exactly once');
  const sequences = await cdp.eval('Array.from(document.querySelectorAll("[data-testid=conversation-narrative]")).map(e=>Number(e.dataset.activitySequence))');
  for (const seq of fixture.narrativeSequences) assert.ok(sequences.includes(seq), `Narrative sequence ${seq} remains available`);
}

async function assertTerminalLayout(label) {
  await wait('document.querySelector("[data-testid=agent-history-toggle] .agent-elapsed")&&document.querySelector("[data-testid=agent-history-toggle] .app-icon")&&document.querySelector(".agent-terminal-body")');
  const value = await cdp.eval(`(()=>{
    const q=s=>document.querySelector(s),header=q('[data-testid=agent-history-toggle]'),elapsed=header.querySelector('.agent-elapsed'),icon=header.querySelector('.app-icon');
    const result=q('[data-testid=agent-terminal-result]'),body=q('.agent-terminal-body'),style=getComputedStyle(header),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
    return {label:${q(label)},headerText:header.textContent,elapsedText:elapsed.textContent,iconCount:header.querySelectorAll('.app-icon').length,
      statusCount:header.querySelectorAll('.agent-run-state,.agent-history-hint').length,headingCount:result.querySelectorAll('.agent-result-heading').length,
      expanded:header.getAttribute('aria-expanded'),header:rect(header),result:rect(result),arrowGap:icon.getBoundingClientRect().left-elapsed.getBoundingClientRect().right,
      dividerWidth:style.borderBottomWidth,dividerStyle:style.borderBottomStyle,dividerColor:style.borderBottomColor,
      evidenceAfterBody:[...result.querySelectorAll('[data-testid=agent-result-verification],[data-testid=agent-failure-reason]')].every(e=>Boolean(body.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING))};
  })()`);
  assert.match(value.headerText, /^用时 /, label);
  assert.equal(value.headerText, value.elapsedText, 'Only duration text is visible in the finished disclosure');
  assert.equal(value.iconCount, 1); assert.equal(value.statusCount, 0); assert.equal(value.headingCount, 0);
  assert.equal(value.expanded, 'false');
  assert.equal(value.dividerWidth, '1px'); assert.equal(value.dividerStyle, 'solid');
  assert.notEqual(value.dividerColor, 'rgba(0, 0, 0, 0)');
  assert.ok(Math.abs(value.header.left-value.result.left)<1&&Math.abs(value.header.right-value.result.right)<1, 'Divider spans the complete result reading rail: '+q(value));
  assert.ok(value.arrowGap>=0&&value.arrowGap<16, 'Disclosure arrow stays next to the duration: '+q(value));
  assert.equal(value.evidenceAfterBody, true, 'The result body leads platform evidence and failure details');
  metrics.push(value);
}

try {
  await Promise.all([mkdir(project), mkdir(evidence, { recursive: true })]);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    extraEnv: { FIELORA_DATA_DIR: path.join(dataRoot, 'Fielora'), FIELORA_E2E_USER_DATA: path.join(dataRoot, 'electron-profile') },
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = launched.child; debugPort = launched.port;
  cdp = await connectToFieloraApp({ port: debugPort, output, enablePage: true, timeoutMs: 120000 });
  await wait('window.fieloraTest&&window.fielora.core.getHealth().then(h=>h.state==="READY")');
  const ids = await cdp.eval(`(async()=>{
    const p=await window.fieloraTest.createProject({title:'对话展示验收',goal:null,root_path:${q(project)}});
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'本机展示回放 · 无模型请求',base_url:'https://example.com/v1',default_model:'presentation-replay',custom_endpoint_acknowledged:true});
    const result={};for(const [kind,title] of Object.entries({approval:'核对工作室实现 · 等待批准',working:'整理资料并继续验证',sources:'核对网页来源与正文',completed:'项目交付与核对结果',failed:'验证中断与后续处理',cancelled:'停止后的结果与检查记录'})){
      const c=await window.fielora.conversation.create({field_id:p.field_id,title,provider_config_id:provider.id,model_id:'presentation-replay'});
      const u=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:'核对项目实现和官方资料，保留执行依据、失败原因与待确认内容。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
      result[kind]={field:p.field_id,provider:provider.id,conversation:c.id,user:u.id};
    }return result;
  })()`);
  db = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'));
  db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;');
  const fixtures = Object.fromEntries(Object.entries(ids).map(([kind, value]) => [kind, seedPresentationRun(db, value, kind, origin)]));
  for (const kind of ['completed', 'failed', 'cancelled']) {
    const item = fixtures[kind];
    const text = kind === 'cancelled' ? '## 已停止\n\n任务已经停止；停止前已保存项目核对记录，回归检查尚未通过。\n\n已有结果仍可查看，请先核对执行记录。'
      : kind === 'failed' ? '这轮验证尚未完成。\n\n检查已达到本轮步数上限；之前的执行失败仍保留在过程记录中。请核对失败原因后继续。'
      : '已整理项目说明与资料对照。\n\n## 交付情况\n\n| 项目 | 状态 |\n|---|---|\n| 项目说明 | 已整理 |\n| 来源原文 | 已读取一条，其余待核对 |\n| 回归验证 | 本次回放未执行 |\n\n```bash\npython3 -m unittest test_regression -v\n```\n\n这是隔离界面回放，不能作为真实业务验收通过的证据。';
    await cdp.eval(`window.fielora.conversation.createMessage(${q({ conversation_id: item.conversation, role: 'ASSISTANT', content: text, status: item.status, provider_config_id: item.provider, model_id: 'presentation-replay', invocation_id: item.run, references: [] })})`);
  }
  await writeFile(path.join(evidence, 'fixtures.json'), q(fixtures));
  await reload(); await resize(1440); await select(fixtures.approval);
  await wait('document.querySelector("[data-testid=activity-history-toggle]")&&document.querySelector("[data-testid=agent-approval]")');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=activity-history-toggle][aria-expanded=true]").length'), 0);
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=activity-history-region]:not([hidden])").length'), 0);
  const failure = await cdp.eval('document.querySelector("[data-testid=activity-failure-summary]").innerText');
  assert.match(failure, /2 次执行失败/); assert.match(failure, /最近一次/);
  assert.ok(!(await cdp.eval('document.querySelector("[data-testid=conversation-activity-stream]").innerText')).includes(narrativeMarkers[0]));
  await point('[data-testid=agent-allow-once]');
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=agent-approval]").closest("[data-testid=activity-history-region]"))'), false);
  await geometry('approval-wide'); await shot('01-long-compact', '[data-testid=activity-history-toggle]');
  await shot('02-approval-visible', '[data-testid=agent-approval]');
  const archiveCount = await expandArchives(); assert.ok(archiveCount > 0);
  await assertAllNarratives(fixtures.approval);
  const groupCount = await cdp.eval('document.querySelectorAll("[data-testid=compact-category]").length');
  assert.equal(groupCount + 1, fixtures.approval.toolIds.length, 'Every completed tool group and the separate pending approval remain available');
  await shot('03-history-expanded', '[data-testid=activity-history-toggle]');
  // Keyboard must collapse the actual disclosure control.
  await point('[data-testid=activity-history-toggle]');
  await cdp.eval('document.querySelector("[data-testid=activity-history-toggle]").focus()');
  for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  await wait('document.querySelector("[data-testid=activity-history-toggle]").getAttribute("aria-expanded")==="false"');
  assert.equal(db.prepare('SELECT decision FROM agent_approvals WHERE id=?').get(fixtures.approval.approvalId).decision, null);

  await select(fixtures.working);
  await wait('document.querySelector("[data-context-state=RUNNING]")');
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-context-state=RUNNING]").closest("[data-testid=activity-history-region]"))'), false, 'An old unfinished context operation stays outside archives');
  assert.ok(await cdp.eval('Boolean(document.querySelector("[data-testid=compact-category].is-working"))'));
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=compact-category].is-working").closest("[data-testid=activity-history-region]"))'), false);
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=agent-current-action]"))'), false, 'A visible running tool must not be duplicated by a generic action footer');
  await shot('04-running-context', '[data-context-state=RUNNING]');

  await select(fixtures.sources);
  const research = `[data-testid="web-research-activity"][data-tool-id="${fixtures.sources.searchId}"]`;
  await wait(`document.querySelector(${q(research)})`);
  assert.equal(await cdp.eval(`document.querySelectorAll(${q(research + ' .research-source')}).length`), 2);
  assert.equal(await cdp.eval(`document.querySelectorAll(${q(research + ' [data-testid=research-excerpt]')}).length`), 0);
  assert.match(await cdp.eval(`document.querySelector(${q(research)}).innerText`), /已返回正文/);
  assert.match(await cdp.eval(`document.querySelector(${q(research)}).innerText`), /未读取正文/);
  await shot('05-sources-compact', research);
  await click(research + ' [data-testid=research-excerpt-toggle]');
  const excerpt = await cdp.eval(`document.querySelector(${q(research + ' [data-testid=research-excerpt]')}).innerText`);
  assert.ok(excerpt.includes(fixtures.sources.sources[0].snippet), 'Expanded excerpt retains every stored character');
  await click(research + ' [data-testid=research-more]');
  assert.equal(await cdp.eval(`document.querySelectorAll(${q(research + ' .research-source')}).length`), 5);
  await shot('06-sources-expanded', research);
  await click(research + ' [data-testid=research-more]');
  assert.equal(await cdp.eval(`document.querySelectorAll(${q(research + ' .research-source')}).length`), 2);
  await click(research + ' .research-source a');
  await wait(`window.fielora.browser.getState().then(state=>state.url===${q(fixtures.sources.sources[0].url)})`);
  const remote = await (async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const target = targets.find(value => value.url === fixtures.sources.sources[0].url);
      if (target) return new CdpConnection(target.webSocketDebuggerUrl);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Source must open an actual Browser WebContents');
  })();
  await remote.open();
  try {
    await waitForExpression(remote, 'document.body.innerText.includes("SOURCE_FULL_TEXT_LOADED")', { output });
    await captureScreenshot(remote, path.join(evidence, 'source-full-page.png'));
  } finally { remote.close(); }
  assert.ok(requests.includes('/source/1'));
  await wait('!document.querySelector("[data-workspace-motion=true]")');
  await click('[data-testid=chrome-tools]');
  await wait('!document.querySelector(".project-layout.workspace-open")&&!document.querySelector("[data-workspace-motion=true]")');
  // Return through the actual sidebar control after source navigation.
  await select(fixtures.completed);
  await wait('document.querySelector("[data-testid=agent-terminal-result]")');
  await assertTerminalLayout('completed-wide');
  assert.ok(await cdp.eval('Boolean(document.querySelector("[data-testid=agent-terminal-result]").compareDocumentPosition(document.querySelector("[data-testid=web-research-summary]"))&Node.DOCUMENT_POSITION_FOLLOWING)'), 'The actual result precedes its supporting sources');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").hidden'), true);
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=web-research-summary] .research-source").length'), 2);
  await click('[data-testid=web-research-summary] [data-testid=research-more]');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=web-research-summary] .research-source").length'), 5);
  await click('[data-testid=web-research-summary] [data-testid=research-more]');
  await shot('07-terminal-result', '[data-testid=agent-history-toggle]');
  await click('[data-testid=agent-history-toggle]'); await expandArchives(); await assertAllNarratives(fixtures.completed);
  await click('[data-testid=agent-history-toggle]');
  await select(fixtures.failed); await wait('document.querySelector("[data-testid=agent-failure-reason]")');
  await assertTerminalLayout('failed-wide');
  assert.match(await cdp.eval('document.querySelector("[data-testid=agent-failure-reason]").innerText'), /已达到本轮整体执行额度，任务尚未完成/);
  await shot('08-failed-terminal', '[data-testid=agent-history-toggle]');

  await select(fixtures.cancelled); await wait('document.querySelector("[data-testid=agent-result-verification]")');
  await assertTerminalLayout('cancelled-wide');
  assert.equal(await cdp.eval('document.querySelectorAll(".agent-terminal-body h1,.agent-terminal-body h2,.agent-terminal-body h3").length'), 0, 'Redundant persisted cancelled heading is omitted');
  assert.match(await cdp.eval('document.querySelector(".agent-terminal-body").innerText'), /任务已经停止；停止前已保存项目核对记录，回归检查尚未通过/);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-terminal-result]").innerText.includes("AGENT_CANCELLED")'), false);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-result-verification]").open'), false);
  assert.match(await cdp.eval('document.querySelector("[data-testid=agent-result-verification] summary").textContent'), /检查尚未通过/);
  await shot('14-cancelled-terminal', '[data-testid=agent-history-toggle]');
  await click('[data-testid=agent-result-verification] summary');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-result-verification] code").textContent'), 'python3 -m unittest test_summary');
  await click('[data-testid=agent-result-verification] summary');
  await click('[data-testid=agent-history-toggle]');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").hidden'), false);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail] .agent-run-error-detail code").textContent'), 'AGENT_CANCELLED');
  assert.equal(await cdp.eval('document.querySelector(".agent-run-error-detail").getBoundingClientRect().height>0'), true, 'Cancellation reason remains available in expanded history');
  await shot('15-cancelled-history', '.agent-run-error-detail');
  await click('[data-testid=agent-history-toggle]');
  await resize(900, 640); await assertTerminalLayout('cancelled-narrow');
  await shot('16-cancelled-narrow', '[data-testid=agent-history-toggle]');

  await select(fixtures.approval); await resize(900, 640);
  await geometry('approval-narrow'); await point('[data-testid=agent-allow-once]');
  await shot('09-narrow-approval', '[data-testid=agent-approval]');
  await select(fixtures.sources); await geometry('sources-narrow'); await shot('10-narrow-sources', research);
  await cdp.eval(`(()=>{const key='fielora.ui.preferences.v2',p=JSON.parse(localStorage.getItem(key)||'{}');p.appearance={...p.appearance,uiFontSize:18,codeFontSize:17};localStorage.setItem(key,JSON.stringify(p))})()`);
  await reload(); await select(fixtures.approval);
  const large = await geometry('large-font-narrow'); assert.equal(parseFloat(large.font), 18);
  await point('[data-testid=agent-allow-once]'); await shot('11-large-font-approval', '[data-testid=agent-approval]');
  await select(fixtures.sources); await click(research + ' [data-testid=research-excerpt-toggle]');
  await geometry('large-font-sources'); await shot('12-large-font-sources', research);
  // Current product deliberately exposes LIGHT only. This is a controlled CSS
  // token stress probe, explicitly not proof of a user-facing dark preference.
  await cdp.eval('document.documentElement.dataset.effectiveAppearance="dark";document.documentElement.style.colorScheme="dark"');
  await paint(); await geometry('dark-token-stress-only'); await shot('13-dark-token-stress', research);
  await writeFile(path.join(evidence, 'result.json'), q({ status: 'PASS', scope: 'Isolated durable presentation replay in actual Electron/Core. No real model or tool execution; source click uses a real loopback webpage. Dark is CSS token stress only; actual native preview is validated by separate agent-computer-preview-e2e.', externalModelRequests: 0, productionStateAccess: false, archiveCount, groupCount, metrics, requests }));
  console.log(`CONVERSATION_PRESENTATION=PASS evidence=${evidence}`);
} catch (error) {
  if (cdp) await shot('failure').catch(() => {});
  await writeFile(path.join(evidence, 'result.json'), q({ status: 'FAIL', error: String(error), metrics, requests })).catch(() => {});
  console.error(output.join('').slice(-2200)); throw error;
} finally {
  await writeFile(path.join(evidence, 'electron.log'), output.join('')).catch(() => {});
  db?.close();
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); }
  if (child) await cleanupElectronProcess(child);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(dataRoot, { recursive: true, force: true });
}
