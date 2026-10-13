import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { CdpConnection, launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-research-'));
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts/agent-workshop-research-20261011/dev'));
const output = []; const q = JSON.stringify;
const html = '<!doctype html><meta charset="utf-8"><title>Research fixture</title><button onclick="document.querySelector(\'h1\').textContent=\'RESEARCH_CLICKED\'">Apply fixture</button><h1>RESEARCH_START</h1>' + Array.from({ length: 280 }, (_, i) => `<p><a href="/source/${i}">source ${i}</a></p>`).join('') + '<p>RESEARCH_END</p><script>window.inputTrace=[];for(const type of ["mousemove","mousedown","mouseup","click"])document.addEventListener(type,e=>window.inputTrace.push({type,x:e.clientX,y:e.clientY,target:e.target.tagName}),true);</script>';
const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let child, cdp, port;
try {
  const project = path.join(dataRoot, 'project'); await mkdir(project); await mkdir(evidence, { recursive: true });
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    extraEnv: { FIELORA_AGENT_BROWSER_FIXTURE_URL: url, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
  }); child = launched.child; port = launched.port;
  cdp = await connectToFieloraApp({ port: launched.port, output, timeoutMs: 120000, enablePage: true });
  const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 60000 });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.eval('window.fieloraTest.resizeWindow({width:1300,height:850})');
  await cdp.send('Page.bringToFront');
  const ids = await cdp.eval(`(async()=>{
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Research fixture',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_research__',custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-research-only'});
    const f=await window.fieloraTest.createProject({title:'研究与网页操作',goal:null,root_path:${q(project)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Research observation',provider_config_id:p.id,model_id:p.default_model});
    const task='Observe the research page, then click its fixture button. Do not create project files.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:p.default_model,task,permission:'FULL_CONTROL',max_steps:15,attachments:[]});
    return {run:r.id,conversation:c.id};
  })()`);
  await wait(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')`);
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]').click()`);
  await wait(`window.fielora.agent.get({run_id:${q(ids.run)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  const result = await cdp.eval(`(async()=>({run:await window.fielora.agent.get({run_id:${q(ids.run)}}),tools:await window.fielora.agent.toolCalls({run_id:${q(ids.run)}}),events:await window.fielora.agent.events({run_id:${q(ids.run)},after_sequence:null,limit:500})}))()`);
  await writeFile(path.join(evidence, 'research.json'), JSON.stringify(result, null, 2));
  assert.equal(result.run.error_code, 'AGENT_USER_INPUT_REQUIRED', JSON.stringify(result.run));
  const fetch = result.tools.find(t => t.name === 'web.fetch');
  assert.equal(fetch.status, 'FAILED');
  assert.match(fetch.error_code, /DESTINATION_REJECTED/);
  assert.ok(!result.tools.some(t => t.name === 'web.search'));
  const pages = result.tools.filter(t => t.name === 'browser');
  assert.equal(pages.length, 3);
  assert.equal(pages[0].receipt.model_view, 'TEXT');
  assert.ok(pages[0].receipt.elements.length >= 200, 'Durable host receipt remains intact');
  assert.equal(pages[2].receipt.success, true);
  assert.match(pages[2].receipt.text, /RESEARCH_CLICKED/, 'Actual native input changed the page');
  const afterText = result.events.find(e => e.kind === 'MODEL_COMPLETED' && e.payload.step === 5);
  const afterInteractive = result.events.find(e => e.kind === 'MODEL_COMPLETED' && e.payload.step === 6);
  assert.ok(afterInteractive.payload.prompt.message_bytes - afterText.payload.prompt.message_bytes > 20000, 'Text projection materially excludes the real control tree');
  await wait("[...document.querySelectorAll('[data-testid=operation-group-toggle]')].some(e => e.textContent.includes('127.0.0.1') && e.textContent.includes('已返回'))");
  await captureScreenshot(cdp, path.join(evidence, 'research.png'));
  await cdp.eval("[...document.querySelectorAll('[data-testid=operation-group-toggle]')].filter(e => e.textContent.includes('已返回') && e.getAttribute('aria-expanded') === 'false').forEach(e => e.click())");
  await wait("document.querySelector('[data-testid=operation-list]')?.textContent.includes('读取网页')");
  await captureScreenshot(cdp, path.join(evidence, 'research-expanded.png'));
  await writeFile(path.join(evidence, 'validation.json'), JSON.stringify({ status: 'PASS', scope: 'Real desktop, synthetic model; not original workshop acceptance', externalModelRequests: 0, publicFetchRegistered: true, privateFetchRejected: true, actualTextProjectionConsumed: true, interactiveNativeClick: true, result: result.run }, null, 2));
  console.log(`RESEARCH_E2E=PASS evidence=${evidence}`);
} catch (error) {
  if (port) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(t => t.url === url);
    if (target) {
      const page = new CdpConnection(target.webSocketDebuggerUrl); await page.open();
      const diagnostic = await page.eval('({text:document.querySelector("h1")?.textContent,onclick:typeof document.querySelector("button")?.onclick,hidden:document.hidden,focused:document.hasFocus(),rect:document.querySelector("button")?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight],trace:window.inputTrace})');
      await writeFile(path.join(evidence, 'input-diagnostic.json'), JSON.stringify(diagnostic, null, 2));
      page.close();
    }
  }
  console.error(output.join('').slice(-5000));
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(() => {});
  throw error;
} finally {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(() => {}); cdp.close(); }
  if (child) await cleanupElectronProcess(child);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
