'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ALLOWED_PERMISSIONS,
  isPermissionAllowed,
  isErrorPageUrl,
  decideReloadAction,
  decideRetryAction,
  isBlankDomSnapshot,
  shouldRecoverBlankScreen,
  buildApplicationMenuTemplate,
  createForceCrashCoordinator,
} = require('../src/lib/recovery');
const {
  sanitizeLogUrl,
  sanitizeLogData,
  createFaultLogger,
} = require('../src/lib/faultLog');

const SERVER = 'https://zbsworkoctoplink.api.zhangbaoshan.cn:8443';

// ---- BUG-02 & BUG-03: isErrorPageUrl / decideReloadAction ----
test('isErrorPageUrl: 仅识别本地 file://.../error.html（含 query）', () => {
  assert.strictEqual(isErrorPageUrl('file:///D:/desk/shell/src/error.html?code=-106'), true);
  assert.strictEqual(isErrorPageUrl('file:///Applications/ZBSwork.app/src/error.html'), true);
  assert.strictEqual(isErrorPageUrl(SERVER + '/error.html'), false);
  assert.strictEqual(isErrorPageUrl(SERVER + '/chat'), false);
  assert.strictEqual(isErrorPageUrl(''), false);
});

test('decideReloadAction: 无响应优先强杀重建；出错页重连服务器；正常页普通 reload', () => {
  assert.strictEqual(
    decideReloadAction({ isUnresponsive: true, currentUrl: SERVER + '/chat' }),
    'force-crash-and-go-server');
  assert.strictEqual(
    decideReloadAction({ isUnresponsive: true, currentUrl: 'file:///D:/src/error.html' }),
    'force-crash-and-go-server');
  assert.strictEqual(
    decideReloadAction({ isUnresponsive: false, currentUrl: 'file:///D:/src/error.html?code=-105' }),
    'stop-and-go-server');
  assert.strictEqual(
    decideReloadAction({ isUnresponsive: false, currentUrl: SERVER + '/chat' }),
    'reload');
});

// ---- BUG-03: decideRetryAction 打破 isLoading() 死扣 ----
test('decideRetryAction: 未加载 -> go；手动点击加载中 -> stop-and-go；自动重试超阈值/无起始时间 -> stop-and-go；刚发起加载 -> wait', () => {
  assert.strictEqual(decideRetryAction({ isLoading: false, elapsedSinceNavStartMs: 100, manual: false }), 'go');
  assert.strictEqual(decideRetryAction({ isLoading: true, elapsedSinceNavStartMs: 200, manual: true }), 'stop-and-go');
  assert.strictEqual(decideRetryAction({ isLoading: true, elapsedSinceNavStartMs: null, manual: false }), 'stop-and-go');
  assert.strictEqual(decideRetryAction({ isLoading: true, elapsedSinceNavStartMs: 8000, retryStopAfterMs: 8000, manual: false }), 'stop-and-go');
  assert.strictEqual(decideRetryAction({ isLoading: true, elapsedSinceNavStartMs: 1500, retryStopAfterMs: 8000, manual: false }), 'wait');
});

// ---- BUG-09: macOS 菜单模板 ----
test('buildApplicationMenuTemplate: win32/linux 返回 null，darwin 含最小应用菜单与标准 Edit 角色', () => {
  assert.strictEqual(buildApplicationMenuTemplate('win32'), null);
  assert.strictEqual(buildApplicationMenuTemplate('linux'), null);

  const tpl = buildApplicationMenuTemplate('darwin', { appName: 'ZBSwork', onAbout: () => {} });
  assert.ok(Array.isArray(tpl) && tpl.length === 2);
  const appMenu = tpl[0];
  const editMenu = tpl[1];
  // 不可含 role:'quit'，避免原生菜单绕过 shouldBlockInput 的 Cmd+Q 防误退
  assert.strictEqual(appMenu.submenu.some((item) => item.role === 'quit'), false);
  const editRoles = editMenu.submenu.map((item) => item.role).filter(Boolean);
  for (const required of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.ok(editRoles.includes(required), `macOS Edit 菜单缺少角色：${required}`);
  }
});

// ---- BUG-10: 启动白屏探测自救 ----
test('isBlankDomSnapshot & shouldRecoverBlankScreen: 准确识别空 #root，不误杀已渲染或非 SPA 页面，受次数上限保护', () => {
  assert.strictEqual(isBlankDomSnapshot({
    hasRoot: true, rootChildCount: 0, rootTextLength: 0, bodyChildCount: 1, bodyTextLength: 0,
  }), true);
  assert.strictEqual(isBlankDomSnapshot({
    hasRoot: true, rootChildCount: 1, rootTextLength: 0, bodyChildCount: 1, bodyTextLength: 0,
  }), false);
  assert.strictEqual(isBlankDomSnapshot({
    hasRoot: true, rootChildCount: 0, rootTextLength: 5, bodyChildCount: 1, bodyTextLength: 5,
  }), false);
  // 非 SPA 页（如冒烟测试页）无 #root 但 body 有内容 -> 不算白屏
  assert.strictEqual(isBlankDomSnapshot({
    hasRoot: false, rootChildCount: 0, rootTextLength: 0, bodyChildCount: 3, bodyTextLength: 10,
  }), false);
  // 无 #root 且 body 完全空 -> 算白屏
  assert.strictEqual(isBlankDomSnapshot({
    hasRoot: false, rootChildCount: 0, rootTextLength: 0, bodyChildCount: 0, bodyTextLength: 0,
  }), true);

  assert.strictEqual(shouldRecoverBlankScreen(0, 1), true);
  assert.strictEqual(shouldRecoverBlankScreen(1, 1), false);
});

// ---- BUG-11: 权限白名单（含 fullscreen）与严格同源校验 ----
test('isPermissionAllowed: 同源放行 fullscreen 等白名单权限，外站及伪造前缀一律拒绝', () => {
  assert.ok(ALLOWED_PERMISSIONS.includes('fullscreen'));
  assert.strictEqual(isPermissionAllowed('fullscreen', SERVER + '/chat', SERVER), true);
  assert.strictEqual(isPermissionAllowed('notifications', SERVER, SERVER), true);
  assert.strictEqual(isPermissionAllowed('media', SERVER + '/voice', SERVER), true);
  assert.strictEqual(isPermissionAllowed('fullscreen', SERVER + '@evil.com/chat', SERVER), false);
  assert.strictEqual(isPermissionAllowed('notifications', 'https://evil.com', SERVER), false);
  assert.strictEqual(isPermissionAllowed('geolocation', SERVER + '/chat', SERVER), false);
  assert.strictEqual(isPermissionAllowed('fullscreen', 'about:blank', SERVER), false);
  assert.strictEqual(isPermissionAllowed('fullscreen', null, SERVER), false);
});

// ---- BUG-11: 轻量本地故障日志脱敏与截断 ----
test('faultLog: 脱敏 URL query/token/密码，超限自动截断保留最新日志', () => {
  assert.strictEqual(
    sanitizeLogUrl('https://user:pass@zbs.example.com:8443/chat?token=secret123#access_token=abc'),
    'https://zbs.example.com:8443/chat');
  assert.strictEqual(
    sanitizeLogUrl('file:///D:/secret-dir/error.html?code=-106&token=xyz'),
    'file:///error.html');

  const safe = sanitizeLogData({
    url: SERVER + '/callback?code=123&token=secret',
    accessToken: 'raw-token',
    password: 'pw',
    note: 'Bearer abcdef123456',
    errorCode: -106,
  });
  assert.strictEqual(safe.url, SERVER + '/callback');
  assert.strictEqual(safe.accessToken, '[REDACTED]');
  assert.strictEqual(safe.password, '[REDACTED]');
  assert.strictEqual(safe.note, '[REDACTED]');
  assert.strictEqual(safe.errorCode, -106);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbswork-log-test-'));
  try {
    const logPath = path.join(tmpDir, 'logs', 'main.log');
    const logger = createFaultLogger(logPath, { maxBytes: 512, keepBytes: 256 });
    for (let i = 0; i < 30; i += 1) {
      logger.log('did-fail-load', { seq: i, url: SERVER + '/p?token=should-not-appear' });
    }
    const content = fs.readFileSync(logPath, 'utf8');
    const size = Buffer.byteLength(content, 'utf8');
    assert.ok(size <= 512, `日志未截断：size=${size}`);
    assert.ok(content.includes('"seq":29'), '截断后丢失最新一条日志');
    assert.strictEqual(content.includes('should-not-appear'), false, '日志泄露了 query 中的敏感参数');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---- BUG-02 Electron 45 异步 forcefullyCrashRenderer() 竞态状态机 ----
test('createForceCrashCoordinator: 异步延迟触发 render-process-gone 后再执行 goServer（reload 路径）', async () => {
  const events = [];
  let crashCalls = 0;
  let reloadCalls = 0;
  let errorCalls = 0;
  let scheduledFallback = null;
  let clearedFallback = 0;

  const coord = createForceCrashCoordinator({
    fallbackMs: 6000,
    forcefullyCrashRenderer: () => {
      crashCalls += 1;
      events.push('forcefullyCrashRenderer');
    },
    onReload: () => {
      reloadCalls += 1;
      events.push('goServer');
    },
    onErrorUnresponsive: () => {
      errorCalls += 1;
      events.push('showErrorPage');
    },
    onLog: (ev, details) => events.push(`log:${ev}:${details && (details.trigger || details.handled || details.pendingAfterForceCrash || '')}`),
    setTimeoutFn: (fn, ms) => {
      scheduledFallback = { fn, ms };
      return scheduledFallback;
    },
    clearTimeoutFn: (t) => {
      if (t === scheduledFallback) {
        clearedFallback += 1;
        scheduledFallback = null;
      }
    },
  });

  coord.trigger('reload', 'unresponsive-timeout');
  assert.strictEqual(crashCalls, 1);
  // 关键：同步阶段绝不调 goServer，避免导航打到垂死的旧渲染进程
  assert.strictEqual(reloadCalls, 0);
  assert.strictEqual(errorCalls, 0);
  assert.strictEqual(coord.getPendingAction(), 'reload');
  assert.ok(scheduledFallback && scheduledFallback.ms === 6000);

  // 模拟 Electron 45 异步杀旧进程延迟后触发 render-process-gone
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(reloadCalls, 0);
  const handled = coord.onRenderProcessGone({ reason: 'killed', exitCode: 1 });
  assert.strictEqual(handled, true);
  assert.strictEqual(reloadCalls, 1);
  assert.strictEqual(errorCalls, 0);
  assert.strictEqual(coord.isPending(), false);
  assert.strictEqual(clearedFallback, 1);
  assert.deepStrictEqual(
    events.filter((e) => e === 'forcefullyCrashRenderer' || e === 'goServer'),
    ['forcefullyCrashRenderer', 'goServer'],
  );

  // 后续若再发生非预期 render-process-gone，不再拦截
  assert.strictEqual(coord.onRenderProcessGone({ reason: 'crashed', exitCode: -1 }), false);
});

test('createForceCrashCoordinator: crashCount >= 3 放弃路径等 render-process-gone 后再切 error-unresponsive', () => {
  let reloadCalls = 0;
  let errorCalls = 0;
  let timer = null;

  const coord = createForceCrashCoordinator({
    fallbackMs: 6000,
    forcefullyCrashRenderer: () => {},
    onReload: () => { reloadCalls += 1; },
    onErrorUnresponsive: () => { errorCalls += 1; },
    setTimeoutFn: (fn) => { timer = fn; return fn; },
    clearTimeoutFn: () => { timer = null; },
  });

  coord.trigger('error-unresponsive', 'unresponsive-give-up-3');
  assert.strictEqual(errorCalls, 0);
  assert.strictEqual(coord.getPendingAction(), 'error-unresponsive');
  assert.ok(typeof timer === 'function');

  assert.strictEqual(coord.onRenderProcessGone({ reason: 'killed', exitCode: 1 }), true);
  assert.strictEqual(errorCalls, 1);
  assert.strictEqual(reloadCalls, 0);
  assert.strictEqual(coord.isPending(), false);
  assert.strictEqual(timer, null);
});

test('createForceCrashCoordinator: render-process-gone 未到达时由兜底定时器触发；同步抛错时立即清理并执行；clear() 取消兜底', () => {
  let reloadCalls = 0;
  let errorCalls = 0;
  let pendingTimerFn = null;

  const coord = createForceCrashCoordinator({
    fallbackMs: 6000,
    forcefullyCrashRenderer: () => {},
    onReload: () => { reloadCalls += 1; },
    onErrorUnresponsive: () => { errorCalls += 1; },
    setTimeoutFn: (fn) => { pendingTimerFn = fn; return fn; },
    clearTimeoutFn: () => { pendingTimerFn = null; },
  });

  // 1) 兜底超时路径
  coord.trigger('reload', 'unresponsive-timeout');
  assert.strictEqual(reloadCalls, 0);
  pendingTimerFn();
  assert.strictEqual(reloadCalls, 1);
  assert.strictEqual(coord.isPending(), false);

  // 2) clear()（如窗口 closed）取消兜底定时器且不执行回调
  coord.trigger('error-unresponsive', 'unresponsive-give-up-3');
  assert.ok(typeof pendingTimerFn === 'function');
  coord.clear();
  assert.strictEqual(coord.isPending(), false);
  assert.strictEqual(pendingTimerFn, null);
  assert.strictEqual(errorCalls, 0);

  // 3) forcefullyCrashRenderer 同步抛错时立即清理并执行目标动作，不挂兜底定时器
  const throwingCoord = createForceCrashCoordinator({
    fallbackMs: 6000,
    forcefullyCrashRenderer: () => { throw new Error('renderer already gone'); },
    onReload: () => { reloadCalls += 1; },
    onErrorUnresponsive: () => { errorCalls += 1; },
    setTimeoutFn: () => { throw new Error('同步抛错不应再挂兜底定时器'); },
    clearTimeoutFn: () => {},
  });
  throwingCoord.trigger('reload', 'user-reload-while-unresponsive');
  assert.strictEqual(reloadCalls, 2);
  assert.strictEqual(throwingCoord.isPending(), false);
});

