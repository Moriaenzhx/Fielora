import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { launchElectron, connectToFieloraApp, waitForExpression, captureScreenshot, cleanupElectronProcess } from './harness/electron-cdp-harness.mjs';

assert.equal(process.platform, 'darwin', 'This regression verifies the macOS backend; do not report another OS as passed.');
const root = path.resolve(import.meta.dirname, '../..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-command-permissions-'));
const evidence = await mkdtemp(path.join(tmpdir(), 'fielora-command-permissions-evidence-'));
const output = [];
const q = JSON.stringify;
let child, cdp, db;
const server = net.createServer(socket => socket.end());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const launch = async () => {
  const launched = await launchElectron({ root: path.join(root, 'apps/desktop'), dataRoot, output,
    executablePath: process.env.FIELORA_PACKAGED_EXE ?? process.execPath,
    args: process.env.FIELORA_PACKAGED_EXE ? [] : [path.join(root, 'node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'] });
  child = launched.child;
  cdp = await connectToFieloraApp({ port: launched.port, output, enablePage: true, timeoutMs: 120000 });
  await wait("window.fieloraTest && window.fielora.core.getHealth().then(h=>h.state==='READY')");
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 760, deviceScaleFactor: 1, mobile: false });
};
const wait = expression => waitForExpression(cdp, expression, { output, timeoutMs: 90000 });
const click = async selector => { await wait(`document.querySelector(${q(selector)})`); await cdp.eval(`document.querySelector(${q(selector)}).click()`); };
const reload = async () => { await cdp.eval('window.__permissionReload=true'); await cdp.send('Page.reload'); await wait("window.__permissionReload!==true && window.fielora && document.querySelector('[data-testid=settings-nav]')"); };
const stop = async () => {
  if (cdp) { await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{}); cdp.close(); cdp = null; }
  if (child) { await cleanupElectronProcess(child); child = null; }
};
try {
  await launch();
  await cdp.eval(`(async()=>{
    const p=await window.fielora.provider.create({provider_kind:'OPENAI_COMPATIBLE',display_name:'命令权限验证',base_url:'https://example.com/v1',default_model:'__fielora_agent_fixture_command_permissions__',custom_endpoint_acknowledged:true});
    await window.fielora.provider.storeCredential({provider_config_id:p.id,secret:'synthetic-command-policy-only'});
  })()`);
  db = new DatabaseSync(path.join(dataRoot, 'Fielora/data/fielora.db'));
  const results = [];
  for (const kind of ['PROJECT_INSTALL', 'NODE_INSTALL', 'RESTRICTED_COMMAND', 'SYSTEM_INSTALL']) {
    const projectRoot = path.join(dataRoot, kind); await mkdir(projectRoot);
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    await writeFile(path.join(projectRoot, 'requirements.txt'), '--no-index\nfielora_probe-0.0.1-py3-none-any.whl\n');
    if (kind === 'PROJECT_INSTALL') {
      execFileSync('/usr/bin/python3', ['-m', 'venv', path.join(projectRoot, '.venv')]);
      const createWheel = `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1], 'w') as w:\n w.writestr('fielora_probe.py', 'VALUE = 42\\n')\n w.writestr('fielora_probe-0.0.1.dist-info/METADATA', 'Metadata-Version: 2.1\\nName: fielora-probe\\nVersion: 0.0.1\\n')\n w.writestr('fielora_probe-0.0.1.dist-info/WHEEL', 'Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')\n w.writestr('fielora_probe-0.0.1.dist-info/RECORD', '')\n`;
      execFileSync('/usr/bin/python3', ['-c', createWheel, path.join(projectRoot, 'fielora_probe-0.0.1-py3-none-any.whl')]);
    } else if (kind === 'NODE_INSTALL') {
      const outside = path.join(dataRoot, 'outside-node'); await mkdir(outside);
      await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'fielora-offline-permission-probe', version: '1.0.0', private: true, scripts: { postinstall: 'node install-probe.cjs' } }));
      await writeFile(path.join(projectRoot, 'install-probe.cjs'), `const fs=require('node:fs'); fs.writeFileSync('installed.txt','local script ran'); try { fs.writeFileSync(${q(path.join(outside, 'denied.txt'))}, 'escape'); throw Error('write escaped'); } catch(e) { if(!['EPERM','EACCES'].includes(e.code)) throw e; fs.writeFileSync('script-isolation.txt', 'DENIED'); }`);
    } else if (kind === 'RESTRICTED_COMMAND') {
      const outside = path.join(dataRoot, 'outside'); await mkdir(outside);
      await symlink(outside, path.join(projectRoot, 'outside-link'));
      await writeFile(path.join(projectRoot, 'sandbox_probe.py'), `from pathlib import Path\nimport socket,json\nPath('project-write.txt').write_text('allowed')\nresults = {}\nfor label, target in [('outside', ${q(path.join(outside, 'denied.txt'))}), ('symlink', 'outside-link/denied.txt')]:\n try:\n  Path(target).write_text('must not happen')\n  results[label] = 'ESCAPED'\n except PermissionError:\n  results[label] = 'DENIED'\ntry:\n s=socket.create_connection(('127.0.0.1', ${port}), timeout=1)\n s.close()\n results['network']='ESCAPED'\nexcept OSError:\n results['network']='DENIED'\nPath('sandbox-result.json').write_text(json.dumps(results))\nassert all(v == 'DENIED' for v in results.values()), results\n`);
    }
    const field = await cdp.eval(`window.fieloraTest.createProject({title:${q(kind)},goal:null,root_path:${q(projectRoot)}}).then(p=>p.field_id)`);
    await reload(); await click(`[data-testid="project-${field}"]`);
    await wait('document.querySelector("textarea[name=prompt]")');
    await cdp.eval(`(()=>{const e=document.querySelector('textarea[name=prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${q(`运行命令权限回归 ${kind}`)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-testid=composer-permission]');
    const menu = await cdp.eval("document.querySelector('.permission-picker')?.textContent");
    assert.match(menu, /普通命令不使用沙箱/);
    await click(`[data-testid=composer-permission-option-${kind === 'RESTRICTED_COMMAND' ? 'REVIEW_CHANGES' : 'FULL_CONTROL'}]`);
    await click('[data-testid=send-message]');
    if (kind === 'SYSTEM_INSTALL') await wait("document.querySelector('[data-testid=command-approval-reason]')?.textContent.includes('项目虚拟环境')");
    else await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('权限回归已完成')");
    const run = db.prepare('SELECT id,conversation_id,status,permission FROM agent_runs WHERE field_id=?').get(field);
    const command = db.prepare("SELECT id,status,policy_decision,arguments_json,receipt_json FROM agent_tool_calls WHERE run_id=? AND name='run_command'").get(run.id);
    const args = JSON.parse(command.arguments_json);
    const receipt = command.receipt_json ? JSON.parse(command.receipt_json) : null;
    if (kind === 'SYSTEM_INSTALL') {
      assert.equal(command.policy_decision, 'ASK'); assert.equal(command.status, 'WAITING_APPROVAL');
      assert.equal(args._command_policy.reason, 'INSTALLATION_REQUIRES_APPROVAL');
      assert.equal(args._command_policy.automatic_project_install, false, 'Model-supplied privilege must be replaced');
      assert.equal(receipt, null);
      await captureScreenshot(cdp, path.join(evidence, 'system-approval.png'));
      await stop(); await launch(); await click(`[data-testid="conversation-${run.conversation_id}"]`);
      await wait("document.querySelector('[data-testid=command-approval-reason]')?.textContent.includes('项目虚拟环境')");
      assert.equal(db.prepare('SELECT status FROM agent_tool_calls WHERE id=?').get(command.id).status, 'WAITING_APPROVAL');
      await click('[data-testid=agent-approval] button:nth-last-child(2)');
      await wait("document.querySelector('[data-testid=agent-pause-notice]')?.textContent.includes('权限回归已完成')");
      assert.equal(db.prepare('SELECT status FROM agent_tool_calls WHERE id=?').get(command.id).status, 'DENIED');
      assert.equal(db.prepare("SELECT count(*) n FROM agent_tool_calls WHERE run_id=? AND name='run_command'").get(run.id).n, 1);
    } else {
      assert.equal(command.policy_decision, 'ALLOW'); assert.equal(command.status, 'COMPLETED');
      assert.equal(receipt.success, true); assert.equal(receipt.execution_boundary, 'MACOS_WORKSPACE_WRITE_SANDBOX');
      assert.equal(db.prepare('SELECT count(*) n FROM agent_approvals WHERE run_id=?').get(run.id).n, 0);
      if (kind === 'PROJECT_INSTALL') {
        assert.equal(receipt.network_policy, 'ALLOWED');
        const verified = execFileSync(path.join(projectRoot, '.venv/bin/python3'), ['-c', 'import fielora_probe; print(fielora_probe.VALUE)'], { encoding: 'utf8' });
        assert.equal(verified.trim(), '42');
      } else if (kind === 'NODE_INSTALL') {
        assert.equal(receipt.network_policy, 'ALLOWED');
        assert.equal(await readFile(path.join(projectRoot, 'installed.txt'), 'utf8'), 'local script ran');
        assert.equal(await readFile(path.join(projectRoot, 'script-isolation.txt'), 'utf8'), 'DENIED');
      } else {
        assert.equal(receipt.network_policy, 'DENIED');
        assert.deepEqual(JSON.parse(await readFile(path.join(projectRoot, 'sandbox-result.json'), 'utf8')), { outside: 'DENIED', symlink: 'DENIED', network: 'DENIED' });
      }
      await captureScreenshot(cdp, path.join(evidence, `${kind}.png`));
    }
    results.push({ kind, run, command: { ...command, arguments: args, receipt } });
  }
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ status: 'PASS', scope: 'real macOS commands and isolated desktop/Core; synthetic model, offline wheel, no production state', results }, null, 2));
  console.log(`COMMAND_PERMISSIONS=PASS evidence=${evidence}`);
} catch (error) {
  if (cdp) await captureScreenshot(cdp, path.join(evidence, 'failure.png')).catch(()=>{});
  if (db) await writeFile(path.join(evidence, 'failure-ledger.json'), JSON.stringify({ runs: db.prepare('SELECT id,status,error_code,current_step FROM agent_runs').all(), tools: db.prepare('SELECT name,status,arguments_json,receipt_json,error_code FROM agent_tool_calls').all() }, null, 2));
  console.error(`Failure evidence: ${evidence}`);
  console.error(output.join('').slice(-3500)); throw error;
} finally {
  await stop(); db?.close(); server.close(); await rm(dataRoot, { recursive: true, force: true });
}
