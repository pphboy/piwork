# Portable Work Specification

## Purpose

定义 Work 作为可移植完整工作空间的组成、内容闭包、版本及身份边界，使导出包能够在另一所有者名下恢复代码、数据、开发环境和历史，而不继承源平台权限或隐式重建丢失内容。

用户目标是 Work 整体搬家：导出、导入、启动后接着使用，不需要手工筛选文件、重装依赖、重建服务或理解内部历史格式。

## Requirements

### Requirement: Define a versioned complete Work aggregate

**Identifier:** PWORK-001

系统 SHALL 区分 Work Spec（版本化内容清单与关系）、Work Package（Spec 加完整制品字节）、Work Instance（归属接收者的运行实例）。v1 Spec SHALL 声明 formatVersion=1、snapshotKind=cold-full、包生成时间、源 Work 名称、Linux OS/architecture/variant、agent protocol、Work history schema、storage layout、active/desired context 引用、所有保留 context、服务 heads/revisions、Work 持久资源预留、恰好两个受管持久卷及其当前 Work/service 引用、存储树、历史记录、固定镜像、平台依赖描述及逐制品大小/SHA-256。Spec SHALL 包含完整闭包：每个受管引用恰有一个目标，空集合显式为空，active 未初始化时为 null，不能以目标端默认值补缺。持久资源预留 SHALL 恰有一条 agent 记录及每个保留 service（包括 tombstone）各一条记录，保留非负的 desired CPU/内存和 service/volume slots；记录引用包内逻辑 service key，不携带源平台 subject ID。两个卷 SHALL 各有一个隐含 Work 引用；workspace 的 service 引用 SHALL 以去重有序的包内 service key 显式记录，agent-private 不允许 service 引用。缺少或多出预留/卷引用记录、重复逻辑键、悬空引用、缺失制品、未知字段/组件或版本 SHALL 返回 PACKAGE_INVALID 或 PACKAGE_FORMAT_UNSUPPORTED，不能静默忽略。

v1 SHALL 使用 design.md 中确定的公开二进制 framing 和 JSON manifest 合约；软件发行版本、包格式版本和应用用户文件中的版本 MUST NOT 混同。本 change 直接完成尚未发布的 MVP V1 package 契约，保持 formatVersion=1 且不兼容缺字段的旧文件。此最终 V1 之后的新增组件 SHALL 通过明确格式版本演进；v1 不接受未知组件，即使被发送者称为可选。

Work Spec SHALL 是完整快照的清单，而不是要求用户编写的重建配方。系统 SHALL 复用原生历史记录归档；控制历史 requestJson/resultJson/errorJson 内部内容为只读不透明字符串，不属于需逐字段转换的运行合约，未知历史 kind 不等同于未知包组件。格式、身份映射与校验由系统完成，不能要求用户提供历史迁移脚本。

最终 MVP V1 SHALL 必需包含 piPackageContract=1、全局 piPackageArtifacts 清单及每个保留 context 的 config.packages/packageBindings，即使为空也显式记录。每个 config 项（含 disabled）恰好绑定一个匹配 name 的制品，制品包含完整 tree、运行依赖、内容校验与兼容环境；不存在悬空绑定或未引用的包表项。相同内容去重，同名不同版本或同版本不同 bytes 分别保留。

#### Scenario: A self-contained Work
- **WHEN** 导出具有两份 context、两个服务和两个持久卷的已停止 Work
- **THEN** 包内可解析所有关系和实际字节，接收端不需要原 Core、原 Skill 库或镜像仓库来还原本地内容

#### Scenario: Reject missing or unknown structure
- **WHEN** 包遗漏 desired context、引用不存在的 blob、重复 service key 或包含 formatVersion=2
- **THEN** 导入在发布 Work 之前失败，且不会用默认配置或部分组件代替

#### Scenario: Reject an incomplete reservation graph
- **WHEN** 包缺少 agent 预留、缺少一个 disabled service 的预留、重复一个 service 预留或引用不存在的 service key
- **THEN** 包验证返回 PACKAGE_INVALID，不按 enabled、definition 或接收端默认策略猜测缺失预算

#### Scenario: Reject an incomplete storage graph
- **WHEN** 包缺少任一受管卷、把 service 引用指向不存在的 key，或在 agent-private 卷上声明 service 引用
- **THEN** 包验证返回 PACKAGE_INVALID，不用空卷或当前 service 定义补齐引用

#### Scenario: Reject a pre-package V1 file
- **WHEN** formatVersion=1 文件缺少 package 必需字段
- **THEN** 返回 PACKAGE_INVALID，不补 []、不迁移、不改用 formatVersion=2 双读

#### Scenario: Validate a package reference graph
- **WHEN** context 的包 binding 缺失、重复、name 不匹配或指向不存在制品
- **THEN** 完整包被拒绝，不能从接收端 defaults 补齐

### Requirement: Preserve the full owned persistent content

**Identifier:** PWORK-002

完整包 SHALL 包含 workspace 与 agent-private 卷的全部可表示持久内容及其当前服务引用、全部保留 Work context/Skill/AGENTS 字节、所有服务定义版本与 tombstone、Work 配置历史、Work 的持久资源预留、Session/Run 数据和 SDK 历史、已保留的 Work-scoped 控制 Operation 历史，以及所有已绑定固定镜像本体。持久预留 SHALL 取源 Work 的实际 desired 值；即使 service 已 disabled 或 tombstone，只要原记录仍持有预算，也不能从其开关或最新定义推断为零。运行占用计数和源平台记账时间不作为目标 Work 的持久预留复制。隐藏文件、Git、业务数据库、依赖、虚拟环境、用户目录工具、持久缓存和用户存入的凭证 SHALL NOT 按路径、扩展名、用途或敏感性过滤；既有文件元数据限制按 WSTOR-SNAPSHOT-001 整体拒绝，不能漏项成功。导出不改变源内容，不清理缓存，不安装依赖，不扫描后改写秘密。

平台派生容器/网络/证书、Core 用户和登录数据库、operator credential、平台托管 secret 值及存储路径、宿主共享数据、已清除的数据、Docker 临时日志、容器临时可写层、匿名卷、tmpfs、内存和网络连接 SHALL NOT 属于 Work 持久内容。服务业务数据仅在现有获准 workspace 内具有持久语义；不能把未受管容器内容宣称为已搬迁。远程数据库/自定义外部 MCP/模型仅保留配置或平台依赖描述，不宣称包含其服务端数据；内置 `work-services` 是目标 Core 提供的能力，不是需要迁移的远程 MCP 服务。被用户复制进 Work 文件或 service environment 的平台凭证副本仍属于不做过滤的用户字节；文档和导出提示 SHALL 明确包可能包含密钥及私人历史。

完整包 SHALL 无条件包含所有 retained context 引用的 Pi package 完整 bytes 和运行依赖，包括 disabled、已从 desired remove 但仍在 active 的包、旧历史版本和 pending desired。不得提供排除 Pi package 的导出模式，不得只保存 npm/Git/path 引用。包运行时写入既有受管持久卷的文件依照同一完整数据规则保留；临时容器可写层仍不属于持久内容。

#### Scenario: Preserve development and business state
- **WHEN** Work 包含 .git、.env、node_modules、Python venv、HOME 工具目录、SQLite 数据库和会话
- **THEN** 导入保留它们的字节及规定元数据，不运行 npm/pip 重新安装，不清空业务或会话数据

#### Scenario: Platform credentials are not transferable authority
- **WHEN** 原 Core 注入模型密钥和 mTLS 私钥，同时用户 workspace 中另有自己的 token 文件
- **THEN** 包排除平台注入材料而保留 token 文件，接收端重新绑定平台模型并生成运行凭证

#### Scenario: Preserve historical definitions
- **WHEN** 一个服务已经 tombstone，另一个服务有三份定义，Work 存在旧 context 和失败 Operation
- **THEN** 这些已保留记录仍在包中作为历史，导入不得将 tombstone 复活或重放旧 Operation

#### Scenario: Preserve a reservation after failed disable
- **WHEN** 已停止 Work 的一个 service 已是 disabled，但此前 disable 的运行时停止失败使其持久 desired CPU/内存预留仍非零
- **THEN** 导出包记录该非零预留，而不因 service 的 enabled=false 将其改为零

#### Scenario: Export an imported Work again
- **WHEN** 用户导入并使用一个 Work，随后再次导出并交给另一用户导入
- **THEN** 当前全部内容、持久资源预留、最初导入的历史和后续新增历史均保留，不依赖此前的包文件，不把多次搬家变成历史截断

#### Scenario: Preserve every retained package version
- **WHEN** 历史为 tools v0、active 为 v1、desired 为 v2，另有 disabled 包和仅 active 引用包
- **THEN** 导出全部实际内容，导入保留各 context 绑定/开关及 pendingApply，不按最新版本替换历史

#### Scenario: Export again after removing the input file
- **WHEN** Work 导入完成后原 .work/upload/source 全部删除，用户再次 export
- **THEN** 新包仍具有完整自有依赖闭包，不依赖第一次搬迁文件

### Requirement: Transfer captured environments without substituting dependencies

**Identifier:** PWORK-003

包 SHALL 携带各 context 和已解析服务 revision 的实际固定镜像，去重但不省略镜像层；接收端 SHALL 校验镜像身份和运行平台，不能跟随 mutable tag、更换 agent 镜像、拉取替代镜像或自动升级。未解析的历史服务 revision SHALL 保留 unresolved 状态，不在导出时解析 tag；存在已绑定但丢失的镜像 SHALL 使导出以 SNAPSHOT_IMAGE_MISSING 失败。未解析的当前服务保留其失败/未完成准备事实，不能被宣称可离线启动。v1 SHALL 仅支持 Linux 且 OS/architecture/variant 与目标 Docker 一致、agent protocol 受支持、storage layout=2，history schema 为精确已知的 4 或 5 的包；schema 5 的已初始化私有历史必须同时包含并完整校验独立 Memory schema 1。不兼容 SHALL 在创建 Work 之前返回 PACKAGE_INCOMPATIBLE。镜像不受信任，校验/导入阶段 MUST NOT 运行包内 ENTRYPOINT、hooks、shell、MCP 或模型请求。

包 SHALL 携带 Pi package 实际准备好的依赖，不在 export/import 时 npm install、Git checkout、rebuild、执行 lifecycle script 或 extension。piPackageContract、OS/architecture/variant、Node ABI 和 Pi SDK 兼容关系 SHALL 校验；不匹配返回 PACKAGE_INCOMPATIBLE。接收端 package catalog 缺失或存在同名异内容不影响恢复，也不得被覆盖。

导入 SHALL 按所声明的 schema 4 或 schema 5 静态校验各自精确结构与完整引用闭包，不在导入时升级历史或替换固定 agent 镜像，不支持其他历史/Memory 版本、未知受管对象或缺字段补齐。schema 4 Work 的一次性升级仅在之后显式采用新 harness 时遵守 WMEM-005；这不是两套长期运行的 Experience/Memory 权威源。未初始化且两库与 sidecar 均缺席的合法空私有历史按 CONV-SNAPSHOT-001 保留。

#### Scenario: Import without the original registry
- **WHEN** 源固定镜像已打包且目标无法访问原 registry
- **THEN** 导入能够恢复镜像和磁盘环境，并在显式启动时使用相同镜像身份

#### Scenario: Do not fabricate absent history
- **WHEN** 一个历史服务 revision 从未成功解析镜像
- **THEN** 导出保留其原引用和 unresolved 状态，不用当前 tag 冒充当时的固定镜像

#### Scenario: Reject another architecture
- **WHEN** 接收端平台与包声明或镜像平台不同
- **THEN** 导入返回 PACKAGE_INCOMPATIBLE，不自动模拟或下载替代环境

#### Scenario: Move with all package origins offline
- **WHEN** 待导出 Work 的 retained contexts 实际引用分别从 npm、Git、local、ZIP 安装的制品；导出后 npm/Git 不可访问、local/ZIP 已删除，目标 Core 有同名异内容包
- **THEN** 兼容目标仍能静态导入全部四种来源制品，并在显式 start/apply 时使用打包的 active/desired 内容，无来源重下载且目标 catalog 不变；再次导出的 `.work` 仍包含所引用的完整制品

#### Scenario: Reject incompatible native dependencies
- **WHEN** package preparedEnvironment 与对应固定 agent 环境或目标运行平台不兼容
- **THEN** 发布 Work 前返回 PACKAGE_INCOMPATIBLE，不重新编译来掩盖不兼容

#### Scenario: 当前历史契约明确不支持
- **WHEN** 完整包声明的历史版本不是精确支持的 schema 4 或 5，或 schema 5 的 Memory 版本不受支持
- **THEN** 导入返回 PACKAGE_INCOMPATIBLE，原文件不变，不发布 Work 或启动任何候选

#### Scenario: 保留旧固定镜像的导入
- **WHEN** 合法 schema 4 包的 active context 仍引用原 schema 4 agent 镜像
- **THEN** 静态导入保留原镜像与原经验数据，显式 Start 不自动升级；后续显式 Apply 新 harness 才进行受控迁移

#### Scenario: 新格式缺失或错配 Memory
- **WHEN** 已初始化 schema 5 包缺少独立 Memory、store 绑定不匹配或引用不存在的 Evidence/采用版本
- **THEN** 整体拒绝导入，不创建空 Memory 或丢弃非法条目后发布 Work

### Requirement: Instantiate independent identity with automatic platform resolution

**Identifier:** PWORK-004

导入 SHALL 生成新 Work、service、context、控制 Operation 和卷身份，使用接收者身份、目标名称与目标创建时间建立所有权，并一致映射包内逻辑引用，不继承源用户权限或源控制幂等作用域。调用者未指定名称时 SHALL 使用包内源名称作为候选，若已有同名 Work（包括已删除记录或在途导入）则自动添加唯一后缀；显式指定的名称冲突 SHALL 拒绝，不覆盖或合并。源名称和源创建时间仍作为历史/provenance 保存，不覆盖目标实例创建时间。导入发布时 Work 与服务保持 stopped/disabled，不创建 Work 的 agent/service 容器、运行网络或 TLS 凭证；接收者显式启动时才建立新的运行代次、网络和 TLS 身份，不复用源代次或证书。Session/Run ID SHALL 保留为新 Work 内的局部身份，查询必须带 Work scope。历史文本、代码、应用数据库、任意用户 URL 或字面 ID SHALL NOT 被搜索替换；仅受管 schema 中声明的身份字段被映射。源身份映射作为 owner-only provenance 保存，不能授权访问源资源。

v1 包内既有 `bindings` 清单字段 SHALL 保留为模型及可选自定义 MCP secret 的平台依赖描述，其必需结构按最终 MVP V1 校验；它不是调用者需填写的映射。导入请求 SHALL NOT 要求或接受用户提供的 bindings。目标 Core SHALL 为每个模型要求按 provider、model 与规范化 baseUrl 自动选取已启用且凭证可读的目标模型，并在接受任务时固定目标 catalog 与凭证引用；源模型 ID 和源模型 key SHALL NOT 被当作目标权限。目标没有匹配模型 SHALL 在接受前返回 TARGET_MODEL_UNAVAILABLE，而不是复制源模型 key 或更换成不匹配的默认模型。内置 `work-services` SHALL 不产生 secret 要求；它在目标 Work 启动时使用目标 Core 新建立的服务控制身份。v1 暂不迁移自定义外部 MCP 的平台 secret：包若声明任何此类 secret 要求，导入 SHALL 在接受前返回 EXTERNAL_MCP_SECRET_UNAVAILABLE，不创建 Work，也不要求用户提供 bindings。原用户文件中自行配置的外部账号保持原样，不保证该外部账号归属改变。

Pi package name/content identity SHALL 不因所有者变化而改名；其 context/制品所有权及内部引用 SHALL 重建为新 Work 自有数据，不复用源路径。原 active/desired/history 图和 enabled 状态保留，stopped 导入后 runtime loaded 状态不可用。导入本身不查询当前 Core package 默认；后续显式 --from-core 指当前接收 Core。

#### Scenario: Import twice independently
- **WHEN** 同一包以两个不同幂等键且不指定名称导入同一安装
- **THEN** 两个 Work 获得不同目标名称、平台身份和可变存储，修改其中一个不影响另一个，局部 Session/Run ID 相同也不会串读

#### Scenario: Resolve the recipient model without bindings
- **WHEN** 包要求的 provider/model/baseUrl 在目标 Core 有已启用且凭证可读的模型，而源 catalog ID 在目标不存在
- **THEN** 仅提交 `.work` 文件即可导入，全部引用该要求的 context 使用目标模型及目标 Core 注入的 key，不要求 bindings 文件

#### Scenario: Report an unavailable model
- **WHEN** 目标 Core 没有与包内 provider/model/baseUrl 匹配且凭证可读的模型
- **THEN** 导入在发布或占用名称前返回 TARGET_MODEL_UNAVAILABLE，不静默改用另一模型

#### Scenario: Do not silently drop custom external MCP credentials
- **WHEN** 包包含自定义外部 MCP 的平台 secret 引用
- **THEN** v1 导入返回 EXTERNAL_MCP_SECRET_UNAVAILABLE，不把内置 `work-services` 误判为该依赖，也不发布不能启动的 Work

#### Scenario: Keep arbitrary application content
- **WHEN** workspace 文本包含源 Work ID，MCP requiredServiceId 是受管服务引用
- **THEN** 文本字节不变，MCP 引用映射到新 service ID

#### Scenario: Independent package state after importing twice
- **WHEN** 同一 .work 被分别导入 A 和 B，随后 A update/disable/remove 包
- **THEN** 仅 A desired 改变，B 与源 Work 的状态/bytes 不变

### Requirement: 导入后按目标身份重建默认服务域名

**Identifier:** PWORK-SERVICE-ACCESS-001

Work 的默认网络名称、service 域名、Docker 名称及活动访问连接 SHALL 属于目标 Core 派生状态，不进入 `.work` V1 包或改变其 schema。导入 SHALL 在新 Work/service ID 发布时重新分配这些身份；导入仍保持 stopped，只有显式启动并达到 ready 才可通过新域名访问。源包的应用文件、数据库、历史文本中的字面 URL SHALL 原样保留，不做搜索替换或继承源平台路由。

#### Scenario: 同一包导入两次
- **WHEN** 同一含 `notes` service 的 `.work` 文件被导入两次
- **THEN** 两个新 Work 获得不同域名，均不占用源域名；启动其中一个不使另一个可访问

#### Scenario: 未启动的导入 Work
- **WHEN** 用户刚完成导入并查询 service，再尝试访问返回的新域名
- **THEN** 能看见稳定地址但状态为 unavailable，访问失败且不隐式启动 Work

#### Scenario: 保持 V1 包字节契约
- **WHEN** 使用现有 V1 包及历史 URL 文本完成导出、导入与再次导出
- **THEN** 包格式无需新增字段，历史文本字节不被改写，目标域名由目标 ID 推导

### Requirement: 保留反馈闭包并隔离导入历史的执行权限

**Identifier:** PWORK-BRAIN-001

完整包 SHALL 在既有 workspace、agent-private、retained context 和 Pi package 制品组件内包含脑包工作区副本与候选、实际包版本/依赖、业务数据库及待发事件、Work 事实与处理进度、全部关联 Run 和证据、有效、候选、失败及失效认知历史（schema 4 的原 Experience 或 schema 5 的独立 Memory）、Session 模型偏好和 Run 非秘密实际模型描述。新增受管历史表、关系、版本、字段和空集合 SHALL 完整校验，不得把 managed 数据当作无校验普通文件，也不在 framing 中增加未声明组件。

独立 Memory SHALL 包含在既有 agent-private 树中，不增加 framing 组件、第三卷或新的平台 secret 绑定。静态验证 SHALL 覆盖 Memory schema、归属绑定、版本/head、已采用条目、来源请求及 Evidence 的跨库闭包，包括真实空版本；分别导入两份后，受管 Work/store 归属按目标重建，Memory 文本、版本、entryId 与本地来源 ID 保持，原来源请求统一 historical。迁移候选或未完成持久恢复不得被导出成可运行成功包。

完整闭包 SHALL 包含 WMEM-001 的最新持久发布 head 和 WMEM-003 的有效 preference 原 Chat 来源、published candidate/entry 的 kind/createdAt 等元数据一致性。history schema 5 的旧合法版本不能冒充当前 head；historical 不能豁免偏好证明。TS 与 Go 校验 SHALL 对同一合法/伪造夹具保持接受/拒绝一致，拒绝不运行源代码、不生成证明、不修复正文或数据库。

该闭包 SHALL 按 WMEM-003 校验后续快照中的复制条目与其适用候选，不仅比较候选首次发布版本。Go Open/原 snapshot helper SHALL 在重建或发布导入 Work 之前拒绝 kind、createdAt 或 rule 已与原来源不一致的非法副本，不允许静态验证与 Rebuild 成功后才由运行时发现同一错误。合法复制、合法修订/失效及无对应候选的合法迁移历史 SHALL 保留；重建后的合法数据须能通过运行时相同的来源校验，原请求仍为只读 historical。

导入 SHALL 仅映射受管的 Work/context 归属及声明的引用，Service 运行目标通过逻辑名称在新 Work 解析；应用数据库、历史文本、用户代码和字面 URL 保持原字节。所有已导入处理请求、阶段和投递幂等记录 SHALL 标为 historical 且保留原状态，不能恢复为 live 队列；当前实例产生的新请求才可自动执行。Service 待发事件 SHALL 携带生成时归属，导入后的旧 outbox 保留为历史且不得重新发送为新请求或重开旧 Job；正常原 Work 重启仍可发送本 Work 未完成的待发事件。

交互地址与身份 SHALL 在接收者显式 Start 时重新建立。Session 偏好 SHALL 通过非秘密 provider/model/baseUrl 描述唯一匹配目标已启用可用模型，不能以源 catalog ID 或凭据作为权限；没有唯一可用匹配时保留偏好不可用状态并要求明确选择，不能静默换模型。历史实际模型仅为只读证据，不增加运行依赖授权。源码、经验和业务数据的后续更新 SHALL 在各 Work 独立生效。

候选的固定能力验收项和实际 SDK 行为证明 SHALL 随原目标完整保存，并校验工具、输入、必要 checks、Run/请求及候选内容的关系；受管 context 引用按声明映射，验收项中的业务 input 不递归改写。所有候选 SHALL 使用当前 MVP 结构并携带合法验收项；缺失或非法字段不得以 historical 为由接受或补造。completed 记录必须有本版要求的匹配 SDK 证明，未完成记录保持真实状态且不执行。导入不运行验证工具、检查代码或候选准备流程。

#### Scenario: 保留全部反馈内容
- **WHEN** 带有业务事件、等待请求、失败记录、证据、经验和脑包 pending desired 的停止 Work 导出并导入
- **THEN** 内容及状态完整保留，active/desired 仍分离，所有旧请求是 historical 且不自动执行，实际加载状态直到 Start 后验证

#### Scenario: 源 outbox 不生成新副作用
- **WHEN** 接收者 Start 后 Service 读到源 Work 的旧待发请求和未终态 Job
- **THEN** 按来源及真实状态核对/显示历史，不把旧事件改成新请求或重跑任务；新用户动作生成新归属事件

#### Scenario: 新反馈继续闭环
- **WHEN** 接收者在导入工作站中产生新的明确反馈
- **THEN** 新请求使用新 Work 身份独立自动处理并采用保留经验，源 Work 与另一导入副本不受影响

#### Scenario: 偏好模型在目标环境不存在
- **WHEN** context 所需模型满足既有导入条件但源 Session 的另一个偏好模型没有目标匹配
- **THEN** 导入仍保留历史和不可用偏好，发送前明确要求选择可用模型或 Work 默认，不授权源凭据或静默替换

#### Scenario: 拒绝伪造反馈关系
- **WHEN** 历史含额外 trigger/table、跨 Work 运行关联、无依据 completed、非法阶段或悬空证据
- **THEN** 完整校验拒绝包，不丢弃非法记录后宣布导入成功或运行包携带 SQL

#### Scenario: 拒绝缺少当前验收项的候选
- **WHEN** 包内候选缺少本版必需的 verificationTarget 或完成记录没有匹配 SDK 证明
- **THEN** 静态校验拒绝导入，不补齐字段、不丢弃记录、不运行工具生成证明

#### Scenario: 验收项与证明关系被伪造
- **WHEN** 声明新能力验收项的历史把成功证明关联到其他目标、不同输入、失败 checks 或错误候选内容
- **THEN** 静态完整校验拒绝，不运行工具来修补或通过删除证据宣称包有效

#### Scenario: 两个副本分别验证新脑包行为
- **WHEN** 两份同源导入 Work 显式 Start 后各自产生新候选并由用户 Apply
- **THEN** 各自通过当前身份和固定验收项的实际 SDK 行为 checks 后完成，旧候选历史不执行，源 Work 和另一副本的状态与证据不改变

#### Scenario: 两份独立认知与再导出
- **WHEN** schema 5 Work 冷导出后导入 A 与 B，A 提交新的 Memory 并再次导出
- **THEN** A、B 与源的数据库和有效 head 相互独立，三者都能查询原 Evidence；再次导出保留 A 的新旧版本与失败/失效历史，旧目标仍不执行

#### Scenario: 失效认知与未完成候选保留历史
- **WHEN** 源 Memory 含失效条目及未提交候选，完整包被导入并 Start
- **THEN** 失效内容不进入默认 Recall，候选保留只读历史且不自动提交或生成新的 Run

#### Scenario: 拒绝无原指令证明的伪偏好
- **WHEN** 包内普通 Query 经验被改为 preference，只有 entry 被改或 entry/candidate 同时被改，或实际引用的 Evidence 不含原 Chat 偏好证明
- **THEN** TS/Go 完整校验均拒绝；不发布 Work，不以 historical 或 Query verified 接受伪造用户偏好

#### Scenario: 拒绝过期 head 但保留真实空发布
- **WHEN** 包内 head 指向存在的旧版本而有更新的持久发布，或最后一条失效后正确指向最新空版本
- **THEN** 前者拒绝，后者按原空版本、来源和历史导入；legacy null 发布时间的部分历史不被误判为新 head

#### Scenario: 导入前拒绝复制条目的来源差异
- **WHEN** 正常发布 A 后提交不同条目 B 的历史包，仅在后续版本改写 A 的 kind、createdAt 或 rule，首次发布版本及原候选/Evidence 不变
- **THEN** TS/Go 完整校验一致拒绝，原 helper 不重建该非法数据，Core 不发布导入 Work；源输入不变，没有旧模型或任务执行

#### Scenario: 合法副本重建后可被运行时打开
- **WHEN** 合法复制、修订/失效或无对应候选的合法迁移历史完成静态校验和目标身份重建，并显式启动导入 Work
- **THEN** 运行时通过同一来源校验，保留正确版本、内容和证据引用，旧请求不复活，不出现静态接受而运行时因同一来源关系拒绝的结果

### Requirement: 模型按可移植协议身份解析

**Identifier:** PWORK-MODEL-001

模型管理 id、旧内部 Provider id、API Key、secret 引用、源执行授权及目录 enabled 状态 SHALL 不成为目标安装权限或需要复制的管理对象。包内依赖按协议、Model ID、规范化端点及执行必要的非秘密定义匹配目标已保存可用模型，不要求用户提供 Provider 或能力模板；不同协议的同名模型不视为相同。

既有 provider 字段 SHALL 只保留逻辑协议/SDK 提供方语义，不能写源管理 Provider 身份。目标导入受理固定目标授权，发布前重验启停与Key，失效明确拒绝，不复制源秘密或选择另一个默认。

未知模型的普通执行定义/来源与 Thinking 未请求事实 SHALL 明确保存；不能因目标 SDK 未收录而要求手工模板。已知模型定义/Thinking、旧缺省 Off 和新 null 普通记录严格区分。Session 偏好只在唯一可确认身份匹配时重绑，歧义保留历史及不可用偏好，不按名称猜测；历史 Run 不重放，源 executionBindingId 不恢复 live 权限。

模型依赖及私有描述 SHALL 采用显式支持结构并同步 Go/TS/helper 验证，未知字段/版本不忽略。无对应可用默认继续按 PWORK-004 受理前拒绝；旧读取器无法表达新普通模式时明确不兼容，新读取器保留旧事实。

#### Scenario: 不同安装的独立模型
- **WHEN** 源包要求协议 P、Model ID M 和端点 E，目标已配置同一执行身份但管理 id 不同
- **THEN** 使用目标模型及 Key，不复制源 Provider/目录或要求用户映射

#### Scenario: 协议错配或停用
- **WHEN** 目标只有另一协议同名模型，或匹配项停用/无 Key
- **THEN** 默认依赖报 TARGET_MODEL_UNAVAILABLE，不导入源 Key或偷偷改用其他默认

#### Scenario: 相同模型的多个目标配置
- **WHEN** 多个目标条目使 Session 偏好匹配歧义
- **THEN** 历史/Thinking 保留，偏好不可用，用户显式重选后继续

#### Scenario: 未知模型普通模式往返
- **WHEN** 自定义 ID 的普通 Session 与已知 Thinking 历史导出、导入、再导出并继续
- **THEN** 普通 null/旧 Off/已知档位事实保留，目标使用自己的 Key，支持环境可继续普通消息，无模板或历史重放
