import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess, freeDebuggingPort, CdpConnection } from './harness/electron-cdp-harness.mjs';

// Local presentation replay only. Uses the existing isolated desktop/SQLite harness.
// No credential, model request, tool execution or production database access.
const root = path.resolve(import.meta.dirname, '../..');
const baseline = process.env.FIELORA_UI_BASELINE === '1';
const evidence = path.join(root, 'artifacts/conversation-execution-20260930', baseline ? 'before' : 'after');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-execution-ui-'));
const projectRoot = path.join(dataRoot, 'project');
const output = [];
let child, cdp, main, db;
const now = 1790730000000;
const uuid = randomUUID();
const runId = `${uuid.slice(0, 14)}7${uuid.slice(15)}`;
let sequence = 0;
const narrative = '我会先读取项目说明，再检查执行过程的展示。\n\n让我先检查现有组件，保留正文中的 `Get-Content README.md -Raw`，并核对操作与实际回执。';
const command = 'Get-Content docs/architecture/FIELORA_V0.1_AGENT_ARCHITECTURE_SPEC.md -Raw; ' + 'Write-Output "fixture command with a long argument"; '.repeat(6);
const wait = expression => waitForExpression(cdp, expression, { output });
const settle = () => new Promise(resolve => setTimeout(resolve, 250));
async function click(selector) {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await settle();
}
function event(kind, payload = {}) {
  db.prepare('INSERT INTO agent_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(), runId, ++sequence, 1, kind, JSON.stringify(payload), now + sequence * 1000);
}
function tool(name, args, status = 'COMPLETED', receipt = { kind: 'FILE_READ', bytes: 120 }, error = null) {
  const id = randomUUID();
  db.prepare('INSERT INTO agent_tool_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, runId, name, name === 'run_command' ? 'PROCESS' : 'OBSERVE', status, 'ALLOW', JSON.stringify(args), receipt === null ? null : JSON.stringify(receipt), error, now + sequence * 1000, now + (sequence + 2) * 1000, now + (sequence + 2) * 1000);
  event('TOOL_PROPOSED', { tool_call_id: id });
  event('TOOL_STARTED', { tool_call_id: id });
  event(status === 'FAILED' ? 'TOOL_FAILED' : 'TOOL_COMPLETED', { tool_call_id: id });
  return id;
}
async function shot(name) { await settle(); await captureScreenshot(cdp, path.join(evidence, `${name}.png`)); }
try {
  await mkdir(projectRoot, { recursive: true }); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(projectRoot, 'README.md'), 'Presentation fixture only.\n');
  const inspectorPort = await freeDebuggingPort();
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.execPath, args: [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start', '--', `--inspect=${inspectorPort}`, `--user-data-dir=${path.join(dataRoot, 'chromium')}`],
    extraEnv: { Path: `${path.dirname(process.execPath)};${process.env.Path ?? ''}`, FIELORA_CORE_PATH: path.join(root, 'target/release/fielora-core.exe') } });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  const evaluate = cdp.eval.bind(cdp);
  cdp.eval = async expression => { try { return await evaluate(expression); } catch (error) { throw new Error(`UI replay expression: ${expression.slice(0, 250)}\n${error.stack}`); } };
  const targets = await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json();
  main = new CdpConnection(targets[0].webSocketDebuggerUrl); await main.open();
  const mainEval = async expression => {
    const result = await main.send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const emit = payload => mainEval(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.send('fielora:core:event',${JSON.stringify(payload)})`);
  assert.equal(path.resolve(await mainEval(`process.mainModule.require('electron').app.getPath('userData')`)), path.join(dataRoot, 'chromium'));
  await wait('window.fieloraTest && document.querySelector("[data-testid=project-workspace]")');
  const ids = await cdp.eval(`(async()=>{
    const p=await window.fieloraTest.createProject({title:'执行过程 UI 回放',goal:null,root_path:${JSON.stringify(projectRoot)}});
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'UI fixture · 无模型请求',base_url:'https://example.com/v1',default_model:'presentation-fixture',custom_endpoint_acknowledged:true});
    const c=await window.fielora.conversation.create({field_id:p.field_id,title:'检查对话区执行过程',provider_config_id:provider.id,model_id:'presentation-fixture'});
    const u=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:'检查项目说明和对话区组件，保留真实执行记录。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null});
    return {field:p.field_id,conversation:c.id,provider:provider.id,user:u.id};
  })()`);
  db = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.prepare(`INSERT INTO agent_runs(id,field_id,conversation_id,provider_config_id,model_id,task,permission,status,current_step,max_steps,next_sequence,error_code,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,'PAUSED',12,100,100,'AGENT_USER_PAUSED',?,?,NULL)`)
    .run(runId, ids.field, ids.conversation, ids.provider, 'presentation-fixture', '检查对话区组件', 'FULL_CONTROL', now, now + 60000);
  event('RUN_CREATED', { user_message_id: ids.user }); event('RUN_STARTED', { task_class: 'GENERAL' });
  event('ASSISTANT_NARRATIVE', { step: 1, text: narrative });
  for (let i = 0; i < 8; i++) tool(i === 2 ? 'run_command' : 'read_file', i === 2 ? { program: 'powershell', argv: ['-Command', command], cwd: projectRoot } : { path: i === 0 ? 'README.md' : `docs/${'long-directory/'.repeat(i === 6 ? 15 : 0)}component-${i}.tsx` }, 'COMPLETED', i === 2 ? { kind: 'COMMAND', cwd: projectRoot, success: true, exit_code: 0, duration_ms: 1250, stdout_sha256: 'a'.repeat(64) } : { kind: 'FILE_READ', bytes: 120 });
  event('ASSISTANT_NARRATIVE', { step: 2, text: '八项操作已有回执。下面单独检查一个文件，任务尚未验证。' });
  tool('read_file', { path: 'conversation-renderer.tsx' });
  event('ASSISTANT_NARRATIVE', { step: 3, text: '历史记录与异常也应保留明确状态。' });
  tool('read_file', {}, 'COMPLETED', null);
  event('ASSISTANT_NARRATIVE', { step: 4, text: '检查命令遇到错误，等待处理。' });
  tool('run_command', { program: 'missing-fixture-command', argv: [] }, 'FAILED', null, 'AGENT_IO_FAILED');
  event('RUN_PAUSED');
  await cdp.send('Page.reload');
  await wait(`document.querySelector('[data-testid="project-${ids.field}"]')`);
  await cdp.eval(`(()=>{let e=document.querySelector('[data-testid="project-${ids.field}"]');if(e.getAttribute('aria-expanded')!=='true')e.click()})()`);
  await click(`[data-testid="conversation-${ids.conversation}"]`);
  await wait('document.querySelector("[data-testid=agent-pause-notice]")');
  for (const width of [1280, 1440]) {
    await cdp.eval(`window.fieloraTest.resizeWindow({width:${width},height:1000})`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.eval('document.querySelector(".message-list").scrollTop=0');
    await shot(`summary-${width}`);
  }
  await click('[data-testid=compact-category] > summary, [data-testid=operation-group-toggle]');
  await cdp.eval('document.querySelector(".message-list").scrollTop=0');
  await shot('list-1440');
  await click(baseline ? '[data-testid=compact-activity-row] > summary' : '[data-testid=operation-row]:nth-child(3) button');
  await cdp.eval('document.querySelector(".message-list").scrollTop=0');
  await shot('detail-1440');
  if (!baseline) {
    await cdp.eval('document.querySelector("[data-testid=operation-detail]").scrollIntoView({block:"start"})');
    await shot('detail-focused-1440');
  }
  if (!baseline) {
    assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=operation-list] > li").length'), 8);
    assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=operation-list] .compact-command-panel").length'), 0);
    assert.ok(await cdp.eval('document.querySelector("[data-testid=operation-detail]").textContent.includes("1250")'));
    const geometry = async () => cdp.eval(`(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom}};
      const list=document.querySelector('.message-list'),text=getComputedStyle(document.querySelector('.conversation-narrative p'));
      return {pane:rect('.conversation-column'),body:rect('.conversation-narrative'),composer:rect('.conversation-composer'),overflow:list.scrollWidth>list.clientWidth,font:parseFloat(text.fontSize),line:parseFloat(text.lineHeight)};
    })()`);
    const metrics = [];
    for (const width of [1280,1440]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false}); await settle();
      const g=await geometry(); metrics.push(g);
      assert.ok(Math.abs(g.body.left-g.composer.left)<1 && Math.abs(g.body.right-g.composer.right)<1,JSON.stringify(g));
      assert.ok(g.body.width<=920.5 && !g.overflow,JSON.stringify(g));
      assert.equal(g.font,18); assert.equal(g.line,28);
    }
    assert.equal(await cdp.eval(`document.querySelector('[data-testid=operation-row]').getBoundingClientRect().height`),32);
    assert.equal(await cdp.eval(`getComputedStyle(document.querySelector('[data-testid=operation-row] button')).backgroundColor`),'rgba(0, 0, 0, 0)');
    assert.equal(await cdp.eval(`document.querySelectorAll('[data-testid=operation-detail]').length`),1);
    assert.equal(await cdp.eval(`document.querySelector('[data-testid=operation-list]').contains(document.querySelector('[data-testid=operation-detail]'))`),false);
    await click('[aria-label="复制命令"]');
    await wait(`document.querySelector('[data-testid=operation-detail]').textContent.includes('命令已复制')`);
    assert.equal(await mainEval(`process.mainModule.require('electron').clipboard.readText()`), `powershell -Command ${command}`);
    await click('[data-testid=operation-row]:first-child button');
    await cdp.eval(`document.querySelector('.message-list').scrollTop=0`);
    await shot('detail-read-comparison-1440');
    assert.equal(await cdp.eval(`document.querySelectorAll('[data-testid=operation-detail]').length`),1);
    assert.ok(await cdp.eval(`!document.querySelector('[data-testid=operation-detail]').textContent.includes('工作目录')`));
    await click('[data-testid=operation-group-toggle]');
    assert.equal(await cdp.eval(`document.querySelectorAll('[data-testid=operation-list]').length`),0);
    assert.ok(await cdp.eval(`Boolean(document.querySelector('.message-list').textContent.includes('执行失败') && document.querySelector('[data-testid=agent-pause-notice]'))`));
    await cdp.eval(`[...document.querySelectorAll('[data-testid=operation-group-toggle]')].find(e=>e.textContent.includes('conversation-renderer.tsx')).click()`); await settle();
    assert.equal(await cdp.eval(`document.querySelectorAll('[data-testid=operation-list]').length`),0,'single operation goes straight to details');
    await cdp.eval(`[...document.querySelectorAll('[data-testid=operation-group-toggle]')].find(e=>e.textContent.includes('conversation-renderer.tsx')).click()`); await settle();
    // Missing-detail legacy record: target by its stable fixture content, not an array identity.
    await cdp.eval(`(()=>{const g=[...document.querySelectorAll('[data-testid=compact-category]')].find(e=>e.textContent.trim()==='已读取');g.querySelector('button').click()})()`); await settle();
    assert.ok(await cdp.eval(`document.querySelector('[data-testid=operation-detail]').textContent.includes('该历史记录未保存执行详情。')`));
    assert.equal(await cdp.eval(`document.querySelectorAll('[data-testid=operation-detail] .operation-detail-field').length`),0);
    await cdp.eval(`[...document.querySelectorAll('[data-testid=compact-category]')].find(e=>e.textContent.includes('该历史记录未保存执行详情。')).querySelector('button').click()`);
    await cdp.eval(`document.querySelector('[data-testid=operation-group-toggle]').focus()`);
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r'});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
    await wait(`document.querySelector('[data-testid=operation-group-toggle]').getAttribute('aria-expanded')==='true'`);
    await click('[data-testid=operation-row]:nth-child(3) button');
    // Replay live events over the existing core-event delivery channel; no Model or Agent loop.
    db.prepare("UPDATE agent_runs SET status='RUNNING',error_code=NULL WHERE id=?").run(runId);
    await emit({event:'event.agent.changed',run_id:runId,sequence,status:'RUNNING'});
    await wait(`document.querySelector('[data-agent-state=RUNNING]')`);
    await cdp.eval(`document.querySelector('.message-list').scrollTop=50;window.__openRow=document.querySelector('[data-testid=operation-group-toggle]');window.__openDetail=document.querySelector('[data-testid=operation-detail]');true`);
    await settle();
    const top=await cdp.eval(`document.querySelector('.message-list').scrollTop`);
    await emit({event:'event.agent.text_delta',run_id:runId,step:20,text_delta:'让我继续检查流式追加。'.repeat(60)});
    await wait(`document.querySelector('.conversation-narrative.is-streaming')`);
    assert.equal(await cdp.eval(`document.querySelector('.message-list').scrollTop`),top);
    assert.ok(await cdp.eval(`window.__openRow===document.querySelector('[data-testid=operation-group-toggle]') && window.__openDetail===document.querySelector('[data-testid=operation-detail]')`));
    event('ASSISTANT_NARRATIVE',{step:20,text:'让我继续检查流式追加。'.repeat(60)});
    for(let i=0;i<10;i++) tool('read_file',{path:`more-${i}.ts`});
    db.prepare('UPDATE agent_runs SET next_sequence=? WHERE id=?').run(sequence+1,runId);
    await emit({event:'event.agent.changed',run_id:runId,sequence,status:'RUNNING'});
    await wait(`document.querySelector('.message-list').textContent.includes('已执行 10 项操作')`);
    assert.equal(await cdp.eval(`document.querySelector('.message-list').scrollTop`),top);
    assert.ok(await cdp.eval(`window.__openDetail===document.querySelector('[data-testid=operation-detail]')`));
    await cdp.eval(`[...document.querySelectorAll('[data-testid=operation-group-toggle]')].find(e=>e.textContent.includes('10 项操作')).click()`); await settle();
    const scrollList=await cdp.eval(`(()=>{const e=[...document.querySelectorAll('[data-testid=operation-list]')].find(e=>e.children.length===10);return {height:e.clientHeight,scroll:e.scrollHeight}})()`);
    assert.equal(scrollList.height,256); assert.ok(scrollList.scroll>256);
    await cdp.eval(`document.querySelector('.message-list').scrollTop=document.querySelector('.message-list').scrollHeight`); await settle();
    const atBottomBefore=await cdp.eval(`document.querySelector('.message-list').scrollTop`);
    await emit({event:'event.agent.text_delta',run_id:runId,step:21,text_delta:'新的进展正文。'.repeat(200)}); await settle();
    assert.ok(await cdp.eval(`document.querySelector('.message-list').scrollTop>${atBottomBefore}`),'follow when already at bottom');
    // Confirm terminal handoff does not recreate history nodes.
    db.prepare("UPDATE agent_runs SET status='CANCELLED',finished_at=?,error_code=NULL WHERE id=?").run(now+90000,runId);
    event('RUN_CANCELLED');
    await emit({event:'event.agent.changed',run_id:runId,sequence,status:'CANCELLED'});
    await wait(`document.querySelector('[data-agent-state=CANCELLED]')`);
    assert.ok(await cdp.eval(`window.__openDetail===document.querySelector('[data-testid=operation-detail]')`),'terminal handoff keeps selected detail DOM');
    // Dock uses the application's existing workspace controls and real remaining pane width.
    await cdp.eval(`window.dispatchEvent(new CustomEvent('fielora:open-workspace-launcher'))`); await settle();
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false}); await settle();
    const narrow=await geometry(); metrics.push(narrow);
    assert.ok(narrow.pane.width<=640,JSON.stringify(narrow));
    assert.ok(Math.abs(narrow.body.left-narrow.pane.left-16)<1,JSON.stringify(narrow));
    assert.ok(Math.abs(narrow.body.left-narrow.composer.left)<1 && Math.abs(narrow.body.right-narrow.composer.right)<1 && !narrow.overflow,JSON.stringify(narrow));
    await cdp.eval(`document.activeElement?.blur(); document.querySelector('.message-list').scrollTop=0`); await settle();
    await cdp.eval(`document.querySelector('.message-list').scrollTop=0`); await shot('narrow-dock');
    const divider=await cdp.eval(`(()=>{const r=document.querySelector('[data-testid=project-workspace-resizer]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...divider,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:divider.x+30,y:divider.y,button:'left',buttons:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:divider.x+30,y:divider.y,button:'left',buttons:0,clickCount:1});
    await settle();
    const dragged=await geometry(); metrics.push(dragged);
    assert.ok(Math.abs(dragged.pane.width-narrow.pane.width)>10,JSON.stringify(dragged));
    assert.ok(Math.abs(dragged.body.left-dragged.composer.left)<1 && Math.abs(dragged.body.right-dragged.composer.right)<1 && !dragged.overflow,JSON.stringify(dragged));
    await click('[data-testid=operation-group-toggle]');
    await cdp.eval(`document.activeElement?.blur();document.querySelector('.message-list').scrollTop=0`); await shot('narrow-summary');
    await click('[data-testid=operation-group-toggle]');
    await click('[data-testid=operation-row]:nth-child(3) button');
    await cdp.eval(`document.querySelector('.message-list').scrollTop=0`); await shot('narrow-list');
    await click('[data-testid=operation-row]:nth-child(3) button');
    await cdp.eval(`document.querySelector('[data-testid=operation-detail]').scrollIntoView({block:'start'})`); await shot('narrow-detail');
    // User font preferences are read through the existing preferences mechanism.
    await cdp.eval(`(()=>{const key='fielora.ui.preferences.v2',p=JSON.parse(localStorage.getItem(key)||'{}');p.agentDisplayMode='DETAILED';p.appearance={...p.appearance,uiFontSize:18,codeFontSize:17,uiFont:'MICROSOFT_YAHEI',codeFont:'CONSOLAS',themePreference:'DARK'};localStorage.setItem(key,JSON.stringify(p))})()`);
    await cdp.send('Page.reload'); await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
    await click(`[data-testid="conversation-${ids.conversation}"]`); await wait(`document.querySelector('[data-testid=operation-group-toggle]')`);
    await cdp.eval(`document.querySelector('.message-list').scrollTop=0`);
    const fonts=await cdp.eval(`(()=>{const p=getComputedStyle(document.querySelector('.conversation-narrative p')),c=getComputedStyle(document.querySelector('.conversation-narrative code'));return {body:parseFloat(p.fontSize),code:parseFloat(c.fontSize),family:p.fontFamily,codeFamily:c.fontFamily}})()`);
    assert.equal(fonts.body,21.6); assert.equal(fonts.code,17); assert.match(fonts.family,/Microsoft YaHei/); assert.match(fonts.codeFamily,/Consolas/);
    assert.equal(await cdp.eval(`document.querySelector('[data-testid=operation-group-toggle]').getAttribute('aria-expanded')`),'false','legacy display preference does not create another rendering mode');
    await shot('font-settings-dark');
    await writeFile(path.join(evidence,'metrics.json'),JSON.stringify({metrics,fonts,scrollList,streaming:true,terminalIdentity:true,commandClipboard:true,dockDrag:true},null,2));
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ status: 'PASS', baseline, fixture: true, externalModelRequests: 0, dataRoot }, null, 2));
  console.log(`PASS ${baseline ? 'before' : 'after'} presentation replay: ${evidence}`);
} catch (error) {
  console.error(error); process.exitCode = 1;
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', baseline, fixture: true, externalModelRequests: 0, error: String(error) }, null, 2));
  if (cdp) await shot('failure').catch(() => {});
} finally {
  await writeFile(path.join(evidence, 'electron.log'), output.join('')).catch(() => {});
  db?.close(); cdp?.close(); main?.close(); await cleanupElectronProcess(child);
}
