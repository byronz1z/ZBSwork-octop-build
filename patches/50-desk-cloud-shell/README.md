# 50 · 桌面端云壳（默认连公司服务器 + 托盘菜单 + 可靠退出）

| 项 | 内容 |
|---|---|
| 层级 | L2 核心补丁（仅 `desktop/src/main.go`） |
| 状态 | enabled |
| 实测 | v1.0.2b4 / v1.0.2b6 严格 apply 通过（本机无 Go，**未编译**；CI 构建时验证） |
| 来源 | 在用 EXE `ZBSwork 1.0.2b2` = `zbswork-brand@366560cf`（归档 tag `archive/2026-10/desktop-cloud-shell`） |
| 上游 PR | 部分：退出兜底、设置窗关闭修复可提；默认地址是私有定制 |

## 做什么
1. 内置默认地址 `https://zbsworkoctoplink.api.zhangbaoshan.cn:8443`，双击即连公司服务器；
   环境变量 `OCTOP_DESKTOP_URL` 仍可覆盖。
2. 窗口直接以远端 URL 创建（wails3 beta.13 的 `SetURL` 会崩溃）。
3. 托盘右键原生菜单：打开 / 设置 / 退出。
4. `Quit()` 静默失效时 3 秒后强制退出；设置窗关闭不再阻止退出。

## 重要说明
- 这是“纯壳”的核心：EXE 不在本地跑 Octop 服务，只打开远端网页。**这不是上游原生行为。**
- 旧 WorkBuddy 模块册遗漏了本功能；`zbs/base`、r2 两条旧线都不含它。
- 在用 EXE 基于上游 b2，本补丁基于 b4 重新生成：两者 `main.go` 上下文不同，逻辑一致。

## 验收（构建后）
安装后双击打开 → 直接显示公司登录页；托盘右键三项可用；“退出”后进程消失。