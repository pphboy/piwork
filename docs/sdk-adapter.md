# pi SDK adapter decisions

The product adapter pins `@earendil-works/pi-coding-agent` to `0.86.1`.

Go 平台迁移保留完整 TS Agent harness 和 Pi SDK adapter。包准备程序已提供 Go 四入口；来源、依赖、静态制品校验及镜像内工具边界见 [pi-package-helper.md](pi-package-helper.md)。准备环境必须取自固定目标镜像，不使用宿主 Node ABI。Go helper 与完整镜像的集成状态以迁移任务 3.9 为准。

## Go Core 与 TS Agent 的运行边界

Go Core 负责用户/operator 鉴权、Work desired/active 状态与 Operation 持久化、配置/context 捕获、Docker 资源及代次管理、就绪核验和路由准入。TS `pi-agentd` 继续负责 Pi SDK、AgentService RPC、Session/Run、JSONL 历史、模型/工具执行及 MCP 客户端。Core 通过 Work 私网中的代次限定双向 TLS gRPC 调用 Agent；只有当前受管代次核验就绪后，Core 才公开该 Work 的 Session/Run 路由。Agent 不把 Core 的用户凭证或宿主私有目录当作自己的状态。

Core 的 HTTP Session create/list/read、Run submit/get/cancel 与 WatchRun 事件流转发至 Agent。Core 在转发前完成 Work 授权；重复提交由既有幂等契约控制，观察连接断开只结束该连接，不调用 `CancelRun` 或 `AgentSession.abort()`。明确的 Run cancel 才进入 Agent 的取消边界。Session 与历史保存在 Work 私有卷中，workspace 是另一个共享卷。Go Core 正常停止会确认停止受管 Agent，但保留 desired-running 与两个卷；同目录重启后核验代次并恢复，仍可通过原 Session ID 继续。真实 Agent 集成测试覆盖这条重启和继续对话链路；Service、文件、包和快照的跨模块恢复测试及 Core gate 结果见 [迁移验收记录](go-migration-acceptance.md)。

内置 `work-services` stdio 服务端已实现为 Go，保留 12 个工具、现有 namespace/defaults 和 uint64 JSON 字符串投影。Agent 的 TS MCP client/SDK 注册逻辑继续保留；配置、mTLS 与退出边界见 [service-mcp.md](service-mcp.md)。工具接受结果与后台 Operation 完成仍是两个阶段。

Persistent history uses the SDK's public `SessionManager` surface:

- `SessionManager.create(cwd, sessionRoot, { id? })` creates the JSONL history.
- `SessionManager.findById(cwd, id, sessionRoot)` resolves an exact stable ID.
- `SessionManager.open(path, sessionRoot, cwd)` reloads the same history.
- `appendMessage()` records user and assistant messages. The SDK intentionally
  creates the JSONL file only after an assistant message exists, so a stable
  history path does not by itself prove that data has reached disk.

The Work Store will retain the stable SDK session ID and history path as an
index. The JSONL transcript remains the conversation source of truth. Tests run
creation and loading in separate Node processes so an in-memory registry cannot
accidentally satisfy the recovery check.

The SDK smoke path uses these additional public interfaces:

- `loadSkillsFromDir()` plus an isolated `ResourceLoader` loads only the Skills
  materialized for the active Work configuration.
- `defineTool()` and `createAgentSession({ customTools })` register Work tools.
- `AgentSession.abort()` is the explicit cancellation boundary; observer loss
  never calls it.
- A local `ModelRuntime.registerProvider()` fixture drives deterministic tool
  calls and aborts without model credentials or network access.

The MCP fixtures use the official TypeScript MCP SDK. Both stdio and Streamable
HTTP servers expose an `echo` tool with transport-specific results so later
namespace and lifecycle tests can distinguish their routing.
