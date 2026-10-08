# 10 · PostgreSQL 模式重启死循环修复

| 项 | 内容 |
|---|---|
| 层级 | L2 核心补丁（仅 `docker/docker-entrypoint.sh`） |
| 状态 | enabled |
| 实测 | v1.0.2b4 / v1.0.2b6 严格 apply 通过 |
| 上游 PR | **应提**——上游 b6 与 main 仍未修 |
| 旧编号 | SRV-1 |

## 问题（源码事实）
上游 entrypoint 用 `[ ! -f "$DB_FILE" ]`（SQLite 的 `octop.db`）判断是否首次启动。
切到 PostgreSQL 后数据卷里永远没有这个文件 → 每次重启都执行 `octop init` →
`octop init` 在非空 `~/.octop` 上报错退出 → 容器反复重启。

## 修法
改用标记文件 `${OCTOP_HOME}/.bootstrapped`：首次初始化成功后写入。
PG 模式且无标记 → 初始化；SQLite 模式兼容旧部署（库已存在视为已初始化）。

## 生产注意
2026-10-08 只读实测：生产数据目录 `/data/.octop/.bootstrapped` 存在（内容 `2026-09-24T07:51:56Z`），
切到含本补丁的新镜像不会重新初始化。另有 0 字节 `octop.db` 残留，为旧逻辑痕迹，无害。

## 退役条件
上游合并等价修复后，本模块改 `retired`。