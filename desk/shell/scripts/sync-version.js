'use strict';
const fs = require('fs');
const path = require('path');

// realpath 归一化：防 Windows 8.3 短路径在子进程中展开不一致
const SCRIPT_DIR = fs.realpathSync(__dirname);
// path.resolve 才真正折叠 '..'；path.join 只是拼接
const ROOT = path.resolve(SCRIPT_DIR, '..');
const VERSION_FILE = path.resolve(ROOT, '..', '..', 'server', 'VERSION');
const PKG_FILE = path.resolve(ROOT, 'package.json');
const CONFIG_FILE = path.resolve(ROOT, 'src', 'config.json');
if (process.env.ZBS_SYNC_DEBUG) {
  console.log('[debug] __dirname=', __dirname, 'SCRIPT_DIR=', SCRIPT_DIR, 'VERSION_FILE=', VERSION_FILE);
}

function syncVersion() {
  const displayVersion = fs.readFileSync(VERSION_FILE, 'utf8').trim(); // 形如 zbs0.4.1
  const version = displayVersion.replace(/^zbs/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`server/VERSION 内容无法解析为版本号：${JSON.stringify(displayVersion)}`);
  }
  console.log(`[sync-version] VERSION_FILE=${VERSION_FILE}`);

  const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2) + '\n');

  // 地址只有一处：config.json（进库）。传了 ZBSWORK_SERVER_URL 才覆盖。
  const existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const serverUrl = process.env.ZBSWORK_SERVER_URL || existing.serverUrl;
  const config = { serverUrl, displayVersion };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  process.env.ZBSWORK_DISPLAY_VERSION = displayVersion;

  // 若父进程环境变量没传下来（如直接 electron-builder），用文件回填
  if (!process.env.ZBSWORK_DISPLAY_VERSION_FROM_ENV) {
    // 留给 build 脚本在 shell 层导出；此处仅保证 config 正确
  }

  console.log(`sync-version: version=${version} displayVersion=${displayVersion} serverUrl=${serverUrl}`);
}

if (require.main === module) {
  syncVersion();
}

module.exports = { syncVersion };
