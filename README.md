# ZBSwork-octop-build

ZBSwork 的**配方库**：上游 [TencentCloud/Octop](https://github.com/TencentCloud/Octop) 的某个版本 + 少量补丁 + 品牌包 = ZBSwork。

- 上游镜像：[byronz1z/ZBSwork-octop](https://github.com/byronz1z/ZBSwork-octop)（纯镜像，不含自有改动）
- 当前锁定上游：`v1.0.2`（见 `server/UPSTREAM.lock`；ZT-036 官方升级）；
  `next_target` 暂空（无下一目标，不虚构）；补丁 10 自 ZT-036 起作废（官方已修，目录只留 README）

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
python shared/tools/verify_image.py octop:1.0.2-zbs0.4 --reference <本机官方克隆>
```

两个脚本都可不传 `--reference`：施工树 `.work/src` 本身就是官方仓库的克隆（带官方 tag），
不传时 verify 直接用它做比对来源，不写死任何本机路径（云端流程即如此运行）。

- **命名规则**：`octop:<上游 tag 去掉开头的 v>-<server/VERSION 内容>`，当前 = `octop:1.0.2-zbs0.4`。
  版本号（2026-10-16 决策人定）：全称 = 官方版本 + 我们的版本（如 `1.0.2b6-zbs0.3`），用于镜像名；
  我们的版本按"大改.加功能.修 bug"三段走（0.3 → 0.3.1 → 0.4），不随官方升级归零；
  网页上只显示我们这段（`ZBS0.3`，由出镜像工具写入 `src/octop/zbs_version.txt`，补丁 23 读取）。
  旧的 zbs1、zbs2 对应 0.1、0.2，已有镜像名不改。
  **ZBS0.3（2026-10-19，ZT-030、ZT-032）**：
  新功能（补丁 23）——头像菜单"项目地址"指向本配方库；页面只显示 ZBS 版本号；关掉网页上官方的检查更新和升级
  （不访问 PyPI，网页升级接口拒绝）；出镜像写版本号、验镜像认可补丁新增文件。
  修复（补丁 20）——名单里带"/"的模型存不进（400）；选"自动"时名单都不可用会改用全站模型；
  定时任务、后台记忆整理不看名单；网页对话被拒显示英文原文；批量设置成功提示缺翻译。
  优化——被拒、停下按场景提示："你没有使用这个模型的权限，请联系管理员。"
  "你可用的模型当前都无法使用，请联系管理员。"
  zbs2（0.2）= 2026-10-13 ZT-026：
  （2026-10-13 ZT-026 第 5 轮：补丁 21 改名 user-workspace 并加浏览器 file: 按用户分；
  补丁 60 加 0003 浏览器本体——序号 zbs1 → zbs2。本轮未构建镜像，待云端构建）。
  历史段：zbs1 = 2026-10-10 ZT-018（镜像加装本地向量/OCR 依赖 + 用户工具），经本机构建
  与 verify 验证（5.68 GB 磁盘占用口径），生产在用 `ghcr.io/byronz1z/octop:1.0.2b6-zbs1`。
- **施工树**：`shared/tools/prepare_lf.py`（prepare.py 的 LF/符号链接版；不改 prepare.py 现有参数行为，
  recipe-check.yml 不受影响）准备 `.work/src`，克隆/检出固定 `-c core.autocrlf=false -c core.eol=lf`，
  并把 git 里 mode 120000 的链接在 Windows 工作区恢复成真链接（失败只告警，不影响构建）。
- **构建上下文**：不是目录而是 `git archive --format=tar HEAD` 产出的 `.work/context.tar`
  （提交的作者/提交人/日期固定为上游 tag 提交的作者与日期，同输入两次 tar 逐字节相同；
  链接按 git 记录的类型打包）。`docker build -f docker/Dockerfile -t <镜像> -`，tar 由 stdin 传入。
- **只用官方源**（指挥部规范 §5，2026-10-19 ZT-033）：本机和云端都不传镜像源参数，官方 Dockerfile 的
  `PIP_INDEX_URL`、`NPM_REGISTRY`、`APT_MIRROR` 留空，即从 PyPI、npm、Debian 官方源下载；依赖版本由
  `uv.lock`、`package-lock.json` 锁定（带校验值）。不要用 `--build-arg` 传任何镜像源、中转站。
  `--platform linux/amd64` 可指定平台。
- **标签**：`org.opencontainers.image.version / .revision`、`cn.zbswork.upstream.tag / .commit`、
  `cn.zbswork.context.sha256`。`.revision` 记**配方提交号**（最后一次改动配方输入的提交，定义见
  `shared/tools/recipe_rev.py`），不是构建时的 HEAD；`cn.zbswork.upstream.commit` 是经版本锁核对的
  施工树实际检出提交（等于 `server/UPSTREAM.lock` 的 commit，不等即报错不构建）；
  `cn.zbswork.context.sha256` 是源码包的 sha256，verify 时现场用同一个 `context_tar()` 函数重做
  源码包核对相等——这就是"可复现"的检查。
- **已知限制**：
  - 官方构建方式以 `v1.0.2b4:docker/Dockerfile`（头注释第 6–31 行：构建上下文为仓库根目录、
    dashboard 在 Dockerfile 阶段 1 内构建、四个国内加速 build-arg——按指挥部规范 §5 我们一律不传）与 `docker/docker_build.sh` 为准；
    本脚本只是把上下文从"目录"换成"等价的 git archive tar"。
  - Windows 未开开发者模式时工作区符号链接建不出来——不影响构建（上下文走 git archive），
    但人工直接查看 .work/src 时链接是文本文件。
  - 云端流程 `.github/workflows/build-image.yml` 2026-10-10 新增，尚未在云端运行过。
  - 本机一次完整构建约 5–7 分钟（2026-10-10 当时走国内镜像源、层缓存命中下测得；2026-10-19 起只用官方源，2026-10-16 本机走官方源实测 5.9 分钟），镜像 5.68 GB（磁盘占用口径；2026-10-10 本机 `docker images` 显示值）。

## 文档

| 文档 | 内容 |
|---|---|
| **全景与规范**（项目的本机指挥部目录：`全景.md`、`规范.md`） | 全局结构、每一块的状况、和官方不一样的地方记录在指挥部目录的 `全景.md`；协作规则在同一目录的 `规范.md` |
| [docs/协作规范.md](docs/协作规范.md) | 一句指向说明：现行协作规则在指挥部目录的 `规范.md`，本文件原有内容已作废、留在版本历史里 |
| [docs/迁移说明.md](docs/迁移说明.md) | 旧体系资产去向 |
| [server/modules.yaml](server/modules.yaml) | 补丁清单（中文名、层级、状态、实测结果、共改文件登记） |
| [shared/tools/check_ownership.py](shared/tools/check_ownership.py) | 模块隔离门禁：同一上游文件只能有一个主人模块 |
| [shared/tools/recipe_rev.py](shared/tools/recipe_rev.py) | 配方提交号定义：最后一次改动配方输入（上游选取 + 补丁 + 品牌）的提交；build 打 revision 标签、verify 核对，共用这一个函数 |

## 当前模块

| 编号 | 中文名 | 状态 |
|---|---|---|
| brand | 品牌包（方形/横版/竖版 logo + 产品名；网页端 + 桌面端） | 启用（第一期扩充中，见 Issue） |
| 10 | PostgreSQL 模式重启死循环修复 | 启用（生产在用） |
| 20 | 按角色/用户的可用模型名单；接口对非管理员不返回模型密钥 | 启用（未部署） |
| 21 | 按用户文件夹：活动范围 {username}、浏览器 file: 按用户分 | 启用（未部署） |
| 60 | 镜像加装本地向量/OCR 依赖 + 用户工具 + 浏览器本体 | 启用（0001 生产在用；0002/0003 未部署） |

桌面端是单独一条线 `desk/`（与 `server/` 并列），尚未建立；按全景，不再叫 50 号。
旧 AI 线产物未经用户确认，不占编号；代码只留在归档 tag `archive/2026-10/build-init` 供追溯，不作参考。

上游许可证：MIT（保留于上游源码 `LICENSE`）。