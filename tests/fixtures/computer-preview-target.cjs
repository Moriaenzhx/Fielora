// A separate synthetic native window. The test never drives its DOM or CDP.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const output = process.argv[2];
app.setName('Native Preview Acceptance');
app.setPath('userData', path.join(output, 'target-profile'));
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const window = new BrowserWindow({
    width: 680, height: 500, title: 'Fielora native preview acceptance',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
    <meta charset="utf-8"><title>Fielora native preview acceptance</title>
    <style>body{margin:0;padding:26px;background:#f8fafc;color:#142238;font:18px system-ui}
      h1{font-size:25px;margin:0 0 10px}p{margin:0 0 20px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .tile{height:130px;border-radius:12px;display:grid;place-items:center;font-weight:700}
      .red{background:rgb(221,48,67)}.green{background:rgb(44,180,124)}
      .blue{background:rgb(38,118,215)}.yellow{background:rgb(244,187,50)}</style>
    <h1>Native window preview</h1><p>Isolated fixture · FIELORA-PREVIEW-20261013</p>
    <div class="grid"><div class="tile red">RED</div><div class="tile green">GREEN</div>
    <div class="tile blue">BLUE</div><div class="tile yellow">YELLOW</div></div>`));
  window.show();
  writeFileSync(path.join(output, 'target-ready.json'), JSON.stringify({ pid: process.pid, bounds: window.getBounds() }));
});
app.on('window-all-closed', () => app.quit());
