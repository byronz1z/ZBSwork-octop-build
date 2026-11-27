'use strict';
const { parseOrigin } = require('./windowOpen');

// 权限白名单（含 fullscreen）
const ALLOWED_PERMISSIONS = [
  'notifications',
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
];

function isPermissionAllowed(permission, requestingUrlOrOrigin, serverUrl) {
  const origin = parseOrigin(requestingUrlOrOrigin);
  const serverOrigin = parseOrigin(serverUrl);
  return origin !== null && serverOrigin !== null && origin === serverOrigin && ALLOWED_PERMISSIONS.includes(permission);
}

// 识别当前是否停在本地 error.html 出错页
function isErrorPageUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && /(?:^|\/)error\.html$/i.test(u.pathname);
  } catch (_e) {
    return false;
  }
}

// 用户按 F5 / Ctrl+R / Cmd+R 时的处理决策（BUG-02 + BUG-03）：
// - 无响应态：先 forcefullyCrashRenderer() 再 loadURL(serverUrl)
// - 本地出错页：直接中止卡住加载并重连 serverUrl（不刷新 error.html 本身）
// - 正常页：普通 reload
function decideReloadAction({ isUnresponsive, currentUrl }) {
  if (isUnresponsive) return 'force-crash-and-go-server';
  if (isErrorPageUrl(currentUrl)) return 'stop-and-go-server';
  return 'reload';
}

// zbswork:retry 打破 isLoading() 死锁决策（BUG-03）：
// - 未在加载：直接 goServer
// - 正在加载且用户手动点击：立即 stop() 后 goServer
// - 正在加载且自动重试：若已卡住达到阈值（或无有效起始时间），stop() 后 goServer；否则等待本次加载完成
function decideRetryAction({ isLoading, elapsedSinceNavStartMs, retryStopAfterMs = 8000, manual = false }) {
  if (!isLoading) return 'go';
  if (manual) return 'stop-and-go';
  if (typeof elapsedSinceNavStartMs !== 'number' || !Number.isFinite(elapsedSinceNavStartMs)) {
    return 'stop-and-go';
  }
  if (elapsedSinceNavStartMs >= retryStopAfterMs) return 'stop-and-go';
  return 'wait';
}

// 启动白屏探测判断（BUG-10 壳侧）：
// 若页面含 #root，则 #root 无子节点且无文本视为白屏；
// 若非 SPA 页（无 #root），仅在 body 也完全为空时视为白屏（避免误杀普通静态页/测试页）。
function isBlankDomSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.hasRoot) {
    return snapshot.rootChildCount === 0 && snapshot.rootTextLength === 0;
  }
  return snapshot.bodyChildCount === 0 && snapshot.bodyTextLength === 0;
}

function shouldRecoverBlankScreen(attempts, maxAttempts = 1) {
  return attempts < maxAttempts;
}

// 平台应用菜单模板（BUG-09）：
// - darwin：保留最小应用菜单与标准 Edit 角色（undo/redo/cut/copy/paste/selectAll），恢复 Cmd+C/V/X/A/Z；
//   不放 role:'quit'（避免原生菜单绕过 shouldBlockInput 对 Cmd+Q 的防误退拦截）。
// - win32 / linux：返回 null（维持无菜单栏）。
function buildApplicationMenuTemplate(platform, options = {}) {
  if (platform !== 'darwin') return null;
  const appName = options.appName || 'ZBSwork';
  const appSubmenu = [];
  if (typeof options.onAbout === 'function') {
    appSubmenu.push({ label: `关于 ${appName}`, click: options.onAbout });
    appSubmenu.push({ type: 'separator' });
  }
  appSubmenu.push(
    { role: 'hide', label: `隐藏 ${appName}` },
    { role: 'hideOthers', label: '隐藏其他' },
    { role: 'unhide', label: '全部显示' },
  );
  return [
    { label: appName, submenu: appSubmenu },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
      ],
    },
  ];
}

// Electron 45 中 webContents.forcefullyCrashRenderer() 为异步杀旧渲染进程（实测可达数秒）：
// 若调用后立即同步 loadURL / loadFile，新导航会打到垂死旧进程并被中止为 ERR_FAILED，随后
// render-process-gone 抵达导致窗口永久白屏。
// 本状态机在触发强杀时登记 pendingAfterForceCrash（'reload' | 'error-unresponsive'）并挂兜底定时器，
// 待 render-process-gone 命中（或兜底超时 / 同步抛错）后再执行重建导航或切出错页。
function createForceCrashCoordinator({
  fallbackMs = 6000,
  forcefullyCrashRenderer,
  onReload,
  onErrorUnresponsive,
  onLog = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let pendingAfterForceCrash = null;
  let fallbackTimer = null;

  function clear() {
    pendingAfterForceCrash = null;
    if (fallbackTimer) {
      clearTimeoutFn(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function executePending(triggerSource) {
    const action = pendingAfterForceCrash;
    if (!action) return false;
    clear();
    onLog('force-crash-resume', { action, trigger: triggerSource });
    if (action === 'reload') {
      onReload();
    } else if (action === 'error-unresponsive') {
      onErrorUnresponsive();
    }
    return true;
  }

  function trigger(action, reason) {
    if (action !== 'reload' && action !== 'error-unresponsive') {
      throw new Error(`未知强杀后动作：${String(action)}`);
    }
    if (fallbackTimer) {
      clearTimeoutFn(fallbackTimer);
      fallbackTimer = null;
    }
    pendingAfterForceCrash = action;
    onLog(action === 'reload' ? 'force-reload' : 'unresponsive-give-up', {
      reason,
      pendingAfterForceCrash: action,
    });
    try {
      forcefullyCrashRenderer();
    } catch (e) {
      onLog('force-crash-error', {
        action,
        reason,
        message: e && e.message ? e.message : String(e),
      });
      executePending('sync-error');
      return;
    }
    // 若 forcefullyCrashRenderer() 同步触发了 render-process-gone，pendingAfterForceCrash 已被消费
    if (pendingAfterForceCrash === action) {
      fallbackTimer = setTimeoutFn(() => {
        fallbackTimer = null;
        executePending('fallback-timeout');
      }, fallbackMs);
    }
  }

  function upgradePendingToReload(reason) {
    if (pendingAfterForceCrash === 'error-unresponsive') {
      pendingAfterForceCrash = 'reload';
      onLog('force-crash-upgrade', { reason, pendingAfterForceCrash });
    }
  }

  function onRenderProcessGone({ reason, exitCode } = {}) {
    if (!pendingAfterForceCrash) return false;
    const nextAction = pendingAfterForceCrash;
    onLog('render-process-gone', {
      reason,
      exitCode,
      handled: 'pending-force-crash',
      nextAction,
    });
    executePending('render-process-gone');
    return true;
  }

  return {
    getPendingAction: () => pendingAfterForceCrash,
    isPending: () => pendingAfterForceCrash !== null,
    trigger,
    upgradePendingToReload,
    onRenderProcessGone,
    clear,
  };
}

module.exports = {
  ALLOWED_PERMISSIONS,
  isPermissionAllowed,
  isErrorPageUrl,
  decideReloadAction,
  decideRetryAction,
  isBlankDomSnapshot,
  shouldRecoverBlankScreen,
  buildApplicationMenuTemplate,
  createForceCrashCoordinator,
};
