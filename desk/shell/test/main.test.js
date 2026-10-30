'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_TEST = '1';
const { routeWindowOpen, shouldBlockInput, shouldShowErrorPage } = require('../src/main.js');

const SERVER = 'https://zbsworkoctoplink.api.zhangbaoshan.cn:8443';

test('routeWindowOpen: 同源前缀 -> child', () => {
  assert.strictEqual(routeWindowOpen(SERVER + '/oauth/callback', SERVER), 'child');
});

test('routeWindowOpen: 外站 -> external', () => {
  assert.strictEqual(routeWindowOpen('https://example.com/x', SERVER), 'external');
});

test('routeWindowOpen: serverUrl 为 https://127.0.0.1:18443 时同前缀 -> child', () => {
  const local = 'https://127.0.0.1:18443';
  assert.strictEqual(routeWindowOpen(local + '/page', local), 'child');
  assert.strictEqual(routeWindowOpen('http://127.0.0.1:18443/page', local), 'external');
});

test('routeWindowOpen: 脚本弹窗（new-window）about:blank -> child（连接器授权）', () => {
  assert.strictEqual(routeWindowOpen('about:blank', SERVER, 'new-window'), 'child');
});

test('routeWindowOpen: 脚本弹窗（new-window）第三方授权站 -> child', () => {
  assert.strictEqual(routeWindowOpen('https://open.feishu.cn/x', SERVER, 'new-window'), 'child');
});

test('routeWindowOpen: 链接新开（foreground-tab）外站 -> external', () => {
  assert.strictEqual(routeWindowOpen('https://example.com/x', SERVER, 'foreground-tab'), 'external');
});

test('routeWindowOpen: 链接新开（foreground-tab）同源 -> child', () => {
  assert.strictEqual(routeWindowOpen(SERVER + '/experts', SERVER, 'foreground-tab'), 'child');
});

test('routeWindowOpen: 链接新开（foreground-tab）file: 协议 -> deny', () => {
  assert.strictEqual(routeWindowOpen('file:///D:/a.txt', SERVER, 'foreground-tab'), 'deny');
});

test('routeWindowOpen: 不传 disposition 时 javascript: -> deny', () => {
  assert.strictEqual(routeWindowOpen('javascript:alert(1)', SERVER), 'deny');
});

test('routeWindowOpen: 不传 disposition 时 about:blank -> child', () => {
  assert.strictEqual(routeWindowOpen('about:blank', SERVER), 'child');
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
