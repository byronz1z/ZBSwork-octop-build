#!/usr/bin/env python3
"""把"上游 tag + 启用补丁 + 品牌包 + 品牌检查"落成 .work/src 施工树（python 直跑版）。

逻辑与 shared/tools/prepare.py 一致（复用其 ensure_tree / 补丁顺序 / 品牌脚本），
区别在两点，都是本任务的硬性要求：
  1. 克隆与检出全程 -c core.autocrlf=false -c core.eol=lf，保证工作区为 LF 换行；
  2. 检出后把 git 索引里 mode 120000 的链接重写成真正的符号链接（Windows 上
     core.symlinks=false 时 checkout 会把链接落成普通小文件，后续 docker build
     必须以 git 记录的类型为准；虽然构建上下文走 git archive 不经过工作区，
     这里仍保持一致，便于人工检查与 verify 比对）。

用法:
    python shared/tools/prepare_lf.py [--tag v1.0.2b6] [--work .work/src] [--no-brand] [--reference <本地克隆>]
"""
from __future__ import annotations

import argparse
import os
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "shared" / "tools"))
import prepare  # noqa: E402  复用 load/enabled_patches/brand 调用方式

sys.stdout.reconfigure(encoding="utf-8")
GIT_LF = ["git", "-c", "core.autocrlf=false", "-c", "core.eol=lf"]


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print("$ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=cwd, check=check, text=True)


def ensure_tree_lf(work: Path, repo: str, tag: str, reference: str | None) -> None:
    """prepare.ensure_tree 的 LF 版：克隆与检出固定 LF 换行。"""
    if not (work / ".git").exists():
        work.parent.mkdir(parents=True, exist_ok=True)
        ref = ["--reference-if-able", reference] if reference else ["--filter=blob:none"]
        run([*GIT_LF, "clone", *ref, "--no-checkout", repo, str(work)])
    # 克隆时若未带 LF 配置（如 prepare.py 先建过该目录），这里补上本地配置
    subprocess.run(["git", "config", "core.autocrlf", "false"], cwd=work, check=True)
    subprocess.run(["git", "config", "core.eol", "lf"], cwd=work, check=True)
    run([*GIT_LF, "fetch", "--tags", "origin"], cwd=work)
    run([*GIT_LF, "checkout", "-q", "--detach", "-f", tag], cwd=work)
    run([*GIT_LF, "reset", "-q", "--hard"], cwd=work)
    run([*GIT_LF, "clean", "-qfdx"], cwd=work)
    fix_symlinks(work)


def fix_symlinks(work: Path) -> None:
    """把索引里 mode 120000 的条目在工作区恢复为真正的符号链接。"""
    out = subprocess.run(
        ["git", "ls-files", "-s"], cwd=work, capture_output=True, text=True, check=True
    ).stdout
    for line in out.splitlines():
        meta, _, path = line.partition("\t")
        mode = meta.split()[0]
        if mode != "120000":
            continue
        target = subprocess.run(
            ["git", "cat-file", "-p", f":{path}"], cwd=work,
            capture_output=True, text=True, check=True,
        ).stdout
        p = work / path
        if p.is_symlink() and os.readlink(p) == target:
            continue
        if p.exists() or p.is_symlink():
            p.unlink()
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.symlink(target, p)
            print(f"[symlink] {path} -> {target}")
        except OSError as e:
            # Windows 未开开发者模式时创建链接会失败；构建上下文走 git archive，
            # 不依赖工作区链接，降级为写目标文本并告警。
            print(f"[WARN] 无法创建符号链接 {path}（{e}）；保留为目标文本文件，不影响 git archive 构建上下文")
            p.write_bytes(target.encode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag")
    ap.add_argument("--work", default=str(ROOT / ".work" / "src"))
    ap.add_argument("--no-brand", action="store_true")
    ap.add_argument("--reference", help="本地已有克隆（如 fork），加速首次克隆")
    ap.add_argument("--until", help="只应用 order 小于该模块的补丁")
    args = ap.parse_args()

    lock, modules = prepare.load("UPSTREAM.lock"), prepare.load("modules.yaml")
    tag = args.tag or lock["tag"]
    work = Path(args.work).resolve()
    ensure_tree_lf(work, lock["upstream_repo"], tag, args.reference)

    patches = prepare.enabled_patches(modules)
    if args.until:
        stop = next((p["order"] for p in modules["patches"] if p["id"] == args.until), None)
        if stop is None:
            print(f"[ERROR] modules.yaml 中没有 {args.until}")
            return 2
        patches = [p for p in patches if p["order"] < stop]
    failed = []
    for p in patches:
        for f in sorted((prepare.SERVER / "patches" / p["id"]).glob("*.patch")):
            r = run(["git", "apply", "--whitespace=nowarn", str(f)], cwd=work, check=False)
            print(f"  {p['id']} / {f.name}: {'OK' if r.returncode == 0 else 'FAIL'}")
            if r.returncode:
                failed.append(f"{p['id']}/{f.name}")
    if failed:
        print("补丁失败: " + ", ".join(failed))
        return 1
    if not args.no_brand:
        py = [sys.executable]
        if run(py + [str(ROOT / "shared" / "tools" / "brand_apply.py"), "--tree", str(work)], check=False).returncode:
            return 1
        if run(py + [str(ROOT / "shared" / "tools" / "brand_check.py"), "--tree", str(work)], check=False).returncode:
            return 1
    print(f"施工树就绪(LF): {work}  （上游 {tag} + {len(patches)} 个补丁"
          f"{'' if args.no_brand else ' + 品牌包'}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
