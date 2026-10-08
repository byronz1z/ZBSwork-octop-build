#!/usr/bin/env python3
"""准备施工树：上游锁定 tag + 启用补丁（按 order）+ 品牌包。

用法:
    uv run --no-project --with pyyaml tools/prepare.py [--tag v1.0.2b6] [--work .work/src] [--no-brand] [--check-only] [--reference <本地克隆>]

默认从 UPSTREAM.lock 读 tag，把上游源码检出到 .work/src（不进库）。
--check-only 只对每个补丁做 `git apply --check`，不改动工作树（CI 用）。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print("$ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=cwd, check=check, text=True)


def load(name: str) -> dict:
    return yaml.safe_load((ROOT / name).read_text(encoding="utf-8"))


def enabled_patches(modules: dict) -> list[dict]:
    items = [p for p in modules["patches"] if p.get("status") == "enabled"]
    return sorted(items, key=lambda p: p["order"])


def ensure_tree(work: Path, repo: str, tag: str, reference: str | None) -> None:
    if not (work / ".git").exists():
        work.parent.mkdir(parents=True, exist_ok=True)
        ref = ["--reference-if-able", reference] if reference else ["--filter=blob:none"]
        run(["git", "clone", *ref, "--no-checkout", repo, str(work)])
    run(["git", "fetch", "--tags", "origin"], cwd=work)
    run(["git", "checkout", "-q", "--detach", "-f", tag], cwd=work)
    run(["git", "reset", "-q", "--hard"], cwd=work)
    run(["git", "clean", "-qfdx"], cwd=work)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag")
    ap.add_argument("--work", default=str(ROOT / ".work" / "src"))
    ap.add_argument("--no-brand", action="store_true")
    ap.add_argument("--check-only", action="store_true")
    ap.add_argument("--reference", help="本地已有克隆（如 fork），加速首次克隆")
    ap.add_argument("--until", help="只应用 order 小于该模块的补丁（给该模块施工/重做时用）")
    ap.add_argument("--commit-base", action="store_true", help="应用后在施工树提交一次，打印其 SHA，作为 export.py 的 --base")
    args = ap.parse_args()

    lock, modules = load("UPSTREAM.lock"), load("modules.yaml")
    tag = args.tag or lock["tag"]
    work = Path(args.work).resolve()
    ensure_tree(work, lock["upstream_repo"], tag, args.reference)

    patches = enabled_patches(modules)
    if args.until:
        stop = next((p["order"] for p in modules["patches"] if p["id"] == args.until), None)
        if stop is None:
            print(f"[ERROR] modules.yaml 中没有 {args.until}")
            return 2
        patches = [p for p in patches if p["order"] < stop]
    failed = []
    for p in patches:
        for f in sorted((ROOT / "patches" / p["id"]).glob("*.patch")):
            mode = ["--check"] if args.check_only else []
            r = run(["git", "apply", "--whitespace=nowarn", *mode, str(f)], cwd=work, check=False)
            print(f"  {p['id']} / {f.name}: {'OK' if r.returncode == 0 else 'FAIL'}")
            if r.returncode:
                failed.append(f"{p['id']}/{f.name}")
    if failed:
        print("补丁失败: " + ", ".join(failed))
        return 1
    if args.check_only:
        print(f"全部补丁可严格应用到 {tag}")
        return 0
    if not args.no_brand:
        py = [sys.executable]
        if run(py + [str(ROOT / "brand" / "apply.py"), "--tree", str(work)], check=False).returncode:
            return 1
        if run(py + [str(ROOT / "brand" / "check.py"), "--tree", str(work)], check=False).returncode:
            return 1
    if args.commit_base:
        run(["git", "add", "-A"], cwd=work)
        run(["git", "-c", "user.name=prepare", "-c", "user.email=prepare@local", "commit", "-q",
             "--allow-empty", "-m", f"base: {tag} + {len(patches)} patches"], cwd=work)
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=work, capture_output=True, text=True).stdout.strip()
        print(f"BASE={sha}")
    print(f"施工树就绪: {work}  （上游 {tag} + {len(patches)} 个补丁"
          f"{'' if args.no_brand else ' + 品牌包'}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())