# Spec Delta

## MODIFIED Requirements

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
