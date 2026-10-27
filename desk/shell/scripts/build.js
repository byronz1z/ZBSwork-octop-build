'use strict';
// build 入口：先同步版本，再把 ZBSWORK_DISPLAY_VERSION 导出给 electron-builder
const { execFileSync } = require('child_process');
const { syncVersion } = require('./sync-version');

syncVersion();
const config = require('../src/config.json');

const args = process.argv.slice(2); // 如 ['--win'] 或 ['--mac', '--dir']
// Node 18.20.2+/20.12.2+ 起 spawn .cmd 必须 shell:true（CVE-2024-27980），改用 shell 模式起 npx
execFileSync(
  'npx',
  ['electron-builder', ...args, '--publish', 'never'],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ZBSWORK_DISPLAY_VERSION: config.displayVersion },
  }
);
