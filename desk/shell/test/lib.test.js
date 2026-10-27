'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { mapShortcut } = require('../src/lib/shortcuts');
const { clampBounds } = require('../src/lib/windowState');
const { uniqueDownloadPath } = require('../src/lib/downloads');

// ---- mapShortcut（第 4 节样例 + Escape + 无关键） ----
test('mapShortcut: Ctrl+F win32 -> find', () => {
  assert.strictEqual(
    mapShortcut({ key: 'F', control: true, meta: false, alt: false, shift: false, type: 'keyDown' }, 'win32'),
    'find');
});
test('mapShortcut: Cmd+f darwin -> find', () => {
  assert.strictEqual(
    mapShortcut({ key: 'f', control: false, meta: true, alt: false, shift: false, type: 'keyDown' }, 'darwin'),
    'find');
});
test('mapShortcut: Alt+Left -> back', () => {
  assert.strictEqual(
    mapShortcut({ key: 'Left', alt: true, control: false, meta: false, shift: false, type: 'keyDown' }, 'win32'),
    'back');
});
test('mapShortcut: Escape -> escape；无关键 -> null', () => {
  assert.strictEqual(mapShortcut({ key: 'Escape', type: 'keyDown' }, 'win32'), 'escape');
  assert.strictEqual(mapShortcut({ key: 'a', type: 'keyDown' }, 'win32'), null);
  assert.strictEqual(mapShortcut({ key: 'F5', type: 'keyUp' }, 'win32'), null);
});

// ---- clampBounds 三种情形 ----
const DISPLAYS = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
const DEFAULTS = { width: 1280, height: 800 };
test('clampBounds: 完全在屏内 -> 原样', () => {
  const b = { x: 100, y: 100, width: 1000, height: 700 };
  assert.deepStrictEqual(clampBounds(b, DISPLAYS, DEFAULTS), b);
});
test('clampBounds: 完全在屏外 -> 默认大小居中', () => {
  const r = clampBounds({ x: 5000, y: 5000, width: 1000, height: 700 }, DISPLAYS, DEFAULTS);
  assert.deepStrictEqual(r, { x: 320, y: 120, width: 1280, height: 800 });
});
test('clampBounds: 部分在外 -> 平移进屏', () => {
  const r = clampBounds({ x: 1800, y: 900, width: 1000, height: 700 }, DISPLAYS, DEFAULTS);
  assert.deepStrictEqual(r, { x: 920, y: 340, width: 1000, height: 700 });
});

// ---- uniqueDownloadPath ----
test('uniqueDownloadPath: 不存在 -> 原名', () => {
  assert.strictEqual(uniqueDownloadPath('C:/d', '报告.pdf', () => false), 'C:/d/报告.pdf');
});
test('uniqueDownloadPath: 存在一次 -> 名 (1).扩展名', () => {
  assert.strictEqual(
    uniqueDownloadPath('C:\\Users\\a\\Downloads', '报告.pdf', (p) => p.endsWith('报告.pdf')),
    'C:\\Users\\a\\Downloads/报告 (1).pdf');
});
test('uniqueDownloadPath: 存在两次 -> 名 (2).扩展名', () => {
  const exists = (p) => p.endsWith('报告.pdf') || p.endsWith('报告 (1).pdf');
  assert.strictEqual(uniqueDownloadPath('/tmp', '报告.pdf', exists), '/tmp/报告 (2).pdf');
});
