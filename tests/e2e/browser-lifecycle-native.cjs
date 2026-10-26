// Run with Electron; real native menu, BrowserRuntime and WebContents lifetime.
const { app, BrowserWindow, Menu, webContents } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { BrowserRuntime } = require(path.join(root, 'apps/desktop/src/browser-runtime.ts'));
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fielora-browser-lifecycle-'));
app.setPath('userData', profile);
const evidence = path.resolve(process.env.FIELORA_E2E_EVIDENCE_DIR || path.join(root, 'artifacts/browser-lifecycle'));
const wait = async (predicate, label) => {
  const started = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - started < 5000, label);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
app.whenReady().then(async () => {
  let host, runtime, server;
  const result = {};
  const originalPopup = Menu.prototype.popup;
  try {
    server = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Lifecycle fixture</title><p>Loaded native page</p>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/page`;
    host = new BrowserWindow({ width: 1000, height: 750, webPreferences: { sandbox: true } });
    await host.loadURL('data:text/html,<h1>Isolated native lifecycle regression</h1>');
    runtime = new BrowserRuntime(host, () => {});
    runtime.show({ x: 40, y: 60, width: 850, height: 600 });
    await runtime.navigate(url);
    await wait(() => webContents.getAllWebContents().some(contents => contents.getURL() === url), 'Page must really load');
    const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url);
    const contentsId = contents.id;
    const pageId = runtime.getState().active_page_id;
    let menuShown = false, menuClosed = false, destroyed = false;
    // Observe native events without replacing menu display or cancellation.
    Menu.prototype.popup = function(options) {
      this.once('menu-will-show', () => { menuShown = true; });
      this.once('menu-will-close', () => { menuClosed = true; });
      return originalPopup.call(this, options);
    };
    contents.once('destroyed', () => { destroyed = true; });
    runtime.showPageContextMenu(pageId);
    await wait(() => menuShown, 'Native menu must actually open before closing its page');
    runtime.closePage(pageId);
    assert.equal(runtime.getState().pages.length, 0);
    await wait(() => menuClosed && destroyed, 'Closing a page must end native menu tracking and destroy its WebContents');
    assert.equal(webContents.getAllWebContents().some(candidate => candidate.id === contentsId), false);
    assert.equal(runtime.getState().surface.visible, false);
    result.status = 'PASS';
    result.native_menu_shown = menuShown;
    result.native_menu_closed = menuClosed;
    result.web_contents_destroyed = destroyed;
    result.zero_pages = true;
  } catch (error) { result.status = 'FAIL'; result.error = String(error.stack); }
  finally {
    Menu.prototype.popup = originalPopup;
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'native-lifecycle.json'), JSON.stringify(result, null, 2));
    runtime?.destroy(); server?.closeAllConnections(); server?.close(); host?.destroy();
    console.log(JSON.stringify(result));
    app.exit(result.status === 'PASS' ? 0 : 1);
  }
});
