# 24 · 桌面通知：Agent 来消息且页面不在前台时发系统通知，点通知回到对话并把窗口叫到前面

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（补丁文件共 3 个文件：新文件 2 个 + 官方文件挂载点 1 个） |
| 状态 | enabled |
| 实测 | v1.0.2：2026-10-27 ZT-038b 施工树（v1.0.2 + 补丁 20/21/23/60 + 品牌）改动后 `npx tsc -b` 无错、`npx vitest run src/utils/zbsDesktopNotify.test.ts` 13 个测试全过；补丁导出后 `prepare.py --check-only` 全量严格套上（exit 0） |
| 上游 PR | 否——与桌面壳（desk/）配套；上游无意向 |
| 依据 | 指挥部任务 ZT-038 支线 38b（日志 10-27 #464） |

## 为什么要这个模块

官方只在网页右上角弹 antd 提示；用户切到别的窗口或别的标签页就看不到 Agent 发来的消息。本模块在页面不在前台时同时发一条操作系统级通知（浏览器 Notification 接口），点通知直接回到那条对话并把窗口叫到前面；桌面壳里由壳注入的 `window.zbsDesktop.focusWindow()` 把壳窗口叫到前面。

## 功能点（用户在哪看到）

| # | 在哪 | 以后 |
|---|---|---|
| 1 | 浏览器（Chrome/Edge 等） | 登录后浏览器问一次"是否允许通知"；窗口不在前台（最小化、被遮住、别的标签页）时收到 Agent 推送，右下角出系统通知；点通知回到该对话 |
| 2 | 桌面壳 | 同上；点通知时由壳注入的 `window.zbsDesktop.focusWindow()` 把壳窗口叫到最前，再跳转到该对话 |

## 做法（模块化：新代码进新文件，官方文件只留挂载点）

新文件（本补丁自己的）：
- `dashboard/src/utils/zbsDesktopNotify.ts`：纯逻辑——`shouldDesktopNotify`（支持/已授权/不在前台才发）、`buildDesktopNotification`（正文截 200 字、tag 按对话 id，同一对话连续消息覆盖而不是堆一排）、`ensureNotificationPermission`（整个页面生命周期只请求一次）、`focusApp`（优先用壳注入的 focusWindow，否则 window.focus()）、`showDesktopNotification`（构造失败 try/catch 吞掉）。
- `dashboard/src/utils/zbsDesktopNotify.test.ts`：vitest 13 个用例（判定五情形、截断与 tag、权限只请求一次、focusApp 优先级）。

官方文件挂载点 `dashboard/src/hooks/useDashboardPushToast.tsx`，只加三处：
1. import 本补丁新文件的三个函数；
2. `socket.onopen` 里 `retry = 0` 之后加一行 `void ensureNotificationPermission();`（有令牌才会 onopen，等于"登录后请求一次"）；
3. `notificationRef.current.open({...})` 之后加一段：页面不在前台时 `showDesktopNotification(parsed, title, ...)`，点通知销毁右上角提示并跳 `/chat/<agent_id>/<thread_id>`。右上角原有提示照旧弹，其余一行不改。

文案复用官方已有的 `chat.pushToast.title` / `chat.pushToast.titleFallback`，本补丁不改文案文件。

## 边界（如实写明）

- 只有服务器已有的 `dashboard_push` 一种事件会触发系统通知；没有别的事件源。
- 通知内容只有标题（Agent 名）和正文前 200 字；没有头像图标、没有声音开关。
- 用户在浏览器里拒绝过权限就不会再弹询问，要恢复只能到浏览器设置里改。
- 非 https（或 localhost）的页面浏览器不提供 Notification，系统通知不出现；右上角 antd 提示不受影响。
- 同一对话的连续消息共用同一个 tag，新通知覆盖旧通知，不会堆一排。

## 删除条件

上游官方实现页面不在前台时的系统通知，或 ZBS 不再需要桌面壳联动时删除本模块；编号 24 作废不再使用。
