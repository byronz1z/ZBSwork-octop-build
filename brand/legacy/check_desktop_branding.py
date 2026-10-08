#!/usr/bin/env python3
"""桌面壳品牌门禁 — 构建发布包前必须 PASS（见 docs/发布规范-版本基线与门禁.md）"""
import hashlib, re, sys, pathlib

SRC = pathlib.Path(r"D:/SelfHosted/Octop-b4/desktop/src")
MOTHER_ICON_MD5 = "0c8e0850d4984771a029955be7c44596"  # D:\SelfHosted\logo\icon-1024.png
errors, oks = [], []

def check(name, cond, detail=""):
    (oks if cond else errors).append(f"{'PASS' if cond else 'FAIL'}  {name}  {detail}")

# 1. 应用图标 = 官方母本
appicon = SRC / "build/appicon.png"
md5 = hashlib.md5(appicon.read_bytes()).hexdigest() if appicon.exists() else ""
check("appicon==母本", md5 == MOTHER_ICON_MD5, md5)

# 2. 官方 icon 已进 assets，吉祥物已移除
assets = SRC / "assets"
check("zbswork-icon.svg 存在", (assets / "zbswork-icon.svg").exists())
for f in ("octop-mascot-peek.webp", "octop-mascot-type.webp"):
    check(f"{f} 已移除", not (assets / f).exists())

# 3. 托盘图标存在且尺寸正确
try:
    from PIL import Image
    ti = Image.open(assets / "tray-icon.png"); tt = Image.open(assets / "tray-icon-template.png")
    check("tray-icon 96x96", ti.size == (96, 96), str(ti.size))
    check("tray-template 88x88", tt.size == (88, 88), str(tt.size))
except Exception as e:
    check("托盘图标可读", False, str(e))

# 4. 可见文案无 Octop 残留（大写品牌词）
for rel in ("assets/index.html", "desktop_copy.go", "main.go",
            "../portable/templates/README.txt", "../portable/templates/start.bat"):
    text = (SRC / rel).read_text(encoding="utf-8", errors="ignore")
    n = len(re.findall(r"\bOctop\b", text))
    check(f"无 Octop 残留: {rel}", n == 0, f"{n} 处")

# 5. HTML mascot 引用已切换
html = (SRC / "assets/index.html").read_text(encoding="utf-8", errors="ignore")
check("HTML 无 octop-mascot 引用", "octop-mascot" not in html)
check("HTML 引用官方 icon", "zbswork-icon.svg" in html)

# 6. 安装元数据
cfg = (SRC / "build/config.yml").read_text(encoding="utf-8")
check("config.yml 无 Octop", "Octop" not in cfg and "com.tencent.octop" not in cfg)
check("config.yml = ZBSwork", 'companyName: "ZBSwork"' in cfg and "com.zbswork.desktop" in cfg)

# 6b. 版本资源模板与 NSIS defines（b4 事故触点）
for rel in ("build/windows/info.json", "build/windows/nsis/wails_tools.nsh"):
    text = (SRC / rel).read_text(encoding="utf-8", errors="ignore")
    n = len(re.findall(r"\bOctop\b", text))
    check(f"无 Octop 残留: {rel}", n == 0, f"{n} 处")

# 7. 保留内部标识未被误伤（链路保护）
check("APP_NAME 保留(链路)", "APP_NAME: \"Octop\"" in (SRC / "Taskfile.yml").read_text(encoding="utf-8"))

print("\n".join(oks))
if errors:
    print("\n".join(errors))
    print(f"\n== GATE FAIL: {len(errors)} 项不通过 =="); sys.exit(1)
print(f"\n== GATE PASS: {len(oks)} 项全过 ==")
