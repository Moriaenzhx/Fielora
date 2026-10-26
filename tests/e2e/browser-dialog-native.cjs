// Real Chromium input, native JavaScript dialogs, and the production Host.
const { app, BrowserWindow, webContents } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { BrowserRuntime } = require(path.join(root, 'apps/desktop/src/browser-runtime.ts'));
const { AgentBrowserHost } = require(path.join(root, 'apps/desktop/src/agent-browser-host.ts'));
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fielora-browser-dialog-'));
app.setPath('userData', profile);
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR || path.join(root, 'artifacts/browser-dialog-recovery-20261023/native'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (predicate, label, timeout = 10000) => {
  const start = Date.now(); while (!predicate()) { assert.ok(Date.now() - start < timeout, label); await delay(20); }
};
app.whenReady().then(async () => {
  let window, runtime, server, host; const results = { events: [] }; let serial = 0;
  try {
    server = http.createServer((_req, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><meta charset="utf-8"><title>Isolated dialog recovery</title>
        <style>button{width:240px;height:80px;margin:20px}body{font:18px system-ui}</style>
        <button onclick="clicks++;output.textContent=confirm('Synthetic reset confirmation')?'accepted':'cancelled'">Confirm</button>
        <button onclick="clicks++;alert('Synthetic alert');output.textContent='alert closed'">Alert</button>
        <button onmousedown="downs++;confirm('Synthetic partial input')" onclick="clicks++">Partial</button>
        <output id="output">initial</output><script>let clicks=0,downs=0;</script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    window = new BrowserWindow({ width: 1100, height: 800, webPreferences: { sandbox: true } });
    await window.loadURL('data:text/html,<h1>Native dialog recovery regression</h1>');
    runtime = new BrowserRuntime(window, () => {}); runtime.show({ x: 30, y: 60, width: 1000, height: 650 });
    host = new AgentBrowserHost(() => runtime, async (method, params) => {
      results.events.push({ method, ...params, at: Date.now() }); return { accepted: true };
    }, () => {});
    const start = arguments_ => {
      const id = `request-${++serial}`;
      host.handle({ request_id: id, run_id: 'native-dialog', conversation_id: 'isolated', tool_call_id: `tool-${serial}`, name: 'browser', arguments: arguments_ });
      return id;
    };
    const completed = id => results.events.filter(e => e.request_id === id && e.method === 'host.browser.complete');
    const done = async id => { await wait(() => completed(id).length, `completion ${id}`, 40000); return completed(id)[0].result; };
    let observation = await done(start({ action: 'open', url })); assert.equal(observation.success, true);
    const wc = webContents.getAllWebContents().find(c => c.getURL() === url); assert.ok(wc);
    const nativeDialogs = [];
    wc.debugger.on('message', (_e, method, p) => { if (method === 'Page.javascriptDialogOpening') nativeDialogs.push({ type: p.type, native: p.hasBrowserHandler }); });
    const click = text => {
      const ref = observation.elements.find(e => e.text === text)?.ref; assert.ok(ref, text);
      return start({ action: 'click', snapshot_id: observation.snapshot_id, ref });
    };
    const opened = id => wait(() => results.events.some(e => e.request_id === id && e.state === 'OPEN'), `native dialog ${id}`);
    const read = expression => wc.executeJavaScript(expression);
    const inspect = async () => { observation = await done(start({ action: 'inspect' })); assert.equal(observation.success, true); };

    const long = click('Confirm'); await opened(long); await delay(31500);
    assert.equal(completed(long).length, 0, 'A native dialog wait must outlive both old 25s and 30s deadlines');
    await wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false });
    const longResult = await done(long); assert.equal(longResult.input_state, 'DISPATCHED'); assert.equal(longResult.outcome_unknown, false);
    assert.deepEqual(await read('[clicks,output.textContent]'), [1, 'cancelled']); results.longWait = true;
    await inspect(); const accepted = click('Confirm'); await opened(accepted);
    await wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }); await done(accepted);
    assert.deepEqual(await read('[clicks,output.textContent]'), [2, 'accepted']); results.accept = true;
    await inspect(); const alert = click('Alert'); await opened(alert);
    await wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }); await done(alert);
    assert.deepEqual(await read('[clicks,output.textContent]'), [3, 'alert closed']); results.alert = true;

    await inspect(); const stopped = click('Confirm'); await opened(stopped); host.cancel(stopped);
    const unknown = await done(stopped); assert.equal(unknown.input_state, 'DISPATCHING'); assert.equal(unknown.outcome_unknown, true);
    const overlap = await done(start({ action: 'inspect' })); assert.equal(overlap.error_code, 'BROWSER_INPUT_PENDING');
    await wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false });
    await wait(() => completed(stopped).some(e => e.final === true), 'late acknowledgement');
    const late = completed(stopped).find(e => e.final === true).result;
    assert.equal(late.input_state, 'DISPATCHED'); assert.equal(late.success, false); assert.equal(late.verification_eligible, false);
    assert.deepEqual(await read('[clicks,output.textContent]'), [4, 'cancelled']); results.stopLate = true;

    await inspect(); const partial = click('Partial'); await opened(partial); host.cancel(partial); await done(partial);
    await wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false });
    await wait(() => completed(partial).some(e => e.final === true), 'partial final outcome');
    const partialResult = completed(partial).find(e => e.final).result;
    assert.equal(partialResult.input_state, 'DISPATCHING'); assert.equal(partialResult.outcome_unknown, true);
    assert.deepEqual(await read('[clicks,downs]'), [4, 1], 'No mouseUp/second click may be dispatched after cancellation'); results.partialUnknown = true;
    assert.equal(nativeDialogs.length, 5); assert.ok(nativeDialogs.every(d => d.native === true));
    results.nativeDialogs = nativeDialogs; results.status = 'PASS';
  } catch (error) { results.status = 'FAIL'; results.error = String(error.stack); }
  finally {
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(results, null, 2));
    host?.reset(); runtime?.destroy(); server?.closeAllConnections(); server?.close(); window?.destroy();
    console.log(JSON.stringify({ ...results, events: `${results.events.length} events in result.json` }));
    app.exit(results.status === 'PASS' ? 0 : 1);
  }
});
setTimeout(() => { console.error('Native dialog test watchdog'); app.exit(1); }, 90000);
