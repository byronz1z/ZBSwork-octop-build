#!/usr/bin/env python3
"""Apply ZBSwork branding to an Octop dashboard source tree.

Usage:
    python apply_branding.py --dashboard <path-to-octop-repo>/dashboard

Idempotent: safe to run multiple times. Run after every upstream version
merge (see docs/品牌替换规范.md), BEFORE docker build.
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

OPS_ROOT = Path(__file__).resolve().parent.parent
ASSETS = OPS_ROOT / "branding" / "dashboard-public"

TEXT_REPLACEMENTS = {
    "index.html": [
        (r"<title>Octop</title>", "<title>ZBSwork</title>"),
        (r'content="Octop"', 'content="ZBSwork"'),
    ],
    "public/manifest.json": [
        (r'"name":\s*"Octop"', '"name": "ZBSwork"'),
        (r'"short_name":\s*"Octop"', '"short_name": "ZBSwork"'),
    ],
    "src/components/PwaInstallPrompt/index.tsx": [
        (r"将 Octop 安装为 App", "将 ZBSwork 安装为 App"),
        (r'(\} Octop」)', "} ZBSwork」"),
        (r"Install Octop", "Install ZBSwork"),
    ],
    "src/pages/Login/index.tsx": [
        (r'alt="Octop"', 'alt="ZBSwork"'),
    ],
    "src/layouts/Sidebar.tsx": [
        (r'alt="Octop"', 'alt="ZBSwork"'),
    ],
    "src/pages/Setup/index.tsx": [
        (r'alt="Octop"', 'alt="ZBSwork"'),
    ],
}

# Locale (i18n) files: replace user-visible "Octop" in VALUES only — never in
# keys. External product names (OctopBot, OpenClaw) are preserved.
LOCALE_KEEP = ("OctopBot", "OpenClaw")
LOCALE_FILES = ["src/locales/zh.json", "src/locales/en.json"]


def apply_locales(dashboard: Path) -> int:
    import json
    changed = 0
    for rel in LOCALE_FILES:
        f = dashboard / rel
        if not f.is_file():
            print(f"[WARN] locale file missing (upstream moved it?): {f}")
            continue

        def fix(node):
            if isinstance(node, dict):
                return {k: fix(v) for k, v in node.items()}
            if isinstance(node, list):
                return [fix(v) for v in node]
            if isinstance(node, str) and "Octop" in node:
                new = node
                for keep in LOCALE_KEEP:
                    new = new.replace(keep, "\x00").replace("Octop", "ZBSwork").replace("\x00", keep)
                return new
            return node

        data = json.loads(f.read_text(encoding="utf-8"))
        fixed = fix(data)
        out = json.dumps(fixed, ensure_ascii=False, indent=2) + "\n"
        if out != f.read_text(encoding="utf-8"):
            f.write_text(out, encoding="utf-8", newline="\n")
            print(f"[i18n] {f}")
            changed += 1
    return changed

ASSET_FILES = [
    "pwa-512.png", "pwa-192.png", "apple-touch-icon.png",
    "logo_horizontal_dark.png", "logo_horizontal_white.png",
    "favico.svg", "logo_vertical_dark.svg", "logo_vertical_white.svg",
]


def apply(dashboard: Path) -> int:
    if not dashboard.is_dir():
        print(f"[ERROR] dashboard dir not found: {dashboard}")
        return 2
    changed = 0

    # 1) copy brand assets over public/
    pub = dashboard / "public"
    pub.mkdir(exist_ok=True)
    for name in ASSET_FILES:
        src = ASSETS / name
        if not src.is_file():
            print(f"[ERROR] missing asset in ops repo: {src}")
            return 2
        dst = pub / name
        if dst.is_file() and dst.read_bytes() == src.read_bytes():
            continue
        shutil.copyfile(src, dst)
        print(f"[asset] {dst}")
        changed += 1

    # 2) text replacements
    for rel, rules in TEXT_REPLACEMENTS.items():
        f = dashboard / rel
        if not f.is_file():
            print(f"[WARN] target file missing (upstream moved it?): {f}")
            continue
        text = f.read_text(encoding="utf-8")
        new = text
        for pat, rep in rules:
            new = re.sub(pat, rep, new)
        if new != text:
            f.write_text(new, encoding="utf-8", newline="\n")
            print(f"[text ] {f}")
            changed += 1

    changed += apply_locales(dashboard)

    print(f"\nDone. {changed} file(s) updated/changed.")
    print("Next: python scripts/check_branding.py --dashboard <path>  →  must be CLEAN before docker build.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dashboard", required=True, help="path to Octop repo's dashboard/ directory")
    args = ap.parse_args()
    return apply(Path(args.dashboard))


if __name__ == "__main__":
    sys.exit(main())
