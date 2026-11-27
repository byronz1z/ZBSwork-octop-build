# ZBSwork 桌面壳（desk/shell）

Electron 壳（Windows + Mac），打开即是服务器网址。版本读 `server/VERSION`，由
`scripts/sync-version.js` 同步进 `src/config.json`（见根 README 的 desk 条目，ZT-038）。

## 链接与弹窗去向（r5）

实现在 `src/lib/windowOpen.js`（纯函数 `routeWindowOpen(url, serverUrl, disposition, currentUrl)`，供单测），
入口在 `src/main.js` 的 `hardenWindow`（`setWindowOpenHandler`）。遵守**壳只做路由，不做过程**，按"怎么打开的"分类：

- **R1 脚本弹窗**（`disposition === 'new-window'`，通常由 `window.open` 带弹窗特征（尺寸等）触发）：
  不管地址是什么（含 `about:blank`、空、第三方授权站）→ `'child'`，
  开壳的子窗口，子窗口可以自由导航（授权流程要跳第三方再跳回）。
- **R2 链接新开**（`disposition` 是 `'foreground-tab'` / `'background-tab'` / `'default' / 'other'` / 未传）：
  空链接（空串、`about:blank`）或无意义跳向与当前页完全相同的 URL（含末尾空 `#`）→ `'deny'`（r5 拦截重复/空子窗口）；
  严格同源（`new URL(url).origin === new URL(serverUrl).origin`，r5 替代前缀 `startsWith` 防范 `https://域名:端口@evil.com` 绕过）→ `'child'`；
  其他合法 `http:` / `https:` 外站，以及 `mailto:` / `tel:` → `'external'`（交系统浏览器或邮件/拨号程序；mailto/tel 为 r4 放行）。
- **R3 其他协议或非法 URL**（`file:`、`javascript:`、`data:`、`ms-settings:` 等；R3 只处理没命中 R1、R2 的情况，R1 先判，所以脚本弹窗不受 R3 限制）→ `'deny'`：
  什么都不发生，绝不 `shell.openExternal`。

背景：网页端连接器授权用 `window.open("about:blank" 或 "", "octop-oauth", "width=520,height=720")`
先开一个空弹窗再导航到第三方授权页，属于 R1，不受 R2 空链接拦截影响。

## 稳定性、权限与日志（r5）

- **卡死恢复与防误重载（BUG-02）**：监听 `responsive` 事件，卡顿恢复时取消未触发的 `crashTimer` 并复位状态；`unresponsive` 超时自动恢复或无响应态下用户按 `F5/Ctrl+R/Cmd+R` 时，先调 `forcefullyCrashRenderer()` 强杀死锁渲染进程再 `loadURL(serverUrl)` 重建；主窗口 `closed` 时清理全部待定定时器。
- **重试防死锁与出错页重连（BUG-03）**：`goServer()` 启用导航超时保护（默认 20s 超时中止加载并切出错页）；`zbswork:retry` 在用户手动点击或加载卡住超阈值时先 `webContents.stop()` 再 `goServer()`；当前位于本地 `error.html` 时按 `F5/Ctrl+R/Cmd+R` 直接重连服务器而非刷新出错页。
- **macOS 编辑快捷键（BUG-09）**：`darwin` 保留最小应用菜单与标准 Edit 角色（`undo/redo/cut/copy/paste/selectAll`），恢复 `Cmd+C/V/X/A/Z`（不放 `role:'quit'` 以保留防误按 `Cmd+Q`）；Windows/Linux 维持无菜单栏。
- **启动白屏探测自救（BUG-10 壳侧）**：服务器页 `did-finish-load` 后延迟探测 `#root` 是否为空，仍为空时最多自动清 HTTP 缓存并无缓存重载 1 次，记入本地故障日志。
- **安全与下载（BUG-11）**：权限白名单补齐 `fullscreen` 并统一严格同源比对；并发同名下载使用内存预留集合防相互覆盖，用户主动取消（`cancelled`）不弹失败提示；轻量本地故障日志写至 `app.getPath('userData')/logs/main.log`（脱敏 URL 查询参数/token/密码，超限自动截断）。

另：Windows 上 `app.setAppUserModelId` 打包态用 `cn.zbswork.desktop`（与 electron-builder.yml 的
appId 一致）；开发态用 `cn.zbswork.desktop.dev` 后缀——开发版 Electron 为发系统通知会往开始菜单
写一个带该标识的快捷方式，Windows 任务栏按标识找快捷方式，不加后缀会顶掉装好的客户端的图标和名字。

## 测试

```bash
npm run lint   # node --check 语法检查
npm test       # node:test 单测（纯函数）
npm run smoke  # 起本机测试服务的十三条断言冒烟（test/smoke/smoke.mjs）
```
