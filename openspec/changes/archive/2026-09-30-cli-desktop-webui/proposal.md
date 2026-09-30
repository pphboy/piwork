# Proposal

## Why

现有用户 CLI 已具备 Work、对话、Service、配置、共享文件和完整包迁移能力，但日常使用仍需命令行及手动配置 Service 代理。`desktop-ui-language` 已确定面向 Work 所有者的产品语言和原型；本变更将其实现为 CLI 在本机启动、普通浏览器打开的 WebUI，让用户在同一个 Work 中使用工具、与 AI 对话并管理数据。

目标是交付基础能力完整、状态可信、浏览器免代理配置的 MVP。首版正式验收桌面 Chrome / Edge 当前稳定版，包括 360px 窄视口；不交付原生桌面壳，也不把静态原型完成等同于运行能力完成。

## What Changes

- 新增 `piwork-cli desktop [--port <port>] [--no-open]`：本地启动 WebUI，复用用户 CLI 的 Core 地址与凭证，提供登录/登出、连接状态、自动打开浏览器及可恢复会话。
- 按 `desktop-ui-language` DUL-001—016 实现独立 Work List、单 Work 面板、Service/Files/Chat、Settings、操作详情及导入导出。英文界面沿用 Serve 浅色令牌与共用控件，明确加载、空、失败、停止、未知和恢复状态。
- 新增受保护的浏览器 Service 入口，复用 SDK → Core service gateway。`.work` 保持 Core 内部逻辑服务身份；实际浏览器链接使用本机入口，支持 HTTP/SSE/WebSocket、应用导航、应用认证、独立打开及禁止嵌入回退，无需 PAC、hosts、证书安装或另起 forward proxy。
- 浏览器 Files 以本地会话访问 Core WebDAV，覆盖目录、下载、上传、文本编辑、移动/复制/删除和逐项错误；外部 WebDAV 保留既有 proxy + 临时 Basic 流程。文件仅指运行中 Work 的共享 workspace。
- 实现 Session/Run 观察恢复、Work/Service 控制、Skills/Packages/AGENTS/Advanced 的保存与独立 Apply，以及本地 Inspect、Import、显式 Stop → Export → Download。大文件流式传输，已接受操作只恢复查询，不自动重提。
- 平台凭据留在 CLI；本地浏览器会话、应用认证和外部 WebDAV 凭据各自独立。登出、会话失效、关闭窗口和退出 CLI 的影响分别定义，不能隐式停止 Work。

不包含：管理员控制台、Work/Session 改名、用户 Service 定义编辑器、终端、自动抓取 Service 页面供 AI 分析、停止后的文件/历史访问、文件锁/自动合并/跨 Work 操作、完整包格式演进、全局 Operation 历史或新的公网分享能力。AI 自定义域名仍为后续能力，本次消费 Core 已返回的域名。

## Capabilities

### New Capabilities

- `desktop-webui`：本地 WebUI 运行时、所有者工作流、语言基线落地、流式传输和操作恢复。
- `browser-service-access`：浏览器本地 Service 路由、身份与链接区分、认证/源隔离、协议转发、独立打开及兼容范围。

### Modified Capabilities

- `control-cli`：增加 desktop 命令、启动/退出/浏览器打开行为；保留既有 proxy 和命令语义。
- `work-access`：将原有临时 Basic 规则明确限定为外部 WebDAV proxy，并增加 Desktop 浏览器会话与文件适配器的授权边界。
- `desktop-ui-language`：细化 DUL-004 的禁止嵌入回退，明确直接应用标签页与带 Work 导航外壳的不同返回/不可用呈现，避免承诺外壳实时控制任意应用画面。

## Impact

- 主要涉及 `apps/cli` 的命令入口、本地 HTTP 服务与浏览器资源；`packages/client-sdk` 的转发/客户端复用。浏览器不直接打包依赖 Node 的 SDK。
- 复用现有 Core 所有者 API、service gateway、WebDAV helper 和 snapshot/package 协议，不新增旁路 Docker 访问，不让 pi-agentd 承担 WebDAV。`apps/console` 仍是管理员产品，仅参考其构建、上传与安全模式。
- 新增本地浏览器会话、受限路由和传输临时文件；按 Core/用户隔离已知操作记录。平台 token 不进入网页、Service、复制链接或日志。
- 构建交付浏览器资源；增加浏览器与真实 Core 验收，重点验证 Cookie/Origin、WebSocket、跨 Service/跨用户隔离、文件失败语义及大包内存边界。浏览器兼容结论必须来自目标浏览器实测，不能由静态原型推定。
