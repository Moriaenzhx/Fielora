import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
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
const pointerClick=async s=>{
  await wait('!document.querySelector("[data-workspace-motion=true]")');
  await cdp.eval(`document.querySelector(${JSON.stringify(s)}).scrollIntoView({block:'center'})`);await paint();
  const p=await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(s)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))};})()`);
  assert.ok(p.hit,'Operation control must be reachable by pointer');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});
  assert.equal(await cdp.eval(`getComputedStyle(document.querySelector(${JSON.stringify(s)})).backgroundColor`),'rgba(0, 0, 0, 0)','Hover keeps the text link transparent');
  for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});
  await paint();
};
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
  const checkId=tool('run_command',{program:'python3',argv:['-m','unittest','test_detector','-v'],cwd:projectRoot},{verification_eligible:true,success:true,exit_code:0});
  event('RUN_COMPLETED',{verification_passed:true,completion_basis:'VERIFIED',goal_satisfied:null,acceptance:{requirement_coverage:'UNKNOWN',verification:{passed:true,checks:[{tool_call_id:checkId,program:'python3',argv:['-m','unittest','test_detector','-v'],display_directory:'.',state:'PASSED'}]}}});
  const ref={id:'resultref_'+fixtureId().replaceAll('-',''),label:'使用说明',target:{kind:'PROJECT_FILE',field_id:ids.field,relative_path:'README.md',expected_sha256:hash},provenance:{kind:'TOOL_RECEIPT',tool_call_id:readId}};
  const copyCode='python3 -m unittest test_regression_isolated -v\npython3 run_mutation_testing.py';
  const summary='已完成项目实现，并保留原始 CSV 数据。\n\n交付文件：[`README.md`](fielora-reference:'+ref.id+')、[查看代码](fielora-project-file:README.md#L1)；[未验证路径](fielora-project-file:missing.txt)。\n\n- `README.md`：项目使用说明，点击查看。\n- `missing.py` 与参数 `name=12345` 保留为文本。\n\n**验证命令**\n\n```bash\n'+copyCode+'\n```\n\n这里是界面回放测试，不代表真实业务任务已通过独立验收。';
  await cdp.eval(`window.fielora.conversation.createMessage({conversation_id:${JSON.stringify(ids.conversation)},role:'ASSISTANT',content:${JSON.stringify(summary)},status:'COMPLETED',provider_config_id:${JSON.stringify(ids.provider)},model_id:'presentation-fixture',invocation_id:${JSON.stringify(run)},references:${JSON.stringify([ref])}})`);
  await load();await wait('document.querySelector("[data-testid=agent-terminal-result]")');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-result-verification] summary").textContent'),'已记录检查通过 · 需求覆盖未确认');
  assert.equal(await cdp.eval('Boolean(document.querySelector("[data-testid=agent-result-verification]").compareDocumentPosition(document.querySelector(".agent-terminal-body")) & Node.DOCUMENT_POSITION_FOLLOWING)'),true,'Platform evidence precedes the model report');
  await click('[data-testid=agent-result-verification] summary');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-result-verification]").open'),true);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-result-verification] code").textContent'),'python3 -m unittest test_detector -v');
  assert.equal(await cdp.eval('getComputedStyle(document.querySelector("[data-testid=agent-result-verification]")).backgroundColor'),'rgba(0, 0, 0, 0)');
  await captureScreenshot(cdp,path.join(evidence,'verification-evidence.png'));
  await click('[data-testid=agent-result-verification] summary');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-execution-detail]").hidden'),true);
  assert.equal(await cdp.eval('document.querySelector("[data-testid=agent-history-toggle]").getAttribute("aria-expanded")'),'false');
  assert.equal(await cdp.eval('document.querySelectorAll(".agent-terminal-body .markdown-typed-reference").length'),3,'Only evidence-backed paths become actionable');
  assert.equal(await cdp.eval('document.querySelectorAll(".markdown-typed-reference button, .markdown-body a button").length'),0,'Code in a link label cannot create a nested control');
  const codeStyles=await cdp.eval(`(()=>{const q=s=>document.querySelector(s),inline=getComputedStyle(q('.agent-terminal-body li > code')),block=getComputedStyle(q('.markdown-code-block')),header=getComputedStyle(q('.markdown-code-block > header'));return {inlineBackground:inline.backgroundColor,inlineBorder:inline.borderWidth,blockBackground:block.backgroundColor,headerBackground:header.backgroundColor,headerBorder:header.borderBottomWidth};})()`);
  assert.equal(codeStyles.inlineBackground,'rgba(0, 0, 0, 0)');assert.equal(codeStyles.inlineBorder,'0px');
  assert.equal(codeStyles.blockBackground,'rgb(247, 248, 250)');assert.equal(codeStyles.headerBackground,'rgba(0, 0, 0, 0)');assert.equal(codeStyles.headerBorder,'0px');
  await click('.markdown-code-block [aria-label="复制代码"]');
  await wait('document.querySelector(".markdown-code-block [aria-label=代码已复制]")');
  if(process.platform==='darwin') assert.ok(execFileSync('/usr/bin/pbpaste',{encoding:'utf8'})===copyCode,'Copy retains exact newlines and command contents');
  await click('[data-inline-file="true"]');await wait('document.querySelector("[data-testid=markdown-preview]")?.textContent.includes("RESULT_LINK_VERIFIED")');
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:close-workspace-dock"))');await paint();
  await wait('!document.querySelector("[data-workspace-motion=true]")');
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
    assert.ok(Math.abs(m.card.left-m.composer.left)<2 && Math.abs(m.card.right-m.composer.right)<2,'Result card and composer must share the reading rail: '+JSON.stringify(m));
    if(width===1600) {
      await wait('document.querySelector("[data-testid=environment-panel] [data-testid=environment-task-changes]")');
      assert.equal(await cdp.eval('document.querySelector("[data-testid=environment-summary] .environment-diff-stat").textContent'),'+8−0');
    }
    await cdp.eval('document.querySelector(".message-list").scrollTo({top:0,behavior:"instant"})');await paint();await captureScreenshot(cdp,path.join(evidence,`result-${width}.png`));
    await cdp.eval('document.querySelector(".message-list").scrollTo({top:1e7,behavior:"instant"});true');await paint();
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
  assert.equal(await cdp.eval('document.querySelector("[data-testid=operation-list]").textContent.includes("查看详情")'),false);
  await pointerClick('[data-testid=operation-row]:first-child .operation-file-link');
  await wait('document.querySelector("[data-testid=markdown-preview]")?.textContent.includes("RESULT_LINK_VERIFIED")');
  assert.equal(await cdp.eval('document.querySelectorAll("[data-testid=operation-detail]").length'),0,'A file click opens the right workspace directly');
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:close-workspace-dock"))');await paint();
  await pointerClick('[data-testid=operation-row]:nth-child(2) button');
  await wait('document.querySelector("[data-testid=operation-detail]")');
  assert.equal(await cdp.eval('document.querySelector("[data-testid=operation-row]:nth-child(2)").contains(document.querySelector("[data-testid=operation-detail]"))'),true,'Expanded command is inside its own row');
  assert.equal(await cdp.eval('getComputedStyle(document.querySelector("[data-testid=operation-list]")).maxHeight'),'none','Conversation owns scrolling, so inline detail is not trapped in a list scrollport');
  assert.equal(await cdp.eval('document.querySelector(".operation-receipt").open'),false,'Raw receipt starts collapsed');
  assert.equal(await cdp.eval('getComputedStyle(document.querySelector(".operation-detail-field.is-code pre")).maxHeight'),'240px');
  await click('[aria-label="复制命令"]');await wait('document.querySelector("[data-testid=operation-detail] [role=status]")?.textContent.includes("已复制")');
  await click('.operation-receipt summary');assert.equal(await cdp.eval('document.querySelector(".operation-receipt").open'),true);
  await click('.operation-receipt summary');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.eval('document.querySelector("[data-testid=operation-row]:nth-child(2)").scrollIntoView({block:"start"})');await paint();await captureScreenshot(cdp,path.join(evidence,'operation-detail.png'));
  await cdp.eval('[...document.querySelectorAll("[data-testid=operation-group-toggle]")].find(e=>e.textContent.includes("编辑文件")).click()');await paint();
  await cdp.eval('[...document.querySelectorAll(".operation-file-link")].find(e=>e.textContent==="db.py").click()');
  await wait('document.querySelector("[data-testid=agent-review]")?.dataset.agentRunId==='+JSON.stringify(run));
  await wait('document.querySelector(".human-review-file-heading")?.textContent.includes("db.py")');
  await wait('!document.querySelector("[data-workspace-motion=true]")');
  await cdp.eval('[...document.querySelectorAll(".operation-file-link")].find(e=>e.textContent==="db.py").scrollIntoView({block:"center"})');await paint();
  await captureScreenshot(cdp,path.join(evidence,'operation-file-review.png'));
  await cdp.eval('window.dispatchEvent(new CustomEvent("fielora:close-workspace-dock"))');await paint();
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:920,height:820,deviceScaleFactor:1,mobile:false});await paint();
  assert.equal(await cdp.eval('document.querySelector(".message-list").scrollWidth<=document.querySelector(".message-list").clientWidth+1'),true);
  await captureScreenshot(cdp,path.join(evidence,'operation-narrow.png'));
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
