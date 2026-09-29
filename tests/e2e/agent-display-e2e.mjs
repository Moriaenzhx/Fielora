import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-display-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-display-20260924/desktop'));
const output = []; let child; let cdp; let ids; let clipboardVerified=false;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs: 60000, output });
const click = async selector => { await wait(`document.querySelector(${JSON.stringify(selector)})`); await cdp.eval(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});let e=target.parentElement;while(e){if(e.matches('details:not([open])') && e.querySelector(':scope > summary')!==target)e.open=true;e=e.parentElement}target.click()})()`); };
async function show(conversation) {
  await cdp.eval('window.__displayReload=true'); await cdp.send('Page.reload');
  await wait("typeof window.__displayReload==='undefined' && window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await click(`[data-testid="conversation-${conversation.id}"]`);
}
async function display(mode) {
  await click('[data-testid=settings-nav]'); await click('[data-testid=agent-display-mode]');
  await click(`[data-testid=agent-display-mode-option-${mode}]`);
  assert.equal(await cdp.eval("JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).agentDisplayMode"), mode);
  await click('[data-testid=settings-back]');
  await wait(`document.querySelector('[data-agent-display="${mode.toLowerCase()}"]')`);
}
async function hover(selector) {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  await cdp.eval(`(()=>{let e=document.querySelector(${JSON.stringify(selector)}).parentElement;while(e){if(e.matches('details:not([open])'))e.querySelector(':scope > summary')?.click();e=e.parentElement}})()`);
  await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  const point = await cdp.eval(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+Math.min(r.width/2,80),y:r.top+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', ...point });
}
try {
  await mkdir(projectRoot); await mkdir(evidence,{recursive:true});
  await writeFile(path.join(projectRoot,'login.js'),'exports.ready = false;\n');
  await writeFile(path.join(projectRoot,'verify.cjs'),"setTimeout(()=>require('node:assert/strict').equal(require('./login.js').ready,true),3500);\n");
  await writeFile(path.join(projectRoot,'evidence.txt'),Array.from({length:30},(_,i)=>`Evidence ${i+1} ${'context '.repeat(400)}`).join('\n'));
  assert.equal(spawnSync('git.exe',['init'],{cwd:projectRoot,windowsHide:true}).status,0);
  const launched = await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,executablePath:process.env.FIELORA_PACKAGED_EXE,
    args:[],extraEnv:{Path:`${path.dirname(process.execPath)};${process.env.Path??''}`}});
  child=launched.child; cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:859,deviceScaleFactor:1,mobile:false});
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await click('[data-testid=settings-nav]');
  assert.equal(await cdp.eval("document.querySelector('[data-testid=agent-display-mode]').closest('.ui-select').dataset.value"),'COMPACT');
  await captureScreenshot(cdp,path.join(evidence,'settings.png')); await click('[data-testid=settings-back]');
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Display fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_pause__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'执行展示验证',goal:null,root_path:${JSON.stringify(projectRoot)}});const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'精简操作与上下文压缩',provider_config_id:provider.id,model_id:provider.default_model});return{provider,project,conversation}})()`);
  const task='FIELORA_AGENT_FIXTURE_CONTINUITY_LONG FIELORA_COMPACT_DETAILS 修复登录初始化并验证';
  ids.run=await cdp.eval(`(async()=>{const user=await window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(ids.conversation.id)},role:'USER',content:${JSON.stringify(task)},status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:user.conversation_id,user_message_id:user.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:${JSON.stringify(ids.provider.default_model)},task:${JSON.stringify(task)},permission:'FULL_CONTROL',max_steps:40,attachments:[]})})()`);
  await show(ids.conversation);
  await wait("document.querySelector('[data-agent-state=RUNNING] [data-testid=compact-activity-row]')");
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=conversation-activity-group]').length"),0);
  await wait("document.querySelector('[data-testid=agent-running-label]')?.textContent==='正在思考'");
  await wait("document.querySelector('.is-working')");
  await wait("[...document.querySelectorAll('.is-working > summary > span,.agent-running-label.is-working,.is-working .compact-activity-label')].some(e=>getComputedStyle(e).animationName==='agent-execution-breathe')");
  await captureScreenshot(cdp,path.join(evidence,'compact-running.png'));
  await wait("document.querySelector('[data-testid=compact-category]')");
  await cdp.eval("window.__stableCategory=document.querySelector('[data-testid=compact-category]');window.__stableHeader=document.querySelector('[data-testid=agent-running-header]');window.__stableAction=document.querySelector('[data-testid=agent-current-action]');window.__stableOffset=window.__stableCategory.getBoundingClientRect().top-window.__stableHeader.getBoundingClientRect().top;window.__stableCategory.open=true");
  await wait("document.querySelectorAll('[data-testid=compact-activity-row]').length>=6");
  assert.equal(await cdp.eval("window.__stableCategory===document.querySelector('[data-testid=compact-category]') && window.__stableCategory.open && window.__stableHeader===document.querySelector('[data-testid=agent-running-header]')"),true);
  assert.ok(await cdp.eval("Math.abs(window.__stableCategory.getBoundingClientRect().top-window.__stableHeader.getBoundingClientRect().top-window.__stableOffset)<2"));
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=agent-running-header] button,[data-testid=agent-running-header] .app-icon,[data-testid=agent-progress-summary]').length"),0);
  assert.equal(await cdp.eval("window.__stableAction===document.querySelector('[data-testid=agent-current-action]') && !window.__stableHeader.textContent.includes('正在') && !!(document.querySelector('[data-testid=conversation-activity-stream]').compareDocumentPosition(window.__stableAction)&Node.DOCUMENT_POSITION_FOLLOWING)"),true);
  assert.equal(await cdp.eval("document.querySelectorAll('.compact-process-notes,[data-testid=agent-current-action] summary,[data-testid=agent-current-action] .app-icon').length"),0);
  await cdp.eval("window.__stableCategory.open=false");
  const closedArrow=await cdp.eval("getComputedStyle(window.__stableCategory.querySelector('summary > .app-icon:last-child')).transform");
  await cdp.eval("window.__stableCategory.open=true");
  const openArrow=await cdp.eval("getComputedStyle(window.__stableCategory.querySelector('summary > .app-icon:last-child')).transform");
  assert.equal(closedArrow,'matrix(0, -1, 1, 0, 0, 0)');
  assert.equal(openArrow,'none');
  await cdp.eval("window.__stableCategory.open=false");

  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:100});
  assert.equal(await cdp.eval("getComputedStyle(window.__stableCategory.querySelector('summary > .app-icon:last-child')).opacity"),'0');
  const beforeHover=await cdp.eval("window.__stableCategory.getBoundingClientRect().height");
  const summaryPoint=await cdp.eval("(()=>{const r=window.__stableCategory.querySelector('summary').getBoundingClientRect();return{x:r.left+80,y:r.top+r.height/2}})()");
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...summaryPoint});
  assert.equal(await cdp.eval("getComputedStyle(window.__stableCategory.querySelector('summary > .app-icon:last-child')).opacity"),'1');
  assert.equal(await cdp.eval("window.__stableCategory.getBoundingClientRect().height"),beforeHover);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await cdp.eval("window.__stableCategory.querySelector('summary').focus()");
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:100});
  assert.equal(await cdp.eval("getComputedStyle(window.__stableCategory.querySelector('summary > .app-icon:last-child')).opacity"),'1');
  await cdp.eval("document.activeElement.blur()");
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait("document.documentElement.dataset.reduceMotion==='true' && [...document.querySelectorAll('.is-working > summary > span,.agent-running-label.is-working,.is-working .compact-activity-label')].every(e=>getComputedStyle(e).animationName==='none')");
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await wait("document.documentElement.dataset.reduceMotion==='false'");
  await wait("document.querySelector('.compact-category[data-category=COMMAND].is-working')");
  assert.equal(await cdp.eval("document.querySelector('[data-testid=agent-running-label]').textContent.includes('正在思考')"),false);
  assert.equal(await cdp.eval("document.querySelector('[data-testid=agent-running-label]').textContent"),'');
  assert.equal(await cdp.eval("getComputedStyle(document.querySelector('.compact-category[data-category=COMMAND].is-working > summary > span')).animationName"),'agent-execution-breathe');
  await cdp.eval("document.querySelector('.compact-category[data-category=COMMAND]').scrollIntoView({block:'center'})");
  await captureScreenshot(cdp,path.join(evidence,'active-command-breathing.png'));
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait("getComputedStyle(document.querySelector('.compact-category[data-category=COMMAND] > summary > span')).animationName==='none'");
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await wait("document.documentElement.dataset.reduceMotion==='false'");
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(ids.run.id)}}).then(r=>r.status==='COMPLETED')`);
  await wait("document.querySelector('[data-agent-state=COMPLETED] .compact-activity-row')");
  const events=await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(ids.run.id)},after_sequence:null,limit:500})`);
  const modelStarts=events.filter(e=>e.kind==='MODEL_STARTED');
  const modelEnds=events.filter(e=>e.kind==='MODEL_COMPLETED' || e.kind==='MODEL_FAILED');
  assert.ok(modelStarts.length>0); assert.equal(modelStarts.length,modelEnds.length);
  for(let i=0;i<modelStarts.length;i++){assert.ok(modelStarts[i].sequence<modelEnds[i].sequence); if(i+1<modelStarts.length)assert.ok(modelEnds[i].sequence<modelStarts[i+1].sequence);}
  const starts=events.filter(e=>e.payload.kind==='GENERAL_CONTEXT_REDUCTION_STARTED');
  const reductions=events.filter(e=>e.payload.kind==='GENERAL_CONTEXT_REDUCED');
  assert.ok(starts.length>0); assert.equal(starts.length,reductions.length);
  assert.ok(reductions.some(e=>e.payload.after_bytes<e.payload.before_bytes));
  await writeFile(path.join(evidence,'context-events.json'),JSON.stringify(events.filter(e=>e.payload.kind?.startsWith('GENERAL_CONTEXT_')),null,2));
  assert.equal(await cdp.eval("document.querySelectorAll('[data-context-state=COMPLETED]').length"),reductions.length);
  assert.equal(await cdp.eval("document.querySelectorAll('.is-working').length"),0);
  assert.equal(await cdp.eval("document.querySelectorAll('[data-testid=compact-execution-history]').length"),0);
  assert.ok(await cdp.eval("[...document.querySelectorAll('[data-testid=conversation-narrative]')].some(e=>!e.closest('details') && e.innerText.length>0)"));
  assert.ok(await cdp.eval("[...document.querySelectorAll('[data-testid=context-compaction]')].every(e=>e.querySelector('summary [data-icon=contextCompress]'))"));
  const deliveryCard = await cdp.eval("(()=>{const card=document.querySelector('[data-testid=agent-result-changed-files]'),row=card?.querySelector('[data-review-path]');return{tag:card?.tagName,rows:card?.querySelectorAll('[data-review-path]').length,path:row?.dataset.reviewPath,visible:row?.getBoundingClientRect().height>0,review:card?.querySelector('.agent-full-review-action')?.textContent,expanded:card?.classList.contains('is-expanded'),addition:getComputedStyle(card.querySelector('.agent-result-file-list em b')).color,deletion:getComputedStyle(card.querySelector('.agent-result-file-list em i')).color}})()");
  assert.equal(deliveryCard.tag,'SECTION'); assert.equal(deliveryCard.rows,1); assert.equal(deliveryCard.path,'login.js');
  assert.equal(deliveryCard.visible,true); assert.equal(deliveryCard.review,'审核'); assert.equal(deliveryCard.expanded,false);
  assert.notEqual(deliveryCard.addition,deliveryCard.deletion);
  assert.ok(await cdp.eval("document.querySelectorAll('[data-testid=compact-category]').length>0"));
  assert.equal(await cdp.eval("[...document.querySelectorAll('.compact-activity-label')].some(e=>/确认当前请求|整理任务结果/.test(e.textContent))"),false);
  const compactFacts=await cdp.eval("(()=>{const stream=document.querySelector('[data-testid=conversation-activity-stream]');return {visibleContext:[...stream.querySelectorAll('[data-testid=context-compaction]')].filter(e=>e.checkVisibility()).length,visibleRawCode:[...stream.querySelectorAll('pre')].filter(e=>e.checkVisibility()).length,fullNotes:stream.querySelectorAll('.compact-operation-notes').length,overflow:stream.querySelectorAll('.compact-narrative-overflow').length,summaryText:[...stream.querySelectorAll('.compact-category > summary')].map(e=>e.textContent)}})()");
  assert.equal(compactFacts.visibleContext,0); assert.equal(compactFacts.visibleRawCode,0);
  assert.ok(compactFacts.fullNotes>0); assert.ok(compactFacts.overflow>0);
  assert.ok(compactFacts.summaryText.every(s=>!s.includes('verify.cjs')));
  await writeFile(path.join(evidence,'compact-facts.json'),JSON.stringify(compactFacts,null,2));
  await captureScreenshot(cdp,path.join(evidence,'compact-categorized.png'));
  await click('[data-testid=compact-category] > summary');
  assert.equal(await cdp.eval("document.querySelector('[data-testid=compact-category]').open"),true);
  await captureScreenshot(cdp,path.join(evidence,'compact-category-expanded.png'));
  const command='.compact-activity-row:has([data-icon=terminal])';
  const commandSummary=await cdp.eval(`document.querySelector('${command}').closest('.compact-category').dataset.single==='true'`) ? '.compact-category:has(.compact-activity-row [data-icon=terminal]) > summary' : `${command} > summary`;
  await click(commandSummary);
  assert.equal(await cdp.eval(`document.querySelector('${command}').open`),true);
  assert.ok(await cdp.eval(`document.querySelector('${command} .compact-command-panel').innerText.includes('node verify.cjs')`));
  assert.ok(await cdp.eval(`document.querySelector('${command} footer').innerText.includes('退出码 0')`));
  await click(`${command} [aria-label=复制命令]`);
  await wait(`document.querySelector('${command} [aria-label=复制命令] [data-icon=check]')`);
  let copiedCommand;
  for(let attempt=0;attempt<5;attempt++) {
    copiedCommand=spawnSync('powershell.exe',['-NoProfile','-STA','-Command','Get-Clipboard -Raw'],{encoding:'utf8',windowsHide:true});
    if(copiedCommand.status===0) break;
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  await writeFile(path.join(evidence,'clipboard-shell-probe.json'),JSON.stringify({status:copiedCommand.status,stderr:copiedCommand.status===0?'':copiedCommand.stderr},null,2));
  // Validate the user's actual copy/paste path in Chromium, independently of
  // PowerShell's clipboard apartment/session support. Never inject paste text.
  await cdp.eval("document.querySelector('textarea[name=prompt]').focus()");
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:2});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:2});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17});
  try {
    await waitForExpression(cdp,"document.querySelector('textarea[name=prompt]').value.includes('node verify.cjs')",{timeoutMs:6000,output});
    clipboardVerified=true;
  } catch {
    await writeFile(path.join(evidence,'clipboard-failure.json'),JSON.stringify({status:'FAILED',nativePaste:false,shellReadStatus:copiedCommand.status},null,2));
  }
  await cdp.eval("(()=>{const e=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await hover(commandSummary);
  await wait("document.querySelector('.ui-tooltip--timestamp') && getComputedStyle(document.querySelector('.ui-tooltip--timestamp')).visibility==='visible'");
  const tooltip=await cdp.eval(`(()=>{const tip=document.querySelector('.ui-tooltip--timestamp'),s=getComputedStyle(tip),host=document.querySelector(${JSON.stringify(commandSummary)}).closest('[data-recorded-at]');return{text:tip.textContent,expected:new Date(Number(host.dataset.recordedAt)).toLocaleString('zh-CN',{hour12:false}),background:s.backgroundColor,radius:s.borderRadius,token:getComputedStyle(document.documentElement).getPropertyValue('--fl-color-timestamp-background').trim()}})()`);
  assert.equal(tooltip.text,tooltip.expected); assert.equal(tooltip.radius,'8px');
  assert.equal(tooltip.background, 'rgb(255, 255, 255)');
  await captureScreenshot(cdp,path.join(evidence,'compact-command-time.png'));
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait("!document.querySelector('.ui-tooltip--timestamp')");
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:100});
  await wait("!document.querySelector('.ui-tooltip--timestamp')");
  await click('[data-testid=context-compaction] > summary');
  await cdp.eval("document.querySelector('[data-testid=context-compaction]').scrollIntoView({block:'center'})");
  await captureScreenshot(cdp,path.join(evidence,'context-completed.png'));
  await display('DETAILED');
  assert.ok(await cdp.eval("[...document.querySelectorAll('.conversation-activity-group,.conversation-tool-detail')].every(e=>e.open)"));
  await show(ids.conversation);
  await wait("document.querySelector('[data-agent-display=detailed] .conversation-tool-detail[open]')");
  await captureScreenshot(cdp,path.join(evidence,'detailed.png'));
  await display('COMPACT');
  await show(ids.conversation);
  await wait("document.querySelector('[data-agent-display=compact] .compact-activity-row')");
  assert.equal(await cdp.eval("document.querySelectorAll('.compact-category[open],.compact-category:not(.is-single) .compact-activity-row[open]').length"),0);
  await click('[data-testid=settings-nav]'); await click('[data-testid=settings-category-appearance]');
  await click('[data-testid=appearance-theme-dark]'); await click('[data-testid=settings-back]');
  await wait("document.documentElement.dataset.effectiveAppearance==='dark'");
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:780,height:859,deviceScaleFactor:1,mobile:false});
  await hover('.compact-activity-row > summary:not([hidden])');
  await wait("document.querySelector('.ui-tooltip--timestamp')");
  await wait("getComputedStyle(document.querySelector('.ui-tooltip--timestamp')).visibility==='visible'");
  assert.equal(await cdp.eval("getComputedStyle(document.querySelector('.ui-tooltip--timestamp')).backgroundColor"), 'rgb(255, 255, 255)');
  const overflowRows = await cdp.eval("[...document.querySelectorAll('.compact-activity-row')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({label:e.querySelector('summary').textContent,width:e.clientWidth,scroll:e.scrollWidth,hidden:!!e.parentElement.closest('details:not([open])')}))");
  assert.deepEqual(overflowRows, []);

  await captureScreenshot(cdp,path.join(evidence,'compact-narrow-dark.png'));
  await click('[data-testid=agent-result-changed-files] [data-review-path="login.js"]');
  await wait("document.querySelector('[data-testid=agent-review]')");
  await captureScreenshot(cdp,path.join(evidence,'review-narrow-dark.png'));
  // The existing complete-skill fixture yields four real file revisions.
  await writeFile(path.join(projectRoot,'verify-unrelated.cjs'), "console.log('fixture check');\n");
  const multiple=await cdp.eval(`(async()=>{const conversation=await window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:'四文件交付卡',provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_outcomes__'});const task='安装 Skill 的缺失资源修复回归';const user=await window.fielora.conversation.createMessage({conversation_id:conversation.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});const run=await window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:conversation.id,user_message_id:user.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_outcomes__',task,permission:'FULL_CONTROL',max_steps:null});return{conversation,run}})()`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(multiple.run.id)}}).then(r=>r.status==='PAUSED')`);
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(multiple.run.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(multiple.run.id)}}).then(r=>r.status==='COMPLETED')`);
  await click('[data-testid=settings-nav]'); await click('[data-testid=settings-category-appearance]');
  await click('[data-testid=appearance-theme-light]'); await click('[data-testid=settings-back]');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1478,height:859,deviceScaleFactor:1,mobile:false});
  await show(multiple.conversation);
  const card='[data-testid=agent-result-changed-files]';
  await wait(`document.querySelector('${card}')?.dataset.fileCount==='4'`);
  await cdp.eval(`document.querySelector('${card}').scrollIntoView({block:'center'})`);
  assert.equal(await cdp.eval(`document.querySelectorAll('${card} [data-review-path]').length`),3);
  assert.equal(await cdp.eval(`document.querySelector('${card} .agent-result-changes-icon [data-icon=reviewChanges]')!==null && document.querySelector('${card} .agent-full-review-action').textContent==='审核' && !document.querySelector('${card} .agent-full-review-action .app-icon')`),true);
  await captureScreenshot(cdp,path.join(evidence,'four-files-light.png'));
  const clip=await cdp.eval(`(()=>{const r=document.querySelector('${card}').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',clip});
  await writeFile(path.join(evidence,'four-files-card.png'),Buffer.from(shot.data,'base64'));
  await click('[data-testid=agent-changed-files-toggle]');
  assert.equal(await cdp.eval(`document.querySelectorAll('${card} [data-review-path]').length`),4);
  await click('[data-testid=agent-changed-files-toggle]');
  await click('.file-delivery-view'); await wait("document.querySelector('[data-testid=agent-review]')");
  await captureScreenshot(cdp,path.join(evidence,'view-changes-opened.png'));

  // Real Core loop with a deterministic uncooperative model: novel edits and
  // different arguments must not perpetually reset the recovery detector.
  await writeFile(path.join(projectRoot,'check.cjs'),"console.log(JSON.stringify({ok:false,stage:'validate',diagnostics:[{code:'layout/error',message:'fixture layout remains invalid'}]}));process.exitCode=1;\n");
  const recovery=await cdp.eval(`(async()=>{const conversation=await window.fielora.conversation.create({field_id:${JSON.stringify(ids.project.field_id)},title:'恢复停滞回归',provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_pause__'});const task='FIELORA_AGENT_FIXTURE_CONVERGENCE 修复文件并验证失败恢复';const user=await window.fielora.conversation.createMessage({conversation_id:conversation.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});const run=await window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:conversation.id,user_message_id:user.id,provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_pause__',task,permission:'FULL_CONTROL',max_steps:null});return {run,conversation}})()`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(recovery.run.id)}}).then(r=>r.status==='PAUSED')`);
  const recoveryFacts=await cdp.eval(`(async()=>{const run=await window.fielora.agent.get({run_id:${JSON.stringify(recovery.run.id)}});const events=await window.fielora.agent.events({run_id:run.id,after_sequence:null,limit:500});return {run,plateaus:events.filter(e=>e.payload.kind==='COMMAND_RECOVERY_PLATEAU')}})()`);
  await writeFile(path.join(evidence,'recovery-plateau.json'),JSON.stringify(recoveryFacts,null,2));
  assert.equal(recoveryFacts.run.error_code,'AGENT_REPEATED_ACTIONS');
  assert.equal(recoveryFacts.plateaus.length,1);
  assert.equal(recoveryFacts.plateaus[0].payload.failed_attempts_since_improvement,8);
  assert.ok(recoveryFacts.run.current_step<=17);
  await writeFile(path.join(evidence,'recovery-plateau.json'),JSON.stringify(recoveryFacts,null,2));
  await show(recovery.conversation); await captureScreenshot(cdp,path.join(evidence,'bounded-recovery.png'));

  await writeFile(path.join(evidence,'validation.json'),JSON.stringify({status:clipboardVerified?'PASS':'PARTIAL_CLIPBOARD_FAILED',host:'packaged',externalModelRequests:0,defaultCompact:true,novelEditsDoNotResetPlateau:true,detailsHiddenUntilExpanded:true,persistedBothModes:true,stableCategoryIdentity:true,stableElapsedHeader:true,stableBottomAction:true,noStandaloneProcessNotes:true,leftReviewGlyph:true,textReviewButton:true,fourFilesExpansion:true,noEmptyThinkingDisclosure:true,consistentDisclosureDirections:true,commandExpansion:true,copyCommand:clipboardVerified,commandOutputLimitationExplicit:true,hoverDisclosure:true,keyboardDisclosure:true,noHoverLayoutShift:true,narrativeInTimeline:true,contextPairs:starts.length,realCompression:true,timeTooltip:tooltip,escapeDismissal:true,reducedMotion:true,terminalStopsAnimation:true,activeCommandBreathes:true,noThinkingDuringCommand:true,pairedModelLifecycle:true,narrowNoOverflow:true,darkMode:true},null,2));
  console.log(`PASS compact presentation and recovery assertions: ${evidence}`);
  assert.ok(clipboardVerified,'Native clipboard round-trip failed; independent display/recovery assertions completed and evidence retained.');
} catch(error) {
  console.error(error,output.slice(-4).join(''));process.exitCode=1;
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close();await cleanupElectronProcess(child);
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
