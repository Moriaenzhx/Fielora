const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nativeFixture', { save: value => ipcRenderer.send('save-fixture', value) });
