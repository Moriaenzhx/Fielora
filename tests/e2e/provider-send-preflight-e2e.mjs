import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

// Real UI + Main + Core, isolated database, synthetic credentials/model only.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-send-preflight-'));
const evidence = await mkdtemp(path.join(tmpdir(), 'fielora-send-preflight-evidence-'));
const output = [], q = JSON.stringify;
let child, cdp, db;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs:60000 });
const click = async selector => { await wait(`document.querySelector(${q(selector)})`); await cdp.eval(`document.querySelector(${q(selector)}).click()`); };
const reload = async () => { await cdp.eval('window.__preflightReload=true'); await cdp.send('Page.reload'); await wait("window.__preflightReload!==true && window.fielora && document.querySelector('[data-testid=settings-nav]')"); };
const input = async text => cdp.eval(`(()=>{const e=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${q(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
try {
  const projectRoot = path.join(dataRoot, 'project'); await mkdir(projectRoot);
  execFileSync('git',['init'],{cwd:projectRoot,stdio:'ignore'});
  const launched = await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start']});
  child = launched.child;
  cdp = await connectToFieloraApp({port:launched.port,output,enablePage:true,timeoutMs:120000});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1180,height:820,deviceScaleFactor:1,mobile:false});
  const ids = await cdp.eval(`(async()=>{
    let p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'发送检查（测试模型）',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture__',custom_endpoint_acknowledged:true});
    p=await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-preflight-only'});
    const project=await window.fieloraTest.createProject({title:'发送前检查',goal:null,root_path:${q(projectRoot)}});
    return {provider:p.id,field:project.field_id};
  })()`);
  await reload();
  await click(`[data-testid="project-${ids.field}"]`);
  await wait('document.querySelector("textarea[name=prompt]")');
  db = new DatabaseSync(path.join(dataRoot,'Fielora/data/fielora.db'));
  db.exec('PRAGMA busy_timeout=5000');
  // UI still holds credential_present=true; the actual secret is unavailable.
  db.prepare('UPDATE local_credentials SET secret=NULL').run();
  const draft = 'FIELORA_AGENT_FIXTURE_CREATE 请创建并验证项目文件。';
  await input(draft);
  await click('[data-testid=send-message]');
  await wait("document.querySelector('[role=alert]')?.textContent.includes('尚未发送')");
  const counts = () => ({conversations:db.prepare('SELECT COUNT(*) n FROM conversations').get().n,messages:db.prepare('SELECT COUNT(*) n FROM conversation_messages').get().n,runs:db.prepare('SELECT COUNT(*) n FROM agent_runs').get().n});
  assert.deepEqual(counts(),{conversations:0,messages:0,runs:0});
  assert.equal(await cdp.eval('document.querySelector("textarea[name=prompt]").value'),draft);
  // Keyboard submission must follow the same gate, with no duplicate entries.
  await cdp.eval('document.querySelector("textarea[name=prompt]").form.requestSubmit()');
  await wait("document.querySelector('[role=alert]')?.textContent.includes('尚未发送') && !document.querySelector('[data-testid=send-message]').disabled");
  assert.deepEqual(counts(),{conversations:0,messages:0,runs:0});
  await captureScreenshot(cdp,path.join(evidence,'blocked-draft-retained.png'));
  // Saving a key repairs admission; a single explicit send is accepted once.
  await cdp.eval(`window.fielora.provider.storeCredential({provider_config_id:${q(ids.provider)},secret:'synthetic-preflight-only'})`);
  await click('[data-testid=composer-permission]'); await click('[data-testid=composer-permission-option-FULL_CONTROL]');
  await click('[data-testid=send-message]');
  await wait(`window.fielora.conversation.list({field_id:${q(ids.field)}}).then(async cs=>cs.length===1 && (await window.fielora.agent.list({conversation_id:cs[0].id})).some(r=>r.status==='COMPLETED'))`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE role='USER'").get().n,1);
  assert.equal(counts().runs,1); assert.equal(counts().conversations,1);
  assert.equal(await cdp.eval('document.querySelector("textarea[name=prompt]").value'),'');
  const oldCounts = counts();
  db.prepare('UPDATE local_credentials SET secret=NULL').run();
  await input('这是第二条消息，密钥无效时应留在草稿。');
  await click('[data-testid=send-message]');
  await wait("document.querySelector('[role=alert]')?.textContent.includes('尚未发送')");
  assert.deepEqual(counts(),oldCounts,'Existing conversations must not acquire ghost messages');

  // Replay the local admission boundary of a question pause. This tests the
  // renderer's answer path, not a claim that a real model produced the question.
  db.prepare("UPDATE agent_runs SET status='PAUSED',error_code='AGENT_USER_INPUT_REQUIRED',finished_at=NULL").run();
  const conversationId = db.prepare('SELECT id FROM conversations LIMIT 1').get().id;
  await reload();
  await click(`[data-testid="conversation-${conversationId}"]`);
  await wait("document.querySelector('textarea[name=prompt]')?.placeholder.includes('回答')");
  await input('回答问题时也不应该在密钥不可用的情况下产生消息。');
  await click('[data-testid=send-message]');
  await wait("document.querySelector('[role=alert]')?.textContent.includes('尚未发送')");
  assert.deepEqual(counts(),oldCounts,'Blocked clarification must not acquire a submitted answer');
  assert.equal(await cdp.eval('document.querySelector("textarea[name=prompt]").value'),'回答问题时也不应该在密钥不可用的情况下产生消息。');

  const providers = await cdp.eval(`(async()=>{
    const definitions=[['千问 3.7 Plus','https://coding.dashscope.aliyuncs.com/v1','qwen3.7-plus'],['DeepSeek','https://api.deepseek.com','deepseek-v4-flash'],['Kimi 固定思考','https://api.moonshot.cn/v1','kimi-k2.7-code']];
    const rows=[];for(const [display_name,base_url,default_model] of definitions){rows.push(await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',model_optimization:true,display_name,base_url,default_model,custom_endpoint_acknowledged:true}));}return rows;
  })()`);
  await click('[data-testid=settings-nav]'); await click('[data-testid=settings-category-models]');
  for (const [index,provider] of providers.entries()) {
    await click(`[data-testid="provider-select-${provider.id}"]`);
    await wait(`document.querySelector('[data-testid="model-runtime-${provider.id}"]')`);
    await cdp.eval(`document.querySelector('[data-testid="model-runtime-${provider.id}"]').scrollIntoView({block:'start',behavior:'instant'})`);
    const hasControl = index !== 2;
    if (hasControl) {
      await click(`[data-testid="reasoning-${provider.id}"]`);
      await cdp.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.match(await cdp.eval(`getComputedStyle(document.querySelector('[data-testid="reasoning-${provider.id}-menu"]')).backgroundColor`),/^rgb\(/,'Menu text must not overlap show-through descriptions');
      await cdp.eval('new Promise(resolve=>setTimeout(resolve,250))');
      const visual = await cdp.eval(`(()=>{const menu=document.querySelector('[data-testid="reasoning-${provider.id}-menu"]'),r=menu.getBoundingClientRect(),ancestors=[];for(let e=menu;e;e=e.parentElement){const s=getComputedStyle(e);ancestors.push({class:e.className,tag:e.tagName,opacity:s.opacity,background:s.backgroundColor,filter:s.filter,backdrop:s.backdropFilter,transform:s.transform,zIndex:s.zIndex});}return {ancestors,hit:document.elementsFromPoint(r.left+30,r.top+50).map(e=>e.className)};})()`);
      await writeFile(path.join(evidence,`menu-${index}-styles.json`),JSON.stringify(visual,null,2));
      assert.equal(await cdp.eval(`document.querySelector('[data-testid="reasoning-${provider.id}"]').getAttribute('aria-label')`),index===0?'深度思考':'推理强度');
      const modes = await cdp.eval(`Array.from(document.querySelectorAll('[data-testid="reasoning-${provider.id}-menu"] [role=option]'),e=>e.dataset.testid.split('-option-')[1])`);
      assert.deepEqual(modes,index===0?['PROVIDER_DEFAULT','OFF','ON']:['PROVIDER_DEFAULT','OFF','LOW','HIGH','MAX']);
      await captureScreenshot(cdp,path.join(evidence,`${index===0?'qwen-switch':'deepseek-levels'}.png`));
      await click(`[data-testid="reasoning-${provider.id}-option-${index===0?'ON':'LOW'}"]`);
      await click(`[data-testid="runtime-save-${provider.id}"]`);
      await wait(`window.fielora.provider.get({provider_config_id:${q(provider.id)}}).then(p=>p.model_runtime.settings.reasoning===${q(index===0?'ON':'LOW')})`);
      const params = await cdp.eval(`window.fielora.provider.get({provider_config_id:${q(provider.id)}}).then(p=>p.model_runtime.effective_parameters)`);
      if(index===0) assert.equal(params.enable_thinking,true);
      else { assert.equal(params.reasoning_effort,'low'); assert.equal(params.thinking.type,'enabled'); }
      assert.equal(params.max_tokens,4096,'Effort selection must not invent a token budget');
    } else {
      await wait(`document.querySelector('[data-testid="reasoning-default-${provider.id}"]')`);
      assert.equal(await cdp.eval(`Boolean(document.querySelector('[data-testid="reasoning-${provider.id}"]'))`),false);
      await captureScreenshot(cdp,path.join(evidence,'model-default.png'));
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:920,height:760,deviceScaleFactor:1,mobile:false});
  assert.equal(await cdp.eval('document.documentElement.scrollWidth<=window.innerWidth'),true);
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({status:'PASS',external_model_requests:0,checks:['stale-credential-metadata-blocked','no-empty-conversation','no-ghost-message-or-run','draft-retained','keyboard-same-gate','repair-then-single-send','existing-conversation-blocked','clarification-blocked-with-draft','qwen-thinking-switch','deepseek-real-levels','fixed-default-no-dropdown','wire-parameters-match','no-invented-token-budget','narrow-settings']},null,2));
  console.log(`PROVIDER_SEND_PREFLIGHT=PASS evidence=${evidence}`);
} catch(error) {
  if(cdp) { await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{}); console.error(await cdp.eval('document.body.innerText').catch(()=>'')); }
  console.error(output.join('').slice(-2000)); console.error(`Evidence=${evidence}`); throw error;
} finally {
  db?.close();
  if(cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close(); }
  await cleanupElectronProcess(child); await rm(dataRoot,{recursive:true,force:true});
}
