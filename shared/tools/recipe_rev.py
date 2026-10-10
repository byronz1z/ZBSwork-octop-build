#!/usr/bin/env python3
"""配方提交号：最后一次改动配方输入（上游选取 + 补丁 + 品牌）的提交。

build_image.py 用 recipe_revision() 打 org.opencontainers.image.revision，
verify_image.py 检查 7 用同一个函数算期望值——两处不允许各写各的。

配方输入路径（RECIPE_PATHS）= 决定镜像内容的那批文件：
    server                     上游锁、模块清单、补丁、品牌配置
    shared/tools/prepare.py    补丁/品牌应用
    shared/tools/prepare_lf.py 上面那个的 LF + 符号链接版（构建实际用的）
    shared/tools/brand_apply.py 品牌套用
    shared/logo                品牌素材

构建工具自身（build_image.py / verify_image.py / 本文件）故意不在清单里：
代码总是构建之后才提交，若把工具也算进配方输入，提交号就会自我指涉，
检查 7 依旧对不上。记的是"配方输入最后一次被改的提交"，它早于构建时 HEAD，
这正是镜像真正对应的那份配方。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

RECIPE_PATHS = [
    "server",
    "shared/tools/prepare.py",
    "shared/tools/prepare_lf.py",
    "shared/tools/brand_apply.py",
    "shared/logo",
]


def _git(args: list[str], cwd=None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)} 失败: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8", "replace").strip()


def recipe_revision() -> str:
    """最后一次改动配方输入的提交号（完整 40 位 sha）。"""
    return _git(["log", "-1", "--format=%H", "--", *RECIPE_PATHS], cwd=ROOT)


def recipe_revision_line() -> str:
    """人读的一行："<短 sha> <主题>"，同 recipe_revision() 的那一次提交。"""
    return _git(["log", "-1", "--format=%h %s", "--", *RECIPE_PATHS], cwd=ROOT)


def recipe_dirty() -> list[str]:
    """配方输入在工作树里未提交的改动（git status --porcelain 原始行）；干净则空列表。"""
    return [ln for ln in _git(["status", "--porcelain", "--", *RECIPE_PATHS], cwd=ROOT).splitlines() if ln.strip()]