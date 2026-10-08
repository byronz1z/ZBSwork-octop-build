# 20 · 模型按用户/角色分配（allowed_models）

| 项 | 内容 |
|---|---|
| 层级 | L2 核心补丁（服务端 8 文件 + 网页端 5 文件，13 文件 +251/−6） |
| 状态 | enabled（**未在生产验收**） |
| 实测 | v1.0.2b4 / v1.0.2b6 严格 apply 通过；`verify/test-allowed-models.py` 两版均 24/24 |
| 上游 PR | 可先问上游意向 |
| 旧编号 | FEA-1 / M70 |
| 数据库 | 零迁移（复用上游 `user_policies` / `user_role.policies`） |

## 做什么
管理员按角色模板（或逐用户覆盖）开放可用模型；服务端在对话轮次强制校验，前端模型列表同步过滤。
未设置 = 不限制。

## 验收
```
cd .work/src && PYTHONPATH=src python ../../patches/20-feat-model-per-user/verify/test-allowed-models.py
```

## 已知残留（需用户裁决，见 DESIGN.md）
- 自动/回退选模型路径不带用户上下文，理论上可落到白名单外
- agent/专家 `default_model` 写入不拦截（与上游一致，由使用时兜底）

## 升级必查
`src/octop/api/routers/providers.py` 的 `/resolved`、`tests/unit/users/test_resource_policy.py` 精确断言、
`dashboard/src/locales/*.json`（与品牌包同文件：先打补丁再跑品牌，顺序由 prepare.py 保证）。

详细设计：[DESIGN.md](DESIGN.md)（旧材料原样迁入，其中“M20/R5/裁决点 D2”等指旧体系文档，已归档）。