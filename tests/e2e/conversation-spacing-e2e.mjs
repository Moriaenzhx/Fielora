import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

// Isolated persisted presentation replay, including the user-input pause from
// the report. No production data, credentials, model calls or tool execution.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-spacing-'));
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-spacing-evidence-'));
const baseline = process.env.FIELORA_UI_BASELINE === '1';
const output = [], metrics = [];
let child, cdp, db;
const wait = expression => waitForExpression(cdp, expression, { output });
const click = async selector => { await wait(`document.querySelector(${JSON.stringify(selector)})`); await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`); };
const paint = () => cdp.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
try {
  const projectRoot = path.join(dataRoot, 'project');
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  await wait('window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state===\'READY\')');
  const ids = await cdp.eval(`(async()=>{
    const p=await window.fieloraTest.createProject({title:'工作室项目',goal:null,root_path:${JSON.stringify(projectRoot)}});
    const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Layout fixture',base_url:'https://example.com/v1',default_model:'layout-fixture',custom_endpoint_acknowledged:true});
    const c=await window.fielora.conversation.create({field_id:p.field_id,title:'工作室项目与回款管理器',provider_config_id:provider.id,model_id:'layout-fixture'});
    const u=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:'请在当前项目中完成工作室项目与回款管理器。保留 input 中的原始 CSV 数据，并验证导入、筛选和备份恢复。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {field:p.field_id,provider:provider.id,conversation:c.id,user:u.id};
  })()`);
  db = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const rawId = randomUUID(), run = `${rawId.slice(0,14)}7${rawId.slice(15)}`, now = Date.now() - 60000;
  db.prepare(`INSERT INTO agent_runs(id,field_id,conversation_id,provider_config_id,model_id,task,permission,status,current_step,max_steps,next_sequence,error_code,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,'PAUSED',5,100,100,'AGENT_USER_INPUT_REQUIRED',?,?,NULL)`)
    .run(run, ids.field, ids.conversation, ids.provider, 'layout-fixture', '完成工作室项目与回款管理器', 'FULL_CONTROL', now, now + 26000);
  let seq = 0;
  const event = (kind, payload = {}) => db.prepare('INSERT INTO agent_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(), run, ++seq, 1, kind, JSON.stringify(payload), now + seq * 1000);
  const tool = (name, args, status = 'COMPLETED', error = null) => {
    const id = randomUUID();
    db.prepare('INSERT INTO agent_tool_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, run, name, 'OBSERVE', status, 'ALLOW', JSON.stringify(args), JSON.stringify({kind:'FILE_LIST',entries:[]}), error, now+seq*1000, now+(seq+1)*1000, now+(seq+1)*1000);
    event('TOOL_PROPOSED', {tool_call_id:id}); event(status==='FAILED'?'TOOL_FAILED':'TOOL_COMPLETED', {tool_call_id:id});
  };
  event('RUN_CREATED', {user_message_id:ids.user}); event('RUN_STARTED', {task_class:'GENERAL'});
  event('ASSISTANT_NARRATIVE', {step:1,text:'我会先检查项目目录和导入材料，再实现数据管理和备份恢复。\n\n首先核对三张 CSV 的字段，保留原始数据，并单独记录重复和冲突。'});
  tool('list_files', {path:'.'}); tool('list_files', {path:'input'}, 'FAILED', 'AGENT_FILE_NOT_FOUND');
  event('ASSISTANT_NARRATIVE', {step:4,text:'项目目录目前为空，没有找到 `input` 目录和三张 CSV。原始导入材料需要由你提供。'});
  tool('request_user_input', {reason:'当前项目目录为空，没有 input 文件夹，也没有 CSV 文件。我需要客户、项目和回款三张表才能核对导入逻辑。',question:'请把三张 CSV 放到项目的 input 文件夹，或者告诉我它们当前的位置。\n\n如果还没有材料，可以先确认数据字段，再继续实现。'});
  event('RUN_PAUSED', {error_code:'AGENT_USER_INPUT_REQUIRED'});
  await cdp.send('Page.reload');
  await click(`[data-testid="conversation-${ids.conversation}"]`);
  await wait('document.querySelector("[data-testid=agent-visible-question]")');
  for (const [width, height, size] of [[1180,760,12],[1180,760,15],[1180,760,18],[920,680,15]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
    await click('[data-testid=settings-nav]'); await click('[data-testid=settings-category-appearance]');
    await click('[data-testid=appearance-ui-font-size]'); await click(`[data-testid=appearance-ui-font-size-option-${size}]`);
    await click('[data-testid=settings-back]');
    await wait('document.querySelector("[data-testid=agent-visible-question]")');
    await paint();
    await cdp.eval('document.querySelector(".message-list").scrollTo({top:1e7,behavior:"instant"})');
    await wait('(()=>{const e=document.querySelector(".message-list");return Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<2;})()');
    await paint();
    const current = await cdp.eval(`(()=>{
      const rect=e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:e.getBoundingClientRect().height});
      const q=s=>document.querySelector(s),style=s=>getComputedStyle(q(s));
      const list=q('.message-list'),composer=q('.conversation-composer'),turn=q('.agent-turn');
      return {width:${width},size:${size},composer:rect(composer),textarea:rect(q('.conversation-composer textarea')),pause:rect(q('.agent-pause-notice')),question:rect(q('[data-testid=agent-visible-question]')),list:rect(list),scrollWidth:list.scrollWidth,clientWidth:list.clientWidth,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,
        userActions:rect(q('.message.user .message-actions')),turn:rect(turn),
        paragraphGap:parseFloat(style('.conversation-narrative .markdown-body p').marginBottom),activityGap:parseFloat(style('.conversation-activity-stream').rowGap),
        sections:[...turn.children].filter(e=>getComputedStyle(e).display!=='none').map(e=>({class:e.className,...rect(e),marginTop:getComputedStyle(e).marginTop,marginBottom:getComputedStyle(e).marginBottom,padding:getComputedStyle(e).padding}))};
    })()`);
    metrics.push(current);
    if (!baseline) {
      assert.ok(current.scrollWidth <= current.clientWidth+1, 'Conversation must not overflow horizontally');
      assert.ok(current.pause.bottom <= current.composer.top-8, 'The complete question/actions must scroll above the composer');
      if(current.scrollHeight>current.clientHeight) assert.ok(current.composer.top-current.pause.bottom <= 72, 'No oversized empty strip after the paused task');
      assert.ok(current.userActions.bottom<=current.turn.top, 'Hover actions must not overlap the next turn');
      assert.ok(current.composer.height <= 116, 'An empty composer should stay compact');
      assert.ok(current.paragraphGap <= size, 'Paragraph spacing must track the selected text size');
      assert.ok(current.activityGap <= 14, 'Narratives and operations should read as one continuous stream');
      for(let i=1;i<current.sections.length;i++) assert.ok(current.sections[i].top-current.sections[i-1].bottom<=26, 'No oversized gap between execution/status/question sections');
    }
    await captureScreenshot(cdp,path.join(evidence,`paused-${width}-${size}.png`));
    if(!baseline && size===12) {
      const point=await cdp.eval(`(()=>{const r=document.querySelector('.message.user').getBoundingClientRect();return{x:r.right-16,y:r.bottom};})()`);
      // Move through the message boundary, rather than teleporting directly
      // onto the copy control, to catch hover gaps in absolute action rows.
      for(let offset=-2;offset<=10;offset++) {
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y+offset});
        await paint();
      }
      assert.equal(await cdp.eval(`Boolean(document.elementFromPoint(${point.x},${point.y+10})?.closest('[data-testid=message-copy]'))`),true,'The copy action must remain reachable from its message');
    }
  }
  // Long drafts must grow naturally, then shrink again without covering the
  // newest content. Only input is simulated; React owns the rendered state.
  await cdp.eval(`(()=>{const t=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify('补充项目要求与数据字段。\n'.repeat(10))});t.dispatchEvent(new Event('input',{bubbles:true}));})()`); await paint();
  const grown=await cdp.eval('document.querySelector(".conversation-composer").getBoundingClientRect().height');
  assert.ok(grown>metrics.at(-1).composer.height+40,'Multiline drafts must expand');
  await cdp.eval(`(()=>{const t=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}));})()`); await paint();
  assert.ok(Math.abs(await cdp.eval('document.querySelector(".conversation-composer").getBoundingClientRect().height')-metrics.at(-1).composer.height)<2,'Cleared drafts must shrink back');
  await writeFile(path.join(evidence,'metrics.json'),JSON.stringify(metrics,null,2));
  console.log(`CONVERSATION_SPACING=${baseline?'BASELINE':'PASS'} evidence=${evidence}`);
} catch(error) {
  await writeFile(path.join(evidence,'metrics.json'),JSON.stringify(metrics,null,2));
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-3000)); throw error;
} finally {
  db?.close();
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();}
  if(child) await cleanupElectronProcess(child);
  await rm(dataRoot,{recursive:true,force:true});
}
