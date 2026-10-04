# Proposal

## Why

master 已交付 Go Core、原生 CLI/helper 和新的 Desktop 产品流程，而 `1608098` 中的 pi-brain、Service 双向反馈与 Chat 模型选择尚未接入这个基线。需要一次完整的功能整合，使未发布 MVP 只有一套 Go 平台实现，并在真实 SDK、真实 Service 和完整环境分享中证明闭环，不留下旧 TS Core 的运行、构建或测试依赖。

## What Changes

- 从 master `a980c189be074c2a6d87cc88d7f942fbab7998c4` 建立实施基线；`1608098987617eca8a277a4676d26265f9b7f0f3` 仅提供已实现功能及可复用 Agent/brain 代码。保留 master 的 Go 架构和 UI 产品逻辑，逐项迁入功能，不整体覆盖 master 文件。
- 在 Go Core 中补齐模型解析、当前 Service 交互绑定、脑包默认准备、候选捕获/发布、反馈授权转发、运行准入及完整冷快照；相关任务和幂等事实使用 Go 现有持久化体系。
- 将 `piwork-brain` 资源归属移到 `internal/coreassets/piwork-brain/`，通过 Go 交付为 Work 内 `.pi/packages/piwork-brain/` 的本地 Pi extension package；保持编辑副本与实际 active 包分离，不将其作为 npm Node module 交付。
- 复用 Agent 内固定 CoreFlow/CoreLoop、Service 的状态/Action/Job/Event、可靠收件、结果回执、证据和经验；Service 业务交互直接连接 Agent，Go Core 不成为业务事件中心或业务状态数据库。
- Chat 支持同一 Session 的下一次手动 Run 选模型，公开实际模型和执行来源；自动请求使用受理时 Work 的 active 默认模型。保留幂等、单活跃 Run、工具权限和无静默模型回退。
- UI 以 master 的 Work List 与 Services/Files/Chat/Settings 为准，将处理记录和证据放入 Chat/详情，将候选更新放入 Pi Packages；沿用即时反馈、对象级锁、原 ID 恢复、身份隔离、Work 控制版本及不重载 Service 的规则。
- **BREAKING** 最终 MVP 使用 history schema 4，统一 Go 历史校验、Agent 数据、快照与 fixture。只恢复本版写入的有效数据，不实现旧 TS Core、schema 3 或旧候选格式的升级、双读与缺字段补齐；明确拒绝不受支持的输入且不改写原数据。
- 将旧平台相关的验收脚本迁到 Go 程序或 Go 测试，删除失效入口；源码边界检查覆盖 scripts、构建/启动清单和发布内容，独立发布宿主不依赖 Node/npm。
- 在同一版本验收八条回路：默认创建、用户观测、自动请求、服务改进与经验采用、脑包实际采用、故障恢复、两份独立环境分享、Chat 模型选择。工作站参考使用 Python/NiceGUI/SQLite，但 Service 技术栈不限。

本次不增加消息中间件、通用工作流平台、跨 Work 编排、模板市场或新的业务导航。PiSDK/Agent、脑包 extension 与浏览器继续使用目标架构中的 TS；旧 TS Core/CLI/helper 不再作为维护对象。

## Capabilities

### New Capabilities

- `piwork-brain`：本地脑包默认加载、工作站开发认知、证据、有效经验、服务与脑包更新的实际采用。
- `work-agent-feedback`：Service 双向交互、持久事实与显式自动请求、固定执行循环、等待/取消/恢复和结果验证。

### Modified Capabilities

- `serve-control-plane`：Go 平台唯一交付、默认脑包准备和源码/脚本/发布的依赖边界。
- `agent-conversation`：Run 模型选择与幂等、Session 偏好、自动执行来源及反馈历史。
- `agent-service-deployment`：默认部署认知纳入脑包，Pi 开发的 Service 在首次交付即提供状态、Action、Event 和反馈。
- `pi-package-management`：当前 Work 脑包候选的捕获、持久受理、原子 desired 发布与显式 Apply 后的实际采用。
- `runnable-work-runtime`：Go 提供的模型解析和 Service 身份、当前版本握手、生命周期准入与绑定刷新。
- `work-configuration`：聊天偏好/经验与 active/desired 分离，当前 MVP history schema 与同版本恢复。
- `portable-work`：schema 4 完整闭包、反馈引用校验、目标身份与模型解析、导入历史不执行和独立新反馈。
- `control-cli`：Go 客户端及 Desktop 后端的模型/来源/反馈投影，原 ID 与身份恢复规则。
- `desktop-webui`：按 master 页面和反馈机制接入模型、处理记录、证据、候选状态及分享回路。
- `desktop-ui-language`：在既有 Work 工作区中表达可查来源和有限自动处理，保持产品布局、取消、Apply 与状态语义。

## Impact

- **Go 平台**：`internal/coreapp`、`corestore`、`agentclient`、`contracts`、`rpc`、`workcontext`、`workruntime`、`dockerengine`、`internaltls`、`coreassets`、`packageprepare`、`packagehelper`、`workhistory`、`snapshothelper`、`workpackage`、`client`、`cli`。
- **保留的 TS**：`apps/agentd`、`apps/desktop-webui`、`packages/contracts`、`work-store`、`pi-adapter`、`pi-package`；根 `proto/` 为双端协议来源，不恢复旧控制面 workspaces。
- **构建/验证**：master 原生镜像与 Makefile、package lock、brain/desktop/package/file 故障脚本、工作站 fixture、原生宿主与源码/镜像/发布边界检查。
- **文档与规范**：只提供当前 Go 入口；旧 OpenSpec 归档作为只读历史，不参与构建、运行和验收。已有 Go 平台和 UI 回归继续执行，新版本证据不使用旧 TS 平台测试结果替代。
- **并发与恢复**：保留 master 的鉴权、安装范围及代次校验、凭证并发保护和 Work 控制版本；候选晚返回不得覆盖用户新 desired，查询跨过期限不得续接任务，导入历史和来源 outbox 不自动重放。
