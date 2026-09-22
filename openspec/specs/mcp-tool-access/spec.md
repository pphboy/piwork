# MCP Tool Access Specification

## Purpose

使 Work 中配置的 MCP 服务真正成为 agent 可发现和调用的工具，并区分本地进程、Work 容器和远程服务的生命周期，明确必要依赖、超时、凭证及连接故障对 Work 可用性的影响。

## Requirements

### Requirement: Discover and invoke configured MCP tools

系统 SHALL 支持配置的 stdio 和 Streamable HTTP MCP 服务，将工具以可区分 server 身份的名称暴露给当前 Work 的 agent，验证调用参数并返回工具结果或明确错误。凭证 SHALL 按需要注入，不能返回到工具发现响应。

#### Scenario: Agent invokes an MCP fixture

- **WHEN** 一个配置的 MCP server 提供确定性工具且 agent 发起有效调用
- **THEN** 工具被发现并执行，agent 得到其结果，运行事件可以关联 server 和 tool

#### Scenario: Two servers expose the same tool name

- **WHEN** 两个 MCP server 都暴露名为 search 的工具
- **THEN** 两个工具具有不同可寻址身份，调用不会被静默路由到错误 server

### Requirement: Distinguish required and optional dependencies

MCP 配置 SHALL 声明 required 或 optional；required 初始化失败 SHALL 阻止 agent ready，optional 失败 SHALL 保持 agent 可用并报告工具不可用。依赖本 Work 服务的 required MCP SHALL 使用显式服务引用；不接受循环或不存在的依赖。

#### Scenario: Required MCP is unavailable

- **WHEN** required MCP 在配置初始化期限内不能完成连接和发现
- **THEN** Work 报告具体依赖错误，不接受 Run

#### Scenario: Optional MCP is unavailable

- **WHEN** optional MCP 无法连接但其他必要初始化成功
- **THEN** agent 可接受对话，调用该 server 工具返回不可用错误，不伪造成功结果

### Requirement: Bound tool calls and connection recovery

MCP 调用 SHALL 有可配置超时，默认 30 秒；到期 SHALL 返回工具超时且不自动重复可能有副作用的调用。连接重建 SHALL 有有界预算，状态与错误可查询。

#### Scenario: Tool call times out

- **WHEN** 工具执行超过有效超时
- **THEN** Run 得到明确工具错误，系统不因重连自动再次执行同一调用

### Requirement: Own local processes and respect external lifecycles

daemon SHALL 回收自己启动的本地 MCP 进程及受管子进程，退出宽限默认 5 秒、之后终止；Work 容器 MCP 的启停 SHALL 遵循 work-services，远程 MCP 仅断开连接不能被 piwork 停止。

#### Scenario: Stop Work with local and remote MCP

- **WHEN** Work 停止且连接了本地 stdio 和远程 HTTP MCP
- **THEN** 本地受管进程被回收，远程连接关闭，远程服务继续运行

#### Scenario: Change MCP configuration

- **WHEN** 用户修改 MCP 配置后重启 Work
- **THEN** 新配置连接被建立，旧本地进程和旧工具列表不被复用

### Requirement: Expose default Work service control through real MCP tools

**Identifier:** MCP-SERVICE-001

Fresh installation default Work configuration SHALL include required stdio MCP server `work-services`. When selected in the active Work context, its discovered tools SHALL be registered in every new/restored Pi SDK Session and be callable through a real MCP request followed by authenticated Core gRPC. Tools SHALL not expose a caller-selectable Work ID, runtime identity, Docker ID, credential, or host path. Core policy, routing, and readiness names SHALL use the canonical `work-services.<tool>` server namespace. Because supported model APIs restrict tool identifiers to letters, digits, underscores, and hyphens, SDK model registration SHALL deterministically project those names to `work-services__<tool>` and route calls back to the canonical MCP name without changing authorization. The `work-services` profile SHALL use the bundled stdio adapter and MUST NOT accept an alternate executable, args, URL, secret references, or a dependency on a Work service under that identity. Required initialization SHALL finish actual discovery and SDK registration before readiness; the runtime report SHALL identify the registered permitted canonical tools. Tool policy allowed/denied SHALL filter canonical MCP names with denied taking precedence. Explicit removal of this MCP server SHALL remove its tools after successful apply; removing only its instructional Skill SHALL not itself grant or revoke tool authority.

#### Scenario: Discover and invoke deployment tools
- **WHEN** a fresh default Work completes initialization and the model selects `work-services__service_create`
- **THEN** the SDK exposes its validated schema and dispatches it as canonical `work-services.service_create` through MCP to Core gRPC; a direct fake callback is insufficient

#### Scenario: Register provider-compatible tool identifiers
- **WHEN** a provider validates the SDK tool list before accepting a model request
- **THEN** every model-facing MCP tool name matches `^[a-zA-Z0-9_-]+$`, remains unique, and is no longer than 64 characters

#### Scenario: Respect denied deployment tools
- **WHEN** active policy denies work-services.service_create
- **THEN** that tool is absent from SDK callable tools and cannot be invoked through the bridge

#### Scenario: Honor explicit MCP removal
- **WHEN** the owner saves mcpServers [] and applies successfully
- **THEN** new/restored Sessions use that active context without deployment MCP tools

#### Scenario: Required adapter fails
- **WHEN** the selected required adapter cannot start or discover tools
- **THEN** Work initialization fails with an MCP-specific diagnostic rather than claiming deployment capability

### Requirement: Separate tool call completion from durable deployment completion

**Identifier:** MCP-SERVICE-002

Service mutation tools SHALL return durable acceptance within the normal bounded MCP call; they SHALL NOT wait through image pulls or full readiness deadlines. The tool set SHALL provide `deployment_context`, `service_create`, `service_list`, `service_get`, `service_update`, `service_start`, `service_stop`, `service_restart`, `service_remove`, `service_retry`, `operation_get`, and `service_logs`. Mutation keys SHALL be required. A timed-out call MUST NOT be retried with a new key automatically; the same key can recover acceptance. Operation reads SHALL stay scoped to service Operations in the caller Work. The adapter SHALL use stdout exclusively for MCP messages and stderr for safe diagnostics, and SHALL exit with its owning agentd under the existing five-second child cleanup bound.

#### Scenario: A slow registry does not exhaust the MCP call
- **WHEN** Core durably accepts creation and image pulling lasts longer than 30 seconds
- **THEN** the tool already returned the accepted Operation, which can be polled without another create

#### Scenario: Lost acceptance response
- **WHEN** MCP observation is interrupted after Core acceptance
- **THEN** a retry using the same key returns the same Operation and service, with no duplicate deployment

#### Scenario: Stop the adapter
- **WHEN** Work stops with the service MCP subprocess connected
- **THEN** agentd closes MCP and reaps the subprocess within the shutdown bound; Core retains accepted Operations

#### Scenario: Reject a substituted built-in adapter
- **WHEN** a Work configuration uses serverId work-services with a different executable or a requiredServiceId
- **THEN** Core rejects the configuration before activation without launching that substituted process
