'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const { routeWindowOpen } = require('./lib/windowOpen');
const { mapShortcut } = require('./lib/shortcuts');
const { clampBounds } = require('./lib/windowState');
const { uniqueDownloadPath, downloadToast } = require('./lib/downloads');

// ---- 纯函数（供单测） ----
function shouldBlockInput(input, platform) {
  const k = input.key;
  if (k === 'F12') return true;
  if (platform === 'darwin') {
    // Mac：Cmd+W 关窗、Cmd+Option+I 开 DevTools、Cmd+Q 退应用，都屏蔽
    if (input.meta && k.toLowerCase() === 'w') return true;
    if (input.meta && input.alt && k.toLowerCase() === 'i') return true;
    if (input.meta && k.toLowerCase() === 'q') return true;
    return false;
  }
  if (input.control && !input.shift && k.toLowerCase() === 'w') return true;
  if (input.control && input.shift && k.toLowerCase() === 'i') return true;
  return false;
}

function shouldShowErrorPage(errorCode, isMainFrame) {
  // -3 = ERR_ABORTED（正常中止）不算错；只有主框架失败才切出错页
  return isMainFrame === true && errorCode !== -3;
}

module.exports = { routeWindowOpen, shouldBlockInput, shouldShowErrorPage };

// ---- 主进程逻辑（被 require 时不跑） ----
if (!process.env.NODE_TEST) {
  const { app, BrowserWindow, Menu, shell, ipcMain, Notification, session, screen, dialog } = require('electron');
  // electron-context-menu v5 是 ESM 默认导出，CJS 里要取 .default
  const contextMenu = require('electron-context-menu').default;
  Menu.setApplicationMenu(null);

  // 测试用：允许覆盖 userData 目录（跑完即删）。必须在单实例锁之前：Electron 的锁按 userData 路径算，
  // 否则测试实例会和已安装、正在运行的 ZBSwork 撞锁而直接退出（10-28 V10 实测）。
  if (process.env.ZBSWORK_USER_DATA) app.setPath('userData', process.env.ZBSWORK_USER_DATA);

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    let mainWindow = null;
    let crashCount = 0;
    let crashTimer = null;
    let findWindow = null;

    // Windows 通知中心按 AppUserModelId 认应用；须与 electron-builder.yml 的 appId 一致
    if (process.platform === 'win32') app.setAppUserModelId('cn.zbswork.desktop');

    // 权限：只放行 serverUrl 来源的通知/麦克风/剪贴板，其他来源一律拒，其他权限走默认。
    // session 要等 app ready 后才能取，移进 whenReady（createWindow 之前）执行。
    function installPermissionHandler() {
      const serverOrigin = new URL(config.serverUrl).origin;
      const allow = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write'];
      const isAllowed = (permission, origin) => origin === serverOrigin && allow.includes(permission);
      session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
        // Electron 45 的 details 只有 requestingUrl（旧版的 requestingOrigin 已不存在），自己算 origin
        const origin = details && details.requestingUrl
          ? new URL(details.requestingUrl).origin : null;
        callback(isAllowed(permission, origin));
      });
      // 权限检查处理器：网页 API（如 Notification.permission）同步探测时走这条路径，
      // 与请求处理器共用同一个 isAllowed 判断，避免两处口径不一致。
      session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
        let origin = requestingOrigin || null;
        if (!origin && details && details.requestingUrl) {
          try { origin = new URL(details.requestingUrl).origin; } catch (_e) { origin = null; }
        }
        if (origin) { try { origin = new URL(origin).origin; } catch (_e) { /* 已是 origin */ } }
        return isAllowed(permission, origin);
      });
    }

    // 把窗口叫到前面（second-instance 与网页端 focusWindow 共用）
    function focusMainWindow() {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      // Windows 上系统可能拦 focus，借 alwaysOnTop 抖一下把窗口真正顶到前面
      if (process.platform === 'win32') {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
      }
    }

    app.on('second-instance', focusMainWindow);
    ipcMain.on('zbs:focus-window', focusMainWindow);

    // 关于对话框（右键菜单也用它）
    function showAbout() {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '关于 ZBSwork',
        message: 'ZBSwork ' + config.displayVersion,
        detail: '服务器：' + config.serverUrl +
          '\nElectron ' + process.versions.electron +
          '　Chromium ' + process.versions.chrome,
      });
    }

    // 所有"去服务器页"的唯一入口：先取消未触发的崩溃重载定时器
    function goServer() {
      if (crashTimer) { clearTimeout(crashTimer); crashTimer = null; }
      mainWindow.loadURL(config.serverUrl);
    }

    // ---- 窗口记忆（userData/window-state.json） ----
    function loadWindowState() {
      try {
        const p = path.join(app.getPath('userData'), 'window-state.json');
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (_e) {
        return null; // 不存在或读坏了都用默认
      }
    }

    function saveWindowState() {
      if (!mainWindow) return;
      try {
        const p = path.join(app.getPath('userData'), 'window-state.json');
        fs.writeFileSync(p, JSON.stringify({
          ...mainWindow.getNormalBounds(),
          isMaximized: mainWindow.isMaximized(),
        }));
      } catch (e) {
        console.error('写窗口记忆失败：', e.message); // 只记日志，不许崩
      }
    }

    function zoomSettingsPath() {
      return path.join(app.getPath('userData'), 'settings.json');
    }

    function loadZoomLevel() {
      try {
        const z = JSON.parse(fs.readFileSync(zoomSettingsPath(), 'utf8')).zoomLevel;
        // 只认有限数并夹到 -3..3（与快捷键缩放同区间），否则当 0
        if (Number.isFinite(z)) return Math.max(-3, Math.min(3, z));
        return 0;
      } catch (_e) {
        return 0;
      }
    }

    function saveZoomLevel(level) {
      try {
        fs.writeFileSync(zoomSettingsPath(), JSON.stringify({ zoomLevel: level }));
      } catch (e) {
        console.error('写缩放设置失败：', e.message);
      }
    }

    // ---- 页内查找窗口 ----
    function positionFindWindow() {
      if (!mainWindow || !findWindow) return;
      const b = mainWindow.getBounds();
      findWindow.setPosition(b.x + b.width - 368, b.y + 8);
    }

    function openFindWindow() {
      if (findWindow) { findWindow.focus(); return; }
      const owner = mainWindow; // 创建时绑定的主窗口：closed 回调里只对它操作，防止主窗口先销毁
      findWindow = new BrowserWindow({
        parent: mainWindow,
        width: 360, height: 48,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
          preload: path.join(__dirname, 'find-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      // 不设 alwaysOnTop：child 窗口默认浮在 parent 之上，够了；主窗口最小化时它跟着隐藏
      hardenWindow(findWindow);
      positionFindWindow();
      findWindow.loadFile(path.join(__dirname, 'find.html'));
      findWindow.on('closed', () => {
        findWindow = null;
        if (owner && !owner.isDestroyed() && owner.webContents && !owner.webContents.isDestroyed()) {
          owner.webContents.stopFindInPage('clearSelection');
        }
      });
    }

    function closeFindWindow() {
      if (findWindow) findWindow.close(); // closed 事件里负责清状态
    }

    // 所有窗口统一加固：拦危险键 + 弹窗路由 + 弹出来的子窗口递归加固。
    // mapShortcut（重载/缩放/全屏/后退/查找）只在主窗口装，不在这里。
    function hardenWindow(win, extraOpenOptions = {}) {
      win.webContents.on('before-input-event', (event, input) => {
        if (shouldBlockInput(input, process.platform)) event.preventDefault();
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (routeWindowOpen(url, config.serverUrl) === 'child') {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              autoHideMenuBar: true,
              // 弹窗子窗口显式安全参数；不带 preload（只有主窗口和查找窗要 preload）
              webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
              ...extraOpenOptions,
            },
          };
        }
        shell.openExternal(url);
        return { action: 'deny' };
      });
      win.webContents.on('did-create-window', (child) => hardenWindow(child));
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
      const saved = loadWindowState();
      const defaults = { width: 1280, height: 800 };
      const bounds = saved
        ? clampBounds(saved, screen.getAllDisplays(), defaults)
        : defaults;
      mainWindow = new BrowserWindow({
        ...bounds,
        minWidth: 960, minHeight: 600,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      if (saved && saved.isMaximized) mainWindow.maximize();
      mainWindow.webContents.setZoomLevel(loadZoomLevel());
      mainWindow.on('close', saveWindowState);
      mainWindow.on('move', positionFindWindow);
      mainWindow.on('resize', positionFindWindow);
      mainWindow.on('closed', () => { mainWindow = null; closeFindWindow(); });

      // 统一加固：拦危险键 + 弹窗路由（弹窗带显式安全参数，不带 preload）+ 子窗口递归
      hardenWindow(mainWindow, { parent: mainWindow, width: 720, height: 800 });

      // 主窗口专属：mapShortcut（重载/缩放/全屏/后退/查找/收查找条）。危险键拦截在 hardenWindow 里。
      mainWindow.webContents.on('before-input-event', (event, input) => {
        const action = mapShortcut(input, process.platform);
        if (action === 'reload') { event.preventDefault(); mainWindow.webContents.reload(); }
        else if (action === 'zoomIn' || action === 'zoomOut') {
          event.preventDefault();
          const wc = mainWindow.webContents;
          const z = Math.max(-3, Math.min(3, wc.getZoomLevel() + (action === 'zoomIn' ? 0.5 : -0.5)));
          wc.setZoomLevel(z);
          saveZoomLevel(z);
        } else if (action === 'zoomReset') {
          event.preventDefault();
          mainWindow.webContents.setZoomLevel(0);
          saveZoomLevel(0);
        } else if (action === 'fullscreen') {
          event.preventDefault();
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        } else if (action === 'back') {
          event.preventDefault();
          const wc = mainWindow.webContents;
          if (wc.canGoBack()) wc.goBack();
        } else if (action === 'find') { event.preventDefault(); openFindWindow(); }
        else if (action === 'escape') { if (findWindow) { event.preventDefault(); closeFindWindow(); } }
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

      // 查找结果回给查找窗显示 "x / y"
      mainWindow.webContents.on('found-in-page', (_e, r) => {
        if (findWindow && !findWindow.isDestroyed()) {
          findWindow.webContents.send('zbs:find-result', r);
        }
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
      installPermissionHandler();
      // 中文右键菜单；不带 Google 搜索/查词/开发者工具项
      contextMenu({
        showCopyImageAddress: true,
        showSaveImageAs: true,
        showCopyLink: true,
        showSearchWithGoogle: false,
        showLookUpSelection: false,
        showInspectElement: false,
        labels: {
          cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
          copyLink: '复制链接', copyImage: '复制图片', copyImageAddress: '复制图片地址',
          saveImageAs: '图片另存为', learnSpelling: '学习拼写',
        },
        append: () => [{ label: '关于 ZBSwork', click: showAbout }],
      });

      // 只注册一次的监听（不随 createWindow 反复挂）：查找窗来的消息、下载提示。
      // 查找窗来的消息：只认查找窗
      ipcMain.on('zbs:find', (event, { text, forward, findNext }) => {
        if (!findWindow || event.sender !== findWindow.webContents) return;
        if (!mainWindow || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
        if (!text) { mainWindow.webContents.stopFindInPage('clearSelection'); return; }
        mainWindow.webContents.findInPage(text, { forward: !!forward, findNext: !!findNext });
      });
      ipcMain.on('zbs:find-close', (event) => {
        if (findWindow && event.sender === findWindow.webContents) closeFindWindow();
      });

      // 下载提示：存到系统下载目录，重名按 "名 (1).扩展名" 递增
      // completedDownloads：已完成下载的 savePath 白名单，"打开文件夹"只认这里面的路径，
      // 网页伪造消息不能借这条通道打开任意路径
      const completedDownloads = new Set();
      session.defaultSession.on('will-download', (_e, item) => {
        const dir = app.getPath('downloads');
        const savePath = uniqueDownloadPath(dir, item.getFilename(), (p) => fs.existsSync(p));
        item.setSavePath(savePath);
        item.once('done', (_ev, state) => {
          if (state === 'completed') {
            completedDownloads.add(savePath);
            const n = new Notification({ title: '下载完成', body: path.basename(savePath) });
            n.on('click', () => shell.showItemInFolder(savePath));
            n.show();
          } else {
            new Notification({ title: '下载失败', body: item.getFilename() }).show();
          }
          // 窗口内也弹提示条（preload 里渲染）；成功才带 savePath 供"打开文件夹"用
          if (mainWindow && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('zbs:download-done', {
              ...downloadToast(state, path.basename(savePath)),
              savePath: state === 'completed' ? savePath : null,
            });
          }
        });
      });

      // 提示条里"打开文件夹"按钮：只认主窗口发来的、且路径在完成白名单里
      ipcMain.on('zbs:open-download', (event, savePath) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return;
        if (typeof savePath !== 'string' || !completedDownloads.has(savePath)) return;
        shell.showItemInFolder(savePath);
      });

      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('window-all-closed', () => { app.quit(); });
  }
}
