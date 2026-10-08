#!/usr/bin/env python3
"""把 ZBSwork 品牌包应用到一份上游 Octop 源码树（幂等，可重复执行）。

用法:
    uv run --with pyyaml brand/apply.py --tree <上游源码根目录>

规则全部来自 brand/brand.yaml。任何一条文字规则在目标文件中找不到原文且也没有
已替换的结果时，返回非 0 —— 说明上游改了原文，需要人工更新 brand.yaml。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")


def load_spec() -> dict:
    return yaml.safe_load((ROOT / "brand" / "brand.yaml").read_text(encoding="utf-8"))


def copy_slots(spec: dict, tree: Path) -> list[str]:
    errors = []
    for slot, info in spec["slots"].items():
        for t in info["targets"]:
            src, dst = ROOT / t["from"], tree / t["to"]
            if not src.is_file():
                errors.append(f"[{slot}] 素材缺失: {t['from']}")
                continue
            if not dst.parent.is_dir():
                errors.append(f"[{slot}] 上游目标目录不存在: {t['to']}")
                continue
            if dst.is_file() and dst.read_bytes() == src.read_bytes():
                continue
            shutil.copyfile(src, dst)
            print(f"[asset] {t['to']}")
    return errors


def apply_text(spec: dict, tree: Path) -> list[str]:
    errors = []
    for rel, rules in spec["text"].items():
        f = tree / rel
        if not f.is_file():
            errors.append(f"[text] 上游文件不存在: {rel}")
            continue
        raw = f.read_bytes().decode("utf-8")
        new = raw
        for rule in rules:
            old, rep = rule[0], rule[1]
            replace_all = len(rule) > 2 and rule[2] == "all"
            if old in new:
                new = new.replace(old, rep) if replace_all else new.replace(old, rep, 1)
            elif rep not in new:
                errors.append(f"[text] 规则未命中: {rel} :: {old!r}")
        if new != raw:
            f.write_bytes(new.encode("utf-8"))
            print(f"[text ] {rel}")
    return errors


def apply_locales(spec: dict, tree: Path) -> list[str]:
    errors = []
    old_word, new_word = spec["upstream_name"], spec["name"]
    keep = spec["locales"].get("keep", [])

    def fix(node):
        if isinstance(node, dict):
            return {k: fix(v) for k, v in node.items()}
        if isinstance(node, list):
            return [fix(v) for v in node]
        if isinstance(node, str) and old_word in node:
            out = node
            for i, k in enumerate(keep):
                out = out.replace(k, f"\x00{i}\x00")
            out = out.replace(old_word, new_word)
            for i, k in enumerate(keep):
                out = out.replace(f"\x00{i}\x00", k)
            return out
        return node

    for rel in spec["locales"]["files"]:
        f = tree / rel
        if not f.is_file():
            errors.append(f"[i18n] 语言包不存在: {rel}")
            continue
        raw = f.read_text(encoding="utf-8")
        out = json.dumps(fix(json.loads(raw)), ensure_ascii=False, indent=2) + "\n"
        if out != raw:
            f.write_bytes(out.encode("utf-8"))
            print(f"[i18n ] {rel}")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tree", required=True, help="上游 Octop 源码根目录")
    tree = Path(ap.parse_args().tree).resolve()
    if not (tree / "dashboard").is_dir() or not (tree / "desktop").is_dir():
        print(f"[ERROR] 不像 Octop 源码根目录: {tree}")
        return 2
    spec = load_spec()
    errors = copy_slots(spec, tree) + apply_text(spec, tree) + apply_locales(spec, tree)
    for e in errors:
        print(f"[ERROR] {e}")
    print("品牌应用失败，见上方错误。" if errors else "品牌应用完成。下一步: brand/check.py")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())