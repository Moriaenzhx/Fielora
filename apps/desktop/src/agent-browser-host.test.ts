import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentBrowserHost, browserHttpUrl, browserServerCommand } from './agent-browser-host.ts';
import type { BrowserRuntime } from './browser-runtime';

test('slow managed startup remains STARTING, duplicate start keeps ownership, status later listens', async () => {
  const server = createServer();
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  let starts = 0, running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listen!: () => void;
  const listening = new Promise<void>(resolve => { listen = resolve; });
  const workspace = {
    startAgentServer: async () => { starts++; running = true; timer = setTimeout(() => server.listen(port, '127.0.0.1', listen), 2300); return 'owned'; },
    agentServerStatus: () => ({ status: running ? 'RUNNING' : 'STOPPED', output: '', exit_code: running ? null : 0 }),
    stopAgentServer: async () => { running = false; if (timer) clearTimeout(timer); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); },
  };
  const replies = new Map<string, (result: Record<string, unknown>) => void>();
  const host = new AgentBrowserHost(() => { throw new Error('not a page action'); }, async (_, params) => {
    const r = params as { request_id: string; result: Record<string, unknown> }; replies.get(r.request_id)!(r.result);
  }, () => {}, () => workspace as unknown as import('./workspace-runtime').WorkspaceRuntime);
  const url = `http://127.0.0.1:${port}/`;
  const call = (id: string, action: string) => new Promise<Record<string, unknown>>(resolve => {
    replies.set(id, resolve); host.handle({ request_id: id, run_id: 'slow', conversation_id: 'c', tool_call_id: id,
      name: 'browser_server', project_root: 'project', field_id: 'field', arguments: { action, url, program: 'python3', argv: ['app.py'] } });
  });
  try {
    const start = await call('start', 'start');
    assert.equal(start.success, true); assert.equal(start.status, 'RUNNING'); assert.equal(start.readiness, 'STARTING');
    assert.match(String(start.guidance), /WAS spawned/);
    const duplicate = await call('duplicate', 'start');
    assert.equal(duplicate.error_code, 'BROWSER_SERVER_ALREADY_RUNNING'); assert.equal(duplicate.status, 'RUNNING');
    assert.equal(starts, 1); assert.equal(duplicate.input_state, 'NOT_DISPATCHED');
    await listening;
    const ready = await call('status', 'status');
    assert.equal(ready.readiness, 'LISTENING'); assert.equal(ready.page_verified, false);
    assert.match(String(ready.guidance), /SAME TCP probe/);
  } finally { await workspace.stopAgentServer(); host.reset(); }
});

test('process exit during startup reports the exit, not an infinite starting state', async () => {
  let observations = 0;
  const workspace = {
    startAgentServer: async () => 'failed', stopAgentServer: async () => {},
    agentServerStatus: () => (++observations < 2 ? { status: 'RUNNING', output: '', exit_code: null }
      : { status: 'FAILED', output: 'ImportError: missing module', exit_code: 1 }),
  };
  let finish!: (r: Record<string, unknown>) => void;
  const result = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  const host = new AgentBrowserHost(() => { throw new Error('no browser'); }, async (_, params) => {
    finish((params as { result: Record<string, unknown> }).result);
  }, () => {}, () => workspace as unknown as import('./workspace-runtime').WorkspaceRuntime);
  host.handle({ request_id: 'failed', run_id: 'failed', conversation_id: 'c', tool_call_id: 't', name: 'browser_server',
    project_root: 'project', field_id: 'field', arguments: { action: 'start', program: 'python3', argv: ['app.py'], url: 'http://127.0.0.1:1/' } });
  const receipt = await result;
  assert.equal(receipt.success, false); assert.equal(receipt.service_phase, 'EXITED');
  assert.equal(receipt.readiness, 'PROCESS_STOPPED'); assert.equal(receipt.exit_code, 1);
  assert.match(String(receipt.output), /ImportError/); host.reset();
});

test('cancelling managed startup stops the newly owned process', async () => {
  let starts = 0, stops = 0;
  const workspace = {
    startAgentServer: async () => { starts++; setTimeout(() => host.cancel('cancel-start'), 30); return 'owned'; },
    agentServerStatus: () => ({ status: 'RUNNING', output: '', exit_code: null }),
    stopAgentServer: async () => { stops++; },
  };
  let finish!: (r: Record<string, unknown>) => void;
  const result = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  const host = new AgentBrowserHost(() => { throw new Error('no browser'); }, async (_, params) => {
    finish((params as { result: Record<string, unknown> }).result);
  }, () => {}, () => workspace as unknown as import('./workspace-runtime').WorkspaceRuntime);
  host.handle({ request_id: 'cancel-start', run_id: 'cancel-start', conversation_id: 'c', tool_call_id: 't', name: 'browser_server',
    project_root: 'project', field_id: 'field', arguments: { action: 'start', program: 'python3', argv: ['app.py'], url: 'http://127.0.0.1:1/' } });
  const receipt = await result;
  assert.equal(receipt.error_code, 'BROWSER_CANCELLED');
  assert.equal(starts, 1); assert.equal(stops, 1);
  host.reset();
});

test('desktop viewport is bounded and passed to the existing browser runtime', async () => {
  const calls: unknown[] = [], completed: { result: Record<string, unknown> }[] = [];
  const runtime = { executeAgent: async (_run: string, args: unknown) => { calls.push(args); return { success: true, viewport: { width: 1280, height: 900 } }; } } as unknown as BrowserRuntime;
  const host = new AgentBrowserHost(() => runtime, async (_method, params) => { completed.push(params as typeof completed[number]); }, () => {});
  const identity = { run_id: 'run', conversation_id: 'conv', tool_call_id: 'tool', name: 'browser' };
  for (const [request_id, width, height] of [['valid', 1280, 900], ['too-small', 1, 900], ['too-large', 1280, 9000], ['string', '1280', 900]] as const) {
    host.handle({ ...identity, request_id, arguments: { action: 'resize', width, height } });
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { width: number }).width, 1280);
  assert.equal(completed.filter(r => r.result.error_code === 'BROWSER_INVALID_VIEWPORT').length, 3);
  assert.deepEqual(completed.find(r => r.result.success)?.result.viewport, { width: 1280, height: 900 });
});

test('a failed screenshot cannot turn passing DOM checks into verified success', async () => {
  const checks = [{ property: 'contains', expected: '正确文案', passed: true }];
  const runtime = {
    executeAgent: async () => ({ success: true, url: 'http://127.0.0.1:8011/', snapshot_id: 'next', checks }),
    captureCurrentViewport: async () => { throw new Error('UnknownVizError'); },
  } as unknown as BrowserRuntime;
  let finish!: (value: Record<string, unknown>) => void;
  const completed = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  const host = new AgentBrowserHost(() => runtime, async (method, params) => {
    const reply = params as { request_id: string; result: Record<string, unknown> };
    if (method === 'host.browser.complete' && reply.request_id === 'verify') finish(reply.result);
  }, () => {});
  const identity = { run_id: 'run', conversation_id: 'conv', tool_call_id: 'tool' };
  host.handle({ ...identity, request_id: 'plan', name: 'browser_plan', arguments: { url: 'http://127.0.0.1:8011/', cases: [{ id: 'labels', requirement: '弹窗应显示正确的到账文案' }] } });
  host.handle({ ...identity, request_id: 'verify', name: 'browser_verify', arguments: { case_id: 'labels', snapshot_id: 'previous', checks: [{ property: 'contains', expected: '正确文案' }] } });
  const result = await completed;
  assert.equal(result.success, false);
  assert.equal(result.error_code, 'BROWSER_SCREENSHOT_FAILED');
  assert.equal(result.snapshot_id, 'next');
  assert.deepEqual(result.checks, checks);
  assert.equal(result.screenshot, undefined);
});

test('browser tools reject privileged schemes and credential-bearing URLs', () => {
  for (const url of ['file:///C:/secret', 'fielora://app', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:secret@example.com']) assert.throws(() => browserHttpUrl(url));
  assert.equal(browserHttpUrl('http://127.0.0.1:8011/'), 'http://127.0.0.1:8011/');
});

test('development server arguments remain literal and reject shell programs', () => {
  assert.equal(browserServerCommand({ program: 'npm', argv: ['run', 'dev', '--', '--host', '127.0.0.1'] }, 'win32'), "& 'npm.cmd' 'run' 'dev' '--' '--host' '127.0.0.1'");
  assert.equal(browserServerCommand({ program: 'node', argv: ["test'file.js", '$(secret); `echo x`'] }, 'win32'), "& 'node' 'test''file.js' '$(secret); `echo x`'");
  assert.throws(() => browserServerCommand({ program: 'powershell', argv: ['-Command', 'anything'] }));
  assert.throws(() => browserServerCommand({ program: 'node', argv: ['line\nbreak'] }));
});

test('Python server accepts observed interpreters and quotes paths without treating them as shell', () => {
  for (const program of ['python', 'python3', '/usr/bin/python3', '/a project/.venv/bin/python3.12', '.venv/bin/python']) {
    assert.ok(browserServerCommand({ program, argv: ['-u', 'app.py'] }, 'darwin').endsWith("'-u' 'app.py'"));
  }
  assert.equal(browserServerCommand({ program: 'C:\\A project\\.venv\\Scripts\\python.exe', argv: ['-u', 'app.py'] }, 'win32'), "& 'C:\\A project\\.venv\\Scripts\\python.exe' '-u' 'app.py'");
  for (const program of ['bash', '/bin/sh', 'python3; echo x', '../bin/python3', 'python3\n', '']) {
    assert.throws(() => browserServerCommand({ program, argv: ['app.py'] }, 'darwin'));
  }
});

test('real Python managed server survives returned calls and is stopped only by its owner', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { WorkspaceRuntime } = await import('./workspace-runtime.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'fielora-python-server-'));
  const workspace = new WorkspaceRuntime(() => {});
  const replies = new Map<string, (result: Record<string, unknown>) => void>();
  const host = new AgentBrowserHost(() => { throw new Error('no page needed'); }, async (_, params) => {
    const reply = params as { request_id: string; result: Record<string, unknown> };
    replies.get(reply.request_id)!(reply.result);
  }, () => {}, () => workspace);
  let serial = 0;
  const call = (args: Record<string, unknown>, run = 'owner') => new Promise<Record<string, unknown>>(resolve => {
    const id = String(++serial); replies.set(id, resolve);
    host.handle({ request_id: id, run_id: run, conversation_id: 'conv', tool_call_id: id, name: 'browser_server', arguments: args, project_root: root, field_id: 'field' });
  });
  try {
    await writeFile(path.join(root, 'server.py'), "from http.server import HTTPServer, BaseHTTPRequestHandler\nclass Handler(BaseHTTPRequestHandler):\n def do_GET(self):\n  self.send_response(200)\n  self.end_headers()\n  self.wfile.write(b'python-managed')\ns = HTTPServer(('127.0.0.1', 0), Handler)\nprint('http://127.0.0.1:' + str(s.server_port), flush=True)\ns.serve_forever()\n");
    assert.equal((await call({ action: 'start', program: 'python3', argv: ['-u', 'server.py'] })).success, true);
    let status: Record<string, unknown> = {}, url = '';
    const deadline = Date.now() + 8000;
    while (!url && Date.now() < deadline) {
      status = await call({ action: 'status' });
      url = String(status.output).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? '';
      if (!url) await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(url, JSON.stringify(status));
    assert.equal(await (await fetch(url)).text(), 'python-managed');
    const ready = await call({ action: 'status', url });
    assert.equal(ready.readiness, 'LISTENING'); assert.equal(ready.verification_eligible, false);
    await call({ action: 'stop' }, 'other-run');
    assert.equal(await (await fetch(url)).text(), 'python-managed');
    await call({ action: 'stop' });
    while ((await call({ action: 'status', url })).status === 'RUNNING' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(fetch(url));
  } finally { host.reset(); workspace.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('invalid cases and stale snapshots never reach the page backend', async () => {
  let calls = 0;
  const completed: unknown[] = [];
  const host = new AgentBrowserHost(() => { calls++; throw new Error('must not access backend'); }, async (_method, params) => { completed.push(params); }, () => {});
  host.handle({ request_id: 'one', run_id: 'run', conversation_id: 'conv', tool_call_id: 't1', name: 'browser_verify', arguments: { case_id: 'unknown', snapshot_id: 'abc', checks: [{ property: 'contains', expected: 'ok' }] } });
  host.handle({ request_id: 'two', run_id: 'run', conversation_id: 'conv', tool_call_id: 't2', name: 'browser', arguments: { action: 'fill', ref: 'e1', value: '123' } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 0);
  assert.equal(completed.length, 2);
  assert.ok(JSON.stringify(completed).includes('BROWSER_STALE_SNAPSHOT'));
});

test('queued cancellation cannot execute a browser side effect', async () => {
  let calls = 0;
  const completed: unknown[] = [];
  const host = new AgentBrowserHost(() => { calls++; throw new Error('unexpected'); }, async (_method, params) => { completed.push(params); }, () => {});
  host.handle({ request_id: 'cancelled', run_id: 'run', conversation_id: 'conv', tool_call_id: 't', name: 'browser', arguments: { action: 'open', url: 'http://localhost/' } });
  host.cancel('cancelled');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 0);
  assert.ok(JSON.stringify(completed).includes('BROWSER_CANCELLED'));
});

test('scroll argument failures explain the missing ref instead of restarting inspection', async () => {
  const completed: Record<string, unknown>[] = [];
  const host = new AgentBrowserHost(() => { throw new Error('must not dispatch'); }, async (_method, params) => { completed.push(params as Record<string, unknown>); }, () => {});
  host.handle({ request_id: 'scroll-shape', run_id: 'run', conversation_id: 'conv', tool_call_id: 't', name: 'browser', arguments: { action: 'scroll', snapshot_id: 'fresh', value: 'down' } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(completed[0]);
  const result = completed[0].result as Record<string, unknown>;
  assert.equal(result.error_code, 'BROWSER_INVALID_ARGUMENTS');
  assert.equal(result.input_state, 'NOT_DISPATCHED');
  assert.match(String(result.guidance), /observed ref/);
  assert.match(String(result.guidance), /scrollIntoView/);
});


test('restarted host can inspect an existing local server without owning or stopping it', async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const replies = new Map<string, (value: Record<string, unknown>) => void>();
  const workspace = { startAgentServer: () => { throw new Error('must not start'); }, stopAgentServer: () => { throw new Error('must not stop external process'); } };
  const host = new AgentBrowserHost(() => { throw new Error('no page interaction'); }, async (_, params) => {
    const response = params as { request_id: string; result: Record<string, unknown> };
    replies.get(response.request_id)!(response.result);
  }, () => {}, () => workspace as unknown as import('./workspace-runtime').WorkspaceRuntime);
  const call = (id: string, args: Record<string, unknown>) => new Promise<Record<string, unknown>>(resolve => {
    replies.set(id, resolve); host.handle({ request_id: id, run_id:'restored', conversation_id:'conversation', tool_call_id:id,
      name:'browser_server', arguments:args, project_root:'test', field_id:'test' });
  });
  try {
    const missing = await call('untracked', {action:'status'});
    assert.equal(missing.error_code, 'BROWSER_SERVER_NOT_TRACKED');
    const url = `http://127.0.0.1:${address.port}`;
    const status = await call('probe', {action:'status',url});
    assert.equal(status.readiness, 'LISTENING'); assert.equal(status.process_tracking,'NOT_MANAGED');
    assert.equal(status.verification_eligible,false);
    await call('stop', {action:'stop'});
    assert.equal((await call('still-listening', {action:'status',url})).readiness,'LISTENING');
    host.reset(); assert.equal(server.listening,true);
    assert.equal((await call('external', {action:'status',url:'http://example.com'})).error_code,'BROWSER_SERVER_URL_REJECTED');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('browser dispatch receipts cross the host unchanged and never become verified results', async () => {
  for (const receipt of [
    {success:false,error_code:'BROWSER_ELEMENT_COVERED',input_state:'NOT_DISPATCHED',outcome_unknown:false},
    {success:false,error_code:'BROWSER_OPERATION_FAILED',input_state:'DISPATCHING',outcome_unknown:true},
    {success:false,error_code:'BROWSER_PAGE_NOT_READY',input_state:'DISPATCHED',outcome_unknown:false,observation_required:true},
  ]) {
    let complete!: (value: Record<string, unknown>) => void;
    const finished = new Promise<Record<string, unknown>>(resolve => { complete=resolve; });
    const runtime = { executeAgent:async()=>receipt } as unknown as BrowserRuntime;
    const host=new AgentBrowserHost(()=>runtime,async(_,params)=>{complete((params as {result:Record<string,unknown>}).result);},()=>{});
    host.handle({request_id:'click',run_id:'run',conversation_id:'conversation',tool_call_id:'tool',name:'browser',arguments:{action:'click',ref:'e1',snapshot_id:'observed'}});
    const result=await finished;
    for (const [key,value] of Object.entries(receipt)) assert.equal(result[key],value);
    assert.equal(result.verification_eligible,undefined);
  }
});

test('inspect requests the owned browser surface and preserves readiness and truncation facts', async () => {
  const revealed: string[] = [];
  const receipt = { success: true, page_loaded: true, interaction_ready: false, verification_eligible: false,
    readiness: { document_committed: true, surface_ready: false }, text_truncated: true, partial: true };
  let complete!: (value: Record<string, unknown>) => void;
  const finished = new Promise<Record<string, unknown>>(resolve => { complete = resolve; });
  const runtime = { executeAgent: async () => receipt } as unknown as BrowserRuntime;
  const host = new AgentBrowserHost(() => runtime, async (_, params) => {
    complete((params as { result: Record<string, unknown> }).result);
  }, (run, conversation) => { revealed.push(run, conversation); });
  host.handle({ request_id: 'inspect', run_id: 'owned-run', conversation_id: 'owned-conversation', tool_call_id: 'tool', name: 'browser', arguments: { action: 'inspect' } });
  const result = await finished;
  assert.deepEqual(revealed, ['owned-run', 'owned-conversation']);
  for (const [key, value] of Object.entries(receipt)) assert.deepEqual(result[key], value);
});

test('POSIX server arguments survive the real shell without interpolation', { skip: process.platform === 'win32' }, async () => {
  const { execFileSync } = await import('node:child_process');
  const args = ["test'file.js", '$(secret); `echo x`', 'two words', ''];
  const command = browserServerCommand({ program: 'node', argv: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...args] }, 'darwin');
  const output = execFileSync('/bin/zsh', ['-c', command], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), args);
});
