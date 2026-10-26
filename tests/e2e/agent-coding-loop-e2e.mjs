import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, cleanupElectronProcess, captureScreenshot } from './harness/electron-cdp-harness.mjs';

// Deterministic model; production request compiler and real files/checks.
// Exercises budget pressure, direct recovery, guarded edits, discovery and cold resume.
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-coding-loop-'));
const projectRoot = path.join(dataRoot, 'project');
const evidence = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-coding-loop-evidence-'));
const output = [], q = JSON.stringify;
let child, cdp;
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 90000 });
async function launch() {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  await wait('window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==="READY")');
}
async function stop() {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
}
try {
  await mkdir(projectRoot); await mkdir(evidence, { recursive: true });
  execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  const source = '# ' + 's'.repeat(18467) + '\ndef pending(owed):\n    return max(sum(owed), 0) # SOURCE_IMPLEMENTATION_TAIL\n';
  const tests = '# ' + 't'.repeat(18959) + '\nimport unittest\nfrom amount import pending\nclass Cases(unittest.TestCase):\n    def test_overpayment_cannot_offset_other_projects(self):\n        self.assertEqual(pending([15000, -3000]), 15000) # SOURCE_ASSERTIONS_TAIL\n';
  await writeFile(path.join(projectRoot, 'amount.py'), source);
  await writeFile(path.join(projectRoot, 'test_amount.py'), tests);
  await writeFile(path.join(projectRoot, 'input.csv'), 'id,value\n1,preserved\n');
  for (let i=0;i<4;i++) await writeFile(path.join(projectRoot, `noise${i}.txt`), String(i).repeat(60000));
  await launch();
  const ids = await cdp.eval(`(async()=>{
    const model='__fielora_agent_fixture_coding_loop__';
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'Coding loop fixture',base_url:'https://example.com/v1',default_model:model,custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'fixture-only'});
    const f=await window.fieloraTest.createProject({title:'Coding loop',goal:null,root_path:${q(projectRoot)}});
    const c=await window.fielora.conversation.create({field_id:f.field_id,title:'Direct repair after a failed assertion',provider_config_id:p.id,model_id:model});
    // The old short-task fixture missed history competing with source. Exercise
    // real persisted conversation history, not only large tool result bodies.
    for (const [i,size] of [6,340,269,2146,2262,3307,815,1887,1750,1953,1978,4983].entries()) {
      const content=('Historical discussion. ').repeat(Math.ceil(size*2/23)).slice(0,size*2);
      await window.fielora.conversation.createMessage({conversation_id:c.id,role:i%2?'ASSISTANT':'USER',content,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    }
    const task='Fix the aggregation and run the assertion test.';
    const m=await window.fielora.conversation.createMessage({conversation_id:c.id,role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    const r=await window.fielora.agent.start({field_id:f.field_id,conversation_id:c.id,user_message_id:m.id,provider_config_id:p.id,model_id:model,task,permission:'FULL_CONTROL',max_steps:30,attachments:[]});
    return {run:r.id,conversation:c.id,field:f.field_id,provider:p.id,model};
  })()`);
  const terminal = id => wait(`window.fielora.agent.get({run_id:${q(id)}}).then(r=>['PAUSED','FAILED','COMPLETED'].includes(r.status))`);
  const calls = id => cdp.eval(`window.fielora.agent.toolCalls({run_id:${q(id)}})`);
  const events = id => cdp.eval(`window.fielora.agent.events({run_id:${q(id)},after_sequence:null,limit:500})`);
  await terminal(ids.run);
  const result = await cdp.eval(`window.fielora.agent.get({run_id:${q(ids.run)}})`);
  const history = await events(ids.run), tools = await calls(ids.run);
  await writeFile(path.join(evidence,'warm.json'),q({result,history,tools}));
  assert.equal(result.status,'COMPLETED',q(result));
  assert.ok(history.some(e=>e.payload.kind==='GENERAL_CONTEXT_REDUCED'), 'Must exercise actual full-request reduction');
  assert.ok(history.filter(e=>e.kind==='MODEL_COMPLETED').every(e=>e.payload.prompt.budget.fits===true));
  const reductions=history.filter(e=>e.payload.kind==='GENERAL_CONTEXT_REDUCED');
  assert.ok(reductions.every(e=>e.payload.budget.retained_source_bytes>=37000),'History pressure must leave both observed working files available');
  assert.equal(history.filter(e=>e.kind==='STEP_STARTED'&&e.payload.phase==='REVIEW').length,0);
  assert.equal(history.filter(e=>e.payload.kind==='WORK_REVIEW_V1').length,0);
  assert.equal(tools.filter(t=>t.name==='read_file').length,6,'Warm execution must retain both needed source bodies');
  const failed = tools.findIndex(t=>t.name==='run_command'&&t.receipt?.exit_code===1);
  assert.ok(failed>=0); assert.equal(tools[failed+1].name,'apply_patches','Failed assertion goes straight to the repair');
  assert.equal(tools[failed+1].status,'COMPLETED');
  assert.match(tools[failed+1].arguments.patches[0].expected_sha256,/^[a-f0-9]{64}$/,'Canonical persisted batch proposal retains inferred guard');
  assert.equal(tools.filter(t=>t.name==='apply_patches').length,1);
  assert.ok(tools.some(t=>t.name==='run_command'&&t.receipt?.success===true&&t.receipt?.verification_eligible===true));
  const firstPrompt=history.find(e=>e.kind==='MODEL_COMPLETED').payload.prompt;
  const lastPrompt=history.filter(e=>e.kind==='MODEL_COMPLETED').at(-1).payload.prompt;
  // General tasks also expose optional review; it must not consume the core
  // discovery budget or introduce a mandatory review step (checked above).
  assert.ok(firstPrompt.visible_tool_names.includes('record_work_review'));
  assert.ok(firstPrompt.tool_count<=20,q(firstPrompt.visible_tool_names));
  assert.ok(firstPrompt.visible_tool_names.filter(name=>name!=='record_work_review').length<=19);
  assert.ok(firstPrompt.message_bytes>=43000,'Large history must reach the actual model request');
  assert.ok(!firstPrompt.visible_tool_names.includes('apply_patches'));
  assert.ok(lastPrompt.visible_tool_names.includes('apply_patches'));
  assert.equal(await readFile(path.join(projectRoot,'test_amount.py'),'utf8'),tests);
  assert.equal(await readFile(path.join(projectRoot,'input.csv'),'utf8'),'id,value\n1,preserved\n');

  // Pause immediately after the real failing check, then destroy Core memory.
  await writeFile(path.join(projectRoot,'amount.py'),source);
  const cold = await cdp.eval(`(async()=>{
    const task='Fix the aggregation and run the assertion test.';
    const m=await window.fielora.conversation.createMessage({conversation_id:${q(ids.conversation)},role:'USER',content:task,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
    return await window.fielora.agent.start({field_id:${q(ids.field)},conversation_id:${q(ids.conversation)},user_message_id:m.id,provider_config_id:${q(ids.provider)},model_id:${q(ids.model)},task,permission:'FULL_CONTROL',max_steps:8,attachments:[]});
  })()`);
  await terminal(cold.id);
  assert.equal((await cdp.eval(`window.fielora.agent.get({run_id:${q(cold.id)}})`)).status,'PAUSED');
  assert.ok((await calls(cold.id)).some(t=>t.name==='run_command'&&t.receipt?.exit_code===1));
  await stop(); await launch();
  await cdp.eval(`window.fielora.agent.resume({run_id:${q(cold.id)}})`);
  await terminal(cold.id);
  const coldResult=await cdp.eval(`window.fielora.agent.get({run_id:${q(cold.id)}})`);
  const coldHistory=await events(cold.id),coldTools=await calls(cold.id);
  await writeFile(path.join(evidence,'cold.json'),q({result:coldResult,history:coldHistory,tools:coldTools}));
  assert.equal(coldResult.status,'COMPLETED',q(coldResult));
  assert.equal(coldHistory.filter(e=>e.kind==='STEP_STARTED'&&e.payload.phase==='REVIEW').length,0);
  assert.equal(coldTools.filter(t=>t.name==='apply_patches').length,1);
  const failures = coldTools.filter(t=>t.name==='run_command'&&t.receipt?.exit_code===1);
  assert.equal(failures.length,2,'Cold restore reacquires the missing diagnostic exactly once');
  const freshFailureIndex = coldTools.findIndex(t=>t.id===failures[1].id);
  assert.equal(coldTools[freshFailureIndex+1].name,'apply_patches','Fresh diagnostics lead directly to a batch edit');
  assert.match(coldTools[freshFailureIndex+1].arguments.patches[0].expected_sha256,/^[a-f0-9]{64}$/);
  assert.ok(coldTools.filter(t=>t.name==='read_file').length<=8,'Cold restore only reacquires missing active source');
  assert.equal(await readFile(path.join(projectRoot,'input.csv'),'utf8'),'id,value\n1,preserved\n');
  await cdp.eval(`document.querySelector('[data-testid="conversation-${ids.conversation}"]')?.click()`);
  await wait(`Array.from(document.querySelectorAll('[data-agent-turn]')).some(n=>n.textContent.includes('Aggregation repaired'))`);
  await cdp.eval(`Array.from(document.querySelectorAll('[data-agent-turn]')).filter(n=>n.textContent.includes('Aggregation repaired')).at(-1).scrollIntoView({block:'end',behavior:'instant'})`);
  await captureScreenshot(cdp,path.join(evidence,'completed.png'));
  await writeFile(path.join(evidence,'results.json'),q({status:'PASS',scope:'Deterministic model; real Electron/Core, source pressure, observed failed/passing assertions, batch guard, discovery, cold diagnostic reacquisition. No real-model performance claim.',warm:ids.run,cold:cold.id,firstToolCount:firstPrompt.tool_count,firstSchemaBytes:firstPrompt.tool_schema_bytes}));
  console.log('AGENT_CODING_LOOP=PASS evidence='+evidence);
} catch(error) {
  if(cdp) await captureScreenshot(cdp,path.join(evidence,'failure.png')).catch(()=>{});
  console.error(output.join('').slice(-2000)); throw error;
} finally { await stop(); await rm(dataRoot,{recursive:true,force:true}); }
