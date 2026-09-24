# Spec Delta

## Purpose

定义 Work 作为可移植完整工作空间的组成、内容闭包、版本及身份边界，使导出包能够在另一所有者名下恢复代码、数据、开发环境和历史，而不继承源平台权限或隐式重建丢失内容。

用户目标是 Work 整体搬家：导出、导入、启动后接着使用，不需要手工筛选文件、重装依赖、重建服务或理解内部历史格式。

## ADDED Requirements

### Requirement: Define a versioned complete Work aggregate

**Identifier:** PWORK-001

系统 SHALL 区分 Work Spec（版本化内容清单与关系）、Work Package（Spec 加完整制品字节）、Work Instance（归属接收者的运行实例）。v1 Spec SHALL 声明 formatVersion=1、snapshotKind=cold-full、包生成时间、源 Work 名称、Linux OS/architecture/variant、agent protocol、Work history schema、storage layout、active/desired context 引用、所有保留 context、服务 heads/revisions、Work 持久资源预留、恰好两个受管持久卷及其当前 Work/service 引用、存储树、历史记录、固定镜像、平台依赖描述及逐制品大小/SHA-256。Spec SHALL 包含完整闭包：每个受管引用恰有一个目标，空集合显式为空，active 未初始化时为 null，不能以目标端默认值补缺。持久资源预留 SHALL 恰有一条 agent 记录及每个保留 service（包括 tombstone）各一条记录，保留非负的 desired CPU/内存和 service/volume slots；记录引用包内逻辑 service key，不携带源平台 subject ID。两个卷 SHALL 各有一个隐含 Work 引用；workspace 的 service 引用 SHALL 以去重有序的包内 service key 显式记录，agent-private 不允许 service 引用。缺少或多出预留/卷引用记录、重复逻辑键、悬空引用、缺失制品、未知字段/组件或版本 SHALL 返回 PACKAGE_INVALID 或 PACKAGE_FORMAT_UNSUPPORTED，不能静默忽略。

v1 SHALL 使用 design.md 中确定的公开二进制 framing 和 JSON manifest 合约；软件发行版本、包格式版本和应用用户文件中的版本 MUST NOT 混同。未来新增组件 SHALL 通过明确的格式版本演进；v1 不接受未知组件，即使被发送者称为可选。

Work Spec SHALL 是完整快照的清单，而不是要求用户编写的重建配方。系统 SHALL 复用原生历史记录归档；控制历史 requestJson/resultJson/errorJson 内部内容为只读不透明字符串，不属于需逐字段转换的运行合约，未知历史 kind 不等同于未知包组件。格式、身份映射与校验由系统完成，不能要求用户提供历史迁移脚本。

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

### Requirement: Preserve the full owned persistent content

**Identifier:** PWORK-002

完整包 SHALL 包含 workspace 与 agent-private 卷的全部可表示持久内容及其当前服务引用、全部保留 Work context/Skill/AGENTS 字节、所有服务定义版本与 tombstone、Work 配置历史、Work 的持久资源预留、Session/Run 数据和 SDK 历史、已保留的 Work-scoped 控制 Operation 历史，以及所有已绑定固定镜像本体。持久预留 SHALL 取源 Work 的实际 desired 值；即使 service 已 disabled 或 tombstone，只要原记录仍持有预算，也不能从其开关或最新定义推断为零。运行占用计数和源平台记账时间不作为目标 Work 的持久预留复制。隐藏文件、Git、业务数据库、依赖、虚拟环境、用户目录工具、持久缓存和用户存入的凭证 SHALL NOT 按路径、扩展名、用途或敏感性过滤；既有文件元数据限制按 WSTOR-SNAPSHOT-001 整体拒绝，不能漏项成功。导出不改变源内容，不清理缓存，不安装依赖，不扫描后改写秘密。

平台派生容器/网络/证书、Core 用户和登录数据库、operator credential、平台托管 secret 值及存储路径、宿主共享数据、已清除的数据、Docker 临时日志、容器临时可写层、匿名卷、tmpfs、内存和网络连接 SHALL NOT 属于 Work 持久内容。服务业务数据仅在现有获准 workspace 内具有持久语义；不能把未受管容器内容宣称为已搬迁。远程数据库/自定义外部 MCP/模型仅保留配置或平台依赖描述，不宣称包含其服务端数据；内置 `work-services` 是目标 Core 提供的能力，不是需要迁移的远程 MCP 服务。被用户复制进 Work 文件或 service environment 的平台凭证副本仍属于不做过滤的用户字节；文档和导出提示 SHALL 明确包可能包含密钥及私人历史。

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

### Requirement: Transfer captured environments without substituting dependencies

**Identifier:** PWORK-003

包 SHALL 携带各 context 和已解析服务 revision 的实际固定镜像，去重但不省略镜像层；接收端 SHALL 校验镜像身份和运行平台，不能跟随 mutable tag、更换 agent 镜像、拉取替代镜像或自动升级。未解析的历史服务 revision SHALL 保留 unresolved 状态，不在导出时解析 tag；存在已绑定但丢失的镜像 SHALL 使导出以 SNAPSHOT_IMAGE_MISSING 失败。未解析的当前服务保留其失败/未完成准备事实，不能被宣称可离线启动。v1 SHALL 仅支持 Linux 且 OS/architecture/variant 与目标 Docker 一致、agent protocol 受支持、history schema=3、storage layout=2 的包；不兼容 SHALL 在创建 Work 之前返回 PACKAGE_INCOMPATIBLE。镜像不受信任，校验/导入阶段 MUST NOT 运行包内 ENTRYPOINT、hooks、shell、MCP 或模型请求。

#### Scenario: Import without the original registry
- **WHEN** 源固定镜像已打包且目标无法访问原 registry
- **THEN** 导入能够恢复镜像和磁盘环境，并在显式启动时使用相同镜像身份

#### Scenario: Do not fabricate absent history
- **WHEN** 一个历史服务 revision 从未成功解析镜像
- **THEN** 导出保留其原引用和 unresolved 状态，不用当前 tag 冒充当时的固定镜像

#### Scenario: Reject another architecture
- **WHEN** 接收端平台与包声明或镜像平台不同
- **THEN** 导入返回 PACKAGE_INCOMPATIBLE，不自动模拟或下载替代环境

### Requirement: Instantiate independent identity with automatic platform resolution

**Identifier:** PWORK-004

导入 SHALL 生成新 Work、service、context、控制 Operation 和卷身份，使用接收者身份、目标名称与目标创建时间建立所有权，并一致映射包内逻辑引用，不继承源用户权限或源控制幂等作用域。调用者未指定名称时 SHALL 使用包内源名称作为候选，若已有同名 Work（包括已删除记录或在途导入）则自动添加唯一后缀；显式指定的名称冲突 SHALL 拒绝，不覆盖或合并。源名称和源创建时间仍作为历史/provenance 保存，不覆盖目标实例创建时间。导入发布时 Work 与服务保持 stopped/disabled，不创建 Work 的 agent/service 容器、运行网络或 TLS 凭证；接收者显式启动时才建立新的运行代次、网络和 TLS 身份，不复用源代次或证书。Session/Run ID SHALL 保留为新 Work 内的局部身份，查询必须带 Work scope。历史文本、代码、应用数据库、任意用户 URL 或字面 ID SHALL NOT 被搜索替换；仅受管 schema 中声明的身份字段被映射。源身份映射作为 owner-only provenance 保存，不能授权访问源资源。

v1 包内既有 `bindings` 清单字段 SHALL 保留为模型及可选自定义 MCP secret 的平台依赖描述，以便已经生成的无自定义 MCP secret 的 `.work` 包仍可导入；它不是调用者需填写的映射。导入请求 SHALL NOT 要求或接受用户提供的 bindings。目标 Core SHALL 为每个模型要求按 provider、model 与规范化 baseUrl 自动选取已启用且凭证可读的目标模型，并在接受任务时固定目标 catalog 与凭证引用；源模型 ID 和源模型 key SHALL NOT 被当作目标权限。目标没有匹配模型 SHALL 在接受前返回 TARGET_MODEL_UNAVAILABLE，而不是复制源模型 key 或更换成不匹配的默认模型。内置 `work-services` SHALL 不产生 secret 要求；它在目标 Work 启动时使用目标 Core 新建立的服务控制身份。v1 暂不迁移自定义外部 MCP 的平台 secret：包若声明任何此类 secret 要求，导入 SHALL 在接受前返回 EXTERNAL_MCP_SECRET_UNAVAILABLE，不创建 Work，也不要求用户提供 bindings。原用户文件中自行配置的外部账号保持原样，不保证该外部账号归属改变。

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
