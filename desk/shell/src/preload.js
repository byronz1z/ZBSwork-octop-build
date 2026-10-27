'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 只暴露一个 retry()；contextIsolation 开着，页面拿不到 ipcRenderer 本体
contextBridge.exposeInMainWorld('zbswork', {
  retry: () => ipcRenderer.send('zbswork:retry'),
});
