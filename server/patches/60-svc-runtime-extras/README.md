# 60 · 镜像加装本地向量与知识库 OCR 依赖 + 用户实际用到的工具 + 浏览器本体

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（仅 `docker/Dockerfile`） |
| 状态 | enabled |
| 实测 | 0001：v1.0.2b4 / v1.0.2b6 严格 apply 通过；0002：v1.0.2b4 / v1.0.2b6 严格 apply 通过（2026-10-10 本机 `prepare.py --check-only` 实测），并已在 b4 全量构建镜像 `octop:1.0.2b4-zbs1` 验证通过；0003：v1.0.2b6 严格 apply 通过（2026-10-13），安装命令已在临时环境 zt026-octop2 实测（浏览器打开 https 成功、中文渲染正常），整镜像构建由总调度做 |
| 上游 PR | 否（镜像体积取舍属部署偏好） |
| 旧编号 | SRV-2 |

## 0001 · uv extras 做什么
`uv sync` 增加 `--extra local-embedding --extra knowledge-ocr`，让知识库本地向量化与 OCR 开箱可用。

## 0002 · 用户工具（2026-10-10 新增）做什么
生产容器运行后，用户干活时让 AI 代理装了一批工具；它们不在镜像里，重建容器就丢。
本补丁把它们固化进镜像：

- `antiword` 并进运行时阶段已有的 `apt-get install` 行；
- 新增一层 RUN：系统 Python（`/usr/local/bin/python3 -m pip`）装 12 个点名包；
  `/app/.venv`（uv 创建、无 pip）用 `uv pip install --python /app/.venv/bin/python` 装 2 个；
  沿用 Dockerfile 已有的 `PIP_INDEX_URL` / `PIP_TRUSTED_HOST` 构建参数（该层同时映射到
  `UV_INDEX_URL` / `UV_INSECURE_HOST`，与 0001 改过的 uv sync 层同一写法）。

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
