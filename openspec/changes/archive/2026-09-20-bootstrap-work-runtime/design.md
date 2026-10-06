# Design

## Context

动机与能力范围见 [proposal.md](./proposal.md)，架构输入见 [architecture.md](../../../../docs/design/architecture.md)。项目是产品架构上的新项目，但存在独立 `demo/`：TypeScript、pi SDK `@earendil-works/pi-coding-agent`、grpc-js、ts-proto，以及真实 gRPC 往返测试。当前没有主 specs、Core、容器编排、登录或 Web 控制面板。

已观察到的约束：demo 的 SessionRegistry 是内存 Map；只会复用进程内已知 Session ID；连接取消会触发 SDK abort；客户端和服务端均使用 insecure gRPC；模型凭证可用性被称作 authenticated。这些是样例行为，不是新产品的兼容约束。复用事件映射和 SDK 封装方法，不能直接继承其恢复、权限和取消语义。

## Goals / Non-Goals

**Goals:**

- 在单台 Linux 主机上构建可验证的持久 Work 与服务协调循环，允许多个 Work 并行。
- 把用户、运行身份、期望配置、实际实例、持久数据和对话执行划成明确边界。
- 让第一次部署、用户操作、agent 自主创建服务、停机恢复和故障查询都有完整入口。
- 通过协议与适配器隔离 SDK、容器运行时和 UI，以便替换实现而不改变 capability。

**Non-Goals:**

- 本变更不要求无停机升级、分布式选主、跨主机调度或磁盘灾难恢复。
- 不把任意容器可写层当作镜像制品，不承诺重放任意有副作用的工具调用。
- 不兼容 demo 匿名 Ask 作为生产 API，不自动迁移其本地 .piwork 数据。

## Decisions

### 1. 单 Core 模块化进程，Work 内一个 agent 进程

使用 TypeScript npm workspaces，Node 24 LTS，Core / agentd / CLI / Console 四个应用。Console 使用 React/Vite 生成静态资源，由 Core 提供；控制 API 使用 Fastify，agent 协议使用 grpc-js 与生成的 Protobuf types。Core 使用 SQLite WAL 持久状态，存储封装在 core-store；Work 使用独立 SQLite 元数据和 SDK 历史文件。

Core 在宿主机以受控服务账户运行，通过本机 Docker socket 编排同级容器；不使用 Docker-in-Docker。只有 Core 拥有 socket。Work 使用独立 bridge 网络和命名卷，daemon 与服务容器无特权、无宿主网络、无 socket、无任意 bind mount。

选择单进程 Core 是因为第一版没有跨主机需求；把 identity、lifecycle、work-services 拆成微服务只会增加事务和部署边界。SQLite 适用于单控制器；通过宿主进程锁防止双 Core。运行时 Adapter 保留替换 Docker 的接口。

### 2. 领域状态分库，控制动作先落盘

Core 持久对象：users、login_sessions、works、work_config_revisions、service_revisions、service_heads、operations、idempotency_records、resource_bindings、volume_records、quota_reservations、runtime_generations、catalog_entries、secret_refs。

Work Store 保存 sessions、runs、run_events 和 submit_idempotency。Session 内容以 SDK 持久历史为准；Work Store 只保存 SDK 会话定位信息、运行元数据和协议事件，不另造第二份可独立修改的对话事实来源。

控制 mutation 在短事务中完成授权后所需的状态版本检查、幂等记录、配额预留、期望状态和 Operation 提交。外部 Docker 操作不持有数据库事务。Operation 状态为 pending/running/succeeded/failed/superseded；新期望状态取代旧动作时，旧 Operation 明确 superseded。

幂等键作用域为 principal + Work（创建 Work 时为 owner）+ operation kind；同键同内容返回原结果，同键异内容冲突。Core mutation 记录随逻辑对象及删除 tombstone 保留；Run 的提交键随 Run 保留。清除 Work 全部数据前不允许“过期重试”创建重复对象。

数据库与 Docker 无跨系统事务，因此选用持久意图 + 可重复执行核对。仅依赖内存任务队列会丢失中间步骤，不能满足 Core 崩溃后的接管。

### 3. Work 控制器与服务控制器共享资源归属规则

每个 Work 按版本串行推进操作，不同 Work 可并发。Docker 标签包含 installation_id、work_id、resource_kind、service_id（如适用）、config_revision、runtime_generation；确定的实例名称和标签用于检查“已创建但未回写”的资源。

启动 Core 后先锁定数据库和控制器身份，再扫描资源并核对。匹配实例接管；缺失实例补齐；状态不明时报告 unavailable/unknown。未能确认旧主 daemon 停止前不启动新实例。无法归属的资源只报告 orphan，不自动删除。

Work 期望状态 running/stopped/deleted 与观察状态分开。enabled 服务仅在 Work 期望 running 时运行。agent ready、附属服务失败时 Work degraded；required 初始化失败时不开放 Agent API。

Docker restart policy 默认关闭，自动恢复由 Core 控制，避免宿主机重启误拉起 stopped Work。Core 正常退出保留已有容器；它离线时已有 Run 可以继续，控制资源请求返回暂时不可用。宿主重启由 Core 按持久期望状态恢复。

### 4. 身份与访问采用持久可撤销会话

本机 `piwork-core bootstrap-admin` 在数据库中无用户时创建首个管理员，通过终端隐藏输入或受限 stdin 接收密码，无公共 bootstrap API 和默认密码。再次调用拒绝修改现有账号。普通用户由 Console 管理；不允许禁用最后一个启用的管理员。

密码使用 Argon2id；随机高熵 opaque 登录 token 只保存摘要。默认 24 小时绝对有效期，可配置。CLI 存本用户权限文件；Console 用 Secure、HttpOnly、SameSite cookie，写请求检查 Origin 和 CSRF token。登录错误不区分不存在账号与密码错误；按账号键和来源限制失败尝试，默认 5 次失败/分钟，随后本分钟返回限流。

注销撤销当前登录会话，重置密码或禁用账号撤销其全部会话；Gateway 在事务成功后关闭对应观察流，并在每次请求及到期时校验。已接受 Run 与已运行服务继续，管理员通过 StopWork 明确停止。

普通用户只能访问自己的 Work。管理员可以管理用户及所有 Work 的控制状态、配置、资源和清理；管理员不自动获得别人的会话正文、Run 输出或交互入口，第一版不增加 impersonation。daemon 运行身份只能管理所属 Work 服务和报告状态，不能登录为用户或管理其他 Work。

备选的纯自包含 JWT 会额外引入即时撤销问题，故第一版使用持久会话。Work 身份与用户 token 严格分开，不把用户长期凭证放进容器。

### 5. 一个 Core 配置入口，明确区分三种协议

Core HTTPS 提供 `/api/v1` 控制 API 和 Console。CLI 登录并获取 discovery，其中包含同一部署的 Agent Gateway 地址；gRPC TLS 可使用独立监听端口，Client 无需配置任何容器地址。默认入口 8443，Agent Gateway 8444，内部 daemon 8083；部署可统一反向代理，但不要求第一版实现 HTTP/1 与 gRPC 的单端口复用。

Core 与 daemon 的控制、Agent API 转发及 daemon 回调使用安装级 CA 签发的 mTLS 身份。证书主体分别标识 Core 和 work_id/generation；证书与 CA 状态持久保存以支持 Core 重启接管。每次内部 mutation 再核对数据库中的当前代次；daemon 只接受 Core 身份的转发，拒绝其他 Work 证书。外部用户 token 在 Gateway 验证，转发 user_id 只能由受信 Core 提供，Client 不能伪造。

Control API 定义 Work/Service CRUD、配置 revision、用户管理、Operation 与留存卷清理。Agent API 为 Session create/list/read、SubmitRun、GetRun、WatchRun、CancelRun。内部 API 为注册/readiness、drain、服务 mutation、状态报告。contracts 包分别保存 OpenAPI/JSON schemas 和 agent Proto，错误结构使用 code/message/retryable/operation_id 等稳定字段。

HTTP 认证/权限/不存在/冲突/限流/依赖不可用分别映射 401/403/404/409/429/503；gRPC 使用对应 status 并携带业务码。外部未知 Work 与无权限 Work 均返回不可见结果，不泄露其配置。业务 Run 失败是可查询终态，传输失败不推断业务终态。

### 6. Run 独立于 Watch 连接，Session 持久恢复

SubmitRun 在 Work Store 中原子写入提交键、Run 和 Work 活动槽后返回接受结果；其后在后台驱动 SDK。同 Work 第二个不同提交返回 WORK_BUSY，不使用无界队列。相同提交重试先查幂等记录，不因活动槽被占用而变成新请求。

WatchRun 仅观察，断线不 abort。CancelRun 单独请求 SDK 和受管工具取消，未确认结束前保留 cancelling 和活动槽；取消与完成竞争时持久终态先提交者生效。StopWork 的最终容器终止提供无响应工具的上界。单次 Run 失败不停止 Work。

事件按 Run 顺序编号并先提交后可重放地发布；允许对流式文本批量提交，但未持久事件不向 Client 承诺可恢复。终态与最终结果一起持久提交。默认每 Run 保留最近 10,000 个事件且终态后至少 24 小时；超出按有界策略截断并公布最早可用游标。Run 元数据、最终结果和 SDK 历史保持到显式数据清理；旧游标返回 CURSOR_EXPIRED 并引导读取状态/历史。

每观察流有 1 MiB 队列上限，超限结束该观察，Run 不受影响。恢复 daemon 时旧 accepted/running/cancelling Run 统一标记 interrupted，不自动再次执行。SDK 历史与 Run Store 不能原子提交，无法确认的完成按 interrupted 保守呈现；用户仍可查看已保存历史。

相比 demo 的 Ask 单 RPC，本模型需要更多方法，但解决连接断开即取消、重复提交和服务端状态不可查询的问题。

### 7. 版本化环境与可用模型形成启动前提

WorkConfig 是不可变 revision：agent image、Skills 固定引用、MCP 配置、model_ref、资源及工具策略。Core 保存 desired_revision，daemon 注册报告 active_revision；更新采用 expected_revision，不隐式重启已运行 daemon。Work 下次启动加载新 revision。

管理员维护兼容镜像、Skill 制品和模型配置目录；普通用户从可用目录选择，MCP 命令必须能在选择的 agent 镜像内运行。实例级 secret store 使用宿主受限文件和数据库引用，Console 只接受写入、返回标识和遮罩，部署备份需要包含这些文件。仅向需要它的 Work/MCP 进程注入凭证。

提交配置先做结构、引用与政策验证；镜像拉取、Skill 物化、必需 MCP 连接等启动检查允许异步失败，保留 Work 和具体 Operation 错误。镜像 tag 初次解析成功后绑定 digest；以后同 revision 使用该 digest。agent 镜像包含 Node、agentd 和 SDK，基础环境变体可增加 Python 等工具。

Skill 固定到内容摘要；不自动读取宿主用户目录或漂移分支。第一版配置的 Skill 都是 required，缺失/无效时启动失败，移除后下一次启动不再加载。MCP 支持 stdio 和 Streamable HTTP，按 server_id 给工具命名，默认工具调用超时 30 秒，required 初始化失败阻止 ready；optional 故障仅暴露工具不可用。

仅接受明确的 required MCP → 本 Work Service 依赖，可在 Work stopped 时预配置服务，再配置该 MCP 并启动；不引入任意依赖 DAG。stdio MCP 进程随 daemon 回收，容器 MCP 由 Core 管理，远程 MCP 不由 piwork 停止。

### 8. 自主扩展是声明式服务操作

ServiceDefinition 包含稳定 ID/名称、revision、image 引用/digest、command/args、环境和 secret refs、卷、内部端口与别名、CPU/内存、enabled、readiness 和重启策略。agent 的 Work Tools 调用 Core 内部服务 API；修改环境或卷必须显式提交定义，进入容器手工修改不成为配置。

创建事务保存定义、Operation 和配额预留后才启动 Docker 动作。镜像拉取失败保留 failed Operation 和定义，可显式 retry。Work Services 按逻辑身份复用卷，更新服务先停止旧实例再创建新实例，第一版允许停机且不回滚应用数据。保留历史 revision，回退通过提交基于旧内容的新 revision 完成。

enabled=true 且 Work running 才启动；restart 操作不改变 enabled。Work stopped 时所有者可预配置服务或改变 enabled，但不启动容器；过渡到 stopping/deleting 后拒绝新的服务修改。agent 只有有效运行代次且 Work 接受修改时才能提交。删除定义使用 tombstone 和清理 Operation，保留数据策略见 work-storage。

### 9. 配额、存储和网络隔离必须由 Core 落实

第一版对每 Work 设置最大服务数、总 CPU 和内存预算；agent 预留加所有 enabled 服务配置在接收新定义时核算，即使 Work stopped 也保留预算，保证再次启动不会超其配置上限。Runtime 下发实际 CPU/内存限制。禁用/缩容只有旧实例停止或限制更新确认后才释放对应预算；尚占用资源与新目标之间取保守值。总宿主预留也在事务内校验，失败容器的保留定义不隐式放弃预算。

默认本地命名卷没有可移植的硬字节配额；第一版拒绝要求强制 storage_bytes 的配置，返回 UNSUPPORTED_LIMIT，不能把统计值伪装为执行限制。提供磁盘剩余量与卷使用观测，磁盘满时停止接受依赖持久写入的新工作。服务数量和留存卷数量配额防止无界资源创建。

卷具有 installation/work/service 归属；只允许挂载归属于本 Work 的受管卷。删除默认保留卷和可查询 tombstone，明确 purge_data 或后续 purge 操作才删除数据；仍被引用的卷拒绝 purge。跨 Work 卷/挂载和跨 Work 私有网段流量默认拒绝，容器不能访问宿主控制面私有端口（授权 daemon 通道除外）。允许模型/MCP/镜像所需的配置出站，Docker socket 仅本机 Core 可用。

相较把 socket 挂给 agent，本方案能够持久追踪每个服务，并对权限、预算与删除范围给出可验证边界。

### 10. 超时、恢复预算与收尾

默认有效策略如下，部署可显式覆盖，生效值通过有权限的配置/状态查询暴露；测试使用更短配置验证边界。

| 参数 | 默认 |
|---|---:|
| 单次镜像准备超时 | 300 秒 |
| agent / service readiness 超时 | 120 秒 |
| Work drain 宽限 | 30 秒 |
| 后续容器终止确认期限 | 10 秒 |
| 健康检查间隔 / 连续失败阈值 | 5 秒 / 3 次 |
| 自动恢复 | 10 分钟内最多 3 次，退避 1/5/15 秒 |
| 稳定运行后恢复预算重置 | 连续 ready 10 分钟 |
| Core 资源重新核对周期 | 5 秒，加运行时事件触发 |
| 本地 MCP 退出宽限 | 5 秒，随后终止其进程组 |

恢复计数与 next_retry_at 持久保存，Core 重启不清空预算；耗尽后需要显式 retry 或稳定运行条件重置。Runtime 不可达时不消耗盲目重复创建预算，只记录 unknown 和依赖错误。

StopWork 先持久期望状态并关闭新提交入口，再 drain agent、取消剩余 Run、终止 daemon 及 MCP，最后停止服务。超时强制终止，但未观察到真正停止则不报告 stopped。DeleteWork 走同样收尾再删除受管实例，按数据策略清理。

### 11. 最小交互与验收分层

CLI：login/logout，work create/list/show/start/stop/retry/delete，chat，run show/watch/cancel；配置以明确 ID 或文件输入，Client SDK 封装提交、观察和重连。Ctrl-C 在等待回答时发送显式 CancelRun，普通网络丢失只停止观察。

Console：管理员用户管理，镜像/Skill/模型和 secret 引用管理，所有者 Work 配置与生命周期页面，服务列表/状态/修改及留存卷清理。没有 WebChat、复杂文件管理器或完整应用服务代理。

验证分三层：纯状态/权限/协议测试；真实本地 HTTP/gRPC 与确定性模型/MCP fixtures；专用 Docker namespace 的进程和容器故障注入。真实 SDK smoke 必须验证持久 Session 重载、Skill 加载、MCP 工具执行及 abort，不以 mock 代替 SDK 接入证明。真实外部模型试跑由部署者凭证驱动，不属于普通自动测试的必需依赖。

## Risks / Trade-offs

- [单 Core/Gateway 是单点] → 离线期间控制与新连接不可用，已有容器保持；恢复核对明确覆盖。
- [SDK API 版本与示例可能变化] → 锁定实际依赖版本，先执行具体适配验收，再实现依赖它的 daemon；不静默删减持久恢复或 MCP 能力。
- [文件历史和 Run 数据库非原子] → 不确定执行标记 interrupted，保留历史，禁止自动重复有副作用的执行。
- [应用迁移无法通用回滚] → 镜像版本回退不承诺数据回滚，保留旧 revision 与持久卷。
- [服务可执行任意应用代码] → Core 强制镜像策略、资源限制、Work 网络和卷归属，不暴露 Docker socket。
- [本地卷无统一字节硬限制] → 明确不支持并拒绝相关配置，观测空间不足并阻止假成功。
- [规划范围横跨整个第一版] → tasks 按可验收阶段排列，每阶段交付功能链路，最终故障恢复验收不可省略。

## Migration Plan

1. 建立新 workspace 与模块，保留 demo 独立运行及其测试；无自动数据迁移。
2. 为 Core/Work Store 建立带 schema version 的初始迁移，先在临时环境验证重启和事务。
3. 打包兼容 agent 镜像、Core 服务和 Console；提供单机配置、TLS/CA 初始化和 bootstrap-admin 指引。
4. 在隔离安装 ID 下运行完整验收：用户登录、Work 对话、agent 创建服务、持久数据写入、停机恢复、故障注入和跨 Work 拒绝。
5. 首次生产部署在空实例执行 bootstrap，录入模型 secret 和可用镜像/Skill；无需转换 demo 数据。
6. 回退先停止新入口并显式停止该安装的 Work，保留数据库与卷；恢复先前二进制只允许数据库 schema 兼容，否则从部署前备份恢复控制状态并重新核对。不能用恢复旧 Core 数据库假装回滚外部服务写入。

本变更不保留影响验收范围的未决产品问题。SDK 接口方法、Docker 存储/网络验证、证书部署和目标机默认容量由具体任务验证或部署参数给出，不改变已定义的行为契约。
