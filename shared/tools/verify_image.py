#!/usr/bin/env python3
"""验证 build_image.py 产出的镜像：逐条打印 PASS/FAIL 和具体数字，任何 FAIL 退出码非 0。

用法:
    python shared/tools/verify_image.py <镜像名> [--reference <本机官方克隆>]

检查项:
  1. /app/src/octop 与官方 tag 的 src/octop 逐字节比对（不同必须为 0；
     只在镜像一边的列出不算失败；品牌改动单列并核对 brand.yaml 规则）
  2. 镜像入口脚本 == 施工树入口脚本（官方 + 补丁 10）
  3. cvm-ai-doctor 技能目录在镜像里是符号链接（官方 git 树 mode 120000）
  4. dashboard 的 index.html 标题为品牌名；施工树 brand_check 通过
  5. antiword 可执行；系统 python3 12 包导入且版本等于钉版；venv 2 包同
  6. manager.py 等于官方原件；wrapper/__init__.py 以官方树为准（官方无则要求不存在）
  7. 镜像标签齐全且值正确
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
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SERVER = ROOT / "server"
sys.path.insert(0, str(ROOT / "shared" / "tools"))
import prepare  # noqa: E402
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


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def out(cmd, cwd=None) -> str:
    r = run(cmd, cwd=cwd)
    if r.returncode:
        raise RuntimeError(f"命令失败: {' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout


def docker_engine() -> str:
    r = subprocess.run(["docker", "version", "--format", "{{.Server.Version}}"],
                       capture_output=True, text=True)
    if r.returncode == 0:
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
        for line in r.stdout.splitlines():
            mode, typ, sha, path = re.split(r"[ \t]+", line, maxsplit=3)
            if typ == "blob":
                d[path] = (mode, sha)
        return d

    def entry(self, path: str) -> tuple[str, str] | None:
        r = run(["git", "-C", self.repo, "ls-tree", self.ref, "--", path])
        if not r.stdout.strip():
            return None
        mode, typ, sha, _ = re.split(r"[ \t]+", r.stdout.strip(), maxsplit=3)
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
    ap.add_argument("--reference", default=r"D:\ZBS-Project\ZBSwork-octop\fork",
                    help="本机官方克隆（默认 D:\\ZBS-Project\\ZBSwork-octop\\fork）")
    args = ap.parse_args()
    engine = docker_engine()
    lock, modules = prepare.load("UPSTREAM.lock"), prepare.load("modules.yaml")
    tag = lock["tag"]
    version = (SERVER / "VERSION").read_text(encoding="utf-8").strip()
    ver = f"{tag.lstrip('v')}-{version}"
    gt = GitTree(args.reference, tag)
    upstream_commit = out(["git", "-C", args.reference, "rev-parse", tag])
    recipe_rev = out(["git", "rev-parse", "HEAD"], cwd=ROOT)
    brand = yaml.safe_load((SERVER / "brand" / "brand.yaml").read_text(encoding="utf-8"))
    brand_name = brand["name"]

    # 从镜像取 /app/src：docker create + cp 成 tar 文件（-a 保留链接为链接，
    # 不落地到 Windows 工作区，绕开 symlink 权限），内存解析供检查 1/3/6 用
    print(f"[info] 从镜像 {args.image} 取 /app/src ...")
    cid = out([engine, "create", args.image]).strip()
    try:
        r = subprocess.run([engine, "cp", "-a", f"{cid}:/app/src/.", "-"],
                           capture_output=True)
    finally:
        run([engine, "rm", "-f", cid])
    if r.returncode:
        raise RuntimeError(f"docker cp 失败: {r.stderr.decode('utf-8', 'replace').strip()}")
    raw = r.stdout
    img_entries: dict[str, tarfile.TarInfo] = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
        for m in tf:
            n = m.name.lstrip("./")
            img_entries["app/src/" + n] = m
    img_octop = {n[len("app/"):]: m for n, m in img_entries.items() if n.startswith("app/src/octop/")}
    print(f"[info] 官方比对来源: {args.reference} @ {tag} ({upstream_commit[:12]})，镜像内 app/src 条目 {len(img_entries)} 个")

    # ---- 检查 1: /app/src/octop 逐字节比对 ----------------------------------
    up = gt.ls("src/octop")
    img_map: dict[str, tarfile.TarInfo] = dict(img_octop)

    same = diff = 0
    diffs: list[str] = []
    branded: list[str] = []
    brand_targets = {t["to"] for s in brand["slots"].values() for t in s["targets"]}
    brand_targets |= set(brand["text"].keys()) | set(brand["locales"]["files"])

    def img_content(name: str, info: tarfile.TarInfo) -> bytes:
        # cp 的 tar 顶层是 src 内容（app/src/ 前缀是 verify 自己加的）
        inner = "app/" + name
        inner = inner[len("app/src/"):]
        with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
            f = tf.extractfile("./" + inner) or tf.extractfile(inner)
            return f.read() if f else b""

    for path, (mode, sha) in sorted(up.items()):
        info = img_map.pop(path, None)
        if info is None or not (info.isfile() or info.issym()):
            diffs.append(path)
            continue
        if mode == "120000":
            content = info.linkname.encode() if info.issym() else img_content(path, info)
        else:
            if not info.isfile():
                diffs.append(path)
                continue
            content = img_content(path, info)
        if content == gt.blob(sha):
            same += 1
        elif path in brand_targets:
            branded.append(path)
        else:
            diffs.append(path)

    only_img = sorted(k for k, m in img_map.items() if m.isfile() or m.issym())
    missing = sorted(p for p in up if p not in {**img_octop} and p not in branded)
    print(f"[info] 官方 src/octop 文件数: {len(up)}；镜像侧: {len(up) + len(only_img)}")
    print(f"[info] 相同: {same}；不同(非品牌): {len(diffs)}；品牌改动: {len(branded)}；"
          f"只在镜像: {len(only_img)}；只在官方(镜像缺失): {len(missing)}")
    for name, lst in (("不同(非品牌)", diffs), ("品牌改动", branded),
                      ("只在镜像", only_img), ("只在官方", missing)):
        for x in lst[:20]:
            print(f"       [{name}] {x}")
        if len(lst) > 20:
            print(f"       [{name}] ... 共 {len(lst)} 个，仅列前 20")
    ok_brand = all(b in brand_targets for b in branded)
    verdict(not diffs and ok_brand and not missing,
            "1. /app/src/octop 与官方逐字节一致（品牌改动除外）",
            f"相同 {same}/{len(up)}，非品牌不同 {len(diffs)}，缺失 {len(missing)}，品牌改动 {len(branded)} 均在 brand.yaml 规则内: {ok_brand}")

    # ---- 检查 2: 入口脚本 == 施工树入口脚本 ---------------------------------
    entry_tree = Path(tempfile.mkdtemp(prefix="verify-entry-"))
    r = run([sys.executable, str(ROOT / "shared" / "tools" / "prepare_lf.py"),
             "--work", str(entry_tree), "--no-brand", "--until", "60-svc-runtime-extras",
             "--reference", args.reference])
    tree_entry = entry_tree / "docker" / "docker-entrypoint.sh"
    r2 = run([engine, "run", "--rm", "--entrypoint", "cat", args.image, ENTRYPOINT])
    img_entry = (r2.stdout or "").encode().replace(b"\r\n", b"\n")
    tree_bytes = tree_entry.read_bytes() if tree_entry.is_file() else None
    ok = (r.returncode == 0 and tree_bytes is not None and img_entry == tree_bytes.replace(b"\r\n", b"\n"))
    verdict(ok, "2. 镜像入口脚本 == 施工树入口脚本（官方 + 补丁 10）",
            f"施工树 {'就绪' if r.returncode == 0 else '准备失败'}")

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
    bc_ok = r3.returncode == 0 and "CLEAN" in r3.stdout
    verdict(title == brand_name and bc_ok, "4. 网页成品标题为品牌名且施工树 brand_check 通过",
            f"title={title!r}（期望 {brand_name!r}），brand_check={'CLEAN' if bc_ok else 'FAIL'}")

    # ---- 检查 5: 工具与 Python 包 -------------------------------------------
    r = run([engine, "run", "--rm", "--entrypoint", "antiword", args.image, "-h"])
    verdict(r.returncode == 0, "5a. antiword 可执行")

    def pkg_check(py: str, pkgs: dict[str, str], label: str) -> None:
        names = list(pkgs)
        r = run([engine, "run", "--rm", "--entrypoint", py, args.image, "-c",
                 "import importlib.metadata as m, json, sys; "
                 "print(json.dumps({k: m.version(k) for k in sys.argv[1:]}))", *names])
        bad = {}
        if r.returncode == 0:
            try:
                got = json.loads(r.stdout.strip().splitlines()[-1])
                bad = {k: f"{got.get(k)} != {v}" for k, v in pkgs.items() if got.get(k) != v}
            except Exception as ex:
                bad = {"<parse>": str(ex)}
        else:
            bad = {"<run>": r.stderr.strip()[:200]}
        # 逐个导入验证
        imp_bad = []
        if not bad:
            mods = {"python_docx": "docx", "send2trash": "send2trash", "rapidocr_onnxruntime": "rapidocr_onnxruntime"}
            r = run([engine, "run", "--rm", "--entrypoint", py, args.image, "-c",
                     ";".join(f"import {mods.get(k, k)}" for k in names)])
            if r.returncode:
                imp_bad.append(r.stderr.strip()[-300:])
        verdict(not bad and not imp_bad, label,
                f"{len(pkgs)} 个包版本齐" if not bad else json.dumps(bad, ensure_ascii=False) + ("" if not imp_bad else f"；导入失败: {imp_bad[0]}"))

    pkg_check("/usr/local/bin/python3", SYS_PY_PKGS, "5b. 系统 python3 12 个包版本与导入")
    pkg_check("/app/.venv/bin/python", VENV_PKGS, "5c. /app/.venv 2 个包版本与导入")

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
    r = run([engine, "image", "inspect", args.image, "--format", "{{json .Config.Labels}}"])
    labels = json.loads(r.stdout) if r.returncode == 0 else {}
    expect = {
        "org.opencontainers.image.version": ver,
        "org.opencontainers.image.revision": recipe_rev,
        "cn.zbswork.upstream.tag": tag,
        "cn.zbswork.upstream.commit": upstream_commit,
    }
    bad = {k: f"{labels.get(k)!r} != {v!r}" for k, v in expect.items() if labels.get(k) != v}
    if not re.fullmatch(r"[0-9a-f]{64}", labels.get("cn.zbswork.context.sha256", "")):
        bad["cn.zbswork.context.sha256"] = f"非法: {labels.get('cn.zbswork.context.sha256')!r}"
    verdict(not bad, "7. 镜像标签齐全且值正确",
            json.dumps(bad, ensure_ascii=False) if bad else f"version={ver}, revision={recipe_rev[:12]}")

    # ---- 检查 8: 冒烟 import octop -------------------------------------------
    r = run([engine, "run", "--rm", "--entrypoint", "/app/.venv/bin/python",
             args.image, "-c", "import octop; print('ok')"])
    verdict(r.returncode == 0 and "ok" in r.stdout, "8. 冒烟 import octop",
            r.stdout.strip() if r.returncode == 0 else r.stderr.strip()[-300:])

    print(f"\n结果: {'全部 PASS' if not failures else f'{len(failures)} 项 FAIL: ' + '; '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
