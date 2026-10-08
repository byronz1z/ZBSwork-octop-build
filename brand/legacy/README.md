# brand/legacy —— 只读归档，不参与构建

这里是旧体系（service 库 `branding/`、`scripts/`）的品牌脚本与补丁，仅供追溯，**任何流程都不调用**。

| 文件 | 为什么不再使用 |
|---|---|
| `dashboard-branding.patch` | 【实测 2026-10-08】对 v1.0.2b4 / v1.0.2b6 均无法应用：二进制段只有 `Binary files differ`，没有实际数据 |
| `apply_branding.py`、`check_branding.py`、`check_desktop_branding.py`、`check_installer_release.py` | 写死 `D:\SelfHosted\...` 等本机路径；已由 `brand/brand.yaml` + `brand/apply.py` + `brand/check.py` 取代 |

现行品牌流程见 `docs/协作规范.md` 与 `brand/brand.yaml`。