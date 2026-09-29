// Run with Electron. Exercises the real BrowserRuntime without a model/provider
// or a production profile; no mocked WebContents or weakened security settings.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '../..'), ts = require(path.join(root, 'node_modules/typescript'));
require.extensions['.ts'] = (m, p) => m._compile(ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, p);
const { BrowserRuntime } = require(path.join(root, 'apps/desktop/src/browser-runtime.ts'));
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR || path.join(root, 'artifacts/agent-browser-readiness-20260924/native'));
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fielora-readiness-test-')));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.whenReady().then(async () => {
  let runtime, win, server;
  const results = {};
  const timers = new Set();
  try {
    server = http.createServer((req, res) => {
      if (req.url === '/hang') return;
      if (req.url === '/long') {
        res.setHeader('Content-Type', 'text/plain');
        res.end('A'.repeat(25000) + 'TAIL_MUST_NOT_BE_ASSUMED_ABSENT');
      } else if (req.url === '/delayed') {
        const timer = setTimeout(() => { timers.delete(timer); res.end('<body>delayed-ready</body>'); }, 14000);
        timers.add(timer);
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><body><h1>readiness-visible-text</h1><button onclick="this.textContent=\'clicked-once\'">Click</button></body>');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ width: 1100, height: 750, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<h1>Isolated browser readiness regression</h1>');
    runtime = new BrowserRuntime(win, () => {});
    const call = (args, signal = AbortSignal.timeout(24000)) => runtime.executeAgent('readiness', args, signal);
    const bounds = { x: 200, y: 80, width: 800, height: 560 };
    // Reproduce the production-shaped symptom: committed document, hidden panel.
    let page = await call({ action: 'open', url: base });
    assert.equal(page.success, true); assert.match(page.text, /readiness-visible-text/);
    assert.equal(page.readiness.surface_ready, false); assert.equal(page.readiness.document_committed, true);
    assert.equal(page.interaction_ready, false); assert.equal(page.verification_eligible, false);
    results.hidden_document = page;
    // Hidden DOM observation does not authorize native input.
    const hiddenClick = await call({ action: 'click', ref: 'e1', snapshot_id: page.snapshot_id });
    assert.equal(hiddenClick.success, false); assert.equal(hiddenClick.error_code, 'BROWSER_SURFACE_NOT_READY');
    assert.equal(hiddenClick.input_state, 'NOT_DISPATCHED'); assert.equal(hiddenClick.outcome_unknown, false);
    assert.equal(hiddenClick.readiness.surface_ready, false); results.hidden_click = hiddenClick;
    runtime.show(bounds);
    page = await call({ action: 'inspect' });
    assert.equal(page.interaction_ready, true);
    const clicked = await call({ action: 'click', ref: page.elements.find(e => e.text === 'Click').ref, snapshot_id: page.snapshot_id });
    assert.equal(clicked.success, true); assert.match(clicked.text, /clicked-once/);
    results.recovered_input = clicked;
    // A short DOM tree with long text used to claim partial=false at 24k chars.
    page = await call({ action: 'open', url: base + '/long' });
    assert.equal(page.success, true); assert.equal(page.text.length, 24000);
    assert.equal(page.text_truncated, true); assert.equal(page.partial, true);
    assert.ok(page.text_total_chars > page.text_returned_chars);
    const absent = await call({ action: 'verify', snapshot_id: page.snapshot_id, checks: [{ property: 'absent', expected: 'TAIL_MUST_NOT_BE_ASSUMED_ABSENT' }] });
    assert.equal(absent.success, false); assert.equal(absent.checks[0].actual, 'UNKNOWN_TRUNCATED_OBSERVATION');
    results.long_text = { ...page, text: '[bounded excerpt omitted]' }; results.absence_check = { ...absent, text: '[bounded excerpt omitted]' };
    // A slow navigation returns bounded loading facts and can subsequently recover.
    const started = Date.now();
    const loading = await call({ action: 'open', url: base + '/delayed' });
    assert.equal(loading.error_code, 'BROWSER_DOCUMENT_LOADING');
    assert.ok(Date.now() - started < 18000); assert.equal(loading.readiness.document_loading, true);
    const loaded = await call({ action: 'inspect' });
    assert.equal(loaded.success, true); assert.match(loaded.text, /delayed-ready/);
    results.loading = loading; results.loading_recovered = loaded.success;
    // Cancellation is acknowledged even while loadURL is still awaiting headers.
    const cancelStarted = Date.now();
    const cancelled = await call({ action: 'open', url: base + '/hang' }, AbortSignal.timeout(700));
    assert.equal(cancelled.error_code, 'BROWSER_CANCELLED'); assert.ok(Date.now() - cancelStarted < 4000);
    results.cancelled = cancelled;
    // A network failure remains a network failure when the panel is hidden.
    const unused = http.createServer(); await new Promise(resolve => unused.listen(0, '127.0.0.1', resolve));
    const bad = `http://127.0.0.1:${unused.address().port}`; await new Promise(resolve => unused.close(resolve));
    runtime.hide();
    const failed = await call({ action: 'open', url: bad });
    assert.equal(failed.error_code, 'BROWSER_NAVIGATION_FAILED'); assert.equal(failed.network_error, 'ERR_CONNECTION_REFUSED');
    assert.equal(failed.page_loaded, false); results.network_failure = failed;
    // Never borrow a different run/user page to satisfy a stale observation.
    runtime.createPage();
    const inactive = await call({ action: 'inspect' });
    assert.equal(inactive.error_code, 'BROWSER_PAGE_NOT_ACTIVE'); assert.equal(inactive.readiness.active, false);
    results.inactive = inactive;
    results.status = 'PASS';
  } catch (error) { results.status = 'FAIL'; results.error = String(error.stack); process.exitCode = 1; }
  finally {
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(results, null, 2));
    for (const timer of timers) clearTimeout(timer);
    runtime?.destroy(); server?.closeAllConnections(); server?.close(); win?.destroy(); app.exit(results.status === 'PASS' ? 0 : 1);
  }
});
