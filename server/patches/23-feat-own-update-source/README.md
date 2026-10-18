# 23 · 更新：项目地址指向配方库、页面只显示我们的版本号、关掉网页上官方的检查更新

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（补丁文件共 13 个文件：新文件 5 个 + 官方文件挂载点 8 个，其中 2 个文案文件、1 个官方测试） |
| 状态 | enabled |
| 实测 | v1.0.2b6：10 → 20 → 21 → 23 → 60 + 品牌包 严格套上（2026-10-16 prepare.py 全量建树 + brand_check 通过）；更新相关测试 68 passed |
| 上游 PR | 否——ZBS 自有发布方式 |
| 依据 | 指挥部任务 ZT-032（日志 10-16 #342 #343 #349 #353 #355 #362） |

## 为什么要这个模块

项目的新版本由我们自己构建、发布：配方库 → 出镜像 → 部署运维库换镜像 → 生产机。没有用户在网页上自助升级。官方网页却会去 PyPI 查官方 `octop` 包、提示"有新版本"、展示官方的升级命令；照做会装上不带我们改动的官方版。头像菜单的"项目地址"也指向官方仓库。

## 功能点（用户在哪看到）

| # | 在哪 | 以后 |
|---|---|---|
| 1 | 右上角头像 → "项目地址" | 打开 `https://github.com/byronz1z/ZBSwork-octop-build`（常量在 `dashboard/src/components/zbs/constants.ts`） |
| 2 | 侧边栏左上角版本标记；侧边栏"高级设置"（页面标题"应用设置"）→ "应用更新"标签 | 只显示我们的版本号，如 `ZBS0.3`；读不到版本号文件时（本机开发）显示官方版本号 |
| 3 | 同上 | 不再访问 PyPI；没有"有新版本"红点、检查更新按钮、升级按钮和官方升级命令；更新页上和更新无关的"重启服务"照旧（官方只在以系统服务方式安装时显示；我们的 Docker 部署里本来就不显示） |

## 做法（模块化：新代码进新文件，官方文件只留挂载点）

新文件（本补丁自己的）：
- `src/octop/infra/setup/zbs_version.py`：读 `src/octop/zbs_version.txt`、算显示版本号、组装"无更新"状态、拒绝网页升级。
- `dashboard/src/components/zbs/`：`constants.ts`（项目地址）、`ZbsVersionBadge.tsx`（版本标记）、`ZbsUpdateConfig.tsx`（更新页）。
- `tests/unit/infra/setup/test_zbs_version.py`。

官方文件挂载点：`AvatarDropdown.tsx`（地址常量引用、去掉菜单里的"检查更新"）、`Header.tsx`、`Sidebar.tsx`（换成 `ZbsVersionBadge`、去掉更新红点）、`UpdateConfig.tsx`（入口改为渲染 `ZbsUpdateConfig`，官方原实现保留）、`src/octop/api/routers/update.py`（`/status`、`/check`、`/upgrade` 三个入口交给新文件，官方辅助函数、升级工作函数、重启逻辑保留）、`tests/unit/api/test_update_router.py`（官方 20 个用例：12 个原样、8 个改为验证新行为）、中英文案新增 `zbsUpdate` 段。

版本号从哪来：出镜像工具 `shared/tools/build_image.py` 在打源码包前写 `src/octop/zbs_version.txt`（一行，`<官方版本>-<server/VERSION>`，如 `1.0.2b6-zbs0.3`）；验镜像工具 `shared/tools/verify_image.py` 认可"官方没有、但与施工树逐字节相同"的补丁新增文件（ZT-032，决策人 #362）。

版本号规则（决策人 #349 #355）：全称 = 官方版本 + 我们的版本，用于镜像名；我们的版本按"大改.加功能.修 bug"三段走，不随官方升级归零；页面只显示我们这段（`ZBS0.3`）。

## 边界（如实写明）

- 更新设置接口 `PATCH /api/update/settings` 官方代码仍在，无缓存时仍会走官方的 PyPI 查询；页面上已没有调用它的地方，员工和管理员在界面上走不到。
- 命令行 `octop update` 仍是官方行为（查 PyPI）；我们的部署不用这个命令。

## 删除条件

ZBS 不再自己发布版本、改回跟官方更新时删除本模块；编号 23 作废不再使用。
