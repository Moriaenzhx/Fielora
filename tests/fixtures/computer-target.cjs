// A separate native application process. The test never uses DOM/CDP input on it.
const { app, BrowserWindow, ipcMain } = require('electron');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const output = process.argv[2];
let saves = 0;
app.setName('Native Acceptance Target');
app.setPath('userData', path.join(output, 'target-profile'));
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const window = new BrowserWindow({ width: 640, height: 460, title: 'Native Control Fixture', webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'computer-target-preload.cjs') } });
  ipcMain.on('save-fixture', (event, value) => {
    if (event.sender === window.webContents && typeof value === 'string' && value.length <= 4096) {
      writeFileSync(path.join(output, 'native-result.txt'), value);
      writeFileSync(path.join(output, 'native-save-count.txt'), String(++saves));
    }
  });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Native Control Fixture</title>
    <style>body {font:20px system-ui;padding:40px}textarea {display:block;width:450px;height:160px;margin:20px 0}button{font:20px system-ui;padding:12px}</style>
    <h1>Native control acceptance</h1><label for="text">Acceptance text</label><textarea id="text" aria-label="Acceptance text"></textarea><button id="save">Save test</button><p id="state">Ready</p>
    <script>document.getElementById('save').addEventListener('click',()=>{window.nativeFixture.save(document.getElementById('text').value);document.getElementById('state').textContent='Saved';});</script>`));
  window.show();
  writeFileSync(path.join(output, 'target-ready.json'), JSON.stringify({ pid: process.pid }));
});
app.on('window-all-closed', () => app.quit());
