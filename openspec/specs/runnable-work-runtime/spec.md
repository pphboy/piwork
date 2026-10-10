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
Core SHALL 解析所选模型配置，将凭据以仅 agentd 进程可访问的只读 secret 挂载到 Work。Agentd SHALL 读取该凭据，但不得复制到 Work 元数据、Session 历史、Run 事件、错误信息或经 Core 返回的诊断。

每 Run 的显式模型 SHALL 由当前代次的 Agent 经既有 mTLS 私有通道请求 Go Core 解析；仅该 Agent 获得执行所需凭据。公共模型列表和历史只含安全模型描述；模型失效、端点变化或 SDK 不支持不能静默回退。

#### Scenario: Start agentd with a model credential
- **WHEN** 已配置 Work 使用可用模型 secret 启动
- **THEN** agentd 可以初始化所选模型，Core 与 CLI 响应只显示非秘密 provider 和模型标识

#### Scenario: Model credential is missing or invalid
- **WHEN** agentd 无法读取或使用所选模型凭据
- **THEN** readiness 或受影响 Run 以不含凭据值的安全模型配置错误失败

#### Scenario: 接受后的模型条件发生变化
- **WHEN** 已接受 Run 需要的模型被禁用或其执行描述已不匹配
- **THEN** 该 Run 安全失败，实际模型快照不被替换，凭据不进入公开输出

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

Core SHALL 在路由 Session/Run 或激活候选之前核验 daemon readiness：预期 Work、runtime generation、instance、受支持 context contract、captured context、配置的 Skill 名称及捕获身份、有效工具策略。报告 SHALL 说明真实完成的 SDK 加载，不回显输入描述冒充加载。校验 SHALL 覆盖创建、Start、Restart、Apply、回退和 Core 恢复后的接管。必需握手字段缺失或版本不支持 SHALL 返回 `AGENT_CONTEXT_INCOMPATIBLE`；context 或实际加载成员错误 SHALL 返回 `AGENT_CONTEXT_MISMATCH`。内部身份 MUST NOT 出现在公开配置或诊断。

握手 SHALL 必需报告 packageContractVersion=1 及实际加载包的名称、内部制品身份和资源/工具来源；即使 packages=[] 也不能省略契约。Core SHALL 按 PKGA-005 验证 enabled 包集合完全匹配 captured context，并区别独立 Skills 与 package Skills。旧握手缺字段返回 AGENT_CONTEXT_INCOMPATIBLE；包成员/内容/工具错误返回 AGENT_CONTEXT_MISMATCH。

Go Core SHALL 同时验证当前 Run model contract=1、Work feedback contract=1 和 history schema=4；即使没有选择脑包或 models 列表为空也不能省略当前契约。Apply 初始化只能验证资源，不得开启自动请求执行；正式 active 当前代次才开放准入。

#### Scenario: Verify the expected copied Skills
- **WHEN** 当前 daemon 报告预期 context，且成功加载的 Skill 身份及工具与配置完全匹配
- **THEN** Core 可以完成该 context 的 readiness 并发布安全的运行 Skill 状态

#### Scenario: Reject stale or incomplete readiness
- **WHEN** daemon 声称 ready，但 context、Work、generation、捕获身份不匹配，或 Skill 缺失、额外、重复
- **THEN** Core 不路由或激活该 daemon，并记录稳定的 mismatch 诊断

#### Scenario: Reject an old agent protocol
- **WHEN** agent 镜像省略 context 握手或声明不支持的契约
- **THEN** Operation 返回 `AGENT_CONTEXT_INCOMPATIBLE` 并说明应部署契约匹配的 Core/agentd，Work 不成为 ready

#### Scenario: Re-adopt after Core restart
- **WHEN** Core 重启后发现已有受管标签的容器
- **THEN** Core 先核验实际挂载 context 与完整当前握手才接管加载状态，不仅凭标签或缓存 ready 放行

#### Scenario: Reject a stale package identity
- **WHEN** 名称和 version 相同但 agent 实际加载包 bytes 与 captured context 不同
- **THEN** Core 不发布 ready、路由或 active，记录安全 context mismatch

#### Scenario: Do not infer support from an empty package list
- **WHEN** 旧 agent 没有 packageContractVersion 且 Work 没有 package
- **THEN** 握手仍失败，不能把 protobuf 缺省值当作支持

#### Scenario: 不完整的当前反馈握手
- **WHEN** 候选或被恢复容器缺少任一当前模型、反馈或历史契约
- **THEN** Go Core 拒绝 ready 与路由，返回安全不兼容诊断，不通过兼容入口或字段缺省放行

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

### Requirement: RUNTIME-PI-PKG-001 向包的子代理提供已捕获的 Pi 安装

在运行中的 Work 内，包启动的进程内和后台子代理 **SHALL** 能使用该 Work 已捕获 agent 镜像中的 Pi 安装；后台执行器 **SHALL** 能找到并执行该安装。子代理 **SHALL** 留在该 Work 的容器隔离范围内，且只使用该 Work 配置的模型访问权限和资源。它 **MUST NOT** 获得 Core 宿主路径、Core 操作员凭据、其他 Work 的上下文或不同 SDK 版本的 Pi 安装。停止 Work 时，包启动的子代理 **SHALL** 随容器终止。

#### Scenario: 前台子代理使用匹配的 Pi 安装
- **WHEN** 已启用的包从就绪 Work 启动前台 Pi 子代理
- **THEN** 进程内子代理使用该 Work 镜像中的 Pi SDK 版本，并能完成一次 Run

#### Scenario: 后台子代理始终属于当前 Work
- **WHEN** 已启用的包启动后台 Pi 子代理
- **THEN** 子代理保持在同一 Work 的隔离范围内，并能按包定义的生命周期完成或被取消

#### Scenario: Work 停止时仍有活跃子代理
- **WHEN** Work 停止时包启动的子代理仍在运行
- **THEN** 子代理随 Work 容器终止，不会作为宿主或 Core 进程继续运行

#### Scenario: 子代理无法发现其他上下文
- **WHEN** 包启动的子代理检查自身环境和已挂载资源
- **THEN** 其中没有 Core 操作员凭据、Core 包来源路径或其他 Work 的上下文

### Requirement: Go 平台提供 Work 内 Service 交互身份

**Identifier:** RUNTIME-FEEDBACK-001

Go 平台 SHALL 为实际运行且属于当前 Work 的 Service 提供专属投递身份、CA 和 Agent 私网入口；身份 SHALL 绑定当前 Service 实例，不授予 Core 控制权限或其他 Service 的回执访问。有效绑定 SHALL 依据实际容器、网络和已应用定义确认，不以 desired 或历史容器替代当前事实。Service 重启更换身份，移除后撤销；仅 Agent Apply 时仍运行的 Service 无需重新部署便能与新 Agent 交互。

Stop/Delete/Apply SHALL 在受理时关闭新的自动执行准入；初始化 Agent 不处理请求。身份与连接配置属于派生平台材料，不进入环境分享的权限闭包；目标 Work 显式 Start 时重新建立。

#### Scenario: Service 与 Agent 双向交互
- **WHEN** 本版 Work 和 Pi 开发的 Service 就绪
- **THEN** Service 经专属私网身份持久投递事件并读取自己的原请求，Pi 使用当前绑定查询业务 API

#### Scenario: Service 身份更换与越权
- **WHEN** Service 重启后旧身份继续调用，或当前身份请求其他 Service 的回执
- **THEN** 请求被拒绝且不返回跨来源内容，当前合法身份继续可用

#### Scenario: Agent Apply 后继续交互
- **WHEN** Agent 的候选已正式激活，而 Service 实例保持运行
- **THEN** Service 能连接新 Agent 并读原请求，不要求重新部署 Service，不重放既有业务 mutation

#### Scenario: Stop 与新执行竞争
- **WHEN** Stop 已受理而自动循环准备接受 Run
- **THEN** 新 Run 不被接受，原事件和请求保留，实际清理按 Go 生命周期执行

### Requirement: Agent 镜像预装可由 SDK bash 使用的 sqlite3 命令

**Identifier:** RUNTIME-TOOLS-SQLITE-001

项目交付的 Agent 生产与验收镜像 SHALL 预装真正的 sqlite3 CLI，并在非 root runtime 的 PATH 中可执行。获准的 Pi SDK bash SHALL 能直接对当前 Work 授权的 workspace 数据库执行建表、写入、查询及机器可读输出，不要求用户安装工具、启动时联网、临时 root 或 Docker exec。只有 SQLite 库、Python 模块、Node API 或仅 Service/base 镜像的命令 SHALL NOT 作为此要求的完成依据。

该系统命令 SHALL 沿用现有 Work/工具策略和共享文件身份；bash 被 deny 时不得通过其他入口扩大权限。命令不会获得额外宿主挂载、Docker socket、Core 凭据或其他 Work 内容。普通业务变更仍遵守 Service Action/Query 契约，CLI 不提供绕过平台受管状态机制的授权。

sqlite3 是 Agent 镜像能力，新增命令 SHALL 构建并验证新兼容 Agent 镜像；脑包/Skill 更新不能伪称给旧固定镜像补装了命令。既有 Work SHALL 保留捕获镜像，沿原显式镜像选择及 Apply 流程采用；旧环境缺 CLI 时 SHALL 明确说明。宿主 Core/CLI/Console 不新增 sqlite3、Python 或 Node 运行依赖。

#### Scenario: 真实 SDK bash 调用 sqlite3
- **WHEN** 使用新 Agent 镜像的 Work 允许 bash，AI 执行获准的 workspace 数据检查任务
- **THEN** 真实 SDK bash 执行 sqlite3，在合成数据库建表/写入/查询并取得可核对的机器可读结果，无需额外安装

#### Scenario: 生产和验收镜像均提供命令
- **WHEN** 分别检查 Agent production 与 acceptance 镜像的非 root 运行环境
- **THEN** 两者均可执行 sqlite3 并操作共享身份拥有的合成 workspace 数据库，不只在验收 target 提供

#### Scenario: Service 有工具不能替代 Agent 验收
- **WHEN** Service 使用含 sqlite3 的 Web base，但 Agent 仍捕获不含该命令的旧镜像
- **THEN** 不能宣称 AI bash 已具备该工具，报告实际缺项并保留原镜像，采用升级需要原显式流程

#### Scenario: 工具策略保持生效
- **WHEN** 当前 Work 的策略禁止 bash
- **THEN** sqlite3 二进制存在不绕过该限制，模型不取得额外 SQL 执行入口、Docker 能力或宿主依赖
