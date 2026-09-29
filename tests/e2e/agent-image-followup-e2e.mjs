import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, glob } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-image-followup-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-image-followup/dev'));
const output = []; let child; let cdp; let ids;
const wait = expression => waitForExpression(cdp, expression, { timeoutMs: 60000, output });
async function show(id) {
  await cdp.eval('window.__imageFollowupReload=true');
  await cdp.send('Page.reload');
  await wait("typeof window.__imageFollowupReload==='undefined' && window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await wait(`document.querySelector('[data-testid="conversation-${id}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${id}"]').click()`);
}
async function send(text, color) {
  if (color) {
    await cdp.eval(`(async()=>{const c=document.createElement('canvas');c.width=400;c.height=180;const x=c.getContext('2d');x.fillStyle=${JSON.stringify(color)};x.fillRect(0,0,400,180);x.fillStyle='black';x.font='22px sans-serif';x.fillText('KPI: remove marked columns',10,60);x.strokeStyle='red';x.lineWidth=5;x.beginPath();x.moveTo(10,60);x.lineTo(310,60);x.stroke();const b=await new Promise(r=>c.toBlob(r,'image/png'));const t=new DataTransfer();t.items.add(new File([b],'report.png',{type:'image/png'}));document.querySelector('.conversation-composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:t,bubbles:true,cancelable:true}));})()`);
    await wait("document.querySelectorAll('[data-testid=attachment-thumbnail-composer]').length===1");
  }
  await cdp.eval(`(()=>{const e=document.querySelector('.conversation-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const before = await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}})`);
  await wait("!document.querySelector('[data-testid=send-message]').disabled");
  await cdp.eval("document.querySelector('[data-testid=send-message]').click()");
  await wait(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}}).then(r=>r.length>${before.length}&&['COMPLETED','PAUSED','FAILED'].includes(r[0].status))`);
  const [run] = await cdp.eval(`window.fielora.agent.list({conversation_id:${JSON.stringify(ids.conversation.id)}})`);
  return inspect(run);
}
async function inspect(run) {
  const events = await cdp.eval(`window.fielora.agent.events({run_id:${JSON.stringify(run.id)},after_sequence:null,limit:500})`);
  const tools = await cdp.eval(`window.fielora.agent.toolCalls({run_id:${JSON.stringify(run.id)}})`);
  return { run, events, tools, prompt: events.find(e=>e.kind==='MODEL_COMPLETED')?.payload.prompt };
}
async function direct(task, messageId, conversation = ids.conversation) {
  const run = await cdp.eval(`window.fielora.agent.start({field_id:${JSON.stringify(ids.project.field_id)},conversation_id:${JSON.stringify(conversation.id)},user_message_id:${JSON.stringify(messageId ?? null)},provider_config_id:${JSON.stringify(ids.provider.id)},model_id:'__fielora_agent_fixture_images__',task:${JSON.stringify(task)},permission:'FULL_CONTROL',attachments:[],max_steps:null})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}}).then(r=>['COMPLETED','PAUSED','FAILED'].includes(r.status))`);
  return inspect(await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(run.id)}})`));
}
try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(projectRoot, 'evidence.txt'), 'No business files should change.\n');
  assert.equal(spawnSync('git.exe', ['init'], { cwd: projectRoot, windowsHide: true }).status, 0);
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { Path: `${path.dirname(process.execPath)};${process.env.Path ?? ''}` },
  });
  child=launched.child; cdp=await connectToFieloraApp({port:launched.port,output,timeoutMs:120000,enablePage:true});
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  ids=await cdp.eval(`(async()=>{const provider=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Image delivery fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_images__',custom_endpoint_acknowledged:true});await window.fielora.provider.storeCredential({provider_config_id:provider.id,secret:'fixture-only'});const project=await window.fieloraTest.createProject({title:'历史图片追问',goal:null,root_path:${JSON.stringify(projectRoot)}});const create=title=>window.fielora.conversation.create({field_id:project.field_id,title,provider_config_id:provider.id,model_id:provider.default_model});return {provider,project,conversation:await create('报表截图'),other:await create('无图对话')};})()`);
  await show(ids.conversation.id);
  const older=await send('说明这个表单', '#ccddff');
  const report=await send('检查一下这个报表是否已经按照这个改好了', '#ffeecc');
  assert.equal(report.run.status,'COMPLETED'); assert.equal(report.prompt.image_count,1);
  assert.notDeepEqual(older.prompt.image_manifest,report.prompt.image_manifest,'a new attachment replaces the prior gallery');
  const follow=await send('你知道图片里面的需求是什么吗');
  const latest=await send('我最近发给你的这张');
  for(const result of [follow,latest]) {
    assert.equal(result.run.status,'COMPLETED'); assert.deepEqual(result.tools.map(t=>t.name),['finish_task']);assert.equal(result.tools[0].effect,'OBSERVE');
    assert.deepEqual(result.prompt.image_manifest,report.prompt.image_manifest,'exact same image bytes reach the model, not just a filename or count');
    const source=result.events.find(e=>e.payload.kind==='REFERENCED_INPUTS_RESTORED').payload;
    assert.equal(source.origin_run_id,report.run.id);
    assert.equal(source.source_user_message_id,report.events.find(e=>e.kind==='RUN_CREATED').payload.user_message_id);
  }
  // Delete only test-profile UI gallery metadata: Core must own continuity.
  await cdp.eval("Object.keys(localStorage).filter(k=>k.startsWith('fielora:conversation-message-attachments:')).forEach(k=>localStorage.removeItem(k))");
  const pid=await cdp.eval('window.fielora.core.getHealth().then(h=>h.pid)');
  await cdp.eval('window.fieloraTest.killCore()');
  await wait(`window.fielora.core.getHealth().then(h=>h.state==='READY'&&h.pid!==${pid})`);
  await show(ids.conversation.id);
  const restored=await send('请解释红线的意思');
  assert.deepEqual(restored.prompt.image_manifest,report.prompt.image_manifest);
  const newer=await send('说明这个新页面', '#ddffcc');
  assert.notDeepEqual(newer.prompt.image_manifest,report.prompt.image_manifest);
  const followMessage=follow.events.find(e=>e.kind==='RUN_CREATED').payload.user_message_id;
  const retry=await direct('你知道图片里面的需求是什么吗',followMessage);
  assert.deepEqual(retry.prompt.image_manifest,report.prompt.image_manifest,'retry excludes later images');
  const newest=await direct('我最近发给你的这张');
  assert.deepEqual(newest.prompt.image_manifest,newer.prompt.image_manifest,'retrying an old question must not replace the latest uploaded gallery');
  const isolated=await direct('我最近发给你的这张',null,ids.other);
  assert.equal(isolated.prompt.image_count,0,'another conversation cannot inherit images');
  // Corrupt the newest test-profile manifest, leaving an intact older gallery.
  const databases=[];for await(const file of glob('**/fielora.db',{cwd:dataRoot})) databases.push(path.join(dataRoot,file));
  assert.equal(databases.length,1);
  const db=new DatabaseSync(databases[0]);
  const row=db.prepare("SELECT payload_json FROM agent_events WHERE run_id=? AND json_extract(payload_json,'$.kind')='RUN_INPUT_ATTACHMENTS_V1'").get(newest.run.id);db.close();
  const ref=JSON.parse(row.payload_json).blob_ref;
  const blobs=[];for await(const file of glob(`**/${ref}`,{cwd:dataRoot})) blobs.push(path.join(dataRoot,file));
  assert.equal(blobs.length,1); const originalBlob=await readFile(blobs[0]); await writeFile(blobs[0],'corrupted test input');
  const missing=await direct('我最近发给你的这张');
  assert.equal(missing.run.status,'PAUSED');assert.equal(missing.run.error_code,'AGENT_INPUT_UNAVAILABLE');
  assert.equal(missing.prompt,undefined);assert.equal(missing.tools.length,0);
  assert.equal(await readFile(path.join(projectRoot,'evidence.txt'),'utf8'),'No business files should change.\n');
  await show(ids.conversation.id);await captureScreenshot(cdp,path.join(evidence,'missing-image-explicit.png'));
  await writeFile(blobs[0],originalBlob);
  await cdp.eval(`window.fielora.agent.resume({run_id:${JSON.stringify(missing.run.id)}})`);
  await wait(`window.fielora.agent.get({run_id:${JSON.stringify(missing.run.id)}}).then(r=>r.status==='COMPLETED')`);
  const recovered=await inspect(await cdp.eval(`window.fielora.agent.get({run_id:${JSON.stringify(missing.run.id)}})`));
  assert.deepEqual(recovered.prompt.image_manifest,newer.prompt.image_manifest,'restored verified bytes recover the same paused run');
  const summary={status:'PASS',host:process.env.FIELORA_PACKAGED_EXE?'packaged':'development',cases:['exact Chinese follow-ups','new attachment priority','image byte identity','origin provenance','Core restart without UI gallery','retry excludes future images','conversation isolation','corrupt newest blocks stale fallback'],externalModelRequests:0,realModelVisualUnderstanding:'NOT_RUN',runs:[report,follow,latest,restored,newer,retry,isolated,missing].map(r=>({id:r.run.id,status:r.run.status,image_count:r.prompt?.image_count,image_manifest:r.prompt?.image_manifest}))};
  await writeFile(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2));console.log('PASS image follow-up continuity');
} catch(error) {
  console.error(error,output.slice(-3).join(''));process.exitCode=1;
  if(cdp)await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
} finally {
  await writeFile(path.join(evidence,'electron.log'),output.join('')).catch(()=>{});
  cdp?.close();await cleanupElectronProcess(child);
  if(ids?.provider)spawnSync('cmdkey.exe',[`/delete:Fielora/provider/${ids.provider.id}`],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(dataRoot).startsWith(path.resolve(tmpdir())+path.sep));
  await rm(dataRoot,{recursive:true,force:true,maxRetries:12,retryDelay:200});
}
