# 60 · 镜像加装本地向量与知识库 OCR 依赖

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（仅 `docker/Dockerfile` 两行） |
| 状态 | enabled |
| 实测 | v1.0.2b4 / v1.0.2b6 严格 apply 通过 |
| 上游 PR | 否（镜像体积取舍属部署偏好） |
| 旧编号 | SRV-2 |

## 做什么
`uv sync` 增加 `--extra local-embedding --extra knowledge-ocr`，让知识库本地向量化与 OCR 开箱可用。

## 说明
旧模块册里的 SRV-3“中文字体”**不存在**：上游 Dockerfile 本来就装 `fonts-noto-cjk`。