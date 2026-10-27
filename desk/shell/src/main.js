'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const config = require('./config.json');

// ---- 纯函数（供单测） ----
function routeWindowOpen(url, serverUrl) {
  return url.startsWith(serverUrl) ? 'child' : 'external';
}

function shouldBlockInput(input) {
  if (input.key === 'F12') return true;
  if (input.control && !input.shift && input.key.toLowerCase() === 'w') return true;
  if (input.control && input.shift && input.key.toLowerCase() === 'i') return true;
  return false;
}

function shouldShowErrorPage(errorCode) {
  return errorCode !== -3; // -3 = ERR_ABORTED，正常中止不算错
}

module.exports = { routeWindowOpen, shouldBlockInput, shouldShowErrorPage };

// ---- 主进程逻辑（被 require 时不跑） ----
if (!process.env.NODE_TEST) {
  Menu.setApplicationMenu(null);

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    let mainWindow = null;
    let crashCount = 0;
    let crashTimer = null;

    app.on('second-instance', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });

    function loadServer() {
      crashCount = 0;
      mainWindow.loadURL(config.serverUrl);
    }

    function showErrorPage(errorCode) {
      mainWindow.loadFile(path.join(__dirname, 'error.html'), {
        query: { code: String(errorCode || '') },
      });
    }

    function handleCrash() {
      if (crashTimer) clearTimeout(crashTimer);
      crashCount += 1;
      if (crashCount >= 3) {
        showErrorPage();
        return;
      }
      crashTimer = setTimeout(() => mainWindow.loadURL(config.serverUrl), 1000);
    }

    function createWindow() {
      mainWindow = new BrowserWindow({
        width: 1280, height: 800,
        minWidth: 960, minHeight: 600,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      mainWindow.webContents.on('before-input-event', (event, input) => {
        if (shouldBlockInput(input)) event.preventDefault();
      });
      mainWindow.webContents.on('render-process-gone', handleCrash);
      mainWindow.webContents.on('unresponsive', handleCrash);
      mainWindow.webContents.on('did-fail-load', (_e, errorCode) => {
        if (shouldShowErrorPage(errorCode)) showErrorPage(errorCode);
      });
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (routeWindowOpen(url, config.serverUrl) === 'child') {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              parent: mainWindow, width: 720, height: 800, autoHideMenuBar: true,
            },
          };
        }
        shell.openExternal(url);
        return { action: 'deny' };
      });

      loadServer();
    }

    ipcMain.on('zbswork:retry', () => { if (mainWindow) loadServer(); });

    app.on('certificate-error', (event) => {
      event.preventDefault(); // 不放行：阻止加载，走出错页
      showErrorPage('certificate-error');
    });

    app.whenReady().then(() => {
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('window-all-closed', () => { app.quit(); });
  }
}
