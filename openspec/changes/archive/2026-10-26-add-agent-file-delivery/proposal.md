# Proposal

## Why

Agent 已能在 Work 共享 workspace 生成文件，Files 也已有鉴权读取与下载能力，但回复中的文件路径不能直接引导用户打开 Files，图片只能下载后查看。需要把文件产出、聊天入口、Files 查看/下载和返回原会话接成同一条可用路径。

## What Changes

- 为 Agent 提供简短的平台文件引用约定：核实 workspace 文件后，在 Assistant 正文中输出当前 Work 内的受控文件链接；沿用现有文字事件和会话历史。
- 在实时、历史及请求详情的 Assistant 回复中识别文件引用，点击进入当前 Work 的 Files；处理 Focus 退出、未保存编辑、原 Session/草稿/阅读位置和文件目标的恢复。
- Files 增加 PNG/JPEG/WebP 图片预览，TXT 等 UTF-8 文本沿用现有编辑器；其他普通文件保留基本信息和 Download。预览失败与超限只局部降级。
- 文件引用指向当前路径的当前内容，不保存发送时副本；每次重新打开/刷新重新核对文件，修改、删除和不可达均按真实结果表达。
- PDF 仅允许浏览器已有原生行为；当前入口无法直接原生预览时按普通文件下载。本次不交付专用 PDF 查看器、转换服务或 PDF 依赖，PDF 预览不是必需验收项。
- 覆盖托管工作台和独立 Desktop，补齐路径校验、图片资源清理、浏览器回归、真实 Core 文件字节验证与嵌入资源构建。

## Capabilities

### New Capabilities

无。复用既有会话、工作台与文件访问能力。

### Modified Capabilities

- `agent-conversation`：增加以普通 Assistant 文本交付 Work 文件引用的格式、实际模型上下文指导及历史兼容约束。
- `desktop-webui`：增加受控文件入口、Files 图片预览、当前文件重读、错误恢复与资源生命周期契约。
- `desktop-ui-language`：明确文件链接进入 Files 的容器、返回、英文动作及图片/文本/其他文件的查看边界。

## Impact

- Agent：`apps/agentd/src/package-resources.ts` 的提示词追加入口及相关 SDK 测试；平台格式指导独立于是否启用脑包，不新增工具或执行器。
- DesktopUI：`apps/desktop-webui/src/chat-markdown.ts`、`app.ts`、`adapter.ts`、`models.ts`、文件/图片辅助模块、局部样式与对应浏览器测试。
- 构建：同步 `internal/desktopassets/static/` 并重新构建 Core/CLI；复用现有 WebDAV 与托管/独立 Desktop 认证入口。
- Core 文件协议、file-helper、数据库/history schema、proto、脑包/Memory 与 Service 生命周期不增加新的机制。文件内容不进入聊天 Base64 或新的附件存储；公开分享、跨 Work 传送、目录打包及 Office/OCR 转换不在范围内。
- 旧 Agent 继续原聊天；采用文件引用指导需要通过既有显式镜像配置与 Apply 路径使用兼容 Agent，不自动替换既有 Work 镜像或重放历史。
