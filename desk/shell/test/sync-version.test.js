'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('sync-version: zbs0.4.1 -> version 0.4.1, displayVersion zbs0.4.1', () => {
  // 在临时目录搭一个最小副本，避免动真实文件
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zbs-sync-'));
  fs.mkdirSync(path.join(tmp, 'server'));
  fs.mkdirSync(path.join(tmp, 'desk', 'shell', 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'desk', 'shell', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'server', 'VERSION'), 'zbs0.4.1\n');
  fs.writeFileSync(
    path.join(tmp, 'desk', 'shell', 'package.json'),
    JSON.stringify({ name: 'zbswork-desktop', version: '0.0.0' }, null, 2) + '\n'
  );
  fs.copyFileSync(
    path.join(__dirname, '..', 'scripts', 'sync-version.js'),
    path.join(tmp, 'desk', 'shell', 'scripts', 'sync-version.js')
  );

  execFileSync(process.execPath, [path.join(tmp, 'desk', 'shell', 'scripts', 'sync-version.js')]);

  const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'desk', 'shell', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '0.4.1');

  const config = JSON.parse(fs.readFileSync(path.join(tmp, 'desk', 'shell', 'src', 'config.json'), 'utf8'));
  assert.strictEqual(config.displayVersion, 'zbs0.4.1');
  assert.strictEqual(config.serverUrl, 'https://zbsworkoctoplink.api.zhangbaoshan.cn');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('sync-version: ZBSWORK_SERVER_URL 覆盖 serverUrl', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zbs-sync-'));
  fs.mkdirSync(path.join(tmp, 'server'));
  fs.mkdirSync(path.join(tmp, 'desk', 'shell', 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'desk', 'shell', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'server', 'VERSION'), 'zbs0.4.1\n');
  fs.writeFileSync(path.join(tmp, 'desk', 'shell', 'package.json'), JSON.stringify({ version: '0.0.0' }));
  fs.copyFileSync(
    path.join(__dirname, '..', 'scripts', 'sync-version.js'),
    path.join(tmp, 'desk', 'shell', 'scripts', 'sync-version.js')
  );

  execFileSync(process.execPath, [path.join(tmp, 'desk', 'shell', 'scripts', 'sync-version.js')], {
    env: { ...process.env, ZBSWORK_SERVER_URL: 'https://127.0.0.1:18443' },
  });

  const config = JSON.parse(fs.readFileSync(path.join(tmp, 'desk', 'shell', 'src', 'config.json'), 'utf8'));
  assert.strictEqual(config.serverUrl, 'https://127.0.0.1:18443');

  fs.rmSync(tmp, { recursive: true, force: true });
});
