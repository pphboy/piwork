# Proposal

## Why

piwork-brain 已有 Service 开发与部署认知，但尚未明确表达应用的产品、UI、UX、状态自更新和工程取舍原则。将这些跨开发环节的判断全部附着于部署 Skill 会混淆职责；需要独立、按任务读取的认知入口，同时保持最短交付路径。

## What Changes

- 新增一个与 `deploy-work-service` 平级的 `application-awareness` Skill，在其 `SKILL.md` 中完整承载用户提供的 Product、UI、UX、Reactivity、Engineering Judgment 五类认知及完成标准，不拆成五个 Skill，不为这五类正文增加必读 Reference 中转。
- 在 `brain.md` 保留简短的原则与独立路由：应用创建、功能/交互修改读取新 Skill；持久 Service 的开发、部署与生效验证继续采用原 Skill。普通 Query/Action、仅启停服务和部署未改造的第三方镜像不因新认知进入产品设计路径。
- 将这些认知定义为当前实现中的判断依据，不新增设计报告、人工确认、五阶段检查、额外 Agent/Run 或视觉评分；只处理影响任务完成、理解、操作及状态正确性的问题，细微装饰不阻塞交付。
- 明确业务状态自动更新与代码版本自动采用的区别，复用现有 NiceGUI 模板、共享权威状态和简单同步机制，保护用户未提交输入及当前操作。
- 在独立认知中补充样式隔离、真实页面验收和按证据归因的通用原则；NiceGUI 的类名冲突、连接/遮罩/样式排查细节放在该 Skill 下仅相关任务读取的 `references/nicegui.md`，不新增 Skill，也不转入部署 Skill。
- 默认 web-app/workstation 模板的自定义 CSS 类采用业务前缀并限定作用范围，避免全局 `.column`、`.row`、`.card` 等规则误改框架容器；保留既有页面结构和业务流程。
- 页面交付从用户实际 Desktop Service 入口验证可见内容、主要操作及状态自更新，不以 Ready、HTTP 200 或业务接口通过替代。浏览器能力不可用时明确页面未验证，不擅自安装工具、扩大授权或宣称界面已通过；只检查受影响页面，不做视觉评分或全页面巡检。
- 将“代码已采用但业务查询失败”补成直接故障回归，验证陈旧/失败提示、草稿保留和恢复；白屏先采集资源、浏览器错误、连接、遮罩及样式证据，不无依据更换框架或归因为架构不兼容。
- 通过现有包发现与 SDK read 工具读取正文，保留冻结包、禁用/空选择和显式 Apply 边界；递增脑包版本，补充交付/加载/读取回归及采用说明。

## Capabilities

### New Capabilities

无。新增 Skill 属于现有脑包能力，不新增平台子系统。

### Modified Capabilities

- `piwork-brain`：扩展默认认知的平级路由，定义完整应用认知、按需 NiceGUI 指导、交付成本边界、业务状态同步、样式隔离、真实页面验证与证据归因要求。

## Impact

- 脑包实现：`internal/coreassets/piwork-brain/brain.md`、新增 `skills/application-awareness/SKILL.md`、`package.json`；既有部署 Skill 保持原有职责，无需将五类内容复制进去。
- NiceGUI 专项：新 Skill 内按需 Reference，以及 `templates/web-app/`、`templates/workstation/` 的 `ui.py`、`style.css` 和相应说明；只做样式命名/作用范围与查询故障反馈的必要修正。
- 加载与交付验证：`apps/agentd/src/brain-resources.test.ts`、`internal/coreassets/brain_test.go`、Core 内置脑包升级/实际 SDK 集成测试；必要的合成模型夹具沿用 `packages/pi-adapter/`，不把脚本化调用宣称为任意模型都会遵循认知。
- 使用说明：`docs/piwork-brain.md`、相关测试入口及中英文 README 的对应说明。
- 原任务 1–4 的 14 项完成记录保留；追加 7 项未完成任务，旧验收事实不能替代新增 Reference、样式和故障路径的验证。
- 无 HTTP/RPC、存储 schema、工具权限或运行依赖变化；NiceGUI base、模板业务、BrainFlow/RunManager、独立 Memory 与现有部署机制继续复用。本 change 不包含镜像发行、远程部署或已有 Work 自动采用。
