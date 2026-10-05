# Proposal

## Why

Desktop 的普通页面读取仍以通用检查条打断工作；Chat 中工具开始与结束事件重复占行、模型选择需要额外保存，Service 视口也缺少与 Chat 配合的专注布局。这些问题占用用户使用应用、阅读回复和继续输入的空间，需要以同一套任务层级和状态规则改进 Work 工作区。初版实施后还出现 Focus → Focus chat 退出入口丢失、Model/Thinking 与发送错行、兼容注册将 Thinking 固定为 Off，以及新增控件未沿用现有交互语言；本次修订在原范围内补足这些要求。

## What Changes

- 页面进入采用稳定外壳、内容区骨架和就地等待；已有内容可先展示并标明更新状态，正常后台读取静默完成。移除普通导航中的通用 Check/Checked/Confirmed 条，将检查保留为明确的刷新、诊断和未知结果恢复。
- 将同一次工具调用的开始、结束和保存结果按稳定身份合并；连续工具调用组成默认折叠的 Activity，保留正文顺序、错误摘要、阅读位置及展开选择。历史读取补齐工具与 Run 的安全关联。
- 增加输入框 slash command 搜索和键盘选择。首版仅支持当前 Work active 中已加载的 Skill、Prompt Template，以及 `/new`、`/resume`、`/model`、`/thinking`、`/settings` 的网页入口；未知命令不能静默作为模型问题或扩展命令执行。
- Model、Thinking 与 Enter/Send 在同一输入底栏对齐，复用现有选择器、菜单与反馈；选择后自动保存完整设置对。Model 来自 Core 准入与固定 Pi SDK 支持范围的交集，Thinking 来自实际 SDK 解析模型；兼容注册保留 SDK 已有能力，实际请求与受理设置一致。可靠确认后用于下一次新手动 Run，当前 Run 不随偏好变化。
- Focus、Focus chat、恢复、退出、Chat 显隐与 Full screen 使用现有轻量图标按钮。明确常规、Service + Chat、仅 Service、仅 Chat 的转换：Restore layout 返回放大前布局，Exit focus 从任一专注视图恢复进入前常规工作区；退出不依赖可被隐藏的 Service 工具栏。浏览器全屏单独管理，布局转换保持同一 iframe 和当前对话。

### Goals

- 用户打开 Work 或切换模块时，立即知道所在对象并看到内容或局部等待；成功读取不留下检查流水，错误和未知修改仍可恢复。
- Chat 以消息、回答和下一步输入为主，执行详情按需展开，模型与 Thinking 在输入位置可见、可选择、可确认。
- 用户可以在同一 Work、Service 和 Session 中连续切换常规、Service + Chat、仅 Service 和仅 Chat，始终能恢复布局或退出专注，应用输入、对话草稿与执行身份保持稳定。
- 将已确认的基础命令范围做成可实施方案，复用 Pi SDK 的 Skill/模板展开和现有网页动作，避免引入终端交互适配作为本轮前置。

### Non-goals

- 不实施任意扩展命令、Pi TUI、自定义终端组件、`/compact`、会话树、fork/clone、分享、Provider 登录或完整 Pi 命令兼容。
- 不改变 Work 生命周期、单 Work 单活跃 Run、显式取消、Save/Apply、浏览器授权和 Service 数据来源边界；不以 UI 导航自动重发业务修改。
- 不把 Thinking 原文流、工具参数全集或网页 DOM 采集引入默认对话。
- 本轮界面改造限定 Desktop；Console 管理界面、主题编辑器和通用设计系统不在范围内。
- 不升级 Pi SDK、不自动替换 Work 固定镜像、不修改 SQL history schema 4、`.work` formatVersion 1 或 storage layout 2，不新增历史格式迁移。

## Capabilities

### New Capabilities

无；能力归入现有 Work、Chat 和 Service 规范。

### Modified Capabilities

- `desktop-ui-language`：补足低干扰反馈、Chat 输入控制和专注容器语言，并为常规 Work 身份栏/模块导航规定专注模式例外。
- `desktop-webui`：调整页面读取及初始化反馈、模型保存交互；定义 Activity 合并、基础 slash command、Thinking 选择和 Service 专注/全屏的完整状态、键盘及返回行为。
- `agent-conversation`：增加 active 命令安全目录、Session 完整聊天设置与受理时 Thinking 快照；扩展持久历史的工具安全投影与输入模式，并保持幂等、观察恢复和导出导入规则。
- `browser-service-access`：扩展专注视图与浏览器全屏的布局/返回契约，保持原应用 origin、iframe、准入、不可嵌入回退与独立打开行为。

## Impact

- Desktop：`apps/desktop-webui/src/app.ts`、`adapter.ts`、`models.ts`、`action-state.ts` 及 `public/style.css`；新增局部工作区/命令/消息投影模块，沿用现有视觉令牌与英文产品标签。
- 会话执行：`apps/agentd/src/application.ts`、`sessions.ts`、`runs.ts`、`run-models.ts`、`package-resources.ts`、`pi-sdk-executor.ts`；`packages/pi-adapter/src/session-persistence.ts` 和安全历史投影。
- 接口：新增工作区聊天能力的可选契约、命令目录、模型 Thinking 能力、Session 聊天设置及按原创建/提交键只读核对接口；Run 输入模式和历史工具块以新增 protobuf 字段承载，经 Go Core、Agent client、Desktop CLI 白名单及原所有者授权转发。既有模型 API 保持兼容。
- 持久化与兼容：在已有 Session/Run 的 JSON 列中增加可选设置，SQL 表结构保持不变；同步更新 TS 与 Go 的结构化历史校验。旧记录缺省 Thinking 为旧行为 Off；旧 Agent 缺少新能力时保留基础聊天并明确功能不可用，不因缺字段猜测支持。
- 并发与安全：按原 Session 协调自动保存，设置对原子确认；接受快照、原提交键、身份隔离和晚响应过滤不变。命令目录只读取当前 active 捕获资源，公开投影不返回宿主路径、密钥或内部 context identity。
- 验证：受控浏览器覆盖等待、未知保存、工具事件恢复、命令键盘操作、iframe 稳定和窄屏；SDK/Go 验证实际 Thinking、命令展开、准入与导出导入。补充 Focus → Focus chat → Restore layout → Exit focus、SDK 已知兼容模型档位及 Off/非 Off 的真实请求、底栏对齐与图标/菜单一致性验收。构建时同步 Desktop 的 Go embed 与 Agent 镜像，规划阶段不构建或重启用户运行环境。
- 成本判断：基础命令复用现有动作与 SDK 展开，属于低至中等成本；Thinking、稳定工具历史投影属于中等成本。专注布局的主要验收风险是 DOM 稳定性，完整 Pi 扩展/TUI 兼容已排除。本判断是静态代码评估，不作为交付工期承诺。
