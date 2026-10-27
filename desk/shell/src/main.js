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

function shouldShowErrorPage(errorCode, isMainFrame) {
  // -3 = ERR_ABORTED（正常中止）不算错；只有主框架失败才切出错页
  return isMainFrame === true && errorCode !== -3;
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
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    // 所有"去服务器页"的唯一入口：先取消未触发的崩溃重载定时器
    function goServer() {
      if (crashTimer) { clearTimeout(crashTimer); crashTimer = null; }
      mainWindow.loadURL(config.serverUrl);
    }

    function showErrorPage(errorCode) {
      if (crashTimer) { clearTimeout(crashTimer); crashTimer = null; }
      mainWindow.loadFile(path.join(__dirname, 'error.html'), {
        query: { code: String(errorCode || '') },
      });
    }

    function handleCrash() {
      crashCount += 1;
      if (crashCount >= 3) {
        showErrorPage();
        return;
      }
      if (crashTimer) clearTimeout(crashTimer);
      crashTimer = setTimeout(() => goServer(), 1000);
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
      mainWindow.webContents.on('did-finish-load', () => {
        // 自动重载成功（回到服务器页面）→ 崩溃计数清零
        if (mainWindow.webContents.getURL().startsWith(config.serverUrl)) crashCount = 0;
      });
      mainWindow.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
        if (shouldShowErrorPage(errorCode, isMainFrame)) showErrorPage(errorCode);
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

      goServer();
    }

    // 出错页的 retry 只认主窗口；正在加载时忽略，避免和 10 秒自动重试叠加
    ipcMain.on('zbswork:retry', (event) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) return;
      if (mainWindow.webContents.isLoading()) return;
      goServer();
    });

    // 证书错误：不调 preventDefault、不调 callback，保持 Electron 默认（拒绝）。
    // 子资源证书问题也会触发本事件，不能在这里切出错页；
    // 主框架证书错随后会走 did-fail-load（-202 类错误码），由那边统一切出错页。
    app.on('certificate-error', () => {});

    app.whenReady().then(() => {
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('window-all-closed', () => { app.quit(); });
  }
}
