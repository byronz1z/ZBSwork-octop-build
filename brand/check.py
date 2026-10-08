#!/usr/bin/env python3
"""校验一份源码树是否已完整应用 ZBSwork 品牌包（只读，不改文件）。

用法:
    uv run --with pyyaml brand/check.py --tree <源码根目录>
    uv run --with pyyaml brand/check.py --self     # 只校验品牌包自身（素材齐全、已知缺陷）

检查项:
  1. 每个槽位目标文件与品牌素材逐字节一致
  2. 每条文字规则的替换结果存在于目标文件
  3. forbidden.scan 列表内的文件不再出现独立词 upstream_name（语言包排除 keep 词）
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def check_self(spec: dict) -> tuple[list[str], list[str]]:
    errors, warns = [], []
    for slot, info in spec["slots"].items():
        for key in ("source", "source_raster"):
            if key in info and not (ROOT / info[key]).is_file():
                errors.append(f"[{slot}] 母本缺失: {info[key]}")
        for t in info["targets"]:
            if not (ROOT / t["from"]).is_file():
                errors.append(f"[{slot}] 素材缺失: {t['from']}")
    vert = {t["to"].rsplit("/", 1)[-1]: ROOT / t["from"] for t in spec["slots"]["vertical"]["targets"]}
    a, b = vert.get("logo_vertical_dark.svg"), vert.get("logo_vertical_white.svg")
    if a and b and a.is_file() and b.is_file() and md5(a) == md5(b):
        warns.append("竖版 logo 深色主题变体(white)与浅色变体(dark)完全相同：深色背景下文字可能不可见，待补白字版素材")
    return errors, warns


def check_tree(spec: dict, tree: Path) -> list[str]:
    errors = []
    for slot, info in spec["slots"].items():
        for t in info["targets"]:
            dst = tree / t["to"]
            if not dst.is_file() or md5(dst) != md5(ROOT / t["from"]):
                errors.append(f"[{slot}] 素材未应用: {t['to']}")
    for rel, rules in spec["text"].items():
        f = tree / rel
        if not f.is_file():
            errors.append(f"[text] 文件不存在: {rel}")
            continue
        body = f.read_text(encoding="utf-8")
        for rule in rules:
            if rule[1] not in body:
                errors.append(f"[text] 未替换: {rel} :: {rule[1]!r}")
    word = spec["forbidden"]["word"]
    keep = spec["locales"].get("keep", [])
    pat = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(word)}(?![A-Za-z0-9_])")
    for rel in spec["forbidden"]["scan"]:
        f = tree / rel
        if not f.is_file():
            continue
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            scrub = line
            for k in keep:
                scrub = scrub.replace(k, "")
            if pat.search(scrub):
                errors.append(f"[residue] {rel}:{n}: {line.strip()[:120]}")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--tree")
    g.add_argument("--self", action="store_true")
    args = ap.parse_args()
    spec = yaml.safe_load((ROOT / "brand" / "brand.yaml").read_text(encoding="utf-8"))
    errors, warns = check_self(spec)
    if args.tree:
        errors += check_tree(spec, Path(args.tree).resolve())
    for w in warns:
        print(f"[WARN ] {w}")
    for e in errors:
        print(f"[FAIL ] {e}")
    print(f"结果: {'FAIL' if errors else 'CLEAN'}（{len(errors)} 错误, {len(warns)} 警告）")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())