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

Core SHALL 解析所选独立模型配置，将必要凭据以仅 agentd 可访问的只读 secret/private 通道传入 Work。凭据不进入 Work 元数据、Session 历史、Run 事件、错误或公开诊断。

每 Run 的显式模型 SHALL 由当前代次 Agent 经既有 mTLS 通道解析，只有该 Agent 获得当前请求所需 Key。公共列表/历史仅含安全模型描述，失效或不兼容不静默换模型。协议、精确执行定义及固定绑定只经当前 Work/代次/instance 的私有授权通道传递。

已配置的自定义 ID SHALL 在兼容 harness 中按原 Responses/Messages 协议自动注册普通消息执行，不要求用户创建 Provider 或能力模板；同一 ID 不同连接不得混用接口/Key。SDK 已知模型继续保留能力和 Thinking 映射，未知模型普通模式不发送未经确认的额外 Thinking 参数，不伪报已确认 Off。能力查询、偏好校验、初始化和执行使用一致定义，不削弱工具、历史、身份或 context 边界。

模型 Key 轮换后新获准 Run SHALL 使用当前 Key，不通过旧挂载绕过启停；已接受执行保持原协议/定义/凭据绑定，执行前准入失效安全失败，已发请求不隐式取消或重发。创建/初始化/重启/子代理材料同样依据明确模型绑定，只包含所需默认 Key，不挂载全部模型目录或秘密。

旧镜像不支持新普通注册/Thinking 契约时 SHALL 明确不兼容及升级方向，不自动更换固定镜像。新版必须能执行无 SDK 条目的合成 Model ID，不能仅通过列表投影宣称支持。

#### Scenario: Start agentd with a model credential
- **WHEN** 配置有效模型的 Work 启动
- **THEN** agentd 可初始化所选模型，公开响应不含 Key 或 secret 路径

#### Scenario: Model credential is missing or invalid
- **WHEN** 无法读取或使用必要凭据
- **THEN** readiness 或该 Run 安全失败，不泄露值、不换另一模型

#### Scenario: 接受后的模型条件发生变化
- **WHEN** 已接受尚未外发的模型被停用或其固定定义不匹配
- **THEN** 执行安全失败，已保存实际模型不被替换，旧材料不能绕过准入

#### Scenario: 同一 Work 分别使用两种协议
- **WHEN** Session 依次选择完整 Responses 和 Messages 模型
- **THEN** 请求各自使用正确路径、认证、模型定义及有效 Thinking，历史保留，只获取当前所需 Key

#### Scenario: 新 Key 与禁止旧 Key 回退
- **WHEN** 模型轮换或停用后接受新请求
- **THEN** 获准请求使用当前 Key，停用请求拒绝，不使用旧挂载继续执行

#### Scenario: 模型能力和实际请求一致
- **WHEN** 已知模型 Thinking 被受理，或未知模型普通模式被受理
- **THEN** 前者按确认映射执行，后者按原协议/ID/端点执行且记录未请求额外 Thinking，不能依赖别的模型默认值伪造事实

#### Scenario: 未知模型自动注册
- **WHEN** 用户仅提供协议、地址、Model ID 和 Key，兼容 Agent 初始化并执行
- **THEN** 普通消息可通过真实 SDK 完成，无 Provider/模板步骤；未知 Thinking 不阻断基础运行

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

### Requirement: 复用不可变镜像的成功准备结果

**Identifier:** RUNTIME-PREP-REUSE-001

同一安装及已确认的 Docker Engine 身份范围内，系统 SHALL 持久复用同一不可变镜像身份、平台、能力类别和对应校验规则版本下已经成功完成的镜像能力检查及所需包运行环境探测。有效结果 SHALL 跨 Core 进程、Docker daemon 正常重启及 VM/宿主重启保留；Core 发行版本变化本身不构成失效。当前 Engine 身份不可确认时 MUST NOT 跨进程复用；同一 socket 地址不能证明 Engine 身份相同。同键同时请求 SHALL 共享一次完整准备；已经准备好的镜像 SHALL 不因无关镜像的完整检查而排队。复用前 SHALL 核对当前镜像存在及身份；tag 重新解析到另一镜像、镜像缺失、Docker 不可达或能力类别不符时 MUST NOT 用历史成功替代当前事实。

准备结果 SHALL 有条目数与单条大小边界，只原子持久发布完整成功且临时资源已确认收尾的结果。静态能力与环境探测分别版本化，检查规则变化 SHALL 使受影响结果失效。持久记录仅属于本安装的派生状态，不进入可移植 Work 数据或公开配置；记录缺失、格式无效、内容不完整或与当前作用域不匹配时 SHALL 重新准备，不能据此清空业务数据。失败、超时、取消和清理未确认 SHALL 不成为成功结果；被回收的结果允许重新准备。结果只描述镜像自身能力及 Node ABI / Pi SDK 环境，不包含 Work 内容、模型秘密或运行中 Work 的就绪状态；每个 Work 仍 SHALL 完成自身 context 与实际 Agent readiness 验证。

#### Scenario: 创建和启动共享已验证镜像
- **WHEN** 默认镜像已经成功准备，用户创建使用该镜像的 Work 并随后停止、再次 Start
- **THEN** 创建和启动复用镜像能力结果，不重新完整导出扫描该镜像，所选包仍经过目标环境兼容性核对，Agent 每次均完成自身真实 readiness 验证

#### Scenario: 多个调用者使用同一新镜像
- **WHEN** 多个尚未取消的调用者同时需要同一新镜像的同类准备
- **THEN** 只执行一次完整镜像能力检查和一次所需环境探测，成功后所有调用者取得各自安全可用的结果

#### Scenario: 已准备镜像不等待无关扫描
- **WHEN** 镜像 A 已准备而镜像 B 的完整检查仍在进行，用户创建使用 A 的 Work
- **THEN** A 的轻量复核与结果复用不等待 B 的完整检查完成

#### Scenario: tag 改变或镜像被删除
- **WHEN** 原 tag 指向新的不可变镜像，或既有 Work 捕获的镜像已从当前 Engine 删除
- **THEN** 新镜像需要独立准备，缺失的已捕获镜像按既有错误规则失败，不使用其他镜像或旧准备记录替代

#### Scenario: 环境探测结束但清理失败
- **WHEN** 临时环境探测输出有效结果，但其辅助容器或归属收尾未确认
- **THEN** 本次准备失败且不发布成功结果，后续尝试仍执行必要的探测和清理

#### Scenario: Core 和整机重启复用验收
- **WHEN** 已成功验收的镜像及规则未变化，本安装在相同已确认 Engine 上重启 Core、Docker、VM 或宿主
- **THEN** 轻量复核当前镜像后复用持久结果，不再次完整导出或扫描镜像；已有效的所需环境结果不再次运行探测容器，每个 Work 仍验证真实当前 Agent

#### Scenario: 多版本镜像均已验收
- **WHEN** 发行 package helper、全局默认和已有 Work 分别使用三个已有效验收的固定 Agent 镜像版本
- **THEN** 重启分别复用三份记录，完整导出和扫描次数均为零，不修改默认选择或已有 Work 镜像来减少版本数量

#### Scenario: Engine 或校验规则变化
- **WHEN** 相同 socket 接到另一 Engine，或当前检查类别的规则版本更新
- **THEN** 旧作用域结果不能作为本次成功，按新作用域完整准备；其他仍有效类别的结果不因无关规则变化而强制失效

#### Scenario: Engine 不可达或身份不可确认
- **WHEN** 当前 Engine 不可达，或不能核验可跨重启识别的 Engine 身份
- **THEN** 前者不以历史结果报告依赖可用；后者不使用跨进程成功证明，可在当前连接上执行完整准备，公开状态只给出安全原因

#### Scenario: 完成发布前崩溃或存储失败
- **WHEN** 全量检查或环境探测完成，但清理确认或成功记录原子提交之前 Core 中断或提交失败
- **THEN** 不发布可复用成功，按原归属恢复清理并重新准备；原子提交已完成后的崩溃允许复用完整记录

#### Scenario: 失效与在途结果竞争
- **WHEN** 旧准备尚未完成时镜像被确认缺失、Engine 作用域变化或结果被失效
- **THEN** 迟到结果不能重新发布到已失效作用域，也不能使当前 Work 或默认环境 ready

#### Scenario: 记录损坏和有界回收
- **WHEN** 派生记录损坏、版本未知或因容量边界被回收
- **THEN** 对应调用重新完整准备，其他有效结果和业务数据保持；重启不得以伪造命中掩盖实际重新准备

#### Scenario: 成功发布与 Work 激活并发
- **WHEN** 静态镜像检查或包环境探测已完成收尾，正在发布成功记录，而另一 Work 的 Start/Apply 正在事务内发布当前路由
- **THEN** 两条路径按 Store 写事务再到 Engine 身份栅栏的顺序推进，不因反向等待 Engine 锁和数据库写锁而靠发布超时解除；成功记录提交仍受当前 Engine 代次保护，失效后的结果不能发布

#### Scenario: 持久命中的访问记录合并
- **WHEN** 已核验的静态镜像或包环境结果命中持久记录，而数据库写入正由其他操作占用
- **THEN** 命中不会为了记录访问时间等待数据库写锁；访问提示在内存中有界按键合并，在后续写事务的淘汰之前或正常关闭时批量持久化，失败回滚不能制造成功记录，关闭仍遵守原预算

### Requirement: 共享准备具有独立取消及有界关闭行为

**Identifier:** RUNTIME-PREP-CANCEL-001

单个调用者取消 SHALL 及时结束自身等待，且 MUST NOT 取消其他有效调用者仍需要的同键准备。全部调用者取消时，共享准备 SHALL 被取消并按现有资源归属与清理规则收尾；后续调用者不得加入正在退出的准备。Core 关闭 SHALL 停止新准备、取消全部共享任务并在既有关闭预算内等待收尾，临时资源和存储仍在使用时不得报告干净关闭。配置换代 SHALL 撤销旧准备对旧 readiness 的贡献，但其他合法调用者仍可使用自身捕获镜像的同键结果。

#### Scenario: 首个创建请求取消而另一个仍等待
- **WHEN** 两个请求共享同键准备，首个请求断开而另一个仍有效
- **THEN** 首个请求结束等待，准备继续为有效请求服务，未被接受的请求不凭空生成 Work / Operation

#### Scenario: 全部等待者取消后再次请求
- **WHEN** 所有等待者取消导致旧准备退出，此后又有新请求需要同一镜像
- **THEN** 旧尝试完成受管收尾，新请求使用可重试的新尝试或既有完整成功结果，不接收取消中或未清理的结果

#### Scenario: 共享准备期间关闭 Core
- **WHEN** Core 在镜像导出或临时环境探测期间正常关闭
- **THEN** 共享任务在既有关闭预算内取消并确认收尾，或明确报告未确认关闭，不在资源关闭后继续读写安装目录

### Requirement: 在启动预算内及时确认实际 Agent 就绪

**Identifier:** RUNTIME-READY-LATENCY-001

Core SHALL 在启动确认期间持续以有界频率检查当前实际 Agent 连接及容器状态，避免先前连接失败留下秒级递增退避而延迟已经能够完成的 readiness 核验。在参考测试条件下，自当前 Agent 能接受有效 readiness 请求起至 Core 取得并验证成功响应 SHALL 不超过 500 毫秒。启动确认 SHALL 保留现有默认 30 秒总预算、提前退出检测、mTLS、Work / generation / instance / context、资源及全部必需协议验证；历史 ready 或镜像准备成功 MUST NOT 替代该核验。

#### Scenario: Agent 延迟开放监听
- **WHEN** 首次连接失败后，当前 Agent 才开放监听并能返回合法 readiness
- **THEN** Core 在参考测试条件下于 500 毫秒内取得并验证该响应，不额外等待既有秒级递增连接退避

#### Scenario: Agent 无法就绪或身份不匹配
- **WHEN** Agent 持续不响应、提前退出或返回不匹配身份 / 契约
- **THEN** Core 沿既有有界失败与诊断规则处理，不因为缩短连接等待而提前发布 ready 或放宽身份验证

### Requirement: 启动凭证与运行代次一致

**Identifier:** RUNTIME-CREDENTIAL-001

同一 Work 运行代次 SHALL 保持已经发布的模型凭证材料不可变。首次启动 SHALL 仅向该 Work 的 Agent 提供本次启动选定模型所需的凭证；重新启动 SHALL 检查已发布材料与本次固定启动凭证是否一致。相同凭证 SHALL 允许复用原代次，差异 SHALL 交由生命周期协调切代，不在原代次覆盖材料、不忽略差异、不用旧 Key 回退执行新请求。比较 SHALL 采用与发布一致的凭证格式规范，不因仅有末尾换行差异触发切代。

接管仍在运行的合法 Agent SHALL 使用其已有实例及挂载，完成实际身份、固定镜像、context 和完整 readiness 校验后才开放路由，不通过重新发布当前 Key 或其他启动材料完成接管。仅匹配容器标签或历史 ready 不构成接管成功；身份、材料或 readiness 不可核验时 SHALL 安全失败。

每次创建或切代启动 SHALL 在创建目标容器前持久固定所选模型的启动凭证绑定，并在同一次启动的重试/崩溃恢复中保持。凭证仍只存在于既有 secret 存储及受保护的运行材料中；绑定引用不进入公共 Work 配置、Session 历史、Run 事件、公开错误或诊断。绑定 SHALL 不替代每 Run 的当前准入及执行绑定。

已有安全材料与当前凭证不同 SHALL 能与可检测的材料损坏、不安全路径、权限、身份及 I/O 错误区分。空凭证、超限、NUL 或材料与其已持久启动绑定不符 SHALL 作为损坏处理。只有安全核验后的凭证差异允许触发切代；其他错误 SHALL 保留安全失败和原材料，不通过不断创建新代次掩盖。首次尚未发布材料与已发布材料丢失 SHALL 按实际发布事实区分，不能将后者当作正常轮换。

#### Scenario: 同代次重复发布相同凭证
- **WHEN** 同一运行代次再次启动，固定启动凭证与已有安全材料相同
- **THEN** 复用同一凭证材料和代次，不产生额外实例或因重复发布失败

#### Scenario: 差异凭证不能覆盖旧代次
- **WHEN** 停止的原代次保存 Key A，本次启动固定 Key B
- **THEN** 原材料保持 Key A，生命周期确认旧实例收尾后创建绑定 Key B 的新代次，再验证 readiness 并开放路由

#### Scenario: 凭证末尾换行一致化
- **WHEN** 两次输入只在末尾 CR/LF 上不同，按发布规则规范化后的有效凭证相同
- **THEN** 不判定为凭证变化，不为该差异创建新代次

#### Scenario: 运行实例接管不改写材料
- **WHEN** 当前模型已轮换 Key，Core 发现原代次 Agent 仍在运行且实际身份与完整 readiness 匹配
- **THEN** 接管保留原容器、代次和挂载材料，新 Run 通过当前授权私有通道解析凭证

#### Scenario: 正常首次启动
- **WHEN** 新运行代次尚未发布凭证且没有已有运行实例，所选模型凭证有效
- **THEN** 正常发布固定凭证并启动，不把材料尚未创建误报为损坏或轮换

#### Scenario: 既有材料损坏
- **WHEN** 原代次已发布材料被替换为符号链接、权限不安全、无法读取或内容损坏
- **THEN** 安全失败并保留可查询诊断，不覆盖原材料、不假定为 Key 轮换、不自动切代绕过核验

#### Scenario: 发布后进程退出
- **WHEN** 启动绑定和凭证材料已持久发布，但 Core 在容器启动或 readiness 完成前退出
- **THEN** 续行使用同一启动绑定及目标实例，核验实际资源后继续，不因当前模型再轮换而改写该代次
