'use strict';
// build 入口：先同步版本，再把 ZBSWORK_DISPLAY_VERSION 导出给 electron-builder
const { execFileSync } = require('child_process');
const { syncVersion } = require('./sync-version');

syncVersion();
const config = require('../src/config.json');

const args = process.argv.slice(2); // 如 ['--win'] 或 ['--mac', '--dir']
// 不用 npx / shell:true：直接用 node 跑 electron-builder 的 cli 入口，参数原样传
execFileSync(
  process.execPath,
  [require.resolve('electron-builder/out/cli/cli.js'), ...args, '--publish', 'never'],
  {
    stdio: 'inherit',
    env: { ...process.env, ZBSWORK_DISPLAY_VERSION: config.displayVersion },
  }
);
