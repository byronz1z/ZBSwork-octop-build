'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// contextIsolation 开着，页面拿不到 ipcRenderer 本体，只暴露这两组
contextBridge.exposeInMainWorld('zbswork', {
  retry: () => ipcRenderer.send('zbswork:retry'),
});

// 桌面壳标识 + 点系统通知时把窗口叫到前面（补丁 24 网页端会调）
contextBridge.exposeInMainWorld('zbsDesktop', {
  isDesktop: true,
  focusWindow: () => ipcRenderer.send('zbs:focus-window'),
});
