# pi SDK adapter decisions

## 可选工作区聊天契约

聊天增量使用 `chat_controls_contract_version=1`，未声明为 0，不加入现有 v2、
context/package/model/feedback/history readiness 的必需门槛。固定旧 Agent 继续基本
聊天；新客户端只能在能力确认后使用 Thinking、资源命令、完整设置与原键查询。
定义见 [工作区 UX 变更](../openspec/changes/archive/2026-10-05-improve-desktop-workspace-ux/design.md)
及 [Agent 会话规范](../openspec/specs/agent-conversation/spec.md)。

新增 AgentContent RPC 为 ListChatModels、ListSlashCommands、GetSessionChatOptions、
SetSessionChatOptions、LookupChatSubmission。模型公开描述保持原字段，能力列表补充
thinkingLevels/defaultThinkingLevel，Session/Run 另列 thinkingLevel。SubmitRun 的
optional inputMode 区分 text 与 command，省略保留原语义与幂等摘要。历史以安全顺序块
扩展原 entryId/role/text；工具结果投影有界且不返回参数、凭据或原始 Thinking。
协议 tag、SDK 0.86.1、SQL history schema 4、storage layout 2 与 .work 格式 1 保持不变。

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

## 当前模型、反馈与候选契约

根 `proto/agent.proto` 与 `proto/work-services.proto` 是 RPC 唯一生成源。运行
`node scripts/generate-protocol.mjs` 同时产生 Go、TS 代码及当前 descriptor fixture；
`internal/contracts/schemas.json` 是 Go HTTP DTO 的生成源。Agent 的共享叶子契约位于
`packages/contracts/src/work-feedback.ts`，不包含宿主控制面实现。

Agent readiness 明确报告 `run_model_contract_version=1`、
`work_feedback_contract_version=1`、`work_history_schema_version=4`；缺少任何一项不能
宣告支持这组能力。WorkServices 的五个私有 RPC 是 ListRunModels、ResolveRunModel、
GetServiceInteractionBindings、PrepareBrainCandidate、GetBrainCandidateState，仅限当前
Work Agent 的代次证书。公开模型描述只包含 modelRef、label、provider、model。

Run 的 modelRef 省略表示使用 Session 偏好，JSON null 表示 Work active 默认，字符串
表示明确模型引用。protobuf optional 字符串用未提供、空字符串、非空引用分别表达
这三个含义。Session preference PATCH 必须提供 null 或合法引用，不能省略该字段。
实际模型、来源及 adoptedExperienceVersion 固定在已受理 Run 上，后续偏好修改不影响它。

脑包候选提交必须携带 contractVersion=1 的 verificationTarget：piwork-brain 命名空间
内的确定工具、固定 input 和 1–8 个唯一 checkNames。brain_feedback 与
brain_package_update 不得作为验收工具。input 不超过 8 KiB、整个目标不超过 16 KiB；
工具输入禁止 URL、凭据与宿主路径。缺目标、未知字段、空或重复 checks 均拒绝，
不补齐候选字段。源摘要及 active/desired/context 基线与目标一起构成不可变提交。

## 当前 Work 历史

`internal/workhistory/schema.sql` 是 schema 4 的固定十三表定义；
`node scripts/generate-work-history.mjs` 同步 Agent 使用的 SQL 与双方静态 schema objects。
空库在一次事务内建立所有表，只写一条 version=4 格式记录。同版重启先核验完整 schema、
外键、完整性和幂等关联，再使用现有数据；不支持的版本、额外表/列/index/trigger
直接失败，不修改原文件，不执行任何源数据库提供的 SQL。

十三表是 schema_migrations、sessions、runs、run_events、submit_idempotency、
session_idempotency、work_activity、service_events、agent_requests、agent_request_runs、
agent_evidence、brain_experience_revisions、brain_experience_heads。模型偏好/selector、
实际模型、Run 来源及 adoptedExperienceVersion 分别持久化，不并入 Work desired 配置。
请求与 Run 受理共享同一事务；事件按 Work/持久 Service 来源/eventId 去重。
请求、Service 事件和证据分页每次最多读取 limit+1 行，limit 为 1–100；游标绑定原
Work/Service/过滤范围，以时间戳与稳定 ID 排序，同时间戳不漏项。

Go 原生 helper 在只读 scratch 副本上验证反馈、候选、证据和经验的关联图。
当前格式重建只修改声明的 Work/context 引用，导入收件、请求和关联标记为 historical；
SDK 历史、事件 origin 和业务 payload 保留原内容。Session 模型偏好按目标 provider、
model、baseUrl 唯一匹配，无匹配或多匹配标为 unavailable。

本组核验入口：`npm run test:unit -w @piwork/work-store`（36 项）与
`go test -mod=readonly ./internal/workhistory`。包括空库/同版恢复、不变输入、
唯一键/外键、跨来源有界分页、同时间戳游标以及篡改证明和两份历史副本。

## Go 模型解析与执行核对

Go WorkServices 根据当前 Agent 证书和最新 ready 代次授权私有 models/resolve 请求；
Work 已 Stop、旧代次、其他 Work 或安装的身份均拒绝。默认引用来自 Work active context，
安装默认的后续编辑不影响它。Core 只列出本安装 enabled 且描述、凭据可读的 catalog 模型，
Agent 再用本镜像的实际 Pi SDK 筛选。空选择列表是成功结果；catalog 或默认模型读取失败
是 unavailable，不作为空列表返回。

每次受理先解析并固定实际描述；执行前通过原 modelRef 与 expected provider/model/baseUrl
重新核对当前 catalog 与凭据。描述变化、禁用、凭据丢失直接失败，不替换模型。默认模型
也经过当前私有控制通道核对，与 captured Work 模型一致才执行。公开投影不包含 endpoint、
credentialRef、凭据或 Core 目录。凭据只通过当前 Agent mTLS resolve 响应传递。

核验：Go `TestNativeRunModels*`、`TestNativeRunModelDefaultAvailabilityAndEndpointNormalization`；
Agent models/Run/Session/SDK 21 项测试。真实 SDK 在同一 Session 连续调用本地确定性 API
的两个模型，分别观察 actual-model:fixture-model-one 与 actual-model:fixture-model-two，
并验证两个独立凭据、历史和持久 Run 不含覆盖凭据。

## Go Chat 模型受理

当前 Go HTTP 提供 `GET /api/v1/works/:id/models`、`PATCH /api/v1/works/:id/sessions/:sessionId/model`。PATCH 输入为 `{modelRef: null | catalogId}`；保存独立 Session 偏好，执行中的 Run 保留原 `actualModel`。`POST .../runs` 的 `modelRef` 省略取已确认偏好，null 取 captured active Work 默认，string 指定当前可用模型。busy 返回 429，不排队；同 submissionKey 先比对原输入再返回原 Run，不重新解析失效模型。模型相关公共视图仅含 modelRef/label/provider/model。保存响应丢失时读取原 Session 确认，禁止自动重发 PATCH 或发送依赖未确认偏好的 prompt。

Go 实际启动配置直接携带当前代次 mTLS 私有控制接口；测试 `TestNativeChatModelSelectionRunsThroughGoAndRealSDK` 在真实容器中验证同 Session 两个真实 SDK 模型、忙碌保存、显式默认、失效后重放和独立新 Session。

## 基础聊天控件与安全历史投影

可选 `chatControlsContractVersion = 1` 使用五个 `AgentContent` RPC：
`ListChatModels`、`ListSlashCommands`、`GetSessionChatOptions`、`SetSessionChatOptions`、
`LookupChatSubmission`。Readiness 字段 20；协议仍是 v2，原模型契约 1、反馈契约 1、
历史 schema 4 不变。Core 单独协商新能力，0 或未知版本不影响原普通聊天、模型与 Service。
产品行为以 [本变更设计](../openspec/changes/archive/2026-10-05-improve-desktop-workspace-ux/design.md) 和
[agent-conversation](../openspec/specs/agent-conversation/spec.md) 为准。

HTTP 前缀为 `/api/v1/works/:id`，Desktop 对应 `/_desktop/api/works/:id`：
`GET /chat-capabilities`、`GET /chat-models`、`GET /commands`、
`GET|PATCH /sessions/:sessionId/chat-options`、
`GET /sessions/submissions/:key`、`GET /runs/submissions/:key`。
PATCH 始终提交完整 `{modelRef, thinkingLevel}`；原模型 PATCH 保留 Thinking，
不兼容时完整拒绝。Thinking 来自固定 SDK 0.86.1 的实际模型能力，default-only 是合法结果。
每个受理 Run 固定实际模型和 Thinking，执行器核对 SDK 值；凭据解析不把 Thinking 当模型描述。

能力查询与执行共用 `resolveProductionModel`。内建 provider/id 保留固定 SDK 的完整定义；
仅对 `anthropic` 的官方 HTTPS `api.deepseek.com/anthropic` 端点，以相同 id 继承 SDK
`deepseek` 的名称、reasoning、thinkingLevelMap、模态与限制，保留原凭据绑定和 Messages
传输。代理域名、其他路径和未知 id 不猜测能力；新设置拒绝未确认能力，真正非推理模型
才提供 Off。旧模型专用接口、未带新输入模式且未保存 Thinking 的请求与自动处理保留旧
custom 模型行为，不将该兼容路径当作新能力确认。

该兼容模型的最终 payload 在已有扩展处理后落实受理值：Off 使用 disabled，其他档位使用
enabled 与 SDK 映射的 output_config.effort，不发送 Claude budget 或关闭时冲突的 effort。
其他 provider 使用 SDK 原生序列化。子 Agent 的私有模型文件保留 capability/compat 元数据，
仍绑定 Work 默认；手动 Session 偏好不改写它的凭据或配置。
`pi-sdk-executor.test.ts` 通过隔离 HTTP 捕获逐档核对最终请求、扩展链、SDK 实际值与持久
Run，并验证子 Agent 重载；没有请求真实 Provider。版本常量、SQL 与公开字段保持原值。

`SubmitRunRequest.input_mode` 为可选字段 6：`text` 禁止 slash 展开，`command` 仅执行
已加载 Skill/Prompt，省略保留原 SDK 行为与原幂等摘要。命令目录从 validated active loader
缓存读取，不重新加载扩展；网页命令、扩展冲突与不安全 token 不进入资源目录。
资源命令使用 SDK 展开参数，执行前确认目录、可读资源与扩展冲突。五个网页入口不发模型 Run。
原键查询只返回持久受理事实；not-found 不能证明在途请求失败，恢复不自动发送或重试。

SDK Session 在新 Run 前追加 `piwork-run` custom entry。公开历史保留原 role/text，增补
有序 blocks 和原 Run ID；标记必须对应同 Work/Session 的真实 Run。旧消息仅凭唯一原
持久 toolCallId 事件关联，缺证据时保留未知。工具预览以 UTF-8 64 KiB 为界，显示截断、
非文本或未确认状态；不包含参数全集、Thinking 原文、资源路径等私有元数据。
Session 的 Thinking 字段为 8，Run 为 17，消息 blocks/run_id 为 5/6，ToolEvent 预览为 6。
私有 SDK 文件与完整 `.work` 归档保留原始内容。
