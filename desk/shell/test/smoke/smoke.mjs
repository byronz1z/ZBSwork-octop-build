// 自动冒烟：起本机测试服务 → 启动壳 → 六条断言 → 清理
// 用法：在 desk/shell 下 npm run smoke。任一断言失败退出码非 0，输出写明第几条。
'use strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';

const requireFromHere = createRequire(import.meta.url);
const electronExe = requireFromHere('electron'); // 在纯 node 里 require('electron') 得到可执行文件路径
const ROOT = process.cwd(); // npm run smoke 的 cwd 就是 desk/shell

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>ZBSwork 冒烟</title></head>
<body><div id="perm">pending</div><div id="focus">pending</div>
<script>
Notification.requestPermission().then(function (p) {
  document.getElementById('perm').textContent = p;
});
document.getElementById('focus').textContent = typeof window.zbsDesktop !== 'undefined'
  ? typeof window.zbsDesktop.focusWindow : 'none';
</script></body></html>`;

const stripSlash = (u) => u.replace(/\/+$/, '');

async function main() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverUrl = `http://127.0.0.1:${server.address().port}/`;

  // 地址唯一来源是 config.json：先备份，改写为测试地址，结束后恢复
  const CONFIG = path.join(ROOT, 'src', 'config.json');
  const originalConfig = fs.readFileSync(CONFIG, 'utf8');
  fs.writeFileSync(CONFIG, JSON.stringify({
    serverUrl,
    displayVersion: JSON.parse(originalConfig).displayVersion,
  }, null, 2) + '\n');

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'zbswork-smoke-'));
  let app = null;
  let failed = 0;
  try {
    app = await electron.launch({
      args: [ROOT],
      env: { ...process.env, ZBSWORK_SERVER_URL: serverUrl, ZBSWORK_USER_DATA: userData },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const assert = async (n, name, fn) => {
      try {
        const ok = await fn();
        if (ok !== true) throw new Error(`返回值不是 true：${String(ok)}`);
        console.log(`断言${n} 通过：${name}`);
      } catch (e) {
        failed += 1;
        console.error(`断言${n} 失败：${name}\n  ${e && e.stack ? e.stack : e}`);
      }
    };

    await assert(1, '只有一个窗口', async () => app.windows().length === 1);
    await assert(2, `页面 url 等于测试服务地址（${serverUrl}）`, async () =>
      stripSlash(page.url()) === stripSlash(serverUrl));
    await assert(3, '主窗口菜单栏不可见', async () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((w) => !w.isMenuBarVisible())));
    await assert(4, '标题含 "ZBSwork 冒烟"', async () =>
      (await page.title()).includes('ZBSwork 冒烟'));

    // 第二个实例：同一个 electron 可执行文件、同 args、同 env；应在 10 秒内自己退出
    await assert(5, '第二实例退出且窗口数仍为 1', async () => {
      const child = spawn(electronExe, [ROOT], {
        env: { ...process.env, ZBSWORK_SERVER_URL: serverUrl, ZBSWORK_USER_DATA: userData },
        stdio: 'ignore',
      });
      const code = await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill(); resolve('timeout'); }, 10000);
        child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
      });
      if (typeof code !== 'number') throw new Error(`第二实例 10 秒内没退出（${code}）`);
      return app.windows().length === 1;
    });

    await assert(6, 'Notification.permission === granted 且 window.zbsDesktop.focusWindow 是函数', async () => {
      await page.waitForFunction(
        () => document.getElementById('perm').textContent === 'granted',
        null, { timeout: 10000 });
      const focus = await page.evaluate(() => document.getElementById('focus').textContent);
      if (focus !== 'function') throw new Error(`window.zbsDesktop.focusWindow 类型是 ${focus}`);
      return true;
    });
  } finally {
    // 各恢复步骤独立 try/catch：任何一步失败不影响其他步骤
    try { if (app) await app.close(); } catch (e) { console.error('关闭壳失败：', e); }
    try { fs.writeFileSync(CONFIG, originalConfig); } catch (e) { console.error('恢复 config.json 失败：', e); }
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { console.error('删临时目录失败：', e); }
    try { server.close(); } catch (e) { console.error('关服务失败：', e); }
  }
  if (failed > 0) {
    console.error(`冒烟失败：${failed} 条断言未通过`);
    process.exit(1);
  }
  console.log('冒烟通过：6/6');
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
