# 12 · 流式稳定与白屏兜底（BUG-01 + BUG-10 前端侧）

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（共 9 个文件：官方文件 4 个 + 官方测试扩展 1 个 + 新增文件 4 个） |
| 状态 | enabled |
| 实测 | v1.0.2：施工树（v1.0.2 + 全部启用补丁 12/20/21/23/24/60 + 品牌包）`prepare.py --check-only`、`check_ownership.py`、`brand_check.py --self` 均退出码 0；前端 `tsc -b` 无错；新增与相关 vitest 全部通过；后端 `test_launch_ws_ping.py` 3 项 pytest 全过 |
| 上游 PR | 是——长连接 `ws_ping_timeout=None` 对齐官方 `#2920` 修复思路；**未来升官方 v1.0.3+ 后可退役** |
| 依据 | 指挥部任务 ZT-040（BUG-01 流式抖动/断线/回复被冲、BUG-10 启动与静态块白屏兜底） |

## 为什么要这个模块

1. **流式高频重渲染（BUG-01）**：`chatStore.ts` 原先每次收到流式 `token`/`reasoning`/`tool_call_chunk` 都同步调用 `notify()` 重建快照并触发整页重渲染，高吞吐输出下主线程卡顿。
2. **流式期下拉刷新冲掉回复（BUG-01）**：对话正在流式输出且尚未落库时，若触发历史下拉刷新或晚到的 `loadHistory` 返回旧历史，`setHistoryPage()` 会直接覆盖 `state.messages` 与 `runUsage`，导致正在生成的回复消失。
3. **长任务 WebSocket 心跳超时断线（BUG-01）**：`src/octop/launch.py` 构造 `uvicorn.Config` 未关闭协议层 `ws_ping_timeout`（默认 20s），长任务阻塞或后台标签页节流时容易触发 1011 keepalive ping timeout 强制断线。
4. **前端启动与静态资源块加载白屏（BUG-10 前端侧）**：
   - `main.tsx` 中 `initI18n()` 失败后除 `console.error` 外不做任何渲染，页面停留在无限转圈或永久白屏；
   - `reloadOnStaleChunk.ts` 在自动重试一次仍失败时仅清除标记并静默返回 `false`，同样留白屏且无可见恢复入口。

## 改动清单

官方文件（4 个）：
- `dashboard/src/pages/Chat/hooks/chatStore.ts`：
  - 新增 `STREAM_PAINT_MS = 50` 合帧节流（`scheduleStreamNotify`）：有 UI 订阅者时，高频流式 delta（`token`/`reasoning`/`tool_call_chunk`/`usage`/`state_update`/`state_snapshot`）按 50ms 窗口合并刷新；无订阅者时保持快照同步更新以兼容无头调用；
  - 终态事件（`done`/`error`/`hitl_required`/`tool_result`/完成态 `team_snapshot`/`cancelStream`/`finish`/`removeSession` 等）取消待触发计时器并立即 `notify()` flush，绝不丢尾字；
  - `setHistoryPage()` 增加流式保护（`state.isStreaming || hasStreamingMessages(state)` 时直接返回），阻止未落库历史冲掉正在流式输出的回复，且不影响空闲态正常历史加载。
- `src/octop/launch.py`：
  - 新增 `WS_PING_TIMEOUT: float | None = None`，在双端口 HTTPS (`https_config`) 与单端口 (`single_config`) 两个 `uvicorn.Config` 均传入 `ws_ping_timeout=WS_PING_TIMEOUT`（保留默认 20s ping 发送以维持代理保活，关闭 20s 强断超时，对齐官方 `#2920`）。
- `dashboard/src/main.tsx`：
  - `initI18n()` 失败且非首次 chunk 自动重载时，调用 `renderBootFallback(err)` 渲染中文错误兜底页与“重新加载”按钮。
- `dashboard/src/utils/reloadOnStaleChunk.ts`：
  - 增加 `recoveryExhausted` 内存防循环守卫与 `renderChunkRecoveryBanner()`（`#zbs-chunk-recovery-banner`）；一次自动重载仍失败后不再循环重载，而是渲染可见中文恢复提示条与“重新加载”按钮（点击后清标记并清理 SW/Cache 重载）。

新增文件与测试（5 个）：
- `dashboard/src/utils/bootFallback.ts`：独立的启动失败中文兜底页渲染器（纯 DOM + 内联样式，不依赖 CSS chunk 与 i18n，支持深浅主题，使用 `textContent` 防 XSS，自动移除重复的 chunk 提示条）。
- `dashboard/src/pages/Chat/hooks/chatStore.streamStability.test.ts`：验证 `STREAM_PAINT_MS = 50` 合帧节流、`done`/`error`/`cancelStream` 终态立即 flush 不丢尾字、`removeSession` 清计时器、流式期 `setHistoryPage` 防冲回复与结束后正常加载。
- `dashboard/src/utils/bootFallback.test.ts`：验证启动兜底页替换 `#octop-boot`、XSS 安全转义、清理重复提示条、按钮重载以及 `main.tsx` `initI18n` reject 触发路径。
- `dashboard/src/utils/reloadOnStaleChunk.test.ts`（扩展）：验证二次失败渲染恢复提示条、三次失败不循环且不重复插入、点击按钮清标记并重载。
- `tests/unit/test_launch_ws_ping.py`：验证单端口与双端口 TLS 模式下 `launch.run_foreground` 创建的 `uvicorn.Config` 均设置 `ws_ping_timeout is None` 且保留 `ws_max_size`。

## 退役条件

**未来升官方 v1.0.3+ 后可退役**：若上游已合入 `#2920`（`ws_ping_timeout=None`）、`chatStore` 流式合帧与防历史冲回复、以及 `initI18n`/stale-chunk 白屏兜底，经逐项核验等价覆盖后可将本模块状态改为 `retired`（目录只留 README，编号 12 不再复用）。
