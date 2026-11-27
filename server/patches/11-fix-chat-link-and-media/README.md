# 11 · 修复对话文件预览、链接四分流与本地图片鉴权渲染（BUG-05 / BUG-06）

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（共 9 个文件：独立新文件 4 个 + 官方文件极薄挂载点 5 个） |
| 状态 | enabled |
| 顺序 | `order: 11`（不与其他补丁或品牌包共改任何文件，无需登记 `shared_files`） |
| 实测 | v1.0.2（`dd9dce470844`）：`npx tsc -b` 零错误、`npx vitest run`（新增 `zbsChatLinks.test.ts` 10 项 + `ZbsChatLinkAndMedia.test.tsx` 8 项 + 关联回归 29 项 = 47/47 通过）；`prepare.py --check-only`、`check_ownership.py`、`brand_check.py --self` 均退出码 0 |
| 上游 PR | 否——待官方在后续版本修复 Markdown 链接分流与本地图片鉴权取图后退役 |
| 依据 | ZT-040（BUG-05 对话链接/文件路径跳成新主界面；BUG-06 聊天内本地图片全部失效） |

## 根因核实（上游 v1.0.2 源码）

1. **BUG-05（对话链接与本地文件路径点击后新开主界面）**：
   - `react-markdown` v10 默认 `defaultUrlTransform` 仅放行 `https?/ircs?/mailto/xmpp`，会将 `file://...`、Windows 盘符路径 `D:/...`、`tel:` 等直接清空为 `""`；
   - `dashboard/src/components/Markdown/index.tsx` 对所有非 `isAuthDownloadHref` 的 `<a>` 一律挂 `target="_blank" rel="noreferrer"`：清空后的空 `href=""` 或相对文件路径（如 `report.md`、`docs/a.pdf`）、站内 SPA 路由（如 `/chat/...`、`/experts`）点击后都会新开标签/窗口加载 SPA 首页，并丢失非记住登录态下的 `sessionStorage`；
   - `dashboard/src/pages/Chat/components/MessageFileCard.tsx` 对非鉴权相对/本地链接同样走 `<a target="_blank">` 漏口；`dashboard/src/utils/downloadLink.tsx` 同源临时下载链接也带了 `target="_blank"`；`dashboard/src/components/PdfDocumentPreview.tsx` 对 PDF 书签 `item.url` 未校验安全协议即 `window.open` / `target="_blank"`。
2. **BUG-06（聊天内本地图片全部失效）**：
   - `dashboard/src/components/Markdown/index.tsx` 的旧 `resolveImageSrc` 先因 `defaultUrlTransform` 清空 `file://` 而失效，正则又只匹配单数 `.octop/workspace/`（不匹配实际隔离目录复数 `.octop/workspaces/<agentId>/`、`/localoctop/` 或相对路径）；
   - 更致命的是它拼接了后端**根本不存在**的 `/api/workspace/media?path=...`（经核查 `src/octop/api/routers/*.py` 确认无此路由），且 `<img src>` 无法携带 `Authorization: Bearer` 鉴权头。后端真实存在且带鉴权的工作区读文件接口为 `src/octop/api/routers/workspace.py:330` 的 `GET /api/agents/{agent_id}/workspace/download?path=...`（使用 `require_agent_workspace`，Agent 运行中与已停止均可读取）。

## 做法（模块化：新逻辑进独立文件，官方文件只留极薄挂载点）

### 新增文件（本模块独占）

- `dashboard/src/utils/zbsChatLinks.ts`：纯函数模块
  - `zbsMarkdownUrlTransform`：自定义 `urlTransform`，保留 `file://`、Windows 盘符路径（`D:/...`、`D:\...`）、POSIX 路径（`/...`）、相对路径、锚点 `#...`、`workspace://` 及 `http/https/mailto/tel`；`data:image/*` 仅对图片 `src` 放行；去除控制字符与空白后严格拦截 `javascript:`、`vbscript:`、`data:`（非图片或用于 `href`）等危险协议；
  - `extractWorkspaceFileTarget` / `classifyChatLink`：非 AuthDownload 链接精确四分流——
    1. **工作区 / 本地文件桥 / 相对路径**：识别 `.octop/workspaces/<agentId>/<rel>`、`.octop/agents/<agentId>/<rel>`、`.octop/workspace/<rel>`、`/localoctop/<rel>`（含 `file:///data/.octop/users/<user>/localoctop/<rel>`，保留前导 `/localoctop/` 以便后端 `virtual_mode=True` 正确映射到与 `.octop/workspaces/<id>` 平级的 `<root_dir>/localoctop/<rel>`）、`/workspace/<rel>`、`workspace://`、`file:///...`、Windows/POSIX 本地路径与纯相对文件路径（含 URL 编码中文解码，排除全部已知站内 SPA 路由）；
    2. **页内锚点（`#...`）**：不挂 `target="_blank"`，正常页内跳转；
    3. **站内 SPA 路由（`/chat/...`、`/experts`、`/admin/...` 等）**：走前端路由或同页导航，不挂 `target="_blank"` 防止丢 `sessionStorage` 会话态；
    4. **外部链接（`http/https/mailto/tel`）**：正常 `target="_blank" rel="noreferrer"`；
    （危险/空协议归类 `blocked`，不渲染可点击 `<a>`）；
  - `resolveMarkdownImageTarget`：兼容单/复数 `workspace(s)`、`.octop/agents/<id>/`、`/localoctop/`、`file:///`、相对图片路径及历史 `/api/workspace/media` 写法，统一改写为后端真实鉴权接口 `/api/agents/{agentId}/workspace/download?path=...`。
- `dashboard/src/components/Markdown/ZbsChatLinkAndMedia.tsx`：React 渲染组件
  - `ZbsMarkdownLink`：工作区/本地文件可预览时优先调 `useChatFilePreview()?.openFilePreview(filePath, agentId)` 打开内置预览，不可预览或无预览上下文时走 `downloadAuthFile` 鉴权下载；SPA 路由安全走 Router 导航（无 Router 上下文时平滑降级同页跳转）；
  - `ZbsMarkdownImage`：经 `requestBlob`（携带 `Authorization: Bearer` 头）拉取二进制，按文件名补齐图片 MIME（`asImageBlob`）转 Blob URL 渲染，组件卸载或 `src` 变更时确定性 `URL.revokeObjectURL` 并 abort 未完成请求；加载失败或无 `agentId` 时保留 `[alt || "image"]` 优雅降级。
- `dashboard/src/utils/zbsChatLinks.test.ts`：10 组单元测试（URL 安全变换、XSS 变体拦截、路径解析、四分流、图片接口解析、辅助谓词）。
- `dashboard/src/components/Markdown/ZbsChatLinkAndMedia.test.tsx`：8 组组件与集成测试（Markdown 四分流、预览优先/下载降级、SPA 导航、XSS 阻断、鉴权拉图与卸载/切换 `URL.revokeObjectURL`、失败 alt 降级、`MessageFileCard` 漏口修复）。

### 官方文件挂载点（共 5 个文件）

| 文件 | 改动 |
|---|---|
| `dashboard/src/components/Markdown/index.tsx` | 新增可选 `agentId?: string \| null` 属性；传 `urlTransform={zbsMarkdownUrlTransform}`；非 AuthDownload `<a>` 委托给 `ZbsMarkdownLink`；`<img>` 委托给 `ZbsMarkdownImage` 并移除无效的旧 `/api/workspace/media` 逻辑 |
| `dashboard/src/pages/Chat/components/MessageBubble.tsx` | 向 `<Markdown>` 透传 `agentId={speakerId \|\| agentId}`（+1 行，不影响其他调用方） |
| `dashboard/src/pages/Chat/components/MessageFileCard.tsx` | 识别工作区/本地/相对链接走预览与 `downloadAuthFile`；非鉴权下载仅对跨域 `http(s)` 才加 `target="_blank"`，消除同源/相对链接跳新窗漏口 |
| `dashboard/src/utils/downloadLink.tsx` | 同源 `/api/downloads/link/{token}` 链接改用 `download={link.filename}`，去除 `target="_blank"` |
| `dashboard/src/components/PdfDocumentPreview.tsx` | PDF 书签 `item.url` 经 `isSafeExternalUrl` 校验后再 `window.open` / 渲染 `target="_blank"`，阻断非外链与 `javascript:` 漏口 |

## 测试与门禁证据

- `npx tsc -b`：退出码 0
- `npx vitest run`（9 个测试文件共 47 项测试：新增 18 项 + `downloadLink` / `PdfDocumentPreview` / `toolMediaBlocks` / `MessageBubble` 4 个测试文件共 29 项）：47/47 passed，退出码 0
- `shared/tools/check_ownership.py`：退出码 0
- `shared/tools/brand_check.py --self`：退出码 0
- `shared/tools/prepare.py --check-only`：退出码 0（按 order 11 → 20 → 21 → 23 → 60 全部严格套上）

## 删除（退役）条件

当上游 Octop 官方在后续版本同时实现：① Markdown `urlTransform` 保留本地/工作区路径且安全拦截危险协议；② 对话 Markdown 链接按工作区预览/下载、锚点、SPA 路由、外链分流并修齐 `MessageFileCard` 等同类 `target="_blank"` 漏口；③ 聊天内 Markdown 本地图片改走真实鉴权工作区接口并正确管理 Blob URL 生命周期时，将本模块状态置为 `retired` 并清空 `.patch` 文件；编号 `11` 作废不再复用。
