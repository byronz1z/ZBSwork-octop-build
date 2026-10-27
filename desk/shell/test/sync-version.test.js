'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// sync-version 读 ../../server/VERSION，写 package.json 的 version 和 src/config.json。
// 测试验证"地址默认取 config.json、环境变量可覆盖"：跑前跑后把两个文件恢复原样。
const { syncVersion } = require('../scripts/sync-version.js');


const CONFIG_FILE = path.resolve(__dirname, '..', 'src', 'config.json');
const PKG_FILE = path.resolve(__dirname, '..', 'package.json');

function withConfig(fn) {
  const backup = fs.readFileSync(CONFIG_FILE, 'utf8');
  const pkgBackup = fs.readFileSync(PKG_FILE, 'utf8');
  try {
    fn();
  } finally {
    fs.writeFileSync(CONFIG_FILE, backup);
    fs.writeFileSync(PKG_FILE, pkgBackup);
    delete process.env.ZBSWORK_SERVER_URL;
  }
}

test('sync-version: 无 ZBSWORK_SERVER_URL → serverUrl 保持 config.json 原值', () => {
  withConfig(() => {
    delete process.env.ZBSWORK_SERVER_URL;
    const before = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).serverUrl;
    syncVersion();
    const after = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).serverUrl;
    assert.strictEqual(after, before);
  });
});

test('sync-version: 有 ZBSWORK_SERVER_URL → 覆盖 serverUrl', () => {
  withConfig(() => {
    process.env.ZBSWORK_SERVER_URL = 'https://127.0.0.1:18443';
    syncVersion();
    const after = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).serverUrl;
    assert.strictEqual(after, 'https://127.0.0.1:18443');
  });
});
