# Pi Package Management Specification

## Purpose

定义 Pi package 从来源输入、完整制品准备到 Core 默认包库及每个 Work 独立管理的生命周期，使安装结果可复现、可观察和可重试，并保证来源变化与并发失败不会隐式改变正在使用的环境。

## Requirements

### Requirement: Normalize four sources into owned package artifacts

**Identifier:** PKG-001

Core 与 Work SHALL 同时接受 npm spec、Git spec、本地目录和 `.zip` 四种来源。npm/Git SHALL 按本次解析的确切版本或 commit 冻结；本地内容 SHALL 来自客户端所选择的本地输入，经有界上传传给 Core，不把客户端路径解释成服务器路径；CLI 与浏览器适配器都可提交相同的 Core 上传协议。ZIP SHALL 包含根 package.json 或唯一外层目录中的 package.json，多个根包 SHALL 拒绝。所有来源 SHALL 形成独立、完整、包含运行依赖的不可变制品；后续启动/导出不得依赖来源目录、上传、registry 或 Git。

包身份 SHALL 使用 package.json.name，长度 1–214，匹配 `^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`；不得缺失、为空或从目录名猜测。version 缺失 SHALL 返回 null。相同 name/version 的不同内容 SHALL 被视为不同制品。静态 manifest/资源声明失败 SHALL 明确失败，安装成功 MUST NOT 宣称已执行 SDK 加载。不得通过输入来源 URL 传入明文凭证或新增交互式私有源登录。

#### Scenario: Install the same package from each source
- **WHEN** 用户分别通过 npm、Git、本地目录和单根 ZIP 安装同一有效包
- **THEN** 每种方式均可获得以相同 manifest name 管理的完整独立制品，并报告实际 version、sourceKind 和资源数量

#### Scenario: A client path differs from the Core host
- **WHEN** 用户的本机有 ./tools 而 Core 宿主没有该目录
- **THEN** CLI 上传本机目录内容，安装成功后删除本机目录和上传不影响已安装包

#### Scenario: Reject an ambiguous identity or archive
- **WHEN** 来源缺失合法 name、ZIP 有多个包根、manifest 不合法或声明必需资源不存在
- **THEN** 任务以安全字段错误失败，不发布部分包或替代名称

#### Scenario: Freeze a mutable source
- **WHEN** tag、branch、npm dist-tag 或本地目录在安装完成后改变
- **THEN** 已安装 bytes 保持不变，只有新一次显式 update 重新捕获来源

#### Scenario: 浏览器提供本地输入
- **WHEN** 管理客户端上传浏览器选择的本地目录快照或 ZIP
- **THEN** Core 使用收到的内容执行同一 manifest 和制品校验，不读取浏览器上报的宿主路径

### Requirement: Prepare executable dependencies outside the control plane

**Identifier:** PKG-002

系统 SHALL 在与目标 agent 平台、Node ABI 和 Pi SDK 兼容的隔离准备环境中下载和准备运行依赖；Core 安装使用接受时默认 agent 环境，Work 安装使用接受时 desired 环境。第三方 lifecycle script SHALL 只在该临时环境运行；CLI/Core 主进程及 `.work` 校验/导入 SHALL NOT 执行脚本或 extension。准备环境 SHALL 不获得 Core 数据根、Docker socket、operator/model credential 或其他 Work 数据。结果 SHALL 在完整退出及验证后发布，失败保留原包。

对来源和依赖均可获取、内容符合包契约、且准备未触及资源及时限的公开 npm package，Core SHALL 完成真实安装并发布完整制品。仅为失败返回安全错误分类不满足该成功要求；准备实现自身的故障 SHALL 被修复，不得把这类故障当作该 package 的预期失败。

准备 SHALL 在 30 分钟内完成，否则 failed；同时执行的准备最多两个，其余已接受任务可查询为 pending。每次准备资源上限为 2 CPU、2 GiB 内存和 256 PID。包必须交付可加载资源或通过安装 lifecycle 生成；系统 SHALL NOT 猜测额外构建命令。准备环境不兼容 SHALL 报 `PI_PACKAGE_ENVIRONMENT_MISMATCH`，不得在启动或导入时隐式重装。

准备 helper 已知的来源获取命令（npm pack、Git clone/fetch/checkout）非零退出 SHALL 报 `PI_PACKAGE_SOURCE_FETCH_FAILED`；运行依赖准备命令（npm ci/install，包含其 lifecycle script）非零退出 SHALL 报 `PI_PACKAGE_DEPENDENCY_INSTALL_FAILED`。两个 scope 的 Operation 均 SHALL 保留 `stage=prepare`、稳定错误码和固定安全消息；不得把 npm/Git 输出、命令参数、来源路径或凭据放入公共错误。已有输入验证、空间超限和截止时间错误 SHALL 优先于被中止子进程的退出码；未知运行时故障仍可报 `PI_PACKAGE_PREPARATION_FAILED`。

#### Scenario: An installation script attempts platform access
- **WHEN** 安装脚本尝试读取 Core secret、其他 Work 目录或 Docker socket
- **THEN** 这些资源不在准备环境中可访问，脚本不能修改 Core 包库或 Work 指针

#### Scenario: A script fails or exceeds its deadline
- **WHEN** 安装脚本非零退出、资源超限或超过 30 分钟
- **THEN** Operation failed 并报告安全 stage/code，原 catalog/desired/active 不变，临时资源被清理

#### Scenario: Distinguish source retrieval from dependency installation failure
- **WHEN** Core 或 Work 安装分别在 npm/Git 来源获取命令或 npm ci/install 命令中非零退出
- **THEN** 原 Operation 分别以 `PI_PACKAGE_SOURCE_FETCH_FAILED` 或 `PI_PACKAGE_DEPENDENCY_INSTALL_FAILED` 失败；两个结果只含固定安全消息，不泄露原始子进程输出，且不发布半成品

#### Scenario: Complete a compatible public npm install
- **WHEN** Core 使用可获取且符合包契约的公开 npm 固定版本包执行 `packages install <npm-source> --default --wait`，准备在资源和时限内完成
- **THEN** 原 Operation 为 succeeded，包库显示该包的实际 name/version、enabled=true 和 isDefault=true；不得以失败分类作为安装成功

#### Scenario: A third preparation is accepted
- **WHEN** 两个准备环境已运行，另一个 scope 的合法安装被接受
- **THEN** 第三个 Operation 保持 durable pending，只有获得容量后才开始准备，不突破并发上限

### Requirement: Validate and scope package input transfers

**Identifier:** PKG-003

本地目录与 ZIP 上传 SHALL 先鉴权、后流式读取，绑定 actor 和 Core/Work scope，并验证声明长度和 SHA-256。完成上传 SHALL 返回 uploadId/expiresAt，保留 24 小时；accepted Operation 的有效引用 SHALL 阻止过期回收。上传 SHALL 限制 60 秒无进展、30 分钟总时限；中断或不完整内容不得用于安装。

输入 SHALL 限制压缩体 256 MiB、展开制品 1 GiB、单文件 64 MiB、100,000 条目、64 层、路径 4096 UTF-8 字节、manifest 1 MiB。系统 SHALL 拒绝加密 ZIP、重复/绝对/越界路径、反斜线、特殊设备和循环/越界链接；只允许制品内部相对符号链接并保留执行位，不保留 setuid/setgid。超限 SHALL 返回 `PI_PACKAGE_LIMIT_EXCEEDED`，不安全结构 SHALL 返回 `PI_PACKAGE_UNSAFE_ARCHIVE`。同一限制 SHALL 适用于 npm/Git/local/ZIP 来源解包及准备结果；远端来源在依赖安装前 SHALL 检查已落盘的来源树，不能只在最终制品捕获时检查。

准备 helper 的临时工作卷 SHALL 监测总用量，并以每个 helper 4 GiB 为终止阈值，计入下载缓存、Git checkout、依赖安装及 staging 副本；检测到超限 SHALL 终止准备，以 `PI_PACKAGE_LIMIT_EXCEEDED` 使 Operation 失败并清理临时资源，不发布制品或改变原 catalog/desired/active。该运行期监测不宣称为 Docker volume 的硬磁盘配额；来源树和最终制品的上述静态限额仍须独立验证。

Core scope 的 actor SHALL 为 operator 或实际已登录管理员 userId；Work scope 继续沿用既有 Work 授权。上传接受和安装引用都 SHALL 验证 actor/scope；普通 user 不得创建 Core scope 上传。有效管理员会话在上传期间失效时，完成提交 SHALL 拒绝。上传由同一账号重新登录后仍可在有效期内使用，不授予其他管理员消费权限。

#### Scenario: Use another scope's upload
- **WHEN** 调用者将另一 actor 或另一 Work 的 uploadId 用于安装
- **THEN** Core 拒绝访问且不泄露上传名称、内容或所属人

#### Scenario: Preserve a valid dependency link
- **WHEN** 包含 node_modules/.bin 的相对链接且完整链始终位于包根内
- **THEN** 安装保留该链接及执行位，后续 SDK 和依赖可读取对应文件

#### Scenario: Reject a ZIP bomb or escaping link
- **WHEN** ZIP 展开超限、条目重复、包含 ../ 越界或链接最终指向包根外
- **THEN** 输入整体失败，既有包及宿主文件不变，不出现可用于 install 的完成上传

#### Scenario: Retain a leased upload
- **WHEN** 上传达到 24 小时但已接受任务仍持有有效引用
- **THEN** 系统保留任务需要的内容，任务结束解除引用后才允许过期回收

#### Scenario: A remote source or install script exceeds preparation space
- **WHEN** npm/Git 来源树、依赖缓存或 lifecycle script 持续写入，使来源树超过 1 GiB 或临时工作卷的监测用量超过 4 GiB
- **THEN** 准备阶段以 `PI_PACKAGE_LIMIT_EXCEEDED` 失败并停止 helper，原 catalog/desired/active 不变，临时 volume 与来源引用在确认 helper 退出后清理

#### Scenario: Core 上传隔离管理员
- **WHEN** 管理员尝试安装由其他管理员、operator 或 Work scope 上传的内容
- **THEN** 返回统一不可用错误，不泄露上传内容或所有者，也不产生 Operation

### Requirement: Manage the Core catalog separately from default selection

**Identifier:** PKG-004

仅 operator 和已启用管理员 SHALL 通过各自受保护的管理 API 管理 Core package catalog；普通 user 仍只能使用原有 enabled catalog 只读能力。普通 install SHALL 发布 enabled=true 且不加入默认；install --default SHALL 原子发布并追加默认集合，保留其他默认项。默认选择最多 64 个唯一 enabled 包；显式空集合 SHALL 有效。Core update SHALL 保留 enabled 和默认引用；默认引用中的包 disable/remove SHALL 返回 `PI_PACKAGE_IN_DEFAULTS`，先移出默认后才能操作。Core 更新/禁用/移除 SHALL NOT 修改已创建 Work 的任何副本。

用户只读 catalog SHALL 只公开 enabled 包；operator 及通过管理 API 访问的管理员 SHALL 能看到 enabled/disabled 和 isDefault。列表 SHALL 按 name 的 UTF-8 字节顺序返回，不返回制品文件内容、宿主路径、secret 或内部 digest。

#### Scenario: Install without changing defaults
- **WHEN** operator 安装 tools 且没有 --default
- **THEN** tools 在 enabled catalog 可发现，已有默认集合及新 Work 的默认选择不变

#### Scenario: Atomically install a default
- **WHEN** 默认已有 a、b，operator 成功安装 c --default
- **THEN** catalog 和默认集合一起提交为 a、b、c；安装失败时两者均不增加 c

#### Scenario: Protect a default reference
- **WHEN** operator 尝试 disable/remove 一个仍为默认的包
- **THEN** 返回 PI_PACKAGE_IN_DEFAULTS，包和默认集合保持不变

#### Scenario: Future Works observe the new head
- **WHEN** A 捕获 tools v1 后 Core 将 tools 更新为 v2，再创建 B
- **THEN** A 的 desired/active 仍为自己的 v1，B 获得 v2

#### Scenario: 管理员和 operator 共享同一 Core 库
- **WHEN** 管理员安装或修改 Core package 后 operator 查询，或反向执行
- **THEN** 双方观察到同一 catalog/defaults，并共同遵守 Core package 并发门禁，已有 Work 副本不变

### Requirement: Distinguish install update and state-only mutations

**Identifier:** PKG-005

同 scope 同 name 的重复 install SHALL 返回 `PI_PACKAGE_ALREADY_INSTALLED`，不得当作 update。update SHALL 显式指定新来源且 manifest name 必须与目标相同；改名 SHALL 返回 `PI_PACKAGE_NAME_MISMATCH`。update SHALL 可在 npm/Git/local/ZIP 之间切换并保留 enabled。enable/disable SHALL 仅改变开关，remove SHALL 移除该 scope 的当前选择；相同开关为幂等 no-op，操作不存在的包 SHALL 返回 `PI_PACKAGE_NOT_FOUND`。

Work install/update/enable/disable/remove SHALL 只修改该 Work desired；active、正在执行的 Run、其他 Work 和 Core catalog 不变。新安装 enabled=true；disabled 制品仍保留。Work install --from-core <name> 和 update <name> --from-core SHALL 捕获当前 enabled Core head 的独立副本，检查目标兼容性，不与 Core 建立持续同步关系。对首次接受的请求，当前 head 的判定点 SHALL 是持久 Operation 的接受事务：事务内同时验证 catalog 仍 enabled、读取 head、检查该 head 与已确定的目标环境兼容、租用其制品并记录该身份；接受前的异步镜像/环境检查不得使旧 head 绕过重新验证。接受之后 Core 再更新、禁用或移除不改变已捕获的 Work 来源；幂等重放仍返回原 Operation。

#### Scenario: Duplicate install requires explicit update
- **WHEN** tools 已存在，用户用另一来源再次 install tools
- **THEN** 返回重复安装冲突并保留旧 desired；显式 update 且同名时才允许换内容

#### Scenario: Update a disabled package
- **WHEN** tools 已 disabled，update 成功准备同名新版本
- **THEN** desired 使用新版本并继续 disabled，active 保持原状态直到 apply

#### Scenario: Remove a currently active package
- **WHEN** tools 仍在 active 而用户 remove tools
- **THEN** desired 不再包含 tools，list 仍显示 active tools 和 pendingApply，旧运行内容保持可用

#### Scenario: Copy explicitly from the current Core
- **WHEN** Work 已有 tools v1，当前 Core enabled tools 为 v2，用户 update tools --from-core
- **THEN** desired 获得独立 v2，Core 后续删除不影响该副本；没有显式 apply 时运行仍使用 v1

#### Scenario: Core head changes before Work acceptance
- **WHEN** Work 的 --from-core 请求完成早期检查后等待异步环境准备，期间 Core 更新 head 或禁用/移除该包
- **THEN** 首次接受事务捕获并租用事务时仍 enabled 且与目标环境兼容的最新 head；若已 disabled/removed 或新 head 不兼容则拒绝接受，不租用或发布过期 head

### Requirement: Persist package operations and idempotent outcomes

**Identifier:** PKG-006

install/update SHALL 返回持久 Operation acceptance；成功仅表示完整制品发布到 catalog 或 desired，不代表 Work loaded。相同 actor/scope/verb 的相同幂等键和语义请求 SHALL 重用同一 Operation，包含终态失败；不同请求复用键 SHALL 冲突。语义比较 SHALL 使用上传内容摘要，不把重复上传的新 uploadId 视为新请求。新键 SHALL 允许显式重试。

Core 重启 SHALL 保留 Operation、阶段、结果和发布状态；能够验证原 helper 及完整结果时继续收尾，无法证明时明确失败，不重复执行第三方脚本。查询 SHALL 区分 pending/running/succeeded/failed/superseded，失败返回安全 stage/code/message，不输出未经处理的子进程日志、凭证或宿主路径。客户端停止等待 SHALL 不取消已接受任务。

Core 与 Work 的 package Operation 查询 SHALL 额外返回 `packagePhase`，取值仅为 `queued|source|prepare|validate|publish|cleanup-pending|succeeded|failed|superseded`，反映该 Operation 已持久化的当前准备阶段；非 package Operation 不返回该字段。该字段 SHALL 经过 operator、启用管理员的 Core 管理查询授权或原有 Work 查询授权，不包含 helper 标识、命令参数、来源路径、子进程输出或凭据，也不改变 Operation 的 `state` 及结果契约。

Core 操作的幂等 actor SHALL 区分各管理员 userId 与 operator。任何启用管理员或 operator SHALL 能按已知 ID 查询 Core package Operation 的安全详情；该权限不允许查询用户 Work Operation 或消费其他 actor 的上传。相同 key 在不同 actor 下不是同一请求，仍须遵守整个 Core catalog 的唯一非终态准备门禁。

#### Scenario: Retry an accepted request after a lost response
- **WHEN** install 已接受而响应丢失，调用者以同键及同内容重新提交
- **THEN** 返回原 Operation 和 reused=true，不准备或安装第二次

#### Scenario: Retry a failed installation
- **WHEN** 来源临时失败，调用者先重放旧键再用新键提交相同来源
- **THEN** 旧键返回原 failed Operation，新键创建一次新的准备尝试

#### Scenario: Observe safe package preparation phase
- **WHEN** 已授权调用者查询进行中的 Core 或 Work package Operation，准备阶段从 queued 推进至 prepare
- **THEN** 查询保留原 state 和 ID，并在 `packagePhase` 显示已持久化的阶段；其他 Operation 无该字段，响应不暴露 helper 标识、子进程输出或敏感路径

#### Scenario: Crash at publication
- **WHEN** 制品落盘后、状态提交前 Core 崩溃，或状态已提交后响应前崩溃
- **THEN** 重启分别识别不可见暂存或唯一已成功结果，不出现半包、重复默认项或重复 desired 更新

#### Scenario: 管理员按 ID 恢复 Core 任务
- **WHEN** 任一启用管理员在新会话查询已知 Core package Operation ID
- **THEN** 返回原持久状态及安全阶段，Work Operation 或不存在 ID 则返回相同不可用结果

#### Scenario: 同键不串用管理员
- **WHEN** 管理员 A、B 和 operator 分别使用相同幂等 key
- **THEN** 各自的重放空间隔离，不错误返回另一个 actor 的接受结果

### Requirement: Fence concurrency and merge unrelated desired edits

**Identifier:** PKG-007

每个 Work 及 Core catalog SHALL 各最多一个非终态 package install/update；该范围内其他 package mutation SHALL 返回 `PI_PACKAGE_BUSY`。Work running/stopped SHALL 均可准备；处于 start/stop/apply 过渡、删除或冷快照的 Work SHALL 拒绝新准备，snapshot 优先返回 `WORK_SNAPSHOT_BUSY`。非终态 package job 期间 start/apply/export SHALL 不得越过控制任务门禁。stop/delete SHALL 能使旧 job superseded，旧 job 不得随后提交或重启 Work。

与 package 准备并发的无关 desired 字段编辑 SHALL 保留；准备成功 SHALL 在最新 desired 上原子合并其包变更，不用接受时的整份配置覆盖后续编辑。默认 flag 更新 SHALL 服务端合并省略字段。已接受 apply 的 candidate SHALL 固定，apply 期间允许的状态-only desired 修改 SHALL 留作下一次 pendingApply。

#### Scenario: Preserve a model edit during package preparation
- **WHEN** tools 安装中用户把 desired model 从 a 改为 b，随后安装提交
- **THEN** desired 同时包含 b 和 tools，active 仍不变

#### Scenario: Concurrent package mutations
- **WHEN** 同一 Work 已有非终态 install，另一个 install/update/enable/remove 请求到达
- **THEN** 后者返回 PI_PACKAGE_BUSY，原任务保持唯一且不丢失结果

#### Scenario: Delete fences late completion
- **WHEN** delete 接受后，旧 package helper 才完成
- **THEN** 原 package Operation superseded，结果不能写入 desired、复活 Work 或改变 delete 目标

#### Scenario: Preserve later desired state across apply
- **WHEN** apply 捕获 B 后用户 disable 一个包得到 C，B 随后验证成功
- **THEN** active=B、desired=C、pendingApply=true，不把 C 隐式激活或丢弃

### Requirement: Report installed desired active and loaded separately

**Identifier:** PKG-008

Core package 视图 SHALL 报 name/version/sourceKind/enabled/isDefault/resourceCounts。Work 视图 SHALL 报 desired 与 active 的 union、各自 version/enabled、pendingApply 和当前 runtime loaded 状态；相同 version 的不同内容也 SHALL 显示 pendingApply。不存在的一侧为 null。运行不可用、停止、初始化、失败或代次过期时 SHALL 报 runtime unavailable、loaded=null，不能沿用历史成功。所有视图 SHALL 遵守现有 Work 内容访问授权；operator package 查询不得绕过用户 Work 内容边界。

#### Scenario: An installed package has not been applied
- **WHEN** install --wait 已成功而尚未 apply
- **THEN** desired 包存在、active 仍旧，视图报告 pendingApply，不宣称新包 loaded

#### Scenario: Stop a previously loaded Work
- **WHEN** 已成功加载 tools 的 Work 停止
- **THEN** 配置仍保留 active tools，当前 runtime unavailable 且 loaded=null

#### Scenario: Read unauthorized package state
- **WHEN** 非所有者无内容权限用户或仅 operator 身份查询 Work packages/Operation
- **THEN** 现有授权策略拒绝访问，不返回包来源、内容或加载详情

### Requirement: Retain every referenced artifact until safe collection

**Identifier:** PKG-009

包移除或更新 SHALL NOT 删除 active、desired、所有保留历史 context、非终态任务或快照仍引用的制品。系统 SHALL 仅回收无引用制品、过期且无 lease 上传和已确认退出的临时准备资源。Core 与 Work 的所有权 SHALL 独立；删除 Core head 不得造成 Work 的悬空引用。制品缺失/损坏 SHALL 明确失败，不从可变来源或默认值补齐。

#### Scenario: Retain a removed package for active and history
- **WHEN** 包从 desired 移除但 active 或旧 Session context 仍引用它
- **THEN** GC 保留完整 bytes，旧 context 及 export 均不丢失依赖

#### Scenario: Artifact corruption is not an upgrade trigger
- **WHEN** 运行或导出发现已捕获制品缺失或摘要不符
- **THEN** 操作失败并报告安全诊断，不从同名 Core 包或来源下载替代内容
