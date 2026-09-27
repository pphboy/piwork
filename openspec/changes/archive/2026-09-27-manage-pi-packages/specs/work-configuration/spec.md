# Spec Delta

## MODIFIED Requirements

### Requirement: Select a complete Work environment

**Identifier:** WCFG-001

系统 SHALL 维护全局默认 Work configuration 和每个 Work 的独立 active/desired context。创建 Work 时，系统 SHALL 将当时的默认配置与用户显式覆盖解析为最终配置，并将 base image identity、model、完整 Skills、Pi package 制品及运行依赖、`AGENTS.md` 内容、MCP、工具和资源策略复制或记录到 Work-owned durable context。未提供 Skill selection 时 SHALL 使用默认 Skills；显式 Skill names SHALL replace defaults；explicit no-Skills SHALL produce an empty set. Default changes MUST NOT mutate an existing Work. Public queries MUST NOT expose secrets, import paths, managed-storage paths, internal digests, or configuration revisions.

最终 V1 的完整 Work configuration SHALL 包含必需 `packages: [{name, enabled}]`，无包时显式 []，最多 64 个唯一 name，按 name 的 UTF-8 字节顺序规范化。创建时 package flags > 配置文件 packages > 当前默认集合；显式选择替换默认、显式空集合不继承。选中包 SHALL 从 enabled Core catalog 原子捕获当时完整制品并复制到 Work-owned context，enabled=false 也保留 bytes；任一复制/验证失败不得发布部分 Work。普通既有 Work config set SHALL 只选择已存在于该 Work desired 的包，不隐式从 Core 安装或刷新同名内容，新增包必须显式 install。

#### Scenario: Copy defaults at creation
- **WHEN** defaults select model-a, Skills s-a and s-b, and AGENTS text-a when Work A is created, then defaults change
- **THEN** Work A retains independent active and desired copies of the original effective context and only a later Work receives the new defaults

#### Scenario: Create with explicit Skills
- **WHEN** a user creates a Work with one or more enabled Skill names
- **THEN** Core copies exactly those complete Core-managed Skill directories into Work-owned context before the Work becomes ready

#### Scenario: Create a configured Work
- **WHEN** a user creates a Work with valid image, model, Skill, AGENTS, MCP, tool, and resource selections
- **THEN** Core stores the complete effective Work-owned context and the ready runtime reports the corresponding public configuration without secrets or revisions

#### Scenario: Create with no Skills
- **WHEN** a user explicitly requests no Skills
- **THEN** Core creates a valid empty Work-owned Skills directory and imports no host or global Skill

#### Scenario: Configure one Work
- **WHEN** the owner updates Work A's image, model, Skills, MCP, AGENTS content, tools, or resources
- **THEN** only Work A's desired context changes and the response reports active, desired, and `pendingApply` without secrets or revisions

#### Scenario: Reject host-path context references
- **WHEN** a Work request attempts to persist an AGENTS path or arbitrary Skill path instead of content or a managed Skill name
- **THEN** the request is rejected and no host path is saved in Work runtime context

#### Scenario: Fail context copy atomically
- **WHEN** any selected managed Skill cannot be fully copied and validated while creating or updating a Work
- **THEN** no Work or desired-context change is committed and no partial copied tree remains visible

#### Scenario: Secret query
- **WHEN** a user queries a Work containing model or MCP credential references
- **THEN** Core returns availability and safe container references without returning secret plaintext or protected host paths

#### Scenario: Copy package defaults once
- **WHEN** Core 默认 tools=v1，创建 A 后 Core 更新至 v2，再创建 B
- **THEN** A 保留独立 v1，B 捕获 v2；两个 Work 的安装/开关/移除互不影响

#### Scenario: Explicit package selection and empty selection
- **WHEN** 创建时显式选择 tools 或显式 packages=[]
- **THEN** 分别只复制 tools 或创建空 package 集合，不额外合并默认包

#### Scenario: Reject implicit package installation by config set
- **WHEN** 既有 Work config set 引用未在该 Work desired 安装的 name
- **THEN** 返回 PI_PACKAGE_NOT_FOUND 并提示先 install，原 desired 不变

### Requirement: Manage desired and active context without public revisions

**Identifier:** WCFG-002

系统 SHALL 为每个 Work 保存一个 active context 和一个 desired context，并公开 `pendingApply` 表示二者是否不同。配置读取、修改和 apply 的 CLI、HTTP 请求及响应 MUST NOT require or expose numeric configuration revisions. Each successful update SHALL atomically replace the requested desired fields in Core commit order without interrupting the active runtime. `work config apply` SHALL capture the complete desired context accepted by that Operation; success SHALL make that captured context active, failure SHALL retain the prior active context and restore its runtime when replacement interrupted it, and an update committed during apply SHALL remain desired with `pendingApply: true` after the earlier apply completes.

Apply SHALL be a durable asynchronous Operation with an explicit idempotency key, returning `{workId, operationId, reused}` at acceptance. Repeating the same key SHALL return the same Operation without executing it again; a distinct key SHALL permit retry after a failed attempt, even for the same desired snapshot. An unchanged already validated active context SHALL complete as a no-op. Before the first successful initialization, active SHALL be null in full configuration reads, desired SHALL contain the latest accepted desired context, and pendingApply SHALL be true; Skill-list active SHALL be empty. Initial create/retry SHALL activate its captured context only after verified initialization. A stopped Work with an unvalidated candidate SHALL validate that candidate through agent initialization without accepting Runs, then confirm it stopped before activation; apply MUST NOT change the desired lifecycle state to running. Apply SHALL NOT cancel an active Run: it SHALL fail with `WORK_BUSY` before replacing its daemon, and the owner can retry after the Run completes. Later stop/delete actions SHALL fence an in-flight apply so it cannot reopen routing or overwrite their target.

Pi package install/update/enable/disable/remove SHALL 遵循同一 desired/active/apply 契约，安装 Operation 成功只代表 desired 已提交。package 内容身份也参与 pendingApply，即使 name/version 相同而 bytes 不同。apply SHALL 验证 PKGA-001 至 PKGA-005；stopped 验证、active Run 门禁、失败回退和稍后 desired 编辑保留均适用于 package。

#### Scenario: Update without implicit restart
- **WHEN** a user changes model, Skills, AGENTS content, base image, MCP, tools, or resources for a running Work
- **THEN** Core stores a complete desired context, returns `pendingApply: true`, and leaves the active runtime and active Runs unchanged

#### Scenario: Apply the desired context
- **WHEN** a user invokes apply while desired differs from active
- **THEN** Core prepares and starts the captured desired context, marks it active only after readiness succeeds, and then reports `pendingApply: false` unless a later desired update exists

#### Scenario: Preserve a later edit during apply
- **WHEN** apply captures context B while A is active and a later update commits desired context C before B becomes ready
- **THEN** successful apply makes B active, preserves C as desired, and reports `pendingApply: true`

#### Scenario: Fail an invalid apply safely
- **WHEN** copied Skill content, AGENTS content, image, model, or runtime validation prevents the captured desired context from becoming ready
- **THEN** the Operation fails with the Work and public field, active remains unchanged, desired remains available for correction or retry, and no partial context is used by a Run; if restoration fails, Work reports failed rather than ready

#### Scenario: Order concurrent desired updates
- **WHEN** two authorized updates to the same desired field commit concurrently
- **THEN** the later Core commit is the desired value and the public response contains no revision conflict or revision number

#### Scenario: Initial Skill loading fails
- **WHEN** a newly accepted Work fails required SDK initialization before its first activation
- **THEN** full configuration shows active null, desired retains the latest accepted configuration, pendingApply is true, current loaded Skills are empty, and the failed create Operation identifies its captured candidate failure

#### Scenario: Retry failed apply without changing Skills
- **WHEN** apply fails due to a transient dependency, the owner retries with a new key, and that dependency recovers
- **THEN** a new Operation validates the same retained candidate and can succeed; repeating either original key returns its original Operation and does not execute again

#### Scenario: Apply while a Run is active
- **WHEN** an apply requiring replacement reaches execution while a Run is active
- **THEN** it fails with `WORK_BUSY`, preserves the running context and Run, and leaves desired configuration pending

#### Scenario: Validate a stopped Work
- **WHEN** apply is requested for a stopped Work with a new Skill selection
- **THEN** success requires SDK initialization of the candidate and confirmed shutdown, active becomes the validated candidate, Work remains stopped, and current runtime Skill status is unavailable rather than loaded

#### Scenario: Rollback also fails
- **WHEN** candidate initialization fails and the previous active daemon cannot be restored
- **THEN** active data remains unchanged, desired remains available, Work reports failed with conversation routing closed, and the Operation retains both primary failure and rollback failure

#### Scenario: Stop supersedes apply
- **WHEN** stop or delete is accepted while a candidate is initializing
- **THEN** apply becomes superseded, cannot activate the candidate or report ready, and the later lifecycle target controls cleanup

#### Scenario: Same declared version different package content
- **WHEN** 已安装 tools@1.0.0 更新为同名同版本但不同 bytes
- **THEN** desired 被视为新 context、pendingApply=true；普通重启继续 active 旧 bytes

### Requirement: Resolve reproducible artifacts

**Identifier:** WCFG-003

系统 SHALL 为每个 accepted Work context retain immutable image identity, complete copied Skill trees, `AGENTS.md`, and effective non-secret configuration inside Work-owned durable storage. Start, restart, Core recovery, and apply MUST use the Work-owned captured content rather than rereading defaults, Core Skill source imports, operator paths, or mutable external references. Adopting changed Core-managed Skill content SHALL require a new explicit Work Skill selection followed by apply.

每个 context SHALL 同时保留完整 package trees、运行依赖、开关与内容绑定。启动/重启/恢复 SHALL 不再访问 npm/Git/local/ZIP 或当前 Core 包库。采用 Core 新内容 SHALL 要求显式 Work package update --from-core 后 apply；普通字段编辑及重复选择已有 Work 包不能刷新其内容。

#### Scenario: Mutable tag changes
- **WHEN** a stopped Work's original image tag points to another image before restart
- **THEN** the Work uses its recorded immutable image identity and does not silently upgrade

#### Scenario: Managed Skill changes
- **WHEN** a Core-managed Skill is updated, disabled, or removed after Work A copied it
- **THEN** Work A continues to start and run with its own complete Skill copy while later Work creation observes the current Core-managed state

#### Scenario: Stable Skill and AGENTS revision
- **WHEN** Core-managed Skill content or default AGENTS content changes after Work A captured its active context
- **THEN** Work A restarts with its retained Skill and AGENTS copies and can adopt changed content only through an explicit desired update and apply, without exposing a revision

#### Scenario: Source directory disappears
- **WHEN** the operator source path used to import a Skill is moved or deleted after Core accepted it
- **THEN** Core can still create Works from its managed copy and existing Works can restart from their owned copies

#### Scenario: Preserve packages on an unrelated edit
- **WHEN** 用户仅修改 model、tools 或 AGENTS，当前 Core 同名包已变化或消失
- **THEN** 新 desired 继续引用 Work 原有包制品，成功与否不依赖 Core 同名包

### Requirement: Support current-format context without legacy reconstruction

**Identifier:** WCFG-005

The final MVP V1 implementation SHALL initialize fresh storage and recover Work/Session data written by the resulting version without historical descriptor conversion, reconstructing missing snapshots from mutable Core/default content, or assigning unbound historical Sessions to a current context. Unsupported context formats SHALL fail explicitly with `CONTEXT_FORMAT_UNSUPPORTED`; missing required current context SHALL fail with `CONTEXT_NOT_FOUND`. The system MUST NOT automatically delete, reset, or rewrite unsupported user data.

本 change SHALL 直接定义包含 package 的最终 MVP V1，不提供旧 Work/context/存储/`.work` 迁移、双版本读取或缺字段补空。最终 context SHALL 显式包含 packages、packageBindings 和 packageContractVersion=1；缺字段按 CONTEXT_FORMAT_UNSUPPORTED 处理，缺少现行格式引用的制品按 CONTEXT_NOT_FOUND 或 PI_PACKAGE_ARTIFACT_MISSING 处理。启动旧非空持久 store SHALL 在迁移前返回 CORE_STORAGE_FORMAT_UNSUPPORTED，原数据不变；新 V1 同版本重启必须可恢复。

#### Scenario: Fresh install and same-version restart
- **WHEN** a fresh installation creates a Work with Skills and a Session, then Core and agentd restart using that data
- **THEN** the same Work-owned context, Session history, and user credential remain usable without a legacy conversion pass

#### Scenario: Unsupported historical context
- **WHEN** a Work refers to an old object-shaped Skill selection or lacks required context ownership metadata
- **THEN** activation fails with the format error and safe remediation instead of importing defaults, rewriting the record, or resetting data

#### Scenario: Do not backfill packages into old contexts
- **WHEN** 旧 context 缺少 packages 或 packageContractVersion
- **THEN** 明确拒绝，不推断空集合或用 Core 默认补齐

#### Scenario: Fresh empty package configuration
- **WHEN** 新 V1 Work 没有选择任何 package
- **THEN** 配置、context 和导出清单均显式记录空集合，并支持同版本重启

### Requirement: Restore owned contexts without recopying recipient defaults

**Identifier:** WCFG-SNAPSHOT-001

导入 SHALL 恢复包内全部保留 context 的 Skills/AGENTS/有效配置、MCP 列表、工具权限和固定镜像，保持 active/desired 指向关系、active=null 和 pendingApply；不得从接收者全局 Skills 或默认配置重新复制。所需模型按 PWORK-004 在目标 Core 自动解析，image/context 使用 Work-owned 导入记录，不修改全局 catalog、默认值或同名 Skill。内置 `work-services` 原配置若存在 SHALL 保留，若被源 Work 显式移除 SHALL 不从目标默认配置重新添加；它不需要平台 secret 引用。后续仅修改无关字段 SHALL 保留已导入 Skill 和 image；只有显式重新选择相应字段才采用正常 catalog 解析。Skill 全树仍遵循现有安全格式，不扩大 host-path 权限。

导入 Work 首次 start SHALL 使用导入 active context（若存在）；待应用 desired 仅通过显式 apply 激活，不能因新安装自动生效。active=null 的包保留未初始化语义，首次显式 start 按现有初始化路径验证 desired。源平台的 runtimeProfile credentialRef SHALL 替换为接受导入时自动选定的接收方模型凭证引用，不能复制源密钥或宿主路径；运行时由目标 Core 注入模型 key。

导入 SHALL 同时恢复全部 retained context 的 package bytes/dependencies/bindings/enabled，保留 active/desired/pendingApply 和历史引用；目标 Core 同名包或默认 package SHALL 不参与恢复。只修改无关字段必须保留 imported package bytes，之后显式 --from-core 才采用当前接收 Core 的 enabled head。当前 runtime loaded 状态在 stopped 导入后 SHALL 为 unavailable，不从源状态复制。

#### Scenario: No managed Skill exists on the recipient
- **WHEN** 包内有完整 Skill s-a，接收方全局没有 s-a
- **THEN** 导入与后续启动使用包内副本，不要求 operator 导入 s-a

#### Scenario: Preserve unapplied changes
- **WHEN** active=A、desired=B 的包被导入并显式启动
- **THEN** 使用 A，pendingApply 仍为 true，只有显式 apply 才尝试 B

#### Scenario: Preserve imported assets on an unrelated edit
- **WHEN** 导入后用户仅修改 tools 配置并 apply
- **THEN** 原 Skill/image 副本保持不变，不因源 catalogId 在接收方不存在而失败

#### Scenario: No successful source initialization
- **WHEN** active=null 的合法包导入
- **THEN** active 仍为 null，导入不宣称 ready，首次显式 start 验证 desired 后才激活

#### Scenario: Preserve built-in service tools across installations
- **WHEN** 包的 active context 含有效内置 `work-services` MCP 与相应工具权限，并导入另一安装
- **THEN** 首次显式启动发现并注册同一组允许的 service 工具，目标 Core 注入新的控制连接与运行身份，不使用源 Core 地址或证书

#### Scenario: Do not reintroduce removed service tools
- **WHEN** 包的 active context 已显式移除 `work-services`
- **THEN** 目标默认配置即使含该 MCP，导入后也不自动添加或授权其工具

#### Scenario: Recipient catalog has a different package
- **WHEN** 导入包含 tools v1，目标 Core 没有该包或只有同名 v9
- **THEN** 导入及显式 start 使用包内 active v1，target catalog 不变，不下载或重装

#### Scenario: Imported desired remains pending
- **WHEN** 导入 active v1、desired v2，含 disabled 包和旧历史 v0
- **THEN** 全部制品与开关保留，start 使用 v1，只有显式 apply 验证 v2
