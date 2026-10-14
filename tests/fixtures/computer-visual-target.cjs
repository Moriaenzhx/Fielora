// Independent canvas controls with a native text receiver, as used by canvas
// editors. The acceptance driver never connects to
// this renderer's DOM/CDP, and decisions may only use model-delivered pixels.
if (process.type === 'renderer') {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('visualFixture', { report: value => ipcRenderer.send('visual-fixture-state', value) });
} else {
  const { app, BrowserWindow, ipcMain, screen } = require('electron');
  const { writeFileSync } = require('node:fs');
  const { randomInt } = require('node:crypto');
  const path = require('node:path');
  const output = process.argv[2];
  app.setName('Native Visual Acceptance');
  app.setPath('userData', path.join(output, 'target-profile'));
  app.whenReady().then(async () => {
    app.setAccessibilitySupportEnabled(true);
    const window = new BrowserWindow({ width: 820, height: 660, title: 'Fielora canvas visual acceptance',
      webPreferences: { preload: __filename, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const order = [0, 1, 2, 3, 4, 5];
    for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const offscreen = process.env.FIELORA_VISUAL_WINDOW_MODE === 'offscreen';
    if (offscreen) {
      // Keep the red result control on screen; its exact image position remains
      // unknown to the model until it decodes the real window PNG.
      const red = order.indexOf(0);
      if (red % 3 === 0) [order[red], order[2]] = [order[2], order[red]];
    }
    ipcMain.on('visual-fixture-state', (event, value) => {
      if (event.sender !== window.webContents || !value || typeof value !== 'object') return;
      // Assertion-only output contains results and trust flags, no target geometry.
      writeFileSync(path.join(output, 'target-state.json'), JSON.stringify(value));
    });
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
      <title>Fielora canvas visual acceptance</title><style>html,body{margin:0;background:#f8fafc;overflow:hidden}canvas{display:block;outline:none}</style>
      <canvas width="820" height="632" tabindex="0" aria-label="Synthetic visual canvas"></canvas>
      <textarea id="text-receiver" tabindex="-1" aria-label="Canvas text entry" spellcheck="false" style="position:absolute;width:1px;height:1px;left:0;top:0;padding:0;border:0;opacity:0;pointer-events:none"></textarea>
      <script>
      const canvas=document.querySelector('canvas'),c=canvas.getContext('2d'),editor=document.querySelector('#text-receiver');
      const colors=['#dd3043','#2676d7','#2cb47c','#9554de','#f4bb32','#ef7f26'];
      const labels=['CLICK ONCE','TEXT INPUT','SCROLL DOWN','DRAG FROM','DROP HERE','DOUBLE CLICK'];
      const order=${JSON.stringify(order)}, tiles=order.map((kind,slot)=>({kind,x:28+(slot%3)*264,y:142+Math.floor(slot/3)*188,w:236,h:156}));
      const state={clicks:0,text:'',submitted:false,scrolls:0,dragged:false,doubleClicks:0,moves:0,events:[]};
      let focused=false,dragging=false;
      const tile=(kind)=>tiles.find(t=>t.kind===kind);
      const hit=(x,y)=>tiles.find(t=>x>=t.x&&x<=t.x+t.w&&y>=t.y&&y<=t.y+t.h);
      function report(event){if(event){state.events.push({type:event.type,trusted:event.isTrusted,...(event.type==='wheel'?{delta_y:event.deltaY,hit_kind:hit(event.offsetX,event.offsetY)?.kind??null}:{})});state.events=state.events.slice(-120);}window.visualFixture.report(state);}
      function draw(){
        c.fillStyle='#f8fafc';c.fillRect(0,0,820,632);c.fillStyle='#152238';c.font='bold 25px system-ui';c.fillText('Canvas visual operation acceptance',28,42);
        c.font='15px system-ui';c.fillText('No semantic buttons. Use the visible colored controls.',28,72);
        c.fillText('Click red · Type in blue · Scroll green · Drag purple to yellow · Double-click orange',28,100);
        for(const t of tiles){c.fillStyle=colors[t.kind];c.fillRect(t.x,t.y,t.w,t.h);c.fillStyle='#10202c';c.font='bold 19px system-ui';c.fillText(labels[t.kind],t.x+15,t.y+36);
          c.font='15px system-ui';let detail=t.kind===0?'Clicks: '+state.clicks:t.kind===1?state.text||'Click then type':t.kind===2?'Scrolls: '+state.scrolls:t.kind===4?(state.dragged?'Dropped successfully':'Waiting for drag'):t.kind===5?'Double clicks: '+state.doubleClicks:'Drag this tile';c.fillText(detail,t.x+15,t.y+78);
          if(t.kind===1&&focused){c.strokeStyle='#10202c';c.lineWidth=4;c.strokeRect(t.x+6,t.y+6,t.w-12,t.h-12);}
        }
        const flags=[state.clicks===1,state.text==='VISUAL-INPUT-42',state.submitted,state.scrolls>0,state.dragged,state.doubleClicks===1];
        for(let i=0;i<flags.length;i++){c.fillStyle=flags[i]?'#00d2d2':'#d9dee7';c.fillRect(28+i*126,554,108,38);c.fillStyle='#10202c';c.font='bold 14px system-ui';c.fillText(['CLICK','TEXT','ENTER','SCROLL','DRAG','DOUBLE'][i],36+i*126,578);}
        c.font='14px system-ui';c.fillText(flags.every(Boolean)?'VISUAL ACCEPTANCE COMPLETE':'Observe the changed pixels after each operation.',28,620);
      }
      canvas.addEventListener('pointermove',e=>{state.moves++;report(e);});
      canvas.addEventListener('pointerdown',e=>{const t=hit(e.offsetX,e.offsetY);focused=t?.kind===1;dragging=t?.kind===3;canvas.focus();if(focused){editor.style.left=(t.x+15)+'px';editor.style.top=(t.y+80)+'px';editor.focus();}canvas.setPointerCapture(e.pointerId);draw();report(e);});
      canvas.addEventListener('pointerup',e=>{if(dragging&&hit(e.offsetX,e.offsetY)?.kind===4)state.dragged=true;dragging=false;draw();report(e);});
      canvas.addEventListener('click',e=>{if(hit(e.offsetX,e.offsetY)?.kind===0)state.clicks++;draw();report(e);});
      canvas.addEventListener('dblclick',e=>{if(hit(e.offsetX,e.offsetY)?.kind===5)state.doubleClicks++;draw();report(e);});
      // Use the browser's real Unicode/IME input path. No state is written by
      // the E2E driver; only trusted OS events update the receiver and canvas.
      editor.addEventListener('input',e=>{state.text=editor.value;draw();report(e);});
      editor.addEventListener('keydown',e=>{if(e.key==='Enter'){state.submitted=true;e.preventDefault();}draw();report(e);});
      canvas.addEventListener('wheel',e=>{if(hit(e.offsetX,e.offsetY)?.kind===2&&e.deltaY>0)state.scrolls++;e.preventDefault();draw();report(e);},{passive:false});
      draw();report();
      </script>`));
    window.show();
    if (offscreen) {
      const leftmost = screen.getAllDisplays().reduce((a, b) => a.bounds.x < b.bounds.x ? a : b);
      window.setPosition(leftmost.bounds.x - 300, leftmost.bounds.y + 100);
    }
    // Geometry is fixture setup evidence only, never a source for agent inputs.
    writeFileSync(path.join(output, 'target-ready.json'), JSON.stringify({ pid: process.pid, name: app.name, semanticControls: false,
      nativeTitlebar: true, offscreen, bounds: window.getBounds(), displays: screen.getAllDisplays().map(d => d.bounds) }));
  });
  app.on('window-all-closed', () => app.quit());
}
