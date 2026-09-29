import { once } from 'node:events';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const scoped = process.env.FIELORA_E2E_SCOPED === '1';
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-browser-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-browser-verification'));
const output = [];
let child; let cdp; let ids; let server; let url; let badUrl;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs:45_000, output });
async function launch() {
  const launched = await launchElectron({ root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{FIELORA_AGENT_BROWSER_FIXTURE_URL:url,FIELORA_AGENT_BROWSER_BAD_URL:badUrl,Path:`${path.dirname(process.execPath)};${process.env.Path??''}`},
  });
  child=launched.child;
  cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120_000,enablePage:true});
  
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.eval("window.fieloraTest.resizeWindow({width:1478,height:850})");
}
async function reload() {
  await wait("window.fielora.core.getHealth().then(h=>h.state==='READY')");
  // The sidebar intentionally excludes unsent drafts. Seed a durable user
  // message before exercising navigation to a newly created fixture conversation.
  if (ids?.conversation) await cdp.eval(`(async()=>{const conversation_id=${JSON.stringify(ids.conversation.id)};const messages=await window.fielora.conversation.listMessages({conversation_id});if(!messages.some(m=>m.role==='USER'))await window.fielora.conversation.createMessage({conversation_id,role:'USER',content:'准备隔离浏览器验收，下一条请求定义验收任务。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});})()`);
  await cdp.eval('window.__recoveryReload=true'); await cdp.send('Page.reload');
  await wait('typeof window.__recoveryReload === "undefined" && window.fieloraTest');
}
async function click(selector) {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  const hover=await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=(e.closest('.project-item-row')??e).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});
  await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`);
  const point=await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
  assert.ok(point.hit, `${selector} is clickable`);
  for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
}
async function send(task) {
  await cdp.eval(`(()=>{const e=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(task)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait("!document.querySelector('[data-testid=send-message]').disabled");
  await click('[data-testid=send-message]');
}
async function openConversation() {
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation.id}"]')`);
  await click(`[data-testid="conversation-${ids.conversation.id}"]`);
}
try {
  await mkdir(projectRoot); await mkdir(evidence,{recursive:true});
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>隔离的到账弹窗验证</title>
<style>body{font:16px system-ui;background:#f6f8fa;color:#263344;padding:20px}main{max-width:640px;margin:20px auto;background:white;border:1px solid #e2e6eb;border-radius:16px;padding:26px}h1{font-size:22px;font-weight:600}p{color:#687386}label{display:block;margin:14px 0 4px}input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #d9dfe8;border-radius:6px;font:inherit}input[readonly]{background:#f7f8fa}button{margin-top:18px;padding:10px 20px;border:0;border-radius:8px;background:#6650d8;color:white;font:inherit}button:disabled{opacity:.4}#error{color:#b23030}</style>
<main><h1>到账确认</h1><p>隔离测试 · 不连接业务服务器</p>
<label for="paid">客户抬头</label><input id="paid" readonly value="0">
<label for="remaining">毕业学校</label><input id="remaining" readonly value="100">
<label for="date">到账日期</label><input id="date" type="date" value="2026-09-10">
<label for="amount">手机号码</label><input id="amount" type="number" value="100">
<label for="after">到账后剩余金额</label><input id="after" readonly value="0">
<p id="error"></p><button id="confirm">确认模拟到账</button></main>
<script>const paid=document.querySelector('#paid'),remaining=document.querySelector('#remaining'),amount=document.querySelector('#amount'),after=document.querySelector('#after'),confirm=document.querySelector('#confirm'),error=document.querySelector('#error');
function update(){const n=Number(amount.value),r=Number(remaining.value);after.value=String(r-n);confirm.disabled=!amount.value||n<=0||n>r;error.textContent=n>r?'不能超过剩余金额':''}
amount.addEventListener('input',update);confirm.addEventListener('click',()=>{paid.value=String(Number(paid.value)+Number(amount.value));remaining.value=String(100-Number(paid.value));amount.value=remaining.value;update()});</script></html>`;
  await writeFile(path.join(projectRoot,'popup.html'), scoped ? html.replace('</html>', '<script>function request(value){return value;} const bankAccount=request({action:135});</script></html>') : html);
  if (scoped) {
    await mkdir(path.join(projectRoot,'i18n'));
    await writeFile(path.join(projectRoot,'i18n/cn.json'),'{"12044":"搜索"}');
    await writeFile(path.join(projectRoot,'calendar.html'),'<button>{{T:12044}}</button>');
  }
  await writeFile(path.join(projectRoot,'verify.cjs'),"require('node:assert/strict').ok(true);\n");
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); url=`http://127.0.0.1:${server.address().port}/`;
  const unused=createServer(); await new Promise(resolve=>unused.listen(0,'127.0.0.1',resolve));
  badUrl=`http://127.0.0.1:${unused.address().port}/`;
  await new Promise(resolve=>unused.close(resolve));
  await new Promise(resolve=>server.close(resolve));
  const navigationHtml = `<!doctype html><meta charset="utf-8"><title>Desktop viewport and nested scroll fixture</title>
<style>body{font:16px system-ui;margin:20px;background:#f6f8fa}nav{position:fixed;left:-240px;top:120px;width:220px;background:#126ab0;padding:12px;z-index:3}nav.open{left:0}nav a{display:block;color:white;padding:16px}button{padding:12px;margin:10px}#table{width:1200px;height:260px;overflow:auto;position:relative}#sticky{position:sticky;top:0;height:160px;background:#126ab0;z-index:4}#row{position:relative;height:60px;width:1200px}#modal{display:inline-block;margin-left:1060px;width:80px;height:60px;cursor:pointer}#partial{position:absolute;left:1085px;top:20px;width:30px;height:20px;background:#ddd}#modal::before{content:"¤"}#cover{position:absolute;left:0;top:0;width:200px;height:60px;background:#ddd;z-index:2}#covered{position:relative;width:200px;height:60px}main{background:white;padding:24px;margin-top:20px}label{display:block;margin:12px 0}h1{font-size:22px}section[role=dialog]{position:fixed;inset:32px;background:white;z-index:5;padding:24px;box-shadow:0 0 0 100vmax #0005;display:grid;grid-template-columns:160px minmax(0,1fr);gap:12px;align-content:start;overflow:auto;border-radius:12px}section h1{grid-column:1/-1;margin:0 0 16px}section label{margin:0;line-height:36px}section input,section select{box-sizing:border-box;width:100%;height:36px;padding:6px;font:inherit}section span{line-height:36px}</style>
<button id="toggle">打开导航</button><div id="covered"><button id="bad">Covered action</button><div id="cover">Overlay</div></div>
<nav><a href="#/finance">发票</a></nav><main id="target"><h1>我的桌面</h1><p id="width"></p></main>
<script>window.onerror=e=>{document.body.append('Fixture error: '+e)};let count=0;const target=document.querySelector('#target');document.querySelector('#width').textContent='Viewport width: '+innerWidth;
const trace=document.createElement('pre');trace.style.cssText='position:fixed;bottom:0;right:0;pointer-events:none;font-size:10px;z-index:9;background:white';document.body.append(trace);
let nativeClicks=0;document.addEventListener('click',e=>{if(e.isTrusted)trace.textContent='Native clicks: '+(++nativeClicks)+'; target='+e.target.id+'; client='+e.clientX+','+e.clientY},true);
window.badClicks=0;document.querySelector('#bad').onclick=()=>window.badClicks++;
document.querySelector('#toggle').onclick=()=>document.querySelector('nav').classList.toggle('open');
window.onhashchange=()=>{count++;document.querySelector('nav').classList.remove('open');target.innerHTML='<h1>发票列表</h1><p>Navigation count: '+count+'</p><div id="table"><div id="sticky">固定表头</div><div style="height:500px"></div><div id="row"><span id="modal" class="fa fa-money pointer" ng-click="openReceipt()" title="到账确认"></span><div id="partial">遮挡</div></div><div style="height:100px"></div></div>';document.querySelector('#modal').onclick=()=>{target.innerHTML+='<section role="dialog"><h1>到账确认</h1><label>发票ID</label><span>FIXTURE-1</span><label>已到账金额</label><span>0.00</span><label>剩余未到账金额</label><span>100.00</span><label>到账日期</label><input type="date" value="2026-09-12"><label>本次到账金额</label><input value="100"><label>到账后剩余金额</label><input readonly value="0.00"><label>开户银行</label><select><option>Fixture bank</option></select></section>'}};</script>`;
  await writeFile(path.join(projectRoot,'navigation.html'),navigationHtml);
  await writeFile(path.join(projectRoot,'compile.cjs'), 'exports.ready = true;\n}\n');
  await writeFile(path.join(projectRoot,'visual-page.cjs'), `const fs=require('node:fs'),vm=require('node:vm');module.exports=()=>{try{new vm.Script(fs.readFileSync('compile.cjs','utf8'));return '<!doctype html><meta charset="utf-8"><h1>到账确认</h1><p>发票ID</p><p>已到账金额</p><p>剩余未到账金额</p><p>到账日期</p><p>本次到账金额</p><p>到账后剩余金额</p><p>开户银行</p>';}catch(e){return '<!doctype html><body style="margin:0"><iframe style="width:100vw;height:90vh;border:0" srcdoc="<body style=background:black;color:tomato><h1>Failed to compile</h1><pre>compile.cjs: '+String(e).replaceAll('\"','&quot;')+'</pre></body>"></iframe><iframe sandbox srcdoc="opaque-frame-sentinel"></iframe></body>';}}`);
  await writeFile(path.join(projectRoot,'serve.cjs'),`const http=require('node:http'),fs=require('node:fs');http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(req.url==='/__visual_feedback'?require('./visual-page.cjs')():req.url==='/__navigation'?fs.readFileSync('navigation.html'):req.url==='/__delayed'?'<html><body><script>setTimeout(()=>history.replaceState({},\"\",\"/__login\"),200);setTimeout(()=>document.body.innerHTML=\"<h1>Delayed login</h1><label>Password<input type=password value=fixture-password-redacted></label>\",1400);</script></body></html>':req.url==='/__empty'?'<html><body></body></html>':req.url==='/__login'?'<html><body><h1>登录测试</h1><label>密码<input type="password" value="fixture-password-redacted"></label></body></html>':fs.readFileSync('popup.html'));}).listen(Number(new URL(process.argv[2]).port),'127.0.0.1',()=>console.log('Fixture server ready'));`);
  await launch();
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Browser fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_pause__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'浏览器验收',goal:null,root_path:${JSON.stringify(projectRoot)}});const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'核对到账弹窗',provider_config_id:provider.id,model_id:provider.default_model});return {provider,project,conversation};})()`);
  await reload(); await openConversation();
  await click('[data-testid=composer-permission]'); await click('[data-testid=composer-permission-option-FULL_CONTROL]');
  let baseValidation={};
  if (process.env.FIELORA_E2E_NAVIGATION_ONLY !== '1') {
  await send(`FIELORA_AGENT_FIXTURE_BROWSER ${scoped ? 'SCOPED_WORK ' : ''}KEEP_SERVER 修复到账弹窗并执行浏览器验证，覆盖文案、计算和重复分批到账`);
  if (scoped) {
    await wait("document.querySelector('[data-testid=agent-pause-notice]')");
    const paused = await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
    assert.equal(paused.status,'PAUSED'); assert.equal(paused.current_step,12);
    const prefixTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(paused.id)}})`);
    await writeFile(path.join(evidence,'prefix-tools.json'),JSON.stringify(prefixTools,null,2));
    const codes = prefixTools.map(t=>t.error_code);
    for (const code of ['AGENT_SHARED_TRANSLATION_IMPACT','AGENT_GIT_ARGUMENTS_INVALID']) assert.ok(codes.includes(code),code);
    const regexSearch=prefixTools.find(t=>t.name==='search_text' && t.arguments.query==='bankAccount|开户行|BankAccount');
    const literalSearch=prefixTools.find(t=>t.name==='search_text' && t.arguments.queries);
    assert.equal(regexSearch.status,'COMPLETED'); assert.equal(regexSearch.receipt.match_mode,'REGEX_FALLBACK');
    assert.equal(regexSearch.receipt.matches,1); assert.equal(literalSearch.receipt.match_mode,'LITERAL');
    assert.deepEqual(regexSearch.receipt.matched_locations,literalSearch.receipt.matched_locations);
    assert.deepEqual(regexSearch.receipt.files,literalSearch.receipt.files);
    assert.equal(await readFile(path.join(projectRoot,'i18n/cn.json'),'utf8'),'{"12044":"搜索"}');
    assert.equal(await readFile(path.join(projectRoot,'scratch.txt'),'utf8'),'local note');
    assert.equal(await readFile(path.join(projectRoot,'another-note.txt'),'utf8'),'scoped plans are advisory');
    const plans=prefixTools.filter(t=>t.name==='work_plan');
    assert.equal(plans.length,3);
    assert.ok(plans.every(t=>t.status==='COMPLETED' && t.receipt.verification_eligible===false));
    assert.ok(plans.some(t=>t.receipt.plan.evidence_issues.some(issue=>issue.code==='AGENT_WORK_QUOTE_MISMATCH')));
    assert.ok(!codes.includes('AGENT_WORK_SCOPE_MISMATCH'));
    await captureScreenshot(cdp,path.join(evidence,'scope-before-restart.png'));
    const exited=once(child,'exit');
    await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true');
    await exited; cdp.close(); cdp=null;
    await launch(); await openConversation();
    await wait("document.querySelector('[data-testid=agent-pause-notice] .agent-resume-action')");
    await click('[data-testid=agent-pause-notice] .agent-resume-action');
  }
  await wait("document.querySelector('[data-testid=agent-progress-summary]')");
  await wait("document.querySelector('[data-testid=workspace-tool-browser]') || document.querySelector('.browse-surface') || document.querySelector('#right-workspace-browser-page-tabs')");
  await captureScreenshot(cdp,path.join(evidence,'browser-active.png'));
  await wait(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r.length>0 && ['COMPLETED','PAUSED','FAILED'].includes(r[0].status))`);
  const run=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
  const tools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(run.id)}})`);
  await writeFile(path.join(evidence,'tool-receipts.json'),JSON.stringify(tools,null,2));
  await writeFile(path.join(evidence,'layout.json'),JSON.stringify(await cdp.eval(`(()=>({state:window.fielora.browser.getState(),nodes:[...document.querySelectorAll('.browse-panel,.browse-content,.browser-toolbar,.browse-viewport')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),gridColumns:getComputedStyle(e).gridTemplateColumns,gridRows:getComputedStyle(e).gridTemplateRows,gridFlow:getComputedStyle(e).gridAutoFlow,display:getComputedStyle(e).display,children:[...e.children].map(c=>({tag:c.tagName,cls:c.className,area:getComputedStyle(c).gridArea}))}))}))()`),null,2));
  assert.equal(run.status,'COMPLETED',JSON.stringify({run,tools:tools.map(t=>({name:t.name,status:t.status,error:t.error_code,receipt:{success:t.receipt?.success,error:t.receipt?.error_code,checks:t.receipt?.checks}}))}));
  assert.ok(tools.some(t=>t.name==='browser_server' && t.arguments.action==='start' && t.receipt.success && t.receipt.verification_eligible===false));
  const checks=tools.filter(t=>t.name==='browser_verify');
  assert.equal(checks.length,7); assert.equal(checks[0].receipt.success,false);
  assert.equal(checks[0].receipt.checks.length,6);
  assert.ok(checks[0].receipt.checks.every(check=>check.passed===false),'The initial failure must actually detect the incorrect labels');
  assert.ok(checks.slice(1).every(t=>t.receipt.success===true && t.receipt.verification_eligible===true && t.receipt.screenshot));
  assert.equal(new Set(checks.slice(1).map(t=>t.arguments.case_id)).size,6);
  let savedScreenshots=0;
  for (const [index,tool] of checks.entries()) {
    const shot=tool.receipt.screenshot;
    // A failed capture is a failed verification, and may retain useful DOM
    // diagnostics. All six successful cases above must still have screenshots.
    if (!shot) { assert.equal(tool.receipt.success,false); assert.equal(tool.receipt.error_code,'BROWSER_SCREENSHOT_FAILED'); continue; }
    const preview=await cdp.eval(`window.fielora.screenshot.preview({screenshot_evidence_id:${JSON.stringify(shot.id)},expected_content_sha256:${JSON.stringify(shot.content_sha256)}})`);
    await writeFile(path.join(evidence,`page-${index}-${tool.arguments.case_id}.png`),Buffer.from(preview.data_url.split(',')[1],'base64'));
    savedScreenshots++;
  }
  if(scoped) {
    assert.equal(await readFile(path.join(projectRoot,'i18n/cn.json'),'utf8'),'{"12044":"搜索"}');
    assert.equal(await readFile(path.join(projectRoot,'calendar.html'),'utf8'),'<button>{{T:12044}}</button>');
    assert.ok((await readFile(path.join(projectRoot,'popup.html'),'utf8')).includes('request({action:135})'));
    assert.equal(tools.filter(t=>t.name==='work_plan' && t.status==='COMPLETED').length,3);
    assert.ok(tools.filter(t=>t.name==='read_file').every(t=>t.receipt?.tool_call_id===t.id),'Model receives usable durable source ids');
  }
  assert.ok((await readFile(path.join(projectRoot,'popup.html'),'utf8')).includes('已到账金额'));
  assert.ok(!(await readFile(path.join(projectRoot,'popup.html'),'utf8')).includes('客户抬头'));
  await captureScreenshot(cdp,path.join(evidence,'verified-result.png'));
  assert.equal((await fetch(url)).status,200,'Agent-owned server remains usable for review');
  const beforeRestartPid=await cdp.eval('window.fielora.core.getHealth().then(h=>h.pid)');
  await cdp.eval('window.fieloraTest.killCore()');
  await wait(`window.fielora.core.getHealth().then(h=>h.state==='READY' && h.pid!==${beforeRestartPid})`);
  let serverStopped=false;
  for(let attempt=0;attempt<20;attempt++) { try { await fetch(url,{signal:AbortSignal.timeout(500)}); } catch { serverStopped=true;break; } await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.ok(serverStopped,'Core restart stops the owned development process tree');

  await click(`[data-testid="project-new-conversation-${ids.project.field_id}"]`);
  await wait("document.querySelector('.conversation-heading h2')?.textContent==='新对话'");
  await send('FIELORA_AGENT_FIXTURE_BROWSER OMIT_CHECKS 修复弹窗并执行浏览器验证，覆盖全部交互');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  assert.equal(await cdp.eval("document.querySelectorAll('[data-agent-state=COMPLETED]').length"),0);
  await captureScreenshot(cdp,path.join(evidence,'missing-cases-paused.png'));
  await click(`[data-testid="project-new-conversation-${ids.project.field_id}"]`);
  await wait("document.querySelector('.conversation-heading h2')?.textContent==='新对话'");
  await send('FIELORA_AGENT_FIXTURE_BROWSER STALE_SNAPSHOT 验证弹窗旧引用不得操作');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  const conversations=await cdp.eval(`window.fielora.conversation.list({field_id:${JSON.stringify(ids.project.field_id)}})`);
  const staleRuns=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(conversations[0].id)}})`);
  const staleTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(staleRuns[0].id)}})`);
  assert.ok(staleTools.some(t=>t.receipt?.error_code==='BROWSER_STALE_SNAPSHOT'));
  assert.ok(staleTools.some(t=>t.name==='browser_server' && t.arguments.action==='stop' && t.receipt.success));
  const shot=checks.at(-1).receipt.screenshot;
  assert.equal((await cdp.eval(`window.fielora.screenshot.get({screenshot_evidence_id:${JSON.stringify(shot.id)}})`)).content_sha256,shot.content_sha256);
  await click(`[data-testid="project-new-conversation-${ids.project.field_id}"]`);
  await wait("document.querySelector('.conversation-heading h2')?.textContent==='新对话'");
  await send('FIELORA_AGENT_FIXTURE_BROWSER LOAD_REALITY 检查浏览器地址、空页面与登录表单');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  const loadConversations=await cdp.eval(`window.fielora.conversation.list({field_id:${JSON.stringify(ids.project.field_id)}})`);
  const loadRun=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(loadConversations[0].id)}}).then(r=>r[0])`);
  const loadTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(loadRun.id)}})`);
  await writeFile(path.join(evidence,'load-reality.json'),JSON.stringify({run:loadRun,tools:loadTools},null,2));
  assert.equal(loadRun.status,'PAUSED'); assert.equal(loadRun.current_step,7);
  const failedLoad=loadTools.find(t=>t.name==='browser' && t.arguments.url===badUrl);
  assert.equal(failedLoad.receipt.success,false); assert.equal(failedLoad.receipt.error_code,'BROWSER_NAVIGATION_FAILED');
  assert.equal(failedLoad.receipt.page_loaded,false); assert.equal(failedLoad.receipt.snapshot_id,undefined);
  assert.equal(loadTools.find(t=>t.name==='browser_server' && t.arguments.action==='start').receipt.readiness,'NOT_LISTENING');
  assert.equal(loadTools.find(t=>t.name==='browser_server' && t.arguments.action==='status').receipt.readiness,'LISTENING');
  const empty=loadTools.find(t=>t.arguments.url===url+'__empty').receipt;
  assert.equal(empty.page_loaded,true); assert.equal(empty.content_state,'EMPTY'); assert.equal(empty.has_password_input,false);
  const login=loadTools.find(t=>t.arguments.url===url+'__login').receipt;
  assert.equal(login.page_loaded,true); assert.equal(login.content_state,'PRESENT'); assert.equal(login.has_password_input,true);
  assert.ok(!JSON.stringify(login).includes('fixture-password-redacted'));
  assert.equal(loadTools.find(t=>t.name==='browser' && t.arguments.url===url).receipt.page_loaded,true);
  assert.ok(!loadTools.some(t=>t.receipt?.verification_eligible===true));
  await captureScreenshot(cdp,path.join(evidence,'load-recovery.png'));
  // This server belongs to the test process, not to AgentBrowserHost.
  // A new run must be able to inspect it and must not stop it.
  server=createServer((_req,res)=>res.end('<html><body>Existing service remains available</body></html>'));
  await new Promise(resolve=>server.listen(Number(new URL(badUrl).port),'127.0.0.1',resolve));
  ids.conversation=await cdp.eval(`window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:'已有服务无需重新启动',provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)}})`);
  await reload(); await openConversation();
  await send('FIELORA_AGENT_FIXTURE_BROWSER UNTRACKED_SERVER 检查已有本地服务');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  const externalRun=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
  const externalTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(externalRun.id)}})`);
  assert.equal(externalRun.current_step,4); assert.equal(externalRun.status,'PAUSED');
  const probes=externalTools.filter(t=>t.name==='browser_server' && t.arguments.action==='status');
  assert.equal(probes.length,2); assert.ok(probes.every(t=>t.receipt.readiness==='LISTENING'&&t.receipt.process_tracking==='NOT_MANAGED'));
  assert.ok(externalTools.find(t=>t.name==='browser').receipt.page_loaded);
  assert.ok(!externalTools.some(t=>t.arguments.action==='start')); assert.ok(server.listening);
  await writeFile(path.join(evidence,'external-server.json'),JSON.stringify(externalTools,null,2));
  await new Promise(resolve=>server.close(resolve));
  ids.conversation=await cdp.eval(`window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:'登录交接后继续验证',provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)}})`);
  await reload(); await openConversation();
  await send('FIELORA_AGENT_FIXTURE_BROWSER LOGIN_HANDOFF 验证到账弹窗，登录完成后继续页面检查');
  await wait("document.querySelector('[data-testid=agent-pause-notice]')");
  const handoffRun=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
  const handoffTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(handoffRun.id)}})`);
  await writeFile(path.join(evidence,'login-handoff-observed.json'),JSON.stringify({run:handoffRun,tools:handoffTools},null,2));
  assert.equal(handoffRun.status,'PAUSED'); assert.equal(handoffRun.current_step,6);
  assert.equal(handoffRun.error_code,'AGENT_BROWSER_LOGIN_REQUIRED');
  assert.ok(await cdp.eval("document.querySelector('[data-testid=agent-pause-notice]').textContent.includes('右侧浏览器完成登录')"));
  assert.equal(handoffTools[2].receipt.error_code,'BROWSER_LOGIN_NOT_OBSERVED');
  assert.equal(handoffTools[4].receipt.error_code,'BROWSER_STALE_SNAPSHOT');
  const delayed=handoffTools[3].receipt;
  assert.equal(delayed.url,url+'__login'); assert.equal(delayed.page_loaded,true);
  assert.equal(delayed.content_state,'PRESENT'); assert.equal(delayed.has_password_input,true);
  assert.equal(delayed.observation_state,'SETTLED'); assert.ok(delayed.text.includes('Delayed login'));
  assert.ok(!JSON.stringify(handoffTools).includes('fixture-password-redacted'));
  assert.equal(handoffTools[5].receipt.user_action_required,'LOGIN');
  assert.ok(!handoffTools.some(t=>t.receipt.verification_eligible===true));
  await captureScreenshot(cdp,path.join(evidence,'login-handoff.png'));
  const loginShot=await cdp.eval('window.fielora.browser.captureScreenshot()');
  const loginPreview=await cdp.eval(`window.fielora.screenshot.preview({screenshot_evidence_id:${JSON.stringify(loginShot.id)},expected_content_sha256:${JSON.stringify(loginShot.content_sha256)}})`);
  await writeFile(path.join(evidence,'login-page.png'),Buffer.from(loginPreview.data_url.split(',')[1],'base64'));
  // Simulate the USER completing authentication and navigating to the target.
  // This is a fixture host action, not model credential access or an auth claim.
  await cdp.eval(`window.fielora.browser.navigate({url:${JSON.stringify(url)}})`);
  await click('[data-testid=agent-pause-notice] .agent-resume-action');
  await wait(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0].status==='COMPLETED')`);
  const resumedHandoff=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
  const resumedTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(handoffRun.id)}})`);
  assert.equal(resumedHandoff.id,handoffRun.id); assert.equal(resumedHandoff.current_step,11);
  assert.equal(resumedTools[6].arguments.action,'inspect'); assert.equal(resumedTools[6].receipt.has_password_input,false);
  assert.equal(resumedTools.filter(t=>t.name==='browser_server'&&t.arguments.action==='start').length,1);
  assert.ok(resumedTools.some(t=>t.name==='browser_verify'&&t.receipt.success&&t.receipt.screenshot));
  await writeFile(path.join(evidence,'login-handoff.json'),JSON.stringify({paused:handoffRun,completed:resumedHandoff,tools:resumedTools},null,2));
  await captureScreenshot(cdp,path.join(evidence,'login-resumed-verified.png'));
  baseValidation={status:'PASS',delayedSpaObservation:true,loginHandoffAndResume:true,loginWithoutObservedFormRejected:true,scopedWork:scoped,advisoryPlansAndEvidenceRestore:scoped,sharedTranslationsAndExistingApiPreserved:scoped,host:process.env.FIELORA_PACKAGED_EXE?'packaged':'development',externalModelRequests:0,productionTransactions:0,navigationFailureNotSuccess:true,serverProcessNotPageReady:true,existingServerInspectedWithoutAdoption:true,emptyPageNotLogin:true,passwordValueRedacted:true,recoveryUsesActualLoadFailure:true,wrongLabelsDetected:true,actualWorkspacePatched:true,autoOpenedBrowser:true,assertions:6,screenshots:savedScreenshots,failedCaptureDiagnostics:checks.filter(t=>t.receipt.error_code==='BROWSER_SCREENSHOT_FAILED').length,missingCasesPreventCompletion:true,staleSnapshotRejected:true,screenshotSurvivesRestart:true,agentStartsAndStopsDevServer:true,coreRestartStopsOwnedProcessTree:true};
  }
  ids.conversation=await cdp.eval(`window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:'窄侧栏导航与失败恢复',provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)}})`);
  await reload(); await openConversation();
  await send('FIELORA_AGENT_FIXTURE_BROWSER NARROW_NAVIGATION 在窄浏览器导航到发票，打开到账弹窗并验证七个字段');
  await wait(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r.length>0 && ['COMPLETED','PAUSED','FAILED'].includes(r[0].status))`);
  const navigationRun=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
  const navigationTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(navigationRun.id)}})`);
  await writeFile(path.join(evidence,'narrow-navigation.json'),JSON.stringify({run:navigationRun,tools:navigationTools},null,2));
  const lastNavCapture=navigationTools.findLast(t=>t.receipt?.screenshot)?.receipt.screenshot;
  if(lastNavCapture){const saved=await cdp.eval(`window.fielora.screenshot.preview({screenshot_evidence_id:${JSON.stringify(lastNavCapture.id)},expected_content_sha256:${JSON.stringify(lastNavCapture.content_sha256)}})`);await writeFile(path.join(evidence,'desktop-viewport-observed.png'),Buffer.from(saved.data_url.split(',')[1],'base64'));}
  assert.equal(navigationRun.status,'COMPLETED',JSON.stringify(navigationTools.map(t=>({args:t.arguments,error:t.error_code,receipt:{success:t.receipt?.success,error:t.receipt?.error_code,input_state:t.receipt?.input_state,url:t.receipt?.url}}))));
  assert.equal(navigationRun.current_step,15);
  assert.ok(navigationTools.every(t=>t.status!=='UNKNOWN'));
  const cover=navigationTools[3].receipt,offcanvas=navigationTools[5].receipt;
  assert.equal(cover.error_code,'BROWSER_ELEMENT_COVERED'); assert.equal(cover.input_state,'NOT_DISPATCHED'); assert.equal(cover.outcome_unknown,false);
  assert.ok(cover.snapshot_id); assert.equal(cover.interaction_target.blocker.id,'cover'); assert.ok(cover.elements.length>0);
  assert.equal(offcanvas.error_code,'BROWSER_ELEMENT_OUTSIDE_VIEWPORT'); assert.equal(offcanvas.input_state,'NOT_DISPATCHED');
  const firstPage=navigationTools[2].receipt;
  const anchor=firstPage.elements.find(e=>e.text==='发票');
  assert.equal(anchor.in_viewport,false); assert.equal(anchor.hit_target,false); assert.equal(anchor.href,url+'__navigation#/finance');
  const viewWidth=Number(firstPage.text.match(/Viewport width: (\d+)/)?.[1]);
  assert.ok(viewWidth>100&&viewWidth<1000,`Native page is actually narrow: ${viewWidth}`);
  assert.equal(navigationTools[8].receipt.url,url+'__navigation#/finance');
  assert.equal(navigationTools[8].receipt.input_state,'DISPATCHED');
  assert.ok(navigationTools[8].receipt.elements.some(e=>e.label==='到账确认'&&e.tag==='span'&&e.text===''&&!e.hit_target));
  assert.deepEqual(navigationTools[9].receipt.viewport,{width:1280,height:900});
  assert.equal(navigationTools[10].receipt.input_state,'DISPATCHED');
  assert.equal(navigationTools[10].receipt.scroll_performed,true);
  assert.ok(navigationTools[10].receipt.click_point.x>1000,'Native input targets desktop CSS coordinates');
  const navCheck=navigationTools[12].receipt;
  assert.equal(navCheck.success,true); assert.equal(navCheck.checks.length,11); assert.ok(navCheck.screenshot);
  assert.ok(navCheck.elements.some(e=>e.tag==='select'&&e.in_viewport&&e.hit_target),'The last bank control is visible in the actual modal viewport');
  const configured=navigationTools[0].receipt;
  assert.equal(configured.success,true); assert.equal(configured.pending_next_open,true);
  assert.equal(configured.observation_state,'CONFIGURED_ONLY'); assert.equal(configured.verification_eligible,false);
  assert.ok(!configured.snapshot_id); assert.ok(!configured.page_id);
  assert.deepEqual(firstPage.viewport,{width:800,height:600});
  const navPreview=await cdp.eval(`window.fielora.screenshot.preview({screenshot_evidence_id:${JSON.stringify(navCheck.screenshot.id)},expected_content_sha256:${JSON.stringify(navCheck.screenshot.content_sha256)}})`);
  await writeFile(path.join(evidence,'narrow-modal.png'),Buffer.from(navPreview.data_url.split(',')[1],'base64'));
  await captureScreenshot(cdp,path.join(evidence,'narrow-navigation-completed.png'));
  await cdp.eval(`window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:'截图与工具反馈回归',provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_pause__'})`).then(conversation=>ids.conversation=conversation);
  await reload(); await openConversation();
  await send('FIELORA_AGENT_FIXTURE_BROWSER VISUAL_FEEDBACK 修复编译错误并验证到账确认的七个字段');
  await wait(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r.length>0 && ['COMPLETED','PAUSED','FAILED'].includes(r[0].status))`);
  const visualRun=await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r[0])`);
  const visualTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(visualRun.id)}})`);
  await writeFile(path.join(evidence,'visual-feedback.json'),JSON.stringify({run:visualRun,tools:visualTools},null,2));
  assert.equal(visualRun.status,'COMPLETED',JSON.stringify(visualRun));
  assert.equal(visualRun.current_step,11);
  const brokenPage=visualTools.find(t=>t.arguments.action==='screenshot').receipt;
  assert.ok(brokenPage.text.includes('Failed to compile'));
  assert.ok(brokenPage.rendered_error_excerpt.includes('Failed to compile'));
  assert.ok(brokenPage.embedded_documents.some(d=>!d.readable));
  assert.ok(!brokenPage.text.includes('opaque-frame-sentinel'));
  assert.ok(brokenPage.embedded_documents.some(d=>d.readable && d.text.includes('SyntaxError')));
  assert.ok(visualTools.some(t=>t.name==='apply_patches'&&t.status==='COMPLETED'&&!t.arguments.expected_sha256&&t.arguments.patches[0].expected_sha256));
  assert.ok(visualTools.some(t=>t.name==='run_command'&&t.receipt.exit_code===0));
  assert.ok(visualTools.some(t=>t.name==='browser_verify'&&t.receipt.success));
  const brokenPreview=await cdp.eval(`window.fielora.screenshot.preview({screenshot_evidence_id:${JSON.stringify(brokenPage.screenshot.id)},expected_content_sha256:${JSON.stringify(brokenPage.screenshot.content_sha256)}})`);
  await writeFile(path.join(evidence,'compile-error.png'),Buffer.from(brokenPreview.data_url.split(',')[1],'base64'));
  const repairedShot=visualTools.find(t=>t.name==='browser_verify'&&t.receipt.success).receipt.screenshot;
  const repairedPreview=await cdp.eval(`window.fielora.screenshot.preview({screenshot_evidence_id:${JSON.stringify(repairedShot.id)},expected_content_sha256:${JSON.stringify(repairedShot.content_sha256)}})`);
  await writeFile(path.join(evidence,'repaired-page.png'),Buffer.from(repairedPreview.data_url.split(',')[1],'base64'));
  await captureScreenshot(cdp,path.join(evidence,'visual-feedback-completed.png'));
  baseValidation={...baseValidation,embeddedCompileErrorObserved:true,capturedPixelsReachModel:true,singlePatchHashNormalizedBeforeWrite:true,syntaxCheckAndNinePageAssertions:true};
  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({...baseValidation,status:'PASS',host:process.env.FIELORA_PACKAGED_EXE?'packaged':'development',narrowNavigationAfterPreflightFailure:true,viewportConfiguredBeforeOpen:true,coveredAndOffcanvasNoInput:true,nativeClickReachesInvoiceModal:true,desktopViewport1280x900:true,scaledNativeCoordinates:true,nestedScrollAndStickyHeader:true,partialOcclusionUsesNativeHitPoint:true,failureReturnsFreshSnapshotAndBlocker:true},null,2));
  console.log(`PASS Agent browser verification: ${evidence}`);
} catch(error) {
  console.error(error,output.slice(-4).join('')); process.exitCode=1;
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close(); await cleanupElectronProcess(child); server?.close();
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
