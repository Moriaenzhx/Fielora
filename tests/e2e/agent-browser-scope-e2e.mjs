import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-static-scope-'));
const project=path.join(dataRoot,'project');
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(dataRoot,'evidence');
const q=JSON.stringify, output=[];
const fallback=process.env.FIELORA_BROWSER_SCOPE_FALLBACK ?? '';
const finishAfterNotes=process.env.FIELORA_BROWSER_SCOPE_FINISH_AFTER_NOTES==='1';
const rootAssets=process.env.FIELORA_BROWSER_ROOT_ASSETS==='1';
let externalRequests=0;
const external=createServer((_req,res)=>{externalRequests++;res.end('console.log(\"external\")');});
await new Promise(resolve=>external.listen(0,'127.0.0.1',resolve));
const externalUrl=`http://127.0.0.1:${external.address().port}/untracked.js`;
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${rootAssets?'/':''}style.css"><main id="result">Loading</main><script type="module" src="${rootAssets?'/':''}app.js"></script>`+ (fallback==='worker' ? '<script>try { new Worker("worker.js") } catch(e) {}</script>' : fallback==='external' ? `<script src="${externalUrl}"></script>` : '');
let child,cdp;
async function launch(){
  const app=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{FIELORA_BROWSER_SCOPE_FALLBACK:fallback,FIELORA_BROWSER_SCOPE_FINISH_AFTER_NOTES:finishAfterNotes?'1':''}});
  child=app.child; cdp=await connectToFieloraApp({port:app.port,output,enablePage:true,timeoutMs:120000});
  await waitForExpression(cdp,"window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')",{output,timeoutMs:120000});
}
async function stop(){
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();cdp=null;}
  if(child){await cleanupElectronProcess(child);child=null;}
}
try{
  await mkdir(project);await mkdir(evidence,{recursive:true});
  await writeFile(path.join(project,'index.html'),html);
  await writeFile(path.join(project,'app.js'),rootAssets ? "import('./chunk.js')" : "fetch('data.md').then(r=>r.text()).then(t=>document.getElementById('result').textContent=t)");
  if(rootAssets) await writeFile(path.join(project,'chunk.js'),"fetch('/data.md').then(r=>r.text()).then(t=>document.getElementById('result').textContent=t)");
  await writeFile(path.join(project,'data.md'),'Local data ready');
  await writeFile(path.join(project,'style.css'),'main { color: green }');
  await writeFile(path.join(project,'README.md'),'Original notes');
  await launch();
  const ids=await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_browser_scope__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Scoped static preview',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'静态资源验收',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Scope',provider_config_id:p.id,model_id:model});
    const task=${q(finishAfterNotes
      ? 'Use the explicit managed static preview to verify local JS, CSS and Markdown rendering. Update delivery notes without invalidating those inputs, then finish with the actual browser check as required evidence.'
      : 'Use the explicit managed static preview to verify local JS, CSS and Markdown rendering. Update delivery notes without invalidating those inputs, then change a real stylesheet and verify that its earlier check is stale.')};
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return {conversation:c.id,start:{field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:20,attachments:[]}};
  })()`);
  await cdp.send('Page.reload');
  await waitForExpression(cdp,`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`,{output,timeoutMs:30000});
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  ids.run=(await cdp.eval(`window.fielora.agent.start(${q(ids.start)})`)).id;
  await waitForExpression(cdp,`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`,{output,timeoutMs:120000});
  const result=await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(ids.run)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(ids.run)}})}))()`);
  await writeFile(path.join(evidence,'run.json'),q(result));
  if(finishAfterNotes) {
    assert.equal(result.run.status,'COMPLETED',q(result.run));
    assert.equal(result.run.error_code,null);
    assert.equal(result.tools.at(-1).name,'finish_task');
    assert.equal(result.tools.at(-1).status,'COMPLETED');
    assert.equal(result.tools.at(-1).arguments.required_evidence[0].kind,'browser');
  } else {
    assert.equal(result.run.error_code,'AGENT_USER_INPUT_REQUIRED',q(result.run));
    assert.equal(result.tools.at(-1).arguments.reason,fallback?'FIXTURE_STATIC_SCOPE_FALLBACK':'FIXTURE_STATIC_SCOPE_VERIFIED');
  }
  const checked=result.tools.find(t=>t.name==='browser_verify');
  assert.equal(checked.receipt.success,true);
  assert.equal(checked.receipt.verification_eligible,true);
  const scope=checked.receipt.verification_scope;
  if(fallback) {
    assert.equal(scope,undefined); assert.equal(externalRequests,0);
    if(fallback==='worker') assert.ok(checked.receipt.page_errors.some(e=>/worker/i.test(e.message)));
  } else {
  assert.equal(scope.version,'STATIC_PREVIEW_HTTP_V1');
  assert.deepEqual(scope.files.map(f=>f.path),rootAssets?['app.js','chunk.js','data.md','index.html','style.css']:['app.js','data.md','index.html','style.css']);
  assert.deepEqual(checked.receipt.resource_errors,[]);
  assert.equal(await readFile(path.join(project,'README.md'),'utf8'),'Updated delivery notes');
  assert.equal(await readFile(path.join(project,'style.css'),'utf8'),finishAfterNotes?'main { color: green }':'main { color: blue }');
  for(const f of scope.files.filter(f=>f.path!=='style.css')) assert.equal(createHash('sha256').update(await readFile(path.join(project,f.path))).digest('hex'),f.sha256);
  }
  await captureScreenshot(cdp,path.join(evidence,'desktop.png'));
  await stop();await launch();
  const restored=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  assert.equal(restored.length,result.tools.length,'Cold restore must not replay a download');
  assert.deepEqual(restored.find(t=>t.name==='browser_verify').receipt.verification_scope,scope);
  await writeFile(path.join(evidence,'validation.json'),q({status:'PASS',scope:finishAfterNotes
    ? 'Deterministic model through actual Core/Electron. A real browser check is submitted as required_evidence to finish_task after an unrelated README mutation; the Run completes. Cold restore preserves receipts without replay.'
    : 'Deterministic model through actual Core/Electron. Native static HTML/JS/CSS/Markdown resources bind the check; compiled context preserves PASS after unrelated README mutation and becomes STALE after a real CSS mutation. Cold restore preserves facts without replay.',fallback,finishAfterNotes,rootAssets,externalRequests,run:ids.run,tools:result.tools.length}));
  console.log('BROWSER_STATIC_SCOPE_E2E=PASS evidence='+evidence);
}catch(error){
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-2000));throw error;
}finally{await stop();external.closeAllConnections();await new Promise(resolve=>external.close(resolve));}
