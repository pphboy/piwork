# Proposal

## Why

当前固定 Pi SDK 未收录的模型只能使用普通模式，聊天界面、会话保存和 Run 受理都会拒绝非空 Thinking；新型号或网关别名因此即使实际支持推理，也无法由用户设置。用户已明确选择在聊天设置内提供兼容推理，无需管理员配置能力模板。

## What Changes

- 为 SDK 未确认 Thinking 的模型，在现有 Response settings / `/thinking` 中提供按连接协议声明的兼容推理选项与档位，覆盖 OpenAI Responses、Anthropic Messages 及使用这两种协议的服务。
- 保留未知模型默认普通模式（`thinkingLevel=null`）；用户明确选择后才请求兼容推理，明确区分 SDK 确认的能力与用户请求的兼容参数。
- 会话偏好、Run 受理、真实 SDK 请求、历史读取和快照往返一致保留兼容配置；失败不静默降档或换成普通模式重发。
- 保持 SDK 已知模型的现有档位和映射、模型管理表单及自动 Run 默认行为；不按 `opus-5-5` 等名称猜测能力，不以更新 SDK 目录作为解决未知模型问题的前提。
- 协商新版聊天契约，旧 Agent 保留原能力并给出升级方向，禁止将兼容配置丢弃后假装保存成功。

## Capabilities

### New Capabilities

无；复用现有模型与聊天能力。

### Modified Capabilities

- `ai-model-management`: 未知模型无需管理员能力配置即可在聊天中显式请求兼容推理，调整“未知 Thinking 不提供档位”的边界。
- `agent-conversation`: 扩展模型/Thinking 原子偏好、请求映射及历史契约，区分普通、SDK 确认与兼容请求。
- `desktop-webui`: 在现有响应设置和网页命令中选择兼容推理，保留自动保存、结果未知恢复和上下文隔离。
- `portable-work`、`native-runtime-distribution`、`work-memory`、`runnable-work-runtime`: 当前 Agent 写入 schema 7，保留原 schema 4/5/6 的精确静态读取与导入；显式 Apply 经备份后一次升级到 7，支持失败恢复并拒绝不兼容旧 Agent 降级。

## 已确认的会话生命周期修正

消除 Session 对创建时环境的永久执行绑定。Session 保存 Work 内连续对话；每个新 Run 固定受理时的 active context，既有 Run 不变。镜像、Skills、包、AGENTS、MCP 和工具更新采用同一语义，不新增升级兼容白名单或会话转接机制。history schema 7 移除 Session 环境列，受管 Apply 在完整备份后一次升级已知旧格式，SDK 原文和旧 Run 执行事实不改写。

## Impact

- `apps/agentd/src/run-models.ts`、`sessions.ts`、`runs.ts`、`pi-sdk-executor.ts`：能力描述、共同校验、受理快照与协议执行。
- `packages/contracts/`、相关 proto/生成代码、Go Agent client/Core 代理、`internal/workhistory/` 和快照校验：新版契约及持久兼容语义。
- `apps/desktop-webui/src/{app.ts,adapter.ts,models.ts,i18n/app.js}`：兼容选项、中英文提示和状态恢复；构建后的 Go 嵌入资源需同步。
- 扩展现有 Agent 单元/SDK 网关测试、Go 跨语言/历史/快照测试和浏览器用例。无需生产 Key，也不新增模型协议、管理员选项或发行操作。
