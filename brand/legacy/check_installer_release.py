#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""安装包发布门禁（check_installer_release.py）

事故驱动（2026-09-28 b5 新机死机）：静态品牌门禁 + go 测试不覆盖"安装完成页默认自动运行"
"运行时首启行为"这类发布属性。本门禁检查安装器的发布行为与一致性，与品牌门禁互补。

用法：python scripts/check_installer_release.py
"""
import sys
from pathlib import Path

SRC = Path(r"D:\SelfHosted\Octop-b4\desktop\src")
results = []


def check(name, ok, note=""):
    results.append((name, bool(ok), note))


# 1. 完成页自动运行必须默认不勾（新机首启风暴防护）
nsi = (SRC / "build/windows/nsis/project.nsi").read_text(encoding="utf-8")
check("NSIS 完成页自动运行默认不勾", "MUI_FINISHPAGE_RUN_NOTCHECKED" in nsi)
check("NSIS RUN 路径含分隔符", '"$INSTDIR\\${PRODUCT_EXECUTABLE}"' in nsi)

# 2. portable 运行时依赖不含重 ML 包（嵌入/OCR 属服务端镜像职责）
req = (SRC.parent / "portable/requirements-windows-amd64.txt").read_text(encoding="utf-8", errors="ignore").lower()
heavy = [w for w in ("fastembed", "rapidocr", "onnxruntime", "torch", "pymupdf") if w in req]
check("portable 依赖无重 ML 包", not heavy, f"命中: {heavy}" if heavy else "")

# 3. 品牌门禁脚本存在且通过过（引用检查）
check("桌面品牌门禁脚本在位", (Path(r"D:\SelfHosted\ZBSwork-OCTOP-service") / "scripts/check_desktop_branding.py").exists())

# 4. 版本资源与 NSIS defines 无 Octop 残留（元数据二道防线）
info = (SRC / "build/windows/info.json").read_text(encoding="utf-8")
nsh = (SRC / "build/windows/nsis/wails_tools.nsh").read_text(encoding="utf-8")
check("info.json 品牌干净", "Octop" not in info)
check("wails_tools.nsh 品牌干净", "Octop" not in nsh)

failed = [(n, note) for n, ok, note in results if not ok]
for name, ok, note in results:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({note})" if note else ""))
print(f"\n门禁结果：{len(results) - len(failed)}/{len(results)} 通过")
sys.exit(1 if failed else 0)
