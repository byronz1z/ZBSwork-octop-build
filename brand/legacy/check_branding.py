#!/usr/bin/env python3
"""Audit a dashboard source tree for branding completeness.

Usage:
    python check_branding.py --dashboard <path-to-octop-repo>/dashboard

Checks:
  1. brand asset files byte-identical to ops-repo originals
  2. index.html title / apple-mobile-web-app-title == ZBSwork
  3. manifest.json name/short_name == ZBSwork
  4. NO user-visible "Octop" strings left in index.html / PwaInstallPrompt /
     Login / Header / Sidebar (type identifiers like OctopAgent are ignored)
  5. NEW image assets in public/ that upstream added (need re-branding?)

Exit code 0 = CLEAN (safe to docker build), 1 = findings, 2 = error.
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

OPS_ROOT = Path(__file__).resolve().parent.parent
ASSETS = OPS_ROOT / "branding" / "dashboard-public"

BRAND_FILES = [
    "pwa-512.png", "pwa-192.png", "apple-touch-icon.png",
    "logo_horizontal_dark.png", "logo_horizontal_white.png",
    "favico.svg", "logo_vertical_dark.svg", "logo_vertical_white.svg",
]

# user-visible Octop strings; ignore code identifiers (OctopAgent, OctopSpinner,
# X-Octop-Agent-Id, octop-* css/db names, octop-mascot files etc.)
VISIBLE_OCTOP = re.compile(
    r"(?<![A-Za-z0-9_-])Octop(?![A-Za-z0-9])"
)
SCAN_FILES = [
    "index.html",
    "public/manifest.json",
    "src/components/PwaInstallPrompt/index.tsx",
    "src/pages/Login/index.tsx",
    "src/layouts/Header.tsx",
    "src/layouts/Sidebar.tsx",
    "src/pages/Setup/index.tsx",
]

# locale values may contain Octop only inside external product names
LOCALE_KEEP = ("OctopBot", "OpenClaw")
LOCALE_FILES = ["src/locales/zh.json", "src/locales/en.json"]


def check_locales(dash: Path, problems: list) -> None:
    import json
    for rel in LOCALE_FILES:
        f = dash / rel
        if not f.is_file():
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            problems.append(f"{rel}: invalid JSON ({e})")
            continue

        def walk(node, path):
            if isinstance(node, dict):
                for k, v in node.items():
                    walk(v, f"{path}.{k}")
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, f"{path}[{i}]")
            elif isinstance(node, str):
                s = node
                for keep in LOCALE_KEEP:
                    s = s.replace(keep, "\x00")
                if "Octop" in s:
                    problems.append(f"{rel}: value at {path} still contains 'Octop' -> {node[:70]}")

        walk(data, rel.split("/")[-1].replace(".json", ""))
IMG_EXTS = {".png", ".svg", ".webp", ".ico", ".jpg"}


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:12]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dashboard", required=True)
    args = ap.parse_args()
    dash = Path(args.dashboard)
    if not dash.is_dir():
        print(f"[ERROR] not a directory: {dash}")
        return 2

    problems, notes = [], []

    # 1) assets
    pub = dash / "public"
    for name in BRAND_FILES:
        dst, src = pub / name, ASSETS / name
        if not dst.is_file():
            problems.append(f"asset missing: public/{name}")
        elif not src.is_file() or sha(dst.read_bytes()) != sha(src.read_bytes()):
            problems.append(f"asset differs from ops-repo original: public/{name}")

    # 2) title
    idx = dash / "index.html"
    if idx.is_file():
        t = idx.read_text(encoding="utf-8")
        if "<title>ZBSwork</title>" not in t:
            problems.append("index.html: <title> is not ZBSwork")
        if 'content="Octop"' in t:
            problems.append('index.html: apple-mobile-web-app-title still Octop')

    # 3) manifest
    mf = dash / "public" / "manifest.json"
    if mf.is_file():
        m = mf.read_text(encoding="utf-8")
        if '"name": "ZBSwork"' not in m or '"short_name": "ZBSwork"' not in m:
            problems.append("manifest.json: name/short_name not ZBSwork")

    # 4) visible Octop strings
    for rel in SCAN_FILES:
        f = dash / rel
        if not f.is_file():
            notes.append(f"scan target missing (upstream moved?): {rel}")
            continue
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if VISIBLE_OCTOP.search(line):
                problems.append(f"{rel}:{i}: visible 'Octop' -> {line.strip()[:90]}")

    # 4b) locale values
    check_locales(dash, problems)

    # 5) new image assets upstream may have added
    if pub.is_dir():
        for f in sorted(pub.iterdir()):
            if f.suffix.lower() in IMG_EXTS and f.name not in BRAND_FILES:
                notes.append(f"image asset outside brand set (review if logo-like): public/{f.name}")

    print("=" * 62)
    for p in problems:
        print(f"[FAIL] {p}")
    for n in notes:
        print(f"[note] {n}")
    print("=" * 62)
    print("RESULT:", "CLEAN — safe to docker build" if not problems else f"{len(problems)} problem(s) — FIX BEFORE BUILD")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
