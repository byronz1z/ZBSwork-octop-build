#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""M70 自包含验收脚本：模型分用户（allowed_models 资源策略）。

设计目标：**不依赖项目完整依赖树**（不需要 octop-harness / fastapi / langchain）。
只用 stdlib sqlite3 + 上游自己的 `UserPolicyRepo` / `resource_policy`，
因此可以在任何 checkout 上直接跑。

用法（在 octop 仓库根目录）：
    PYTHONPATH=src python verify/test-allowed-models.py

任一条失败 → 退出码 1。

覆盖：
  A. 策略值解析/归一化（缺失=不限制、JSON 解析、去重、容错）
  B. 真实仓储层读写（SqlitePool + UserPolicyRepo，真实 user_policies 表）
  C. 角色模板 → 用户 的复制语义（全量替换、清空回退不限制）
  D. HTTP 暴露面（public_policy_fields）
"""

from __future__ import annotations

import sqlite3
import sys
import tempfile
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if SRC.is_dir():
    sys.path.insert(0, str(SRC))

# ── 被测对象（上游源码，非本脚本复刻） ─────────────────────────────────────
from octop.infra.db.pool import SqlitePool  # noqa: E402
from octop.infra.db.repos.user_policies import UserPolicyRepo  # noqa: E402
from octop.infra.users.resource_policy import (  # noqa: E402
    POLICY_ALLOWED_MODELS,
    POLICY_TOKEN_QUOTA,
    allowed_models_of,
    dump_allowed_models,
    effective_allowed_models,
    normalize_allowed_models,
    public_policy_fields,
)

# schema v14 的 user_policies 定义 + users 最小表（与 001_initial/014 一致）
SCHEMA = """
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT,
  role          TEXT    NOT NULL DEFAULT 'user'
);
CREATE TABLE user_policies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id  TEXT    NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  value      TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);
INSERT INTO users(username, password_hash, role) VALUES ('u1','h','user'),('u2','h','user');
"""

_results: list[tuple[bool, str, object, object]] = []


def chk(name: str, got: object, want: object) -> None:
    _results.append((got == want, name, got, want))


def main() -> int:
    # ── A. 纯解析逻辑 ────────────────────────────────────────────────────
    chk("A1 缺失(None) = 不限制", allowed_models_of(None), None)
    chk("A2 空串 = 不限制", allowed_models_of(""), None)
    chk("A3 空数组 = 不限制", allowed_models_of("[]"), None)
    chk("A4 非法 JSON = 不限制(容错)", allowed_models_of("not-json"), None)
    chk("A5 JSON 对象 = 不限制", allowed_models_of('{"a":1}'), None)
    chk("A6 合法 JSON 数组", allowed_models_of('["openai/gpt-4o"]'), ["openai/gpt-4o"])
    chk(
        "A7 list 去重+去空白+保序",
        allowed_models_of([" a/b ", "a/b", "c/d"]),
        ["a/b", "c/d"],
    )
    chk("A8 normalize 幂等", normalize_allowed_models('["a/b"]'), ["a/b"])
    chk("A9 dump 输出可回读", allowed_models_of(dump_allowed_models(["x/y"])), ["x/y"])
    chk("A10 dump(None) = None", dump_allowed_models(None), None)
    chk("A11 dump([]) = None", dump_allowed_models([]), None)
    chk("A12 策略行对象(enabled=1)", allowed_models_of(_Row('["a/b"]')), ["a/b"])
    chk("A13 策略行对象(enabled=0) = 不限制", allowed_models_of(_Row('["a/b"]', False)), None)

    # ── B/C/D. 真实 SQLite + 上游仓储 ────────────────────────────────────
    tmp = Path(tempfile.mkdtemp(prefix="m70-verify-"))
    dbfile = tmp / "octop.db"
    con = sqlite3.connect(dbfile)
    con.executescript(SCHEMA)
    con.commit()
    con.close()

    pool = SqlitePool(dbfile)
    repo = UserPolicyRepo(pool)

    chk("B1 无策略 = 不限制", effective_allowed_models(repo, 1), None)

    # 模拟"角色模板复制到用户"
    repo.merge(1, {POLICY_ALLOWED_MODELS: dump_allowed_models(["openai/gpt-4o", "deepseek/deepseek-chat"])})
    chk(
        "B2 白名单写入后可读回",
        effective_allowed_models(repo, 1),
        ["openai/gpt-4o", "deepseek/deepseek-chat"],
    )
    row = repo.get(1, POLICY_ALLOWED_MODELS)
    chk("B3 落库为 enabled 行", row is not None and row.enabled, True)
    chk(
        "B4 落库值为 JSON 字符串",
        row.value,
        '["openai/gpt-4o", "deepseek/deepseek-chat"]',
    )
    chk("B5 其它用户不受影响", effective_allowed_models(repo, 2), None)

    # 与既有策略共存
    repo.merge(1, {POLICY_TOKEN_QUOTA: "500"})
    fields = public_policy_fields(repo.list_for_user(1))
    chk("D1 HTTP 暴露 allowed_models", fields["allowed_models"], ["openai/gpt-4o", "deepseek/deepseek-chat"])
    chk("D2 HTTP 暴露 token_quota", fields["token_quota"], 500)
    chk("D3 HTTP 暴露未设置的策略为 None", fields["max_agents"], None)

    # 角色切换语义：全量替换 → 清空回退到"不限制"
    repo.merge(1, {POLICY_ALLOWED_MODELS: None})
    chk("C1 清空后 = 不限制", effective_allowed_models(repo, 1), None)
    cleared = repo.get(1, POLICY_ALLOWED_MODELS)
    chk("C2 清空是禁用行而非删除行", cleared is not None and cleared.enabled is False, True)
    chk("C3 清空不影响其它策略", public_policy_fields(repo.list_for_user(1))["token_quota"], 500)

    # ── 输出 ─────────────────────────────────────────────────────────────
    failed = 0
    for ok, name, got, want in _results:
        if ok:
            print(f"[PASS] {name}")
        else:
            failed += 1
            print(f"[FAIL] {name}\n         got ={got!r}\n         want={want!r}")
    total = len(_results)
    print(f"\n{'=' * 60}\n{total - failed}/{total} passed")
    if failed:
        print("RESULT: HAS FAILURES")
        return 1
    print("RESULT: ALL PASS")
    return 0


class _Row:
    """最小 UserPolicyRow 替身（只用到 enabled / value 两个属性）。"""

    def __init__(self, value: str, enabled: bool = True) -> None:
        self.value = value
        self.enabled = enabled


if __name__ == "__main__":
    raise SystemExit(main())
