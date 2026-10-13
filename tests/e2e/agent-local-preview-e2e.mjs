import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CdpConnection, freeDebuggingPort, launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-local-preview-'));
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-workshop-preview-20261012/dev'));
const source = process.env.FIELORA_PREVIEW_AUDIT_HTML;
const fixture = '<!doctype html><meta charset="utf-8"><title>Managed preview fixture</title><h1>Managed preview ready</h1><button onclick="document.querySelector(\'output\').textContent=\'clicked\'">Apply</button><output>waiting</output><script>throw new ReferenceError("local-preview-diagnostic")</script>';
const html = source ? await readFile(source, 'utf8') : fixture;
const hash = text => createHash('sha256').update(text).digest('hex');
const url = `http://127.0.0.1:${await freeDebuggingPort()}/index.html`;
const output = [], q = JSON.stringify;
let child, cdp, page;
const validation = { scope: 'Real desktop and process lifecycle; deterministic model substitute. Original model task not accepted.', externalModelRequests: 0, sourceSha256: hash(html) };
try {
  const project = path.join(dataRoot, 'project');
  await mkdir(path.join(project, 'workshop'), { recursive: true });
  await writeFile(path.join(project, 'workshop/index.html'), html);
  await mkdir(evidence, { recursive: true });
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { FIELORA_AGENT_BROWSER_FIXTURE_URL: url, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
  }); child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, timeoutMs: 120000, enablePage: true });
  const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 60000 });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.eval('window.fieloraTest.resizeWindow({width:1400,height:900})');
  await cdp.send('Page.bringToFront');
  const ids = await cdp.eval(`(async()=>{
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Local preview fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_preview__',custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-preview-only'});
    const f=await window.fieloraTest.createProject({title:'受管本地预览回归',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Local preview recovery',provider_config_id:p.id,model_id:p.default_model});
    const task='Start the local workshop preview with a managed server after diagnosing a finite-command timeout, and open it in the browser.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:p.default_model,task,permission:'FULL_CONTROL',max_steps:15,attachments:[]});
    return {run:r.id,conversation:c.id};
  })()`);
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  const result = await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(ids.run)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(ids.run)}}),events:await window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})}))()`);
  await writeFile(path.join(evidence, 'preview-run.json'), JSON.stringify(result, null, 2));
  assert.equal(result.run.error_code, 'AGENT_USER_INPUT_REQUIRED', JSON.stringify(result.run));
  assert.deepEqual(result.tools.map(t => t.name), ['run_command','capability_status','browser_server','browser','request_user_input']);
  assert.equal(result.tools[0].error_code, 'AGENT_COMMAND_TIMEOUT');
  assert.equal(result.tools[1].arguments.filter.text, 'browser');
  const afterDiscovery = result.events.find(e => e.kind === 'MODEL_COMPLETED' && e.payload.step === 3);
  assert.ok(['browser','browser_server'].every(n => afterDiscovery.payload.prompt.visible_tool_names.includes(n)));
  assert.equal(result.tools[2].receipt.readiness, 'LISTENING');
  assert.equal(result.tools[3].receipt.success, true);
  assert.equal(result.tools[3].receipt.page_loaded, true);
  assert.equal(await (await fetch(url)).text(), html, 'Server survives command/tool returns and serves the actual project');
  validation.timeoutRecovered = validation.filteredToolsCallable = validation.managedServerReachable = validation.actualBrowserLoaded = true;

  const targets = await (await fetch(`http://127.0.0.1:${launched.port}/json/list`)).json();
  const target = targets.find(t => t.url === url);
  assert.ok(target, 'Actual browser WebContents target');
  page = new CdpConnection(target.webSocketDebuggerUrl); await page.open();
  await page.send('Runtime.enable'); await page.send('Page.enable');
  const nativeClick = async selector => {
    const point = await page.eval(`(()=>{const e=document.querySelector(${q(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await page.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point});
    await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  if (!source) {
    assert.ok(result.tools[3].receipt.page_errors.some(e => e.message.includes('local-preview-diagnostic')), 'Native script diagnostics reach the durable Core receipt');
    validation.currentDocumentErrors = true;
    await nativeClick('button');
    await waitForExpression(page, "document.querySelector('output').textContent==='clicked'");
    validation.nativeInput = true;
  } else {
    // Audit the unchanged supplied artifact. Do not turn missing functionality
    // into a passing original-task acceptance result.
    await page.eval('window.previewErrors=[];addEventListener("error",e=>previewErrors.push(e.message))');
    await nativeClick('.tab[data-panel="budget"]');
    await waitForExpression(page, "document.querySelector('#panel-budget').classList.contains('active')");
    assert.match(await page.eval("document.querySelector('#budgetSummary').textContent"), /9080/);
    await nativeClick('#budgetParams input');
    await page.send('Input.dispatchKeyEvent', {type:'keyDown',key:'a',code:'KeyA',modifiers:process.platform==='darwin'?4:2,commands:['selectAll']});
    await page.send('Input.dispatchKeyEvent', {type:'keyUp',key:'a',code:'KeyA'});
    await page.send('Input.insertText', {text:'8000'});
    await nativeClick('#panel-budget h2');
    await waitForExpression(page, "document.querySelector('#budgetSummary').textContent.includes('预算已超限')");
    assert.equal(await page.eval("JSON.parse(localStorage.getItem('ai-workshop-workbench-v1')).budget.budgetCap"), 8000);
    await page.send('Page.reload');
    await waitForExpression(page, "document.querySelector('#budgetParams input')?.value==='8000'");
    validation.workshop = { budget9080:true, nativeTabAndBudgetEdit:true, overBudgetWarning:true, actualLocalStorageAndReload:true };
    await nativeClick('.tab[data-panel="budget"]');
    await nativeClick('[onclick="resetBudget()"]');
    await waitForExpression(page, "document.querySelector('#budgetParams input').value==='12000'");
    await nativeClick('.tab[data-panel="groups"]');
    assert.equal(await page.eval("document.querySelectorAll('#groupCards .group-card').length"), 3);
    await nativeClick('.tab[data-panel="schedule"]');
    await page.eval('window.previewErrors=[];addEventListener("error",e=>previewErrors.push(e.message))');
    await nativeClick('#scheduleTables td.editable');
    // Electron does not implement window.prompt; retain its actual diagnostic.
    validation.workshop.scheduleEditErrors = await page.eval('window.previewErrors');
    validation.workshop.originalTaskAccepted = false;
    validation.workshop.exportAndImport = 'Not verified in this preview-chain regression';
    assert.equal(hash(await readFile(source,'utf8')), hash(html), 'Original user artifact unchanged');
    await writeFile(path.join(evidence, 'workshop-observation.json'), JSON.stringify(await page.eval('({title:document.title,text:document.body.innerText,errors:window.previewErrors})'), null, 2));
  }
  await captureScreenshot(page, path.join(evidence, 'preview-page.png'));
  await captureScreenshot(cdp, path.join(evidence, 'preview-shell.png'));
  page.close(); page = null;
  await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true'); cdp.close(); cdp = null;
  await cleanupElectronProcess(child); child = null;
  await assert.rejects(fetch(url), 'Managed process ends with its desktop host');
  validation.managedServerStoppedWithHost = true;
  await writeFile(path.join(evidence, 'validation.json'), JSON.stringify({status:'PASS',...validation}, null, 2));
  console.log(`LOCAL_PREVIEW_E2E=PASS evidence=${evidence}`);
} catch (error) {
  console.error(output.join('').slice(-5000));
  if (cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  throw error;
} finally {
  if (page) page.close();
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{}); cdp.close(); }
  if (child) await cleanupElectronProcess(child);
}
