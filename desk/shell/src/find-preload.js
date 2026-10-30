'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 查找窗专用 preload：只暴露 find/close/onResult
contextBridge.exposeInMainWorld('zbsFind', {
  find: (text, forward, findNext) =>
    ipcRenderer.send('zbs:find', { text, forward: !!forward, findNext: !!findNext }),
  close: () => ipcRenderer.send('zbs:find-close'),
  onResult: (cb) =>
    ipcRenderer.on('zbs:find-result', (_e, r) => cb(r)),
});
