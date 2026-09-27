# Runnable Work Runtime Specification

## Purpose

Defines the deployable Docker agent runtime and verified Core-to-agent conversation path that turn persisted Work metadata into a real Pi SDK Session and Run service.

## Requirements

### Requirement: Build a compatible agentd image from the workspace
The root workspace SHALL provide a reproducible command that builds a local agentd container image containing the compiled agent server and its production dependencies. The image MUST start as a non-root user, expose no Docker socket or host bind by default, and report a protocol/version identity that Core validates before marking a Work ready.

#### Scenario: Build and inspect the local image
- **WHEN** an operator runs the documented agent image build command in a clean checkout after installing dependencies
- **THEN** Docker produces the documented local image and its default entrypoint starts the compatible agentd server as a non-root user

#### Scenario: Reject an incompatible image
- **WHEN** a Work references an image whose entrypoint or protocol identity is incompatible
- **THEN** its Operation fails with an actionable compatibility error and Core never reports that Work ready

### Requirement: Materialize each Work into an isolated Docker runtime

**Identifier:** RUNTIME-MATERIALIZE-001

Creating or starting a Work SHALL materialize the operation-selected Work-owned context (captured creation/apply candidate or retained active context on ordinary restart), immutable agent image identity, complete Skill directories, `AGENTS.md`, effective runtime configuration, secret references, and tool policy into an isolated container; create or adopt one labeled Work network, persistent data/session storage, internal runtime identity, and one agentd container; then wait for verified readiness. Reconciliation MUST adopt matching resources and MUST NOT create two active agentd instances for one Work. The serving container SHALL receive only that Work's active owned context and MUST NOT read Core defaults, Core-managed Skill artifacts, operator import paths, host user Skill directories, another Work context, or pending desired context. Initial create and apply validation SHALL mount only the Operation-captured candidate with conversation routing closed until verification and activation; no later desired edit may substitute for that candidate.

同一只读 Work-owned context SHALL 包含全部选择的 package 制品及运行依赖，disabled 内容保留但不加载。runtime SHALL 不挂载 Core 当前包库、客户端源目录或临时上传。包失败 SHALL 遵循原子 materialization 和既有回退语义。

#### Scenario: Start one Work from its active context
- **WHEN** Core reconciles a valid Work whose desired lifecycle state is running
- **THEN** exactly one agentd container starts with the Work's retained data, Sessions, complete copied Skill trees, AGENTS content, runtime configuration, model credential reference, resource limits, and private network

#### Scenario: Start one Work from an accepted configuration
- **WHEN** Core starts a Work after its creation context was completely copied and accepted
- **THEN** exactly one agentd container receives that Work-owned captured creation context and reaches readiness before activation without rereading Core defaults or Skill sources

#### Scenario: Reconcile an existing instance
- **WHEN** Core repeats reconciliation after losing process state
- **THEN** it adopts the matching labeled container and Work-owned storage after verification instead of creating a duplicate or rereading a Skill import path

#### Scenario: Restart after a Core Skill changes
- **WHEN** a managed Skill used to create Work A is updated, disabled, removed, or its original source path disappears before Work A restarts
- **THEN** Work A restarts with the complete Skill copy in its active context and its behavior does not change

#### Scenario: Reject active context failure
- **WHEN** the Work-owned active context is missing, corrupted, or fails validation
- **THEN** the Operation fails with the Work and safe field identity, no partial or pending context is mounted, and no Run is accepted

#### Scenario: Reject context materialization failure
- **WHEN** Core cannot safely mount or validate the complete Work-owned context selected for an operation
- **THEN** the Operation fails with a safe Work and field identity, the prior active context is retained and restored according to WCFG-002 when present, and no partial context is used by a Run

#### Scenario: Mount packages without their source
- **WHEN** 包源 local/ZIP 被删除且 Core catalog 同名包不存在
- **THEN** runtime 从 Work-owned context 读取原制品，无需 source lookup

### Requirement: Keep model credentials out of public and persisted conversation data
Core SHALL resolve the selected model profile and mount the model credential into the Work as a read-only secret available only to the agentd process. Agentd SHALL read it without copying the credential into Work metadata, Session history, Run events, error messages, or diagnostics returned through Core.

#### Scenario: Start agentd with a model credential
- **WHEN** a configured Work starts with an available model secret
- **THEN** agentd can initialize the selected model while Core and CLI responses reveal only the non-secret provider and model identifiers

#### Scenario: Model credential is missing or invalid
- **WHEN** agentd cannot read or use the selected model credential
- **THEN** readiness or the affected Run fails with a safe model-configuration error that contains no credential value

### Requirement: Authenticate and verify Core-to-agent transport
Agentd SHALL listen only on its Work runtime network and Core SHALL connect using installation-controlled encrypted credentials tied to the Work identifier and runtime generation. Both sides MUST reject a mismatched Work, stale generation, untrusted peer, or direct unauthenticated request; Core MUST route Session and Run calls only after the current generation passes readiness verification.

#### Scenario: Route to the current generation
- **WHEN** Core has verified agentd for the current Work generation
- **THEN** authorized Session and Run calls reach that agentd without exposing its address or transport credential to the CLI

#### Scenario: Reject a stale daemon
- **WHEN** an older agentd generation remains reachable after a replacement starts
- **THEN** Core does not route new calls to it and its attempts to act as the current Work are rejected

### Requirement: Serve persistent Sessions from agentd
Agentd SHALL create, list, read, and continue Sessions through the agent protocol, bind every Session to its Work, persist the Session index and Pi SDK history on retained storage, and restore that history after agentd replacement. Session creation with the same idempotency key MUST return the same Session.

#### Scenario: Create and restore a Session
- **WHEN** a user creates a Session, completes a Run, and the agentd container is replaced with the same Work storage
- **THEN** the replacement lists the same Session and loads its prior Pi SDK message history

#### Scenario: Reject a cross-Work Session request
- **WHEN** a request presents a Session identifier that belongs to another Work
- **THEN** agentd rejects it without returning that Session's history

### Requirement: Execute Runs through the real Pi SDK

**Identifier:** RUNTIME-PI-001

Agentd SHALL durably accept a prompt and submission key, execute the Run with the configured model through the Pi SDK, persist ordered mapped events and a unique terminal state, and save the resulting Session history. A client or Core observation disconnect MUST NOT abort execution; explicit cancellation MUST request SDK abort and persist the resulting state. Each Session SHALL be constructed with the active Work-owned resource loader, including every file in its copied Skills, its AGENTS content, and its resolved tool policy.

每个 SDK session SHALL 获得独立的 package-aware resource runtime，按 PKGA-004 绑定 headless extension 事件，加载所绑定 context 的 enabled 包。工具实现与资源发现必须走真实 SDK，不能用 readiness 回显或 fixture 手写响应代替。已绑定旧 context 的 Session SHALL 保持既有 context mismatch 规则。

#### Scenario: Receive a deterministic acceptance reply through the real stack
- **WHEN** the acceptance fixture submits a prompt to a real agentd container configured with the deterministic model
- **THEN** the real Pi SDK executes it, agentd persists its events and result, and the CLI receives the expected assistant text through Core

#### Scenario: Use a real configured model
- **WHEN** the optional smoke is enabled with valid provider credentials and a user submits a prompt
- **THEN** agentd executes the Run through the configured real Pi SDK model and returns a non-empty assistant result

#### Scenario: Load complete Skill directories from the Work
- **WHEN** a Run uses a Skill whose instructions reference a copied script, reference, or template below that Skill directory
- **THEN** the Pi SDK resource loader exposes that Work-owned file and does not resolve it through a Core or host path

#### Scenario: Isolate Session context
- **WHEN** a Run starts for a Work with active Skills and AGENTS content
- **THEN** the Pi SDK exposes exactly that Work context and cannot load another Work, Core-managed source content, host user Skills, or pending desired content

#### Scenario: Session context is loaded from the Work
- **WHEN** a Session is created or restored for a ready Work
- **THEN** its Pi SDK resource loader reads the Work-owned active Skills and AGENTS content rather than resolving a Core or host source

#### Scenario: Retry a lost submit response
- **WHEN** Core repeats the same Session, submission key, and prompt after losing the first response
- **THEN** agentd returns the original Run and does not invoke the model a second time

#### Scenario: Execute package functionality in the real SDK
- **WHEN** deterministic model fixture 请求一个已授权包工具并读取包内 supporting file
- **THEN** 真实 SDK 调用包工具并读取 Work 自有文件，结果能区分包版本，持久 Run history 包含实际结果

### Requirement: Preserve Runs independently of transport lifetime
Agentd SHALL allow only one active Run per Work, keep accepted execution alive when an observer disconnects, retain ordered events within documented bounds, and expose Run status and final result after completion. Startup SHALL mark Runs abandoned by a prior agentd process as interrupted and MUST NOT replay them automatically.

#### Scenario: Disconnect while a Run is executing
- **WHEN** the Core-to-agent or client-to-Core observation stream closes during execution
- **THEN** the Run continues and a later observer can resume from a retained cursor or query its final result

#### Scenario: Restart during an active Run
- **WHEN** agentd restarts while a Run was accepted, running, or cancelling
- **THEN** recovery marks that Run interrupted, preserves recorded events and history, and does not repeat model or tool side effects

### Requirement: Drain and retain Work data on lifecycle operations
Stopping a Work SHALL prevent new Runs, perform bounded drain and cancellation, stop agentd, and retain its data and Session storage. Starting it again SHALL reuse that storage. Deleting a Work SHALL remove the runtime instance while following the documented retained-data policy rather than silently deleting conversation history.

#### Scenario: Stop and start a Work with history
- **WHEN** a Work with a completed Session is stopped and later started
- **THEN** the new agentd process becomes ready with the same Session and completed Run history available

#### Scenario: Stop cannot be confirmed
- **WHEN** Docker cannot confirm that agentd stopped within the lifecycle bounds
- **THEN** the Operation remains failed or incomplete with an explicit dependency error and Core does not report the Work stopped

### Requirement: Enable the full container tool set

**Identifier:** RUNTIME-TOOLS-001

每个隔离 Work 容器中的 Pi SDK SHALL 默认启用完整内置工具集：`read`、`bash`、`edit`、`write`、`grep`、`find` 和 `ls`。Work 配置中的 `tools.allowed` 与 `tools.denied` SHALL 作为最终策略：allowed 为空表示不额外收窄，denied 优先于 allowed；策略解析后的工具集合必须通过 agentd readiness 报告。该开放仅适用于隔离容器内的内置工具，不得授予 Docker socket 或宿主路径访问。

同一策略 SHALL 扩展到 PKGA-003 的 package canonical tool keys，保留 builtin 和 MCP 的已有键；包工具 native name 与 builtin/MCP/其他包冲突 SHALL 失败。只有策略允许的包工具进入模型工具集合；允许 extension 注册不自动绕过 denied。

#### Scenario: Default tools are available in a Work
- **WHEN** a Work starts with no tool deny policy
- **THEN** the agent session exposes all seven listed built-in tools and readiness reports the resolved set

#### Scenario: Denied tools are excluded
- **WHEN** a Work configuration denies `bash` and `write`
- **THEN** those tools are unavailable to the Pi SDK session while the other allowed built-in tools remain available

#### Scenario: Reject unsupported tool policy
- **WHEN** a configuration names an unknown built-in tool or attempts to grant a host or Docker capability
- **THEN** configuration activation fails with a public validation error and the Work is not reported ready

#### Scenario: Resolve package tool policy
- **WHEN** 包 tools 注册 hello，策略 deny package:tools:hello
- **THEN** readiness 和 SDK 模型工具列表均排除 hello，其他授权工具保持可用

### Requirement: Verify the loaded context before routing

**Identifier:** RUNTIME-CONTEXT-001

Core SHALL verify that daemon readiness identifies the expected Work, runtime generation, instance, supported context contract, captured context, configured Skill names with matching captured identities, and effective tool policy before routing Sessions/Runs or activating a candidate. The report SHALL describe actual completed SDK loading, not echo input descriptors. Verification SHALL apply to creation, start, restart, apply, rollback, and adoption after Core recovery. Missing required handshake fields or unsupported versions SHALL fail with `AGENT_CONTEXT_INCOMPATIBLE`; wrong context or loaded membership SHALL fail with `AGENT_CONTEXT_MISMATCH`. Internal identity fields MUST NOT appear in public configuration or diagnostics.

握手 SHALL 必需报告 packageContractVersion=1 及实际加载包的名称、内部制品身份和资源/工具来源；即使 packages=[] 也不能省略契约。Core SHALL 按 PKGA-005 验证 enabled 包集合完全匹配 captured context，并区别独立 Skills 与 package Skills。旧握手缺字段返回 AGENT_CONTEXT_INCOMPATIBLE；包成员/内容/工具错误返回 AGENT_CONTEXT_MISMATCH。

#### Scenario: Verify the expected copied Skills
- **WHEN** the current daemon reports the expected context and exactly the configured successfully loaded Skill identities and tools
- **THEN** Core can complete readiness for that context and publish its safe runtime Skill status

#### Scenario: Reject stale or incomplete readiness
- **WHEN** a daemon claims ready with a different context, another Work identity, stale generation, missing Skill, extra Skill, duplicate Skill, or mismatched captured identity
- **THEN** Core does not route or activate it and records a stable mismatch diagnostic

#### Scenario: Reject an old agent protocol
- **WHEN** an agent image omits the context handshake or declares an unsupported contract
- **THEN** the Operation reports `AGENT_CONTEXT_INCOMPATIBLE` with instructions to deploy a compatible Core/agentd pair, and Work is not ready

#### Scenario: Re-adopt after Core restart
- **WHEN** Core finds an existing labeled container after restarting
- **THEN** it validates the actual mounted context and full current handshake before adopting its loaded Skill status, rather than trusting labels or cached ready state alone

#### Scenario: Reject a stale package identity
- **WHEN** 名称和 version 相同但 agent 实际加载包 bytes 与 captured context 不同
- **THEN** Core 不发布 ready、路由或 active，记录安全 context mismatch

#### Scenario: Do not infer support from an empty package list
- **WHEN** 旧 agent 没有 packageContractVersion 且 Work 没有 package
- **THEN** 握手仍失败，不能把 protobuf 缺省值当作支持

### Requirement: Keep Skill data independent of the agent image

**Identifier:** RUNTIME-CONTEXT-002

Importing or updating managed Skills, creating Works with Skills, saving or applying Skill selections, and restarting Works SHALL NOT require an agent image build or embed Skill bytes in an image. Runtime creation SHALL use the captured immutable image identity and the complete operation-selected Work-owned context as a read-only mount. Ordinary restart SHALL use active; apply initialization SHALL use its captured candidate and MUST NOT mount a newer pending candidate. A compatible image update is required only when runtime software/contracts change, and MUST NOT silently replace an existing Work's captured image.

上述镜像独立性 SHALL 同样适用于 Pi package 安装/更新/选择/apply。完成一次运行软件及 helper 契约升级后，新增包不要求逐包重建 agent image；包运行依赖在兼容准备环境冻结并作为 context 数据挂载。平台/ABI 不匹配按 PKG-002 明确失败，不以镜像内旧包替代。

#### Scenario: Complete the lifecycle with one image
- **WHEN** one compatible image is built, then a Skill is imported, used by Work A, updated, used by Work B, reselected/applied to A, and both Works restarted
- **THEN** all operations use that same image identity without another build and each runtime reads its selected copied Skill bytes

#### Scenario: A tag changes after capture
- **WHEN** the original image tag is repointed before start, restart, or a Skill-only apply
- **THEN** Core uses the recorded immutable image identity; if unavailable it fails explicitly instead of substituting the tag's new image

#### Scenario: Candidate directory changes during apply
- **WHEN** apply captured B and a later set creates C
- **THEN** the candidate daemon mounts B read-only and its SDK reads B, while C remains pending

#### Scenario: Use four sources with one compatible runtime image
- **WHEN** 一个兼容 image 已构建，随后依次测试 npm/Git/local/ZIP 包安装和 apply
- **THEN** 均使用固定 image identity 和对应 Work-owned 制品，无需再次构建 image
