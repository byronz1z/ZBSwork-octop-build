'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const { routeWindowOpen, isSameOrigin } = require('./lib/windowOpen');
const { mapShortcut } = require('./lib/shortcuts');
const { clampBounds } = require('./lib/windowState');
const { downloadToast, reserveDownloadPath } = require('./lib/downloads');
const { createFaultLogger } = require('./lib/faultLog');
const {
  isPermissionAllowed,
  decideReloadAction,
  decideRetryAction,
  isBlankDomSnapshot,
  shouldRecoverBlankScreen,
  buildApplicationMenuTemplate,
  createForceCrashCoordinator,
} = require('./lib/recovery');

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

function parsePositiveMs(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = { routeWindowOpen, shouldBlockInput, shouldShowErrorPage };

// ---- 主进程逻辑（被 require 时不跑） ----
if (!process.env.NODE_TEST) {
  const { app, BrowserWindow, Menu, shell, ipcMain, Notification, session, screen, dialog } = require('electron');
  // electron-context-menu v5 是 ESM 默认导出，CJS 里要取 .default
  const contextMenu = require('electron-context-menu').default;

  // 测试用：允许覆盖 userData 目录（跑完即删）。必须在单实例锁之前：Electron 的锁按 userData 路径算，
  // 否则测试实例会和已安装、正在运行的 ZBSwork 撞锁而直接退出（10-28 V10 实测）。
  if (process.env.ZBSWORK_USER_DATA) app.setPath('userData', process.env.ZBSWORK_USER_DATA);

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    const NAV_TIMEOUT_MS = parsePositiveMs(process.env.ZBSWORK_NAV_TIMEOUT_MS, 20000);
    const RETRY_STOP_AFTER_MS = parsePositiveMs(process.env.ZBSWORK_RETRY_STOP_AFTER_MS, 8000);
    const UNRESPONSIVE_RECOVER_MS = parsePositiveMs(process.env.ZBSWORK_UNRESPONSIVE_MS, 3000);
    const FORCE_CRASH_FALLBACK_MS = parsePositiveMs(process.env.ZBSWORK_FORCE_CRASH_FALLBACK_MS, 6000);
    const BLANK_CHECK_DELAY_MS = parsePositiveMs(process.env.ZBSWORK_BLANK_CHECK_MS, 4000);
    const MAX_BLANK_RECOVERIES = 1;

    const faultLog = createFaultLogger(path.join(app.getPath('userData'), 'logs', 'main.log'));

    let mainWindow = null;
    let crashCount = 0;
    let crashTimer = null;
    let navTimeoutTimer = null;
    let blankCheckTimer = null;
    let blankRecoveryCount = 0;
    let navStartedAt = null;
    let isUnresponsive = false;
    let findWindow = null;

    const forceCrash = createForceCrashCoordinator({
      fallbackMs: FORCE_CRASH_FALLBACK_MS,
      forcefullyCrashRenderer: () => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
          throw new Error('mainWindow 已销毁');
        }
        mainWindow.webContents.forcefullyCrashRenderer();
      },
      onReload: () => goServer(),
      onErrorUnresponsive: () => showErrorPage('UNRESPONSIVE'),
      onLog: (event, details) => faultLog.log(event, details),
    });

    // Windows 通知中心按 AppUserModelId 认应用；须与 electron-builder.yml 的 appId 一致。
    // 开发态用 .dev 后缀，免得开发版 Electron 写的开始菜单快捷方式顶掉装好的客户端的图标
    if (process.platform === 'win32') {
      app.setAppUserModelId(app.isPackaged ? 'cn.zbswork.desktop' : 'cn.zbswork.desktop.dev');
    }

    function clearPendingTimers() {
      if (crashTimer) { clearTimeout(crashTimer); crashTimer = null; }
      if (navTimeoutTimer) { clearTimeout(navTimeoutTimer); navTimeoutTimer = null; }
      if (blankCheckTimer) { clearTimeout(blankCheckTimer); blankCheckTimer = null; }
      forceCrash.clear();
    }

    // 权限：只放行 serverUrl 同源的通知/麦克风/剪贴板/全屏，其他来源一律拒。
    // session 要等 app ready 后才能取，移进 whenReady（createWindow 之前）执行。
    function installPermissionHandler() {
      session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
        // Electron 45 的 details 只有 requestingUrl（旧版的 requestingOrigin 已不存在），用严格 origin 判定
        const urlOrOrigin = details && details.requestingUrl ? details.requestingUrl : null;
        callback(isPermissionAllowed(permission, urlOrOrigin, config.serverUrl));
      });
      // 权限检查处理器：网页 API（如 Notification.permission）同步探测时走这条路径，
      // 与请求处理器共用同一个 isPermissionAllowed 判断，避免两处口径不一致。
      session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
        const urlOrOrigin = requestingOrigin || (details && details.requestingUrl) || null;
        return isPermissionAllowed(permission, urlOrOrigin, config.serverUrl);
      });
    }

    // 平台菜单：macOS 保留最小应用菜单与标准 Edit 角色（恢复 Cmd+C/V/X/A/Z），Win/Linux 维持无菜单栏
    function installApplicationMenu() {
      const template = buildApplicationMenuTemplate(process.platform, {
        appName: 'ZBSwork',
        onAbout: showAbout,
      });
      Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
    }

    // 把窗口叫到前面（second-instance 与网页端 focusWindow 共用）
    function focusMainWindow() {
      if (!mainWindow || mainWindow.isDestroyed()) return;
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

    // 关于对话框（右键菜单与 macOS 应用菜单共用）
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

    // 所有"去服务器页"的唯一入口：清理所有待定定时器并启动导航超时保护
    function goServer() {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      clearPendingTimers();
      navStartedAt = Date.now();
      navTimeoutTimer = setTimeout(() => {
        navTimeoutTimer = null;
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
        if (mainWindow.webContents.isLoading()) {
          faultLog.log('nav-timeout', { url: config.serverUrl, timeoutMs: NAV_TIMEOUT_MS });
          try { mainWindow.webContents.stop(); } catch (_e) { /* 忽略 */ }
          showErrorPage('TIMEOUT');
        }
      }, NAV_TIMEOUT_MS);
      mainWindow.loadURL(config.serverUrl).catch((e) => {
        // ERR_ABORTED(-3) 等由 did-fail-load 或超时逻辑处理，不抛未处理拒绝
        if (e && e.errno !== -3 && e.code !== 'ERR_ABORTED') {
          faultLog.log('load-url-error', { code: e.code || e.errno || 'unknown', message: e.message || String(e) });
        }
      });
    }

    // 无响应态恢复：先 forcefullyCrashRenderer() 强杀死锁渲染进程，
    // 等 render-process-gone（或兜底超时 / 同步抛错）后再由状态机调 goServer() 重建新进程
    function forceReloadServer(reason) {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      if (forceCrash.isPending()) {
        forceCrash.upgradePendingToReload(reason);
        return;
      }
      clearPendingTimers();
      isUnresponsive = false;
      forceCrash.trigger('reload', reason);
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
      if (!mainWindow || mainWindow.isDestroyed()) return;
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
      if (!mainWindow || mainWindow.isDestroyed() || !findWindow || findWindow.isDestroyed()) return;
      const b = mainWindow.getBounds();
      findWindow.setPosition(b.x + b.width - 368, b.y + 8);
    }

    function openFindWindow() {
      if (findWindow && !findWindow.isDestroyed()) { findWindow.focus(); return; }
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
      if (findWindow && !findWindow.isDestroyed()) findWindow.close(); // closed 事件里负责清状态
    }

    // 所有窗口统一加固：拦危险键 + 弹窗路由 + 弹出来的子窗口递归加固。
    // mapShortcut（重载/缩放/全屏/后退/查找）只在主窗口装，不在这里。
    function hardenWindow(win, extraOpenOptions = {}) {
      win.webContents.on('before-input-event', (event, input) => {
        if (shouldBlockInput(input, process.platform)) event.preventDefault();
      });
      win.webContents.setWindowOpenHandler(({ url, disposition }) => {
        let currentUrl = '';
        try { currentUrl = win.webContents.getURL(); } catch (_e) { currentUrl = ''; }
        const route = routeWindowOpen(url, config.serverUrl, disposition, currentUrl);
        if (route === 'child') {
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
        if (route === 'external') {
          // 本机没有对应程序（如 mailto:/tel: 无邮件/拨号程序）时 openExternal 会异步失败：只记录，不让未处理的拒绝冒出来
          shell.openExternal(url).catch((e) => {
            const msg = e && e.message ? e.message : String(e);
            console.error('[zbswork] 交系统程序打开失败：', url, msg);
            faultLog.log('external-open-failed', { url, message: msg });
          });
          return { action: 'deny' };
        }
        return { action: 'deny' }; // R2 重复/空链接 或 R3 其他协议：什么都不发生，绝不 shell.openExternal
      });
      win.webContents.on('did-create-window', (child) => hardenWindow(child));
    }

    function showErrorPage(errorCode) {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      clearPendingTimers();
      navStartedAt = null;
      mainWindow.loadFile(path.join(__dirname, 'error.html'), {
        query: { code: String(errorCode || '') },
      }).catch(() => {});
    }

    function handleCrash(reason) {
      crashCount += 1;
      if (crashCount >= 3) {
        showErrorPage(reason);
        return;
      }
      if (crashTimer) clearTimeout(crashTimer);
      crashTimer = setTimeout(() => {
        crashTimer = null;
        goServer();
      }, 1000);
    }

    // 启动白屏探测自救（BUG-10 壳侧）：服务器页 did-finish-load 后延迟探测 #root 是否为空，
    // 仍为空且未超次数上限时清 HTTP 缓存并重载一次，记录至本地故障日志
    function scheduleBlankScreenCheck(loadedUrl) {
      if (blankCheckTimer) { clearTimeout(blankCheckTimer); blankCheckTimer = null; }
      blankCheckTimer = setTimeout(async () => {
        blankCheckTimer = null;
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
        if (isUnresponsive) return;
        let currentUrl = '';
        try { currentUrl = mainWindow.webContents.getURL(); } catch (_e) { return; }
        if (!isSameOrigin(currentUrl, config.serverUrl)) return;
        let snap = null;
        try {
          snap = await mainWindow.webContents.executeJavaScript(`(() => {
            const root = document.getElementById('root');
            const body = document.body;
            return {
              hasRoot: Boolean(root),
              rootChildCount: root ? root.childElementCount : 0,
              rootTextLength: root ? (root.textContent || '').trim().length : 0,
              bodyChildCount: body ? body.childElementCount : 0,
              bodyTextLength: body ? (body.textContent || '').trim().length : 0,
            };
          })()`, true);
        } catch (_e) {
          return;
        }
        if (!isBlankDomSnapshot(snap)) {
          blankRecoveryCount = 0;
          return;
        }
        if (shouldRecoverBlankScreen(blankRecoveryCount, MAX_BLANK_RECOVERIES)) {
          blankRecoveryCount += 1;
          faultLog.log('blank-screen-recovery', {
            attempt: blankRecoveryCount,
            max: MAX_BLANK_RECOVERIES,
            url: currentUrl || loadedUrl,
          });
          try {
            await mainWindow.webContents.session.clearCache();
          } catch (_e) { /* 清缓存失败仍尝试无缓存重载 */ }
          if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
          mainWindow.webContents.reloadIgnoringCache();
        } else {
          faultLog.log('blank-screen-give-up', {
            attempts: blankRecoveryCount,
            url: currentUrl || loadedUrl,
          });
        }
      }, BLANK_CHECK_DELAY_MS);
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
      mainWindow.on('closed', () => {
        clearPendingTimers();
        isUnresponsive = false;
        navStartedAt = null;
        mainWindow = null;
        closeFindWindow();
      });

      // 统一加固：拦危险键 + 弹窗路由（弹窗带显式安全参数，不带 preload）+ 子窗口递归
      hardenWindow(mainWindow, { parent: mainWindow, width: 720, height: 800 });

      // 主窗口专属：mapShortcut（重载/缩放/全屏/后退/查找/收查找条）。危险键拦截在 hardenWindow 里。
      mainWindow.webContents.on('before-input-event', (event, input) => {
        const action = mapShortcut(input, process.platform);
        if (action === 'reload') {
          event.preventDefault();
          if (forceCrash.isPending()) {
            forceCrash.upgradePendingToReload('user-reload-while-force-crashing');
            return;
          }
          const wc = mainWindow.webContents;
          let currentUrl = '';
          try { currentUrl = wc.getURL(); } catch (_e) { currentUrl = ''; }
          const decision = decideReloadAction({ isUnresponsive, currentUrl });
          if (decision === 'force-crash-and-go-server') {
            forceReloadServer('user-reload-while-unresponsive');
          } else if (decision === 'stop-and-go-server') {
            if (wc.isLoading()) {
              try { wc.stop(); } catch (_e) { /* 忽略 */ }
            }
            goServer();
          } else {
            wc.reload();
          }
        } else if (action === 'zoomIn' || action === 'zoomOut') {
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

      mainWindow.webContents.on('render-process-gone', (_e, details) => {
        const reason = details && details.reason ? details.reason : 'unknown';
        const exitCode = details && typeof details.exitCode === 'number' ? details.exitCode : null;
        if (forceCrash.onRenderProcessGone({ reason, exitCode })) {
          return;
        }
        isUnresponsive = false;
        faultLog.log('render-process-gone', { reason, exitCode });
        handleCrash(reason);
      });

      mainWindow.webContents.on('unresponsive', () => {
        if (forceCrash.isPending()) return;
        isUnresponsive = true;
        faultLog.log('unresponsive', { crashCount });
        if (crashTimer) clearTimeout(crashTimer);
        crashTimer = setTimeout(() => {
          crashTimer = null;
          if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
          if (!isUnresponsive || forceCrash.isPending()) return;
          crashCount += 1;
          if (crashCount >= 3) {
            isUnresponsive = false;
            clearPendingTimers();
            forceCrash.trigger('error-unresponsive', `unresponsive-give-up-${crashCount}`);
            return;
          }
          forceReloadServer('unresponsive-timeout');
        }, UNRESPONSIVE_RECOVER_MS);
      });

      mainWindow.webContents.on('responsive', () => {
        const wasUnresponsive = isUnresponsive;
        const cancelledTimer = Boolean(crashTimer);
        isUnresponsive = false;
        if (crashTimer) { clearTimeout(crashTimer); crashTimer = null; }
        faultLog.log('responsive', { wasUnresponsive, cancelledTimer });
      });

      mainWindow.webContents.on('did-start-loading', () => {
        if (blankCheckTimer) { clearTimeout(blankCheckTimer); blankCheckTimer = null; }
      });

      mainWindow.webContents.on('did-finish-load', () => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
        if (navTimeoutTimer) { clearTimeout(navTimeoutTimer); navTimeoutTimer = null; }
        navStartedAt = null;
        isUnresponsive = false;
        const currentUrl = mainWindow.webContents.getURL();
        // 自动重载成功（回到严格同源服务器页面）→ 崩溃计数清零 + 延迟白屏探测
        if (isSameOrigin(currentUrl, config.serverUrl)) {
          crashCount = 0;
          scheduleBlankScreenCheck(currentUrl);
        }
      });

      mainWindow.webContents.on('did-fail-load', (_e, errorCode, desc, url, isMainFrame) => {
        if (forceCrash.isPending()) {
          if (errorCode !== -3) {
            faultLog.log('did-fail-load', {
              errorCode,
              errorDescription: desc,
              url,
              isMainFrame,
              ignored: 'force-crash-pending',
            });
          }
          return;
        }
        if (errorCode !== -3) {
          faultLog.log('did-fail-load', { errorCode, errorDescription: desc, url, isMainFrame });
        }
        if (isMainFrame && navTimeoutTimer) {
          clearTimeout(navTimeoutTimer);
          navTimeoutTimer = null;
          navStartedAt = null;
        }
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

    // 出错页的 retry 只认主窗口；打破 isLoading() 死扣：手动重试或卡住超阈值时先 stop() 再 goServer()
    ipcMain.on('zbswork:retry', (event, opts) => {
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
      if (forceCrash.isPending()) return;
      const wc = mainWindow.webContents;
      const elapsed = navStartedAt === null ? null : Date.now() - navStartedAt;
      const decision = decideRetryAction({
        isLoading: wc.isLoading(),
        elapsedSinceNavStartMs: elapsed,
        retryStopAfterMs: RETRY_STOP_AFTER_MS,
        manual: Boolean(opts && opts.manual),
      });
      if (decision === 'wait') return;
      if (decision === 'stop-and-go') {
        try { wc.stop(); } catch (_e) { /* 忽略 */ }
      }
      goServer();
    });

    // 证书错误：不调 preventDefault、不调 callback，保持 Electron 默认（拒绝）。
    // 子资源证书问题也会触发本事件，不能在这里切出错页；
    // 主框架证书错随后会走 did-fail-load（-202 类错误码），由那边统一切出错页。
    app.on('certificate-error', () => {});

    app.whenReady().then(() => {
      installPermissionHandler();
      installApplicationMenu();
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

      // 下载提示：存到系统下载目录，重名按 "名 (1).扩展名" 递增；并发同名用内存预留集合防相互覆盖
      // completedDownloads：已完成下载的 savePath 白名单，"打开文件夹"只认这里面的路径，
      // 网页伪造消息不能借这条通道打开任意路径
      const completedDownloads = new Set();
      const reservedDownloads = new Set();
      session.defaultSession.on('will-download', (_e, item) => {
        const dir = app.getPath('downloads');
        const { savePath: rawSavePath, release } = reserveDownloadPath(
          dir,
          item.getFilename(),
          reservedDownloads,
          (p) => fs.existsSync(p),
          process.platform,
        );
        const savePath = path.normalize(rawSavePath);
        item.setSavePath(savePath);
        item.once('done', (_ev, state) => {
          release();
          // 用户主动取消：不弹"下载失败"系统通知与窗口提示条
          if (state === 'cancelled') return;
          if (state === 'completed') {
            completedDownloads.add(savePath);
            const n = new Notification({ title: '下载完成', body: path.basename(savePath) });
            n.on('click', () => shell.showItemInFolder(savePath));
            n.show();
          } else {
            new Notification({ title: '下载失败', body: item.getFilename() }).show();
          }
          // 窗口内也弹提示条（preload 里渲染）；成功才带 savePath 供"打开文件夹"用
          const toast = downloadToast(state, path.basename(savePath));
          if (toast && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('zbs:download-done', {
              ...toast,
              savePath: state === 'completed' ? savePath : null,
            });
          }
        });
      });

      // 提示条里"打开文件夹"按钮：只认主窗口发来的、且路径在完成白名单里
      ipcMain.on('zbs:open-download', (event, savePath) => {
        if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
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
