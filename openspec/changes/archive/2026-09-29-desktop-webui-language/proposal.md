# Proposal

## Why

CLI Desktop WebUI 面向 Work 所有者，让用户在 CLI 本机启动的网页中，通过 AI 对话、Service 和文件完成实际任务，日常无需理解 Docker、代理或控制命令。需要一套可复核的产品、交互与 UI 基线，保证现有基础能力有完整使用路径、状态和动作含义正确、界面整洁一致，使 MVP 能按明确标准实现与验收。

## What Changes

- 将产品语义、交互结构和 UI 规则集中到中文 `desktop-ui-language` Spec，作为唯一规范来源，覆盖建立工具、持续使用、分析改进、管理资料、调整能力、保留迁移六类场景；首版 UI 自有文案使用英文。
- Work List 为入口，一个 Work 一个独立面板，Services / Files / Chat 同级、Settings 明确可达。有可用 Service 时应用为主、Agent 在旁；无可用 Service 且对话准入成功，或用户聚焦 Chat 时，对话为主；停止状态显示真实限制。
- 定义浏览器内嵌和独立窗口免代理配置访问 Service、浏览器 Files 经 Core WebDAV 的目标体验；明确 Core 域名、浏览器链接、共享 workspace 和 Agent 实际数据来源的边界。
- 以 Serve 浅色语义令牌、共享样式及少量复用控件统一界面；列表对齐、文本可读、动作归属、反馈和返回属于基础质量。MVP 不以独立高保真样板、主题编辑器、装饰动效或自研设计系统作为前置交付。
- 交付完整 Spec、36 个编号画面的可编辑原型、等价 PNG、8 个模块的独立评审入口及 CLI 能力覆盖矩阵；每项能力同时定义入口、输入、操作、结果、失败恢复与返回。
- 将已有三份 Desktop docs 的规则与验收细则迁入 Spec，移除重复文档并修正仓库/原型入口。design 保留决策理由，原型保留图示和能力映射，不再维护多份并行硬规则。

### 基础功能范围

| 模块 | 覆盖内容 |
| --- | --- |
| 连接与账号 | Core 地址、登录、身份、退出、连接与过期恢复 |
| Work | 创建默认/高级选项、列表、详情、启动、停止、重试、删除及进度 |
| Chat | Session 新建/切换/历史、发送、Run 观察/取消、忙碌与断线恢复 |
| Service | 列表、域名、状态、访问/独立窗口、端口选择、控制与有限日志 |
| Files | 浏览、上传、下载、文本编辑、建目录、重命名、移动、复制、删除、外部 WebDAV 连接 |
| Settings | Skills、Pi Packages、AGENTS.md、完整高级配置；保存与 Apply 分开 |
| 导入导出 | 包检查、导入、显式 Stop 后 Export、下载及原快照恢复 |
| 操作恢复 | 本地已知 Operation 进度、按 ID 查询、失败与未知结果恢复 |

### 交付边界

本 change 交付产品/设计规范与静态原型；完成不代表运行中的 WebUI 已交付。CLI 启动入口、本地认证、浏览器 Service 访问与文件/包传输由后续实现变更完成，技术设计须在编码前明确。

首版不增加 Work 总览或跨 Work 侧栏、平台管理、Work 终端、Work/Session 改名、用户 Service 定义编辑器、全局 Operation/Run 列表、浏览器页面自动采集、跨 Work 文件修改或并发自动合并。停止后的历史、文件与运行能力遵守现有 Core 准入，不能通过原型暗示新增支持。

## Capabilities

### New Capabilities

- `desktop-ui-language`：Desktop 的目标用户、任务场景、产品、交互、视觉与完整基础流程约束。

### Modified Capabilities

- `ui-language`：规定 Desktop 以专属 Spec 为规范来源，保留 Serve 文档的适用边界及既有布局与功能。

## Impact

- 规范迁移：将 `docs/desktop-product-language.md`、`docs/desktop-design-language.md`、`docs/desktop-ui-language.md` 的硬规则归入现有 Spec，完成覆盖核对后移除这三份文件。
- 导航/原型：`docs/product-language.md`、`docs/ui-language.md`、`docs/design/piwork-desktop-prototype.md` 改为引用 `desktop-ui-language` 规范能力；Excalidraw/PNG、`docs/design/desktop-review/` 及能力矩阵继续作为图示和评审入口。
- 规范：`desktop-webui-language` 的 proposal、design、spec、tasks 构成统一基线；保持 DUL-001 至 DUL-016 与 UIL-001 编号，spec 使用中文。
- 后续实现依赖：本地认证与进程生命周期、Service 隔离及 HTTP/SSE/WebSocket/会话、文件转接与编辑限额、大包传输、本地已知操作记录的身份边界。
- 现有运行行为：不变更 CLI/Core/agentd 代码、数据格式、接口、权限或 Serve 管理功能；不引入运行时依赖、数据迁移或部署。
