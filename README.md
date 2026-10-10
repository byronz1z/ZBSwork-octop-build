# ZBSwork-octop-build

ZBSwork 的**配方库**：上游 [TencentCloud/Octop](https://github.com/TencentCloud/Octop) 的某个版本 + 少量补丁 + 品牌包 = ZBSwork。

- 上游镜像：[byronz1z/ZBSwork-octop](https://github.com/byronz1z/ZBSwork-octop)（纯镜像，不含自有改动）
- 当前锁定上游：`v1.0.2b4`（见 `server/UPSTREAM.lock`）；下一目标 `v1.0.2b6` 已预检通过

## 快速开始

```bash
# 需要 git 与 uv（https://docs.astral.sh/uv/）
uv run --no-project --with pyyaml shared/tools/prepare.py                 # 上游 + 补丁 + 品牌 → .work/src，并校验
uv run --no-project --with pyyaml shared/tools/prepare.py --check-only    # 只检查补丁能否应用（CI 用）
uv run --no-project --with pyyaml shared/tools/brand_check.py --self      # 只检查品牌包自身
uv run --no-project --with pyyaml shared/tools/check_ownership.py         # 模块隔离检查（CI 同款）
```

## 出镜像（2026-10-10 新增，ZT-018）

```bash
python shared/tools/build_image.py --reference <本机官方克隆>   # 一条龙：施工树 → context.tar → docker build
python shared/tools/verify_image.py octop:1.0.2b4-zbs1 --reference <本机官方克隆>
```

两个脚本都可不传 `--reference`：施工树 `.work/src` 本身就是官方仓库的克隆（带官方 tag），
不传时 verify 直接用它做比对来源，不写死任何本机路径（云端流程即如此运行）。

- **命名规则**：`octop:<上游 tag 去掉开头的 v>-<server/VERSION 内容>`，当前 = `octop:1.0.2b4-zbs1`。
- **施工树**：`shared/tools/prepare_lf.py`（prepare.py 的 LF/符号链接版；不改 prepare.py 现有参数行为，
  recipe-check.yml 不受影响）准备 `.work/src`，克隆/检出固定 `-c core.autocrlf=false -c core.eol=lf`，
  并把 git 里 mode 120000 的链接在 Windows 工作区恢复成真链接（失败只告警，不影响构建）。
- **构建上下文**：不是目录而是 `git archive --format=tar HEAD` 产出的 `.work/context.tar`
  （提交的作者/提交人/日期固定为上游 tag 提交的作者与日期，同输入两次 tar 逐字节相同；
  链接按 git 记录的类型打包）。`docker build -f docker/Dockerfile -t <镜像> -`，tar 由 stdin 传入。
- **本机实际构建参数**（网络走国内镜像源，官方 Dockerfile 自带的构建参数）：

  ```
  --build-arg PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
  --build-arg PIP_TRUSTED_HOST=mirrors.cloud.tencent.com
  --build-arg NPM_REGISTRY=https://mirrors.cloud.tencent.com/npm/
  --build-arg APT_MIRROR=mirrors.cloud.tencent.com
  ```

  加 `--no-mirror` 可不带这些；`--platform linux/amd64` 可指定平台。
- **标签**：`org.opencontainers.image.version / .revision`、`cn.zbswork.upstream.tag / .commit`、
  `cn.zbswork.context.sha256`。`.revision` 记**配方提交号**（最后一次改动配方输入的提交，定义见
  `shared/tools/recipe_rev.py`），不是构建时的 HEAD；`cn.zbswork.upstream.commit` 是经版本锁核对的
  施工树实际检出提交（等于 `server/UPSTREAM.lock` 的 commit，不等即报错不构建）；
  `cn.zbswork.context.sha256` 是源码包的 sha256，verify 时现场用同一个 `context_tar()` 函数重做
  源码包核对相等——这就是"可复现"的检查。
- **已知限制**：
  - 官方构建方式以 `v1.0.2b4:docker/Dockerfile`（头注释第 6–31 行：构建上下文为仓库根目录、
    dashboard 在 Dockerfile 阶段 1 内构建、四个国内加速 build-arg）与 `docker/docker_build.sh` 为准；
    本脚本只是把上下文从"目录"换成"等价的 git archive tar"。
  - Windows 未开开发者模式时工作区符号链接建不出来——不影响构建（上下文走 git archive），
    但人工直接查看 .work/src 时链接是文本文件。
  - 云端流程 `.github/workflows/build-image.yml` 2026-10-10 新增，尚未在云端运行过。
  - 本机一次完整构建约 5–7 分钟（镜像源加速 + 层缓存命中下），镜像约 5.2 GB（磁盘占用口径）。

## 文档

| 文档 | 内容 |
|---|---|
| **总览**（私有库 [ZBSwork-OCTOP-service](https://github.com/byronz1z/ZBSwork-OCTOP-service) → `docs/总览.md`） | 唯一总览：模块化规则（分层、编号、隔离）、全部目录树、当前状态 |
| [docs/协作规范.md](docs/协作规范.md) | AI 施工细则：Issue 流转、分支、升级/新功能/品牌流程、证据规则 |
| [docs/迁移说明.md](docs/迁移说明.md) | 旧体系资产去向 |
| [server/modules.yaml](server/modules.yaml) | 补丁清单（中文名、层级、状态、实测结果、共改文件登记） |
| [shared/tools/check_ownership.py](shared/tools/check_ownership.py) | 模块隔离门禁：同一上游文件只能有一个主人模块 |
| [shared/tools/recipe_rev.py](shared/tools/recipe_rev.py) | 配方提交号定义：最后一次改动配方输入（上游选取 + 补丁 + 品牌）的提交；build 打 revision 标签、verify 核对，共用这一个函数 |

## 当前模块

| 编号 | 中文名 | 状态 |
|---|---|---|
| brand | 品牌包（方形/横版/竖版 logo + 产品名；网页端 + 桌面端） | 启用（第一期扩充中，见 Issue） |
| 10 | PostgreSQL 模式重启死循环修复 | 启用（生产在用） |
| 60 | 镜像加装本地向量/OCR 依赖 | 启用（生产在用） |

第一期计划新增：`50-desk`（桌面端：写死服务器地址；以后的桌面需求也并入此模块）。
旧 AI 线产物未经用户确认，不占编号；代码只留在归档 tag `archive/2026-10/build-init` 供追溯，不作参考。

上游许可证：MIT（保留于上游源码 `LICENSE`）。