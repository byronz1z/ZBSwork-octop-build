# desk — ZBSwork 桌面壳

本目录是 ZBSwork 桌面壳（Electron）。它不含业务逻辑，只打开服务器网址。版本与 server/VERSION 同号，不另设。

## 怎么构建（在 desk/shell/ 下）

```bash
npm ci                 # 装依赖（只用官方 registry）
npm start              # 本地跑：先同步版本再开窗口
npm test               # 单元测试（node:test）
npm run smoke          # Playwright 冒烟（起本机测试服务，六条断言）
npm run build          # 出 Windows NSIS 安装包 → dist/ZBSwork-Setup-zbs<版本>.exe
npm run build:mac-check # 校验 Mac 打包配置（本机 Windows，只验不打 dmg）
```

打包参数：

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `ZBSWORK_SERVER_URL` | 壳打开的服务器地址 | 不传则保持 `src/config.json` 里已入库的值（地址只有这一处） |
| `ZBSWORK_DISPLAY_VERSION` | 安装包文件名里的版本（脚本自动从 server/VERSION 填入） | — |

演练包：`ZBSWORK_SERVER_URL=https://127.0.0.1:18443 npm run build`。

## 云端构建（GitHub Actions）

`.github/workflows/build-desk.yml` 只手动触发（workflow_dispatch），不发 Release、不推镜像：

1. GitHub 仓库页面 → Actions → 左侧选 `build-desk` → Run workflow；
2. 输入框 `server_url` 填壳要打开的服务器地址（默认生产地址），Run；
3. 跑完后，本次运行页面的 Artifacts 里下载产物：
   - `ZBSwork-windows`：`ZBSwork-Setup-<版本>.exe`（NSIS 安装包）
   - `ZBSwork-mac`：`ZBSwork-<版本>-universal.dmg`（Mac 通用包，不签名）
4. 产物保留 30 天；SHA256 在运行日志里（`SHA256 to log` 步骤）。

`server_url` 会作为环境变量 `ZBSWORK_SERVER_URL` 传给 `npm run build`，经 sync-version 写进包里的 `src/config.json`——地址仍然只有 config.json 一处。

## 版本从哪来

`scripts/sync-version.js` 读 `../../server/VERSION`（形如 `zbs0.4.1`）：

- 去掉前缀 `zbs` 写入 `package.json` 的 `version`（`0.4.1`，给 electron-builder 用）；
- 原文写进 `src/config.json` 的 `displayVersion`（`zbs0.4.1`，用在安装包文件名和"关于"弹窗）。

`npm run build` / `npm start` 前自动跑它，不用手动。

## 和网页端的耦合点（每次官方升级任务对照一遍；变了就开 desk 任务）
| 接缝 | 网页端现状（2026-10-27） | 壳里对应 |
|---|---|---|
| 弹窗 | window.open 命名小窗：octop-oauth、octop-connector-auth、SSO 弹窗（Connectors/index.tsx、CustomMcpTab.tsx、ssoPopup.ts、CodexOAuthConnect.tsx） | setWindowOpenHandler：URL 以 serverUrl 为前缀→子窗口、其他→系统浏览器（第一轮已做） |
| 下载 | blob + a.download（AuthFileDownloadLink.tsx） | will-download 提示：存系统下载目录、重名递增、完成/失败系统通知（已做） |
| 权限 | 麦克风（useVoiceInput.ts） | setPermissionRequestHandler：只放行 serverUrl 来源的通知/麦克风/剪贴板，其他来源一律拒（已做） |
| 识别桌面壳 | window._wails（desktopChrome.ts） | 壳不注入 _wails，网页按普通浏览器处理；壳注入 window.zbsDesktop（isDesktop、focusWindow），补丁 24 用它把窗口叫到前面（已做） |
| 通知 | 补丁 24（useDashboardPushToast.tsx）调 Notification | Windows 设 appUserModelId（cn.zbswork.desktop，与 appId 一致）；点通知聚焦窗口（已做） |
| 登录态 | 默认持久分区 | 改会话机制要真机验 |
| PWA 提示 | PwaInstallPrompt 依赖 beforeinstallprompt，Electron 里不触发 | 预计不弹；弹了写 pwa:install-dismissed |
