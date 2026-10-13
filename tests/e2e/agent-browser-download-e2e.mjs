import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-download-'));
const project=path.join(dataRoot,'project');
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(dataRoot,'evidence');
const q=JSON.stringify, output=[];
const bodies={blob:q({kind:'blob',count:24,title:'workshop'}),http:q({kind:'http',count:24,title:'workshop'})};
const html=`<!doctype html><meta charset="utf-8"><title>Browser downloads</title>
<button id="blob">Export Blob</button><a href="/file" download>Export HTTP</a><a href="/big" download>Export Big</a>
<script>document.getElementById('blob').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([${q(bodies.blob)}],{type:'application/json'}));a.download='../../untrusted-name.json';a.click();}</script>`;
const server=createServer((request,response)=>{
  if(request.url==='/file'){response.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="export.json"'});response.end(bodies.http);}
  else if(request.url==='/big'){response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="large.bin"','Content-Length':String(16*1024*1024+1)});response.end(Buffer.alloc(16*1024*1024+1));}
  else{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let child,cdp;
async function launch(){
  const app=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,
    executablePath:process.env.FIELORA_PACKAGED_EXE??process.execPath,
    args:process.env.FIELORA_PACKAGED_EXE?[]:[path.join(root,'node_modules/@electron-forge/cli/dist/electron-forge.js'),'start'],
    extraEnv:{FIELORA_AGENT_BROWSER_FIXTURE_URL:url}});
  child=app.child; cdp=await connectToFieloraApp({port:app.port,output,enablePage:true,timeoutMs:120000});
  await waitForExpression(cdp,"window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')",{output,timeoutMs:120000});
}
async function stop(){
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();cdp=null;}
  if(child){await cleanupElectronProcess(child);child=null;}
}
try{
  await mkdir(project);await mkdir(evidence,{recursive:true});await launch();
  const ids=await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_browser_download__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Download fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'下载文件验收',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Downloads',provider_config_id:p.id,model_id:model});
    const task='Capture actual exported files in the browser and verify their JSON bytes; copy the verified downloads into the project. Exercise failure without declaring task completion.';
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
  assert.equal(result.run.error_code,'AGENT_USER_INPUT_REQUIRED',q(result.run));
  assert.equal(result.tools.at(-1).arguments.reason,'FIXTURE_DOWNLOAD_VERIFIED');
  const calls=result.tools.filter(t=>t.name==='browser'&&t.arguments.action==='download');
  assert.equal(calls.length,3); assert.equal(calls[2].receipt.error_code,'BROWSER_DOWNLOAD_TOO_LARGE');
  assert.equal(result.tools.find(t=>t.arguments.action==='click').receipt.download_notice.error_code,'BROWSER_DOWNLOAD_NOT_ARMED');
  for(const [index,kind] of ['blob','http'].entries()){
    const d=calls[index].receipt.download;
    assert.equal(calls[index].receipt.success,true); assert.equal(d.contents_verified,false);
    assert.ok(d.artifact_path.startsWith(dataRoot+path.sep));
    assert.equal(await readFile(d.artifact_path,'utf8'),bodies[kind]);
    assert.equal(await readFile(path.join(project,`export-${kind}.json`),'utf8'),bodies[kind]);
    assert.equal(d.sha256,createHash('sha256').update(bodies[kind]).digest('hex'));
    assert.equal((await stat(d.artifact_path)).mode&0o777,0o600);
  }
  const reads=result.tools.filter(t=>t.name==='read_file');
  assert.equal(reads.length,2,'Each captured file must go directly through the actual read_file boundary');
  assert.ok(reads.every(t=>t.status==='COMPLETED'&&t.receipt.workspace_scope==='RUN_DOWNLOAD'&&t.receipt.contents_verified===false));
  assert.deepEqual(reads.map(t=>t.receipt.sha256),calls.slice(0,2).map(t=>t.receipt.download.sha256));
  assert.ok(result.tools.filter(t=>t.name==='run_command').every(t=>t.receipt.exit_code===0));
  await captureScreenshot(cdp,path.join(evidence,'desktop.png'));
  await stop();await launch();
  const restored=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  assert.equal(restored.length,result.tools.length,'Cold restore must not replay a download');
  for(const call of calls.slice(0,2)) assert.ok((await stat(call.receipt.download.artifact_path)).isFile());
  await cdp.eval(`(async()=>{
    const message=await window.fielora.conversation.createMessage({conversation_id:${q(ids.conversation)},role:'USER',content:'Read the same captured download again after this cold restart, without downloading or copying again.',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return window.fielora.agent.resume({run_id:${q(ids.run)},user_message_id:message.id});
  })()`);
  await waitForExpression(cdp,`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>r.status==='PAUSED'&&r.current_step>${result.run.current_step})`,{output,timeoutMs:60000});
  const coldTools=await cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(ids.run)}})`);
  assert.equal(coldTools.at(-1).arguments.reason,'FIXTURE_DOWNLOAD_COLD_READ_VERIFIED');
  assert.equal(coldTools.at(-2).name,'read_file');assert.equal(coldTools.at(-2).receipt.workspace_scope,'RUN_DOWNLOAD');
  assert.equal(coldTools.filter(t=>t.name==='browser'&&t.arguments.action==='download').length,3,'Cold read must not trigger another download');
  assert.equal(coldTools.filter(t=>t.name==='run_command').length,2,'Cold read must not copy through a shell');
  await writeFile(path.join(evidence,'cold-tools.json'),q(coldTools));
  await writeFile(path.join(evidence,'validation.json'),q({status:'PASS',scope:'Deterministic model through governed Core tools; actual Electron Blob/HTTP bytes, unarmed cancellation, oversize rejection, direct same-Run read_file hash/JSON observation, project copy and cold read_file re-admission without replay. No original real-model completion claim.',run:ids.run,tools:coldTools.length}));
  console.log('BROWSER_DOWNLOAD_E2E=PASS evidence='+evidence);
}catch(error){
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-2000));throw error;
}finally{await stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
