import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

// Isolated persisted Run replay. Real renderer, Core file opening and native
// clipboard; no production data, provider request or generated DOM replacement.
const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-result-ui-'));
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(),'fielora-result-evidence-'));
const output=[],metrics=[];let child,cdp,db;
const fixtureId=()=>{const id=randomUUID();return id.slice(0,14)+'7'+id.slice(15);};
const wait=e=>waitForExpression(cdp,e,{output});
const paint=()=>cdp.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const click=async s=>{await wait(`document.querySelector(${JSON.stringify(s)})`);await cdp.eval(`document.querySelector(${JSON.stringify(s)}).scrollIntoView({block:'center'})`);await paint();await cdp.eval(`document.querySelector(${JSON.stringify(s)}).click()`);await paint();};
try {
  const projectRoot=path.join(dataRoot,'project');await mkdir(projectRoot);await mkdir(evidence,{recursive:true});
  const content='# 工作室项目与回款管理器\n\nRESULT_LINK_VERIFIED\n';
  await writeFile(path.join(projectRoot,'README.md'),content);
  const hash=createHash('sha256').update(content).digest('hex');
  const launch=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start']});
  child=launch.child;cdp=await connectToFieloraApp({port:launch.port,output,enablePage:true,timeoutMs:120000});
  await wait('window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state===\'READY\')');
  const ids=await cdp.eval(`(async()=>{const p=await window.fieloraTest.createProject({title:'工作室项目',goal:null,root_path:${JSON.stringify(projectRoot)}});const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Presentation fixture',base_url:'https://example.com/v1',default_model:'presentation-fixture',custom_endpoint_acknowledged:true});const c=await window.fielora.conversation.create({field_id:p.field_id,title:'工作室项目与回款管理器',provider_config_id:provider.id,model_id:'presentation-fixture'});const u=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:'完成工作室项目与回款管理器，交付使用说明并验证结果。',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});return {field:p.field_id,provider:provider.id,conversation:c.id,user:u.id};})()`);
  db=new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'));db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;');
  const raw=randomUUID(),run=raw.slice(0,14)+'7'+raw.slice(15),now=Date.now()-100000;
  db.prepare(`INSERT INTO agent_runs(id,field_id,conversation_id,provider_config_id,model_id,task,permission,status,current_step,max_steps,next_sequence,error_code,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,'PAUSED',5,100,100,'AGENT_USER_INPUT_REQUIRED',?,?,NULL)`).run(run,ids.field,ids.conversation,ids.provider,'presentation-fixture','完成项目','FULL_CONTROL',now,now+60000);
  let seq=0;
  const event=(kind,payload={})=>db.prepare('INSERT INTO agent_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),run,++seq,1,kind,JSON.stringify(payload),now+seq*1000);
  const tool=(name,args,receipt,status='COMPLETED',error=null)=>{const id=fixtureId();db.prepare('INSERT INTO agent_tool_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,run,name,name==='run_command'?'PROCESS':name==='create_file'?'WORKSPACE_WRITE':'OBSERVE',status,'ALLOW',JSON.stringify(args),JSON.stringify(receipt),error,now+seq*1000,now+(seq+1)*1000,now+(seq+1)*1000);event('TOOL_PROPOSED',{tool_call_id:id});event(status==='FAILED'?'TOOL_FAILED':'TOOL_COMPLETED',{tool_call_id:id});return id;};
  event('RUN_CREATED',{user_message_id:ids.user});event('RUN_STARTED',{task_class:'GENERAL'});
  event('ASSISTANT_NARRATIVE',{step:1,text:'先读取项目文件并检查原始数据，再运行断言验证。'});
  const readId=tool('read_file',{path:'README.md'},{kind:'FILE_READ',path:'README.md',sha256:hash});
  const command='import sqlite3\n'+Array.from({length:30},(_,i)=>`print("audit step ${i}")`).join('\n');
  tool('run_command',{program:'/usr/bin/python3',argv:['-c',command],cwd:projectRoot},{cwd:projectRoot,execution_boundary:'CURRENT_USER_HOST',exit_code:1,stderr:'AssertionError: expected 15000, observed 12000',duration_ms:24},'FAILED','AGENT_PROCESS_FAILED');
  event('ASSISTANT_NARRATIVE',{step:4,text:'发现客户汇总与逐项目金额不一致，需要核对业务口径。'});
  tool('request_user_input',{question:'请确认取消项目是否排除在汇总之外。',reason:'确认业务规则。'},{kind:'USER_INPUT_REQUIRED'});event('RUN_PAUSED',{error_code:'AGENT_USER_INPUT_REQUIRED'});
  const load=async()=>{await cdp.eval('window.__resultReplayReload=true');await cdp.send('Page.reload');await wait('!window.__resultReplayReload && window.fieloraTest && document.readyState===\"complete\"');await click(`[data-testid="conversation-${ids.conversation}"]`);};
  await load();await wait('document.querySelector("[data-testid=agent-visible-question]")');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").hidden'),false,'Paused tasks must keep their process and question accessible');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]")'),null);
  // Persist a terminal result after the paused replay. Reload exercises actual
  // durable message/run pairing, not a mocked React component.
  db.prepare("UPDATE agent_runs SET status='COMPLETED',error_code=NULL,finished_at=?,updated_at=? WHERE id=?").run(now+99000,now+99000,run);
  for(const name of ['README.md','app.py','db.py','test_app.py']) tool('create_file',{path:name,content:'fixture line 1\nfixture line 2'},{kind:'FILE_CREATED',path:name});
  event('RUN_COMPLETED',{verification_passed:true,completion_basis:'VERIFIED'});
  const ref={id:'resultref_'+fixtureId().replaceAll('-',''),label:'使用说明',target:{kind:'PROJECT_FILE',field_id:ids.field,relative_path:'README.md',expected_sha256:hash},provenance:{kind:'TOOL_RECEIPT',tool_call_id:readId}};
  const summary='已完成项目实现，并保留原始 CSV 数据。\n\n交付文件：[使用说明](fielora-reference:'+ref.id+')、[查看代码](fielora-project-file:README.md#L1)；[未验证路径](fielora-project-file:missing.txt)。\n\n- 项目、回款与筛选已经实现。\n- 验证了导入、编辑和正常备份恢复。\n\n这里是界面回放测试，不代表真实业务任务已通过独立验收。';
  await cdp.eval(`window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(ids.conversation)},role:'ASSISTANT',content:${JSON.stringify(summary)},status:'COMPLETED',provider_config_id:${JSON.stringify(ids.provider)},model_id:'presentation-fixture',invocation_id:${JSON.stringify(run)},references:${JSON.stringify([ref])}})`);
  await load();await wait('document.querySelector("[data-testid=agent-terminal-result]")');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").hidden'),true);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]").getAttribute("aria-expanded")'),'false');
  assert.equal(await cdp.eval('document.querySelectorAll(".agent-terminal-body .markdown-typed-reference").length'),2,'Only evidence-backed paths become actionable');
  await wait('document.querySelector("[data-testid=agent-result-changed-files]")');
  assert.equal(await cdp.eval('document.querySelector(".file-delivery-totals").textContent'),'+8−0');
  assert.equal(await cdp.eval('document.querySelectorAll(".agent-result-file-list > button").length'),3);
  await click('[data-testid=agent-changed-files-toggle]');
  assert.equal(await cdp.eval('document.querySelectorAll(".agent-result-file-list > button").length'),4);
  await click('[data-testid=agent-changed-files-toggle]');
  for(const width of [1600,1440,1180,920]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:820,deviceScaleFactor:1,mobile:false});await paint();
    const m=await cdp.eval(`(()=>{const q=s=>document.querySelector(s),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};};const l=q('.message-list'),t=q('[data-testid=agent-terminal-result]'),h=q('[data-testid=agent-execution-detail]');return {width:innerWidth,scrollWidth:l.scrollWidth,clientWidth:l.clientWidth,hiddenHeight:h.getBoundingClientRect().height,resultVisible:t.getBoundingClientRect().height>0,list:rect(l),card:rect(q('.file-delivery-card')),header:rect(q('.agent-result-changes-header')),row:rect(q('.agent-result-file-list > button')),composer:rect(q('.conversation-composer')),fileFont:getComputedStyle(q('.file-delivery-path')).fontSize};})()`);
    assert.ok(m.scrollWidth<=m.clientWidth+1);assert.equal(m.hiddenHeight,0);assert.equal(m.resultVisible,true);metrics.push(m);
    assert.ok(Math.abs(m.card.left-m.composer.left)<2 && Math.abs(m.card.right-m.composer.right)<2,'Result card and composer must share the reading rail');
    if(width===1600) {
      await wait('document.querySelector("[data-testid=environment-panel] [data-testid=environment-task-changes]")');
      assert.equal(await cdp.eval('document.querySelector("[data-testid=environment-summary] .environment-diff-stat").textContent'),'+8−0');
    }
    await cdp.eval('document.querySelector(".message-list").scrollTop=0');await paint();await captureScreenshot(cdp,path.join(evidence,`result-${width}.png`));
    await cdp.eval('document.querySelector(".message-list").scrollTop=1e7;true');await paint();
    assert.ok(await cdp.eval('document.querySelector(".file-delivery-card").getBoundingClientRect().bottom<=document.querySelector(".conversation-composer").getBoundingClientRect().top-8'),'The entire result card must scroll clear of the composer');
    await captureScreenshot(cdp,path.join(evidence,`result-bottom-${width}.png`));
  }
  // Changes goes straight to review; the environment control only discloses
  // workspace information. Opening review also dismisses an open popover.
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1180,height:820,deviceScaleFactor:1,mobile:false});await paint();
  await click('[data-testid=environment-menu-toggle]');await wait('document.querySelector("[data-testid=environment-popover]")');
  assert.equal(await cdp.eval('Boolean(document.querySelector(".project-layout.workspace-open"))'),false);
  await click('[data-testid=environment-changes-summary]');await wait('document.querySelector("[data-testid=agent-review]")?.dataset.fileCount==="4"');
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=environment-popover]"))'),false);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-review]").dataset.agentRunId'),run);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-review]").dataset.additions'),'8');
  await wait('!document.querySelector("[data-workspace-motion=true]")');await paint();
  await captureScreenshot(cdp,path.join(evidence,'changes-direct-review.png'));
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:close-workspace-dock"))');await paint();
  await click('.agent-terminal-body .markdown-typed-reference:nth-of-type(2)');await wait('document.querySelector(".cm-content")?.textContent.includes("RESULT_LINK_VERIFIED")');
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:close-workspace-dock"))');await paint();
  await click('.agent-terminal-body .markdown-typed-reference');await wait('document.querySelector("[data-testid=markdown-preview]")?.textContent.includes("RESULT_LINK_VERIFIED")');
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:close-workspace-dock"))');await paint();
  await click('[data-testid=agent-history-toggle]');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").hidden'),false);
  await click('[data-testid=operation-group-toggle]');
  await click('[data-testid=operation-row]:nth-child(2) button');
  await wait('document.querySelector("[data-testid=operation-detail]")');
  assert.equal(await cdp.eval('document.querySelector(".operation-receipt").open'),false,'Raw receipt starts collapsed');
  assert.equal(await cdp.eval('getComputedStyle(document.querySelector(".operation-detail-field.is-code pre")).maxHeight'),'240px');
  await click('[aria-label="复制命令"]');await wait('document.querySelector("[data-testid=operation-detail] [role=status]")?.textContent.includes("已复制")');
  await click('.operation-receipt summary');assert.equal(await cdp.eval('document.querySelector(".operation-receipt").open'),true);
  await click('.operation-receipt summary');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.eval('document.querySelector("[data-testid=operation-detail]").scrollIntoView({block:"start"})');await paint();await captureScreenshot(cdp,path.join(evidence,'operation-detail.png'));
  await click('[data-testid=agent-history-toggle]');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").hidden'),true);
  // Native keyboard activation must also toggle the disclosure.
  await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]").focus()');
  for(const type of ['keyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
  await wait('!document.querySelector("[data-testid=agent-execution-detail]").hidden');
  await load();await wait('document.querySelector("[data-testid=agent-execution-detail]")?.hidden');
  await writeFile(path.join(evidence,'metrics.json'),JSON.stringify({status:'PASS',metrics,verified:['changes opens matching task review directly','environment only toggles information','review dismisses environment popover','terminal collapse','toggle and keyboard','paused question remains visible','raw receipt disclosure','bounded command preview','copy feedback','safe final file link opens editor','unresolved link stays inert','reload collapse']},null,2));
  console.log('CONVERSATION_RESULT_PRESENTATION=PASS evidence='+evidence);
} catch(e) {
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-2500));throw e;
} finally {
  db?.close();if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();}if(child)await cleanupElectronProcess(child);await rm(dataRoot,{recursive:true,force:true});
}
