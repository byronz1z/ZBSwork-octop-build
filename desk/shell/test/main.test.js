'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_TEST = '1';
const { routeWindowOpen, shouldBlockInput, shouldShowErrorPage } = require('../src/main.js');
const { isSameOrigin, isSamePageUrl } = require('../src/lib/windowOpen');

const SERVER = 'https://zbsworkoctoplink.api.zhangbaoshan.cn:8443';

test('routeWindowOpen: 严格同源 -> child', () => {
  assert.strictEqual(routeWindowOpen(SERVER + '/oauth/callback', SERVER), 'child');
});

test('routeWindowOpen: 外站 -> external', () => {
  assert.strictEqual(routeWindowOpen('https://example.com/x', SERVER), 'external');
});

test('routeWindowOpen: serverUrl 为 https://127.0.0.1:18443 时严格同源 -> child，不同协议 -> external', () => {
  const local = 'https://127.0.0.1:18443';
  assert.strictEqual(routeWindowOpen(local + '/page', local), 'child');
  assert.strictEqual(routeWindowOpen('http://127.0.0.1:18443/page', local), 'external');
});

test('routeWindowOpen & isSameOrigin: 防范 https://域名:8443@evil.com 伪造前缀绕过（BUG-11）', () => {
  const spoofAt = SERVER + '@evil.com/phish';
  assert.strictEqual(isSameOrigin(spoofAt, SERVER), false);
  // 不是同源，绝不打开为壳内子窗口（按外站走系统浏览器，或非法 URL 直接 deny）
  assert.strictEqual(routeWindowOpen(spoofAt, SERVER, 'foreground-tab'), 'external');
  assert.strictEqual(routeWindowOpen(spoofAt, SERVER), 'external');

  const spoofSub = SERVER + '.evil.com/phish';
  assert.strictEqual(isSameOrigin(spoofSub, SERVER), false);
  assert.strictEqual(routeWindowOpen(spoofSub, SERVER, 'foreground-tab'), 'deny');

  // 即使不带端口的 serverUrl，也要防前缀域名绕过（https://example.com.evil.com）
  assert.strictEqual(isSameOrigin('https://example.com.evil.com/x', 'https://example.com'), false);
  assert.strictEqual(routeWindowOpen('https://example.com.evil.com/x', 'https://example.com', 'foreground-tab'), 'external');
});

test('routeWindowOpen: 脚本弹窗（new-window）about:blank / 空串 -> child（R1 连接器/OAuth 授权不受影响）', () => {
  assert.strictEqual(routeWindowOpen('about:blank', SERVER, 'new-window'), 'child');
  assert.strictEqual(routeWindowOpen('', SERVER, 'new-window'), 'child');
  assert.strictEqual(routeWindowOpen(SERVER + '/chat/1', SERVER, 'new-window', SERVER + '/chat/1'), 'child');
});

test('routeWindowOpen: 脚本弹窗（new-window）第三方授权站 -> child', () => {
  assert.strictEqual(routeWindowOpen('https://open.feishu.cn/x', SERVER, 'new-window'), 'child');
});

test('routeWindowOpen: 链接新开（foreground-tab）外站 -> external', () => {
  assert.strictEqual(routeWindowOpen('https://example.com/x', SERVER, 'foreground-tab'), 'external');
});

test('routeWindowOpen: 链接新开（foreground-tab）同源不同页 -> child', () => {
  assert.strictEqual(routeWindowOpen(SERVER + '/experts', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'child');
});

test('routeWindowOpen: R2 拦截空链接与无意义跳向完全相同当前页 URL 的重复子窗口（BUG-11）', () => {
  assert.strictEqual(routeWindowOpen('', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'deny');
  assert.strictEqual(routeWindowOpen('   ', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'deny');
  assert.strictEqual(routeWindowOpen('about:blank', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'deny');
  assert.strictEqual(routeWindowOpen('about:blank', SERVER), 'deny');
  assert.strictEqual(routeWindowOpen(SERVER + '/chat/1', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'deny');
  assert.strictEqual(routeWindowOpen(SERVER + '/chat/1#', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'deny');
  assert.strictEqual(routeWindowOpen(SERVER, SERVER, 'foreground-tab', SERVER + '/'), 'deny');
  // 带不同路径或有效锚点的同源页仍放行 child
  assert.strictEqual(routeWindowOpen(SERVER + '/chat/2', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'child');
  assert.strictEqual(routeWindowOpen(SERVER + '/chat/1#sec-2', SERVER, 'foreground-tab', SERVER + '/chat/1'), 'child');
  assert.strictEqual(isSamePageUrl(SERVER + '/a', SERVER + '/a#'), true);
  assert.strictEqual(isSamePageUrl(SERVER + '/a#1', SERVER + '/a#2'), false);
});

test('routeWindowOpen: 链接新开（foreground-tab）file: 协议 -> deny', () => {
  assert.strictEqual(routeWindowOpen('file:///D:/a.txt', SERVER, 'foreground-tab'), 'deny');
});

test('routeWindowOpen: 不传 disposition 时 javascript: -> deny', () => {
  assert.strictEqual(routeWindowOpen('javascript:alert(1)', SERVER), 'deny');
});

test('routeWindowOpen: mailto: 链接新开 -> external（r4 放行）', () => {
  assert.strictEqual(routeWindowOpen('mailto:a@b.com', SERVER, 'foreground-tab'), 'external');
});

test('routeWindowOpen: tel: 不传 disposition -> external（r4 放行）', () => {
  assert.strictEqual(routeWindowOpen('tel:13800000000', SERVER), 'external');
});

test('shouldBlockInput: win32 的 Ctrl+W / Ctrl+Shift+I / F12 -> true', () => {
  assert.strictEqual(shouldBlockInput({ key: 'w', control: true, shift: false }, 'win32'), true);
  assert.strictEqual(shouldBlockInput({ key: 'W', control: true, shift: false }, 'win32'), true);
  assert.strictEqual(shouldBlockInput({ key: 'i', control: true, shift: true }, 'win32'), true);
  assert.strictEqual(shouldBlockInput({ key: 'F12', control: false, shift: false }, 'win32'), true);
});

test('shouldBlockInput: darwin 的 Cmd+W / Cmd+Option+I / Cmd+Q -> true', () => {
  assert.strictEqual(shouldBlockInput({ key: 'w', meta: true, control: false, alt: false }, 'darwin'), true);
  assert.strictEqual(shouldBlockInput({ key: 'W', meta: true, control: false, alt: false }, 'darwin'), true);
  assert.strictEqual(shouldBlockInput({ key: 'i', meta: true, alt: true, control: false }, 'darwin'), true);
  assert.strictEqual(shouldBlockInput({ key: 'q', meta: true, control: false, alt: false }, 'darwin'), true);
  assert.strictEqual(shouldBlockInput({ key: 'Q', meta: true, control: false, alt: false }, 'darwin'), true);
});

test('shouldBlockInput: darwin 上 win32 组合键不屏蔽；Ctrl+Shift+I/F12 只在非 darwin', () => {
  // Mac 上 Ctrl+W 是普通组合，不拦（拦的是 Cmd+W）
  assert.strictEqual(shouldBlockInput({ key: 'w', control: true, meta: false }, 'darwin'), false);
  assert.strictEqual(shouldBlockInput({ key: 'r', control: true, meta: false }, 'darwin'), false);
  // F12 在 Mac 上也是 DevTools 键，统一屏蔽
  assert.strictEqual(shouldBlockInput({ key: 'F12' }, 'darwin'), true);
  assert.strictEqual(shouldBlockInput({ key: 'i', control: true, shift: true }, 'linux'), true);
});

test('shouldBlockInput: F5 / F11 / Ctrl+R -> false', () => {
  assert.strictEqual(shouldBlockInput({ key: 'F5', control: false, shift: false }, 'win32'), false);
  assert.strictEqual(shouldBlockInput({ key: 'F11', control: false, shift: false }, 'win32'), false);
  assert.strictEqual(shouldBlockInput({ key: 'r', control: true, shift: false }, 'win32'), false);
});

test('shouldShowErrorPage: -3 false；主框架 -105/-106/-200 true；子框架一律 false', () => {
  assert.strictEqual(shouldShowErrorPage(-3, true), false);
  assert.strictEqual(shouldShowErrorPage(-105, true), true);
  assert.strictEqual(shouldShowErrorPage(-106, true), true);
  assert.strictEqual(shouldShowErrorPage(-200, true), true);
  assert.strictEqual(shouldShowErrorPage(-200, false), false);
  assert.strictEqual(shouldShowErrorPage(-105, false), false);
});

test('config.json 默认地址：https、生产域名、显式端口 8443（10-28 真机测试发现 443 是路由器）', () => {
  const cfg = require('../src/config.json');
  const u = new URL(cfg.serverUrl);
  assert.strictEqual(u.protocol, 'https:');
  assert.strictEqual(u.hostname, 'zbsworkoctoplink.api.zhangbaoshan.cn');
  assert.strictEqual(u.port, '8443');
});
