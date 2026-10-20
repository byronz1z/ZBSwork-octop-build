# 20 · 按角色/用户的可用模型名单；接口对非管理员不返回模型密钥

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（后端 16 个官方文件 + 前端 5 个官方文件；另 7 个测试文件，其中 1 个新文件 `tests/unit/agents/test_memory_model_policy.py` 为 ZT-030 加） |
| 状态 | enabled |
| 实测 | v1.0.2b6：10 → 20 → 21 → 60 + 品牌包 严格套上（2026-10-16 ZT-030，prepare.py 全量建树 + brand_check 通过）；ZT-026 时的测试见 `_work\ZT-026\step2\报告-补丁20.md`，ZT-030 的测试见指挥部 ZT-030 任务单"结果" |
| 上游 PR | 否——ZBS 自有的权限收紧策略，上游官方无意向 |
| 依据 | 指挥部任务 ZT-026 任务单（2026-10-13 重写版）第二节功能点 F8–F10（旧稿 F7–F11，见文末对照；日志 10-12 #190 #195 #198）；ZT-030 修正（日志 10-16 #332–#371，见下"ZT-030 修正"一节） |

## ZT-030 修正（2026-10-16，决策人 10-16 #332–#371）

生产上（zbs2）发现名单存不进、守不住，本次只修补丁 20 自己的这些问题，不加新功能：

| # | 功能点 | 以前 | 现在 |
|---|---|---|---|
| 1 | 管理员给角色、单个用户、批量设"可用模型" | 勾到 id 里带 `/` 的模型（如 `Aliyun api/ZHIPU/GLM-5.3-Flash`）保存返回 400 | 按第一个 `/` 切开（同官方 `is_model_ref_usable`），下拉里列出的都能存 |
| 2 | 对话里选"自动"或没指定模型 | 名单里的模型都不能用时不传模型，执行层改用全站默认（越过名单） | 停下这一轮，提示"你可用的模型当前都无法使用，请联系管理员。"；网页和 IM 都覆盖 |
| 3 | 定时任务 | 没设模型或存的模型不在名单里时不传模型，执行层用自己的默认（不看名单） | 在名单里挑：存的模型 → Agent 固定模型 → 名单里第一个可用；挑不到这一次记为失败，原因同上一句 |
| 4 | 后台记忆整理 | Agent 启动时取全站默认模型，不看主人名单 | 按 Agent 主人的名单挑；挑不到就关掉记忆整理用的辅助模型（不整理，记忆的记录和查找照常）；名单外的 `memory.aux_model` 设置不生效 |
| 5 | 本说明 | 写着"挑不到会给出清楚错误"，与代码不符 | 改成实情（本节；下文旧句已标注更正） |

**被拒、停下时给用户看的话**（按场景说真实原因，决策人 #355；后端 `src/octop/i18n/{zh,en}.json`、网页 `dashboard/src/locales/{zh,en}.json` 的 `apiErrors` 各两句）：

| 场景 | 用户在哪看到 | 错误码（状态 403） | 提示 |
|---|---|---|---|
| 设常用模型、发消息、建或改定时任务时选了名单外的模型 | 设置页、对话框、定时任务表单 | `MODEL_NOT_ALLOWED` | 你没有使用这个模型的权限，请联系管理员。/ You don't have permission to use this model. Please contact your administrator. |
| 名单里的模型当前都用不了（被停用、被删或所在提供方被关），发消息或选了"自动" | 对话框（网页、IM） | `NO_ALLOWED_MODEL_AVAILABLE` | 你可用的模型当前都无法使用，请联系管理员。/ None of the models available to you can be used right now. Please contact your administrator. |
| 定时任务执行时挑不到 | 定时任务执行记录的失败原因 | 同上 | 同上 |
| 记忆整理挑不到 | 用户看不到（后台不做） | — | 不提示 |

这推翻了 10-13 #224"被拒显示官方原样'没有权限'"的决定，依据是 10-16 #355。网页对话（WebSocket）只对这两个错误码给本地化的话，其他错误照官方原样显示。

**这次新改到的官方文件**（都只归补丁 20，没有别的补丁碰）：`src/octop/infra/errors.py`（两个错误码和状态码，各 2 行）、`src/octop/i18n/zh.json`、`en.json`（各 2 句）、`src/octop/api/routers/chat/ws.py`（两处 `except` 各加一次调用）。策略本身写在本补丁自己的函数里（`resource_policy.py` 末尾的 `model_policy_error_text`、`memory_model_settings_for_agent`、`allowed_models_for_agent_owner`）；`agents/manager.py` 的 `_build_harness_config` 只加调用，位置在补丁 21 所有改动之后（已在补丁 21 说明末尾记录，决策人 #353）；ZT-036 起还在健康切换的候选上加了名单过滤。

**边界（如实写明）**：
- 记忆整理按名单挑模型发生在 Agent 启动（建执行配置）时：管理员改了名单，正在运行的 Agent 不重新加载，**下次启动时**才按新名单生效（决策人 #366 定）。对话和定时任务每一次都按当时的名单判，改完立即生效。
- 定时任务的挑法比对话少一层"用户常用模型"：官方定时任务本来就不看用户偏好，这里照官方，不另加。
- 被拦下的定时任务，会话列表里可能留一个空会话：官方在同一位置（加载工具失败时）本来就是这样，非本补丁引入。
- IM 渠道（飞书、钉钉等）走官方 `MessageEvent.error_event`，代码与网页同一套挑选；本机测试环境接不了真实 IM 渠道，未实测。
- **健康切换用的名单是 Agent 启动（建执行配置）时取的快照**（`manager.py:4124` 的 `failover_allowed_models`）。后果：管理员**收回**某人某个模型的权限后，这个人正在运行的 Agent 在**重启前**遇到模型出错，健康切换仍可能换到已收回的模型（2026-10-20 演练实测：名单从 GLM + qwen 缩成只有 GLM、未重启，GLM 连不上时换到了 qwen；重启后只在名单内换）。**做法：收回模型权限后，要重启相关 Agent 才对切换生效。**每回合挑模型、发消息和定时任务的校验不受影响（每次按当时的名单）。决策人 10-20 #443 定：这次不改，以后另开任务处理。
- 名单里没有可换的、而原模型自己也在冷却时，用户看到的是官方的英文报错 `no healthy AUTO model is available`（`infra/agents/middleware/model_failover.py:155,195`），不是补丁 20 的中文提示；本次不改代码。

**怎么算做对**：见指挥部 `任务\ZT-030-model-policy-fixes\任务单.md` §一.7。

## ZT-036：健康切换只在名单内换（2026-10-20）

决策人原话（日志 10-20 #436）："按照正确的逻辑，是用户授权使用的模型才能自动切换去用，这是核心。"

改了哪一处：`src/octop/infra/agents/manager.py` 的 `_build_harness_config` 里给官方 `SafeModelFailoverMiddleware` 装配 `candidates` 的 lambda——先按 Agent 主人的可用模型名单（`allowed_models_for_agent_owner`）过滤候选用 `model_ref_passes_allowlist`，规则与补丁 20 其它场景一致。

三种主人的行为：

- 主人是管理员 → 不过滤，与官方相同；
- 主人没设名单 → 不过滤（全部开放），与官方相同；
- 主人设了名单 → 候选只留名单内的；名单里没有可换的，候选为空，官方逻辑只在原模型上重试、再失败按现有流程报错。

名单是 Agent 启动时取的快照，收回模型权限后要重启相关 Agent 才对切换生效，见上文"边界"（决策人 #443）。

## 模型名单按谁判：现状与决策人要的逻辑（ZT-036，2026-10-20）

决策人原话（日志 10-20 #440）："Agent 应该是跟随主人来定的。比如说这个 Agent 是 A 用户的，那它就能用 A 用户相应权限下的所有模型，应该是按这个逻辑在走的。你确定当前是按照这个逻辑在走吗？如果说 B 用户用了 A 用户的 Agent，他在使用时可以用这些模型；但是 B 用户用自己的 Agent 时，就只能用他自己的模型。应该是按这个逻辑在走的。"

一句话概括：**Agent 能用哪些模型，跟着 Agent 主人的名单走；谁在用它不影响。**

决策人原话（日志 10-20 #441）："这次不中，但是要把相关的逻辑写清楚，放到模块里边，要求清晰。后期如果要改，需要参照这个模块真实的情况来改"——本次升级不改代码；本节把现状和要的逻辑写清楚，以后改时以本节为准。

### 现状对照表

行号按 v1.0.2 套上补丁 20 + ZT-036 的施工树（`.work/src`）核对（2026-10-20）：

| 场景 | 决策人要的 | 现在实际看谁的名单 | 是否一致 | 代码位置 |
|---|---|---|---|---|
| 用户用自己的 Agent（所有环节） | 主人的名单 | 当前登录用户（此时就是主人） | 一致 | 全链同下各行 |
| 别人在网页上用共享 Agent：回合开始挑模型 | 主人的名单 | 当前登录用户 | **不一致** | `infra/gateway/process/processor.py:568`（`_resolve_harness_model_route` 里 `_allowed_models_for_user(user_id)`，定义在 `processor.py:626-639`）；user_id 来自网页渠道的登录用户（`infra/gateway/process/message_keys.py:94-105`，dashboard/CLI/MCP 渠道返回使用者自己的 id） |
| 同上：模型出错时健康切换 | 主人的名单 | Agent 主人 | 一致 | `infra/agents/manager.py:4124-4134`（`_build_harness_config` 的 `failover_allowed_models`，ZT-036 #436） |
| 同上：输入栏可选模型列表 | 主人的名单 | 当前登录用户 | **不一致** | `api/routers/providers.py:234-246`（`GET /api/providers/resolved` 用 `_user_allowed_models(user, server)`，定义在 `providers.py:195-208`） |
| 同上：发消息时指定模型的校验 | 主人的名单 | 当前登录用户 | **不一致** | `api/routers/chat/turn.py:277-285`（`assert_model_allowed_for_user(…, user.id, …)`） |
| 同上：设置偏好模型的校验 | 主人的名单 | 当前登录用户 | **不一致**（性质见注） | `api/routers/preferences.py:181-191`（同样按 `user.id`） |
| IM 渠道消息发到 Agent | 主人的名单 | Agent 主人（会话归属主人） | 一致 | `infra/gateway/process/message_keys.py:106-108`（外部 IM 渠道返回 `agent_owner_id`）、调用点 `processor.py:696-699` |
| 定时任务（分入口） | 主人的名单 | 执行期一律按任务会话主人（`session.user_id`）判。**网页 / Agent 工具创建**：入口要求主人本人——网页 `api/routers/cron.py:66-67`（`_user_may_manage_agent_cron` = `user_owns_agent`，严格 `row.user_id == user.id`、**无管理员豁免**，管理员替别人建会被 FORBIDDEN 拦下）；Agent 工具 `infra/cron/tools.py:74-81`（同样只认 owner）→ 会话主人就是 Agent 主人，**一致**。**命令行创建**：`infra/users/acting.py:17-42`（`resolve_acting_user_id`，优先级 `--user` → CLI 固定 `default_user` → Agent 主人）、`cli/support/offline_ops.py:196-239`（按该用户建会话和任务，**不校验是否主人**）→ 可指定任意账号，会话主人可能不是 Agent 主人，**不一致**（只有能登进服务器的人能用命令行） | 网页/工具：一致；命令行：**不一致** | 执行期 `infra/cron/delivery.py:252-253`（`allowed_models_for_user_id(…, session.user_id)`）；网页创建校验按当前用户（`api/routers/cron.py:148-153, 221-226`）；命令行创建 `cli/commands/cron.py:68-73` → `offline_ops.py:196-239`（`model=None`，无名单校验） |
| 后台记忆整理 | 主人的名单 | Agent 主人 | 一致 | `infra/agents/manager.py:4049-4053`（`allowed_models_for_agent_owner(…, row.user_id)`） |
| 主人是管理员 | 名单不限制管理员 | **按主人取名单的环节**（健康切换、记忆整理）：名单取到 `None`，不过滤（全部开放）——与决策人要的逻辑一致。**按使用者取名单的环节**（回合开始挑模型、输入栏列表、发消息指定模型校验）：仍按使用者的名单判，主人是管理员不使受限的使用者放开——那几行本就不一致，与主人是否管理员无关 | 按主人取名单的环节：一致 | `infra/users/resource_policy.py:291-304`（`allowed_models_for_user_id` 对 admin 恒返回 None） |
| 主人没设名单 | 全部开放 | **按主人取名单的环节**：`None`，不过滤（全部开放）——一致。**按使用者取名单的环节**：仍按使用者的名单判，主人没设名单不使受限的使用者放开 | 按主人取名单的环节：一致 | 同上（`resource_policy.py:304`，无策略即 None） |
| 共享 Agent 没有主人（`user_id` 为空） | 无主人可跟 | **按主人取名单的环节**：`allowed_models_for_agent_owner` 对 `user_id=None` 返回 `None`，不过滤（全部开放）。**按使用者取名单的环节**：仍按使用者的名单判（受限使用者照样受限）。无主人，不在"跟主人走"的讨论内 | —（无主人可跟） | `infra/users/resource_policy.py:406-414` |

注（偏好模型那行的性质）：偏好模型（`preferred_model`）是**使用者自己**的设置项，存在使用者自己的 `users.preferences_json` 里，作用是自己发起的回合的第三优先级（`processor.py:591-600`）。校验"你的偏好在你自己的名单内"本身自洽；但它也参与共享 Agent 的回合挑模型（按使用者偏好 + 使用者名单过滤），那一层与"跟主人走"不一致，和"回合开始挑模型"那一行同源。校验本身是否要改成跟主人，**拿不准**——偏好是使用者的属性，不是 Agent 的属性。

### 共享 Agent 在官方（v1.0.2）里是怎么回事

- **怎么设为共享**：`agents` 表的 `is_shared` 列；主人（或管理员）通过 `PATCH /api/agents/{agent_id}` 传 `is_shared: true`（`api/routers/agents.py:378-436`，入口 `_assert_agent_owner` 校验主人，管理员可越过）→ `AgentManager.set_shared`（`infra/agents/manager.py:1034-1047`）。团队 Agent 不能共享（`TEAM_NOT_SHAREABLE`，`manager.py:1041-1042`）。
- **别的用户在哪里能看到**：`GET /api/agents`（默认 `scope=mine`）返回自己的 + 别人共享的（`api/routers/agents.py:253-255` 的 `agent_repo.list_shared(exclude_user_id=user.id)`），共享的带主人用户名（`agents.py:256-262`）。
- **网页能否直接对话**：能。发消息入口 `require_agent_row` → `assert_agent_access_row` → `_user_may_access` 接受 `agent_is_shared(row)`（`api/common/agent.py:26-36`，`require_agent_row` 在 `agent.py:39-61`）。HTTP 层已核实放行；前端界面上的具体操作流程未实测。
- **团队能否拉入**：能。`wire_shared_member_peers`（`infra/agents/teams/team_manager.py:2114-2207`，装配点 `infra/agents/manager.py:622-626`）让团队 host 的 `team_peers` 配置（或成员请求范围内的名单）能拉入别的账号的共享专家；判定函数 `_user_may_use_member` 接受 `is_shared`（`infra/agents/teams/service.py:71-76`）。
- **未核实**：前端共享开关的界面位置与文案；共享 Agent 会话在别人网页上的实际展示（代码上 `resolve_thread_id` 按使用者建线程，未实测）。

### 今天的影响

演练库（10-19 生产副本）共享 Agent 0 个、设了名单的用户 3 个；10-14 生产核查时也没有共享 Agent。眼下没有人碰到不一致的那几行。

### 要提醒的

按"跟主人走"，管理员不受名单限制，管理员把自己的 Agent 共享出去，任何人用它都能用全部模型；且管理员的 Agent 不在补丁 21 的隔离范围里（10-14 #235），共享出去别人能通过它读到整台服务器。

### 以后要改时

改成"跟主人走"需要改上表里"不一致"的每一行：把取名单用的用户从"当前登录用户"换成"这个 Agent 的主人"（补丁 20 已有 `allowed_models_for_agent_owner`，`resource_policy.py:406-414`）。定时任务的命令行入口也在要改的范围内（`cli/commands/cron.py:68-73` → `offline_ops.py:196-239` 建会话时可指定任意账号，且 `model=None` 不经名单校验，`acting.py:17-42` 是换用户的源头）。输入栏要按当前选中的 Agent 列出模型，会动前端。改之前先按本节的表重新核对一遍行号，以当时的真实代码为准。

## 问题（源码事实，上游 v1.0.2b6）

1. **任何人都能用所有启用的模型，管理员无法按角色/用户限制**：官方只有
   `user_policies` 三个策略（`workspace_root_dir`、`token_quota`、`max_agents`，
   `src/octop/infra/users/resource_policy.py:18-20`），没有"某用户只能用哪些模型"。
2. **模型解析链无用户维度**：一轮对话用哪个模型集中在
   `infra/gateway/process/processor.py:515-564` 的 `_resolve_harness_model`，
   优先级：① 输入栏选的 → 会话存的 `threads.model_ref` → 旧 `/model` 覆盖
   （`processor.py:500-513`）；② Agent 固定模型 `agents.default_model`
   （`providers/store.py:264-276`）；③ 用户偏好 `users.preferences_json.preferred_model`
   （`processor.py:549-555`）；④ 全站默认 `settings.active_model` → 第一个可用
   （`agents/manager.py:1362-1370`）；⑤ 识图时换视觉模型（`store.py:204-217`）。
   全链只有 `is_model_ref_usable`（`store.py:232-249`）的"启用"判断，没有按用户判。
3. **发消息接口只校验"是否启用"，不看用户**（`api/routers/chat/turn.py:266-274`）；
   定时任务的模型创建时不校验（`api/routers/cron.py:153, 216-217`）、执行时原样
   透传（`infra/cron/delivery.py:219-237`）；设置偏好模型的接口同样只看启用
   （`api/routers/preferences.py:167-178`）。
4. **模型列表和密钥全员可见**：`GET /api/providers` 只要登录就返回全部提供方，
   含明文 `api_key`（`api/routers/providers.py:120-138` 第 134 行、189-195）；
   `GET /api/providers/resolved`（149-158）返回全部可用模型。官方管理页自己的
   列表走 `GET /api/admin/providers`（203-211，需 `providers` 权限，前端
   `dashboard/src/pages/Settings/Models/useProviders.ts:113` 用的就是它），普通
   用户页面不依赖 `/api/providers` 的原始密钥（前端 `has_api_key`/`api_key_prefix`
   字段来自 harness 侧 `/models` bridge 端点，与 `providers.py` 无关——已核实）。
5. **角色模板/用户策略机制现成**：策略经 `UserManager.set_resource_policy`
   （`infra/users/manager.py:562-618`）写 `user_policies` 表（`value` TEXT 列，
   migration 014）；分配角色时官方把模板策略全量抄给用户（`api/routers/users.py:297-298, 482-485`，
   `_policy_kwargs_replace_from_pairs` 明说"全量替换，防止换角色后旧限制残留"）。
   官方没有管理员自由写 settings 键的通道，但策略通道完整——名单用策略存，
   不新建表、不改数据库结构。

## 修法

一个新策略 `allowed_models`（值 = JSON 数组字符串，如 `["openai/gpt-4o","deepseek/deepseek-chat"]`，
元素是官方模型引用写法"提供方名/模型id"；没设/禁用 = 不限，和官方完全一样）。
**管理员角色不受名单限制**（角色模板 API 对 admin 恒返回空策略，沿用官方语义）。

- **F7（策略与角色）**：`resource_policy.py` 加 `POLICY_ALLOWED_MODELS` 常量、
  `allowed_models_of`（解析，None=不限）/`normalize_allowed_models`（写前校验：
  null/空=清除；元素必须 `provider/model` 格式，去重保序）；`public_policy_fields`
  加 `allowed_models` 键（用户列表 API 自动带出）。`UserManager.set_resource_policy`
  加 `allowed_models` UNSET 参数 + 审计。角色模板侧 `user_roles.py` 的
  `_KNOWN_POLICIES` 加名，`_policies_from_fields`/`public_role` 加解析与平铺
  字段；`users.py` 的 Create/Patch body 加字段，`_policy_kwargs_replace_from_pairs`
  /`_policy_kwargs_from_body` 加键。官方分配角色的全量替换机制原样生效
  （模板没设该策略 → 抄给用户时清掉，与官方"防止旧限制残留"语义一致）。
- **F8（选模型时按名单判，十处）**：核心是"判名单"函数
  `allowed_models_for_user(user_row) -> list[str] | None`（None=不限）+ 在
  `_resolve_harness_model`（`processor.py`，两处调用 user_id 现成可用：网页
  `:1317-1323`、IM 渠道 `:762-768`）把候选模型逐个过滤：名单外的一律丢弃；
  四段优先级（输入栏/会话存的、Agent 固定、用户偏好、全站兜底）全部走
  `resolve_model_for_multimodal_turn(ref, needs_multimodal, allowed_models=...)`
  ——识图升级时 `resolve_multimodal_model_ref` 也按名单挑（`store.py`），
  兜底 `resolve_fallback_model_ref` 加名单参数取名单里第一个可用
  （`agents/manager.py:1362`）。名单里一个可用都没有 → 返回 None（harness AUTO
  会给出无法路由的清楚错误，不悄悄换名单外模型）【2026-10-16 更正：这句与代码不符——返回 None 时执行层会改用全站默认模型、越过名单；ZT-030 改为停下并提示，见"ZT-030 修正"】。名单外候选被丢弃后继续走
  低优先级（如输入栏选了名单外的、落到 Agent 固定模型——固定模型可用就用，
  不可用最终报错），符合"名单外一律不用"。Agent 固定模型在 `store.py` 的
  `resolve_explicit_default_model` 处过滤（`processor.py:545` 调用点传名单）。
  定时任务：`cron/delivery.py` 的 `_build_agent_request`（按 agent 主人判，
  `session.user_id` 可用）调用同一套过滤逻辑；创建/更新入口
  （`api/routers/cron.py`）对显式指定的模型先校验，名单外直接 400。
  发消息接口（`turn.py:266`）与设置偏好（`preferences.py:171`）在官方现有
  `is_model_ref_usable` 校验后追加名单校验，非管理员名单外 → 403 清楚报错。
- **F9（模型列表）**：`GET /api/providers/resolved` 非管理员只返回名单里的
  （没设名单照旧全部）；`GET /api/providers/active-model` 是全站默认（管理员设置），
  输入栏选项来自 resolved，非管理员的输入栏选项因此只剩名单里的。
- **F10（管理页）**：用户管理（`UsersListPanel.tsx`）和角色（`RolesPanel.tsx`）
  两个页面的现有策略区块（`ResourcePolicyFields`）加"可用模型"多选
  （Switch 开关 + `Select mode="multiple"`，选项来自 `providerApi.listResolvedModels()`，
  管理员自己看得到全部模型）。提交走官方现有 `policyPayload`/`rolePoliciesFromForm`
  路径。官方批量接口只有 `set_token_quota`/`set_max_agents` 两个动作（`users.py:25`），
  照葫芦画瓢加 `set_allowed_models`（后端 + 前端批量菜单各加一项，官方批量机制
  本来就"容易带上"——它就是按 action 名分支的）。
- **F11（密钥）**：`GET /api/providers` 对非管理员将 `api_key` 置为 `None`
  （前端 `ProviderCard` 的 `hasApiKey` 逻辑 `!!provider.api_key` 不受影响——该卡片
  只在管理页用 `/admin/providers` 数据；非管理员页面对该端点的返回不依赖密钥）。
  管理员和官方 admin 端点照旧返回全文，管理页显示和修改不受影响。

**按 Agent 主人判**：`_resolve_harness_model` 的 `user_id` 即发起人（网页=当前用户，
IM=会话归属用户 `resolve_user_id_for_message`，`processor.py:621-625`）；共享 Agent
的渠道消息走 agent 主人的会话（官方 session 归属），与官方口径一致。cron 按
`session.user_id`（job 主人的会话）判。

## 改了哪些官方文件

后端（12 个）：

| 文件 | 函数/位置 | 改动 |
|---|---|---|
| `src/octop/infra/users/resource_policy.py` | 新增 `POLICY_ALLOWED_MODELS`、`allowed_models_of`、`normalize_allowed_models`、`allowed_models_for_user`、`assert_model_allowed_for_user`；`public_policy_fields` 加键 | F7 策略读写 |
| `src/octop/infra/users/manager.py` | `set_resource_policy` 加参数 | F7 写入口 |
| `src/octop/infra/agents/providers/store.py` | `resolve_model_for_multimodal_turn`、`resolve_multimodal_model_ref`、`is_model_ref_multimodal`、`resolve_first_model_ref` 加 `allowed_models` 参数 | F8 识图/兜底过滤 |
| `src/octop/infra/agents/manager.py` | `resolve_fallback_model_ref` 加参数 | F8 全站兜底按名单 |
| `src/octop/infra/gateway/process/processor.py` | `_resolve_harness_model` | F8 主链（两处调用：网页/IM） |
| `src/octop/api/routers/chat/turn.py` | `prepare_dashboard_turn` | F8 发消息校验 |
| `src/octop/api/routers/preferences.py` | `patch_preferences` | F8 偏好模型校验 |
| `src/octop/api/routers/cron.py` | create/update | F8 定时任务入口校验 |
| `src/octop/infra/cron/delivery.py` | `_build_agent_request` | F8 定时任务执行期过滤 |
| `src/octop/api/routers/providers.py` | `list_providers`、`list_resolved_models` | F9/F11 |
| `src/octop/api/routers/users.py` | body 模型、批量动作、kwargs 组装 | F7/F10 |
| `src/octop/api/routers/user_roles.py` | `_KNOWN_POLICIES` 等 | F7 角色模板 |

说明：`api/routers/agents.py` 未改——Agent 的固定模型（`default_model`）在运行期由
`processor._resolve_harness_model` 第二优先级统一过滤（`store.resolve_explicit_default_model`
结果按名单判），入口不另设校验，语义与官方"过期的固定模型静默丢弃、走低优先级"
一致。F8 的十处见报告逐处对照表。

前端（5 个）：

| 文件 | 位置 | 改动 |
|---|---|---|
| `dashboard/src/api/modules/userRoles.ts` | `UserRole` 接口加 `allowed_models` 字段；`userRoleDrift` 对比含名单 | F10 角色接口类型与漂移检测 |
| `dashboard/src/pages/Admin/Users/UsersListPanel.tsx` | `PolicyFormValues`、`policyPayload`、`rolePoliciesFromForm`、`ResourcePolicyFields`、批量 | F10 可用模型多选 |
| `dashboard/src/pages/Admin/Users/RolesPanel.tsx` | 表单初值/提交 | F10 角色页 |
| `dashboard/src/locales/zh.json`、`en.json` | `adminUsers` 段 | F10 文案 |

测试：`tests/unit/users/test_allowed_models_policy.py`（新文件）、
`tests/unit/agents/test_model_policy_store.py`（新文件）、
`tests/unit/gateway/test_model_policy_processor.py`（新文件）、
`tests/integration/test_model_policy_api.py`（新文件）。

## 怎么用（管理员一步步）

1. 管理员登录网页 → 管理 → 用户 → 角色：新建/编辑一个角色，在"资源使用策略"
   区块打开"可用模型"开关，多选勾上该角色能用的模型，保存（角色模板存名单）。
2. 或者：管理 → 用户 → 某用户 → 编辑，"可用模型"多选直接对该用户单独设/改
   （角色模板策略是全量替换——给用户换角色时模板没设名单会清掉个人值，与官方
   token 上限等策略行为一致；个人单独改用编辑表单覆盖）。
3. 批量：用户列表勾选多个用户 → 批量操作 → 设置可用模型。
4. 没设名单的用户/角色 = 全部可用（和官方完全一样）；管理员角色永远不受限。
5. 名单里一个可用模型都没有时：对话停下并提示"你可用的模型当前都无法使用，请联系管理员。"，定时任务这一次记为失败（ZT-030 起；之前会悄悄改用全站模型）。

## 删除条件

ZBS 停用"按角色分发模型"策略（决策人明说不再限制普通用户可用模型）时删除本模块；
编号 20 作废不再使用。

## F 编号新旧对照（2026-10-13 任务单重写后）

旧稿 F7（策略与角色）= 现行 **F8** 的一部分（角色上设名单）；旧 F8（选模型各处按名单判）= 现行 **F9**；
旧 F9（模型列表只显示名单里的）并入现行 **F9**；旧 F10（管理页）= 现行 **F10** 的界面部分；
旧 F11（接口对非管理员不返回密钥）= 现行 **F10**。现行 F8 全文：角色上能设"可用模型名单"，
可对个人单独调、可批量下发；F9 全文：选模型的各处都按名单判、模型列表只显示名单里的、
没设名单 = 和官方完全一样。

> 2026-10-13 按决策人决定（日志 10-13 #224）撤掉第 6 轮加的自定义被拒提示
> （错误码 `ZBS_MODEL_NOT_ALLOWED` + 双语文案）和 `/model` 命令查名单回执：
> 被拒时显示官方原样的"没有权限。"，限制本身照常生效。本补丁不再改
> `src/octop/infra/errors.py`、`src/octop/i18n/{zh,en}.json`、
> `src/octop/infra/gateway/slash/handlers/composite.py`。

## 被拒时回应里附带的数据（保留，现在没有地方用）

用户选了名单外的模型被拒时（设常用模型、网页发消息、定时任务三处，共用
`resource_policy.py` 的 `assert_model_allowed_for_user`），回应是官方的
`FORBIDDEN`，网页显示官方原样的"没有权限。"【2026-10-16 ZT-030 起改为 `MODEL_NOT_ALLOWED`，提示"你没有使用这个模型的权限，请联系管理员。"；下面说的 `details` 两项照旧】。回应的 `details` 里另外带两项：
`model`（用户选的那个）和 `allowed_models`（这个用户自己的可用名单）。

- **谁在用**：2026-10-13 在套好补丁的源码里查过，后端和网页端都没有任何地方读
  这两项；只有测试在断言它们存在（`tests/integration/test_model_policy_api.py`、
  `tests/unit/users/test_allowed_models_policy.py`）。
- **有没有风险**：没有。带的只是当事用户自己的名单，不含别人的数据和密钥；
  网页不显示。
- **为什么留着**：它从本补丁第一版就有（审核第 2 轮看过）。删掉对用户没有任何
  变化，却要改代码和三处测试、重做镜像、重新验收，所以不删。
- **以后要删**：删 `details=...` 那一个参数，同时删上面两个测试文件里对
  `details["model"]`、`details["allowed_models"]` 的断言，别的不用动。
- **更正一处记录**：指挥部 ZT-026 第 8 轮的执行方报告里写"已撤掉 details 里拼
  名单的代码"，不属实——第 8 轮撤的是第 6 轮加的那一版（新错误码、双语文字、
  多带一项可读名单 `allowed`），上面这两项是原来就有的，没有动。以本节为准。

另：网页对话那条通道（WebSocket）不套官方的文字表，被拒时对话里显示的是代码里
那句英文原文 `model is not in this user's allowed models`。正常使用碰不到——
模型下拉列表里只有名单内的。【2026-10-16 ZT-030 起 `ws.py` 对两个名单错误码给本地化的话，不再显示英文原文】

## 生产注意

- 名单只影响**之后**的模型选择；用户已有的偏好模型/Agent 固定模型若在名单外，
  下一轮对话即被过滤（按低优先级兜底，最终不可用则报错）——不自动迁移存量。
- 角色是分配时的快照（官方 CHANGELOG 明示）：改角色模板的名单不会自动同步到
  已分配的用户，须重新保存用户或用批量设置（官方现有机制，非本补丁引入）。
- 与补丁 21 无行为耦合：21 管运行方式（backend），本补丁管模型；两者只在
  `resource_policy.py`、`agents/manager.py` 两个文件的不同位置追加代码
  （shared_files 已登记，10→20→21 顺序均严格 apply）。
