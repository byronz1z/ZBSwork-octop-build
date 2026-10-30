// 自动冒烟：起本机测试服务 → 启动壳 → 九条断言 → 清理
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
<a id="dl" href="/file.bin" download="冒烟下载.bin">下载</a>
<button id="popup">授权</button>
<a id="ext" href="https://example.com/x" target="_blank" rel="noreferrer">外站</a>
<script>
Notification.requestPermission().then(function (p) {
  document.getElementById('perm').textContent = p;
});
document.getElementById('focus').textContent = typeof window.zbsDesktop !== 'undefined'
  ? typeof window.zbsDesktop.focusWindow : 'none';
document.getElementById('popup').onclick = function(){ window.open('about:blank','octop-oauth','width=520,height=720'); };
</script></body></html>`;

const stripSlash = (u) => u.replace(/\/+$/, '');

async function main() {
  const server = http.createServer((_req, res) => {
    if (stripSlash(_req.url) === '/file.bin') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.alloc(1024, 0x61)); // 1 KiB 的 a
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverUrl = `http://127.0.0.1:${server.address().port}/`;

  // 地址唯一来源是 config.json：先备份原内容；改写与建临时目录都放进 try，失败也会走 finally 恢复
  const CONFIG = path.join(ROOT, 'src', 'config.json');
  const originalConfig = fs.readFileSync(CONFIG, 'utf8');
  let userData = null;
  let tmpDownloadsDir = null;
  let app = null;
  let failed = 0;
  try {
    fs.writeFileSync(CONFIG, JSON.stringify({
      serverUrl,
      displayVersion: JSON.parse(originalConfig).displayVersion,
    }, null, 2) + '\n');
    if (process.env.ZBSWORK_SMOKE_FAIL_MKDTEMP === '1') throw new Error('模拟 mkdtemp 失败');
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'zbswork-smoke-'));
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

    // 下载完成后窗口内出现提示条：把下载目录改到临时目录（finally 里删），点下载，等 toast 出现
    await assert(7, '下载完成后窗口内出现提示条', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbswork-smoke-dl-'));
      tmpDownloadsDir = tmpDir; // 记到外层，finally 里删
      await app.evaluate(({ app: a }, dir) => a.setPath('downloads', dir), tmpDir);
      await page.click('#dl');
      const toast = await page.waitForSelector('#zbs-download-toasts .zbs-download-toast', { timeout: 15000 });
      const text = await toast.textContent();
      if (!text.includes('已保存到下载文件夹：冒烟下载.bin')) throw new Error(`提示条文案：${text}`);
      // waitForSelector 返回的是 ElementHandle，没有 locator()，按钮用 page.locator 找（总调度修，执行方会话在 502 处断了）
      const openBtns = await page.locator('#zbs-download-toasts .zbs-download-toast button', { hasText: '打开文件夹' }).count();
      if (openBtns < 1) throw new Error('提示条里没有"打开文件夹"按钮');
      return true;
    });

    // 脚本弹窗（window.open 带尺寸参数，disposition=new-window）：about:blank 也开成子窗口，不交系统浏览器
    await assert(8, '脚本弹窗 about:blank 开成子窗口、不交系统浏览器', async () => {
      // 主进程挂钩只记录不真开：断言 0 次系统浏览器调用
      await app.evaluate(({ shell }) => {
        global.__ext = [];
        shell.openExternal = (u) => { global.__ext.push(String(u)); return Promise.resolve(); };
      });
      const popupPromise = app.waitForEvent('window');
      await page.click('#popup');
      const popup = await popupPromise;
      if (app.windows().length !== 2) throw new Error(`窗口数是 ${app.windows().length}，不是 2`);
      if (!popup.url().startsWith('about:blank')) throw new Error(`子窗口 url：${popup.url()}`);
      const extCount = await app.evaluate(() => global.__ext.length);
      if (extCount !== 0) throw new Error(`shell.openExternal 被调 ${extCount} 次`);
      // 关子窗口走主进程 BrowserWindow.close()（用户关窗的优雅路径），按 URL 认弹窗：
      // getAllWindows() 的顺序不是创建顺序（约是 z 序，聚焦的弹窗可能排第一），不能按索引关。
      // 不用 Playwright 的 popup.close()：about:blank 弹窗与主窗口共用渲染进程，
      // CDP 式关闭会把主窗口渲染进程一起杀掉，主页会话断掉（10-30 冒烟实测）。
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          let u = '';
          try { u = w.webContents.getURL(); } catch (_e) { /* 已销毁则忽略 */ }
          if (u === '' || u.startsWith('about:blank')) w.close();
        }
      });
      // ElectronApplication 没有 waitForFunction（那是 Page 的方法），轮询等窗口数回到 1
      const deadline = Date.now() + 10000;
      while (app.windows().length !== 1 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (app.windows().length !== 1) throw new Error(`关掉子窗口后窗口数是 ${app.windows().length}，不是 1`);
      return true;
    });

    // 外站链接（target=_blank，非脚本弹窗）：交系统浏览器，不开新窗口
    await assert(9, '外站链接交系统浏览器、不开窗口', async () => {
      // 兜底：若主页面会话意外断掉（如渲染进程崩溃），等崩溃重载把它救回来，最多 5 秒
      const healthy = Date.now() + 5000;
      while (Date.now() < healthy) {
        try { await page.evaluate(() => document.title); break; }
        catch (_e) { await new Promise((r) => setTimeout(r, 200)); }
      }
      await page.click('#ext');
      // 不固定等 300 毫秒（慢机器偶发失败，Codex 26 建议）：最多等 5 秒，每 100 毫秒看一次有没有记录到外链
      const extDeadline = Date.now() + 5000;
      while ((await app.evaluate(() => global.__ext.length)) < 1 && Date.now() < extDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const ext = await app.evaluate(() => global.__ext);
      if (JSON.stringify(ext) !== JSON.stringify(['https://example.com/x'])) {
        throw new Error(`shell.openExternal 记录：${JSON.stringify(ext)}`);
      }
      if (app.windows().length !== 1) throw new Error(`窗口数是 ${app.windows().length}，不是 1`);
      return true;
    });
  } finally {
    // 各恢复步骤独立 try/catch：任何一步失败不影响其他步骤；关壳等待上限 15 秒，超时强杀
    try {
      if (app) {
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; }, 15000);
        try {
          await Promise.race([app.close(), new Promise((r) => { setTimeout(r, 15000); })]);
        } finally { clearTimeout(timer); }
        if (timedOut) { try { app.process().kill(); } catch (e) { console.error('强杀壳进程失败：', e); } }
      }
    } catch (e) { console.error('关闭壳失败：', e); }
    try { fs.writeFileSync(CONFIG, originalConfig); } catch (e) { console.error('恢复 config.json 失败：', e); }
    try { if (userData !== null) fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { console.error('删临时目录失败：', e); }
    try { if (tmpDownloadsDir !== null) fs.rmSync(tmpDownloadsDir, { recursive: true, force: true }); } catch (e) { console.error('删下载临时目录失败：', e); }
    try { server.close(); } catch (e) { console.error('关服务失败：', e); }
  }
  if (failed > 0) {
    console.error(`冒烟失败：${failed} 条断言未通过`);
    process.exit(1);
  }
  console.log('冒烟通过：9/9');
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
