# Core Service Startup Specification

## Purpose

Defines how a local piwork installation is initialized and run as a durable Core service that can authenticate users, control Docker-backed Works, recover existing instances, and report operational state.

## Requirements

### Requirement: Expose distinct health and readiness probes

统一应用 SHALL 在能够响应引导/健康时提供无认证 `GET /healthz`，并在存储初始化及启动恢复完成后通过无认证 `GET /readyz` 报告基础 Work 就绪；关闭时 readiness MUST 失效，runtime/Docker 阻断 Work 操作时 MUST 给出安全原因。未提供 profile 时 SHALL 保持既有 JSON 和基础 readiness 语义，包括 file/snapshot helper 缺失的原有功能降级。

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

#### Scenario: 未初始化安装的容器健康
- **WHEN** 网页可访问但首管理员或模型尚未配置
- **THEN** 应用 liveness 成功，Work readiness 按实际缺项失败，默认镜像不把等待用户配置作为应用存活失败

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

已有 Work 的恢复 SHALL 在本安装基础设施和资源归属核验后按各自依赖调度，保持有界并发及同一 Work 控制目标排序。单个 Work 的包/文件/快照/临时资源待清理或恢复退避不得阻止无关 Work 推进；本安装存储或身份整体不可核验时仍安全拒绝。定时恢复 SHALL 不依赖默认环境先进入 ready，也不得因默认配置更新或 Core 重启重置原持久恢复预算。

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

#### Scenario: 受阻 Work 不阻塞无关 Work
- **WHEN** Work A 等待自身文件或快照收尾，而 Work B 的捕获镜像和恢复依赖有效
- **THEN** A 保持未确认及原栅栏，B 可以完成自身核验并开放；未知资源不被删除，两者都不会产生第二个有效主 Agent

#### Scenario: 恢复遇到较新控制目标
- **WHEN** Work 正在恢复时 Stop、Delete 或 Apply 被接受
- **THEN** 旧恢复不能迟到发布 ready 或覆盖新目标，资源继续按原控制版本、清理与恢复预算规则处理

### Requirement: Shut down Core without destroying running Works

Core 收到 SIGINT、SIGTERM，或因 Docker Compose stop/down/重建进入正常关闭时 SHALL 关闭 HTTP/runtime mutation 与文件准入、停止接受新任务、撤销 readiness、停止生命周期调度，并在既有有界关闭流程内排空执行、收尾文件/快照/package 任务及停止本安装全部受管 Work 的 Agent、附属 Service 与平台 helper。正常关闭成功前 MUST 确认所有受管 Work 运行容器已经停止；不得要求或承诺这些 Work 在 Core 退出后继续运行。某 Work 的 drain 或停止失败 SHALL 不阻止尝试关闭其他受管 Work。

关闭 SHALL 保留 Work 记录、desiredState、Service 启用意图、配置、历史及匹配数据卷，不把 Core 退出隐式转换为用户的 Work stop/delete。默认 drain 30 秒、终止确认 10 秒和 Core 进程总预算 45 秒保持，Docker Compose 提供 60 秒关闭窗口。未确认关闭或超出预算 SHALL 非零退出并提供安全的未完成诊断及恢复记录，不报告正常关闭成功；关闭 SHALL 释放 listener 和 store 锁。SIGKILL、进程崩溃或断电不执行完整正常关闭流程，不得据此记录所有 Work 已停，重启沿用持久意图和资源归属恢复；本变更不新增进程外监护机制。CLI 退出 SHALL 不停止 Work。

正常关闭成功 SHALL 同时确认存储收尾完成，包含必要的 WAL checkpoint 结果和数据库句柄关闭。checkpoint 返回 busy、回填未完成、执行错误或关闭预算耗尽 SHALL 使本次关闭成为未确认并非零退出，不能仅因 SQL 调用未返回错误而报告成功。存储收尾 SHALL 使用统一关闭流程的剩余预算，不额外重置或延长总预算；失败仍须尝试释放本次句柄及安装锁，保留主库和 WAL 中的已提交状态供下一次启动恢复，不删除 WAL 伪造完成。

最终 `app.shutdown` 事件 SHALL 在存储结果已知后记录，反映当时已经确认的 Work 与存储关闭结果；存储未确认时结果 SHALL 为 unconfirmed，不得预先记录 succeeded。日志记录和同步关闭失败 SHALL 传播到非零退出及安全控制台诊断，不承诺向已经失败的日志设施补写结论。安装所有权 SHALL 保持到存储与日志收尾均已尝试完成，避免旧进程尚在收尾时另一 Core 写入同一安装。

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

#### Scenario: 读事务阻塞关闭 checkpoint
- **WHEN** 独立读事务使 WAL 无法在关闭剩余预算内完成回填，SQL 执行返回结果行而非调用错误
- **THEN** Core 非零退出且最终 app.shutdown 为 unconfirmed，保留有效 WAL 并释放自身安装所有权；读事务释放后，新 Core 无须手工 checkpoint 即可恢复最新已提交状态

#### Scenario: 存储失败发生在 Work 已停止之后
- **WHEN** 所有受管 Work 已确认停止，但存储 checkpoint 或句柄关闭失败
- **THEN** 最终关闭记录和退出状态如实表达存储未确认，不遗留较早的整次关闭 succeeded 结论，不修改 Work 的持久运行意图

#### Scenario: 存储收尾时关闭预算已接近耗尽
- **WHEN** Work 或协调任务已消耗大部分总关闭预算
- **THEN** 存储收尾只使用剩余预算，取消或超时后有界返回未确认并继续资源释放，不追加独立的完整等待窗口

#### Scenario: 内部事务回调阻塞关闭
- **WHEN** 内部读写事务的回调持续阻塞，无法在关闭剩余预算内结束，或并发关闭调用者的 context 到期
- **THEN** 关闭调用有界返回未确认，取消未完成事务且旧回调不得继续执行 SQL 或提交；安装锁保持到实际数据库清理及最终日志收尾均已尝试完成，已提交数据可由下一 Core 恢复，预算内正常结束的事务仍可提交

#### Scenario: 日志收尾期间保持单一所有者
- **WHEN** 原 Core 已结束数据库操作但仍在写入最终事件或关闭日志，另一 Core 尝试打开同一目录
- **THEN** 第二个 Core 仍被目录锁拒绝且不写入原安装；原 Core 收尾结束并释放锁后，新进程才可取得所有权

### Requirement: 使用显式容器环境完成首次初始化

**Identifier:** CORE-DOCKER-INIT-001

统一服务端 SHALL 仅保留 PIWORK_ADMIN_ACCOUNT 和 PIWORK_ADMIN_PASSWORD 作为可选业务初始化环境变量，供测试/自动部署在空安装创建持久管理员。两项均未设置时走网页初始化；必须成对且满足原账号/密码校验，不提供默认值，不在日志或响应中输出值。已有身份 SHALL 不被重启时合法 env 改变覆盖；显式部分、空或非法 ADMIN 输入 SHALL 安全拒绝。

服务端 SHALL 移除 PIWORK_MODEL_PROVIDER、PIWORK_MODEL、PIWORK_MODEL_ID、PIWORK_API_KEY、PIWORK_MODEL_API_KEY、PIWORK_MODEL_BASE_URL 及镜像 env 的业务初始化入口，不读取、解析、校验或采用其值。检测废弃配置只可提示变量名称，不得形成旧初始化兼容分支或泄漏值；已有持久模型/runtime/Key SHALL 保留。标准 Engine/系统环境、独立 CLI 与用户 Service 环境不因此全局删除。

发行默认镜像引用 SHALL 为非敏感、同版可核查配置，随统一程序提供；其中 Agent 引用作为发行默认值由服务端自动使用，统一启动不得提供 `--agent-image` 等手填或高级覆盖入口。端口/数据目录等部署参数通过默认值和显式参数提供，默认使用不需要环境文件。启动不得自动创建 Work，默认上下文仍保持原一次性 seed 规则。网页保存模型的协议/Base URL/secret 校验继续按现有模型契约执行。

#### Scenario: 非敏感默认值不构成用户初始化
- **WHEN** 空安装以默认命令启动
- **THEN** 网页初始化可用，不因模型或镜像 env 缺失退出，不生成默认账号、密码或 Work

#### Scenario: 空数据首次启动
- **WHEN** 空安装收到成对有效 ADMIN 值
- **THEN** 创建与网页同性质的持久管理员并进入普通登录，runtime 仍由网页配置

#### Scenario: 重建容器时 env 与持久值不同
- **WHEN** 已有安装以不同合法 ADMIN 值和包含旧模型变量的环境重启
- **THEN** 已有用户、模型、Key、runtime 与 Work 保留，旧模型变量不作为配置来源

#### Scenario: 已有安装收到非法输入
- **WHEN** 只提供一项、显式空值或非法账号/密码
- **THEN** 在初始化前安全拒绝并标识相关字段名称，不修改原安装，不回显秘密

#### Scenario: 试图使用宿主 HTTP 模型地址
- **WHEN** 管理员在网页模型表单提供 http://host.docker.internal:8000 为 Base URL
- **THEN** 继续按既有模型 URL 契约安全拒绝，不因托管入口放宽；旧模型 env 不参与配置

#### Scenario: 显式部署覆盖发行默认值
- **WHEN** 管理员通过既有高级配置提供合法或非法 helper 镜像引用
- **THEN** 合法显式配置只覆盖对应 helper 默认，非法值拒绝且不回退；Agent 仍绑定服务端发行默认，不恢复镜像 env 初始化

#### Scenario: Agent 发行默认值不可手填覆盖
- **WHEN** 安装者启动统一程序或通过引导/管理页保存 runtime
- **THEN** Agent 引用来自服务端同版内嵌元数据，不接受启动参数或网页的自定义 Agent 引用；原高级 helper 显式配置仍按其契约校验，不恢复镜像 env 初始化

#### Scenario: 可选模型地址的省略与空值
- **WHEN** 网页或管理 API 保存模型时省略可选地址或显式提交空值
- **THEN** 按既有模型输入契约区分省略与非法空值，不从旧 env 自动补值

### Requirement: 自动准备运行依赖并允许失败后恢复

**Identifier:** CORE-DOCKER-PREP-001

Core SHALL 自行检查 Engine、拉取缺失的配置镜像、校验平台及各原生协议、准备 package helper/默认上下文并完成启动恢复。已有 Work 恢复 SHALL 与默认准备分别推进，仅依赖该 Work 的实际捕获配置、镜像及必要恢复资源；默认环境未配置、准备缓慢或失败不得阻断依赖已满足的已有 Work。镜像拉取和依赖准备 SHALL 在后台执行，不占用健康/状态请求直至长时间拉取结束；`/healthz`、`/readyz`、`/control/status` 不因拉取锁排队，状态为当前快照。配置持久化后 SHALL 调度相应准备并使 readiness 反映实际状态；既有管理响应与状态 DTO 保持。

在线管理配置在有效配置确认持久化后 SHALL 返回既有保存结果；尚待后台准备时不得把成功保存报告为保存失败，运行可用性由后续 status/readiness 核实。输入无效、secret 不可用或持久化未确认仍使用原安全错误契约；既有管理员 API 的已保存 runtime 加实际 readiness 返回体保持。

单次镜像/上下文准备 SHALL 有十分钟上限且可在关闭或配置换代时取消；可重试的 Engine/网络/拉取失败 SHALL 以 1、5、15、30、60 秒并以 60 秒封顶的退避再次准备，同一组件不得重复并发准备。非法引用/平台/协议错误 SHALL 标为失败，等待纠正配置后再准备。缺少 file/snapshot helper 配置 SHALL 报告 `unconfigured`，package helper 省略时沿用 Agent 镜像的既有回退；失败的首次 file/snapshot helper 拉取不能永久缓存为已经准备完成。成功后 SHALL 捕获不可变镜像身份，既有 Work 不因 tag 变化或新默认值自动替换运行身份。

默认 Agent/默认上下文或必要启动恢复未完成时不得报告全局基础就绪或完整交付就绪；单个 Work 通过本次启动的完整核验后 SHALL 独立表达其就绪，不等待无关默认准备。file/snapshot helper 不可用 SHALL 单独报告该功能不可用，不能阻断本来可用的 Work/Service。关闭 SHALL 停止新尝试并取消后台任务，遵守既有有界关闭规则，不删除 Work 数据。旧配置代次的完成结果 SHALL 不覆盖新配置状态。

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
- **WHEN** 管理员在线提交有效配置，持久化成功但新镜像尚未取得
- **THEN** 保存请求成功返回保存的非敏感 runtime，status/profile 仍报告真实非 ready，后续准备失败不能伪装成未保存

#### Scenario: 默认镜像准备阻塞
- **WHEN** 默认镜像拉取或验收被阻塞，而已有 Work 的镜像记录和必要依赖均有效
- **THEN** 已有 Work 恢复与验证可以完成，获准用户可使用其已核验 Agent 和 Service；默认创建仍受准备条件限制，全局就绪保持非 ready

#### Scenario: 默认配置换代不取消已有 Work
- **WHEN** 已有 Work 正在按捕获 context 恢复，管理员保存新的默认配置
- **THEN** 只有默认准备切换配置代次，已有 Work 不被无关取消、重启、改镜像或隐式 Apply，最新控制目标仍有优先权

### Requirement: 暴露安全的交付准备状态

**Identifier:** CORE-DOCKER-STATUS-001

`GET /control/status` SHALL 保留原 `state/ready/checks`，增加 `preparation={version:1,ready,components}`；components 固定为 `docker`、`agent`、`packageHelper`、`defaultContext`、`fileHelper`、`snapshotHelper`。每项 SHALL 包含 `state`、非负 `attempt`、`retryAfterSeconds` 与 `code`；state 为 `unconfigured|pending|preparing|ready|retrying|failed`，不适用的 delay/code 为 null，重试 delay 为非负秒数。此 `preparation.ready` 表示全部交付组件已准备，不等于基础 Work readiness；完整交付判定还要求基础 ready。Docker 持续不可用 SHALL 最多五秒使基础/交付就绪失效。

网页及既有状态 API SHALL 读取该快照，不再要求 piwork-serve status 命令；组件状态不得带镜像地址/ID、宿主路径、账号、key/token、operator credential、证书、registry 原始响应或堆栈。错误码限定为 `DOCKER_UNAVAILABLE`、`IMAGE_UNAVAILABLE`、`IMAGE_INCOMPATIBLE`、`CONTEXT_PREPARATION_FAILED`、`RUNTIME_UNCONFIGURED`、`SHUTTING_DOWN` 或 null。严格管理 API 的 `AdminStatus` 不增加字段，用户业务状态格式也不因 Docker 交付改变。

#### Scenario: 完整就绪与基础就绪不同
- **WHEN** Work 运行环境已 ready，但 file helper 尚在准备
- **THEN** 原 state/ready 可以反映基础可用，preparation.ready 为 false，fileHelper 为 preparing，状态不含拉取源或秘密

#### Scenario: 只查询状态而不修改系统
- **WHEN** 多个客户端在网络故障期间连续调用 status
- **THEN** 每次返回当前安全快照，不因读取发起重复拉取或把长期准备阻塞放到请求中

### Requirement: 默认 Work 共享准备在 Core 就绪前完成

**Identifier:** CORE-WORK-PREWARM-001

Core SHALL 将当前实际默认 Work 配置所选 Agent 镜像的能力检查与默认启用包所需的运行环境探测纳入既有后台准备，不得只准备全局 runtime 镜像而遗漏管理员单独选择的默认 Work 镜像。对应默认准备完成并允许新建 Work 前，结果 SHALL 在按 RUNTIME-PREP-REUSE-001 复核或重新准备后，可被本进程的第一个默认 Work 复用，不依赖脑包需要首次 seed、升级或已经安装。默认镜像 / 包选择变更成功持久化后 SHALL 重新调度必要准备；默认没有启用包时 SHALL 不为无包创建强制增加包环境探测依赖。

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

#### Scenario: 重启命中持久默认准备
- **WHEN** 当前实际默认 Work 镜像和启用包所需环境已有有效持久成功记录
- **THEN** Core 轻量复核后完成该项预热，不重新完整扫描或运行环境探测；保存新的默认选择仍重新核对其实际依赖

### Requirement: Go Core 的安装、数据与运维边界

**Identifier:** CST-OPS-001

piwork-core SHALL 使用三参数启动和网页业务初始化，遵守 NATIVE-001、CORE-DOCKER-INIT-001 和 web-onboarding；Linux 原生 CLI 独立连接，管理 UI 随 Core 内嵌，不交付独立 Console 或 operator 命令。

Core SHALL 使用本机 Docker Engine Unix API。安装保持 piwork-go-core/schema 1、目录 0700、私有文件 0600、固定 owner、拒绝链接及单实例锁；未知格式、无 marker 的非空目录和身份不一致必须在业务与 Docker 资源创建前拒绝，不自动转换或清空。完整备份须在 Core 停止后保存整个数据目录和受管 Docker 卷，不能仅复制 SQLite 主文件。

Engine 继续按非空 DOCKER_CONTEXT、DOCKER_HOST、Docker config currentContext、默认本机 Unix socket 的顺序选择，只接受本机 Unix endpoint；显式失败不切换 Engine。镜像已存在无需 registry 凭据，拉取使用静态凭据或匿名访问，不调用宿主 Docker CLI/credential helper。镜像身份、协议和能力均须验证，不能回退旧 helper。

health 与 ready SHALL 分离；保留可选成对 ADMIN 首次身份初始化，模型和镜像不读旧业务初始化 env，不新增环境变量或文件替代被删除的启动参数。operator 凭证生命周期和与用户凭据的隔离 SHALL 保留，不删除凭证文件/元数据、不改存储格式或强制重置用户登录。网页单用途委托不替代 operator，管理员和 Work 权限按原边界校验。

全局 Runtime 保存使用目标 Core 的固定发行引用，已有 Runtime/Work 捕获值保持；Work/default-Work 业务配置不因启动参数删除裁减。旧命令、env-file 解析及离线命令回退 SHALL 删除。

Core 正常退出 SHALL 停止本安装受管 Work 容器并保留 desired、数据和历史；重启协调原 journal/epoch/标签，未知创建和清理失败保留占用，不全局 prune。Service memoryBytes 的旧正数只作为历史兼容，应用 Service 不设有效内存限制/预留，投影明确 unlimited；CPU/数量和 Agent/helper 政策仍有效。旧受限 Service 由受管恢复替换并保留身份、固定镜像和 workspace。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

### Requirement: 原生辅助能力检查与保留 Agent 运行环境

**Identifier:** CST-IMAGE-001

Agent production/acceptance SHALL 保留完整 TS Pi SDK harness 与 Node/npm/Git，并交付普通原生 Go package-helper 和 Service MCP；两 target 使用相同程序字节。Agent RPC v2、package-helper contract 2、Service MCP contract 1 与包内容/context contract 1 SHALL 分别核验，不能用 label、Node shebang 或链接启动器冒充静态 Go 能力。Go 构建固定 1.25.5、CGO=0、只读模块锁和真实 commit/dirty，运行宿主不增加解释器或 sqlite3 依赖。

镜像首次验收或成功证明失效时，静态检查 SHALL 先固定 image ID，通过 Engine inspect/save 核验选定 config SHA256、平台、layer/diff ID、gzip、whiteout/opaque 合并树和完整可执行 ELF，不运行 ENTRYPOINT 或包代码，不创建能力检查容器。归档使用 0600 匿名 scratch 与持久安装/image 归属，取消和进程退出回收 fd；仅精确本安装零字节 fallback 占位可清理。归档/恢复各 100 GiB、metadata 单份 64 MiB/累计 256 MiB、一百万条目、路径 4096 字节/深度 128，宣称长度不能驱动无界分配。

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

#### Scenario: 有效证明复用与冷检查保持完整
- **WHEN** 调用者请求镜像能力
- **THEN** 按 RUNTIME-PREP-REUSE-001 复核有效成功证明后可复用；缺失或失效时执行上述全部内容核验，不能只检查标签、文件大小或时间戳后宣称完整验收成功，不能用此证明跳过可移植 Work 导入的实际内容检查

### Requirement: 初始化并核验 Go Core 持久存储

**Identifier:** CST-NATIVE-001

Go Core SHALL 为全新安装建立明确标识为 `piwork-go-core`、schemaVersion=1 的存储，并原子初始化所需业务表、安装身份和约束。该版本标识与 TS Core schema 8/9/10 及独立的 Agent history 版本分离。已支持的 Go 存储 SHALL 保留安装、用户、登录、Work、Operation、网络身份、文件任务及快照/包状态并按现有规则恢复。

不支持的格式、未知版本、损坏 marker 或无法识别的非空目录 SHALL 在执行数据库迁移、创建 Docker 资源和开放业务路由前明确失败，不静默重建、清空、降级或猜测转换。首次初始化中断只允许从可证明属于本次 Go 初始化的未完成记录恢复，不能据此接受任意非空目录。存储锁 SHALL 保证单一 Core 所有者，未持锁进程不得修改存储。

存储身份、版本、完整 schema 和完整性核验 SHALL 使用 SQLite 主库及其有效 WAL 共同构成的一致快照，包含其中已经提交的事务。合法 WAL 尚未完全回填主库 SHALL 不构成不支持格式或数据库损坏；Core MUST 能直接启动，无须用户手工 checkpoint、删除 WAL 或复制重建安装。重启仅恢复已提交状态，未提交事务不得变成业务数据。SHM SHALL 作为可重建的索引状态处理，不作为识别已提交数据的唯一依据；缺少或过期的 SHM 不得阻止合法主库与 WAL 的恢复。

Core SHALL 在取得安装锁并核验路径安全后进行存储预检，通过完整快照核验后才取得原库业务写入能力。拒绝预检 SHALL 保持原目录文件集合及 marker、主库、WAL、SHM 的字节不变；不得为使检查通过而 checkpoint、修复、迁移或丢弃原始数据。必要的临时校验数据 SHALL 私有、仅属于本次检查并在成功、失败或取消后清理，不进入日志、发行包或其他安装。路径、所有权、权限、链接和单实例拒绝约束保持。

首次初始化 SHALL 在确认完整数据库已安全发布后才将 marker 标为 ready。发布依赖 WAL 回填时，回填未完成或结果未知 SHALL 中止本次发布，保留可证明属于该初始化的恢复记录，不把尚未完整发布的数据库当作 ready 存储。

Work 与 service 的稳定网络身份 SHALL 在对应创建/导入事务发布时分配并持久化；网关 SHALL 按目标 Work 开放：该 Work 及目标 Service 完成本次 Core/Engine 代次的恢复、资源栅栏与实际容器核验前不得路由。已完成核验的目标不因无关默认准备或其他 Work 等待而被全局 Ready 门槛阻断；全局关闭、Engine 不可用、身份撤销及目标状态变化仍须阻止新准入并撤销原有内容连接。业务重启恢复与 `.work` V1 导入仍为必要能力，不因取消历史安装升级而省略。

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

#### Scenario: 部分 Work 已核验但全局未就绪
- **WHEN** Work A 及其 Service 已通过本轮核验，而默认准备或 Work B 仍未完成
- **THEN** 获准用户可经原同源 Service 路径访问 A，B 不因 A 成功而放行，全局探针保持其真实聚合状态

#### Scenario: 旧状态不能授权与持续连接撤销
- **WHEN** 存储保留上次 Ready 但当前核验尚未完成，或已开放目标随后 Stop、Apply、撤销身份或遇到 Engine 故障
- **THEN** 前者不允许 HTTP/SSE/WebSocket 路由，后者按原栅栏撤销相关准入与连接，不能依赖镜像记录或旧 Ready 继续访问

#### Scenario: 有效 WAL 尚未完全回填主库
- **WHEN** schemaVersion 1 的安装具有有效已提交 WAL，主库单独检查失败而包含 WAL 的完整快照通过核验
- **THEN** Core 直接打开并恢复最新已提交数据，保留安装身份和业务记录，不误报存储格式不支持，也不要求手工修复

#### Scenario: 缺少或过期 SHM
- **WHEN** 合法主库和有效 WAL 保留，但 SHM 缺失或不再反映该 WAL
- **THEN** Core 根据完整快照核验并恢复，允许重建索引状态，不丢弃 WAL 内的已提交事务

#### Scenario: 已提交与未提交事务并存后进程中断
- **WHEN** 独立 Core 进程提交数据后又在后续未提交事务期间被强制终止
- **THEN** 下一进程保留并恢复已提交数据，未提交数据不可见，不重新创建安装或更换 schemaVersion

#### Scenario: WAL 中的身份或 schema 不受支持
- **WHEN** marker 和主库单独看似受支持，但包含 WAL 的完整快照具有身份不匹配、未知版本或不受支持的 schema
- **THEN** Core 在取得原库业务写入能力前拒绝，不开放业务或创建 Docker 资源，原目录和全部数据库伴随文件保持不变

#### Scenario: 完整快照损坏或预检无法完成
- **WHEN** 完整快照未通过完整性检查，或读取、临时校验、取消导致预检无法确认
- **THEN** Core 安全失败并清理本次临时资源，不改写原目录，不退回忽略 WAL 的检查，不把未知结果当作成功

#### Scenario: 首次初始化的 WAL 回填未确认
- **WHEN** 首次初始化在发布数据库前无法确认必要的 WAL 回填完成
- **THEN** 本次启动失败且不发布 ready marker；后续仅按原初始化归属规则重试，不接受任意非空数据目录

### Requirement: 通过独立 Core HTTP 完成网页初始化与授权

**Identifier:** CST-HTTP-BOUNDARY-001

ControlPlane SHALL 只通过实际 Core HTTP 契约执行用户、管理员及 Service 操作，不以共享内存业务对象、数据库或进程内请求替代。Core SHALL 独立完成所有业务授权和持久提交，不依赖网页层已经检查权限。Core 不接受浏览器 Cookie 作为用户/operator 身份，不为浏览器开放跨源 CORS，也不提供 UI 静态资源。

系统 SHALL 复用已有 Core 路由：`GET /control/status` 提供安全状态、准备信息和精确的持久用户集合非空标志 `hasUsers`；`POST /control/admin/bootstrap` 在原 operator 身份之外，仅允许启动器自动提供的单用途网页初始化委托。该委托 SHALL 只在本次进程存活且用户集合为空时可用，不得访问其他控制/API 路由、取得用户会话或代替完整 operator credential；不进入浏览器、URL、普通输出、日志、持久配置和容器。所有 bootstrap 入口继续共用原子空集合约束，创建后必须普通登录；不新增设置链接或 Access 步骤。

登录、注销、身份、管理配置、发行默认和内容请求 SHALL 复用原 Core API；Service 继续复用 service-access/resolve 与 service-gateway，不另建网关路由。会话观察使用已有身份接口及 Core 内容流撤销能力，每次新受保护请求仍由 Core 鉴权；明确撤销关闭所属内容，短暂断网不能被当作密码错误或自动重放写入。

#### Scenario: 浏览器创建与 operator 并发
- **WHEN** 空安装收到合法网页创建和有效 operator bootstrap
- **THEN** Core 原子地至多创建一个管理员，其他提交安全冲突；网页仍无 operator 输入，创建成功后未自动获得登录会话

#### Scenario: 初始化委托不可扩权
- **WHEN** 使用初始化委托访问非 bootstrap 路由，已有用户后再次创建，或重启后重放旧委托
- **THEN** Core 拒绝且没有业务变化，不将其当作管理员或用户 token

#### Scenario: 禁用管理员不重开首次创建
- **WHEN** 持久用户已存在但没有可用管理员会话
- **THEN** hasUsers 仍为 true，网页及初始化委托不能重新创建首管理员

#### Scenario: 独立网络故障与权限拒绝
- **WHEN** ControlPlane 到 Core 的 HTTP 连接中断或 Core 明确撤销用户会话
- **THEN** 分别呈现连接不可达或普通重新登录，不能绕过 HTTP 改查 Core 内部状态，未知修改先读回，不自动重发

### Requirement: 启动恢复期间的 Work 状态须有当前代次依据

Core SHALL 在启动恢复期间区分当前进程尚未核实的 Work 状态与当前已确认观测；持久化的上次 Ready 或 Stopped 本身不得作为当前运行时已确认事实。对目标为 running 的 Work，等待恢复、正在启动、成功、失败或无法核实 SHALL 分别反映真实进度；对目标为 stopped 的 Work 保持安全确认语义。当前代次确认前不得基于旧观测授予运行入口或声称恢复完成。恢复中的状态查询 SHALL 保持可读，不因单个 Work 或镜像准备阻塞；恢复过程遵守既有身份、代次及安全边界。

#### Scenario: 恢复尚未处理的运行目标
- **WHEN** Core 重启且 Work 持久目标为 running，而该 Work 的容器和 Agent 尚未核实
- **THEN** 该 Work 不作为当前已确认 Ready 或 Stopped 对外呈现，并可表达等待恢复

#### Scenario: 确认恢复与异常
- **WHEN** Work 开始恢复、完成 Agent 与必要 Service 的真实核验，或恢复失败
- **THEN** 对外状态依次反映已取得的进度、确认结果或失败，不由旧代次结果覆盖

#### Scenario: 上次失败但自动重试尚未耗尽
- **WHEN** Core 重启，运行目标的旧观测为 failed，而最新运行代次仍可自动恢复或尚无代次
- **THEN** 该旧失败先作为未确认状态呈现，保留既有重试次数和截止时间，等待当前进程核实

#### Scenario: 自动重试已耗尽或停止目标失败
- **WHEN** 最新运行代次已标记失败且重试预算耗尽，或停止目标的旧观测为 failed
- **THEN** 保留失败状态及原有重试预算，不将其误报为等待自动恢复

#### Scenario: 当前恢复尝试失败但仍有自动重试
- **WHEN** Work 的当前恢复尝试失败且已安排自动重试
- **THEN** 将其发布为未确认并保留重试预算及截止时间；仅在重试耗尽时发布最终失败，不覆盖新的运行代次或停止目标

### Requirement: Core 重启准备具有可重复的端到端验收

**Identifier:** CORE-STARTUP-LATENCY-001

系统 SHALL 在冻结参考环境下分别验收已初始化安装的整 VM 日常启动和 VM/Docker 存活时的 Core 正常重启。参考环境为 Windows WHPX、2 vCPU / 4 GiB、三个不同且已验收的固定 Agent 镜像版本、一个期望运行的默认脑包 Work 和一个确定性 Service；镜像、成功记录及本地依赖均有效，无外部慢 MCP/模型调用和额外压力。报告 SHALL 包含宿主硬件/磁盘、Windows/QEMU/Docker/Core 及制品版本，不以增配或自动更换已有镜像满足目标。

整 VM 计时 SHALL 从启动器进程启动前开始，包含已有 bundle 校验、VM、Docker 与 Core 恢复；P95 MUST 不超过 25 秒，该预算按所有者明确决定由原 20 秒调整。Core 重启 SHALL 从 Core 进程启动前计时，前一次正常关闭已确认停止受管 Work 容器，P95 MUST 不超过 10 秒。结束点 SHALL 为工作台实际后端请求、当前 Agent 有效响应、浏览器同源 Service 代理预期内容和完整交付就绪均成立的最晚时点；不能用仅 HTTP 监听或 health 成功代替。完整就绪探针仍不保证任意用户 Work 就绪，验收须独立检查参考 Work。

每组 SHALL 至少记录 20 次预先确定的连续尝试，保留所有失败/超时和慢样本，报告逐次耗时、P50/P95/max，使用 nearest-rank 计算分位数；任何失败/超时使该组不通过，不能以追加重试替换。每次有效记录的镜像完整导出与完整扫描 SHALL 均为零，已有效的必要环境探测也 SHALL 为零。验收 MUST NOT 重启 Windows 宿主整机，也不以整机重启作为完成条件；报告 SHALL 区分已验证的 Core/VM 进程重建与未执行的宿主断电或宿主页缓存丢失场景。

首次空安装、升级引入新镜像和旧安装首次建立成功记录 SHALL 各自单独测量准备阶段及完整时间，保持原有有界准备/重试行为；上述 Core 10 秒与整 VM 25 秒预算不适用于这些冷路径，不能用重启结果宣称它们已经达标。Linux/Core 局部验证不能替代修复制品集成到 Windows MicroVM 后的实际验收；未完成实测 MUST 明确标记未验收，不宣称整体优化完成。

已完成上述完整基线后，若后续候选仅修复核验发现的问题，所有者明确选择按已有样本完成定向回归时，系统 SHALL 保留原完整基线、原始新候选采样计划及实际停止原因，以匹配当前制品的真实 Windows 启动结果完成该轮增量复验。每个实际样本仍须核对当前 Core/镜像身份、共同可用结束点及零重复完整导出/扫描和有效环境探测；报告 SHALL 分开完整基准与增量回归，列明实际样本数，不足 20 次的组 MUST NOT 宣称该候选已重新通过 P95 完整基准。采样工具的原完整基准判定不因增量复验而放宽，不能以纯 Linux 测试替代当前 Windows 制品的实际运行。

#### Scenario: 重启参考安装
- **WHEN** 用固定配置分别执行两组至少 20 次正常重启
- **THEN** 全部成功且分别满足整 VM 25 秒、Core 10 秒 P95，逐次零重复全量验收，并从实际 UI、Agent、Service 和探针共同验证结束点

#### Scenario: 整 VM 已正常退出
- **WHEN** 独立测试 VM 正常关闭并确认进程退出后，再次启动同一测试安装
- **THEN** 有效记录仍复用，不重新全量导出扫描；各次耗时、失败和当前恢复验证单独可查，测试不重启宿主整机

#### Scenario: 首次建立或失效后准备
- **WHEN** 空安装首次准备、首次升级建立记录或新镜像首次出现
- **THEN** 分组记录完整检查/加载及恢复耗时和次数，必要检查只按实际唯一键执行，不隐去首次成本或将其计为有效记录命中

#### Scenario: Core 达标而 Windows 尚未通过
- **WHEN** Core 单测或 Linux 基准通过，但匹配的 Windows 集成制品缺失、未测或超出目标
- **THEN** Windows 验收保持未完成或失败，给出实际阶段归属，不能以局部结果宣布整体优化完成或擅自放宽预算

#### Scenario: 所有者选择修复候选定向复验
- **WHEN** 前轮完整性能基线有效，修复候选已集成到 Windows MicroVM 并完成真实启动，所有者明确要求按已有结果收尾
- **THEN** 保留当前已完成样本，正常关闭当前测试 VM 后停止追加启动，按实际数量与制品身份单独记录增量回归判定；原完整基线和失败保留，不以小样本或旧包结果伪称新候选完整 P95 验收

### Requirement: 通过网页和受保护 API 初始化首管理员

Core SHALL 允许空安装通过普通网页、受保护 operator bootstrap API 或成对可选 ADMIN 环境变量创建首管理员。网页和 env 语义遵守 web-onboarding 与 CORE-DOCKER-INIT-001，所有入口必须原子核验持久用户集合为空，不因管理员被禁用而重新开放，不生成默认账号密码或覆盖已有身份。

Core SHALL 保留 operator 凭证和网页单用途初始化委托的分离；网页不读取 operator 凭证，成功创建后仍须正常登录。旧 admin bootstrap 命令及离线初始化命令 SHALL 删除，不保留兼容入口。

#### Scenario: 网页初始化
- **WHEN** 空安装通过合法来源及 CSRF 提交账号密码
- **THEN** 原子创建管理员并关闭首次创建入口，无需重启 Core，随后正常登录

#### Scenario: operator API 初始化
- **WHEN** 有效 operator credential 对空安装调用 bootstrap API
- **THEN** 按原鉴权和原子性创建管理员，不输出密码或摘要；普通用户 token 不获此权限

#### Scenario: 重复与并发
- **WHEN** 已有用户时再次初始化，或多个允许入口并发初始化
- **THEN** 已有身份保持，并发最多一个成功，不因旧命令删除放宽授权

### Requirement: 通过在线管理配置全局 Runtime

Core SHALL 通过网页和受保护的在线管理 API 配置全局默认 Runtime，删除离线配置命令。全局 CoreRuntime 的 Agent 引用固定使用保存请求目标 Core 内嵌的发行引用，模型配置无需选择镜像；API 字段校验继续遵守 CADM-004 和 SERVE-RUNTIME-RELEASE-001。引用缺失或无效时安全拒绝，不提示手填。

全局配置 SHALL 仅作为之后新建 Work 的默认值；已有 Work 的独立配置、模型引用和运行实例不因全局修改而改变、重启或切换模型。读取、启动和升级如实保留已持久 Runtime；显式保存才采用当前发行引用，确认保存与后台准备/readiness 分别表达。

#### Scenario: 网页保存 Runtime
- **WHEN** 管理员提交合法模型、可选 endpoint 和 secret
- **THEN** Core 用自身发行引用保存，响应只有非敏感字段和 secret 可用性，准备在后台进行

#### Scenario: 仅更新新 Work 默认值
- **WHEN** 全局模型从 model-a 改为 model-b
- **THEN** 新 Work 使用新默认值，已有 Work 不隐式修改或重启

#### Scenario: 配置不完整
- **WHEN** 启动时缺少可用 Runtime 或依赖
- **THEN** 健康和网页引导可用，readiness 给出实际原因，Work 创建返回可操作错误

#### Scenario: 已有捕获引用
- **WHEN** 程序升级后仅启动或读取安装
- **THEN** 既有 Runtime/Work 引用保持，只有明确重新保存更新全局默认

### Requirement: 以三项配置启动持久 Core 应用

`piwork-core` SHALL 无子命令启动一个持久 Core 与独立 ControlPlane HTTP 服务，只接受 --ui-port、--core-port、--data-dir 三项运行配置；--help/-h 和 --version 是无数据/网络副作用的信息查询。UI/Core 默认端口为 17891/17871，默认目录为 Linux 用户配置目录下 piwork/server，显式相对路径按启动工作目录解析。端口必须为 1..65535 十进制整数，不能相同或等于内部 RPC 7172。重复、未知、空值、非法参数及额外位置参数 SHALL 在副作用前以 usage exit 2 拒绝，不回显秘密。

UI 和 Core SHALL 分别绑定 0.0.0.0 上的所选端口并使用 HTTP；后端固定通过 127.0.0.1 的 Core HTTP 地址调用。浏览器只使用 UI，外部用户客户端和 operator API 直接使用 Core 端口。系统不提供 HTTPS listener、证书/public-origin 配置、旧 serve/管理子命令、旧监听参数或对应兼容开关。内部 Agent RPC 保留 7172 和容器可达地址及原 mTLS 身份，不增加第四个运行参数。

系统 SHALL 支持通过 loopback、localhost、本机主机名和服务器实际 IPv4 使用 UI。每次请求的 Host 必须属于服务器核验的本机名称/IP 且端口正确；Origin 必须匹配该请求的 HTTP origin，变更仍需 CSRF，拒绝跨站来源及未知 Host。会话绑定其 origin；生成链接、Service 和事件/升级连接沿用当前已验证入口，不信任任意 Forwarded 头，不把浏览器 Host 当作 Core 上游。输出实际地址，不输出 0.0.0.0 作为访问 URL。浏览器打开器不可用不得使启动失败。

空安装和 runtime/Docker 不可用 SHALL 仍提供健康和初始化页面，不创建默认 Work、不伪造 ready。已配置安装完成验证及恢复后报告真实 readiness。UI/Core/RPC listener、存储锁及后台恢复 SHALL 有统一生命周期；冲突、部分启动失败或必需监听异常结束触发有界清理，非零退出且无半启动服务，不换端口或接管其他实例。正常退出遵守本安装 Work 停止及持久意图保留规则。

#### Scenario: 默认与自定义启动
- **WHEN** Linux 用户直接启动 piwork-core，或提供三项合法配置
- **THEN** 同一进程在对应端口提供 UI/Core HTTP，空安装可进入网页引导，默认无需业务 env 或 CLI 初始化

#### Scenario: 无效和旧参数
- **WHEN** 传入 serve、login、admin、--listen、--core-listen、TLS、public-origin、helper/RPC 参数、重复参数或非法端口
- **THEN** exit 2 且不创建目录、监听、凭证或 Docker 资源，不静默忽略或转发

#### Scenario: 多网卡与外部 CLI
- **WHEN** 浏览器分别使用服务器两个实际 IPv4，外部 Linux CLI 使用 Core 端口
- **THEN** 各 UI origin 都能正常初始化/登录/使用 Service，CLI 按用户身份直连 Core，不借浏览器 Cookie

#### Scenario: 伪造来源
- **WHEN** 请求包含未知 Host、错误端口、跨站 Origin 或伪造 Forwarded 上游
- **THEN** 来源校验拒绝，不能建立授权会话或修改状态，后端 Core 目标不变

#### Scenario: 端口或目录冲突
- **WHEN** 任一 HTTP/RPC 端口被占用，或另一实例持有相同数据目录
- **THEN** 本次进程非零退出并释放已取得资源，原占用者和安装不变，无可写半实例

#### Scenario: 帮助与版本
- **WHEN** 在不存在的数据目录和无 Docker 环境请求帮助或版本
- **THEN** 返回正确帮助或 piwork-core 真实构建身份，不创建状态、不打开浏览器、不联网

#### Scenario: 恢复与正常关闭
- **WHEN** 配置完整安装启动，随后正常终止
- **THEN** 按原日志和所有权恢复 Work，退出停止本安装受管容器并保留持久意图、配置、历史与数据
