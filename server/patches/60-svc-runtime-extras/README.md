# 60 · 镜像加装本地向量与知识库 OCR 依赖 + 用户实际用到的工具 + 浏览器本体

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（仅 `docker/Dockerfile`） |
| 状态 | enabled |
| 实测 | 0001：**已作废**（官方 v1.0.2 用 PR #2082 原样实现，干净 v1.0.2 上严格套不上，文件已按决策人 #413 规则删除，见下节）；0002：v1.0.2 上重新适配（官方 apt 列表新增 `libgl1`/`libglib2.0-0`/`ripgrep` 使上下文漂移），2026-10-20 严格 apply 通过；0003：v1.0.2 严格 apply 通过（2026-10-20，未改动）。2026-10-20 返工 1 实测：干净 v1.0.2 上按 0002、0003 顺序逐个严格套上，全部成功；整镜像构建由总调度做 |
| 上游 PR | 否（镜像体积取舍属部署偏好） |
| 旧编号 | SRV-2 |

## 0001 · uv extras ——已作废（编号 0001 不再使用）

**作废前做什么**：`uv sync` 增加 `--extra local-embedding --extra knowledge-ocr`（本地向量 fastembed/huggingface_hub、知识库 OCR rapidocr/onnxruntime/pymupdf），让知识库本地向量化与 OCR 开箱可用。

**作废原因（2026-10-20，ZT-036d 返工 1）**：官方 v1.0.2（PR #2082）已在 Dockerfile 两处 `uv sync` 加入**与 0001 一字不差**的两个 extras（`docker/Dockerfile:113-114`、`:131-132`），并另加一条导入自检（`:133`，`.venv/bin/python -c "import cv2, fastembed, …"`）。0001 在干净 v1.0.2 上严格套不上（实测 `error: patch failed: docker/Dockerfile:107`）。按决策人 #413（任务单第零节 Z7）"官方已经实现的：补丁文件去掉，目录只留 README 写清真实情况"的既定规则，补丁文件已删除。

**版本归属**：zbs0.3 及以前的镜像里，此功能由本补丁 0001 提供；**zbs0.4 起由官方 v1.0.2 直接提供**（PR #2082），功能没有损失。编号 0001 不再使用（0002、0003 文件名与内容不变）。

## 0002 · 用户工具（2026-10-10 新增）做什么
生产容器运行后，用户干活时让 AI 代理装了一批工具；它们不在镜像里，重建容器就丢。
本补丁把它们固化进镜像：

- `antiword` 并进运行时阶段已有的 `apt-get install` 行；
- 新增一层 RUN：系统 Python（`/usr/local/bin/python3 -m pip`）装 12 个点名包；
  `/app/.venv`（uv 创建、无 pip）用 `uv pip install --python /app/.venv/bin/python` 装 2 个；
  沿用 Dockerfile 已有的 `PIP_INDEX_URL` / `PIP_TRUSTED_HOST` 构建参数（该层同时映射到
  `UV_INDEX_URL` / `UV_INSECURE_HOST`，与 0001 改过的 uv sync 层同一写法）。
  按指挥部规范 §5（只用官方源，2026-10-19 ZT-033）这两个参数一律留空，走 PyPI 官方源。

### 清单与证据（证据文件：`_input/apt-history.log`、`_input/pip-requested.txt`、`_input/pip-distinfo.txt`，取自生产容器 2026-10-10 快照）

| 包 | 生产安装时间（容器时区） | 证据 | 是否进镜像 / 原因 |
|---|---|---|---|
| antiword 0.37-17（apt） | 2026-10-08 01:29 | apt-history.log | 进：用户在容器里后装的系统工具 |
| cairosvg==2.9.1 | 2026-09-29 02:19 | pip-requested.txt | 进（系统 Python） |
| jieba==0.42.1 | 2026-09-29 02:30 | pip-requested.txt | 进（系统 Python） |
| markdown==3.11 | 2026-09-29 02:51 | pip-requested.txt | 进（系统 Python） |
| openpyxl==3.1.5 | 2026-09-29 02:54 | pip-requested.txt | 进（系统 Python） |
| pandas==3.0.6 | 2026-09-29 02:54（系统）/ 2026-09-29 07:23（venv） | pip-requested.txt | 进（系统 Python + /app/.venv） |
| send2trash==2.1.0 | 2026-09-29 03:08 | pip-requested.txt | 进（系统 Python） |
| olefile==0.47 | 2026-09-29 07:00 | pip-requested.txt | 进（系统 Python） |
| matplotlib==3.11.2 | 2026-09-29 10:31 | pip-requested.txt | 进（系统 Python） |
| xlrd==2.0.2 | 2026-09-30 01:30 | pip-requested.txt | 进（系统 Python） |
| rapidocr_onnxruntime==1.4.4 | 2026-09-30 09:32（系统）/ 2026-09-29 02:54（venv） | pip-requested.txt | 进（系统 Python + /app/.venv） |
| vtracer==0.6.15 | 2026-10-01 01:10 | pip-requested.txt | 进（系统 Python） |
| python_docx==1.2.0 | 2026-10-07 02:05 | pip-requested.txt | 进（系统 Python） |
| 其余系统环境后装包（numpy、lxml、opencv_python、onnxruntime、pillow 等，见 `_input/依赖-容器减镜像.txt`） | — | 依赖-容器减镜像.txt | 不进：均为上面 12 个包的传递依赖（dist-info 无 REQUESTED），pip 按钉版自动解析 |
| bubblewrap（apt） | 2026-09-28 10:07 | apt-history.log | 进镜像。原因：为与生产容器的安装清单保持一致而纳入（生产容器 apt 历史 2026-09-28 10:07:15 有这条安装记录）；没有证据表明用户工具依赖它 |
| 32 个浏览器图形库/字体（libasound2t64 … fonts-freefont-ttf，apt） | 2026-09-28 14:02 | apt-history.log | 进镜像。其中 `libxcb1`、`libcairo2` 是实测到用户工具（cairosvg、rapidocr_onnxruntime 等）导入时缺的；其余为与生产容器保持一致而一并装入，不构成工具的必要依赖 |

## 说明
旧模块册里的 SRV-3“中文字体”**不存在**：上游 Dockerfile 本来就装 `fonts-noto-cjk`。

## 注意（2026-10-20，ZT-036d）
0002 在 `/app/.venv` 里装的 `rapidocr_onnxruntime==1.4.4` 与官方 v1.0.2 `uv.lock` 里的 `rapidocr 3.9.2`（knowledge-ocr extra）是**两个不同的包**（前者为旧包名），功能重叠、镜像里两者并存，pip/uv 不报冲突。按"一样不多、一样不少"原则保留（生产容器实装的是 `rapidocr_onnxruntime==1.4.4`，照单固化；官方 `rapidocr` 随 extras 由官方提供）。若决策人想去重，属功能取舍，交总调度报。
