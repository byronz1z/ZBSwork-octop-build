# 51 · 桌面端 8 向窗口拉伸（候选，未启用）

| 项 | 内容 |
|---|---|
| 层级 | L2 核心补丁 |
| 状态 | **candidate**——不参与构建 |
| 来源 | r2 安装器线（归档 tag `archive/2026-10/r2-production-source`） |
| 旧编号 | DSK-1 |

## 为什么不启用
1. 在用 EXE **没有**这个功能，用户未提出需求。
2. 本补丁只含 `window_resize_*.go` 与 `window_chrome*.go`，**不完整**：
   r2 中还需改 `main.go`（约 38 行，注册钩子）与 `assets/index.html`（约 94 行，注入拉伸热区）。
3. 补全后会与 50 号补丁同改 `main.go`，增加每次升级的冲突面。

## 若要启用
开任务 → 从归档 tag 取 r2 的 `main.go` / `index.html` 相关段 → 在锁定 tag 上施工 →
`tools/export.py` 导出 → modules.yaml 改 enabled。