# 13 · 鉴权二次过期复位与记忆维护轮询防风暴（可上游提交）

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（共 4 个文件：官方源码 2 个 + 官方测试扩展 2 个） |
| 状态 | enabled |
| 实测 | v1.0.2：`npx tsc -b` 0 错；`vitest` 4 套件 25/25 通过；`check_ownership.py`、`brand_check.py --self`、`prepare.py --check-only`、`prepare_lf.py` 全部退出码 0 |
| 上游 PR | 是——标准前端 Bug 修复，可向官方上游提交；上游合入对应修复后可退役 |
| 依据 | 指挥部任务 ZT-040（PR 5：`task/ZT-040-auth-backup-fix`） |

## 为什么要这个模块

1. **SPA 二次登录过期后不再跳登录页**：`dashboard/src/api/request.ts` 中 `_redirectingToLogin` 在第一次 401 触发 SPA 内跳转 `/login` 时置为 `true`；用户不刷新页面重新登录后，`setAuthToken()` 未复位该标志，导致会话再次过期时 `handleUnauthorized()` 直接提前返回，页面卡死在失效态。
2. **401 轮询风暴与无界重试**：`dashboard/src/pages/Chat/hooks/useMemoryMaintenance.ts` 在无有效 token 或收到 401/鉴权失败时仍按固定 2s 间隔无限继续轮询 `/api/agents/{id}/status`，瞬时断网时也无指数退避，造成后端 401/错误请求风暴。

## 改动清单

- `dashboard/src/api/request.ts`：`setAuthToken()` 在写入非空 token（`token.trim()` 非空）时复位 `_redirectingToLogin = false`。
- `dashboard/src/pages/Chat/hooks/useMemoryMaintenance.ts`：
  - 导出 `MEMORY_POLL_BASE_DELAY_MS = 2000`、`MEMORY_POLL_MAX_DELAY_MS = 30000`、`nextPollBackoffMs()`；
  - 启动及每次轮询前校验 `getAuthToken().trim()`，无有效 token 时不发请求、不排程；
  - 监听 `UNAUTHORIZED_EVENT` 并在捕获 401 / `Unauthorized` / `TOKEN_EXPIRED` / `AUTH_FAILED` / `SetupRequiredError` 或 token 已清空时立即停止轮询；
  - 瞬时网络/服务错误采用有界指数退避 `2s → 4s → 8s → 16s → 30s`（上限 30s），恢复成功后立即重置为 2s。
- `dashboard/src/api/request.unauthorized.test.ts`：补充 SPA 首次 401 接管 → 空白 token 不复位 → 非空新 token 复位 → 二次 401 正常触发跳转的单测。
- `dashboard/src/pages/Chat/hooks/useMemoryMaintenance.test.ts`：补充无 token 不轮询、401 立即停轮询、token 被清空停轮询、`UNAUTHORIZED_EVENT` 停轮询、瞬时错误 `2s→4s→8s→16s→30s` 退避及恢复重置单测。

## 退役条件

上游官方合入 `setAuthToken` 复位 `_redirectingToLogin` 与 `useMemoryMaintenance` 鉴权停轮询 + 指数退避后，经验证等价即可退役（编号 13 不再复用）。
