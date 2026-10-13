# 21 · 按用户文件夹：活动范围支持 {username}（默认进开关指定的后端、普通用户不能改运行方式）

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（Octop 服务端 7 个文件） |
| 状态 | enabled |
| 实测 | v1.0.2b6 严格 apply 通过；本机单元测试通过；临时环境 zt026 真实接口实测通过（见 `_work\ZT-026\step3\报告-A.md`） |
| 上游 PR | 否——ZBS 自有的权限收紧策略，上游官方无意向 |
| 依据 | 指挥部任务 ZT-026 任务单 F3–F5（日志 10-13 #206–#208）；决策人 10-13 改定：不做 Docker 沙箱，改用官方本地 Shell + 按用户的活动范围 |

## 做法（2026-10-13 决策人改定，取代旧的 Docker 沙箱方案）

不用 Docker 沙箱。用官方现成的**本地 Shell 后端**（`kind=shell`），把它的活动范围
（`root_dir`）设成"服务器数据目录下每个用户自己的文件夹"，例如
`/data/.octop/users/{username}`。同一个用户的所有 Agent 都落在这个文件夹里
（官方自动把每个 Agent 的工作目录建在 `<root_dir>/.octop/workspaces/<agent_id>`，
见 `infra/agents/workspace/dir.py:seed_workspace_dir_on_create`：`root_dir` 既非空
也非 `/` 即触发 scoped workspace）。`inherit_env` 设为 `false`，Agent 的命令看不到
Octop 进程身上的口令样环境变量。

总调度已在临时环境实测这种配法满足决策人的 4 个目标（依据 `原始输出\28`、`29`）。

## 问题（源码事实，上游 v1.0.2b6）

1. **普通用户可以把自己的 Agent 改回不隔离**：`src/octop/api/routers/agents.py`
   `patch_agent` 对 `config.backend` 只做 `assert_user_backend_root_dirs`
   （`api/common/validators.py`，仅校验本地后端 `root_dir` 黑名单/用户策略），
   不拦"运行方式"本身的切换——实测（`原始输出\29` 末尾）普通用户一击即中，
   把 Agent 的 `root_dir` 改成 `/` 或别人目录都返回 200。
2. **新建 Agent 的运行方式完全由请求决定**：所有创建入口（REST 直接建、专家模板、
   市场、已发布专家、团队、新用户默认 Agent、CLI）全部收敛到唯一落库点
   `AgentManager.create`（`infra/agents/manager.py`），请求不指定时落官方默认
   本地后端（`infra/backend/resolver.py:default_agent_backend_spec`）。
3. **官方本地 Shell 的 named 后端带不了运行方式参数**：`row_to_backend_spec`
   （`infra/backend/adapter.py`）的 `kind=shell` 分支只产出 `root_dir`、
   `virtual_mode`，不认 `inherit_env`、`env`。围栏里没有证书目录，命令访问 https
   失败（`原始输出\29` 第 18–20 项）。管理员无法在后端里给围栏命令指明证书位置。

## 修法

一个全站开关：settings 表键 `agent_enforced_backend`，值 = 管理员在官方"存储后端"
（`storage_backends` 表）里配好的一个 **kind=shell** 的后端名字。空/缺省 = 关。

- **F4（默认进开关指定的后端）**：`AgentManager.create` 里，开关开启且 Agent 主人
  （`spec.user_id`）是非管理员时，不管请求带什么 `config.backend`，落库一律覆写为
  开关指定的后端**展开后的 local_shell spec**（在 `_enforced_user_sandbox_backend` 里
  用 `row_to_backend_spec` 把 named 后端展开成 local_shell，并就地解析 `{username}` 为
  Agent 主人用户名）。展开成具体 spec 而非 named 引用，是因为 `seed_workspace_dir_on_create`
  只对 `local_shell`/`filesystem` 的 scoped `root_dir` 生效——展开后它会把 Agent 工作目录
  建在 `<root_dir>/.octop/workspaces/<agent_id>`（即 `/data/.octop/users/<用户名>/.octop/workspaces/<id>`），
  落库 workspace_dir 为 `/.octop/workspaces/<id>`（agent-facing）。覆盖全部新建入口
  （收敛点唯一，只改一处）。管理员建给自己的 Agent 不受影响；管理员替普通用户代建的
  Agent 落该用户的后端（主人是普通用户）。
- **F5（普通用户不能改运行方式）**：`PATCH /api/agents/{id}` 里，开关开启、用户非管理员
  且 Agent 主人是普通用户时，请求 `config` 里的 `backend` 与库中现值不同 → 403。相同或
  未带 `backend` → 照常。`config` 带了但**缺** `backend` 键也拒绝（官方 patch 是整包替换，
  缺键会把运行方式静默改回官方默认，属于"改了运行方式"的一种）。管理员改任何 Agent 照常。
  覆盖决策人点的四种写法：把 `root_dir` 改成别人的文件夹、改成 `/`、改 `inherit_env`、
  换成别的类型——全部拒绝（见单元测试 `test_patch_blocks_*`）。
- **F3（活动范围按用户）**：`row_to_backend_spec`（`adapter.py`）的 `kind=shell` 分支
  透传 `inherit_env`、`env`（harness `_build_local_shell` 认这两个键并传给
  `HarnessLocalShellBackend` / `BubbledLocalShellBackend`）。`{username}` 占位符在
  `_prepare_docker_backend`（`manager.py`，对 local_shell 后端复用此入口）里按 Agent
  主人用户名展开（`root_dir` 和 `env` 的值都展开）。占位符只对 local_shell/filesystem
  后端生效；无 username（全局 Agent）时不展开（原样保留，harness 会显式报错，不静默错挂）。
  **用户名安全处理**：占位符替换的是 `user_repo.get(user_id).username`——用户名在创建
  时由 `UserManager.create` 校验，官方只允许 `[A-Za-z0-9_-]` 之外的字符在注册时就被拒
  （见 `infra/users/manager.py` 的 `_USERNAME_RE`），所以替换后不会含 `/`、`\`、`..`
  或空，不会跳出上级目录。补丁不另加转义，复用官方这个既有约束。

**开关的管理接口**：官方没有管理员自由写 settings 键的通用通道，所以本补丁加
GET/PUT `/api/settings/agent-sandbox`（沿用官方 `require_permission("storage_backends")`
权限门，与"存储后端"管理页同权），读写上述 settings 键。PUT 校验名字必须是存在的、
`kind=shell`、`enabled` 的后端，返回当前生效值。这也是管理员"不改代码就能开关"的通道。

## 改了哪些官方文件

| 文件 | 函数/位置 | 改动 |
|---|---|---|
| `src/octop/infra/backend/adapter.py` | `row_to_backend_spec` 的 `kind=shell` 分支 | 透传 `inherit_env`、`env`（cfg 提供）；root_dir 仍允许 `{username}` 占位符（在 manager 展开时解析） |
| `src/octop/infra/backend/docker_spec.py` | `enrich_docker_backend_spec` + 新增 `resolve_username_placeholder` | `{username}` 占位符展开（root_dir / env 值）；删掉上一版 Docker 方案的 volumes 占位符 |
| `src/octop/infra/agents/manager.py` | `_prepare_docker_backend` + `_enforced_user_sandbox_backend` | F4 覆写（展开 named 后端为 local_shell spec + 解析 {username}）；运行时 local_shell 后端 {username} 展开 |
| `src/octop/infra/users/resource_policy.py` | 新增 `enforced_sandbox_backend_name` / `user_row_is_admin` 与键常量 | 开关读取（F4/F5 共用） |
| `src/octop/api/common/validators.py` | 新增 `assert_user_may_change_backend` | F5 校验 |
| `src/octop/api/routers/agents.py` | `patch_agent` | 调用 F5 校验 |
| `src/octop/api/routers/settings.py` | 文件尾新增两个路由 | 开关 GET/PUT |
| `tests/unit/test_storage_spec.py` | 追加测试 | adapter 透传 inherit_env/env、占位符解析 |
| `tests/unit/agents/test_user_sandbox_policy.py` | 新文件（16 个测试） | F4/F5/开关 + 四种改运行方式写法 |

## 怎么开关（管理员一步步配）

1. 管理员在官方管理页"存储后端"（或 API `POST /api/admin/storage-backends`）配一个
   **kind=shell** 的后端，例如名字 `per-user-home`，`config_json` 写：
   ```json
   {"root_dir": "/data/.octop/users/{username}", "inherit_env": false, "env": {"SSL_CERT_FILE": "/etc/ssl/certs/ca-certificates.crt"}}
   ```
   - `root_dir` 里的 `{username}` 会按 Agent 主人用户名替换。
   - `inherit_env: false` 让围栏命令看不到 Octop 进程的口令样环境变量。
   - `env` 里的 `SSL_CERT_FILE` 解决围栏里访问 https 的问题（围栏只带进了 `/usr /bin /lib /lib64`，
     没有证书目录；指到围栏里 `/usr` 下能看到的证书文件即可，实测见报告实测 1）。
2. 开：`PUT /api/settings/agent-sandbox`，body `{"name": "per-user-home"}`；
   关：body `{"name": null}`（或空串）。GET 同路径读当前值。
3. 也可直接写 settings 表：键 `agent_enforced_backend`，值 = 后端名字；删键/置空 = 关。

## 与上一版（Docker 沙箱方案）的差别

| 项 | 上一版（补丁 21 原版） | 本版 |
|---|---|---|
| 做法 | Docker 沙箱，每用户一个容器 | 官方本地 Shell + 按用户的 root_dir |
| 开关指向的后端类型 | `kind=docker`，`sandbox_scope=user` | `kind=shell` |
| `{username}` 占位符 | volumes 卷名（`octop_sbx_{username}`） | root_dir / env 值（`/data/.octop/users/{username}`） |
| 改的官方文件数 | 5（manager / docker_spec / resource_policy / validators / agents / settings） | 7（多了 adapter.py；docker_spec 改法不同但同文件） |
| inherit_env / env | 不涉及（Docker 沙箱自带最小环境） | 透传到本地 Shell 后端（解决 https 证书、口令隔离） |
| F4 / F5 | 同 | 同（F5 补了四种写法测试） |

## 删除条件

ZBS 停用"按用户文件夹"策略（决策人明说不再要求普通用户强制进隔离后端）时删除本模块；
编号 21 作废不再使用。

## 生产注意

- 开关打开只影响**之后**创建/修改的落库值；存量 Agent 不自动迁移（那是任务单 F6 迁移脚本的事）。
- 主服务容器必须加 `SYS_ADMIN` 和 `seccomp=unconfined` 两项权限（不加，Agent 命令在围栏里跑不了——
  `bwrap` 建 namespace 会 `Operation not permitted`；见 `原始输出\28` C 段）。
- 关掉开关后一切行为与官方完全一致：覆写和校验函数开头都先读开关，未设置直接返回。
