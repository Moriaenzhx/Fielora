import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, copyFile, rm, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess, waitForChildExit } from './harness/electron-cdp-harness.mjs';

assert.equal(process.platform,'darwin','This native registration smoke targets macOS');
import { deleteTestCredential } from '../support/platform.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-fonts-'));
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(),'fielora-fonts-evidence-'));
const projectRoot=path.join(dataRoot,'project');
const fixture=path.join(root,'tests/fixtures/fonts/FieloraFontFixture.ttf');
const digest=createHash('sha256').update(await readFile(fixture)).digest('hex');
const installedPath=path.join(homedir(),'Library/Fonts',`Fielora-${digest}.ttf`);
let preexisting=false; try { await access(installedPath); preexisting=true; } catch {}
let child,cdp,originalPrefs,createdProviderId; const output=[];
const wait=(expression)=>waitForExpression(cdp,expression,{timeoutMs:60000,output});
const click=async selector=>{await wait(`document.querySelector(${JSON.stringify(selector)})`);await cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);};
async function launch() {
  const launched=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{FIELORA_E2E_FONT_PATHS:JSON.stringify([path.join(projectRoot,'font.ttf'),path.join(projectRoot,'invalid.ttf')])}});
  child=launched.child; cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await wait(`window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')`);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.bringToFront');
}
async function assertLayout(selector,width) {
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await wait(`document.querySelector(${JSON.stringify(selector)}).clientWidth>0`);
  const layout=await cdp.eval(`(()=>{const p=document.querySelector(${JSON.stringify(selector)}),h=p.querySelector('h1'),bar=p.querySelector('.collection-toolbar');return {scroll:p.scrollWidth,width:p.clientWidth,heading:parseFloat(getComputedStyle(h).fontSize),toolbar:bar.getBoundingClientRect().height};})()`);
  assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout)); assert.equal(layout.heading,25);
  await captureScreenshot(cdp,path.join(evidence,`${selector.slice(1)}-${width}.png`));
}
try {
  await mkdir(projectRoot);await mkdir(evidence,{recursive:true});
  await copyFile(fixture,path.join(projectRoot,'font.ttf')); await writeFile(path.join(projectRoot,'invalid.ttf'),'not a font');
  assert.equal(spawnSync('git',['init'],{cwd:projectRoot}).status,0);
  await launch();
  originalPrefs=await cdp.eval(`localStorage.getItem('fielora.ui.preferences.v2')`);
  await click('[data-testid=library-nav]');await wait(`document.querySelector('.library-empty')`);
  for (const width of [1440,980]) await assertLayout('.library-content',width);
  await click('[data-testid=now-nav]');await wait(`document.querySelector('.scheduled-empty')`);
  for (const width of [1440,980]) await assertLayout('.scheduled-page',width);
  await wait(`document.querySelector('[data-testid=settings-nav]') || document.querySelector('[data-testid=settings-category-appearance]')`);
  if(await cdp.eval(`Boolean(document.querySelector('[data-testid=settings-nav]'))`)) await click('[data-testid=settings-nav]');
  await click('[data-testid=settings-category-appearance]');
  await wait(`document.querySelector('[data-testid=appearance-font-library]') && !document.body.innerText.includes('正在检查本机字体')`);
  const before=await cdp.eval(`window.fielora.fonts.list()`);
  assert.ok(before.families.some(f=>f.family==='PingFang SC'), 'native font list includes PingFang');
  await click('[data-testid=appearance-ui-font]');
  const listed=await cdp.eval(`[...document.querySelectorAll('[data-testid^="appearance-ui-font-option-"]')].map(e=>e.textContent.trim())`);
  assert.equal(listed.length,before.families.length+1);
  assert.deepEqual(listed.slice(1),before.families.map(f=>f.family).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true})));
  const missing={segoe:!listed.includes('Segoe UI'),yahei:!listed.includes('Microsoft YaHei')};
  await click('[data-testid="appearance-ui-font-option-LOCAL:PingFang SC"]');
  await click('[data-testid=appearance-font-import]');
  await wait(`document.querySelector('.font-import-status')?.textContent.includes('Fielora Font Fixture')`);
  const status=await cdp.eval(`document.querySelector('.font-import-status').textContent`);
  assert.ok(status.includes('invalid.ttf')&&status.includes('安装失败'),status);
  assert.equal(createHash('sha256').update(await readFile(installedPath)).digest('hex'),digest);
  const catalog=await cdp.eval(`window.fielora.fonts.list()`);
  assert.ok(catalog.families.some(f=>f.family==='Fielora Font Fixture'&&f.monospace));
  await click('[data-testid=appearance-ui-font]');
  await click('[data-testid="appearance-ui-font-option-LOCAL:Fielora Font Fixture"]');
  await wait(`document.documentElement.style.getPropertyValue('--fl-font-sans').includes('Fielora Font Fixture')`);
  await cdp.eval(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  await cdp.send('Page.captureScreenshot',{format:'png'});
  await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const doc=await cdp.send('DOM.getDocument');
  const node=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'.font-previews p'});
  const rendered=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
  assert.ok(rendered.fonts.some(f=>f.familyName==='Fielora Font Fixture'&&f.glyphCount>0),JSON.stringify(rendered));
  await cdp.eval(`setTimeout(()=>window.fielora.core.quit(),0);true`);
  await Promise.race([waitForChildExit(child),new Promise((_,reject)=>setTimeout(()=>reject(Error('Normal app quit timed out')),15000))]);
  cdp.close();cdp=null;await cleanupElectronProcess(child);child=null;await launch();
  await wait(`window.fielora && document.documentElement.style.getPropertyValue('--fl-font-sans').includes('Fielora Font Fixture')`);
  await wait(`document.querySelector('[data-testid=settings-nav]') || document.querySelector('[data-testid=settings-category-appearance]')`);
  if(await cdp.eval(`Boolean(document.querySelector('[data-testid=settings-nav]'))`)) await click('[data-testid=settings-nav]');
  await click('[data-testid=settings-category-appearance]');
  await click('[data-testid=appearance-ui-font]');await click('[data-testid=appearance-ui-font-option-SYSTEM]');
  await captureScreenshot(cdp,path.join(evidence,'fonts-appearance.png'));
  const ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Font fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_outcomes__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'Font fixture',goal:null,root_path:${JSON.stringify(projectRoot)}});const conversation=await window.fielora.conversation.create({field_id:project.field_id,title:'Font installation',provider_config_id:provider.id,model_id:provider.default_model});const message=await window.fielora.conversation.createMessage({conversation_id:conversation.id,role:'USER',content:'字体安装审批回归',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});const run=await window.fielora.agent.start({field_id:project.field_id,conversation_id:conversation.id,user_message_id:message.id,provider_config_id:provider.id,model_id:provider.default_model,task:message.content,permission:'FULL_CONTROL',max_steps:12,attachments:[]});return {run,conversation,providerId:provider.id}})()`);
  createdProviderId=ids.providerId;
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(ids.run.id)}}).then(r=>r.status==='WAITING_APPROVAL')`);
  const pending=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(ids.run.id)}})`);
  const install=pending.find(t=>t.name==='fonts.install');assert.ok(install);assert.equal(install.policy_decision,'ASK');
  assert.equal(install.arguments._installation_preview.font.sha256,digest);
  assert.notEqual(install.arguments._installation_preview.install_directory,'forged');
  await cdp.send('Page.reload');await wait(`document.querySelector('[data-testid="conversation-${ids.conversation.id}"]')`);
  await click(`[data-testid="conversation-${ids.conversation.id}"]`);
  await wait(`document.querySelector('[data-testid=agent-font-install-preview]')`);
  await captureScreenshot(cdp,path.join(evidence,'font-install-approval.png'));
  await click('[data-testid=agent-allow-once]');
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(ids.run.id)}}).then(r=>['COMPLETED','FAILED','PAUSED'].includes(r.status))`);
  const state=await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${JSON.stringify(ids.run.id)}}),tools:await window.fielora.agent.toolCalls({run_id:${JSON.stringify(ids.run.id)}})}))()`);
  assert.equal(state.run.status,'COMPLETED',JSON.stringify(state));
  const receipt=state.tools.find(t=>t.name==='fonts.install').receipt;
  assert.equal(receipt.success,true);assert.equal(receipt.already_installed,true);assert.equal(receipt.verification_eligible,false);
  assert.ok(state.tools.find(t=>t.name==='fonts.list').receipt.families.some(f=>f.family==='Fielora Font Fixture'));
  const typography=[];
  for (const size of [12,15,18]) {
    await click('[data-testid=settings-nav]');await click('[data-testid=settings-category-appearance]');
    await click('[data-testid=appearance-ui-font-size]');await click(`[data-testid=appearance-ui-font-size-option-${size}]`);
    await click('[data-testid=appearance-code-font-size]');await click('[data-testid=appearance-code-font-size-option-11]');
    const settings=await cdp.eval(`(()=>{const px=s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize);return{label:px('.appearance-font-row strong'),sidebar:px('[data-testid=settings-category-appearance]'),code:px('.font-previews code')}})()`);
    assert.equal(settings.code,11);
    await click('[data-testid=settings-back]');
    await click(`[data-testid="conversation-${ids.conversation.id}"]`);
    await wait(`document.querySelector('.message-list .markdown-body')`);
    const conversation=await cdp.eval(`(()=>{const px=s=>parseFloat(getComputedStyle(document.querySelector(s)).fontSize);return{body:px('.message-list .markdown-body'),sidebar:px('[data-testid=settings-nav]'),composer:px('.conversation-composer textarea')}})()`);
    assert.equal(conversation.body,size,JSON.stringify(conversation));
    typography.push({size,settings,conversation});
    await captureScreenshot(cdp,path.join(evidence,`font-size-${size}.png`));
  }
  for (const group of ['settings','conversation']) for(const role of Object.keys(typography[0][group]).filter(key=>key!=='code')) {
    const a=typography[0][group][role],b=typography[2][group][role];
    assert.ok(Math.abs(b/a-1.5)<0.01,`${group}.${role} must track the UI scale: ${a} -> ${b}`);
  }
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({nativeFonts:before.families.length,missing,status,rendered,agent:state},null,2));
  await writeFile(path.join(evidence,'typography.json'),JSON.stringify(typography,null,2));
  console.log(`FONTS_COLLECTIONS=PASS evidence=${evidence}`);
} catch(error) { console.error(output.join('').slice(-6000)); if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});throw error; }
finally {
  if(cdp&&originalPrefs!==undefined) await cdp.eval(originalPrefs===null?`localStorage.removeItem('fielora.ui.preferences.v2')`:`localStorage.setItem('fielora.ui.preferences.v2',${JSON.stringify(originalPrefs)})`).catch(()=>{});
  if(cdp){await cdp.eval(`setTimeout(()=>window.fielora.core.quit(),0);true`).catch(()=>{});cdp.close();}
  if(child)await cleanupElectronProcess(child);
  if(createdProviderId) deleteTestCredential(createdProviderId);
  if(!preexisting) {
    const cleanup=spawnSync('python3',[path.join(root,'tests/fixtures/fonts/cleanup-macos.py'),installedPath,digest],{encoding:'utf8'});
    if(cleanup.status!==0) throw Error(`Font fixture cleanup failed: ${cleanup.stderr}`);
  }
  await rm(dataRoot,{recursive:true,force:true});
}
