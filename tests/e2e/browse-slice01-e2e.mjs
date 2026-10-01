import { packagedApplication, launchDesktop, killTestProcess, deleteTestCredential } from '../support/platform.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
const mode = process.argv[2] ?? 'dev';
assert.ok(['dev', 'packaged', 'portable'].includes(mode), `Unsupported Browse E2E mode: ${mode}`);
const packaged = mode === 'packaged' || mode === 'portable';
const appPath = process.env.FIELORA_PACKAGED_APP ?? packagedApplication(root);
const localAppData = await mkdtemp(path.join(tmpdir(), `fielora-browse-${mode}-e2e-`));
const evidenceDir = process.env.FIELORA_E2E_EVIDENCE_DIR ?? path.join(root, 'artifacts', 'phase03');
await mkdir(evidenceDir, { recursive: true });
const webpackOutput = path.join(root, 'apps', 'desktop', '.webpack');
assert.equal(path.relative(root, webpackOutput), path.join('apps', 'desktop', '.webpack'), 'fresh-build cleanup must remain scoped to the desktop Webpack output');
if (!packaged) await rm(webpackOutput, { recursive: true, force: true });

const localFixturePath = path.join(localAppData, 'local-page.html');
const localChildPath = path.join(localAppData, 'local-child.html');
const localFixtureUrl = pathToFileURL(localFixturePath).toString();
const localChildUrl = pathToFileURL(localChildPath).toString();
const targetTimeoutMs = Number(process.env.FIELORA_E2E_TARGET_TIMEOUT_MS ?? 120000);
let debuggingPort;
let launched;
const output = [];
const checkpoints = [];
let remoteFileOpenerRequests = 0;
let remoteFileOpenerExecutions = 0;
const fixtureFavicon = await readFile(path.join(root, 'artifacts', 'phase03', 'slice05-narrow-runtime.png'));

class Cdp {
  constructor(url) { this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); }
  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out\n${output.join('')}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (reason) => { clearTimeout(timeout); reject(reason); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

const fixtureServer = createServer((request, response) => {
  const route = request.url?.split('?')[0] ?? '/';
  if (route === '/first') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><head><title>Fielora Fixture One</title><link rel="icon" type="image/png" href="/favicon.png"><style>
      body{margin:24px;font:16px system-ui;background:#fff;color:#17213b}button,input,a{font:inherit}label{display:block;margin:18px 0}.spacer{height:1800px;background:linear-gradient(#fff,#dfe8ff)}
    </style></head><body>
      <h1 id="fixture-one">真实页面一</h1>
      <button id="interaction-button" type="button">实际点击</button><output id="interaction-result">idle</output>
      <label>实际输入 <input id="fixture-input" /></label>
      <p id="clipboard-source">Fielora Chromium clipboard</p>
      <label>粘贴验证 <input id="clipboard-target" /></label>
      <a id="context-link" href="/second">右键菜单链接</a>
      <a id="normal-link" href="/normal">普通链接</a>
      <a id="blank-link" href="/blank" target="_blank">新窗口链接</a>
      <button id="script-open" type="button">脚本打开</button>
      <a id="next-link" href="/second">打开第二页</a><div class="spacer"></div><p id="page-end">页面底部</p>
      <script>
        sessionStorage.firstLoads=String(Number(sessionStorage.firstLoads||0)+1);document.documentElement.dataset.loads=sessionStorage.firstLoads;
        document.querySelector('#interaction-button').addEventListener('click',()=>document.querySelector('#interaction-result').textContent='clicked');
        document.querySelector('#script-open').addEventListener('click',()=>window.open('/script-open'));
      </script>
    </body></html>`);
    return;
  }
  if (['/normal', '/blank', '/script-open'].includes(route)) {
    const marker = route.slice(1);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><head><title>Fielora ${marker}</title></head><body><h1 id="${marker}">${marker}</h1></body></html>`);
    return;
  }
  if (route === '/second') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fielora Fixture Two</title><link rel="icon" type="image/png" href="/favicon.png"><style>
      body{margin:24px;font:16px system-ui}.viewport-probe{display:grid;grid-template-columns:1fr 1fr;gap:12px}.viewport-probe span{padding:18px;background:#eef2ff}@media(max-width:800px){.viewport-probe{grid-template-columns:1fr}.viewport-probe{outline:4px solid #7550c5}}
    </style></head><body>
      <h1 id="fixture-two">真实页面二</h1><div class="viewport-probe"><span>viewport A</span><span>viewport B</span></div>
      <script>sessionStorage.secondLoads=String(Number(sessionStorage.secondLoads||0)+1);document.documentElement.dataset.loads=sessionStorage.secondLoads;</script>
    </body></html>`);
    return;
  }
  if (route === '/slow') {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(`<!doctype html><html><head><title>Fielora Slow Fixture</title><link rel="icon" type="image/png" href="/favicon.png"></head><body><h1 id="slow-page">Delayed Chromium page</h1><script>sessionStorage.slowLoads=String(Number(sessionStorage.slowLoads||0)+1);document.documentElement.dataset.loads=sessionStorage.slowLoads</script></body></html>`);
    }, 700);
    return;
  }
  if (route === '/favicon.png') {
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': fixtureFavicon.length, 'cache-control': 'no-store' });
    response.end(fixtureFavicon);
    return;
  }
  if (route === '/login') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><head><title>Fielora Login Fixture</title><style>
      body{margin:32px;font:16px system-ui;color:#17213b}form{display:grid;gap:12px;max-width:360px}input,button{font:inherit;padding:10px}.long-login-page{height:1400px;background:linear-gradient(#fff,#eef2ff)}
    </style></head><body>
      <h1 id="login-title">Sign in fixture</h1><p id="login-app-status">booting</p>
      <form id="login-form" method="post" action="/session-login">
        <label>Account <input id="login-account" name="account" autocomplete="username"></label>
        <label>Password <input id="login-password" name="password" type="password" autocomplete="current-password"></label>
        <button id="login-submit" type="submit" disabled>Sign in</button>
      </form><div class="long-login-page"></div><p id="login-page-end">End of login page</p>
      <script>setTimeout(()=>{document.documentElement.dataset.hydrated='true';document.querySelector('#login-app-status').textContent='ready';document.querySelector('#login-submit').disabled=false},40)</script>
    </body></html>`);
    return;
  }
  if (route === '/session-login' && request.method === 'POST') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const form = new URLSearchParams(body);
      if (form.get('account') !== 'desktop-user' || form.get('password') !== 'slice05-pass') {
        response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Invalid fixture credentials');
        return;
      }
      response.writeHead(303, {
        location: '/account',
        'set-cookie': 'fielora_slice05_session=active; Path=/; HttpOnly; SameSite=Lax',
        'cache-control': 'no-store',
      });
      response.end();
    });
    return;
  }
  if (route === '/account' || route === '/session-check') {
    const authenticated = request.headers.cookie?.includes('fielora_slice05_session=active') ?? false;
    response.writeHead(authenticated ? 200 : 401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><head><title>${authenticated ? 'Fielora Authenticated Fixture' : 'Fielora Session Missing'}</title></head><body>
      <h1 id="${authenticated ? 'session-active' : 'session-missing'}">${authenticated ? 'Authenticated session' : 'Session missing'}</h1>
      ${route === '/account' ? '<a id="session-window" href="/session-check" target="_blank">Verify session in another Page</a>' : ''}
      <script>sessionStorage.accountLoads=String(Number(sessionStorage.accountLoads||0)+1);document.documentElement.dataset.loads=sessionStorage.accountLoads</script>
    </body></html>`);
    return;
  }
  if (route === '/remote-file-opener') {
    remoteFileOpenerRequests += 1;
    const target = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('target') ?? '';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Remote opener</title></head><body><h1>Remote opener</h1><script>fetch('/remote-file-opener-executed');window.open(${JSON.stringify(target)})</script></body></html>`);
    return;
  }
  if (route === '/remote-file-opener-executed') {
    remoteFileOpenerExecutions += 1;
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

await new Promise((resolve, reject) => {
  fixtureServer.once('error', reject);
  fixtureServer.listen(0, '127.0.0.1', resolve);
});
const fixtureAddress = fixtureServer.address();
if (!fixtureAddress || typeof fixtureAddress === 'string') throw new Error('Fixture server did not expose a TCP port');
const firstUrl = `http://127.0.0.1:${fixtureAddress.port}/first`;
const secondUrl = `http://127.0.0.1:${fixtureAddress.port}/second`;
const normalUrl = `http://127.0.0.1:${fixtureAddress.port}/normal`;
const blankUrl = `http://127.0.0.1:${fixtureAddress.port}/blank`;
const scriptOpenUrl = `http://127.0.0.1:${fixtureAddress.port}/script-open`;
const loginUrl = `http://127.0.0.1:${fixtureAddress.port}/login`;
const accountUrl = `http://127.0.0.1:${fixtureAddress.port}/account`;
const sessionCheckUrl = `http://127.0.0.1:${fixtureAddress.port}/session-check`;
const slowUrl = `http://127.0.0.1:${fixtureAddress.port}/slow`;
const remoteFileOpenerUrl = `http://127.0.0.1:${fixtureAddress.port}/remote-file-opener?target=${encodeURIComponent(localFixtureUrl)}`;

await writeFile(localFixturePath, `<!doctype html><html><head><meta charset="utf-8"><title>Fielora Local Fixture</title></head><body>
  <h1 id="local-fixture">Isolated Local Page</h1>
  <button id="local-button" type="button">Interact</button><output id="local-output">idle</output>
  <label>Local input <input id="local-input"></label>
  <a id="local-link" href="./local-child.html">Open local child</a>
  <iframe id="remote-opener" referrerpolicy="no-referrer" src=${JSON.stringify(remoteFileOpenerUrl)}></iframe>
  <script>document.querySelector('#local-button').addEventListener('click',()=>document.querySelector('#local-output').textContent='clicked')</script>
</body></html>`, 'utf8');
await writeFile(localChildPath, '<!doctype html><html><head><meta charset="utf-8"><title>Fielora Local Child</title></head><body><h1 id="local-child">Local child</h1></body></html>', 'utf8');

async function availableDebuggingPort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function launch() {
  debuggingPort = await availableDebuggingPort();
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    APPDATA: localAppData,
    FIELORA_E2E: '1',
    FIELORA_E2E_DEBUG_PORT: String(debuggingPort),
    ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  };
  const child = launchDesktop(root, appPath, packaged, env);
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  return child;
}

async function targets() {
  return (await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json());
}

async function waitForTarget(predicate, timeoutMs = targetTimeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const target = (await targets()).find(predicate);
      if (target) return target;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Electron target did not appear.\n${output.join('')}`);
}

async function assertBrowsePageTargets(appTargetId, expectedUrls) {
  // Native WebContents destruction completes after the product page is removed.
  // Require the same exact target set, allowing that asynchronous close to settle.
  let pageTargets = [];
  const deadline = Date.now() + 3000;
  do {
    pageTargets = (await targets()).filter((item) => item.type === 'page' && item.id !== appTargetId);
    if (JSON.stringify(pageTargets.map(item => item.url).sort()) === JSON.stringify([...expectedUrls].sort())) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.equal(pageTargets.length, expectedUrls.length, `each loaded Browse Page must own exactly one WebContents target: ${JSON.stringify(pageTargets.map(({id,url,title})=>({id,url,title})))}`);
  assert.deepEqual(pageTargets.map((item) => item.url).sort(), [...expectedUrls].sort());
}

async function connect(target) {
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return cdp;
}

async function waitExpression(cdp, expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await cdp.evaluate(`(async()=>Boolean(await (${expression})))()`)) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out waiting for ${expression}\n${output.join('')}`);
}

function click(selector) {
  return `(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.click();return true;})()`;
}

function checkpoint(name) {
  checkpoints.push(name);
  console.log(`BROWSE_E2E_CHECKPOINT ${name}`);
}

async function interactWithPageElement(cdp, selector) {
  assert.equal(await cdp.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.click();return true;})()`), true, `Page element ${selector} must exist and be clickable`);
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode, modifiers = 0) {
  const common = { key, code, windowsVirtualKeyCode, ...(process.platform === 'win32' ? { nativeVirtualKeyCode: windowsVirtualKeyCode } : {}), modifiers };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

async function pressCtrlShortcut(cdp, key, code, windowsVirtualKeyCode) {
  const modifier = process.platform === 'darwin' ? 4 : 2;
  if (process.platform === 'darwin') {
    // CDP bypasses Cocoa's key binding translation; pass the native editing
    // command alongside the key event (Input.dispatchKeyEvent.commands).
    const editing = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' }[key];
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode, modifiers: modifier, commands: editing ? [editing] : [] });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers: modifier });
  } else await pressKey(cdp, key, code, windowsVirtualKeyCode, modifier);
}

async function dragDivider(cdp, testId, delta) {
  const rect = await cdp.evaluate(`(()=>{const value=document.querySelector('[data-testid=${JSON.stringify(testId)}]')?.getBoundingClientRect();return value?{x:value.x,y:value.y,width:value.width,height:value.height}:null;})()`);
  assert.ok(rect, `${testId} must exist before dragging`);
  const x = rect.x + rect.width / 2;
  const y = rect.y + Math.min(120, rect.height / 2);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + delta, y, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + delta, y, button: 'left', clickCount: 1 });
}

async function surfaceSnapshot(cdp) {
  await waitExpression(cdp, `(()=>{const host=document.querySelector('[data-testid="browse-viewport"]');const panel=host?.closest('.utility-launcher, .project-layout');return host&&!panel?.getAnimations({subtree:true}).some(animation=>animation.playState==='running')})()`);
  await waitExpression(cdp, `window.fielora.browser.getState().then(state=>{const rect=document.querySelector('[data-testid="browse-viewport"]')?.getBoundingClientRect();return rect&&['x','y','width','height'].every(key=>Math.abs(state.surface.bounds[key]-Math.round(rect[key]))<=1)})`);
  return cdp.evaluate(`(async()=>{const state=await window.fielora.browser.getState();const rect=document.querySelector('[data-testid="browse-viewport"]')?.getBoundingClientRect();const utility=document.querySelector('[data-testid="utility-launcher"]')?.getBoundingClientRect();const rail=document.querySelector('[data-testid="utility-rail"]')?.getBoundingClientRect();return{state,rect:rect?{x:Math.round(rect.left),y:Math.round(rect.top),width:Math.round(rect.width),height:Math.round(rect.height)}:null,utility:utility?{x:Math.round(utility.left),width:Math.round(utility.width),right:Math.round(utility.right)}:null,rail:rail?{x:Math.round(rail.left),width:Math.round(rail.width),right:Math.round(rail.right)}:null,window:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};})()`);
}

function assertVisibleSurface(snapshot) {
  assert.equal(snapshot.state.surface.app_view, 'BROWSE');
  assert.equal(snapshot.state.surface.attached, true);
  assert.equal(snapshot.state.surface.visible, true);
  assert.ok(snapshot.state.surface.bounds.width > 340, 'right-sidebar WebContentsView width must remain visibly usable');
  assert.ok(snapshot.state.surface.bounds.height > 300, 'WebContentsView height must be visibly usable');
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(snapshot.state.surface.bounds[key] - snapshot.rect[key]) <= 1, `native ${key} must match the React Browse viewport within one DPI rounding pixel (native=${snapshot.state.surface.bounds[key]}, react=${snapshot.rect[key]})`);
  }
  assert.ok(snapshot.utility && snapshot.rail && snapshot.rect.x >= snapshot.utility.x && snapshot.rect.x + snapshot.rect.width <= snapshot.utility.right + 1, 'Browse view must stay inside the right utility sidebar');
  assert.ok(snapshot.rail.x >= snapshot.utility.x && snapshot.rail.right <= snapshot.utility.right, 'Utility controls must move inside the right sidebar header');
  assert.ok(snapshot.rect.x >= 100 && snapshot.rect.y >= 64, 'Browse view must not cover primary navigation or browser toolbar');
  assert.ok(snapshot.rect.x + snapshot.rect.width <= snapshot.window.width + 1, `Browse viewport must stay inside the trusted window: ${JSON.stringify(snapshot)}`);
  assert.ok(snapshot.rect.y + snapshot.rect.height <= snapshot.window.height);
}

async function waitExit(child, timeoutMs = 30000) {
  if (child.exitCode !== null) return child.exitCode;
  return Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Electron did not exit')), timeoutMs)),
  ]);
}

async function fieldRealitySnapshot(cdp, fieldId) {
  return cdp.evaluate(`(async()=>{
    const fieldId=${JSON.stringify(fieldId)};
    const [fields,field,resume,states,activeReferences,archivedReferences,activeRelations,retractedRelations,activities]=await Promise.all([
      window.fielora.field.list(),
      window.fielora.field.get({field_id:fieldId}),
      window.fielora.field.resumeV1({field_id:fieldId}),
      window.fielora.state.list({field_id:fieldId,kind:null,status:null,cursor:null,limit:100}),
      window.fielora.reference.list({field_id:fieldId,lifecycle:'ACTIVE',cursor:null,limit:100}),
      window.fielora.reference.list({field_id:fieldId,lifecycle:'ARCHIVED',cursor:null,limit:100}),
      window.fielora.relation.list({field_id:fieldId,relation_type:null,lifecycle:'ACTIVE',endpoint:null,cursor:null,limit:100}),
      window.fielora.relation.list({field_id:fieldId,relation_type:null,lifecycle:'RETRACTED',endpoint:null,cursor:null,limit:100}),
      window.fielora.activity.list({field_id:fieldId,cursor:null,limit:100}),
    ]);
    return{fields,field,resume,states:states.items,activeReferences:activeReferences.items,archivedReferences:archivedReferences.items,activeRelations:activeRelations.items,retractedRelations:retractedRelations.items,activities:activities.items};
  })()`);
}

async function browseIdentitySnapshot(cdp) {
  return cdp.evaluate(`window.fielora.browser.getState().then(state=>({active_page_id:state.active_page_id,pages:state.pages.map(page=>({id:page.id,url:page.url,title:page.title}))}))`);
}

let appCdp;
let webCdp;
let localCdp;
try {
  checkpoint(packaged ? `${mode}-runtime-selected` : 'fresh-build-output-cleared');
  launched = await launch();
  const appTarget = await waitForTarget((item) => item.type === 'page' && (item.url.includes('main_window') || item.url.startsWith('fielora://app')));
  appCdp = await connect(appTarget);
  await waitExpression(appCdp, `document.querySelector('[data-testid="project-workspace"]')`);
  await appCdp.evaluate(click('[data-testid="now-nav"]'));
  await waitExpression(appCdp, `document.querySelector('[data-testid="scheduled-tasks-screen"]')`);
  const trustedOrigin = await appCdp.evaluate('location.origin');
  if (packaged) assert.equal(trustedOrigin, 'fielora://app');
  else {
    const parsedOrigin = new URL(trustedOrigin);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname));
    assert.ok(parsedOrigin.port);
  }
  assert.doesNotMatch(output.join(''), /Cannot find module ['"]\.\/browser-errors\.js['"]/);
  checkpoint('fresh-electron-launch');
  checkpoint('trusted-app-ready');

  const field = await appCdp.evaluate(`window.fielora.field.create({title:'Browse Boundary Field',goal:'Must remain unchanged by loose Browse'})`);
  assert.ok(field?.id, 'the boundary fixture must create a real durable Field');
  checkpoint('field-create');
  const realityBefore = await fieldRealitySnapshot(appCdp, field.id);
  const fieldBefore = realityBefore.field;

  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:open-utility',{detail:'BROWSER'}))`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browse-screen"]')`);
  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(firstUrl)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browser-address"]')?.value===${JSON.stringify(firstUrl)}`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.surface.attached&&state.surface.visible&&state.surface.bounds.width>340&&state.surface.bounds.height>300)`);
  const initialSurface = await surfaceSnapshot(appCdp);
  assertVisibleSurface(initialSurface);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages[0]?.favicon_data_url?.startsWith('data:image/png;base64,'))`);
  assert.equal(await appCdp.evaluate(`document.querySelector('.browser-page-visual img')?.getAttribute('src')?.startsWith('data:image/png;base64,')`), true, 'the Page strip must render the site favicon without loading a remote URL in the trusted renderer');
  checkpoint('page-favicon');

  const addressContextLogStart = output.join('').length;
  const addressPoint = await appCdp.evaluate(`(()=>{const rect=document.querySelector('[data-testid="browser-address"]').getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  await appCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: addressPoint.x, y: addressPoint.y, button: 'right', clickCount: 1 });
  await appCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: addressPoint.x, y: addressPoint.y, button: 'right', clickCount: 1 });
  for (let attempt = 0; attempt < 40 && !output.join('').slice(addressContextLogStart).includes('[trusted-context-menu]'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(output.join('').slice(addressContextLogStart), /\[trusted-context-menu\] editable=true .*items=\d+/);
  await pressKey(appCdp, 'Escape', 'Escape', 27);

  const activePageIdForMenu = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  const pageContextLogStart = output.join('').length;
  const pagePoint = await appCdp.evaluate(`(()=>{const rect=document.querySelector(${JSON.stringify(`[data-testid="browser-page-${activePageIdForMenu}"]`)}).getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  await appCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pagePoint.x, y: pagePoint.y, button: 'right', clickCount: 1 });
  await appCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pagePoint.x, y: pagePoint.y, button: 'right', clickCount: 1 });
  for (let attempt = 0; attempt < 40 && !output.join('').slice(pageContextLogStart).includes('[browse-page-context-menu]'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(output.join('').slice(pageContextLogStart), /\[browse-page-context-menu\].*loaded=true.*items=3/);
  await pressKey(appCdp, 'Escape', 'Escape', 27);
  checkpoint('trusted-shell-context-menus');
  checkpoint('native-surface-visible');

  const pageBeforeBlockedOmnibox = await browseIdentitySnapshot(appCdp);
  const blockedNavigationMessage = '无法从 Browse 打开 Fielora 的受保护页面。';
  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'fielora://app/index.html');input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browser-error"]')?.textContent===${JSON.stringify(blockedNavigationMessage)}`);
  assert.deepEqual(await browseIdentitySnapshot(appCdp), pageBeforeBlockedOmnibox, 'a rejected privileged address must not navigate or replace the active Page');
  assert.equal((await appCdp.evaluate(`document.querySelector('[data-testid="browser-error"]')?.textContent`)).includes('Error invoking remote method'), false);
  checkpoint('blocked-navigation-user-message');

  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(localFixtureUrl)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===${JSON.stringify(localFixtureUrl)}&&state.surface.visible)`);
  const localTarget = await waitForTarget((item) => item.type === 'page' && item.url === localFixtureUrl);
  localCdp = await connect(localTarget);
  await waitExpression(localCdp, `document.querySelector('#local-fixture')`);
  for (let attempt = 0; attempt < 40 && remoteFileOpenerRequests === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(remoteFileOpenerRequests > 0, 'the nested Remote Page attack fixture must be requested');
  for (let attempt = 0; attempt < 40 && remoteFileOpenerExecutions === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(remoteFileOpenerExecutions > 0, 'the nested Remote Page attack script must actually execute');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.pages.length)`), 1, 'a Remote Page nested under a Local Page must not window.open a file target');
  assert.deepEqual(await localCdp.evaluate(`({process:typeof process,require:typeof require,module:typeof module,buffer:typeof Buffer,global:typeof global,bridge:typeof window.fielora,testBridge:typeof window.fieloraTest,webviewLoadURL:typeof document.createElement('webview').loadURL,opener:window.opener===null})`), {
    process: 'undefined', require: 'undefined', module: 'undefined', buffer: 'undefined', global: 'undefined', bridge: 'undefined', testBridge: 'undefined', webviewLoadURL: 'undefined', opener: true,
  });
  await interactWithPageElement(localCdp, '#local-button');
  await waitExpression(localCdp, `document.querySelector('#local-output')?.textContent==='clicked'`);
  await localCdp.evaluate(`(()=>{const input=document.querySelector('#local-input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'local page input');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await waitExpression(localCdp, `document.querySelector('#local-input')?.value==='local page input'`);
  await localCdp.evaluate(`(()=>{window.open('fielora://app/index.html');try{location.href='fielora://app/index.html';}catch{}return true;})()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await localCdp.evaluate('location.href'), localFixtureUrl, 'an isolated Local Page must not enter the privileged application origin');
  assert.equal(await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.pages.length)`), 1);

  await interactWithPageElement(localCdp, '#local-link');
  await waitExpression(localCdp, `location.href===${JSON.stringify(localChildUrl)}&&document.querySelector('#local-child')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===${JSON.stringify(localChildUrl)})`);
  assert.equal(await localCdp.evaluate('typeof window.fielora'), 'undefined');
  await assertBrowsePageTargets(appTarget.id, [localChildUrl]);

  await appCdp.evaluate(click('[data-testid="browser-back"]'));
  await waitExpression(localCdp, `location.href===${JSON.stringify(localFixtureUrl)}&&document.querySelector('#local-fixture')`);

  await waitExpression(appCdp, `!document.querySelector('[data-testid="browser-back"]')?.disabled`);
  await appCdp.evaluate(click('[data-testid="browser-back"]'));
  await waitExpression(localCdp, `location.href===${JSON.stringify(firstUrl)}&&document.querySelector('#fixture-one')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.url===${JSON.stringify(firstUrl)}&&state.surface.visible)`);
  await assertBrowsePageTargets(appTarget.id, [firstUrl]);
  localCdp.close();
  localCdp = undefined;
  checkpoint('isolated-local-page');

  const webTarget = await waitForTarget((item) => item.type === 'page' && item.url === firstUrl);
  webCdp = await connect(webTarget);
  await waitExpression(webCdp, `document.querySelector('#fixture-one')`);
  assert.equal(await webCdp.evaluate('document.title'), 'Fielora Fixture One');
  const renderedPage = await webCdp.send('Page.captureScreenshot', { format: 'png' });
  assert.ok(renderedPage.data.length > 1000, 'remote page must produce rendered pixels');
  assert.deepEqual(await webCdp.evaluate(`({process:typeof process,require:typeof require,module:typeof module,buffer:typeof Buffer,global:typeof global,bridge:typeof window.fielora,testBridge:typeof window.fieloraTest,webviewLoadURL:typeof document.createElement('webview').loadURL,opener:window.opener===null})`), {
    process: 'undefined', require: 'undefined', module: 'undefined', buffer: 'undefined', global: 'undefined', bridge: 'undefined', testBridge: 'undefined', webviewLoadURL: 'undefined', opener: true,
  });

  const deniedCapabilities = await webCdp.evaluate(`(async()=>{
    const blockedFetch=async(url)=>{try{const response=await fetch(url);return 'resolved:'+response.status;}catch(error){return 'blocked:'+error.name;}};
    const notification=typeof Notification==='undefined'?'unavailable':await Notification.requestPermission().catch(error=>'blocked:'+error.name);
    const geolocation=await navigator.permissions.query({name:'geolocation'}).then(result=>result.state,error=>'blocked:'+error.name);
    const media=!navigator.mediaDevices?.getUserMedia?'unavailable':await navigator.mediaDevices.getUserMedia({audio:true}).then(()=>'granted',error=>'blocked:'+error.name);
    return{notification,geolocation,media,fileFetch:await blockedFetch(${JSON.stringify(localFixtureUrl)}),appFetch:await blockedFetch('fielora://app/index.html')};
  })()`);
  assert.notEqual(deniedCapabilities.notification, 'granted');
  assert.notEqual(deniedCapabilities.geolocation, 'granted');
  assert.notEqual(deniedCapabilities.media, 'granted');
  assert.match(deniedCapabilities.fileFetch, /^blocked:/);
  assert.match(deniedCapabilities.appFetch, /^blocked:/);

  await webCdp.evaluate(`(()=>{for(const [id,url] of [['blocked-file-frame',${JSON.stringify(localFixtureUrl)}],['blocked-app-frame','fielora://app/index.html']]){const frame=document.createElement('iframe');frame.id=id;frame.src=url;document.body.append(frame);}return true;})()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const frameTree = await webCdp.send('Page.getFrameTree');
  const frameUrls = [];
  const collectFrameUrls = (node) => { frameUrls.push(node.frame.url); for (const child of node.childFrames ?? []) collectFrameUrls(child); };
  collectFrameUrls(frameTree.frameTree);
  assert.equal(frameUrls.some((url) => url.startsWith('file:') || url.startsWith('fielora:')), false);
  await webCdp.evaluate(`document.querySelector('#blocked-file-frame')?.remove();document.querySelector('#blocked-app-frame')?.remove()`);
  checkpoint('remote-security-boundary');

  const beforeBlockedNavigation = await webCdp.evaluate('location.href');
  await webCdp.evaluate(`(()=>{try{location.href=${JSON.stringify(localFixtureUrl)};}catch{}return true;})()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await webCdp.evaluate('location.href'), beforeBlockedNavigation);
  await webCdp.evaluate(`(()=>{try{location.href='fielora://app/index.html';}catch{}return true;})()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await webCdp.evaluate('location.href'), beforeBlockedNavigation);

  await interactWithPageElement(webCdp, '#interaction-button');
  await waitExpression(webCdp, `document.querySelector('#interaction-result')?.textContent==='clicked'`);
  await webCdp.evaluate(`(()=>{const input=document.querySelector('#fixture-input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'typed through Chromium');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await waitExpression(webCdp, `document.querySelector('#fixture-input')?.value==='typed through Chromium'`);
  await webCdp.evaluate('scrollBy(0,700)');
  await waitExpression(webCdp, `scrollY>0`);
  await webCdp.evaluate('scrollTo(0,0)');
  checkpoint('remote-page-click-input-scroll');

  let clipboardRoundTrip = false;
  for (let attempt = 0; attempt < 3 && !clipboardRoundTrip; attempt += 1) {
    await webCdp.evaluate(`(()=>{const source=document.querySelector('#clipboard-source');const range=document.createRange();range.selectNodeContents(source);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();})()`);
    await pressCtrlShortcut(webCdp, 'c', 'KeyC', 67);
    await webCdp.evaluate(`document.querySelector('#clipboard-target').value=''`);
    await webCdp.evaluate(`document.querySelector('#clipboard-target').focus()`);
    await pressCtrlShortcut(webCdp, 'v', 'KeyV', 86);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const pastedValue = await webCdp.evaluate(`document.querySelector('#clipboard-target')?.value`);
    clipboardRoundTrip = pastedValue === 'Fielora Chromium clipboard';
  }
  assert.equal(clipboardRoundTrip, true, 'Chromium Ctrl+C/Ctrl+V must complete an exact native clipboard round trip');
  checkpoint('native-clipboard-copy-paste');

  const beforeQuickCapture = await browseIdentitySnapshot(appCdp);
  await webCdp.evaluate(`(()=>{const source=document.querySelector('#clipboard-source');const range=document.createRange();range.selectNodeContents(source);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();})()`);
  await appCdp.evaluate(click('[data-testid="quick-capture"]'));
  await waitExpression(appCdp, `document.querySelector('[data-testid="quick-capture-status"]')?.innerText.includes('已捕获选区到 Inbox')`);
  const selectionCapture = await appCdp.evaluate(`window.fielora.capture.list({placement:'INBOX',lifecycle:'ACTIVE',field_id:null,cursor:null,limit:10}).then(page=>page.items[0])`);
  assert.equal(selectionCapture.kind, 'SELECTION');
  assert.equal(selectionCapture.content, 'Fielora Chromium clipboard');
  assert.equal(selectionCapture.source.uri, firstUrl);
  assert.deepEqual(await browseIdentitySnapshot(appCdp), beforeQuickCapture, 'Quick Capture must not navigate or replace the active Browse Page');
  assert.equal(await appCdp.evaluate(`Boolean(document.querySelector('[data-testid="browse-screen"]'))`), true);

  await webCdp.evaluate(`getSelection().removeAllRanges()`);
  await appCdp.evaluate(click('[data-testid="quick-capture"]'));
  await waitExpression(appCdp, `document.querySelector('[data-testid="quick-capture-status"]')?.innerText.includes('已捕获页面到 Inbox')`);
  const pageCapture = await appCdp.evaluate(`window.fielora.capture.list({placement:'INBOX',lifecycle:'ACTIVE',field_id:null,cursor:null,limit:10}).then(page=>page.items[0])`);
  assert.equal(pageCapture.kind, 'PAGE');
  assert.equal(pageCapture.source.uri, firstUrl);
  assert.deepEqual(await browseIdentitySnapshot(appCdp), beforeQuickCapture, 'Page Capture must keep the user in the current Browse surface');
  checkpoint('quick-capture-page-selection-stays-in-browse');

  const contextMenuLogStart = output.join('').length;
  const contextLinkPoint = await webCdp.evaluate(`(()=>{const rect=document.querySelector('#context-link').getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
  await webCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: contextLinkPoint.x, y: contextLinkPoint.y, button: 'right', clickCount: 1 });
  await webCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: contextLinkPoint.x, y: contextLinkPoint.y, button: 'right', clickCount: 1 });
  for (let attempt = 0; attempt < 40 && !output.join('').slice(contextMenuLogStart).includes('[browse-context-menu]'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(output.join('').slice(contextMenuLogStart), /\[browse-context-menu\].*link=true.*inspect=true.*items=\d+/);
  await pressKey(webCdp, 'Escape', 'Escape', 27);
  checkpoint('native-context-menu');

  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(slowUrl)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.is_loading&&Boolean(document.querySelector('[data-testid="browser-loading"]'))&&Boolean(document.querySelector('.browser-page-loader'))&&document.querySelector('[data-testid="browser-reload"]')?.getAttribute('aria-busy')==='true'&&getComputedStyle(document.querySelector('[data-testid="browser-reload"]')).animationName==='none')`);
  await waitExpression(webCdp, `location.href===${JSON.stringify(slowUrl)}&&document.querySelector('#slow-page')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>!state.is_loading&&!document.querySelector('[data-testid="browser-loading"]')&&!document.querySelector('.browser-page-loader'))`);
  const slowLoadsBeforeReload = Number(await webCdp.evaluate('document.documentElement.dataset.loads'));
  await appCdp.evaluate(click('[data-testid="browser-reload"]'));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.is_loading&&Boolean(document.querySelector('[data-testid="browser-loading"]')))`);
  await waitExpression(webCdp, `document.querySelector('#slow-page')&&Number(document.documentElement.dataset.loads)>${slowLoadsBeforeReload}`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>!state.is_loading&&!document.querySelector('[data-testid="browser-loading"]'))`);
  await appCdp.evaluate(click('[data-testid="browser-back"]'));
  await waitExpression(webCdp, `location.href===${JSON.stringify(firstUrl)}&&document.querySelector('#fixture-one')`);
  checkpoint('visible-navigation-loading-feedback');

  await interactWithPageElement(webCdp, '#normal-link');
  await waitExpression(webCdp, `location.href===${JSON.stringify(normalUrl)}&&document.querySelector('#normal')`);
  await assertBrowsePageTargets(appTarget.id, [normalUrl]);
  await waitExpression(appCdp, `!document.querySelector('[data-testid="browser-back"]')?.disabled`);
  await appCdp.evaluate(click('[data-testid="browser-back"]'));
  await waitExpression(webCdp, `location.href===${JSON.stringify(firstUrl)}&&document.querySelector('#fixture-one')`);

  await interactWithPageElement(webCdp, '#blank-link');
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===2&&state.url===${JSON.stringify(blankUrl)}&&state.active_page_id===state.pages.find(page=>page.url===${JSON.stringify(blankUrl)})?.id)`);
  const blankTarget = await waitForTarget((item) => item.type === 'page' && item.url === blankUrl);
  const blankCdp = await connect(blankTarget);
  await waitExpression(blankCdp, `document.querySelector('#blank')`);
  await assertBrowsePageTargets(appTarget.id, [firstUrl, blankUrl]);
  const blankPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  await appCdp.evaluate(click(`[data-testid="browser-close-page-${blankPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===${JSON.stringify(firstUrl)}&&state.surface.visible)`);
  blankCdp.close();
  await assertBrowsePageTargets(appTarget.id, [firstUrl]);

  await interactWithPageElement(webCdp, '#script-open');
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===2&&state.url===${JSON.stringify(scriptOpenUrl)})`);
  const scriptTarget = await waitForTarget((item) => item.type === 'page' && item.url === scriptOpenUrl);
  const scriptCdp = await connect(scriptTarget);
  await waitExpression(scriptCdp, `document.querySelector('#script-open')`);
  const scriptPages = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.pages)`);
  const firstPageId = scriptPages.find((item) => item.url === firstUrl).id;
  const scriptPageId = scriptPages.find((item) => item.url === scriptOpenUrl).id;
  await appCdp.evaluate(click(`[data-testid="browser-page-${firstPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.active_page_id===${JSON.stringify(firstPageId)}&&state.url===${JSON.stringify(firstUrl)}&&state.surface.visible)`);
  assert.equal(await webCdp.evaluate(`document.querySelector('#fixture-input')?.value`), 'typed through Chromium');
  await appCdp.evaluate(click(`[data-testid="browser-page-${scriptPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.active_page_id===${JSON.stringify(scriptPageId)}&&state.url===${JSON.stringify(scriptOpenUrl)}&&state.surface.visible)`);
  await appCdp.evaluate(click(`[data-testid="browser-close-page-${scriptPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===${JSON.stringify(firstUrl)}&&state.surface.visible)`);
  scriptCdp.close();
  await webCdp.evaluate(`window.open(${JSON.stringify(localFixtureUrl)})`);
  await webCdp.evaluate(`window.open('fielora://app/index.html')`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await webCdp.evaluate('location.href'), firstUrl);
  assert.equal(await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.pages.length)`), 1);
  await assertBrowsePageTargets(appTarget.id, [firstUrl]);
  checkpoint('window-open-page-policy');

  await interactWithPageElement(webCdp, '#next-link');
  await waitExpression(webCdp, `location.href===${JSON.stringify(secondUrl)} && document.querySelector('#fixture-two')`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browser-address"]')?.value===${JSON.stringify(secondUrl)}`);
  assert.equal(await appCdp.evaluate(`document.querySelector('.page-title')?.textContent`), 'Fielora Fixture Two');
  checkpoint('remote-page-link-navigation');

  await waitExpression(appCdp, `!document.querySelector('[data-testid="browser-back"]')?.disabled`);
  await appCdp.evaluate(click('[data-testid="browser-back"]'));
  await waitExpression(webCdp, `location.href===${JSON.stringify(firstUrl)} && document.querySelector('#fixture-one')`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browser-address"]')?.value===${JSON.stringify(firstUrl)}`);

  await waitExpression(appCdp, `!document.querySelector('[data-testid="browser-forward"]')?.disabled`);
  await appCdp.evaluate(click('[data-testid="browser-forward"]'));
  await waitExpression(webCdp, `location.href===${JSON.stringify(secondUrl)} && document.querySelector('#fixture-two')`);
  const loadsBeforeReload = Number(await webCdp.evaluate(`document.documentElement.dataset.loads`));
  await appCdp.evaluate(click('[data-testid="browser-reload"]'));
  await waitExpression(webCdp, `Number(document.documentElement.dataset.loads)>${loadsBeforeReload}`);
  checkpoint('back-forward-reload');

  const originalPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  await appCdp.evaluate(click('[data-testid="browser-new-page"]'));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===2&&state.url===''&&!state.surface.attached&&!state.surface.visible)`);
  assert.equal(await appCdp.evaluate(`Boolean(document.querySelector('.browse-empty'))`), true, 'a newly created blank Page must expose the Browse empty surface');
  const createdPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  assert.notEqual(createdPageId, originalPageId);
  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(normalUrl)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.active_page_id===${JSON.stringify(createdPageId)}&&state.url===${JSON.stringify(normalUrl)}&&state.surface.visible)`);
  await assertBrowsePageTargets(appTarget.id, [secondUrl, normalUrl]);
  await appCdp.evaluate(click(`[data-testid="browser-page-${originalPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.active_page_id===${JSON.stringify(originalPageId)}&&state.url===${JSON.stringify(secondUrl)}&&state.surface.visible)`);
  await appCdp.evaluate(click(`[data-testid="browser-page-${createdPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.active_page_id===${JSON.stringify(createdPageId)}&&state.url===${JSON.stringify(normalUrl)}&&state.surface.visible)`);
  await appCdp.evaluate(click(`[data-testid="browser-close-page-${createdPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.active_page_id===${JSON.stringify(originalPageId)}&&state.url===${JSON.stringify(secondUrl)}&&state.surface.visible)`);
  await assertBrowsePageTargets(appTarget.id, [secondUrl]);
  checkpoint('page-create-switch-close');

  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(loginUrl)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(webCdp, `location.href===${JSON.stringify(loginUrl)}&&document.querySelector('#login-title')&&document.documentElement.dataset.hydrated==='true'&&!document.querySelector('#login-submit').disabled`);
  await webCdp.evaluate(`(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const account=document.querySelector('#login-account');const password=document.querySelector('#login-password');setter.call(account,'desktop-user');setter.call(password,'slice05-pass');account.dispatchEvent(new Event('input',{bubbles:true}));password.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#login-form').requestSubmit();return true;})()`);
  await waitExpression(webCdp, `location.href===${JSON.stringify(accountUrl)}&&document.querySelector('#session-active')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===${JSON.stringify(accountUrl)}&&state.title==='Fielora Authenticated Fixture')`);
  const accountLoadsBeforeReload = Number(await webCdp.evaluate('document.documentElement.dataset.loads'));
  await appCdp.evaluate(click('[data-testid="browser-reload"]'));
  await waitExpression(webCdp, `location.href===${JSON.stringify(accountUrl)}&&document.querySelector('#session-active')&&Number(document.documentElement.dataset.loads)>${accountLoadsBeforeReload}`);

  await interactWithPageElement(webCdp, '#session-window');
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===2&&state.url===${JSON.stringify(sessionCheckUrl)}&&state.title==='Fielora Authenticated Fixture')`);
  const sessionTarget = await waitForTarget((item) => item.type === 'page' && item.url === sessionCheckUrl);
  const sessionCdp = await connect(sessionTarget);
  await waitExpression(sessionCdp, `document.querySelector('#session-active')`);
  assert.doesNotMatch(await sessionCdp.evaluate('document.cookie'), /(?:^|;\s*)fielora_slice05_session=/, 'the shared authenticated session cookie must remain HttpOnly to page JavaScript');
  const sessionPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  await appCdp.evaluate(click(`[data-testid="browser-close-page-${sessionPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.active_page_id===${JSON.stringify(originalPageId)}&&state.url===${JSON.stringify(accountUrl)})`);
  sessionCdp.close();

  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(secondUrl)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(webCdp, `location.href===${JSON.stringify(secondUrl)}&&document.querySelector('#fixture-two')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===${JSON.stringify(secondUrl)}&&state.surface.visible)`);
  checkpoint('desktop-login-session');

  const realityAfterBrowse = await fieldRealitySnapshot(appCdp, field.id);
  assert.deepEqual(realityAfterBrowse, realityBefore, 'loose Browse must not create a Field or mutate any Field Reality collection');

  const beforeResize = await surfaceSnapshot(appCdp);
  assertVisibleSurface(beforeResize);
  const resizedWindow = { width: 900, height: 620 };
  await appCdp.evaluate(`window.fieloraTest.resizeWindow(${JSON.stringify(resizedWindow)})`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>{const rect=document.querySelector('[data-testid="browse-viewport"]')?.getBoundingClientRect();const bounds=state.surface.bounds;return state.surface.visible&&rect&&(bounds.width!==${beforeResize.state.surface.bounds.width}||bounds.height!==${beforeResize.state.surface.bounds.height})&&Math.abs(bounds.x-Math.round(rect.left))<=1&&Math.abs(bounds.y-Math.round(rect.top))<=1&&Math.abs(bounds.width-Math.round(rect.width))<=1&&Math.abs(bounds.height-Math.round(rect.height))<=1})`);
  const afterResize = await surfaceSnapshot(appCdp);
  assertVisibleSurface(afterResize);
  assert.notDeepEqual(afterResize.state.surface.bounds, beforeResize.state.surface.bounds, 'WebContentsView bounds must respond to native window resize');
  assert.ok(afterResize.utility && afterResize.rail && afterResize.rail.x >= afterResize.utility.x && afterResize.rail.right <= afterResize.utility.right, 'Browse controls must remain inside the resizable right utility sidebar');
  const viewportBeforeResponsiveWait = await webCdp.evaluate(`({ innerWidth, innerHeight, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height })`);
  console.log(`BROWSE_E2E_RESIZE_DIAGNOSTIC ${JSON.stringify({ bounds: afterResize.state.surface.bounds, remote: viewportBeforeResponsiveWait })}`);
  await waitExpression(webCdp, `Math.abs(innerWidth-${afterResize.state.surface.bounds.width})<=1&&Math.abs(innerHeight-${afterResize.state.surface.bounds.height})<=1`);
  const remoteViewport = await webCdp.evaluate(`({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,dpr:devicePixelRatio,visualWidth:visualViewport?.width,visualHeight:visualViewport?.height,visualScale:visualViewport?.scale,narrowLayout:matchMedia('(max-width: 800px)').matches,probeColumns:getComputedStyle(document.querySelector('.viewport-probe')).gridTemplateColumns})`);
  assert.ok(Math.abs(remoteViewport.innerWidth - afterResize.state.surface.bounds.width) <= 1, 'remote CSS viewport width must equal the native WebContentsView width at 100% zoom');
  assert.ok(Math.abs(remoteViewport.innerHeight - afterResize.state.surface.bounds.height) <= 1, 'remote CSS viewport height must equal the native WebContentsView height at 100% zoom');
  assert.equal(remoteViewport.visualScale, 1, 'the Browse visual viewport must not carry a hidden page scale');
  assert.ok(Math.abs(remoteViewport.dpr - afterResize.window.dpr) < 0.01, 'remote WebContents and the trusted shell must use the same Windows DPR');
  assert.equal(remoteViewport.narrowLayout, true, 'the controlled page must receive Chromium responsive layout for its actual narrow viewport');
  assert.equal(remoteViewport.probeColumns.split(' ').length, 1, 'the rendered responsive fixture must collapse to one column');
  const narrowRenderedPage = await webCdp.send('Page.captureScreenshot', { format: 'png' });
  assert.ok(narrowRenderedPage.data.length > 1000, 'the narrow remote viewport must still produce rendered pixels');
  await writeFile(path.join(evidenceDir, 'slice05-narrow-runtime.png'), Buffer.from(narrowRenderedPage.data, 'base64'));
  checkpoint('native-window-viewport-dpr');

  await appCdp.evaluate(`window.fieloraTest.resizeWindow({width:1180,height:760})`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.surface.visible&&state.surface.bounds.height>${afterResize.state.surface.bounds.height})`);
  const beforeUtilityDrag = await surfaceSnapshot(appCdp);
  await dragDivider(appCdp, 'utility-resizer', -80);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.surface.bounds.width>=${beforeUtilityDrag.state.surface.bounds.width + 70})`);
  const afterUtilityDrag = await surfaceSnapshot(appCdp);
  assertVisibleSurface(afterUtilityDrag);
  await waitExpression(webCdp, `Math.abs(innerWidth-${afterUtilityDrag.state.surface.bounds.width})<=1&&Math.abs(innerHeight-${afterUtilityDrag.state.surface.bounds.height})<=1`);
  assert.ok(afterUtilityDrag.utility.width > beforeUtilityDrag.utility.width, 'dragging the divider left must expand the Browser sidebar');
  checkpoint('draggable-browser-sidebar-viewport');

  const browseBeforeFieldTransition = await browseIdentitySnapshot(appCdp);
  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:navigate',{detail:'FIELDS'}))`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="fields-screen"]')&&!document.querySelector('[data-testid="scheduled-tasks-screen"]')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.surface.app_view==='NOT_BROWSE'&&!state.surface.visible)`);
  await waitExpression(appCdp, `document.querySelector(${JSON.stringify(`[data-testid="fields-field-${field.id}"]`)})`);
  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:open-utility',{detail:'BROWSER'}))`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browse-screen"]')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.url===${JSON.stringify(secondUrl)}&&state.surface.visible)`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>{const rect=document.querySelector('[data-testid="browse-viewport"]')?.getBoundingClientRect();const bounds=state.surface.bounds;return rect&&Math.abs(bounds.x-Math.round(rect.left))<=1&&Math.abs(bounds.y-Math.round(rect.top))<=1&&Math.abs(bounds.width-Math.round(rect.width))<=1&&Math.abs(bounds.height-Math.round(rect.height))<=1})`);
  assertVisibleSurface(await surfaceSnapshot(appCdp));
  assert.deepEqual(await browseIdentitySnapshot(appCdp), browseBeforeFieldTransition, 'Fields round-trip must preserve the loose Browse Page collection');
  checkpoint('browse-fields-browse');

  await appCdp.evaluate(click('[data-testid="now-nav"]'));
  await waitExpression(appCdp, `document.querySelector('[data-testid="scheduled-tasks-screen"]')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>!state.surface.visible)`);
  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:open-utility',{detail:'BROWSER'}))`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.url===${JSON.stringify(secondUrl)}&&state.surface.visible)`);
  checkpoint('browse-now-browse');

  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:navigate',{detail:'FIELDS'}))`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="fields-screen"]')`);
  await appCdp.evaluate(click(`[data-testid="fields-field-${field.id}"]`));
  await waitExpression(appCdp, `document.querySelector('[data-testid="field-screen"]')`);
  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:open-utility',{detail:'BROWSER'}))`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browse-screen"]')`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.url===${JSON.stringify(secondUrl)}&&state.surface.visible)`);
  checkpoint('field-surface-browse');

  await appCdp.evaluate(click('[data-testid="now-nav"]'));
  await waitExpression(appCdp, `document.querySelector('[data-testid="scheduled-tasks-screen"]')`);
  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:navigate',{detail:'FIELDS'}))`);
  await waitExpression(appCdp, `document.querySelector(${JSON.stringify(`[data-testid="fields-field-${field.id}"]`)})`);
  await appCdp.evaluate(click(`[data-testid="fields-field-${field.id}"]`));
  await waitExpression(appCdp, `document.querySelector('[data-testid="field-screen"]')`);
  await appCdp.evaluate(`window.dispatchEvent(new CustomEvent('fielora:open-utility',{detail:'BROWSER'}))`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browse-screen"]')`);
  await waitExpression(appCdp, `document.querySelector('[data-testid="browser-address"]')?.value===${JSON.stringify(secondUrl)}`);

  const realityAfterTransitions = await fieldRealitySnapshot(appCdp, field.id);
  assert.deepEqual(realityAfterTransitions, realityBefore, 'Browse/Now/Fields/Field transitions must preserve the complete Field Reality');
  checkpoint('browse-field-boundary');

  const finalPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  await appCdp.evaluate(click(`[data-testid="browser-close-page-${finalPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===0&&state.active_page_id===''&&state.url===''&&!state.surface.attached&&!state.surface.visible)`);
  await assertBrowsePageTargets(appTarget.id, []);
  assert.equal(await appCdp.evaluate(`document.querySelectorAll('.browser-page').length`), 0, 'closing the final loaded Page must leave zero Pages');

  await appCdp.evaluate(click('[data-testid="browser-new-page"]'));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===''&&state.active_page_id!=='')`);
  const cleanBlankPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  assert.equal(await appCdp.evaluate(`Boolean(document.querySelector('[data-testid="browser-close-page-${cleanBlankPageId}"]'))`), true, 'the sole clean blank Page must remain closable');
  await appCdp.evaluate(click(`[data-testid="browser-close-page-${cleanBlankPageId}"]`));
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===0&&state.active_page_id===''&&!state.surface.attached&&!state.surface.visible)`);

  await appCdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',ctrlKey:true,bubbles:true}))`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.url===''&&state.active_page_id!=='')`);
  await appCdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',ctrlKey:true,bubbles:true}))`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===0&&state.active_page_id===''&&!state.surface.attached&&!state.surface.visible)`);
  checkpoint('zero-page-lifecycle');

  assert.equal(await appCdp.evaluate(`document.querySelector('[data-testid="browser-address"]').disabled`), false, 'the Omnibox must remain enabled with zero Pages');
  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(normalUrl)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===1&&state.active_page_id!==''&&state.url===${JSON.stringify(normalUrl)}&&state.surface.visible)`);
  await assertBrowsePageTargets(appTarget.id, [normalUrl]);
  const omniboxUrlPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  await appCdp.evaluate(`window.fielora.browser.closePage({page_id:${JSON.stringify(omniboxUrlPageId)}})`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===0&&state.active_page_id===''&&!state.surface.attached&&!state.surface.visible)`);
  await assertBrowsePageTargets(appTarget.id, []);

  const zeroPageSearch = 'fielora zero page';
  const zeroPageSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(zeroPageSearch)}`;
  await appCdp.evaluate(`(()=>{window.__zeroPageOmniboxStates=[];window.__stopZeroPageOmnibox=window.fielora.browser.subscribe(state=>window.__zeroPageOmniboxStates.push({pages:state.pages.length,active:state.active_page_id,url:state.url}));return true;})()`);
  await appCdp.evaluate(`(()=>{const input=document.querySelector('[data-testid="browser-address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(zeroPageSearch)});input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true;})()`);
  await waitExpression(appCdp, `window.__zeroPageOmniboxStates.some(state=>state.pages===1&&state.active!==''&&state.url===${JSON.stringify(zeroPageSearchUrl)})`);
  await appCdp.evaluate(`window.__stopZeroPageOmnibox();delete window.__stopZeroPageOmnibox`);
  const omniboxSearchPageId = await appCdp.evaluate(`window.fielora.browser.getState().then(state=>state.active_page_id)`);
  await appCdp.evaluate(`window.fielora.browser.closePage({page_id:${JSON.stringify(omniboxSearchPageId)}})`);
  await waitExpression(appCdp, `window.fielora.browser.getState().then(state=>state.pages.length===0&&state.active_page_id===''&&!state.surface.attached&&!state.surface.visible)`);
  checkpoint('zero-page-omnibox');

  await appCdp.evaluate('void window.fielora.core.quit()', false);
  appCdp.close();
  webCdp.close();
  assert.equal(await waitExit(launched), 0);
  if (packaged) {
    const acceptancePath = path.join(evidenceDir, mode === 'portable' ? 'PHASE_03_PORTABLE_ACCEPTANCE.json' : 'PHASE_03_PACKAGED_ACCEPTANCE.json');
    await writeFile(acceptancePath, `${JSON.stringify({ status: 'PASS', mode, application: appPath, trusted_origin: trustedOrigin, checks: checkpoints, captured_at: new Date().toISOString() }, null, 2)}\n`);
  }
  console.log(`Phase 03 Browse Desktop E2E (Slices 01-05, ${mode}): PASS`);
} finally {
  appCdp?.close();
  webCdp?.close();
  localCdp?.close();
  fixtureServer.close();
  if (launched && launched.exitCode === null) killTestProcess(launched.pid);
  await new Promise((resolve) => setTimeout(resolve, 150));
  try { await rm(localAppData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
}
