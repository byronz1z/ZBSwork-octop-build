# 15 · PostgreSQL 连接代理补齐 `executemany()`（修复 PG 恢复无聊天备份 500，可上游提交）

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（共 2 个文件：官方源码 1 个 + 新增单测 1 个） |
| 状态 | enabled |
| 实测 | v1.0.2：`pytest tests/unit/infra/db/test_pg_executemany.py` 全过；`check_ownership.py`、`brand_check.py --self`、`prepare.py --check-only` 全绿 |
| 上游 PR | 是——标准 PostgreSQL 兼容层 Bug 修复，可向官方上游提交；上游合入对应修复后可退役 |
| 依据 | 指挥部任务 ZT-040 QA 实测真 Bug #2（`chats.py:169` 在 PG 恢复 `includes_chats=false` 备份时 `AttributeError: 'Connection' object has no attribute 'executemany'`） |

## 为什么要这个模块

`src/octop/infra/db/pool.py` 的 `_PgConnectionProxy` 仅封装了 `execute()` 与 `executescript()`，未实现 `executemany()`；当调用 `conn.executemany(sql, batch)`（如 `src/octop/infra/backup/chats.py:169` 恢复 `includes_chats=false` 备份回写保留聊天表，或 `src/octop/infra/db/repos/care_push.py:43` 批量写入推送记录）时，会经 `__getattr__` 透传到 `psycopg.Connection`，而 `psycopg` v3 的 `Connection` 并无 `executemany()` 方法（只在 `Cursor` 上提供），直接抛出 `AttributeError` 导致备份恢复返回 HTTP 500。

## 改动清单

- `src/octop/infra/db/pool.py`：在 `_PgConnectionProxy` 新增 `executemany(self, sql: str, params_seq: Any) -> None`，先经 `qmark_to_pyformat(sql)` 将 `?` 占位符转为 `%s`，再通过 `with self._conn.cursor() as cur: cur.executemany(pg_sql, params_seq)` 执行并自动关闭游标。
- `tests/unit/infra/db/test_pg_executemany.py`：回归验证 `?`→`%s` 占位符转换、批量与空序列执行、游标上下文关闭（含异常路径）以及 `chats.py` 风格插入语句不再抛 `AttributeError`。

## 退役条件

上游官方在 `_PgConnectionProxy` 实现 `executemany()` 后，经验证等价即可退役（编号 15 不再复用）。
