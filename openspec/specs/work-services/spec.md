# Work Services Specification

## Purpose

使 Work 内的 agent 能自主声明和管理附属容器服务，把服务定义作为 Work 的持久配置，并保证启停、重试、更新和控制服务恢复后仍按定义运行与保留数据，而不依赖重复的对话部署步骤。

## Requirements

### Requirement: Declare services through Work-scoped agent tools

**Identifier:** WSRV-001

系统 SHALL 向 agent 提供创建、列出、检查、修改、重启、启用、禁用和删除服务的工具；授权及配额允许的请求不要求用户逐个手工操作容器。所有者和有控制权限的管理员 SHALL 能通过受保护 API／Console 查询和管理这些服务。

Core SHALL expose authenticated gRPC operations for deployment context, create, list, inspect, update, restart, enable, disable, remove, retry, service Operation reads, and bounded log reads. The deployed production Core and real agent SDK SHALL execute this path. Mutations SHALL return `{workId, serviceId, operationId, correlationId, reused}` after durable acceptance and before completion; reads SHALL use public typed projections. List results SHALL be ordered by name then serviceId. Protected owner/admin HTTP service routes SHALL use the same manager; no new Console UI is required in this change. MCP start/stop SHALL mean enable/disable respectively.

#### Scenario: Agent adds a service

- **WHEN** 当前 Work 的有效 daemon 提交合法笔记服务定义
- **THEN** 系统接受创建，返回稳定 service_id 和 operation_id，agent 能查询实际结果并使用 Work 私有服务端点

#### Scenario: Observe an accepted deployment
- **WHEN** a valid current agent submits a service definition
- **THEN** Core returns durable identifiers; the agent can query the Operation and service until ready or failed without resubmitting

#### Scenario: Retry without model redeployment
- **WHEN** a failed enabled service has a corrected external dependency and the agent explicitly retries with a new key
- **THEN** a new Operation reconciles the same desired definition; a repeated key returns the original result

### Requirement: Persist a complete reproducible service definition

**Identifier:** WSRV-002

接受的服务定义 SHALL 持久保存 Work 内唯一身份/名称、版本、镜像引用、启动参数、配置引用、挂载、内部端口、CPU 限制、enabled 和恢复/readiness 策略。定义及 Operation SHALL 在对外承诺接受和创建运行实例前持久化；镜像首次解析成功后 SHALL 在创建实例前持久绑定固定制品身份，同 revision 后续使用该身份。停止后定义 SHALL 仍能查询。

部署 SHALL 接受已有本地/registry 镜像、显式 executable/args、environment、workspace 内工作目录、显式只读/可写 workspace grant、内部端口、CPU、enabled/required、restart 和可选 readiness。应用 Service SHALL 不设置平台内存上限，实际创建的 Docker 容器 SHALL 无 Service memory limit；不能由其他默认值、Work 内存预算或镜像名条件重新施加。旧 `memoryBytes` 数值字段仅为兼容和历史数据保留，不再授权或要求内存限制；当前 Service 投影 SHALL 明确说明内存无限制，不能将历史数值展示为有效上限。Agent/helper 的资源策略保持各自契约。

本版部署 SHALL 在接受前拒绝 build context、Dockerfile、image commit/build、特权、host port/network、任意宿主挂载及非空不支持 secret 引用。新解析的不可变镜像身份 SHALL 在创建容器前持久化；同 revision 重试不得追随变更的 tag。定义不可变性覆盖镜像和启动配置，不覆盖可写 workspace 文件及业务数据。

#### Scenario: Definition survives agent loss

- **WHEN** Core 接受定义后 agent 崩溃
- **THEN** 定义和 Operation 仍存在，Core 可以完成或报告失败，无需 agent 重复声明

#### Scenario: Image resolution fails

- **WHEN** 定义已接受但镜像无法拉取或解析
- **THEN** 服务保留 failed 状态及原因，不能报告 ready，修复后可显式 retry

#### Scenario: Deploy existing Python image
- **WHEN** Agent 选择可用 Python 镜像与 workspace 内的 server.py
- **THEN** Core 按声明命令和 workspace 启动镜像，不执行 build 或 commit

#### Scenario: Retag after deployment
- **WHEN** Service revision 捕获镜像身份后原 tag 改变
- **THEN** 重启使用原固定身份或报告 IMAGE_UNAVAILABLE，不替换成 tag 的新内容

#### Scenario: Reject a build request
- **WHEN** 请求包含 Dockerfile 或 build context 字段
- **THEN** Core 在写入状态、预留配额和创建资源前拒绝请求

#### Scenario: 默认应用没有内存上限
- **WHEN** Service 没有提交 memoryBytes 并开始运行
- **THEN** 容器 inspect 显示 Memory=0，当前投影明确无限制，CPU/网络/身份及挂载仍按有效定义

#### Scenario: 旧定义的内存值不能恢复限制
- **WHEN** 含正数 memoryBytes 的已保留 Service 经过受管恢复或重建
- **THEN** 旧数值作为历史保留，新容器仍为 Memory=0，不要求用户逐个重写定义

### Requirement: Idempotent mutations and crash adoption

**Identifier:** WSRV-003

服务 mutation SHALL 使用幂等键，更新 SHALL 检查预期定义版本。相同键相同内容返回原结果，异内容或过期版本返回冲突；Core 恢复后 SHALL 识别已创建的匹配实例，不能因结果未保存而重复创建。

Agent 幂等 scope SHALL 在 daemon 替换后保持稳定并与用户 mutation scope 分离。每个 Operation SHALL 保留受理时定义 revision 与 Work 生命周期 fence；worker MUST NOT 静默替换为后续 desired revision，过期完成 MUST NOT 覆盖较新的 Service 结果。同 key 不同内容 SHALL 返回 IDEMPOTENCY_CONFLICT。失败后的显式 retry 使用新 key；tombstone 服务不得 retry。

内存政策升级 SHALL 保留已接受请求的原幂等 scope、指纹和结果。升级前省略内存而捕获旧默认值的相同原请求 SHALL 仍返回原 Operation，不因默认值改为零而重新创建或冲突。新请求省略内存与显式零 SHALL 使用同一默认语义；历史显式数值的不同请求不能借政策升级伪装成相同原请求。兼容读取不得放宽其他字段或跨 principal/Work 命中。

#### Scenario: Repeat a create request

- **WHEN** agent 未收到响应而用相同键重试创建
- **THEN** 系统返回同一服务和 Operation，仅存在一个对应实例和一份配额预留

#### Scenario: Crash between instance creation and result recording

- **WHEN** Core 在容器已创建但未记录完成时崩溃并重启
- **THEN** 系统接管该容器并恢复操作状态，不创建第二个服务实例

#### Scenario: Concurrent definition updates

- **WHEN** 两个更新使用相同旧 revision，而其中一个已成功
- **THEN** 后一个更新返回冲突，不能覆盖已接受的新定义

#### Scenario: A new daemon repeats a lost request
- **WHEN** 替换后的合法 daemon 以原 key 和 payload 重试
- **THEN** Core 返回原 Service/Operation，不重复预留配额

#### Scenario: Update overtakes an old worker
- **WHEN** worker B 等待 Docker 时 revision C 已被接受
- **THEN** B 不能记录 C 已应用或覆盖其失败/状态，仅匹配当前目标才能就绪

#### Scenario: 升级后重试原请求
- **WHEN** 创建请求在旧默认内存政策下已接受但响应丢失，升级后调用者以同 scope/key 和原内容重试
- **THEN** 返回原 Service/Operation 且不新增预留；其他业务字段不同仍返回幂等冲突

### Requirement: Restore enabled services with their Work

**Identifier:** WSRV-004

服务 SHALL 仅在 Work 期望 running 且定义 enabled 时运行。Work 停止 SHALL 停止其全部服务但保持 enabled；Work 再启动 SHALL 自动恢复已启用服务及持久挂载，不依赖 agent 重放历史创建调用。

Restoration SHALL inspect actual service containers on every Work start and Core recovery, including when the agent container already exists or only needs restarting. A database ready marker alone SHALL NOT prove a service is running. Missing instances SHALL be recreated from the captured image and retained workspace; matching instances SHALL be adopted without duplicates. Application services SHALL default to optional so a failed application leaves a repair-capable agent; explicitly required services retain blocking semantics.

#### Scenario: Restart a Work with application data

- **WHEN** 一个启用服务已经写入持久数据，Work 停止后再启动
- **THEN** Core 使用同一 service_id、定义版本和持久卷恢复服务，原数据可读

#### Scenario: Configure services while stopped

- **WHEN** 所有者为 stopped Work 添加或启用服务
- **THEN** 定义被保存但容器不启动，下一次显式启动 Work 时才运行

#### Scenario: Restore beside a retained stopped agent
- **WHEN** Work starts with an existing stopped agent container and an enabled stopped service
- **THEN** both become running and verified with the same service identity and persistent files

#### Scenario: Agent crashes independently
- **WHEN** agentd is replaced while an application service is healthy
- **THEN** Core adopts the service and replaces only the agent, without restarting a healthy application merely because the conversation daemon changed

### Requirement: Distinguish restart disable and removal

**Identifier:** WSRV-005

restart SHALL 只作用于已启用且 Work 正在运行的服务，不改变长期 enabled；对 stopped Work 或 disabled 服务的 restart SHALL 返回前置条件错误。disable SHALL 持久设置不启用并停止实例，enable SHALL 设置启用并按 Work 状态运行。remove SHALL 阻止未来恢复并按 work-storage 处理数据。

MCP service_start SHALL alias enable and service_stop SHALL alias disable; service_restart SHALL preserve enabled and reject stopped Works or disabled services. Remove SHALL tombstone the definition, stop/remove the runtime, and detach storage references without deleting shared workspace data. Agent-facing remove SHALL NOT offer purge_data; explicit owner storage cleanup remains separately authorized.

#### Scenario: Disable and restart the Work

- **WHEN** agent 禁用服务后用户停止并重新启动 Work
- **THEN** 服务保持 disabled 且无运行实例，其他启用服务正常恢复

#### Scenario: Remove a service and recover Core

- **WHEN** 服务被删除但清理尚未完成时 Core 重启
- **THEN** 系统继续清理该服务，不能把删除记录解释为缺失实例而重新创建

#### Scenario: Stop one service persistently
- **WHEN** the agent calls service_stop then Work is stopped and started
- **THEN** that service remains disabled while other enabled services restore

#### Scenario: Remove shared-workspace service
- **WHEN** the agent removes a service with a writable workspace mount
- **THEN** its runtime and restoration target disappear while the Work workspace and other services data remain intact

### Requirement: Apply service changes with explicit availability and history

**Identifier:** WSRV-006

更新服务 SHALL 保存新 revision、显示 desired/applied 版本，并在替换前停止旧实例，允许更新期间服务不可用。失败 SHALL 保留新错误及旧配置历史；回退配置 MUST NOT 被宣称为应用数据回滚。

Updates SHALL require expectedRevision and keep the original service name/DNS identity. They SHALL validate and reserve the new target before stopping the old instance. Failed updates retain last successful appliedRevision as historical information but SHALL report failed rather than imply that instance is currently healthy. Recovery of old configuration requires an explicit update as a new revision; workspace data is never reverted.

#### Scenario: New service image fails

- **WHEN** 更新到的新镜像无法启动
- **THEN** 服务报告新 revision 失败和未应用状态，用户可选择旧内容作为新 revision 恢复，持久数据不自动回滚

#### Scenario: Reject stale update before Docker
- **WHEN** an update supplies an outdated expectedRevision
- **THEN** Core returns REVISION_CONFLICT and creates no revision, Operation, reservation change, or replacement container

### Requirement: Enforce quotas atomically

**Identifier:** WSRV-007

系统 SHALL 在接受服务定义或 CPU 增长前原子核对最大服务数、Work 及宿主 CPU 预算，并拒绝超额请求且不创建资源。CPU 预算 SHALL 包括 Agent 和启用 Service；stopped Work 的启用定义仍保留 CPU 预算。禁用、缩容或删除 SHALL 在实际占用已释放后才能释放对应 CPU/数量预算。

应用 Service SHALL 不申请或占用 Work/宿主内存预留，也不因这些内存预算不足而被拒绝。历史 Service 内存预留及尚未清理的数值 SHALL 不进入有效内存配额计算；它们不得阻断其他 Service、Agent 配置或导入。Agent 及其他仍受内存政策管理的对象 SHALL 保持原预算检查。

CPU 核算 SHALL 对每个 Service 取 desired 预留和未释放实际占用的较大值；宿主核算 SHALL 汇总全部 Work。共享 workspace 卷每 Work 只计一次；未删除定义均计入 maxServices，确认 runtime 移除后才能释放删除对象的 slot。Work CPU 缩减低于保留预留/占用 SHALL 在配置修改前被拒绝。取消内存预算不能被解释为已停止容器或已释放 CPU。

#### Scenario: Concurrent requests exceed remaining budget

- **WHEN** 两个合法创建分别能装入剩余 CPU/数量配额但合计超额
- **THEN** 最多接受可容纳的请求，另一请求返回配额错误，不留下重复或负配额

#### Scenario: Disable has not yet stopped the container

- **WHEN** 禁用服务已接受但其容器仍运行，新请求试图使用其 CPU/数量预算
- **THEN** 系统仍计算未释放占用，直到确认停止后才允许重用预算

#### Scenario: Use default deployment headroom
- **WHEN** 全新默认 Work 创建一个请求 250 CPU milliseconds 且无内存上限的 Service
- **THEN** CPU 和数量满足配额时接受创建，不预留或检查该 Service 的内存额度

#### Scenario: Share an existing workspace
- **WHEN** 两个 Service 挂载已有 Work workspace
- **THEN** 同一个 workspace 只计一个卷 slot，不按 Service 挂载次数重复计数

#### Scenario: Host budget exhausted elsewhere
- **WHEN** 其他 Work 已占用剩余宿主 CPU 预算
- **THEN** 即使 Work 本地额度满足也原子拒绝 Service 请求，返回 QUOTA_EXCEEDED

#### Scenario: 历史 Service 内存预算不阻断部署
- **WHEN** Work 或宿主的旧 Service 内存预留看似耗尽，而 CPU、服务数和卷数仍满足准入
- **THEN** 新 Service 被接受，现有 Agent 内存政策仍有效，历史 Service 记录不被当作当前内存占用

### Requirement: Report readiness and recover failures within bounds

**Identifier:** WSRV-008

服务 SHALL 暴露 pending/starting/ready/stopped/disabled/recovering/failed/deleting 等可区分状态、期望及已应用版本、Operation 和最近错误；readiness 超时默认 120 秒且可配置。自动恢复 SHALL 遵循可查询且持久的预算，默认同 work-lifecycle 的 3 次/10 分钟规则，不因 Core 重启清零。

HTTP, TCP, and exec readiness SHALL use the selected container; running alone MUST NOT satisfy a declared probe. Default total readiness deadline is 120 seconds, configurable from 1 to 300 seconds, with individual probes bounded to at most 2 seconds or remaining time. Without a probe, readiness means process running and SHALL be reported as such. Early exit SHALL report SERVICE_EXITED and exit code; deadline expiry SHALL report SERVICE_READINESS_TIMEOUT. Reconciliation SHALL check running services at least every 2 seconds while Docker responds and persist recovery attempts (3 per 10 minutes with 1/5/15 second delays); restartPolicy never MUST NOT restart automatically. Ten continuous ready minutes reset the budget; an exhausted failed service stays exhausted until that successful interval or explicit retry, not merely until wall-clock window expiry.

#### Scenario: Container is running but not ready

- **WHEN** 容器进程存在但声明的 readiness 检查一直失败直到超时
- **THEN** 服务报告启动失败而非 ready，非必需服务故障使 Work degraded，agent 保持修复入口

#### Scenario: HTTP refuses requests
- **WHEN** the container runs but its configured HTTP readiness URL returns a non-2xx response
- **THEN** the service stays starting until success or the deadline, and never reports HTTP readiness from process state

#### Scenario: Bound repeated application crashes
- **WHEN** a service repeatedly exits across a Core restart
- **THEN** persisted recovery budget is consumed without reset; exhaustion leaves failed until explicit retry

#### Scenario: Docker becomes unavailable
- **WHEN** an inspection fails due to Docker connectivity
- **THEN** service observation becomes unknown, no replacement is launched based on guessed absence, and a dependency diagnostic is queryable

### Requirement: Lifecycle changes fence late service operations

**Identifier:** WSRV-009

Work 进入 stopping 或 deleting 后 SHALL 拒绝新的服务 mutation。已经接受的服务操作 SHALL 遵循最新 Work 期望状态，在停止过程中创建的实例必须被停止，不能把 Work 拉回 running。

The mutation gate SHALL close atomically at acceptance of Work stop/delete and at graceful Core shutdown. Acceptance validation and each side-effect completion SHALL check the Work target/fence. Shutdown MUST wait for or clean up late-created service instances before reporting success. Service queues and recovery workers SHALL drain within documented shutdown bounds; a completed older operation cannot reopen routing or restore a disabled/deleted service.

#### Scenario: Stop races with service creation

- **WHEN** 服务创建已接受但尚未完成，随后 Work 接受停止
- **THEN** 服务定义按其已接受内容保留，晚到实例被停止，旧 Operation 被标记 superseded 或停止目标下的明确结果

#### Scenario: Core shutdown races with service pull
- **WHEN** Core begins graceful shutdown while image preparation is pending
- **THEN** no new service mutation is accepted; any late instance is stopped and its Operation has a durable terminal or recoverable interrupted state

### Requirement: Provide stable Work-private service endpoints

**Identifier:** WSRV-010

Every application service SHALL join exactly its existing Work private network and expose a stable `svc-<name>` DNS alias and its declared internal ports. Core SHALL return those endpoints with service state; they are usable only when the runtime is reachable and do not imply readiness. No host port SHALL be published. Names SHALL match `[a-z][a-z0-9-]{0,47}`, be unique within a Work, and remain immutable. Two Works MAY use the same service name without sharing a network or endpoint. Endpoint alias selection SHALL NOT shadow agentd or Core.

#### Scenario: Reach HTTP from agentd
- **WHEN** demo binds 0.0.0.0:8000 and passes readiness
- **THEN** agentd in that Work can request http://svc-demo:8000 and receive the application response

#### Scenario: Reject duplicate or invalid names
- **WHEN** the caller submits an existing name or a name containing path/hostname separators
- **THEN** Core returns CONFLICT or INVALID_SERVICE_DEFINITION respectively without side effects

#### Scenario: Keep networks isolated
- **WHEN** another Work attempts to reach the demo container on its private network
- **THEN** it cannot access that service through the other Work network

### Requirement: Validate a bounded deployment request

**Identifier:** WSRV-011

部署输入 SHALL 遵守精确 schema 且编码后不超过 1 MiB。缺必填字段、未知字段、重复端口/挂载、路径穿越、NUL、非法资源数值和不支持选项 SHALL 在受理前拒绝。默认值 SHALL 在幂等比较前规范化。不得隐含 shell；脚本需要显式 shell executable 和 args。无 workspace 挂载的 Service SHALL 显式选择 workingDirectory `/`；有 grant 时默认 `/var/data/workspace` 且必须留在获准 workspace 内。本版唯一挂载 SHALL 为 `{source: "workspace", target: "/var/data/workspace", readOnly: boolean}` 且至多一次，拒绝直接 volume ID 和任意挂载别名。

| 输入 | 必需行为 |
| --- | --- |
| name | 必填，遵守 WSRV-010；tombstone 名称保留 |
| image.reference | 必填非空，至多 2048 UTF-8 bytes；无内嵌凭据或 URL scheme |
| command | 必填非空 executable，至多 4096 bytes |
| args | 默认 []，至多 128 项，每项至多 4096 bytes |
| environment | 默认 {}，至多 128 个匹配 `[A-Za-z_][A-Za-z0-9_]*` 的名称，每值至多 16384 bytes |
| secretRefs | 默认 []；非空返回 UNSUPPORTED_SERVICE_OPTION |
| workingDirectory | grant 内规范绝对路径；无 grant 时显式 `/` |
| mounts | 默认 []；零或一个支持的 workspace 挂载 |
| ports | 默认 []；至多 64 项，名称及 protocol/port 对唯一，TCP/UDP，端口 1..65535 |
| cpuMillis | 默认 250，整数 10..128000，须满足配额 |
| memoryBytes | 兼容字段；省略默认 0，非负安全整数；正数仅保留原请求/历史语义，不设置内存上限或参与配额 |
| enabled, required | 分别默认 true、false |
| readiness | 可选 HTTP/TCP/exec；deadlineMs 默认 120000、范围 1000..300000；timeoutMs 默认 2000、范围 1..2000 |
| restartPolicy | 默认 bounded；允许 bounded/never |

HTTP/TCP readiness SHALL 引用已声明的 TCP 端口；HTTP SHALL 提供规范路径并要求 2xx，exec SHALL 提供有界非空 argv 并要求退出码零。探测字段缺失或不兼容 SHALL 拒绝。更新保留原镜像引用时 SHALL 保留固定镜像身份，引用/digest 改变时 SHALL 重新解析。公开选择字段不得授权宿主挂载、特权、控制凭据或 Docker socket。

HTTP/DTO、MCP、gRPC 和快照校验 SHALL 对上述内存兼容语义保持一致。`deployment_context` SHALL 明确返回 Service 内存政策为 unlimited；旧 defaultServiceMemoryBytes 使用 0 并声明无限制含义，旧 total/availableMemoryBytes 若保留仅表示非 Service 预算，不得伪装成 Service 可用内存或实时宿主内存。

#### Scenario: Reject incomplete deployment input
- **WHEN** 请求缺镜像/executable、资源值为负数或未显式 grant 却使用 workspace 工作目录
- **THEN** Core 返回带安全字段标识的 INVALID_SERVICE_DEFINITION，不写定义、Operation 或预留

#### Scenario: Normalize defaults for retry
- **WHEN** 同 key 重试对原请求省略字段填写显式默认值
- **THEN** 与原请求规范化语义一致并返回原受理结果

#### Scenario: Validate readiness reference
- **WHEN** HTTP 探测引用不存在或仅 UDP 的端口
- **THEN** 在创建任何容器前拒绝请求

#### Scenario: Deploy an image-native service
- **WHEN** 合法 Service 无 workspace 挂载且显式使用 `/` 工作目录
- **THEN** 按声明 executable 运行，不获得持久 workspace 或 Agent 私有挂载

#### Scenario: 各入口一致理解无限制
- **WHEN** 调用者从 HTTP 或真实 MCP/gRPC 提交省略或零 memoryBytes 的合法定义
- **THEN** 请求可接受且规范默认一致，部署上下文明确 unlimited，不触发最小 16 MiB 或 64/128 MiB 补值

#### Scenario: 内存兼容字段仍需合法
- **WHEN** 请求提交负数、非整数或超过安全整数范围的 memoryBytes
- **THEN** 接受前安全拒绝，不创建 Service 或资源

### Requirement: Restore service definitions independently from source runtime state

**Identifier:** WSRV-SNAPSHOT-001

完整包 SHALL 保留 service 名称、全部 retained revision/定义、desired/applied revision、enabled/required、tombstone、已绑定镜像、持久恢复预算、每个 service 的持久 CPU/slots 预留、兼容历史内存字段及当前 workspace 卷引用；导入为每个 service 分配新 ID，映射受管依赖、预留与 workspace grant。定义中的命令、args、environment、端口和固定容器路径保持原样。workspace 当前引用即使因失败的 remove 而仍属于 tombstone service，也 SHALL 映射而不隐式解除；但引用不授权 tombstone service 启动。源 observedState/error 和旧 Operation 可保留为 provenance，但不能作为新容器 ready 的证明。未 tombstone 服务在导入 stopped Work 中 SHALL 报告 stopped 或 disabled；tombstone 仍不可列为可恢复服务且名称保留，budget exhaustion 仍阻止自动恢复，显式 retry 沿用既有语义。

Service 的持久 desired CPU 与 slots SHALL 使用包内预留值，不从 enabled、最新 definition 或源 observedState 重算；disabled 或 tombstone 不意味着其持久 CPU/slots 必为零。历史内存字段 SHALL 校验并保留为来源事实，但 SHALL 不进入导入准入、宿主汇总或后续 Service 内存限制。新 Service 的内存预留为零。导入后的实际运行占用 SHALL 从零开始，保留的字段本身 SHALL NOT 触发服务启动。

后续显式 Work start SHALL 按 enabled、required、固定镜像与恢复策略重建，不需要 agent 重新 create。历史 appliedRevision 不变，实际就绪重新检查；不发布 host port、不添加新挂载形式、不允许镜像 build/commit、不重放历史服务 mutation。服务历史控制幂等记录仅作 provenance，不能使新 owner 请求命中源 principal 的幂等 scope。

包内 active context 选择内置 `work-services` 时，导入并显式启动后 pi-agentd SHALL 经真实 MCP adapter 和目标 Core 的认证 gRPC 列出、检查、启用、禁用、重启及按现有权限创建/更新本 Work 的 service；操作对象 SHALL 是目标新 service ID，不依赖源 Core、源证书或重新部署历史服务。源 active context 未选择该 MCP 或工具策略禁止某工具时，导入 SHALL 保持该限制，不用目标默认配置补授权。

#### Scenario: Enabled and disabled services
- **WHEN** 包有 enabled web 和 disabled worker，导入后显式 start
- **THEN** 只启动 web，使用原镜像/文件/端口，worker 保持 disabled

#### Scenario: Shared storage survives import
- **WHEN** 两个服务共享 workspace，且一个曾被删除
- **THEN** 新服务引用新 Work 的同一个 workspace，已删除服务不复活，数据不被重新初始化

#### Scenario: Preserve failed retry budget
- **WHEN** 一个服务自动恢复预算已耗尽后导出导入
- **THEN** 不因导入而清零预算或自动重试，用户仍可显式 retry

#### Scenario: Disabled service retains its reservation
- **WHEN** 一个已停止 Work 中，disabled worker 的持久 desired CPU/内存预留因失败的 disable 操作仍非零
- **THEN** 导入后的 worker 仍为 disabled 且不启动；目标 Work 保留相同持久 CPU/slots 及兼容历史内存值，后者不参与有效内存配额，实际运行占用为零，再次导出仍能读到来源值

#### Scenario: Manage restored services through target Core MCP
- **WHEN** 含内置 `work-services` 的 Work 从安装 A 导出、只凭包导入安装 B 并显式启动，安装 A 不再可达
- **THEN** 安装 B 的 pi-agentd 通过真实 MCP 及目标 Core gRPC 列出恢复后的 service，并以目标 service ID 完成 stop/start 与 Operation 查询；服务定义和 workspace 数据保持原样

#### Scenario: Preserve imported tool policy
- **WHEN** 源 active context 禁止 `work-services.service_stop` 或已移除内置 MCP
- **THEN** 导入后的 pi-agentd 不得到该工具，目标默认配置不能替它重新授权

#### Scenario: 导入旧正数内存定义
- **WHEN** 含历史正数 Service 内存定义和预留的完整包导入新 Core
- **THEN** 不因这些 Service 内存值触发 QUOTA_EXCEEDED，仍按原 CPU/slots 和 Agent 内存检查；显式 Start 后 Service Memory=0，镜像、代码、数据与历史字段保留

### Requirement: 同时返回私网端点和 CLI 可访问域名

**Identifier:** WSRV-ACCESS-001

Core HTTP 与 Work agent gRPC 的 service list/show SHALL 对未删除服务返回相同 `access` 投影，同时保留既有 `endpoints` 的 `svc-<name>` 私网语义。服务无 TCP 端口、disabled、failed 或 Work stopped 时，仍 SHALL 返回稳定域名与准确状态；Core 未经授权不得披露该域名或完整服务定义。默认域名由 Core 内独立解析接口产生，后续策略可以扩展而不改变 service 身份；首版不接受外部自定义域名参数。

#### Scenario: 同一服务的两种地址
- **WHEN** 所有者和本 Work agent 分别查询已部署 HTTP 服务
- **THEN** 都得到相同的 access.hostname 与原 `svc-<name>` 私网端点，且访问状态与 service 当前状态一致

#### Scenario: 禁用后查询
- **WHEN** service 被禁用但定义保留
- **THEN** list/show 仍返回原域名和 `unavailable`，不暗示已发布宿主端口


### Requirement: Go Service MCP 的工具与安全投影

**Identifier:** WSRV-MCP-001

内置 Service MCP SHALL 作为 Agent 管理的原生 stdio 子进程交付，不接受任意 Work/Docker/宿主路径/证书参数。保留 deployment_context、service_create/list/get/update/start/stop/restart/remove/retry、operation_get、service_logs 共 12 工具及 work-services namespace / 原策略过滤，不能因换实现增加权限。

工具 schema SHALL 保留省略默认与显式 null/false/空集合差异、UTF-16 字符限额及严格未知字段拒绝。mutation 要求 idempotencyKey，返回持久接受结果不等待 readiness；读/写/logs 期限分别 5/10/2 秒，丢响应不新 key 自动重提。uint64 规范 JSON 为十进制字符串，text/structuredContent 一致，错误只安全分类不透出内部诊断。

配置 SHALL 只读固定 service-control JSON/PEM，拒绝重复 key、不安全整数、链接及超过 1 MiB 的非普通配置，验证安装 CA、完整双向角色和当前代次。stdout 仅 MCP，初始化失败固定安全 JSON；stdio 关闭/SIGINT/SIGTERM 取消 RPC 并关闭连接，不取消 Core 已接受的 Operation。应用 Service 内存明确 unlimited；当前默认 Web 环境沿有效 NiceGUI Spec，不复活旧 FastAPI/React 默认。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
make build-go
go test -mod=readonly ./internal/servicemcp ./internal/internaltls
go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run TestRealTSMCPClientNativeStdioAndCoreMutualTLS
```

### Requirement: 以稳定可读名称管理当前安装的服务容器

**Identifier:** WSRV-ACCESS-002

新建或替换的 service Docker 容器 SHALL 使用 `<work-network-name>_<service-name>` 作为名称。系统 SHALL 先按当前安装中持久保存的 installation/Work/kind/service 身份及所需运行配置核验容器；同一受支持安装在异常退出后已有的匹配容器 SHALL 被接管，不能只因尚未记录创建结果而重建。容器名称本身不构成所有权证明。本次 Go 原生交付不要求从旧 TS 安装升级或接管其哈希名称容器。

目标名称已被不匹配资源占用 SHALL 报冲突，不删除或接管它。现有 Work 专用网络、`svc-<name>` 别名与不发布宿主端口的要求继续有效。

#### Scenario: 新容器的名称
- **WHEN** `notes` 首次运行于网络标识为 `w-a1b2c3d4` 的 Work
- **THEN** Docker 中只有一个匹配 service 身份的 `w-a1b2c3d4_notes` 容器，且无宿主端口发布

#### Scenario: 崩溃后接管当前安装容器
- **WHEN** Go Core 在创建服务容器后、保存完成结果前异常退出，随后以同一安装重新启动
- **THEN** Core 核验完整受管身份后接管原实例，保留服务身份和数据，不创建第二个实例

#### Scenario: 名称被异物占用
- **WHEN** 目标 Docker 名称已由其他 installation、旧 TS 安装或非受管容器占用
- **THEN** 服务启动报告冲突，不误接管或删除该容器

### Requirement: 临时服务具有可信 Run 归属和一次性执行结果

**Identifier:** WSRV-TEMP-001

系统 SHALL 提供经能力协商的显式 Run 临时 Service 模式，受现有 Work 授权、配额、镜像和挂载限制。省略临时模式的既有请求 SHALL 保持普通持久 Service 语义；旧或不支持的端点 SHALL 明确拒绝临时模式，不静默创建常驻服务。临时服务归属 SHALL 由可信当前 Agent 执行上下文绑定 Work、Run 和运行代次，调用者不能通过模型参数伪造其他 Run 或 Work。

对外确认创建受理前 SHALL 持久记录归属、服务身份、原创建 Operation、幂等内容及待清理目标；响应丢失时同键同内容返回原结果，异内容冲突，不重复创建。仅显式一次性执行模式以已确认的进程退出表示该命令完成：退出码 0 是成功结果，非 0 是失败结果，未知退出码保持未知；临时短时监听模式使用其实际 readiness。一次性执行不得因重启、丢失结果、退出或恢复自动重放已运行或结果未知的命令。

临时对象的失败/完成/清理状态 SHALL 可单独观察，不作为普通常驻 Service 失败使 Work 降级；普通持续服务无论退出码是否为 0，提前退出继续遵守既有失败与恢复语义。临时命令输出 SHALL 按所属 Work 的内容权限、有界读取及精确实例归属返回，不混入安全诊断。调用者读取或清理失败时如实表示状态。

#### Scenario: 一次性探测正常结束
- **WHEN** 已受理的临时一次性探测进程以退出码 0 结束
- **THEN** 该探测报告完成及实际退出码，调用者可读取其受权有界结果；Work 不因它退出而 Degraded，随后按临时生命周期收尾

#### Scenario: 一次性命令退出非零
- **WHEN** 一次性探测以非零退出码结束
- **THEN** 结果明确失败并保存实际退出码与安全方向，自动收尾仍执行，系统不自动再次运行原命令

#### Scenario: 创建响应丢失
- **WHEN** 临时创建已持久受理但 Agent 未收到响应，以原键和内容查询或重放
- **THEN** 找到同一个 Service 与创建 Operation，不增加临时实例或配额占用

#### Scenario: 伪造归属或旧端点
- **WHEN** 模型试图提供其他 Run 的归属，或旧端点不支持临时模式
- **THEN** 请求被安全拒绝，不创建普通持久 Service 或跨 Work 临时资源

### Requirement: 临时服务在 Run 结束和故障后可靠收尾

**Identifier:** WSRV-TEMP-002

系统 SHALL 在临时 Service 所属 Run 正常结束、失败、取消或所属 Agent 已确认中断/代次失效后，自动持久受理幂等清理，停止并移除该精确受管实例和恢复目标。清理与创建许可 SHALL 原子排序，已结束 Run 不能再创建临时服务；已接受创建的迟到资源 SHALL 受清理栅栏约束并确认收尾后才报告完成。

归属、清理目标、结果和可重试状态 SHALL 跨 Agent/Core 重启保留；通知丢失时 SHALL 按已记录 Run 和代次恢复核对。仍存活的原 Run 不得仅因 Core 重启而被判中断；运行状态未知时保持未确认并重试，不猜测死亡、重复执行或清理不明归属资源。Docker/存储不可用时 SHALL 说明失败或待确认，依赖恢复后自动重试；只有确认实例及迟到创建已收尾后才释放配额并报告成功。清理 SHALL 保留共享 workspace 和其他 Service，且不得按名称或退出码清理旧普通服务。

#### Scenario: Agent 崩溃后自动收尾
- **WHEN** 运行临时服务的 Agent 确认崩溃且不会再持有其 Run
- **THEN** Core 根据已持久的确切归属清理该服务，保持普通服务及 workspace，重启不重复原命令

#### Scenario: 创建与取消竞争
- **WHEN** 临时服务创建已受理但容器尚未出现，随后 Run 被取消
- **THEN** 不接受该 Run 的新临时创建，迟到实例被停止移除；在全部收尾确认前不显示清理成功

#### Scenario: Docker 暂时不可达
- **WHEN** 清理时 Docker 无法确认原实例状态，随后连接恢复
- **THEN** 清理显示未确认及安全原因，关联日志可查，恢复后自动重试并确认完成，不错误释放占用

#### Scenario: Core 重启时 Run 仍活动
- **WHEN** Core 异常重启但原 Agent 和对应 Run 经核验仍在执行
- **THEN** 原临时对象继续归该 Run 管理，Core 不因自身重启擅自清理或重新运行它

### Requirement: 常驻服务异常退出具有当前安全诊断

**Identifier:** WSRV-EXIT-DIAG-001

系统 SHALL 在常驻 Service 就绪前或运行后确认退出时，记录并公开该 Service 的安全原因、实际阶段、已知退出码和处理方向；退出码 0 SHALL 保留且不得被解释成持续服务健康。容器缺失、Docker 不可达及状态未确认 SHALL 分别反映已知事实，不伪造退出码或声称进程退出。

自动恢复期间 SHALL 保留触发恢复的原因并展示当前恢复状态；就绪确认、成功禁用或移除后 SHALL 清除已解决的当前故障投影。多服务按各自状态汇总；已有 Operation 历史和原成功创建结果不因后续退出被改写。

#### Scenario: 就绪后退出
- **WHEN** 可选常驻 Service 已 ready 后以退出码 0 或非零退出
- **THEN** Service 显示运行后退出及实际退出码，Work 按现有可选服务规则 Degraded，其他可用 Service 与 Agent 保持可用

#### Scenario: 状态未知
- **WHEN** Docker 不可达或绑定实例已经不存在
- **THEN** 分别报告依赖不可达或实例缺失，不伪造退出码或把历史成功当作当前 ready

#### Scenario: 一个故障解决但另一个仍存在
- **WHEN** 两个可选常驻服务失败，其中一个已恢复或停用
- **THEN** 已解决对象不再显示当前故障，另一个仍有原因和处理入口，Work 保持 Degraded；全部处理后才恢复 Ready
