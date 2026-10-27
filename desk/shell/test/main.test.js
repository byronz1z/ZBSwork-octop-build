'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_TEST = '1';
const { routeWindowOpen, shouldBlockInput, shouldShowErrorPage } = require('../src/main.js');

const SERVER = 'https://zbsworkoctoplink.api.zhangbaoshan.cn';

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

test('shouldBlockInput: Ctrl+W / Ctrl+Shift+I / F12 -> true', () => {
  assert.strictEqual(shouldBlockInput({ key: 'w', control: true, shift: false }), true);
  assert.strictEqual(shouldBlockInput({ key: 'W', control: true, shift: false }), true);
  assert.strictEqual(shouldBlockInput({ key: 'i', control: true, shift: true }), true);
  assert.strictEqual(shouldBlockInput({ key: 'F12', control: false, shift: false }), true);
});

test('shouldBlockInput: F5 / F11 / Ctrl+R -> false', () => {
  assert.strictEqual(shouldBlockInput({ key: 'F5', control: false, shift: false }), false);
  assert.strictEqual(shouldBlockInput({ key: 'F11', control: false, shift: false }), false);
  assert.strictEqual(shouldBlockInput({ key: 'r', control: true, shift: false }), false);
});

test('shouldShowErrorPage: -3 false；主框架 -105/-106/-200 true；子框架一律 false', () => {
  assert.strictEqual(shouldShowErrorPage(-3, true), false);
  assert.strictEqual(shouldShowErrorPage(-105, true), true);
  assert.strictEqual(shouldShowErrorPage(-106, true), true);
  assert.strictEqual(shouldShowErrorPage(-200, true), true);
  assert.strictEqual(shouldShowErrorPage(-200, false), false);
  assert.strictEqual(shouldShowErrorPage(-105, false), false);
});
