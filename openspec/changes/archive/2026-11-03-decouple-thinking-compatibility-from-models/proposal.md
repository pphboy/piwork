# Proposal

## Why

现有兼容 Thinking 只向 SDK 未收录的模型开放；已收录模型仍受内置档位限制，兼容入口也可能随 SDK 收录状态变化而消失。用户已明确要求兼容方式和档位只取决于 OpenAI Responses／Anthropic Messages 协议，使现有等级不依赖更新 SDK 模型目录才能使用。

## What Changes

- 对执行准入有效的两种协议模型，始终提供对应的版本化兼容方式和固定档位，覆盖 SDK 未收录、已收录但档位不完整、SDK 仅声明 Off 的情况；不再以模型 ID、名称、SDK 收录状态或 SDK 档位作为兼容入口及保存条件。
- Thinking 只提供一份去重等级列表，SDK、Responses effort、Messages 自适应及预算作为内部映射来源，不在选项、摘要或 Run 详情中展示兼容前缀、模式或预算说明；保留已有偏好的底层含义，不新增等级或协议。
- 展示、完整设置保存、Run 受理、SDK 初始化、实际请求和工具续轮共用同一协议定义；显式兼容映射优先于模型专用 Thinking 映射，不被 SDK 夹限或改写。
- 协商 chat contract 5，允许 SDK 已知模型同时携带 SDK 能力与兼容选项，保留 0–4 的读取和原能力边界。旧 Agent 的基础聊天继续可用，界面按真实能力提示更新 Agent，不把运行器能力缺失误报为必须更新 SDK 模型目录。
- 沿用现有 Session/Run 字段、版本化 profile、历史和快照格式；已有偏好与已接受 Run 不迁移、不回填，服务端拒绝不触发自动降档、换方式或普通模式重发。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ai-model-management`: SDK 已知能力作为独立事实保留，兼容设置按连接协议提供，不要求管理员更新 SDK、填写能力模板或改变 Model ID。
- `agent-conversation`: 移除兼容选择对 SDK 未收录状态的限制，统一协议校验和执行优先级，并协商新版可选聊天契约。
- `desktop-webui`: 已知及未知模型都能从现有 Thinking 入口选择后端声明的兼容档位，隐藏 SDK／协议映射来源并保留旧 Agent 的能力边界。

## Impact

- `apps/agentd/src/{thinking-profiles,run-models,sessions,runs,pi-sdk-executor,application}.ts`：目录、校验、受理、请求映射和可选能力声明。
- `packages/contracts/src/chat-controls.ts`、生成的 Go DTO/schema、`internal/agentclient/`、`internal/coreapp/conversation.go`：contract 5 的目录和版本识别；已有 profile 字段及 protobuf 结构复用。
- `apps/desktop-webui/src/{app,adapter,models}.ts` 与相关中英文文案、Go 嵌入资源：兼容选项展示、保存协调和升级提示。
- 对应契约、Agent 真实 SDK 合成网关、Go Core/Agent 集成和浏览器测试：验证已知／未知／仅 Off 模型使用相同协议映射，以及拒绝、重启和快照回归。
- 固定 Pi 0.86.1 和现有三种 profile 的映射不变；不新增历史 schema、管理员设置、模型探测或 SDK 升级。用户随后追加要求将功能落实到给定的本机开发实例；增加保留现有运行版本改动的候选构建、备份、Core 更新、目标 Work 的受管 Agent Apply 和实际页面验证。外部发布及发行材料更新仍不在范围内。
