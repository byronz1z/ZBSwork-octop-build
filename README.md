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
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/总体方案与架构.md](docs/总体方案与架构.md) | 目标、功能分层、仓库与目录布局、品牌槽位、交付形态 |
| [docs/协作规范.md](docs/协作规范.md) | 角色、Issue 流转、分支命名、升级/新功能/品牌三条标准流程 |
| [docs/迁移说明.md](docs/迁移说明.md) | 旧体系资产去向 |
| [modules.yaml](modules.yaml) | 补丁清单（中文名、层级、状态、实测结果） |

## 当前模块

| 编号 | 中文名 | 状态 |
|---|---|---|
| brand | 品牌包（方形/横版/竖版 logo + 产品名） | 启用 |
| 10 | PostgreSQL 模式重启死循环修复 | 启用 |
| 20 | 模型按用户/角色分配 | 启用（待生产验收） |
| 50 | 桌面端云壳（默认连公司服务器） | 启用 |
| 51 | 桌面端窗口拉伸 | 候选 |
| 60 | 镜像加装本地向量/OCR 依赖 | 启用 |

上游许可证：MIT（保留于上游源码 `LICENSE`）。