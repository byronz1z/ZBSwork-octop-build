#!/usr/bin/env python3
"""一条命令出镜像：上游 tag + 启用补丁 + 品牌包 → git archive 源码包 → docker build。

用法:
    python shared/tools/build_image.py [--reference <本机官方克隆>] [--no-build] [--platform linux/amd64]

步骤:
  a. 用 prepare_lf.py（prepare.py 的 LF/符号链接版）准备施工树 .work/src
     （上游 tag + 补丁 + 品牌 + 品牌检查），并核对施工树 HEAD == UPSTREAM.lock 的 commit。
  b. 在施工树做一次确定性提交（作者/提交人/日期固定为上游 tag 提交的作者与日期），
     然后 git archive --format=tar HEAD 得到源码包 .work/context.tar 并打印 sha256。
     同样输入两次得到的 tar 逐字节相同（见 context_tar，verify_image.py 复用同一函数
     现场重做这份 tar 来核对镜像标签里的 sha256——这就是"可复现"的检查）。
  c. docker build：以 tar 流为构建上下文（subprocess 把 tar 文件作为 stdin 传入），
     打 OCI 标签。revision 标签记的是"配方提交号"（最后一次改动配方输入的提交，
     见 recipe_rev.py），不是构建时的 HEAD。--no-build 时只产出 context.tar。
  d. 打印镜像名、镜像编号、大小、源码包 sha256。
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SERVER = ROOT / "server"
WORK = ROOT / ".work"
sys.path.insert(0, str(ROOT / "shared" / "tools"))
import prepare  # noqa: E402
import recipe_rev  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

BUILD_ARGS = [
    "PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple",
    "PIP_TRUSTED_HOST=mirrors.cloud.tencent.com",
    "NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/",
    "APT_MIRROR=mirrors.cloud.tencent.com",
]


def run(cmd, cwd=None, check=True, capture=False, **kw):
    print("$ " + " ".join(str(c) for c in cmd))
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=capture, text=True, **kw)


def out(cmd, cwd=None) -> str:
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def context_tar(src: Path, tar_path: Path, tag: str, version: str, n_patches: int) -> str:
    """在施工树 src 做确定性提交并 git archive 出源码包，返回 sha256。

    build_image.py 出镜像与 verify_image.py 现场重做核对镜像标签，用的都是这一个函数
    （检查不允许各写各的）。重复调用可复现：先回滚到上游 tag 干净检出再套补丁/品牌
    （prepare_lf.py 刚跑完时 HEAD 已是 tag 检出 + 未提交改动，此时跳过回滚）。
    提交前把全称版本号（<官方版本>-<server/VERSION>，如 1.0.2b6-zbs2）写进施工树
    src/octop/zbs_version.txt（ZT-032 约定，页面版本号读它），两次调用写的内容相同。
    """
    r = subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"], capture_output=True, text=True)
    head = r.stdout.strip()
    if head != subprocess.run(
            ["git", "-C", str(src), "rev-parse", f"{tag}^{{commit}}"],
            capture_output=True, text=True).stdout.strip():
        # HEAD 已是历史构建提交：回滚到其父（上游 tag）重新套补丁/品牌
        run(["git", "-C", str(src), "reset", "-q", "--hard", f"{tag}^{{commit}}"])
        run(["git", "-C", str(src), "clean", "-qfdx"])
        for p in enabled_patch_ids():
            for f in sorted((SERVER / "patches" / p).glob("*.patch")):
                run(["git", "-C", str(src), "apply", "--whitespace=nowarn", str(f)])
        r_brand = run([sys.executable, str(ROOT / "shared" / "tools" / "brand_apply.py"),
                       "--tree", str(src)], check=False)
        if r_brand.returncode:
            raise RuntimeError("brand_apply.py 失败（重做源码包）")
    author = out(["git", "show", "-s", "--format=%an%x00%ae%x00%aI", tag], cwd=src).split("\x00")
    env = dict(os.environ,
               GIT_AUTHOR_NAME=author[0], GIT_AUTHOR_EMAIL=author[1], GIT_AUTHOR_DATE=author[2],
               GIT_COMMITTER_NAME=author[0], GIT_COMMITTER_EMAIL=author[1], GIT_COMMITTER_DATE=author[2])
    # 全称版本号写进施工树（在确定性提交之前，两种调用路径——prepare_lf 刚跑完或
    # 回滚重放补丁——都会走到这里），build 与 verify 重做的 tar 因此保持逐字节相同
    zbs_version = f"{tag.lstrip('v')}-{version}\n"
    (src / "src" / "octop" / "zbs_version.txt").write_text(zbs_version, encoding="utf-8", newline="\n")
    run(["git", "add", "-A"], cwd=src)
    subprocess.run(["git", "commit", "-q", "--allow-empty", "-m",
                    f"build: {tag} + {n_patches} patches + brand ({version})"],
                   cwd=src, check=True, env=env)
    with tar_path.open("wb") as f:
        subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=src, check=True, stdout=f)
    return sha256(tar_path)


def n_enabled_patches(modules: dict) -> int:
    return len([p for p in modules["patches"] if p.get("status") == "enabled"])


def enabled_patch_ids() -> list[str]:
    """启用补丁的 id（按 modules.yaml 的 order），context_tar() 重放补丁用。"""
    modules = prepare.load("modules.yaml")
    return [p["id"] for p in prepare.enabled_patches(modules)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", help="本机官方克隆（加速克隆；上游地址仍取自 UPSTREAM.lock）")
    ap.add_argument("--no-build", action="store_true", help="只生成 context.tar，不构建镜像")
    ap.add_argument("--platform", default=None, help="如 linux/amd64")
    ap.add_argument("--build-arg", action="append", default=[], help="额外 docker build --build-arg KEY=VAL")
    ap.add_argument("--no-mirror", action="store_true", help="不带国内镜像源构建参数（默认带腾讯云镜像源）")
    ap.add_argument("--builder", default="docker", choices=["docker", "podman"],
                    help="构建引擎（podman 时经由其 Windows 命名管道 npipe）")
    args = ap.parse_args()

    lock, modules = prepare.load("UPSTREAM.lock"), prepare.load("modules.yaml")
    tag = lock["tag"]
    version = (SERVER / "VERSION").read_text(encoding="utf-8").strip()
    image = f"octop:{tag.lstrip('v')}-{version}"
    # 镜像标签记"配方提交号"（最后一次改动配方输入的提交），不记构建时的 HEAD：
    # 代码总是构建之后才提交，记 HEAD 会让检查 7 永远对不上。定义见 recipe_rev.py。
    recipe_rev_sha = recipe_rev.recipe_revision()
    print(f"配方提交号: {recipe_rev_sha}  ({recipe_rev.recipe_revision_line()})")
    dirty = recipe_rev.recipe_dirty()
    if dirty:
        print("!" * 78)
        print(f"!! 警告：配方输入在工作树里有未提交的改动（{len(dirty)} 项），"
              f"镜像记的提交号 {recipe_rev_sha[:12]} 并不包含这些改动！")
        for ln in dirty[:20]:
            print(f"!!   {ln}")
        if len(dirty) > 20:
            print(f"!!   ... 共 {len(dirty)} 项，仅列前 20")
        print("!" * 78)

    src = WORK / "src"
    tar = WORK / "context.tar"
    log = WORK / "build.log"

    # a. 施工树（LF + 符号链接 + 品牌检查）
    r = run([sys.executable, str(ROOT / "shared" / "tools" / "prepare_lf.py"),
             "--work", str(src)] + (["--reference", args.reference] if args.reference else []),
            cwd=ROOT, check=False)
    if r.returncode:
        return r.returncode

    # a2. 版本锁核对：施工树实际检出的上游提交号必须等于 UPSTREAM.lock 的 commit。
    # prepare_lf 刚把施工树检出到 tag（补丁/品牌此刻还是未提交改动），HEAD 即上游提交。
    # 传不传 --reference 都走这一条核对（远端 tag 被移动/换 commit 即报错，不构建）。
    checked_out = out(["git", "-C", str(src), "rev-parse", "HEAD"])
    if checked_out != lock["commit"]:
        print(f"[ERROR] 版本锁核对失败：施工树检出的上游提交 {checked_out}")
        print(f"        != server/UPSTREAM.lock 的 commit {lock['commit']}（tag {tag}）")
        print("        不构建。请核对 UPSTREAM.lock（升级流程见其头注释）。")
        return 1
    print(f"版本锁核对: 施工树检出 {checked_out} == UPSTREAM.lock commit（{tag}）OK")
    # 核对过的实际提交号才是 upstream.commit 标签的值；--reference 与否不影响
    upstream_commit = checked_out

    # b. 确定性提交 + git archive（build 与 verify 共用 context_tar()，保证可复现）
    n_patches = n_enabled_patches(modules)
    digest = context_tar(src, tar, tag, version, n_patches)
    print(f"context.tar sha256: {digest}  ({tar.stat().st_size} bytes)")

    if args.no_build:
        print(f"[no-build] 镜像名将是 {image}")
        return 0

    # c. docker build（tar 流经 stdin 作为构建上下文）
    cmd = ["docker", "build", "-f", "docker/Dockerfile", "-t", image]
    if args.builder == "podman":
        # 本机 podman CLI + npipe 连接走 Podman Desktop 的 Linux 引擎
        #（Docker Desktop 的 docker engine 在本机构建大镜像时引擎会卡死重启，见 README 已知限制）
        engine = "podman"
    else:
        engine = "docker"
    cmd[0] = engine
    if args.platform:
        cmd += ["--platform", args.platform]
    for kv in ([] if args.no_mirror else BUILD_ARGS) + args.build_arg:
        cmd += ["--build-arg", kv]
    for k, v in {
        "org.opencontainers.image.version": f"{tag.lstrip('v')}-{version}",
        "org.opencontainers.image.revision": recipe_rev_sha,
        "cn.zbswork.upstream.tag": tag,
        "cn.zbswork.upstream.commit": upstream_commit,
        "cn.zbswork.context.sha256": digest,
    }.items():
        cmd += ["--label", f"{k}={v}"]
    cmd.append("-")

    t0 = time.time()
    print(f"[build] 日志写入 {log}，开始构建 {image} ...")
    with tar.open("rb") as fin, log.open("w", encoding="utf-8", errors="replace") as flog:
        proc = subprocess.Popen(cmd, stdin=fin, stdout=flog, stderr=subprocess.STDOUT)
        rc = proc.wait()
    dt = time.time() - t0
    if rc:
        print(f"[ERROR] docker build 失败（{dt/60:.1f} 分钟），见 {log}")
        return 1
    print(f"[build] 构建完成，耗时 {dt/60:.1f} 分钟")

    # d. 结果
    iid = out([engine, "image", "inspect", image, "--format", "{{.Id}}"])
    size = int(out([engine, "image", "inspect", image, "--format", "{{.Size}}"]))
    print(f"镜像名:   {image}")
    print(f"镜像编号: {iid}")
    print(f"大小:     {size/1e9:.2f} GB ({size} bytes)")
    print(f"源码包:   {tar}  sha256={digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
