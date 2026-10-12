# 21 · 按用户沙箱：默认进沙箱、普通用户不能改运行方式

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（Octop 服务端 5 个文件） |
| 状态 | enabled |
| 实测 | v1.0.2b6 严格 apply 通过；本机单元测试通过（见 `_work\ZT-026\step2\报告-补丁21.md`） |
| 上游 PR | 否——ZBS 自有的权限收紧策略，上游官方无意向 |
| 依据 | 指挥部任务 ZT-026 任务单 F3–F5（日志 10-12 #195 #198） |

## 问题（源码事实，上游 v1.0.2b6）

1. **普通用户可以把自己的 Agent 改回不隔离**：`src/octop/api/routers/agents.py:378`
   `patch_agent` 对 `config.backend` 只做 `assert_user_backend_root_dirs`
   （`api/common/validators.py:12`，仅校验本地后端 `root_dir` 黑名单/用户策略），
   不拦"运行方式"本身的切换——实测（ZT-026 第 1 步 ⑨）普通用户一击即中，
   把 docker 沙箱 Agent 改成 `{"type":"local_shell","root_dir":"/"}` 返回 200。
2. **新建 Agent 的运行方式完全由请求决定**：所有创建入口（REST 直接建
   `agents.py:281`、专家模板 `experts.py:842`、市场 `experts.py:748`、
   已发布专家 `experts.py:642`、团队 `teams.py:69`、新用户默认 Agent
   `default_agent.py:48`、CLI）全部收敛到唯一落库点
   `AgentManager.create`（`infra/agents/manager.py:596`），请求不指定时
   落 `default_agent_backend_spec`（`infra/backend/resolver.py:12`，本地后端）。
3. **"按用户共用一个沙箱"时卷无法按用户分**：官方注入 username 的位置是
   `enrich_docker_backend_spec`（`infra/backend/docker_spec.py:55`，仅用于
   user scope 时注入 `username` 字段给 harness 起容器名）；volumes 由
   `apply_docker_cfg_keys`（`docker_spec.py:32`）和 harness
   `DockerSandbox._create_container` **原样透传**（harness 源
   `backends/docker_sandbox.py:28`："Optional ``volumes`` are passed through
   unchanged"）。全链路（octop 侧 + harness 侧）都没有任何 `{username}`
   占位符替换逻辑——named 后端里写 `octop_sbx_{username}` 这样的卷名没法按
   Agent 主人分卷。

## 修法

一个全站开关：settings 表键 `agent_enforced_backend`，值 = 管理员在官方
"存储后端"（`storage_backends` 表）里配好的一个 **kind=docker、
sandbox_scope=user** 的后端名字。空/缺省 = 关。

- **F4（默认进沙箱）**：`AgentManager.create` 里，开关开启且 Agent 主人
  （`spec.user_id`）是非管理员时，不管请求带什么 `config.backend`，落库
  一律覆写为 `{"type":"named","name":<开关值>}`（官方的 named 后端引用，
  `infra/backend/resolver.py:91` 会展开成该后端自带的镜像、scope、上限、卷）。
  覆盖全部新建入口（收敛点唯一，只改一处）。管理员建给自己的 Agent 不受影响；
  管理员替普通用户代建的 Agent 落该用户的沙箱（主人是普通用户）。
- **F5（普通用户不能改运行方式）**：`PATCH /api/agents/{id}` 里，开关开启、
  用户非管理员且 Agent 主人是普通用户时，请求 `config` 里的 `backend` 与库中
  现值不同 → 403（清楚指明原因和开关键名）；相同或未带 `backend` → 照常。
  `config` 带了但**缺** `backend` 键也拒绝——官方 patch 是整包替换不是合并
  （`agents.py:411` 直接 `json.dumps(body.config)` 落库），缺键会把运行方式
  静默改回官方默认，属于"改了运行方式"的一种，须拒绝并提示。管理员改任何
  Agent 照常。新增校验函数放 `api/common/validators.py`（仿官方
  `assert_user_backend_root_dirs` 的模式），在 `patch_agent` 里紧挨着官方
  已有校验调用。管理员的全局 Agent（`user_id=None`）不受 F5 拦——这类 Agent
  普通用户本来就过不了 `assert_agent_owner`。
- **F3（按用户分卷）**：`enrich_docker_backend_spec` 里，docker spec 的
  `volumes` 卷名允许 `{username}` 占位符，username 非空时替换为 Agent 主人
  用户名（例如 `{"octop_sbx_{username}": {"bind": "/data/.octop/agents", "mode": "rw"}}`
  → `octop_sbx_alice`）。挂在官方已有 username 注入函数上，不另造链路；
  内联 docker backend 和 named 后端都经 `_prepare_docker_backend`
  （`manager.py:2758`）→ `enrich_docker_backend_spec` 统一走这条路，一处覆盖。
  无 username（fixed/agent scope）时占位符原样保留（harness 侧原样透传给
  Docker，会报错——这是显式失败，不静默错挂）。

**开关的管理接口**：官方没有管理员自由写 settings 键的通用通道
（`PATCH /api/settings` 只收 `stable_only`，`routers/update.py:231`），所以本补丁
加 GET/PUT `/api/settings/agent-sandbox`（沿用官方 `require_permission("storage_backends")`
权限门，与"存储后端"管理页同权），读写上述 settings 键。PUT 校验名字必须是
存在的、kind=docker、enabled 的后端，返回当前生效值。这也是管理员"不改代码
就能开关"的通道。

## 改了哪些官方文件

| 文件 | 函数/位置 | 改动 |
|---|---|---|
| `src/octop/infra/agents/manager.py` | `create`；新增 `_enforced_user_sandbox_backend` | F4 覆写；开关读取 |
| `src/octop/infra/backend/docker_spec.py` | `enrich_docker_backend_spec` + 新增 `_resolve_volumes_username_placeholder` | F3 volumes `{username}` 展开 |
| `src/octop/infra/users/resource_policy.py` | 新增 `enforced_sandbox_backend_name` / `user_row_is_admin` 与键常量 | 开关读取（F4/F5 共用） |
| `src/octop/api/common/validators.py` | 新增 `assert_user_may_change_backend` | F5 校验 |
| `src/octop/api/routers/agents.py` | `patch_agent` | 调用 F5 校验 |
| `src/octop/api/routers/settings.py` | 文件尾新增两个路由 | 开关 GET/PUT |
| `tests/unit/test_storage_spec.py` | 追加 3 个测试 | F3 |
| `tests/unit/agents/test_user_sandbox_policy.py` | 新文件（12 个测试） | F4/F5/开关 |

## 怎么开关

1. 管理员先在官方管理页"存储后端"配一个 Docker 后端（或用官方 API
   `POST /api/admin/storage-backends`）：kind=docker，镜像、`sandbox_scope=user`、
   `sandbox_prefix`、内存/处理器/进程上限、（可选）`volumes` 里用 `{username}` 占位符。
2. 开：`PUT /api/settings/agent-sandbox`，body `{"name": "<那个后端的名字>"}`；
   关：body `{"name": null}`（或空串）。GET 同路径读当前值。
3. 也可直接写 settings 表：键 `agent_enforced_backend`，值 = 后端名字；删键/置空 = 关。

## 删除条件

ZBS 停用"按用户沙箱"策略（决策人明说不再要求普通用户强制进沙箱）时删除本模块；
编号 21 作废不再使用。

## 生产注意（运维顺序，来自 ZT-026 第 1 步实测）

- 开关打开只影响**之后**创建/修改的落库值；存量 Agent 不自动迁移（那是任务单 F6 迁移脚本的事）。
- 改了 named 后端的 volumes/上限后，**必须先删旧的按名复用沙箱容器再建**
  （harness `_acquire_container` 按容器名复用，不校验参数变化），配置才生效。
- 关掉开关后一切行为与官方完全一致：覆写和校验函数开头都先读开关，未设置直接返回。
