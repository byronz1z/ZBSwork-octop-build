#!/usr/bin/env python3
"""从施工树导出一个模块的补丁（编码 agent 改完代码后用）。

约定：在施工树里为模块单独提交（git commit），然后：
    uv run --no-project --with pyyaml tools/export.py --module 50-desk --base <起点提交> [--work .work/src]

把 <起点提交>..HEAD 的差异写入 patches/<module>/ 下唯一的 .patch（覆盖；无则新建 0001-*.patch）。
<起点提交> 通常是“上游 tag + 排在它前面的补丁”应用完后的那次提交。
导出后请重新执行 tools/prepare.py --check-only 验证。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--module", required=True)
    ap.add_argument("--base", required=True)
    ap.add_argument("--work", default=str(ROOT / ".work" / "src"))
    args = ap.parse_args()
    out_dir = ROOT / "patches" / args.module
    if not out_dir.is_dir():
        print(f"[ERROR] 模块目录不存在: {out_dir}（先在 modules.yaml 登记并建目录）")
        return 2
    diff = subprocess.run(
        ["git", "diff", "--binary", "--full-index", f"{args.base}..HEAD"],
        cwd=args.work, check=True, capture_output=True,
    ).stdout
    if not diff.strip():
        print("[ERROR] 差异为空")
        return 1
    existing = sorted(out_dir.glob("*.patch"))
    if len(existing) > 1:
        print(f"[ERROR] {args.module} 下有多个补丁，请手工指定拆分方式")
        return 2
    out = existing[0] if existing else out_dir / f"0001-{args.module.split('-', 1)[1]}.patch"
    out.write_bytes(diff)
    print(f"已导出 {out.relative_to(ROOT)} ({len(diff)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())