# ZBSwork 桌面壳（desk/shell）

Electron 壳（Windows + Mac），打开即是服务器网址。版本读 `server/VERSION`，由
`scripts/sync-version.js` 同步进 `src/config.json`（见根 README 的 desk 条目，ZT-038）。

## 链接与弹窗去向

实现在 `src/lib/windowOpen.js`（纯函数 `routeWindowOpen(url, serverUrl, disposition)`，供单测），
入口在 `src/main.js` 的 `hardenWindow`（`setWindowOpenHandler`）。按"怎么打开的"分类：

- **R1 脚本弹窗**（`disposition === 'new-window'`，通常由 `window.open` 带弹窗特征（尺寸等）触发）：
  不管地址是什么（含 `about:blank`、空、第三方授权站）→ `'child'`，
  开壳的子窗口，子窗口可以自由导航（授权流程要跳第三方再跳回）。
- **R2 链接新开**（`disposition` 是 `'foreground-tab'` / `'background-tab'` / `'default'` / `'other'` / 未传）：
  地址以 serverUrl 为前缀（保留 `startsWith`）→ `'child'`（壳没有标签页，用子窗口代替浏览器的新标签）；
  地址是 `http:` / `https:` 的外站，以及 `mailto:` / `tel:` → `'external'`（交系统浏览器或邮件/拨号程序；mailto/tel 为 r4 放行）；
  地址是 `about:blank` 或空串 → `'child'`。
- **R3 其他协议**（`file:`、`javascript:`、`data:`、`ms-settings:` 等任何不是 http/https/mailto/tel/about 的；R3 只处理没命中 R1、R2 的情况，R1 先判，所以脚本弹窗不受 R3 限制）→ `'deny'`：
  什么都不发生，绝不 `shell.openExternal`。

背景：网页端连接器授权用 `window.open("about:blank" 或 "", "octop-oauth", "width=520,height=720")`
先开一个空弹窗再导航到第三方授权页。旧逻辑只看地址前缀，`about:blank` 不在服务器前缀里 →
被当外链 deny，网页拿到 `null` 报"授权窗口被浏览器拦截"（内部修订 r3 修复）。

另：Windows 上 `app.setAppUserModelId` 打包态用 `cn.zbswork.desktop`（与 electron-builder.yml 的
appId 一致）；开发态用 `cn.zbswork.desktop.dev` 后缀——开发版 Electron 为发系统通知会往开始菜单
写一个带该标识的快捷方式，Windows 任务栏按标识找快捷方式，不加后缀会顶掉装好的客户端的图标和名字。

## 测试

```bash
npm run lint   # node --check 语法检查
npm test       # node:test 单测（纯函数）
npm run smoke  # 起本机测试服务的十条断言冒烟（test/smoke/smoke.mjs）
```
