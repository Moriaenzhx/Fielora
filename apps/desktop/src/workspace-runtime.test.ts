import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkspaceRuntime } from './workspace-runtime.ts';

test('latest process output continues past the terminal emission cap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fielora-log-tail-'));
  const emitted: string[] = [];
  const runtime = new WorkspaceRuntime(event => { if (event.kind === 'OUTPUT') emitted.push(event.text ?? ''); });
  try {
    await writeFile(path.join(root, 'output.cjs'), "process.stdout.write('67% building\\n'+'x'.repeat(600*1024));setTimeout(()=>process.stdout.write('\\n100% compiled: ready\\n'),100);\n");
    const command = process.platform === 'win32'
      ? `& '${process.execPath.replaceAll("'", "''")}' 'output.cjs'`
      : `'${process.execPath.replaceAll("'", "'\\''")}' 'output.cjs'`;
    const run = await runtime.runTerminal(root, 'test', command);
    const deadline = Date.now() + 10_000;
    while (runtime.agentServerStatus(run.run_id).status === 'RUNNING' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    const result = runtime.agentServerStatus(run.run_id);
    assert.equal(result.status, 'COMPLETED');
    assert.ok(result.output.endsWith('100% compiled: ready\n'));
    assert.ok(result.output.length <= 8192);
    assert.ok(!emitted.join('').includes('100% compiled: ready'));
    assert.equal(emitted.filter(text => text.includes('Fielora truncated terminal output')).length, 1);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

for (const action of ['cancel', 'stop-server', 'dispose']) {
  test(`Unix terminal ${action} stops descendants`, { skip: process.platform === 'win32', timeout: 10000 }, async () => {
    const { execFileSync } = await import('node:child_process');
    const root = await mkdtemp(path.join(tmpdir(), 'fielora-process-tree-'));
    let output = '';
    const runtime = new WorkspaceRuntime(event => { if (event.kind === 'OUTPUT') output += event.text; });
    try {
      await writeFile(path.join(root, 'tree.cjs'), "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(child.pid);setInterval(()=>{},1000);\n");
      const command = `'${process.execPath.replaceAll("'", "'\"'\"'")}' tree.cjs`;
      const id = action === 'stop-server' ? await runtime.startAgentServer(root, 'test', command) : (await runtime.runTerminal(root, 'test', command)).run_id;
      const deadline = Date.now() + 4000;
      while (!/^\d+\s*$/.test(output) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.match(output, /^\d+\s*$/);
      if (action === 'cancel') runtime.cancelTerminal(id);
      else if (action === 'stop-server') await runtime.stopAgentServer(id);
      else runtime.dispose();
      for (;;) {
        let state = '';
        try { state = execFileSync('/bin/ps', ['-o', 'stat=', '-p', output.trim()], { encoding: 'utf8' }).trim(); } catch { /* Process reaped. */ }
        if (!state || state.startsWith('Z')) break;
        assert.ok(Date.now() < deadline, 'descendant survived termination');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { runtime.dispose(); await rm(root, { recursive: true, force: true }); }
  });
}
