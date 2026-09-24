# Work Snapshots Specification

## Purpose

定义完整 Work 冷快照从所有者导出、流式传输、严格校验到接收者独立导入的端到端行为，保证失败不发布半成品、重试不产生重复 Work，并让停止、锁定和恢复状态可观察。

## Requirements

### Requirement: Export only a verified quiescent Work

**Identifier:** WSNAP-001

已认证所有者 SHALL 能请求 export；源 Work 必须非 deleted，desired/observed 均为 stopped，无 pending/running 控制 Operation，且实际全部所属 agent/service 容器确认不运行、无在途创建或写入者。服务 enabled 可以为 true。源状态不满足 SHALL 返回 HTTP 409 SNAPSHOT_REQUIRES_STOPPED 或 WORK_BUSY；Docker 无法证明停止返回 503 SNAPSHOT_RUNTIME_UNAVAILABLE。导出 SHALL NOT 自动停止、apply、启动或取消 Run。源 Work 的持久预留 SHALL 按 PWORK-001/002 捕获；quota 运行占用计数不是容器停止证明，导出 SHALL NOT 额外要求该计数为零。

接受 export SHALL 原子保存 Operation、snapshotId 和持久独占 Work 快照锁；随后捕获完整持久内容并校验，包全部持久化之后才报告 succeeded。在捕获开始前再次验证实际停止和数据库完整性；发现仍非终态 Run 返回 SNAPSHOT_NOT_QUIESCENT，不修改源历史。检查到任何缺失、读取失败、变化或不支持数据 SHALL 整体失败。锁期以 WLIFE-SNAPSHOT-001 为准。导出计算的单个 blob 哈希、长度和最终 package SHA-256 必须与下载内容一致。

#### Scenario: Export a stopped Work
- **WHEN** 所有者导出实际停止、配置和数据完整的 Work
- **THEN** 返回稳定 Work/snapshot/Operation ID，最终生成完整可校验包，源保持 stopped 且内容不变

#### Scenario: Do not stop implicitly
- **WHEN** Work 正在运行或有进行中的 apply
- **THEN** 导出返回前置条件冲突，没有快照任务、隐式停止或部分成功包

#### Scenario: Reject stale stopped metadata
- **WHEN** Core 记录 stopped 但一个 service 仍运行或 Docker 不可达
- **THEN** 导出不得成功，实际运行返回 SNAPSHOT_REQUIRES_STOPPED，不可确认返回 SNAPSHOT_RUNTIME_UNAVAILABLE

#### Scenario: Do not mutate unfinished history
- **WHEN** 磁盘中的 Run 仍为 running，即使容器已停止
- **THEN** export 失败为 SNAPSHOT_NOT_QUIESCENT，保留源记录并提示先通过正常恢复和停止收尾

#### Scenario: Stopped Work with retained budget
- **WHEN** Work 与实际容器均已停止、所有控制 Operation 已终态，但一个 disabled service 仍有非零持久 desired 预留
- **THEN** export 不因该预留或旧运行占用计数增加新的前置校验，并将持久预留完整写入包

#### Scenario: Export a never-initialized stopped Work
- **WHEN** 已停止 Work 的两个受管卷和 desired context 均存在、active=null，且私有卷从未生成 work.sqlite、-wal、-shm
- **THEN** export 将其作为合法空 Session/Run 历史打包，不为导出而启动 agentd 或在源卷生成数据库

### Requirement: Validate complete bounded packages before installation

**Identifier:** WSNAP-002

v1 package SHALL 使用完整性校验，不宣称签名或加密。接收端 SHALL 在加载镜像或写入最终 Work 存储之前验证 framing、严格 schema、全部长度/hash、唯一条目、引用闭包、文件路径和链接、历史 schema 与关系、平台兼容和声明资源限制。用户可离线 inspect 包；inspect SHALL 验证全部字节，仅显示格式/平台/计数/总大小/模型及外部 MCP 凭证依赖概况和敏感数据警告，不打印文件内容、env 值、历史正文或原平台内部身份。

v1 SHALL 限制包总字节为 100 GiB，文件恢复逻辑字节（跨树重复引用重复计数，硬链接只计一次）加去重镜像层字节也最多100 GiB；manifest 及每个 JSON metadata blob 各最多 64 MiB，累计 metadata 最多 256 MiB，总文件条目最多 1,000,000，路径最多 4096 字节和 128 层，所有 blob 均受同一包字节上限，不按文件类型设置过滤规则。上传/下载 SHALL 流式执行，不能以 Base64 JSON、一次性内存 Buffer 或原有 1 MiB JSON 路由传输；超限返回 413 PACKAGE_LIMIT_EXCEEDED，截断/尾随字节/hash 错误返回 400 PACKAGE_INVALID。中断/未验证包不可用于 import。接收端解包 SHALL 不访问允许根之外的路径、不跟随文件树内链接写入、不创建特殊设备或执行包内程序。

离线 inspect SHALL 完整校验 framing、manifest/树/镜像声明结构、持久卷引用闭包和全部 blob 字节，但不执行包内 SQLite、不代替目标平台兼容性、历史数据库语义、目标模型可用性和 quota 校验；摘要 SHALL 明确 integrityVerified=true、installationValidated=false。服务器 SHALL 在 package 标记可导入前完成隔离历史数据库语义检查，导入发布前再次验证目标相关约束。active=null 且三个受管 Work SQLite 文件全部缺席是合法空私有历史；存在孤立 WAL/SHM，或 active 非 null 却缺主数据库 SHALL 拒绝，不能自动创建一个空数据库冒充来源。

#### Scenario: A package exceeds JSON request size
- **WHEN** 用户传输一个合法 8 MiB 包
- **THEN** 系统通过有背压的流完成验证和传输，不触发 1 MiB JSON 请求上限或将整个包加载进内存

#### Scenario: Duplicate blobs cannot bypass restore limits
- **WHEN** 一个小包通过重复引用同一大文件声明超过 100 GiB 的恢复逻辑数据
- **THEN** 校验返回 PACKAGE_LIMIT_EXCEEDED，不创建目标卷

#### Scenario: Tamper or truncate
- **WHEN** 任一 blob 被改变、重复、缺失或传输提前结束
- **THEN** 校验失败且没有可导入 package 或可见 Work

#### Scenario: A hostile file tree
- **WHEN** 包以 ../、绝对条目路径、重复路径、符号链接父路径或设备节点试图写出暂存根
- **THEN** 导入拒绝整个包且不改变宿主或其他 Work 文件

#### Scenario: Inspect has no execution side effects
- **WHEN** 一个包内含恶意 startup 命令和 AGENTS 指令
- **THEN** inspect 只验证数据和显示安全摘要，不执行这些内容或联系网络

### Requirement: Install atomically as a stopped independent Work

**Identifier:** WSNAP-003

v1 SHALL 限制每个安装同时一个 active export/import job，新任务超额返回 409 SNAPSHOT_CAPACITY_BUSY；全安装同时最多两个 upload/download transfer，超额返回 503 SNAPSHOT_TRANSFER_BUSY。幂等 replay 不占新任务名额，正在清理且仍占资源的 job 不提前释放名额。

导入 SHALL 要求一个已验证、归调用者所有且未过期的 package 与非空 idempotencyKey；name 可省略，bindings 不属于导入请求。未指定名称时 Core SHALL 在接受事务内以包内 sourceName 为候选，若已被同一所有者的现存/已删除 Work 或在途导入占用，则依次尝试 `-2`、`-3` 等后缀，在 128 字符限制内截断基础名，选择首个可用名称并原子保留。显式指定名称被占用 SHALL 返回 409 WORK_NAME_CONFLICT，不覆盖、合并或自动改名。模型及自定义外部 MCP 凭证依赖按 PWORK-004 检查；接收策略/配额 SHALL 按包内 agent 与全部保留 service 的持久 desired 预留原子检查，包含 disabled 或 tombstone 中尚未释放的预算，并计入接收端已有资源占用；预算不足 SHALL 在接受前冲突失败，不降配、不按 enabled 重算。

导入 SHALL 返回预分配 Work ID 与持久 Operation；恢复在不可见暂存中完成，不执行包内代码或模型。只有全部镜像、文件、上下文、历史、服务、预留与引用验证并持久保存后，才原子发布 stopped Work 并使 Operation succeeded。发布时 SHALL 将包内逐项持久预留及卷引用映射到新 Work/service 身份，目标运行占用从零开始；此成功仅表示安装完整，不表示服务 ready。导入阶段 SHALL 不创建 agent/service 容器、Work 网络或 TLS 凭证；新的运行身份只在接收者显式启动时建立。失败 SHALL 不发布 Work 或占住名称；已分配临时卷/context/配额 SHALL 可恢复清理，既有 Work 不受影响。用户 SHALL 能通过返回的 Operation 查询失败，即使目标 Work 从未发布。加载的新内容寻址镜像可以留作共享 cache，不可删除目标已有镜像或覆盖其 tags。

#### Scenario: A complete installation
- **WHEN** 一个无自定义外部 MCP secret 的合法包在目标模型可用且预算足够时只凭 packageId 导入
- **THEN** 发布 stopped 新 Work，保留 active/desired 差异、服务开关、持久预留、卷引用和所有数据，目标运行占用为零，既不创建运行网络/证书或容器，也不执行历史动作

#### Scenario: Reject insufficient recipient capacity
- **WHEN** 包内 disabled service 仍持有非零 desired 预留，使 agent 与全部 service 的总预算超过接收端可用容量
- **THEN** 导入在接受前拒绝，不降低该预留、不发布 Work，也不把 disabled service 当作零预算

#### Scenario: Resume normal use after moving a Work
- **WHEN** 一个使用内置 `work-services`、无自定义外部 MCP secret 的 Work 在兼容安装间完成 stop/export/import/start，接收方模型可用
- **THEN** 用户能运行原开发命令、使用原服务和业务数据、继续匹配 active context 的 Session，无需重新安装依赖、手工重建配置或服务、编辑内部 ID 或编写历史转换脚本

#### Scenario: Fail before publication
- **WHEN** 在还原第二个卷或导入历史时磁盘写入失败
- **THEN** Operation 失败、Work 不可见，暂存资源清理或明确记录 cleanup-pending，用户可以用新 key 重试

#### Scenario: Concurrent automatic names
- **WHEN** 同一用户同时以省略 name 的不同幂等键导入两个同名包
- **THEN** 两个接受事务选择不同名称且均不覆盖已有 Work；相同键重试仍返回首次选定的名称和 Work

#### Scenario: Explicit name conflict
- **WHEN** 导入显式指定一个已由同一所有者的 Work（包括已删除记录）占用的名称
- **THEN** 返回 409 WORK_NAME_CONFLICT，不自动改名或发布 Work

#### Scenario: No privilege bypass through a package
- **WHEN** 包声明 host mount、privileged service 或超过接收方预算
- **THEN** 导入拒绝而不是重放原平台的许可或静默改配置

### Requirement: Retain durable snapshot operations and idempotency

**Identifier:** WSNAP-004

export/import SHALL 使用持久 Operation，返回 workId、operationId、correlationId、reused；import 额外返回最终选定的 name，export 额外返回 snapshotId。幂等 scope SHALL 包含接收安装的调用者与操作种类，export 还包含源 Work；相同 key 同规范化请求返回原 Operation，不重新捕获或产生另一 Work；相同 key 异内容返回 409 IDEMPOTENCY_CONFLICT。import 比较 package digest 与显式 name（未提供时为 null），不比较事务内自动选出的 name、目标模型选择或可更换的 upload packageId。export replay 在重新检查源生命周期之前解析，已过期包不能被静默重新生成。新 key 表示一次新尝试。

任务 SHALL 在接受后 30 分钟内成功或失败为 SNAPSHOT_DEADLINE_EXCEEDED；网络观察断开不取消任务。Core 启动 SHALL 在普通 Work 恢复前处理 snapshot journal：未发布且无完成标记任务失败为 SNAPSHOT_INTERRUPTED 并清理；已完成发布事务保留 succeeded；已原子落盘且经过完整验证的 export 可以完成原 Operation。任何原任务的迟到 worker 不可重新发布或释放新锁。cleanup 未确认完成前 SHALL 保留相应 gate/资源记录，不得对未知资源做全局清理。

#### Scenario: Lost acceptance response
- **WHEN** import 已接受但客户端未收到响应，并以同 digest/显式 name 或省略 name/key 重试
- **THEN** 返回相同名称、Work 和 Operation，即使重传产生新的 packageId 或目标默认模型变化，也只发布一个 Work

#### Scenario: Core crashes before publication
- **WHEN** 部分暂存数据已经写入后 Core 崩溃
- **THEN** 启动先恢复 journal，原 Operation 明确中断并清理，不能被普通恢复当成待启动 Work

#### Scenario: Core crashes after publication
- **WHEN** Work 发布与 Operation 成功事务已提交但响应未返回
- **THEN** 恢复保留一个 stopped Work，同键返回原成功结果

### Requirement: Scope transfer lifetime and errors explicitly

**Identifier:** WSNAP-005

接口 SHALL 提供导出接受、快照安全详情、快照二进制下载、二进制上传和导入接受入口；新内容接口使用 application/vnd.piwork.work-package，上传必须提供 Content-Length 与 X-Piwork-SHA256，下载返回同名校验字段及 Cache-Control:no-store。非适用 Content-Type 返回415，缺失或错误 header 返回400；不支持 Range，显式 Range 返回416。JSON 元数据请求仍受1MiB上限约束，具体路径/DTO遵循本变更设计的接口表。

上传 SHALL 先认证，再流式落入 owner-only 暂存；完整验证后返回 packageId、digest、size、expiresAt、bindingRequirements；末字段仅为兼容既有 v1 上传响应的只读平台依赖摘要，不得要求客户端据此填写 bindings。已完成 upload 和 export 包 SHALL 从就绪起保留 24 小时；任务或下载持有有效引用时不可回收，其后新请求返回 410 PACKAGE_EXPIRED，不影响已导入 Work 或 Operation 历史。新 transfer SHALL 限定 60 秒无进展超时及 30 分钟总时限；中断上传删除未完成暂存，下载可以从头重试，不承诺 range/resume。上传同 owner/digest 复用现存完整内容，不能允许另一用户仅凭 digest 获得字节。

接口 SHALL 使用 400 表示包/请求不合法或 TARGET_MODEL_UNAVAILABLE/EXTERNAL_MCP_SECRET_UNAVAILABLE，401 表示未认证，403 表示非所有者管理员内容访问被拒，404 表示普通跨所有者或未知资源，409 表示状态/名称/幂等/配额冲突，410 表示本人的已过期包，413 表示限额，503 表示运行依赖或暂存不可用。错误体只包含安全 code/message/field；导入前置条件错误 SHALL 给出具体 code 与可执行处理方向，不得统一映射为 `Work snapshot request cannot be accepted`。接受后的失败通过 Operation 报告，不能在流已开始后插入 JSON。包字节是完整内容通道，不经过普通日志/JSON 脱敏器；控制响应和日志仍禁止输出用户内容和凭证。

#### Scenario: Retry a download
- **WHEN** export 成功后的下载断开，用户在保留期内重新下载
- **THEN** 下载相同包/hash，不再锁定或重新读取源 Work

#### Scenario: Expired content
- **WHEN** 本人请求一个没有活动引用且已超过保留期的包
- **THEN** 返回 PACKAGE_EXPIRED，原 Operation 仍可查询，不重新导出

#### Scenario: Disabled user during observation
- **WHEN** 任务已接受后调用者凭证失效
- **THEN** 后续读取重新鉴权，任务不因观察失败而重提；重新登录后仍按所属用户访问原结果
