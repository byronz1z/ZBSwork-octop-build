# 10 · PostgreSQL 模式重启死循环修复（已作废）

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（原仅 `docker/docker-entrypoint.sh`） |
| 状态 | retired（2026-10-20，ZT-036） |
| 上游修复 | v1.0.2b9 起，提交 e8c7ae2「fix(docker): skip octop init on restart for external database backends (#1866)」 |
| 旧编号 | SRV-1 |

## 本模块已作废（ZT-036，2026-10-20）

官方从 v1.0.2b9 起修了本模块修的同一个问题，上游锁定升至 v1.0.2 后本补丁不再需要。
补丁文件已删，本目录只留本 README 说明真实情况，编号 10 作废不再使用（决策人 #413）。

## 原来修的问题

上游 entrypoint 用 `[ ! -f "$DB_FILE" ]`（SQLite 的 `octop.db`）判断是否首次启动。
切到 PostgreSQL 后数据卷里永远没有这个文件 → 每次重启都执行 `octop init` →
`octop init` 在非空 `~/.octop` 上报错退出 → 容器反复重启。

## 我们原来的修法

改用标记文件 `${OCTOP_HOME}/.bootstrapped`：首次初始化成功后写入。
PG 模式且无标记 → 初始化；SQLite 模式兼容旧部署（库已存在视为已初始化）。

## 官方的修法（v1.0.2b9 起，提交 e8c7ae2，#1866）

官方在 `docker/docker-entrypoint.sh` 改用标记文件 `${OCTOP_HOME}/.initialized`：
数据卷里既没有 `octop.db` 也没有这个标记时才跑 `octop init`；init 对已有管理员是
幂等的（输出 "already exists, skipping"），成功后写标记，以后重启跳过初始化。

## 两者差别与换版本时的影响

标记文件名不同（我们 `.bootstrapped`、官方 `.initialized`）。生产 2026-10-20 只读实测：
`/data/.octop/.bootstrapped` 存在（2026-09-24 写入），`/data/.octop/.initialized` 不存在。
所以换成 v1.0.2 后第一次启动会再走一次 `octop init`（按官方说明应跳过已有管理员并写上
`.initialized`），之后重启不再初始化。

演练实测：待 ZT-036 第 5 步补。
