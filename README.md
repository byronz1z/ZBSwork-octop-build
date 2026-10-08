# ZBSwork-octop-build

ZBSwork 的**配方库**：上游 [TencentCloud/Octop](https://github.com/TencentCloud/Octop) 的某个版本 + 少量补丁 + 品牌包 = ZBSwork。

- 上游镜像：[byronz1z/ZBSwork-octop](https://github.com/byronz1z/ZBSwork-octop)（纯镜像，不含自有改动）
- 当前锁定上游：`v1.0.2b4`（见 `UPSTREAM.lock`）；下一目标 `v1.0.2b6` 已预检通过

## 快速开始

```bash
# 需要 git 与 uv（https://docs.astral.sh/uv/）
uv run --no-project --with pyyaml tools/prepare.py                 # 上游 + 补丁 + 品牌 → .work/src，并校验
uv run --no-project --with pyyaml tools/prepare.py --check-only    # 只检查补丁能否应用（CI 用）
uv run --no-project --with pyyaml brand/check.py --self            # 只检查品牌包自身
uv run --no-project --with pyyaml tools/check_ownership.py         # 模块隔离检查（CI 同款）
```

## 文档

| 文档 | 内容 |
|---|---|
| **总览**（私有库 [ZBSwork-OCTOP-service](https://github.com/byronz1z/ZBSwork-OCTOP-service) → `docs/总览.md`） | 唯一总览：模块化规则（分层、编号、隔离）、全部目录树、当前状态 |
| [docs/协作规范.md](docs/协作规范.md) | AI 施工细则：Issue 流转、分支、升级/新功能/品牌流程、证据规则 |
| [docs/迁移说明.md](docs/迁移说明.md) | 旧体系资产去向 |
| [modules.yaml](modules.yaml) | 补丁清单（中文名、层级、状态、实测结果、共改文件登记） |
| [tools/check_ownership.py](tools/check_ownership.py) | 模块隔离门禁：同一上游文件只能有一个主人模块 |

## 当前模块

| 编号 | 中文名 | 状态 |
|---|---|---|
| brand | 品牌包（方形/横版/竖版 logo + 产品名；网页端 + 桌面端） | 启用（第一期扩充中，见 Issue） |
| 10 | PostgreSQL 模式重启死循环修复 | 启用（生产在用） |
| 60 | 镜像加装本地向量/OCR 依赖 | 启用（生产在用） |

第一期计划新增：`50-desk`（桌面端：写死服务器地址；以后的桌面需求也并入此模块）。
旧 AI 线产物未经用户确认，不占编号；代码只留在归档 tag `archive/2026-10/build-init` 供追溯，不作参考。

上游许可证：MIT（保留于上游源码 `LICENSE`）。