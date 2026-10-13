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
- **fail-closed（第 4 轮按审核第 1 轮意见补上）**：开关指向的后端被管理员删掉或停用时，
  普通用户新建 Agent 不再"记一条 warning 然后悄悄退回官方默认"（那样隔离没了没人知道），
  而是报清楚错误（`WORKSPACE_OP_UNSUPPORTED`：后端不存在/已停用，请找管理员修开关或关掉
  开关）。管理员不受影响（自己的 Agent 本来就不走强制后端路径，照常建）。
- **F3（活动范围按用户）**：`row_to_backend_spec`（`adapter.py`）的 `kind=shell` 分支
  透传 `inherit_env`、`env`（harness `_build_local_shell` 认这两个键并传给
  `HarnessLocalShellBackend` / `BubbledLocalShellBackend`）。`{username}` 占位符在
  `_prepare_docker_backend`（`manager.py`，对 local_shell 后端复用此入口）里按 Agent
  主人用户名展开（`root_dir` 和 `env` 的值都展开）。占位符只对 local_shell/filesystem
  后端生效；无 username（全局 Agent）时不展开（原样保留，harness 会显式报错，不静默错挂）。
  **用户名安全处理**（第 4 轮按源码事实补上）：官方 `infra/users/manager.py` 建用户
  **只检查用户名非空**（`UserManager.create` 抛 `USERNAME_TAKEN`/"username must not be
  empty"），没有任何字符集正则；模块级的 `_USERNAME_ALLOWED`（`[^a-zA-Z0-9_.-]`）只用于
  SSO 自动分配用户名时剔除字符，不是创建校验——演练库里就存在中文用户名。因此补丁
  自己把关：`docker_spec.username_safe_for_placeholder` 判定用户名安全（非空、非全空白、
  不等于 `.` 或 `..`、不含 `/` 或 `\`、不含控制字符），`resolve_username_placeholder`
  对不安全用户名一律不展开；`_enforced_user_sandbox_backend` 在新建 Agent 展开占位符
  时遇到不安全用户名直接报错（`WORKSPACE_OP_UNSUPPORTED`，提示找管理员改名），绝不落
  官方默认后端。其余用户名（含中文、中间带点如 `john.doe`）原样使用，不加别的限制。

**开关的管理接口**：官方没有管理员自由写 settings 键的通用通道，所以本补丁加
GET/PUT `/api/settings/agent-sandbox`（沿用官方 `require_permission("storage_backends")`
权限门，与"存储后端"管理页同权），读写上述 settings 键。PUT 校验名字必须是存在的、
`kind=shell`、`enabled` 的后端，返回当前生效值。这也是管理员"不改代码就能开关"的通道。

## 改了哪些官方文件

| 文件 | 函数/位置 | 改动 |
|---|---|---|
| `src/octop/infra/backend/adapter.py` | `row_to_backend_spec` 的 `kind=shell` 分支 | 透传 `inherit_env`、`env`（cfg 提供）；root_dir 仍允许 `{username}` 占位符（在 manager 展开时解析） |
| `src/octop/infra/backend/docker_spec.py` | `enrich_docker_backend_spec` + 新增 `resolve_username_placeholder` / `username_safe_for_placeholder` | `{username}` 占位符展开（root_dir / env 值）；不安全用户名（空、`.`/`..`、`/`、`\`、控制字符）不展开 |
| `src/octop/infra/agents/manager.py` | `_prepare_docker_backend` + `_enforced_user_sandbox_backend` | F4 覆写（展开 named 后端为 local_shell spec + 解析 {username}；用户名不安全或后端不存在/停用时新建报错 fail-closed）；运行时 local_shell 后端 {username} 展开 |
| `src/octop/infra/users/resource_policy.py` | 新增 `enforced_sandbox_backend_name` / `user_row_is_admin` 与键常量 | 开关读取（F4/F5 共用） |
| `src/octop/api/common/validators.py` | 新增 `assert_user_may_change_backend` | F5 校验 |
| `src/octop/api/routers/agents.py` | `patch_agent` | 调用 F5 校验 |
| `src/octop/api/routers/settings.py` | 文件尾新增两个路由 | 开关 GET/PUT |
| `tests/unit/test_storage_spec.py` | 追加测试 | adapter 透传 inherit_env/env、占位符解析、username_safe_for_placeholder 规则与不展开行为 |
| `tests/unit/agents/test_user_sandbox_policy.py` | 新文件（29 个测试） | F4/F5/开关 + 四种改运行方式写法 + 用户名不安全拒绝 + 后端不存在/停用 fail-closed + 管理员不受影响 |

## 团队类 Agent（kind=team）的处理（2026-10-13 第 4 轮源码核实）

演练数据里有 4 个 `kind=team` 的团队宿主属于普通用户，它们的 backend 为空。**结论：
不动它们，它们碰不到文件和命令，围栏对它们没有意义。** 依据（官方 b6 源码，三层禁用）：

1. **工具白名单**：`infra/agents/teams/service.py` 的 `HOST_TOOLS_ALLOWED` 只允许 5 个
   工具——`agent_list`、`ask_agent`、`memory_search`、`memory_get`、`current_time`；
   目录里其余全部工具（`write_file`、`edit_file`、`execute`、浏览器、`read_env_file`、
   MCP……）都在 `HOST_TOOLS_DISABLED` 里。`api/routers/agent_tools.py` 对团队宿主也只
   展示这 5 个（`disableable` 一律为 false）。
2. **harness 配置层**：`AgentManager._apply_team_host_config`（`infra/agents/manager.py`）
   对团队宿主把 `tools_disabled` 设为 `host_tools_disabled(...)`（含官方视为 critical 的
   `ls`/`read_file` 等——官方对团队宿主的白名单优先于 critical 保留），并置空
   `tools`、`skills_dir`、`mcp_server_configs`。
3. **运行时层**：`strip_team_host_runtime_tools` 把已加载宿主身上的 MCP/连接器工具剥掉；
   `TeamManager.stamp_host_runtime` 强制宿主走异步 `ask_agent` 派工。

宿主的工作目录只被官方代码用来放 `.octop/manifest.json`（`seed_team_template`，
成员名单），宿主自己没有任何读写它的工具。**团队成员 Agent 是普通 expert，各自走
各自的 backend**（`TeamManager.stream_peer_to_room` → `agent_manager.stream(成员)`）——
开关开启时普通用户建的团队成员经 F4 落主人文件夹（见测试
`test_create_team_agent_also_overridden`，F4 覆盖 `kind=team` 的落库）；存量团队成员由
部署运维库的迁移脚本按主人迁移。团队宿主的 backend 为空（官方默认），保持不动。

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
