#!/usr/bin/env python3
"""模块隔离门禁：同一个上游文件只能有一个“主人”模块。

统计每个启用补丁改动的文件（解析 diff 头）和品牌包改动的文件（brand.yaml），
同一文件被两个以上模块改动时失败——除非 modules.yaml 的 shared_files 登记了主人与允许共改的模块。

用法:
    uv run --no-project --with pyyaml tools/check_ownership.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")
DIFF_HEAD = re.compile(r"^diff --git a/(\S+) b/(\S+)")


def patch_files(module_id: str) -> set[str]:
    files: set[str] = set()
    for patch in (ROOT / "patches" / module_id).glob("*.patch"):
        for line in patch.read_text(encoding="utf-8").splitlines():
            match = DIFF_HEAD.match(line)
            if match:
                files.update(match.groups())
    return files


def brand_files() -> set[str]:
    spec = yaml.safe_load((ROOT / "brand" / "brand.yaml").read_text(encoding="utf-8"))
    files = {t["to"] for slot in (spec.get("slots") or {}).values() for t in slot.get("targets", [])}
    files |= set((spec.get("text") or {}).keys())
    files |= set((spec.get("locales") or {}).get("files", []))
    return files


def main() -> int:
    modules = yaml.safe_load((ROOT / "modules.yaml").read_text(encoding="utf-8"))
    owners: dict[str, list[str]] = {}
    if (modules.get("brand") or {}).get("status") == "enabled":
        for path in brand_files():
            owners.setdefault(path, []).append("brand")
    for patch in modules.get("patches") or []:
        if patch.get("status") != "enabled":
            continue
        for path in patch_files(patch["id"]):
            owners.setdefault(path, []).append(patch["id"])

    shared = modules.get("shared_files") or {}
    problems = []
    for path, mods in sorted(owners.items()):
        if len(mods) < 2:
            continue
        rule = shared.get(path) or {}
        allowed = {rule.get("owner"), *rule.get("also", [])}
        if not rule or set(mods) - allowed:
            problems.append(f"{path}: 被 {', '.join(mods)} 同时修改，未在 modules.yaml shared_files 登记主人")
    print("\n".join(problems) or f"模块隔离 OK：{len(owners)} 个上游文件，各有唯一主人")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())