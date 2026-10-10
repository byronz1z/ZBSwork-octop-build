#!/usr/bin/env python3
"""验证 build_image.py 产出的镜像：逐条打印 PASS/FAIL 和具体数字，任何 FAIL 退出码非 0。

用法:
    python shared/tools/verify_image.py <镜像名> [--reference <本机官方克隆>]

不传 --reference 时，用 build_image.py / prepare_lf.py 已准备好的施工树
（.work/src，官方仓库克隆 + 补丁 + 品牌，带官方 tag）作为官方比对来源，
不写死任何本机路径；--reference 只是提供另一份官方克隆加速。

检查项:
  1. /app/src/octop 与官方 tag 的 src/octop 逐字节比对：
     - 只在镜像一边的文件只允许是网页成品（src/octop/dashboard/），出现在别处判 FAIL；
     - 与官方不同的文件，与施工树（官方 + 补丁 + 品牌，git 对象取内容）同路径逐字节相同才算通过，
       与官方不同且与施工树也不同判 FAIL。
  2. 镜像入口脚本 == 施工树入口脚本（官方 + 补丁 10），按原始字节比（不做换行转换）
  3. cvm-ai-doctor 技能目录在镜像里是符号链接（官方 git 树 mode 120000）
  4. dashboard 的 index.html 标题为品牌名；施工树 brand_check 通过
  5. antiword 可执行；系统 python3 12 包导入且版本等于钉版；venv 2 包同（均在原样镜像上测）
  6. manager.py 等于官方原件；wrapper/__init__.py 以官方树为准（官方无则要求不存在）
  7. 镜像标签齐全且值正确：cn.zbswork.context.sha256 与现场重做的源码包 sha256 相等才算 PASS
     （用 build_image.py 的同一个 context_tar() 函数重做，这就是"可复现"的检查）
  8. 冒烟：import octop 输出 ok
"""
from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SERVER = ROOT / "server"
sys.path.insert(0, str(ROOT / "shared" / "tools"))
import prepare  # noqa: E402
import recipe_rev  # noqa: E402
import build_image  # noqa: E402  复用其 context_tar()（源码包生成，镜像标签核对用同一函数）
import yaml  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

SYMLINK_PATH = "src/octop/infra/agents/experts/library/cvm-cluster-doctor/skills/cvm-ai-doctor"
MANAGER_PATH = "src/octop/infra/agents/manager.py"
WRAPPER_PATH = "src/octop/infra/agents/wrapper/__init__.py"
ENTRYPOINT = "/usr/local/bin/docker-entrypoint.sh"

SYS_PY_PKGS = {
    "cairosvg": "2.9.1", "jieba": "0.42.1", "markdown": "3.11", "openpyxl": "3.1.5",
    "pandas": "3.0.6", "send2trash": "2.1.0", "olefile": "0.47", "matplotlib": "3.11.2",
    "xlrd": "2.0.2", "rapidocr_onnxruntime": "1.4.4", "vtracer": "0.6.15", "python_docx": "1.2.0",
}
VENV_PKGS = {"pandas": "3.0.6", "rapidocr_onnxruntime": "1.4.4"}

failures: list[str] = []


def verdict(ok: bool, label: str, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def run(cmd, cwd=None):
    """一律 bytes 捕获（镜像里可能返回二进制），调用方自行 decode。"""
    return subprocess.run(cmd, cwd=cwd, capture_output=True)


def out(cmd, cwd=None) -> str:
    r = run(cmd, cwd=cwd)
    if r.returncode:
        raise RuntimeError(f"命令失败: {' '.join(cmd)}\n{r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8", "replace").strip()


def docker_engine() -> str:
    if run(["docker", "version", "--format", "{{.Server.Version}}"]).returncode == 0:
        return "docker"
    if run(["podman", "version", "--format", "{{.Server.Version}}"]).returncode == 0:
        return "podman"
    raise RuntimeError("docker / podman 都不可用")


class GitTree:
    """只读访问官方克隆的某个 tag：ls-tree / cat-file，不依赖 Windows 检出。"""

    def __init__(self, repo: str, ref: str):
        self.repo, self.ref = repo, ref

    def ls(self, prefix: str) -> dict[str, tuple[str, str]]:
        """返回 {path: (mode, sha)}，prefix 下全部 blob/symlink（递归）。"""
        r = run(["git", "-C", self.repo, "ls-tree", "-r", self.ref, "--", prefix])
        d = {}
        for line in r.stdout.decode().splitlines():
            mode, typ, sha, path = re.split(r"[ \t]+", line, maxsplit=3)
            if typ == "blob":
                d[path] = (mode, sha)
        return d

    def entry(self, path: str) -> tuple[str, str] | None:
        r = run(["git", "-C", self.repo, "ls-tree", self.ref, "--", path])
        line = r.stdout.decode().strip()
        if not line:
            return None
        mode, typ, sha, _ = re.split(r"[ \t]+", line, maxsplit=3)
        return mode, sha

    def blob(self, sha: str) -> bytes:
        return subprocess.run(["git", "-C", self.repo, "cat-file", "blob", sha],
                              check=True, capture_output=True).stdout


def extract_image_tree(engine: str, image: str) -> dict[str, tarfile.TarInfo]:
    raise NotImplementedError  # 已由 main() 内联的 docker cp tar 取代


def tar_bytes(tf_entries, tar_raw: bytes, name: str) -> bytes:
    with tarfile.open(fileobj=io.BytesIO(tar_raw)) as tf:
        f = tf.extractfile(name)
        return f.read() if f else b""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--reference", help="本机官方克隆（可选加速）；不传时用施工树 .work/src 作为官方比对来源")
    args = ap.parse_args()
    temp_containers: list[str] = []
    try:
        return _verify(args, temp_containers)
    finally:
        # 成功失败都清：现场重做的源码包、verify 自己建的临时容器
        # （临时容器一律先 rm -f；.work/verify-context.tar 不入库，用完即删）
        try:
            engine = docker_engine()
        except RuntimeError:
            engine = None
        for cid in list(temp_containers):
            if engine:
                run([engine, "rm", "-f", cid])
            temp_containers.remove(cid)
        p = ROOT / ".work" / "verify-context.tar"
        if p.exists():
            try:
                p.unlink()
            except OSError as e:
                print(f"[warn] 未能删除 {p}: {e}")


def _verify(args, temp_containers: list[str]) -> int:
    engine = docker_engine()
    lock, modules = prepare.load("UPSTREAM.lock"), prepare.load("modules.yaml")
    tag = lock["tag"]
    version = (SERVER / "VERSION").read_text(encoding="utf-8").strip()
    ver = f"{tag.lstrip('v')}-{version}"

    # 官方比对来源：--reference 的本机克隆；或施工树 .work/src（官方仓库克隆 + 补丁 + 品牌，
    # 带官方 tag），不写死任何本机路径。施工树不在（如云端刚 checkout）就现场用 prepare_lf.py
    # 准备一份——build_image.py / prepare_lf.py 已经准备好的那份就是官方仓库的克隆。
    work_src = ROOT / ".work" / "src"
    if not (work_src / ".git").is_dir():
        print("[info] .work/src 施工树不存在，先准备（prepare_lf.py，同 build_image.py）...")
        r = subprocess.run([sys.executable, str(ROOT / "shared" / "tools" / "prepare_lf.py"),
                            "--work", str(work_src)] +
                           (["--reference", args.reference] if args.reference else []),
                           cwd=ROOT, text=True)
        if r.returncode:
            print("[ERROR] prepare_lf.py 准备施工树失败")
            return 1
    upstream_repo = args.reference or str(work_src)
    upstream_ref = tag
    gt = GitTree(upstream_repo, upstream_ref)
    upstream_commit = out(["git", "-C", upstream_repo, "rev-parse", f"{tag}^{{commit}}"])
    # 版本锁核对：官方 tag 实际指向的提交必须等于 UPSTREAM.lock 的 commit（与 build_image.py 同一条核对）
    lock_ok = upstream_commit == lock["commit"]
    # 检查 7 期望的 revision 与 build_image.py 打标签用同一个函数算（recipe_rev.py），
    # 两处不各写各的。
    recipe_rev_sha = recipe_rev.recipe_revision()
    brand = yaml.safe_load((SERVER / "brand" / "brand.yaml").read_text(encoding="utf-8"))
    brand_name = brand["name"]

    # 从镜像取 /app/src：docker create + cp 成 tar 文件（-a 保留链接为链接，
    # 不落地到 Windows 工作区，绕开 symlink 权限），内存解析供检查 1/3/6 用
    print(f"[info] 从镜像 {args.image} 取 /app/src ...")
    cid = out([engine, "create", args.image]).strip()
    temp_containers.append(cid)
    try:
        r = subprocess.run([engine, "cp", "-a", f"{cid}:/app/src/.", "-"],
                           capture_output=True)
    finally:
        run([engine, "rm", "-f", cid])
        temp_containers.remove(cid)
    if r.returncode:
        raise RuntimeError(f"docker cp 失败: {r.stderr.decode('utf-8', 'replace').strip()}")
    raw = r.stdout
    img_entries: dict[str, tarfile.TarInfo] = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
        for m in tf:
            n = m.name.lstrip("./")
            img_entries["app/src/" + n] = m
    img_octop = {n[len("app/"):]: m for n, m in img_entries.items() if n.startswith("app/src/octop/")}
    print(f"[info] 官方比对来源: {upstream_repo} @ {upstream_ref} ({upstream_commit[:12]})，镜像内 app/src 条目 {len(img_entries)} 个")
    if not lock_ok:
        print(f"[FAIL] 官方 tag {tag} 实际指向 {upstream_commit[:12]} != UPSTREAM.lock commit {lock['commit'][:12]}")
        failures.append("0. 版本锁核对")

    # ---- 检查 1: /app/src/octop 逐字节比对 ----------------------------------
    # 施工树（官方 + 补丁 + 品牌，即送进构建的那份）：用 git 对象取内容。
    # 现场先重做源码包（build_image.py 的同一个 context_tar()，含确定性提交），
    # 这样施工树 HEAD 就是"官方 + 补丁 + 品牌"的构建提交，且检查 7 可直接用其 sha256；
    # 检查 1 的"与官方不同"文件也拿它逐字节比。
    n_patches = build_image.n_enabled_patches(modules)
    rebuilt_tar = ROOT / ".work" / "verify-context.tar"
    rebuilt_sha = build_image.context_tar(work_src, rebuilt_tar, tag, version, n_patches)
    print(f"[info] 现场重做源码包: {rebuilt_tar}  sha256={rebuilt_sha}")
    tree_gt = GitTree(str(work_src), "HEAD")

    up = gt.ls("src/octop")
    img_map: dict[str, tarfile.TarInfo] = dict(img_octop)

    same = diff = 0
    diffs: list[str] = []          # 与官方不同且与施工树也不同 → FAIL
    same_as_tree: list[str] = []   # 与官方不同但与施工树逐字节相同 → PASS（补丁/品牌改动）
    missing: list[str] = []

    def img_content(name: str, info: tarfile.TarInfo) -> bytes:
        # cp 的 tar 顶层是 src 内容（app/src/ 前缀是 verify 自己加的）
        inner = name[len("src/"):]
        with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
            f = tf.extractfile("./" + inner)
            return f.read() if f else b""

    for path, (mode, sha) in sorted(up.items()):
        info = img_map.pop(path, None)
        if info is None or not (info.isfile() or info.issym()):
            missing.append(path)
            continue
        if mode == "120000":
            content = info.linkname.encode() if info.issym() else img_content(path, info)
        else:
            if not info.isfile():
                missing.append(path)
                continue
            content = img_content(path, info)
        if content == gt.blob(sha):
            same += 1
        else:
            e = tree_gt.entry(path)
            if e is not None and e[0] != "120000" and content == tree_gt.blob(e[1]):
                same_as_tree.append(path)
            else:
                diffs.append(path)

    # 只在镜像一边的文件：只允许是网页成品（dashboard/，Dockerfile 阶段 1 构建输出）
    only_img = sorted(k for k, m in img_map.items() if m.isfile() or m.issym())
    stray = [p for p in only_img if not p.startswith("src/octop/dashboard/")]
    print(f"[info] 官方 src/octop 文件数: {len(up)}；镜像侧: {len(up) + len(only_img)}")
    print(f"[info] 相同: {same}；补丁/品牌(同施工树): {len(same_as_tree)}；"
          f"与官方且施工树均不同: {len(diffs)}；只在镜像: {len(only_img)}（限 dashboard/）；"
          f"只在官方(镜像缺失): {len(missing)}")
    for name, lst in (("与官方且施工树均不同", diffs), ("与施工树同", same_as_tree),
                      ("只在镜像", only_img), ("只在官方", missing)):
        for x in lst[:20]:
            print(f"       [{name}] {x}")
        if len(lst) > 20:
            print(f"       [{name}] ... 共 {len(lst)} 个，仅列前 20")
    verdict(not diffs and not missing and not stray,
            "1. /app/src/octop 与官方逐字节一致（补丁/品牌改动须与施工树逐字节相同；镜像独有文件仅限 dashboard/）",
            f"相同 {same}/{len(up)}，同施工树 {len(same_as_tree)}，与官方且施工树均不同 {len(diffs)}，"
            f"缺失 {len(missing)}，dashboard 外的镜像独有文件 {len(stray)}" +
            (f"（如 {stray[:3]}）" if stray else ""))

    # ---- 检查 2: 入口脚本 == 施工树入口脚本（原始字节，不转换换行） ----------
    e_entry = tree_gt.entry("docker/docker-entrypoint.sh")
    tree_entry_bytes = tree_gt.blob(e_entry[1]) if e_entry else None
    r2 = subprocess.run([engine, "run", "--rm", "--entrypoint", "cat", args.image, ENTRYPOINT],
                        capture_output=True)
    img_entry = r2.stdout or b""
    ok = (r2.returncode == 0 and tree_entry_bytes is not None and img_entry == tree_entry_bytes)
    verdict(ok, "2. 镜像入口脚本 == 施工树入口脚本（原始字节）",
            f"镜像字节 {len(img_entry)}，施工树字节 {len(tree_entry_bytes) if tree_entry_bytes else 0}"
            f"{'，逐字节相同' if ok and tree_entry_bytes else ''}")

    # ---- 检查 3: cvm-ai-doctor 是符号链接 ------------------------------------
    e = gt.entry(SYMLINK_PATH)
    info3 = img_entries.get("app/" + SYMLINK_PATH)
    verdict(e and e[0] == "120000" and info3 is not None and info3.issym(),
            "3. cvm-ai-doctor 在镜像里是符号链接",
            f"官方 mode={e[0] if e else '缺失'}，镜像 is_symlink={bool(info3 and info3.issym())}")

    # ---- 检查 4: dashboard 标题 + 施工树 brand_check -------------------------
    dash = img_entries.get("app/src/octop/dashboard/index.html")
    title = ""
    if dash and dash.isfile():
        m = re.search(r"<title>(.*?)</title>",
                      img_content("src/octop/dashboard/index.html", dash).decode("utf-8", "replace"))
        title = m.group(1) if m else ""
    r3 = run([sys.executable, str(ROOT / "shared" / "tools" / "brand_check.py"),
              "--tree", str(ROOT / ".work" / "src")])
    bc_ok = r3.returncode == 0 and "CLEAN" in (r3.stdout or b"").decode("utf-8", "replace")
    verdict(title == brand_name and bc_ok, "4. 网页成品标题为品牌名且施工树 brand_check 通过",
            f"title={title!r}（期望 {brand_name!r}），brand_check={'CLEAN' if bc_ok else 'FAIL'}")

    # ---- 检查 5: 工具与 Python 包 -------------------------------------------
    r = run([engine, "run", "--rm", "--entrypoint", "antiword", args.image, "-h"])
    verdict(r.returncode == 0, "5a. antiword 可执行")

    MODS = {"python_docx": "docx", "send2trash": "send2trash"}

    def versions(py: str, pkgs: dict[str, str]) -> tuple[dict, bytes]:
        r = run([engine, "run", "--rm", "--entrypoint", py, args.image, "-c",
                 "import importlib.metadata as m, json, sys; "
                 "print(json.dumps({k: m.version(k) for k in sys.argv[1:]}))", *pkgs])
        if r.returncode:
            return {"<run>": r.stderr.decode("utf-8", "replace").strip()[:200]}, b""
        try:
            return json.loads(r.stdout.decode().strip().splitlines()[-1]), r.stdout
        except Exception as ex:
            return {"<parse>": str(ex)}, r.stdout

    def import_probe(py: str, names: list[str]) -> str:
        """在原样镜像里直接跑 import 探针（不打 apt、不装任何库）。"""
        mods = [MODS.get(k, k) for k in names]
        code = ("import importlib,sys\n"
                "bad=[]\n"
                "for m in sys.argv[1:]:\n"
                "    try: importlib.import_module(m)\n"
                "    except Exception as e: bad.append(m+': '+type(e).__name__)\n"
                "print('IMPORT-OK' if not bad else 'IMPORT-BAD '+','.join(bad))")
        r = run([engine, "run", "--rm", "--entrypoint", py, args.image, "-c", code, *mods])
        lines = [ln for ln in (r.stdout or b"").decode("utf-8", "replace").strip().splitlines() if ln.strip()]
        return (lines[-1] if lines else "<no-output>")

    # 版本：裸镜像即可查（importlib.metadata 不需要加载原生依赖）
    v_sys, _ = versions("/usr/local/bin/python3", SYS_PY_PKGS)
    v_venv, _ = versions("/app/.venv/bin/python", VENV_PKGS)
    bad_sys = {k: f"{v_sys.get(k)} != {v}" for k, v in SYS_PY_PKGS.items() if v_sys.get(k) != v}
    bad_venv = {k: f"{v_venv.get(k)} != {v}" for k, v in VENV_PKGS.items() if v_venv.get(k) != v}

    imp_sys = import_probe("/usr/local/bin/python3", list(SYS_PY_PKGS))
    imp_venv = import_probe("/app/.venv/bin/python", list(VENV_PKGS))

    verdict(not bad_sys and imp_sys.startswith("IMPORT-OK"),
            "5b. 系统 python3 12 个包版本正确且可导入",
            f"版本{'齐' if not bad_sys else json.dumps(bad_sys, ensure_ascii=False)}；"
            f"导入(原样镜像): {imp_sys[:160]}")
    verdict(not bad_venv and imp_venv.startswith("IMPORT-OK"),
            "5c. /app/.venv 2 个包版本正确且可导入",
            f"版本{'齐' if not bad_venv else json.dumps(bad_venv, ensure_ascii=False)}；"
            f"导入(原样镜像): {imp_venv[:160]}")

    # ---- 检查 6: manager.py 原件 / wrapper 不存在 ----------------------------
    e = gt.entry(MANAGER_PATH)
    info6 = img_entries.get("app/" + MANAGER_PATH)
    ok_mgr = (e is not None and info6 is not None and info6.isfile()
              and img_content(MANAGER_PATH, info6) == gt.blob(e[1]))
    e2 = gt.entry(WRAPPER_PATH)
    info6b = img_entries.get("app/" + WRAPPER_PATH)
    ok_wrap = (info6b is None) if e2 is None else (
        info6b is not None and info6b.isfile() and img_content(WRAPPER_PATH, info6b) == gt.blob(e2[1]))
    verdict(ok_mgr, "6a. manager.py 等于官方原件")
    verdict(ok_wrap, "6b. wrapper/__init__.py 状态与官方树一致",
            f"官方 {'无此文件' if e2 is None else '有'}，镜像 {'无' if info6b is None else '有'}")

    # ---- 检查 7: 镜像标签 -----------------------------------------------------
    # cn.zbswork.context.sha256 不只查格式：上面已用 build_image.py 的同一个 context_tar()
    # 现场重做源码包，sha256 与标签值相等才 PASS——这就是"可复现"的检查。
    r = run([engine, "image", "inspect", args.image, "--format", "{{json .Config.Labels}}"])
    labels = json.loads(r.stdout.decode()) if r.returncode == 0 else {}
    expect = {
        "org.opencontainers.image.version": ver,
        "org.opencontainers.image.revision": recipe_rev_sha,
        "cn.zbswork.upstream.tag": tag,
        "cn.zbswork.upstream.commit": upstream_commit,
    }
    bad = {k: f"{labels.get(k)!r} != {v!r}" for k, v in expect.items() if labels.get(k) != v}
    if labels.get("cn.zbswork.context.sha256") != rebuilt_sha:
        bad["cn.zbswork.context.sha256"] = f"{labels.get('cn.zbswork.context.sha256')!r} != 现场重做 {rebuilt_sha!r}"
    verdict(not bad and lock_ok, "7. 镜像标签齐全且值正确（sha256 与现场重做的源码包相等 = 可复现）",
            json.dumps(bad, ensure_ascii=False) if bad else
            f"version={ver}, revision={recipe_rev_sha[:12]} (配方提交号: {recipe_rev.recipe_revision_line()})，"
            f"context.sha256={rebuilt_sha[:12]} 与现场重做一致")

    # ---- 检查 8: 冒烟 import octop -------------------------------------------
    r = run([engine, "run", "--rm", "--entrypoint", "/app/.venv/bin/python",
             args.image, "-c", "import octop; print('ok')"])
    o = (r.stdout or b"").decode("utf-8", "replace").strip()
    err = (r.stderr or b"").decode("utf-8", "replace").strip()
    verdict(r.returncode == 0 and "ok" in o, "8. 冒烟 import octop",
            o if r.returncode == 0 else err[-300:])

    print(f"\n结果: {'全部 PASS' if not failures else f'{len(failures)} 项 FAIL: ' + '; '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
