# Core Service Startup Specification

## Purpose

Defines how a local piwork installation is initialized and run as a durable Core service that can authenticate users, control Docker-backed Works, recover existing instances, and report operational state.

## Requirements

### Requirement: Bootstrap the first administrator explicitly

Core SHALL 保留显式的离线首管理员 bootstrap 命令，并额外提供受保护的在线控制面 bootstrap。`serve` 本身 MUST NOT 创建默认账号或默认密码；空安装可由显式 env 文件初始化或由 `piwork-serve admin bootstrap` 完成。管理员存在后，所有 bootstrap 入口 MUST 拒绝覆盖现有身份。

#### Scenario: Bootstrap an empty installation

- **WHEN** 操作者使用 `piwork-serve admin bootstrap --data-dir <path>` 提供账号和密码
- **THEN** Core 创建首个管理员且不输出密码或摘要

#### Scenario: Bootstrap an empty installation online

- **WHEN** Core 已由 `piwork-serve serve` 监听且操作者通过 operator credential 调用 `piwork-serve admin bootstrap`
- **THEN** Core 创建首个管理员并更新 readiness，不需要停止或重启 Core

#### Scenario: Refuse repeated bootstrap

- **WHEN** 管理员已经存在时调用任一 bootstrap 入口
- **THEN** 请求失败且现有身份数据不变

#### Scenario: Refuse repeated bootstrap (offline command)

- **WHEN** an operator invokes bootstrap after an administrator already exists
- **THEN** Core exits nonzero with a concise diagnostic and leaves the existing identity data unchanged
### Requirement: Configure a usable local runtime profile

Core SHALL 保留离线 runtime 配置命令，并提供受保护的在线全局默认配置 API。全局配置 SHALL 仅作为之后新建 Work 的默认值；已有 Work 的独立配置、模型引用和运行实例 MUST NOT 因全局配置变化而修改、重启或切换模型。

#### Scenario: Configure the global default online

- **WHEN** 管理员通过 `piwork-serve config set` 提供兼容镜像、模型、endpoint 和 secret
- **THEN** Core 持久化全局默认配置，查询只返回非敏感字段和 secret 可用性

#### Scenario: Configure an installation from standard input

- **WHEN** an operator selects an agent image and model and supplies the model credential through standard input
- **THEN** Core stores a usable default runtime profile without placing the credential in command arguments, normal output, logs, or public API responses

#### Scenario: Change defaults without changing existing Works

- **WHEN** 全局默认模型配置从 model-a 改为 model-b
- **THEN** 新 Work 使用 model-b，已有 Work 保留原独立配置且不发生隐式重启

#### Scenario: Detect an incomplete runtime profile

- **WHEN** Core starts without a usable agent image or model profile
- **THEN** health remains available, readiness reports the missing runtime configuration, and Work creation returns an actionable configuration error
### Requirement: Start one durable Core application

`serve` SHALL 在管理员和运行时配置缺失时仍打开健康 HTTP listener，初始化完成后再报告相应 readiness；配置存在时继续执行 Docker 验证和 Work recovery。它 MUST NOT 因缺少管理员或默认 runtime 而退出，也 MUST NOT 在启动过程中创建默认 Work。

#### Scenario: Start before initialization

- **WHEN** 操作者在空或部分配置的数据目录启动 `serve`
- **THEN** Core 监听健康接口，报告具体初始化状态，并允许控制面补齐缺失配置

#### Scenario: Start a configured Core

- **WHEN** 管理员、默认 runtime 和 Docker 都可用
- **THEN** Core 完成 recovery 后进入 READY，并保留已有 Work 的独立配置

#### Scenario: Start a configured local Core

- **WHEN** an administrator and runtime profile exist and the Docker dependency is available
- **THEN** `serve` starts one HTTP listener, emits its effective loopback URL without secrets, and reports ready after recovery completes

#### Scenario: Reject a second Core owner

- **WHEN** another Core process already owns the same data directory
- **THEN** a second `serve` exits nonzero without opening another listener or modifying the store

#### Scenario: Refuse accidental remote plaintext binding

- **WHEN** an operator requests a non-loopback listen address without the insecure-remote opt-in
- **THEN** Core rejects startup with a diagnostic identifying the required opt-in
### Requirement: Expose distinct health and readiness probes

Core SHALL 在能够响应时提供无认证 `GET /healthz`，并在存储初始化及启动恢复完成后通过无认证 `GET /readyz` 报告基础 Work 就绪；关闭时 readiness MUST 失效，runtime/Docker 阻断 Work 操作时 MUST 给出安全原因。未提供 profile 时 SHALL 保持既有 JSON 和基础 readiness 语义，包括 file/snapshot helper 缺失的原有功能降级。

`GET /readyz?profile=docker-delivery` SHALL 复用此入口，仅在基础 ready 且 CORE-DOCKER-STATUS-001 的全部交付组件 ready 时返回 200；其他情况返回 503。此 profile SHALL 保留原 status/reason/state/ready/checks 字段，并附加 preparation；ready/status 是完整交付的布尔值/名称，state/checks 仍反映基础状态，基础 ready 但准备未完成时 reason 为 `DEPENDENCIES_PREPARING` 或 `DEPENDENCY_FAILED`。未知/重复 profile SHALL 返回 400 `INVALID_REQUEST` 和安全 field=`profile`，不原样回显输入。探针不执行模型真实调用，也不保证某用户网络、凭证或具体 Work 已 ready。

#### Scenario: Report a ready installation
- **WHEN** Core 已初始化，Docker 可达且启动恢复已完成
- **THEN** 默认 health/readiness 成功，默认 readiness 报告 Work runtime 可用

#### Scenario: Report a runtime dependency failure
- **WHEN** Core 存活但 Docker 不可达
- **THEN** health 成功，默认 readiness 失败并返回安全依赖状态，不返回内部堆栈或凭据

#### Scenario: Docker 交付全组件准备完成
- **WHEN** 基础 ready 且所有交付组件准备成功
- **THEN** docker-delivery profile 返回 200 和 ready=true，Compose 可以据此完成等待

#### Scenario: helper 降级保持旧探针兼容
- **WHEN** 基础 ready 而 snapshot helper 失败或未配置
- **THEN** 默认探针保持基础可用语义，交付 profile 返回 503 并指出安全组件状态

#### Scenario: 停机与非法 profile
- **WHEN** Core 正在关闭，或请求携带未知/重复 profile
- **THEN** 分别返回非 ready 的 503 或安全的 400，不暴露秘密、不等待镜像准备

### Requirement: Authenticate HTTP clients with durable sessions
Core SHALL expose public login and protected logout and current-identity endpoints. A successful login MUST return an opaque bearer token, expiration, and public identity; Core MUST store only a non-reversible token digest. Missing, invalid, expired, or revoked tokens MUST receive stable authentication errors without revealing whether an account exists.

#### Scenario: Log in and inspect identity
- **WHEN** an enabled user submits valid credentials and uses the returned token on the current-identity endpoint
- **THEN** Core returns that user's public identity and session expiration without returning any password material

#### Scenario: Revoke a login session
- **WHEN** a client logs out with a valid bearer token
- **THEN** Core revokes the session and rejects subsequent protected requests made with that token
### Requirement: Expose durable Work lifecycle control
Core SHALL expose authenticated Work create/list/detail, start, stop, retry, delete, and Operation detail endpoints. Accepted mutations MUST return stable Work and Operation identifiers, execute asynchronously through the configured Docker runtime, enforce Work ownership, and expose preparation, readiness, and failure state without reporting a Work ready before its verified agentd generation accepts Runs.

#### Scenario: Create a default configured Work
- **WHEN** an authenticated user creates a Work using the installation's valid default runtime profile
- **THEN** Core persists the Work and Operation, starts one Docker agentd instance, and eventually reports the Work ready or a concrete failure

#### Scenario: Retry a lost mutation response
- **WHEN** a client repeats the same Work mutation with the same idempotency key and content
- **THEN** Core returns the original Work and Operation identifiers without creating another Work or agentd instance

#### Scenario: Hide another user's Work
- **WHEN** a non-administrator queries or controls a Work owned by another user
- **THEN** Core returns the same not-found response used for a nonexistent Work
### Requirement: Expose authorized Session and Run operations
For a ready Work, Core SHALL expose authenticated Session create/list/detail and Run submit/detail/observe/cancel endpoints. Core MUST authorize the user before contacting agentd, route only to the current verified Work generation, preserve Run identity independently of the observing connection, and distinguish transport interruption from a Run terminal state.

#### Scenario: Submit and observe a Run
- **WHEN** a Work owner creates a Session, submits a prompt with an idempotency key, and observes the accepted Run
- **THEN** Core streams ordered events and exposes the final Run status and assistant result produced by agentd

#### Scenario: Reject conversation on a stopped Work
- **WHEN** a user attempts to create a Session or submit a Run for a stopped or unverified Work
- **THEN** Core returns a stable Work-unavailable error without starting a hidden replacement instance

#### Scenario: Lose an observation connection
- **WHEN** the client connection closes while an accepted Run is executing
- **THEN** Core leaves the Run executing and allows a later authorized request to observe or query the same Run
### Requirement: Recover Core and Work state across restart

Core 重启时 SHALL 恢复用户、会话、Work 和每个 Work 的 desired/active 配置版本。恢复 MUST 使用 Work 保存的配置，不得用新的全局默认配置替换已有 Work。正常关闭已经停止的 Work 运行容器 SHALL 按持久运行意图恢复；原本期望 stopped 的 Work SHALL 保持停止。用户、Work、Operation、Session、Run 标识和持久历史 SHALL 保留，恢复不得重新提交历史 Run 或创建重复 Work。

Go 安装 SHALL 使用自身支持的持久格式恢复，不接管旧 TS 安装。异常退出后的恢复 SHALL 先核验残留资源及当前代次；Agent、Service 或文件 helper 尚未完成核验时，内容路由与写入准入保持关闭，不创建第二个有效主 daemon。

#### Scenario: Continue after restart with changed defaults
- **WHEN** Work A 使用 model-a，Core 正常关闭后全局默认改为 model-b，再次启动并恢复 Work A
- **THEN** Work A 使用原保存的 model-a，原 Session 和历史可继续查询，不创建重复 Work

#### Scenario: Continue after Core restart
- **WHEN** Core 正常退出前确认停止全部受管 Work，随后使用原数据目录和匹配 Work 卷重新启动
- **THEN** 原有效登录凭证和对象标识保持，期望 running 的 Work 及启用的 Service 恢复，期望 stopped 的 Work 不启动，不要求任何 Work 在 Core 退出期间持续运行

#### Scenario: Recover an incomplete create operation
- **WHEN** Core 在 Docker 已创建 Agent 容器、但 create Operation 尚未终结时异常退出，随后重启
- **THEN** 恢复核对并接管或安全收尾已创建资源，继续或明确失败原 Operation，不创建重复 Work 实例

#### Scenario: Recover before reopening access
- **WHEN** 新进程正在核对 Agent 代次、Service 容器或残留文件 helper
- **THEN** 未完成核验的路由与写入入口保持关闭，安全查询可显示恢复中或具体故障

### Requirement: Shut down Core without destroying running Works

Core 收到 SIGINT、SIGTERM，或因 Docker Compose stop/down/重建进入正常关闭时 SHALL 关闭 HTTP/runtime mutation 与文件准入、停止接受新任务、撤销 readiness、停止生命周期调度，并在既有有界关闭流程内排空执行、收尾文件/快照/package 任务及停止本安装全部受管 Work 的 Agent、附属 Service 与平台 helper。正常关闭成功前 MUST 确认所有受管 Work 运行容器已经停止；不得要求或承诺这些 Work 在 Core 退出后继续运行。某 Work 的 drain 或停止失败 SHALL 不阻止尝试关闭其他受管 Work。

关闭 SHALL 保留 Work 记录、desiredState、Service 启用意图、配置、历史及匹配数据卷，不把 Core 退出隐式转换为用户的 Work stop/delete。默认 drain 30 秒、终止确认 10 秒和 Core 进程总预算 45 秒保持，Docker Compose 提供 60 秒关闭窗口。未确认关闭或超出预算 SHALL 非零退出并提供安全的未完成诊断及恢复记录，不报告正常关闭成功；关闭 SHALL 释放 listener 和 store 锁。SIGKILL、进程崩溃或断电不执行完整正常关闭流程，不得据此记录所有 Work 已停，重启沿用持久意图和资源归属恢复；本变更不新增进程外监护机制。CLI 退出 SHALL 不停止 Work。

#### Scenario: Stop Core and reopen its store
- **WHEN** 具有运行中 Work 和附属 Service 的 Core 收到 SIGTERM 并正常关闭成功
- **THEN** 全部受管 Agent/Service 运行容器已确认停止，数据及运行意图保留，进程在预算内退出，新 Core 能打开同一 store 并按意图恢复

#### Scenario: Bound a stalled shutdown
- **WHEN** 接受中的请求、任务或受管容器无法在关闭期限内完成或确认停止
- **THEN** Core 仍尝试关闭其他 Work，并以非零退出和安全未完成诊断结束，不无限等待、不谎报所有 Work 已停

#### Scenario: Stop Core through Docker Compose
- **WHEN** 用户执行发行手册的 Core stop/down 或 force-recreate
- **THEN** Core 经正常关闭流程停止全部受管 Work，保留目录和卷；重建启动后仅恢复期望 running 的 Work 及启用的 Service

#### Scenario: Abrupt Core loss is not confirmed shutdown
- **WHEN** Core 被 SIGKILL、崩溃或失去电源
- **THEN** 不宣称已确认关闭全部 Work，后续 Core 核对原资源并恢复持久意图，不重提历史 Run 或操作未知归属资源

#### Scenario: Preserve service selection through shutdown
- **WHEN** 一个 Work 含 enabled 服务和 disabled 服务，Core 优雅退出后再次启动
- **THEN** 只恢复 desired-running Work 中的 enabled 服务，退出过程不改写这些选择或删除数据


### Requirement: 使用显式容器环境完成首次初始化

**Identifier:** CORE-DOCKER-INIT-001

Core SHALL 接受部署者显式提供的进程环境变量，复用 PIWORK_ADMIN_ACCOUNT/PIWORK_ADMIN_PASSWORD、PIWORK_MODEL_PROVIDER、PIWORK_MODEL、PIWORK_API_KEY 及可选 PIWORK_MODEL_BASE_URL 初始化缺失的管理员和默认 runtime；既有模型名称与 key 的兼容别名保持。PIWORK_AGENT_IMAGE 及 package/file/snapshot helper 引用 SHALL 可显式提供，或从 Core 发行镜像携带的非敏感配置取得，用户无需为了默认试用另行提供依赖引用。

发行默认配置 SHALL 只包含可核查的非敏感发行信息和依赖引用，不包含账号、密码、模型 key、用户 token 或持久用户配置。显式有效的部署输入优先于发行默认值；显式非法输入 SHALL 安全拒绝，不静默回退。发行默认依赖存在但用户未提供初始化字段时 SHALL 保持原有健康可访问、具体状态非就绪的行为，不把非敏感依赖默认值误判为用户提交了不完整模型初始化。用户实际提供的部分或格式非法输入 SHALL 继续按既有校验拒绝，不放宽成自动账号或默认凭据。

已有管理员、模型与默认配置 SHALL 不被重启时的合法环境值或新发行默认值覆盖；格式非法的已提供输入 SHALL 在使用之前安全拒绝，即使已有持久值也不忽略。首次初始化不得创建默认 Work；未配置发行默认值的原生或高级部署保留现有显式初始化方式。

默认上下文 SHALL 保持一次性 seed 语义，管理员已经禁用、移除或选择的默认值不被启动重置。模型 Base URL 的既有限制 SHALL 保持：HTTPS 可用；HTTP 仅允许 loopback，Agent 中 loopback 指向 Agent 自身。未设置可选 Base URL SHALL 保持未设置，显式空值继续非法。

#### Scenario: 空数据首次启动
- **WHEN** 空目录收到完整合法的管理员与模型环境值，Core 镜像携带匹配发行依赖
- **THEN** 不需要环境文件或额外镜像配置即可保存首管理员及默认 runtime、自动准备依赖，完整就绪后允许创建 Work；不输出秘密或预建 Work

#### Scenario: 重建容器时 env 与持久值不同
- **WHEN** 已有安装以不同合法管理员密码、模型环境或新的发行默认依赖重建
- **THEN** 既有持久管理员、默认 runtime 和 Work 配置保持，修改仍使用既有管理入口

#### Scenario: 试图使用宿主 HTTP 模型地址
- **WHEN** 提供 http://host.docker.internal:8000 作为模型 Base URL
- **THEN** 按既有非法输入契约拒绝，不将 CLI 宿主别名或容器模式作为放开模型限制的依据

#### Scenario: 非敏感默认值不构成用户初始化
- **WHEN** Core 携带发行依赖配置但用户没有提交管理员或模型初始化值
- **THEN** Core 仍打开健康 listener 并报告缺项，不因依赖默认值而触发部分模型字段错误，不生成默认账号或密码

#### Scenario: 显式部署覆盖发行默认值
- **WHEN** 首次部署显式传入合法 Agent 或 helper 引用，或传入非法值
- **THEN** 合法输入优先于发行默认值，非法输入安全拒绝且不回退；原生部署仍可使用现有完整显式输入

#### Scenario: 已有安装收到非法输入
- **WHEN** 已有持久配置的 Core 收到格式非法的初始化字段
- **THEN** 在使用之前安全拒绝，不因已有配置或发行默认值而忽略非法输入，不修改原数据

#### Scenario: 可选模型地址的省略与空值
- **WHEN** 用户未设置 PIWORK_MODEL_BASE_URL 或显式设置为空
- **THEN** 分别保持未指定状态或按既有非法输入契约拒绝，不把 CLI 的宿主别名或容器模式当成放开限制的依据

### Requirement: 自动准备运行依赖并允许失败后恢复

**Identifier:** CORE-DOCKER-PREP-001

Core SHALL 自行检查 Engine、拉取缺失的配置镜像、校验平台及各原生协议、准备 package helper/默认上下文并完成启动恢复。镜像拉取和依赖准备 SHALL 在后台执行，不占用健康/状态请求直至长时间拉取结束；`/healthz`、`/readyz`、`/control/status` 不因拉取锁排队，状态为当前快照。配置持久化后 SHALL 调度相应准备并使 readiness 反映实际状态；既有管理响应与状态 DTO 保持。

operator `config set` 在有效配置确认持久化后 SHALL 返回原 RuntimeView 并成功退出；尚待后台准备时不得把成功保存报告为保存失败，运行可用性由后续 status/readiness 核实。输入无效、secret 不可用或持久化未确认仍使用原安全错误契约；既有管理员 API 的已保存 runtime 加实际 readiness 返回体保持。

单次镜像/上下文准备 SHALL 有十分钟上限且可在关闭或配置换代时取消；可重试的 Engine/网络/拉取失败 SHALL 以 1、5、15、30、60 秒并以 60 秒封顶的退避再次准备，同一组件不得重复并发准备。非法引用/平台/协议错误 SHALL 标为失败，等待纠正配置后再准备。缺少 file/snapshot helper 配置 SHALL 报告 `unconfigured`，package helper 省略时沿用 Agent 镜像的既有回退；失败的首次 file/snapshot helper 拉取不能永久缓存为已经准备完成。成功后 SHALL 捕获不可变镜像身份，既有 Work 不因 tag 变化或新默认值自动替换运行身份。

Agent/默认上下文或启动恢复未完成时不得报告 Work 就绪；file/snapshot helper 不可用 SHALL 单独报告该功能不可用，不能阻断本来可用的 Work/Service。关闭 SHALL 停止新尝试并取消后台任务，遵守既有有界关闭规则，不删除 Work 数据。旧配置代次的完成结果 SHALL 不覆盖新配置状态。

#### Scenario: 首次慢速拉取
- **WHEN** 必需镜像未缓存，拉取持续超过现有一分钟刷新窗口
- **THEN** Core 继续后台准备，健康/状态仍可读取且不假报 ready，不要求用户手动 pull；十分钟单次期限后按失败规则处理

#### Scenario: helper 首次失败随后网络恢复
- **WHEN** file 或 snapshot helper 的首轮准备因可恢复网络故障失败，随后网络可达
- **THEN** 同一 Core 进程自动再次准备，成功后相应功能可用，期间其他已可用功能保持

#### Scenario: 镜像协议错误
- **WHEN** 下载的镜像与约定协议或平台不兼容
- **THEN** 对应组件为 failed，完整就绪失败，公开状态给出安全错误码，不启动不兼容运行容器

#### Scenario: 更新配置时旧准备还在执行
- **WHEN** 已持久化新 runtime 版本而旧版本的准备完成
- **THEN** 旧结果不能使新配置 ready；已有 Work 捕获身份与独立配置保持

#### Scenario: operator 保存后依赖尚未准备
- **WHEN** operator 提交有效配置，持久化成功但新镜像尚未取得
- **THEN** config set 成功返回保存的非敏感 runtime，status/profile 仍报告真实非 ready，后续准备失败不能伪装成未保存

### Requirement: 暴露安全的交付准备状态

**Identifier:** CORE-DOCKER-STATUS-001

`GET /control/status` SHALL 保留原 `state/ready/checks`，增加 `preparation={version:1,ready,components}`；components 固定为 `docker`、`agent`、`packageHelper`、`defaultContext`、`fileHelper`、`snapshotHelper`。每项 SHALL 包含 `state`、非负 `attempt`、`retryAfterSeconds` 与 `code`；state 为 `unconfigured|pending|preparing|ready|retrying|failed`，不适用的 delay/code 为 null，重试 delay 为非负秒数。此 `preparation.ready` 表示全部交付组件已准备，不等于基础 Work readiness；完整交付判定还要求基础 ready。Docker 持续不可用 SHALL 最多五秒使基础/交付就绪失效。

`piwork-serve status` SHALL 通过既有入口读取该快照，成功查询的退出语义保持；组件状态不得带镜像地址/ID、宿主路径、账号、key/token、operator credential、证书、registry 原始响应或堆栈。错误码限定为 `DOCKER_UNAVAILABLE`、`IMAGE_UNAVAILABLE`、`IMAGE_INCOMPATIBLE`、`CONTEXT_PREPARATION_FAILED`、`RUNTIME_UNCONFIGURED`、`SHUTTING_DOWN` 或 null。严格管理 API 的 `AdminStatus` 不增加字段，用户业务状态格式也不因 Docker 交付改变。

#### Scenario: 完整就绪与基础就绪不同
- **WHEN** Work 运行环境已 ready，但 file helper 尚在准备
- **THEN** 原 state/ready 可以反映基础可用，preparation.ready 为 false，fileHelper 为 preparing，状态不含拉取源或秘密

#### Scenario: 只查询状态而不修改系统
- **WHEN** 多个客户端在网络故障期间连续调用 status
- **THEN** 每次返回当前安全快照，不因读取发起重复拉取或把长期准备阻塞放到请求中

### Requirement: 默认 Work 共享准备在 Core 就绪前完成

**Identifier:** CORE-WORK-PREWARM-001

Core SHALL 将当前实际默认 Work 配置所选 Agent 镜像的能力检查与默认启用包所需的运行环境探测纳入既有后台准备，不得只准备全局 runtime 镜像而遗漏管理员单独选择的默认 Work 镜像。对应默认准备完成并允许新建 Work 前，结果 SHALL 已可被同进程的第一个默认 Work 复用，不依赖脑包需要首次 seed、升级或已经安装。默认镜像 / 包选择变更成功持久化后 SHALL 重新调度必要准备；默认没有启用包时 SHALL 不为无包创建强制增加包环境探测依赖。

预热 SHALL 保持健康 / 状态查询可响应、单次准备十分钟预算、重试与配置代次规则、既有组件划分及 file / snapshot helper 降级语义，不创建默认 Work，不重置管理员的默认选择或脑包管理决定。Core 重启后的首次预热、未预热的新镜像、拉取和恢复时间 SHALL 分别报告，不能伪装成已经准备好的创建路径。

#### Scenario: 已安装脑包的安装重启
- **WHEN** 脑包已安装且默认选择有效，Core 重启完成后台准备并报告基础 ready
- **THEN** 第一个默认 Work 直接复用镜像检查和所需包环境结果，不在受理前重新导出镜像或创建环境探测容器

#### Scenario: 管理员显式选择空包列表
- **WHEN** 管理员默认配置不启用任何包且镜像运行能力有效
- **THEN** Core 保留空选择，不为预热重新启用脑包，无包 Work 创建不依赖包环境探测

#### Scenario: 默认 Work 镜像不同于全局 runtime 镜像
- **WHEN** 管理员持久化单独选择的默认 Work 镜像或默认包列表
- **THEN** 保存不等待完整准备，后台准备实际所选镜像及必要环境，准备期间状态反映当前默认选择，旧完成结果不能覆盖新选择

#### Scenario: 预热失败或配置换代
- **WHEN** 当前默认准备失败，或准备进行时管理员持久化新配置
- **THEN** 健康和状态仍可读，readiness 反映当前代次实际准备状态，旧代次结果不把新配置标记为 ready

#### Scenario: 非必需 helper 尚未完成
- **WHEN** 默认 Agent、所需环境和恢复已完成，而 file 或 snapshot helper 仍未准备好
- **THEN** 沿既有基础 / 交付 readiness 区分报告，已可用的 Work 能力不被非必需 helper 阻断

### Requirement: Go Core 的安装、数据与运维边界

**Identifier:** CST-OPS-001

Core SHALL 作为 Linux 上的 Go daemon/operator 入口直接使用本机 Docker Engine Unix API，CLI 和 Console 分别交付。新安装采用空的 piwork-go-core/schema 1 数据目录，目录 0700、私有文件 0600，固定 owner 并拒绝链接及多进程并发占用；未知格式、无 marker 的非空目录和身份不一致 SHALL 在开放业务及创建 Docker 资源前拒绝，不自动转换或清空旧 TS 数据。备份 SHALL 在 Core 停止后保留整个数据目录以及受管 Docker 卷，不能把仅复制 SQLite 主文件称为完整备份。

Engine 目标 SHALL 按非空 DOCKER_CONTEXT、非空 DOCKER_HOST、Docker config currentContext、默认本机 Unix socket 选择，只接受本机 Unix endpoint；显式目标失败不切换 Engine。固定镜像 ID 已存在时无需读取 registry 凭据，拉取只使用对应 registry 的静态凭据或匿名访问，不调用宿主 Docker CLI/credential helper。Agent/helper 标签、静态能力和镜像 ID SHALL 先核验，缺能力不回退旧 TS/Python 程序。

health 与 ready SHALL 分离；管理员、runtime、默认准备或恢复缺失时不能称 ready。显式参数/环境优先，初始化仅补缺失持久配置；可选 Base URL 缺省与空值区分。operator 与用户凭据 SHALL 分离；密码/Key 通过隐藏输入或 stdin/file 输入，不作为命令参数。env-file 解析不执行 shell。只有未显式选 Core 且默认 loopback 明确拒绝连接时才允许持同一目录锁离线初始化，超时或未知结果不授权本地回退。

Core 正常退出 SHALL 停止本安装受管 Work 容器并保留 desired、数据和历史；重启协调原 journal/epoch/标签，未知创建和清理失败保留占用，不全局 prune。Service memoryBytes 的旧正数只作为历史兼容，应用 Service 不设有效内存限制/预留，投影明确 unlimited；CPU/数量和 Agent/helper 政策仍有效。旧受限 Service 由受管恢复替换并保留身份、固定镜像和 workspace。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
npm ci
make build
make native-agent-images native-helper-images
export PIWORK_DATA_DIR="$PWD/.piwork-go-core"
export PIWORK_PACKAGE_HELPER_IMAGE=piwork-agentd:go-migration-production
export PIWORK_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance
export PIWORK_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance
./dist/go/piwork-serve serve --data-dir "$PIWORK_DATA_DIR" --listen 127.0.0.1:7171
```

```sh
export PIWORK_DATA_DIR="$PWD/.piwork-go-core"
export PIWORK_CORE_URL=http://127.0.0.1:7171
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  admin bootstrap --account admin
read -r -p '模型提供方: ' PIWORK_MODEL_PROVIDER
read -r -p '模型 ID: ' PIWORK_MODEL_ID
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" \
  config set --agent-image piwork-agentd:go-migration-production \
  --model-provider "$PIWORK_MODEL_PROVIDER" --model "$PIWORK_MODEL_ID"
./dist/go/piwork-serve --core "$PIWORK_CORE_URL" --data-dir "$PIWORK_DATA_DIR" status
```

```sh
./dist/go/piwork-cli --core "$PIWORK_CORE_URL" desktop
```

### Requirement: 原生辅助能力检查与保留 Agent 运行环境

**Identifier:** CST-IMAGE-001

Agent production/acceptance SHALL 保留完整 TS Pi SDK harness 与 Node/npm/Git，并交付普通原生 Go package-helper 和 Service MCP；两 target 使用相同程序字节。Agent RPC v2、package-helper contract 2、Service MCP contract 1 与包内容/context contract 1 SHALL 分别核验，不能用 label、Node shebang 或链接启动器冒充静态 Go 能力。Go 构建固定 1.25.5、CGO=0、只读模块锁和真实 commit/dirty，运行宿主不增加解释器或 sqlite3 依赖。

静态检查 SHALL 先固定 image ID，通过 Engine inspect/save 核验选定 config SHA256、平台、layer/diff ID、gzip、whiteout/opaque 合并树和完整可执行 ELF，不运行 ENTRYPOINT 或包代码，不创建能力检查容器。归档使用 0600 匿名 scratch 与持久安装/image 归属，取消和进程退出回收 fd；仅精确本安装零字节 fallback 占位可清理。归档/恢复各 100 GiB、metadata 单份 64 MiB/累计 256 MiB、一百万条目、路径 4096 字节/深度 128，宣称长度不能驱动无界分配。

Agent 与默认 Web base SHALL 分别提供获准场景所需 sqlite3 CLI；Agent bash 不因 Service 有 Python/pip 就获得这些工具，策略禁用时不能另开 SQL 入口。默认 Web 环境遵循有效 web-development-base 的 NiceGUI 要求，旧 FastAPI/React 描述不作为新默认约束。旧 Work 采用新系统命令仍须兼容镜像选择及显式 Apply。静态镜像能力不替代完整包和目标安装校验。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
make native-agent-images
```

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
  go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run 'TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence|TestRealTSAgentNativeMutualTLSWithoutHostTools|TestRealTSMCPClientNativeStdioAndCoreMutualTLS|TestNativePackageHelperRealImageSourcesAndTSArtifactCompatibility'
```

### Requirement: 初始化并核验 Go Core 持久存储

**Identifier:** CST-NATIVE-001

Go Core SHALL 为全新安装建立明确标识为 `piwork-go-core`、schemaVersion=1 的存储，并原子初始化所需业务表、安装身份和约束。该版本标识与 TS Core schema 8/9/10 及独立的 Agent history 版本分离。已支持的 Go 存储 SHALL 保留安装、用户、登录、Work、Operation、网络身份、文件任务及快照/包状态并按现有规则恢复。

不支持的格式、未知版本、损坏 marker 或无法识别的非空目录 SHALL 在执行数据库迁移、创建 Docker 资源和开放业务路由前明确失败，不静默重建、清空、降级或猜测转换。首次初始化中断只允许从可证明属于本次 Go 初始化的未完成记录恢复，不能据此接受任意非空目录。存储锁 SHALL 保证单一 Core 所有者，未持锁进程不得修改存储。

Work 与 service 的稳定网络身份 SHALL 在对应创建/导入事务发布时分配并持久化；Core 完成 recovery 与容器核验之前不得开启网关。业务重启恢复与 `.work` V1 导入仍为必要能力，不因取消历史安装升级而省略。

#### Scenario: 空目录首次启动
- **WHEN** Core 指向新的空数据目录
- **THEN** 初始化合法 Go 存储并启动健康接口，未初始化管理员/runtime 时显示相应状态，不创建默认用户或 Work

#### Scenario: 同格式重新启动
- **WHEN** Go Core 重启并读取支持的完整 Go 存储
- **THEN** 使用原安装身份和网络身份恢复，不重新分配 Work 域名、不清空 Operation 或配额

#### Scenario: 拒绝旧开发目录或未知版本
- **WHEN** 目录含旧 TS 数据、未知 Go schemaVersion 或无合法 marker 的非空库
- **THEN** 启动非零退出并说明应使用独立支持的数据目录，原数据及 Docker 资源不被修改

#### Scenario: 初始化中断或第二个所有者
- **WHEN** 初始化事务中断后重试，或另一进程已持有目录锁
- **THEN** 前者仅恢复可证明属于 Go 的未完成初始化，后者拒绝；两种情况均不产生部分可用的业务库或并行写入者
