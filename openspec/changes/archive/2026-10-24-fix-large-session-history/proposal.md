# Proposal

## Why

正常长会话经 Desktop、托管工作台或 CLI 读取时，合法的 Core JSON 会被共用客户端的 1 MiB 响应限制拒绝并显示 `Conversation could not be read / MALFORMED_RESPONSE`；整份历史的 gRPC 调用还受默认 4 MiB 接收与 agentd 6 MiB 发送限制。需要在一次完整变更中解除历史总量与单次传输大小的耦合，同时修复超大单条内容、完成刷新与断线恢复，避免只抬高下一次失败的门槛。

## What Changes

- 新增独立协商的历史分页契约：分页从 agentd 开始，Core、Desktop/托管工作台和 CLI 逐页消费，保留通用控制面响应保护。
- 历史页同时限制逻辑消息数和实际编码字节，默认最多 50 条消息、HTTP JSON 正文最多 512 KiB；超大消息通过稳定内容块身份和 UTF-8 分片完整读取。
- 使用绑定 Work/Session、读取范围和快照边界的游标，保证运行中追加、跨页工具关联和原图文输入落盘后的消息身份一致；失效游标明确恢复，不静默跳过内容。
- 新投影只传一次正文和当前页必要的 Run 摘要；大 `finalText` 通过同一历史通道读取，历史恢复所依赖的状态、事件和已接受 Run 查询不再重复夹带完整结果。
- UI 首次读取最近消息，按需加载更早内容并保持阅读位置；完成刷新、重连和 410 恢复统一使用新读取器。CLI `session show` 保持完整输出，分页失败不得输出伪完整成功结果。
- 补齐历史读取依赖中固定 1000 条 Run/事件查询造成的静默缺失，维护真实关联，不扩展为全局列表改造。
- 区分响应超限、传输不完整、游标失效和 JSON 格式错误；使用合成长会话覆盖整条链路，不裁剪原始 SDK 历史或降低既有工具预览上限来规避问题。

## Capabilities

### New Capabilities

无；在现有会话、工作台与 CLI 能力下增加契约。

### Modified Capabilities

- `agent-conversation`：增加有界历史分页、超大正文分片、一致快照、轻量 Run 观察与独立能力协商要求。
- `desktop-webui`：增加最近历史、向前加载、分片合并及全路径历史恢复要求，覆盖本机和托管模式。
- `control-cli`：增加透明遍历历史快照、完整 JSON 输出、失败处理和大结果读取要求。

## Impact

- 协议与生成物：`proto/agent.proto`、`packages/contracts/src/`、`internal/rpc/`、`internal/contracts/`，通过 `make generate` 同步 Go/TS 和跨语言验证。
- 历史源与 RPC：`packages/pi-adapter/src/session-persistence.ts`、`packages/work-store/src/store.ts`、`apps/agentd/src/sessions.ts`、`apps/agentd/src/application.ts`；保留 SDK 私有历史与现有包格式。
- Core 与客户端：`internal/agentclient/`、`internal/coreapp/conversation*.go`、`internal/client/`、`internal/cli/user_conversation.go`、`internal/cli/user_desktop*.go`，包括托管工作台共用入口。
- UI：`apps/desktop-webui/src/adapter.ts`、`chat-projection.ts`、`models.ts`、`app.ts` 及浏览器测试；构建时同步嵌入资源并重建宿主程序。
- 验证：真实 SDK 合成历史、Go gRPC/HTTP 契约、独立 CLI、两种工作台与隔离 Core/Agent 集成。不把本地构建验收扩展为推送镜像或对外发行。
- 兼容性：保留旧 API 和未声明新 profile 的旧客户端行为；旧 Agent 不支持新能力时明确提示运行环境更新，不自动换镜像、改 Session context 或重发执行。
