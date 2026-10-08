# M70 · 模型分用户（allowed_models 资源策略）

- **作用域**: `shared`（服务端 8 文件 + Dashboard 5 文件）
- **改动规模**: 13 文件 / +251 −6
- **基线**: 上游 `v1.0.2b4`（`232030f4`）→ 本模块（建议并入 `zbs/feature-model-acl` 等功能线）
- **端别**: **服务端 + Dashboard。`desktop/`（EXE）零改动。**
- **数据库**: **零迁移**。复用 `user_policies`（schema v14）+ `user_role.policies`（schema v18）。

## 用途

让管理员接入模型（API key 全局一份，用户不填）后，**按角色模板开放不同的模型范围**：用户只能在自己被开放的模型里选择，服务端强约束，无法绕过。

`allowed_models` 作为第 4 个资源策略名接入上游既有的 `user_policies` 机制，与 `workspace_root_dir` / `token_quota` / `max_agents` 完全同构：

- 角色模板 `user_role.policies` 存 `{"name":"allowed_models","value":"[\"openai/gpt-4o\",...]"}`（JSON 数组字符串）
- 建号 / 换角色时由上游既有代码复制到该用户的 `user_policies` 行
- **未设置 / 空 = 不限制**（与上游"A missing name means that policy is off"一致）
- 非空 = 白名单，模型 key 形如 `provider_name/model_id`

## 涉及文件

**服务端（强制点，安全相关）**

| 文件 | 改动 |
|---|---|
| `src/octop/infra/users/resource_policy.py` | 新增 `POLICY_ALLOWED_MODELS` + `allowed_models_of()` / `normalize_allowed_models()` / `dump_allowed_models()` / `effective_allowed_models()`；`public_policy_fields()` 增暴露该键 |
| `src/octop/api/routers/providers.py` | `GET /api/providers/resolved` 按当前用户白名单过滤（**前端模型选择器的数据源**） |
| `src/octop/api/routers/chat/turn.py` | 对话轮次校验 `model_ref` 是否在白名单内（**真正的防绕过闸门**） |
| `src/octop/api/routers/preferences.py` | 用户 `preferred_model` 写入时校验白名单 |
| `src/octop/api/routers/user_roles.py` | `_KNOWN_POLICIES` 收编该策略名；`_policies_from_fields` / `_policies_from_items` 归一化；`public_role()` 暴露 `allowed_models` |
| `src/octop/api/routers/users.py` | `UserCreateBody` / `UserPatchBody` 增 `allowed_models` 字段；角色替换与逐用户覆盖两条路径均贯通 |
| `src/octop/infra/users/manager.py` | `set_resource_policy()` 增 `allowed_models` 参数 + 审计 `user.set_allowed_models` |
| `tests/unit/users/test_resource_policy.py` | **修正**被打破的精确字典断言；**新增** 4 条该策略单元测试 |

**Dashboard（管理界面）**

| 文件 | 改动 |
|---|---|
| `dashboard/src/pages/Admin/Users/UsersListPanel.tsx` | `ResourcePolicyFields` 增"可用模型"多选（角色模板与单用户覆盖**共用**该组件，改一处两条路径同时生效） |
| `dashboard/src/pages/Admin/Users/RolesPanel.tsx` | 角色"是否受限"显示纳入 `allowed_models` |
| `dashboard/src/api/modules/userRoles.ts` | `UserRole` 类型 + `userRoleDrift` 漂移检测纳入该字段 |
| `dashboard/src/locales/en.json` / `zh.json` | 3 个新文案键（**注意：与 M20 同文件，需 3-way 合并**） |

## 来源

尚未提交。建议 commit：

```
feat(acl): 按角色模板开放可用模型（allowed_models 资源策略 + 服务端强约束）
```

## 升级审核要点

1. **最高优先级**：本模块是**功能类**（非品牌类）改动，前 15 个模块均为品牌/打包类——这是第一个动业务逻辑的模块，冲突面比品牌模块大。
2. `tests/unit/users/test_resource_policy.py` 的精确字典断言**是上游会持续改的地方**。上游一旦调整 `public_policy_fields` 返回结构，本模块测试补丁会冲突 → 以语义为准重做。
3. **`providers.py` 的 `/resolved` 已进入上游活跃演进区**（b5 实测）：服务端该文件 b4→b5 零差异，但**前端 `provider.ts` 已改**（`listResolvedModels(agentId)` 加 `bridgeAgentHeaders`、新增 `getActiveModel`），且 b5 的 `bridge_proxy.py` 把 `/api/providers/resolved` 列入桥转发白名单。→ **升级时把该端点列为必查项**，不要假设它永远稳定。
4. `dashboard/src/locales/{en,zh}.json` 与 M20 撞文件。**禁止整文件覆盖**，必须 3-way。
5. `ResourcePolicyFields` 组件被 RolesPanel 与 UsersListPanel 共用；上游若拆分该组件，需在本模块同步拆分。

## 已知残留（未封堵，需裁决）

- **auto / 回退路径**：`agent_manager.resolve_fallback_model_ref()` 与 `gateway/process/processor.py` 的自动选模型**不带用户上下文**。若用户白名单与其 thread/agent 既有 `default_model` 冲突，且请求未显式给 `model_ref`，可能落到白名单外的模型。见 `../01-需求与裁决点.md` 裁决点 D2。
- **agent/专家 `default_model` 写入未拦截**：上游在 `agents.py` / `experts.py` 本就不校验（即使模型未启用），本模块保持一致，由 `turn.py` 在使用时兜底。
- **模型列表来源受"编辑者"身份影响**：`ResourcePolicyFields` 用 `/providers/resolved` 拉候选。管理员（无策略）看到全量；若自定义角色带 `users` 权限且自身有白名单，其可见候选会被截断。见裁决点 D3。

## 应用方式

```bash
# 在干净的上游 checkout 根目录执行:
git apply --3way module/change.patch
```

> **为什么用 `--3way`**：本补丁基于 `v1.0.2b4` 产出。实测在 `v1.0.2b4` 与 `v1.0.2b5` 上
> **直接 `git apply` 均可干净通过**（因 13 个文件中 11 个在上游零漂移、5 个依赖锚点行号一致）；
> 但未来版本行号一旦漂移，直接 apply 会整体失败——`--3way` 让 git 用三方合并消解行号偏移。
> **整文件覆盖是禁止的**，会删掉上游新增内容（i18n key 尤其如此）。

## 已验证（跨版本）

| 检验 | 结果 |
|---|---|
| 对 `v1.0.2b4`（R4 基线）`git apply --check` | ✅ 13/13 干净 |
| 对 `v1.0.2b5`（R5）`git apply` | ✅ 13 files / +251 −6，零冲突 |
| 在 `v1.0.2b5` 上跑 `verify/test-allowed-models.py` | ✅ 24/24 passed |
| 与 M20（i18n）叠加应用同一基线 | ✅ 零冲突（i18n 行数自洽） |
| 与既有 15 模块的文件重叠 | 11/13 独占，仅 2 个 i18n 与 M20 共享 |

详见 `../05-R5兼容性与长期维护性评估.md`。
