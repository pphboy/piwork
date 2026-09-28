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

接受的服务定义 SHALL 持久保存 Work 内唯一身份/名称、版本、镜像引用、启动参数、配置引用、挂载、内部端口、资源限制、enabled 和恢复/readiness 策略。定义及 Operation SHALL 在对外承诺接受和创建运行实例前持久化；镜像首次解析成功后 SHALL 在创建实例前持久绑定固定制品身份，同 revision 后续使用该身份。停止后定义 SHALL 仍能查询。

Deployment SHALL accept an existing local or registry image reference, an explicit executable and argument array, environment, a working directory within the Work workspace, an explicit read-only/read-write workspace mount, named internal ports, CPU/memory limits, enabled/required flags, restart policy, and optional readiness. First-version deployment SHALL reject build context, Dockerfile, image commit/build, privileged settings, host ports/networks, arbitrary host mounts, and nonempty unsupported secret references with a field-specific error before acceptance. Newly resolved immutable image identity SHALL be persisted before container creation; retries of that revision MUST NOT follow a changed tag. Definition immutability covers the image and startup configuration, not mutable workspace files or application data.

#### Scenario: Definition survives agent loss

- **WHEN** Core 接受定义后 agent 崩溃
- **THEN** 定义和 Operation 仍存在，Core 可以完成或报告失败，无需 agent 重复声明

#### Scenario: Image resolution fails

- **WHEN** 定义已接受但镜像无法拉取或解析
- **THEN** 服务保留 failed 状态及原因，不能报告 ready，修复后可显式 retry

#### Scenario: Deploy existing Python image
- **WHEN** the agent selects an available Python image and workspace server.py
- **THEN** Core starts that image with the declared command and workspace; it performs no image build or commit

#### Scenario: Retag after deployment
- **WHEN** a tag changes after a service revision captured its image identity
- **THEN** restart uses the captured identity or reports IMAGE_UNAVAILABLE without substituting the changed tag

#### Scenario: Reject a build request
- **WHEN** a request includes Dockerfile or build context fields
- **THEN** Core rejects it before writing service state, reserving quota, or creating resources

### Requirement: Idempotent mutations and crash adoption

**Identifier:** WSRV-003

服务 mutation SHALL 使用幂等键，更新 SHALL 检查预期定义版本。相同键相同内容返回原结果，异内容或过期版本返回冲突；Core 恢复后 SHALL 识别已创建的匹配实例，不能因结果未保存而重复创建。

Agent idempotency scope SHALL be stable across replacement of its daemon and distinct from user mutation scope. Each Operation SHALL retain its accepted definition revision and Work lifecycle fence. Workers MUST NOT silently substitute a later desired revision, and stale completion MUST NOT overwrite a newer service result. Reusing a key with different content SHALL return IDEMPOTENCY_CONFLICT. New keys permit explicit retry after failure; tombstoned services cannot be retried.

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
- **WHEN** the replacement valid daemon repeats the original key and payload
- **THEN** Core returns the original service and Operation and does not reserve quota twice

#### Scenario: Update overtakes an old worker
- **WHEN** revision C is accepted while worker B awaits Docker
- **THEN** B cannot record C as applied or overwrite C failure/status; only a matching current target may become ready

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

系统 SHALL 在接受服务定义或资源增长前核对最大服务数、Work 及宿主 CPU/内存预算，并拒绝超额请求且不创建资源。预算 SHALL 包括 agent 和启用服务；stopped Work 的启用定义仍保留预算。禁用、缩容或删除 SHALL 在实际占用已释放后才能释放对应预算。

CPU and memory accounting SHALL include the explicitly allocated agent resources plus, for each service, the greater of desired reservation and not-yet-released actual occupation. Host accounting SHALL sum every Work, not compare one Work alone with the host limit. Existing shared volume identities SHALL count once per Work, independent of mount count. All nondeleted definitions SHALL count toward maxServices; deleting frees that slot only after confirmed runtime removal. Work budget reductions below retained reservations or actual occupation SHALL be rejected before changing configuration.

#### Scenario: Concurrent requests exceed remaining budget

- **WHEN** 两个合法创建分别能装入剩余配额但合计超额
- **THEN** 最多接受可容纳的请求，另一请求返回配额错误，不留下重复或负配额

#### Scenario: Disable has not yet stopped the container

- **WHEN** 禁用服务已接受但其容器仍运行，新请求试图使用其预算
- **THEN** 系统仍计算未释放占用，直到确认停止后才允许重用预算

#### Scenario: Use default deployment headroom
- **WHEN** a fresh default Work creates a service requesting 250 CPU milliseconds and 128 MiB memory
- **THEN** its agent and service fit the default total budget and creation is accepted

#### Scenario: Share an existing workspace
- **WHEN** two services mount the existing Work workspace
- **THEN** the workspace consumes one volume slot, not one per service mount

#### Scenario: Host budget exhausted elsewhere
- **WHEN** another Work consumes the remaining host CPU budget
- **THEN** an otherwise Work-local valid service request is rejected atomically with QUOTA_EXCEEDED

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

Deployment inputs SHALL have an exact schema and at most 1 MiB encoded request size. Missing required fields, unknown fields, duplicate ports/mounts, traversal, NUL, invalid limits and unsupported options SHALL be rejected before acceptance. Defaults SHALL be normalized before idempotency comparison. No shell SHALL be implied: shell scripts require an explicit shell executable and args. A service with no workspace mount SHALL explicitly select workingDirectory `/`; otherwise workingDirectory defaults to `/var/data/workspace` and SHALL remain within that granted workspace. The sole supported mount in this version SHALL be `{source: "workspace", target: "/var/data/workspace", readOnly: boolean}` and SHALL appear at most once. Direct volume-ID mounts and arbitrary aliases SHALL be rejected.

| Input | Required behavior |
| --- | --- |
| name | required, WSRV-010 name rules; tombstoned names stay reserved |
| image.reference | required, nonempty, at most 2048 UTF-8 bytes; no embedded credentials or URL schemes |
| command | required nonempty executable, at most 4096 bytes |
| args | default [], at most 128 strings of 4096 bytes each |
| environment | default {}, at most 128 names matching `[A-Za-z_][A-Za-z0-9_]*`, values at most 16384 bytes |
| secretRefs | default []; nonempty returns UNSUPPORTED_SERVICE_OPTION |
| workingDirectory | normalized absolute path under granted workspace, or explicit `/` without grant |
| mounts | default []; zero or one supported workspace mount |
| ports | default []; at most 64 unique names and protocol/port pairs, TCP or UDP, ports 1..65535 |
| cpuMillis | default 250, integer 10..128000 within quota |
| memoryBytes | default 134217728, integer >=16777216 within quota |
| enabled, required | default true, false respectively |
| readiness | optional HTTP/TCP/exec; deadlineMs default120000 range1000..300000, timeoutMs default2000 range1..2000 |
| restartPolicy | default bounded; bounded or never |

HTTP/TCP readiness SHALL reference a declared TCP port, HTTP SHALL include a normalized path and require a 2xx response, and exec SHALL include a bounded nonempty argv and require exit code zero. Missing or incompatible probe fields SHALL be invalid. An update retaining its image reference SHALL retain the captured image identity; a different reference/digest SHALL require new resolution. Public selection fields SHALL never authorize a host mount, privileged runtime, control credential, or Docker socket.

#### Scenario: Reject incomplete deployment input
- **WHEN** a request omits image or executable, contains a negative resource limit, or names a workspace cwd without an explicit grant
- **THEN** Core returns INVALID_SERVICE_DEFINITION with a safe field identity and writes no definition, Operation or reservation

#### Scenario: Normalize defaults for retry
- **WHEN** a retry with the same key supplies explicit default values for fields omitted by the original request
- **THEN** it matches the normalized original input and returns the same acceptance

#### Scenario: Validate readiness reference
- **WHEN** an HTTP probe references a missing or UDP-only port
- **THEN** the request is rejected before any container is created

#### Scenario: Deploy an image-native service
- **WHEN** a valid service explicitly uses `/` as cwd with no workspace mount
- **THEN** it runs its declared executable without persistent workspace access or any private agent mount

### Requirement: Restore service definitions independently from source runtime state

**Identifier:** WSRV-SNAPSHOT-001

完整包 SHALL 保留 service 名称、全部 retained revision/定义、desired/applied revision、enabled/required、tombstone、已绑定镜像、持久恢复预算、每个 service 的持久资源预留及当前 workspace 卷引用；导入为每个 service 分配新 ID，映射受管依赖、预留与 workspace grant。定义中的命令、args、environment、端口和固定容器路径保持原样。workspace 当前引用即使因失败的 remove 而仍属于 tombstone service，也 SHALL 映射而不隐式解除；但引用不授权 tombstone service 启动。源 observedState/error 和旧 Operation 可保留为 provenance，但不能作为新容器 ready 的证明。未 tombstone 服务在导入 stopped Work 中 SHALL 报告 stopped 或 disabled；tombstone 仍不可列为可恢复服务且名称保留，budget exhaustion 仍阻止自动恢复，显式 retry 沿用既有语义。

service 的持久 desired CPU/内存与 slots SHALL 使用包内预留值，不从 enabled、最新 definition 或源 observedState 重算；disabled 或 tombstone 不意味着其持久预算必为零。导入后的实际运行占用 SHALL 从零开始，且保留预算本身 SHALL NOT 触发服务启动。

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
- **THEN** 导入后的 worker 仍为 disabled 且不启动；目标 Work 记录相同的持久 desired 预留，实际运行占用为零，再次导出仍能读到该预留

#### Scenario: Manage restored services through target Core MCP
- **WHEN** 含内置 `work-services` 的 Work 从安装 A 导出、只凭包导入安装 B 并显式启动，安装 A 不再可达
- **THEN** 安装 B 的 pi-agentd 通过真实 MCP 及目标 Core gRPC 列出恢复后的 service，并以目标 service ID 完成 stop/start 与 Operation 查询；服务定义和 workspace 数据保持原样

#### Scenario: Preserve imported tool policy
- **WHEN** 源 active context 禁止 `work-services.service_stop` 或已移除内置 MCP
- **THEN** 导入后的 pi-agentd 不得到该工具，目标默认配置不能替它重新授权

### Requirement: 同时返回私网端点和 CLI 可访问域名

**Identifier:** WSRV-ACCESS-001

Core HTTP 与 Work agent gRPC 的 service list/show SHALL 对未删除服务返回相同 `access` 投影，同时保留既有 `endpoints` 的 `svc-<name>` 私网语义。服务无 TCP 端口、disabled、failed 或 Work stopped 时，仍 SHALL 返回稳定域名与准确状态；Core 未经授权不得披露该域名或完整服务定义。默认域名由 Core 内独立解析接口产生，后续策略可以扩展而不改变 service 身份；首版不接受外部自定义域名参数。

#### Scenario: 同一服务的两种地址
- **WHEN** 所有者和本 Work agent 分别查询已部署 HTTP 服务
- **THEN** 都得到相同的 access.hostname 与原 `svc-<name>` 私网端点，且访问状态与 service 当前状态一致

#### Scenario: 禁用后查询
- **WHEN** service 被禁用但定义保留
- **THEN** list/show 仍返回原域名和 `unavailable`，不暗示已发布宿主端口

### Requirement: 新服务容器使用稳定可读名称

**Identifier:** WSRV-ACCESS-002

新建或替换的 service Docker 容器 SHALL 使用 `<work-network-name>_<service-name>` 作为名称。系统 SHALL 先按受管 installation/Work/kind/service labels 查找和核验，旧版本已经存在的匹配容器 SHALL 原名接管，不能为了显示名而重建。目标名称已被不匹配资源占用 SHALL 报冲突，不删除或接管它。现有 Work 专用网络、`svc-<name>` 别名与不发布宿主端口的要求继续有效。

#### Scenario: 新容器的名称
- **WHEN** `notes` 首次运行于网络标识为 `w-a1b2c3d4` 的 Work
- **THEN** Docker 中只有一个匹配 service 身份的 `w-a1b2c3d4_notes` 容器，且无宿主端口发布

#### Scenario: 升级后接管旧容器
- **WHEN** Core 升级时 service 仍运行在旧哈希名称容器中
- **THEN** Core 按 labels 接管它，保持原名和运行状态；以后正常替换才使用新名称

#### Scenario: 名称被异物占用
- **WHEN** 目标 Docker 名称已由其他 installation 或非受管容器占用
- **THEN** 服务启动报告冲突，不误接管或删除该容器
