# Work Lifecycle Specification

## Purpose

定义 Work 作为持久运行单元的创建、查询、启动、停止、删除和故障恢复契约，使用户能够跟踪异步操作，并在客户端、控制服务或容器中断后获得一致的状态，避免重复实例和停止后误恢复。

## Requirements

### Requirement: Durable asynchronous Work operations

系统 SHALL 通过 CLI 和受保护 API 接受 Work 创建、启动、停止、重试与删除，提供 Console 状态和控制入口。接受的 mutation SHALL 返回稳定 Work ID 和可查询 Operation，持久保留期望状态、步骤结果和失败原因；资源完成前 MUST NOT 报告就绪。

#### Scenario: Create and observe

- **WHEN** 已登录用户提交有效 Work 创建配置
- **THEN** 系统返回 Work ID 和 Operation ID，用户能观察准备、启动以及成功或具体失败结果

### Requirement: Idempotent and ordered lifecycle mutations

系统 SHALL 对 mutation 接受幂等键，同主体、同操作和同键的相同请求返回原结果，不同内容返回冲突；Work 内相互冲突的操作 SHALL 按持久版本排序，最新接受的期望状态取代旧目标并使旧 Operation 可观察地 superseded。

#### Scenario: Lost creation response

- **WHEN** 创建响应丢失后用户用相同键和内容重试
- **THEN** 系统返回同一 Work 和 Operation，不额外创建 Work 或 daemon

#### Scenario: Stop while starting

- **WHEN** Work 启动尚未完成时接受停止请求
- **THEN** 系统以停止为最新目标，收尾已创建资源，旧启动操作不能覆盖停止目标

### Requirement: Work readiness and partial service failure

Work SHALL 在有效 daemon 完成配置加载、历史恢复和必要初始化后开放对话；附属可选服务失败但 agent 可用时 SHALL 报告 degraded 和逐服务错误。单 Work MUST NOT 存在两个有效主 daemon。

#### Scenario: Optional service fails

- **WHEN** agent 初始化成功但一个非必需服务启动失败
- **THEN** Work 显示 degraded，用户仍可连接 agent 查询和修复该服务

#### Scenario: Required initialization fails

- **WHEN** 必需 Skill、MCP 或兼容运行环境初始化失败
- **THEN** Work 不报告 ready，返回对应诊断且不接受 Run

### Requirement: Stop the complete Work without losing data

**Identifier:** WLIFE-SERVICE-001

停止 Work SHALL 先拒绝新 Run 和服务 mutation，再进行有界 drain、取消、进程回收和容器停止，覆盖 daemon、本地 MCP 和附属服务；配置及数据保留遵循 work-storage。默认 drain 30 秒，随后终止确认期限 10 秒，均可配置；未确认停止 MUST NOT 报告 stopped。

Service shutdown SHALL occur even when the daemon container is absent, already stopped, failed readiness, or unreachable. A drain failure SHALL be recorded but MUST NOT skip attempts to stop other managed containers. All known and in-flight owned service instances SHALL be reconciled to stopped before Work reports stopped. A failed Docker stop or unresolved late creation SHALL retain an incomplete/failed Operation and explicit unknown state, not a false stopped result.

#### Scenario: Stop an active Work

- **WHEN** 用户停止具有活动 Run 和两个附属服务的 Work
- **THEN** 新提交被拒绝，所有受管进程和容器最终停止，配置与数据仍在

#### Scenario: Runtime cannot confirm shutdown

- **WHEN** 停止期限已过且容器运行时无法确认实例状态
- **THEN** Operation 保持未完成并报告依赖不可用或状态未知，不返回停止成功

#### Scenario: Stop orphaned application containers
- **WHEN** agentd has exited but two Work service containers remain running when stop is accepted
- **THEN** Core stops and verifies both services and retains their enabled definitions and files

#### Scenario: Drain fails during stop
- **WHEN** agentd cannot respond to drain
- **THEN** Core still attempts to stop all application containers and agentd and reports any unresolved shutdown failure

### Requirement: Recover desired state and adopt existing instances

**Identifier:** WLIFE-SERVICE-002

系统 SHALL 在 Core 或宿主机重启后按持久期望状态核对资源、接管匹配实例、继续未完成 Operation，并在启动新主 daemon 前确认旧实例停止。Core 优雅退出 SHALL 停止其受管 Work 容器并保留期望状态；未知归属资源 MUST NOT 被自动删除。

Graceful Core shutdown SHALL close user and runtime mutation admission, drain Work execution, stop application services and agentd, and confirm results before successful exit. It SHALL preserve desired lifecycle state, service enabled flags, definitions and persistent files. Same-version Core startup SHALL restore Works whose desired state is running and their enabled services, including service reconciliation when an agent container already exists. Abrupt Core loss SHALL leave durable intent for adoption/recovery and MUST NOT be represented as confirmed graceful stop. Unknown resources remain untouched. With the default 30-second drain and 10-second termination budgets, graceful Core shutdown SHALL have a 45-second process bound across concurrent Work stops. Exceeding it SHALL produce a nonzero exit and incomplete-shutdown diagnostics rather than a clean exit.

#### Scenario: Core restarts after container creation

- **WHEN** Core 在创建容器之后、记录结果之前崩溃并重启
- **THEN** 系统识别并接管已有实例，继续原 Operation，不创建重复容器

#### Scenario: Host restarts with running and stopped Works

- **WHEN** 宿主机重启前 Work A 期望 running、Work B 期望 stopped
- **THEN** A 被恢复，B 保持停止，二者持久身份不变

#### Scenario: Old daemon is unresponsive

- **WHEN** daemon 失联且无法确认其已退出
- **THEN** 系统关闭其路由并报告恢复阻塞，不启动第二个主写入者

#### Scenario: Graceful Core restart restores deployment
- **WHEN** Core receives SIGTERM with one running Work and one deliberately stopped Work
- **THEN** running containers are confirmed stopped before clean exit; after Core restart only the desired-running Work and its enabled services restore

#### Scenario: Recover an existing daemon with absent services
- **WHEN** Core adopts a valid agent container but an enabled application container is missing
- **THEN** Core reconciles the service from its durable definition and retained storage without asking the agent to redeploy

### Requirement: Bounded recovery and explicit deletion

自动恢复 SHALL 使用可查询且跨 Core 重启保留的预算，默认 10 分钟内最多 3 次、退避 1/5/15 秒，连续 ready 10 分钟才重置；耗尽后返回失败并提供显式 retry。删除 SHALL 先收尾实例再完成，默认保留数据，显式清理由 work-storage 规定。

#### Scenario: Repeated crash and Core restart

- **WHEN** daemon 持续崩溃直至预算耗尽，期间 Core 重启一次
- **THEN** 重启不清空计数，Work 停止自动恢复并报告失败，用户可显式 retry

#### Scenario: Deletion interrupted

- **WHEN** 删除 Work 的过程中 Core 重启
- **THEN** 系统继续原清理 Operation，资源确认移除前不报告 deleted，不重新启动该 Work

### Requirement: Fence all Work mutations during a cold snapshot

**Identifier:** WLIFE-SNAPSHOT-001

export 锁 SHALL 与其 Operation 持久关联，独占当前 Work 的 start/stop/retry/delete、配置 set/apply、服务 mutation、Session/Run mutation、存储清理以及自动恢复写入。授权和幂等 replay 检查后，新冲突 mutation SHALL 返回 409 WORK_SNAPSHOT_BUSY 而不排队或 supersede 快照；查询可继续。快照接受和其他 mutation 接受必须原子互斥：先提交的一方获准，另一方冲突。export 终结且全部 helper 已退出后释放锁；异常重启先收尾快照再开放正常恢复。管理员控制操作也不得绕过该门禁。

import 任务 SHALL 不被普通 Work 恢复、service reconciliation 或 context 孤儿清理误处理；发布后保持 stopped 且只在显式 start 后开放运行。导入不创建运行容器、网络或 TLS 文件；首次显式 start 走既有准备/启动路径，建立新的运行代次、网络和证书，不复用源代次或证书。源 agent 旧代次的恢复计数不移植到新代次；service 级恢复预算按 WSRV-SNAPSHOT-001 保留。普通非快照生命周期顺序与停止语义保持不变。

Pi package install/update Operation SHALL 属于冷快照的非终态控制任务检查；package upload、enable/disable/remove、desired package publish 和 artifact GC SHALL 遵守同一 Work snapshot 栅栏。export 与 package mutation 的接受/提交不得跨过彼此门禁；现有 idempotent replay 仍先于新 mutation 判定。非快照期间 package job 的 start/apply/stop/delete 顺序 SHALL 按 PKG-007 执行。导入包的 Operation 历史仅作历史保留，不重放安装脚本或旧 package 更新。

#### Scenario: Start competes with export
- **WHEN** start 与 export 并发提交
- **THEN** 仅先通过原子门禁的一方被接受，不能边写 workspace 边成功导出

#### Scenario: Administrator tries an edit during export
- **WHEN** 非所有者管理员有控制权限但 Work 正持有快照锁
- **THEN** 其配置/服务/delete 操作也返回 WORK_SNAPSHOT_BUSY，内容仍不向其开放

#### Scenario: Restore imported active context
- **WHEN** import 发布了 stopped Work 且 Core 重启
- **THEN** 不自动启动或创建运行网络/证书；显式 start 生成新身份并按 WCFG-SNAPSHOT-001 选择 context

#### Scenario: Cleanup has not stopped a helper
- **WHEN** export 失败但受信存储 helper 尚不能确认退出
- **THEN** gate 保留且诊断显示 cleanup-pending，不放行会与它竞争的 Work 写入

#### Scenario: Export during package preparation
- **WHEN** stopped Work 有 pending/running package install/update
- **THEN** export 返回 WORK_BUSY，不捕获尚未提交的半包

#### Scenario: Package edit during export
- **WHEN** Work 已持有 export 锁，发生包安装/上传/enable/remove 或准备结果 publish
- **THEN** 新写入被拒绝或被已有原子栅栏阻止，快照中所有包与 context 绑定一致

#### Scenario: Stop fences a package operation
- **WHEN** stop 在包准备结束前被接受
- **THEN** stop 推进其生命周期目标，旧任务 superseded 且不能迟到提交或重新开启路由

### Requirement: 将文件任务纳入 Work 状态切换与停止证明

**Identifier:** WLIFE-FILES-001

系统 SHALL 在接受stop/delete目标或开始apply实例切换时关闭该Work的新文件请求及提交许可；仅保存desired配置不提前停止当前文件能力。关闭动作 SHALL 与文件请求接受/提交授权原子排序。此前已经获准提交的任务可在有界收尾内完成，未获准的上传必须取消，不得跨停止完成或新运行实例继续提交。

停止收尾 SHALL 覆盖所有已知、启动中、取消中、迟到创建和只读文件执行资源，并与现有agent/service停止并行协调；必须确认执行资源退出及平台暂存清理，才能报告stopped/deleted或完成新实例切换。某文件资源失败不能跳过停止agent/service的尝试；无法确认退出时保持未完成/失败和可查询诊断，不报告虚假成功。文件收尾 SHALL 并入现有默认30秒drain、10秒终止确认和45秒Core退出总预算，不逐任务累加无限等待。

#### Scenario: 上传过程中停止Work
- **WHEN** stop在上传尚未取得提交许可时被接受
- **THEN** 新文件请求被拒绝，上传取消，暂存和辅助容器收尾后才显示stopped，旧文件保持完整

#### Scenario: 已许可提交与停止竞争
- **WHEN** 提交许可先于stop被接受
- **THEN** 请求可以在收尾期限内完成，停止结果等待其完成/取消证明，stopped之后不再产生迟到写入

#### Scenario: apply切换而普通配置保存不切换
- **WHEN** 用户先保存desired配置，再显式apply
- **THEN** 保存阶段文件访问继续针对当前Work；apply切换阶段关闭并收尾旧文件任务，之后新请求重新核验当前状态

#### Scenario: helper不可停止而agent可停止
- **WHEN** helper退出无法确认但agent/service能够停止
- **THEN** Core仍尝试停止agent/service，Work操作报告未完成/失败，文件访问和export不因数据库状态而绕过残留写入者

### Requirement: 恢复文件资源时不重放用户写入

**Identifier:** WLIFE-FILES-002

Core SHALL 在创建文件执行资源前持久记录归属，并在正常完成后确认回收；HTTP断开或Docker调用超时不等于容器退出。Core重启 SHALL 在该Work恢复文件访问、普通实例恢复或执行冷快照前处理旧任务：失效旧提交权限、确认旧helper退出、清理有确切归属的暂存；不得重放PUT/COPY/MOVE/DELETE。迟到资源 SHALL 继续按已记录归属核对，未知归属资源不得自动删除。

Core优雅退出 SHALL 关闭全局文件准入并按既有总预算收尾，未确认完成以非零退出和恢复记录报告。某Work的cleanup-pending SHALL 阻止该Work的文件访问、实例切换及冷快照，不全局禁用其他Work或service能力。文件任务记录属于Core运行状态，不能成为用户service、Work历史动作或portable配置。仅停止proxy SHALL 取消其连接，不改变Work期望状态。

#### Scenario: Core在写入准备阶段崩溃
- **WHEN** 暂存已创建但Core在提交许可前退出
- **THEN** 重启先收尾旧容器与暂存，不重放上传，目标保持原内容，然后才开放后续访问

#### Scenario: Core在提交后崩溃
- **WHEN** 文件已完成提交但Core未记录HTTP完成
- **THEN** 恢复保留实际完整文件，仅收尾平台资源，不再次执行写操作

#### Scenario: 迟到创建与未知容器
- **WHEN** Docker创建超时后出现本任务容器，同时存在名字相似但归属不符的容器
- **THEN** Core回收可证明属于旧任务的资源，保留未知资源并报告问题，不做全局名称匹配删除

#### Scenario: 关闭本地proxy
- **WHEN** 用户Ctrl+C终止统一proxy
- **THEN** 本地连接关闭、对应文件请求取消并由Core收尾，Work继续保持原期望运行状态

### Requirement: 默认 Work 创建及启动性能可重复验收

**Identifier:** WLIFE-LATENCY-001

系统 SHALL 在固定参考验收环境中，对 Core 已 ready 且默认镜像 / 所需包环境已预热、默认脑包、默认资源限制、内置本地 MCP、无外部慢依赖和无其他并发压力的创建流程执行端到端性能验收。每组 SHALL 至少记录 20 个成功样本、全部失败样本、环境条件和 P50 / P95；成功样本 SHALL 不通过丢弃慢请求或重复提交取得。

参考验收目标 SHALL 为：从创建 HTTP 请求进入到接受响应完成的 P95 不超过 1 秒；从持久受理到后端真实激活 Ready 的 P95 不超过 3 秒；实际 Desktop 点击创建到列表及面板完成可用状态确认的全过程 P95 不超过 6 秒。浏览器时间 SHALL 独立测量，不以各阶段 P95 相加替代实际全过程；未经测量 SHALL 不宣称已经满足目标。

镜像完整检查和环境探测的调用次数 SHALL 同时验证：预热后默认创建 / 启动不重复完整检查或环境探测；同键并发冷准备只执行一份。首次 Core 预热、新镜像拉取 / 检查、大包复制、外部 MCP 等条件 SHALL 单独统计，明确不适用上述默认参考预算。

#### Scenario: 预热后创建默认 Work
- **WHEN** 在记录完整环境条件的独立验收安装中顺序创建至少 20 个默认 Work
- **THEN** 报告各阶段及实际浏览器全过程的 P50 / P95 和失败样本，按 1 / 3 / 6 秒目标判定，并证明创建 / 启动未重复完整镜像检查和环境探测

#### Scenario: 首个 Work 和再次 Start
- **WHEN** Core 已完成预热，用户首次创建默认 Work，随后停止并再次 Start
- **THEN** 两条路径均复用已有镜像能力，Start 从原 active context 验证真实 Agent，性能记录不隐去首次默认 Work

#### Scenario: 冷镜像和大包条件
- **WHEN** 用户首次选择尚未准备的镜像，或配置大包 / 外部慢 MCP
- **THEN** 报告实际准备及启动阶段耗时，不把冷路径混入热路径样本后仍宣称默认预算已经满足，也不为满足预算跳过必要校验

### Requirement: 优化保持原子捕获与持久受理顺序

**Identifier:** WLIFE-CAPTURE-LATENCY-001

创建性能优化 SHALL 保留完整 Work-owned context 捕获和初始兼容性核对先于持久 Work / Operation 受理，Docker 运行资源创建先于 Ready 而后于持久受理。受理前失败 SHALL 不留下可见半成品；接受后 SHALL 沿原 Operation 异步推进，幂等重放优先返回既有结果。共享镜像结果 MUST NOT 替代 Work 自有制品、当前权限 / 配额检查、控制版本或停止 / Apply 栅栏。

#### Scenario: 捕获失败
- **WHEN** 镜像准备已命中，但 Skill / 包上下文捕获或初始兼容性核对失败
- **THEN** 创建失败且没有受理的半成品 Work / Operation，也没有为该 Work 启动 Agent 容器

#### Scenario: 接受响应丢失
- **WHEN** 已受理创建的响应丢失，客户端用同主体、同幂等键及内容重试
- **THEN** 返回原 Work / Operation，不重新捕获上下文、不启动重复容器，也不重新发起镜像准备

#### Scenario: Starting 期间接受 Stop
- **WHEN** 已受理 Work 正在等待 Agent readiness，而 Stop 成为最新控制目标
- **THEN** 旧启动不能凭缓存或迟到的 readiness 激活为 ready，继续按既有 superseded 和资源收尾规则处理

### Requirement: Work 创建名称冲突返回可修正的字段错误

**Identifier:** WLIFE-NAME-FEEDBACK-001

普通创建 SHALL 保留现有同一用户下名称唯一、已删除记录和在途导入占用名称的判定，并保持预检查与接受事务中的再次核验。两处确认名称冲突时 SHALL 一致返回 HTTP 409、已有 `WORK_NAME_CONFLICT` 错误码和 `field=name`，给出安全的名称不可用及选择其他名称的说明，不只返回通用状态冲突。

名称冲突错误 SHALL 不披露其他 Work 的内容、归属详情或内部存储信息，不覆盖、合并、自动改名或创建可见半成品 Work/Operation。其他状态冲突、权限、配额、依赖和网络错误 SHALL 保持原有分类；既有幂等重放、检查顺序、创建受理与恢复行为保持。

#### Scenario: 预检查发现重名
- **WHEN** 用户创建名称已被现有规则占用的 Work
- **THEN** 返回 409 WORK_NAME_CONFLICT 和 name 字段，说明应换名，不产生新的可见 Work 或 Operation

#### Scenario: 接受事务发现并发重名
- **WHEN** 预检查通过后，另一个请求先占用了该用户的同名名称
- **THEN** 接受事务返回相同名称字段错误，原有 Work 保留，失败请求不留下可见半成品

#### Scenario: 列表中不可见的名称占用
- **WHEN** 名称被保留删除记录或在途导入按现有规则占用
- **THEN** 仍返回准确名称不可用提示，不声称名称一定来自当前可见列表或删除即可释放

#### Scenario: 既有重放和其他拒绝保持
- **WHEN** 同主体同键的已接受创建被重放，或创建因配额、依赖、权限等其他原因被拒绝
- **THEN** 前者沿既有幂等行为返回原结果，后者保留实际拒绝原因，均不误报名称冲突

### Requirement: 删除或替换前有界归档精确运行实例日志

**Identifier:** WLIFE-LOG-001

Core SHALL 在受管 Agent/Service 实例可能产生输出前持久建立可追踪的日志来源身份和所有者记录；实例创建、启动及绑定中断后仍能恢复核对。Work 删除、Agent Apply/恢复替换、Service Restart/更新替换、失败候选或初始化清理等所有 Core 发起的实例删除路径 SHALL 在停止确认后、删除前尝试归档该精确实例保留的 stdout/stderr。

归档 SHALL 先发布完整日志及来源元数据，再标记该实例归档完成；中断或失败不应留下被当成完整归档的临时结果。归档失败、超时、超限或源已经消失 SHALL 仍允许原有生命周期操作继续，持久来源记录保留未完成/缺口状态；Core 重启可从该记录及实际资源核对缺失，不能依赖失败之后才能写入的一条普通进程日志。

归档尝试 SHALL 有界并遵守所属操作剩余预算，不能以日志失败跳过其他容器停止、无限阻塞替换/删除或延长 Core 默认关闭总预算。普通 Stop 保留容器日志访问，不为了导出强制删除或重建；自动重试必须针对原实例且不能用新实例掩盖旧缺口。

来源 SHALL 绑定该精确实例实际使用的不可变配置上下文；运行代次不等于配置版本，不能用当前 desired 或 active 推测。失败候选与回滚恢复实例分别保留来源及其原敏感值上下文，按 LOGEXP-002 脱敏后归档；无法核验时持久反馈缺口，原生命周期操作继续。

#### Scenario: Apply 替换 Agent
- **WHEN** Apply 需要停止并移除旧 Agent 实例
- **THEN** 删除前归档旧实例；新旧实例分别可追踪，后续导出可读取旧日志且不重复新实例

#### Scenario: Service 重启及初始化失败
- **WHEN** Service Restart、定义更新或启动失败清理移除某实例
- **THEN** 均经过相同的原实例归档约束，不因不是用户 Delete 动作而跳过

#### Scenario: 归档超时仍可删除
- **WHEN** 原容器已停止，但 Docker 日志读取或归档写入超过预算
- **THEN** 原删除/替换继续，来源保留明确缺口，生命周期结果不虚构归档成功

#### Scenario: 删除后缺口提交前进程退出
- **WHEN** 已持久来源的归档未完成，容器已被移除而 Core 随后退出
- **THEN** 重启核对该原来源为缺失或未完成，后续导出可反馈缺口而非将其遗漏

#### Scenario: 导出与替换同时进行
- **WHEN** 导出正在读取原实例而生命周期需要替换它
- **THEN** 不取得冷快照锁或无限持有 Work 生命周期锁，按原实例及其归档衔接；不能确认完整时清单反馈缺口

#### Scenario: 候选失败后恢复旧配置实例
- **WHEN** 新配置候选失败，Core 恢复旧配置且新旧配置已知凭据不同
- **THEN** 被删除候选及之后被移除的恢复实例分别归档自己的输出并按实际配置脱敏，不因 desired 仍指向新配置泄漏旧凭据

#### Scenario: Service 更新与初始化失败的归档故障
- **WHEN** Service 定义更新或实例初始化失败触发移除，且原来源归档失败
- **THEN** 每条移除路径均先有界尝试原实例归档并持久追踪缺口，随后继续原操作和其他容器收尾
