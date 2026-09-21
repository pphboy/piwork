# Work Configuration Specification

## Purpose

定义用户如何为每个 Work 选择和更新可重现的运行环境，使基础镜像、Skills、MCP、模型引用及资源策略有明确版本，并让用户区分保存的期望配置、当前实际配置以及无法生效的具体原因。

## Requirements

### Requirement: Select a complete Work environment

**Identifier:** WCFG-001

系统 SHALL 维护全局默认 Work configuration 和每个 Work 的独立 active/desired context。创建 Work 时，系统 SHALL 将当时的默认配置与用户显式覆盖解析为最终配置，并将 base image identity、model、完整 Skills、`AGENTS.md` 内容、MCP、工具和资源策略复制或记录到 Work-owned durable context。未提供 Skill selection 时 SHALL 使用默认 Skills；显式 Skill names SHALL replace defaults；explicit no-Skills SHALL produce an empty set. Default changes MUST NOT mutate an existing Work. Public queries MUST NOT expose secrets, import paths, managed-storage paths, internal digests, or configuration revisions.

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

### Requirement: Validate environment compatibility

系统 SHALL 验证配置结构、引用权限、agent 镜像兼容性和工具运行条件，并将异步准备失败关联到配置字段及 Operation。无法解析的镜像、缺失模型配置或不兼容入口 MUST NOT 被报告为可用 Work。

#### Scenario: Invalid reference before acceptance

- **WHEN** 创建请求引用不存在或无权使用的模型／Skill
- **THEN** 请求被拒绝并指出无效字段，不创建可运行实例

#### Scenario: Image fails during preparation

- **WHEN** 接受的配置在拉取镜像或启动兼容入口时失败
- **THEN** Work 和配置保留，Operation 提供失败原因，用户可以修正或重试

### Requirement: Manage desired and active context without public revisions

**Identifier:** WCFG-002

系统 SHALL 为每个 Work 保存一个 active context 和一个 desired context，并公开 `pendingApply` 表示二者是否不同。配置读取、修改和 apply 的 CLI、HTTP 请求及响应 MUST NOT require or expose numeric configuration revisions. Each successful update SHALL atomically replace the requested desired fields in Core commit order without interrupting the active runtime. `work config apply` SHALL capture the complete desired context accepted by that Operation; success SHALL make that captured context active, failure SHALL keep the prior active context usable, and an update committed during apply SHALL remain desired with `pendingApply: true` after the earlier apply completes.

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
- **THEN** the Operation fails with the Work and public field, active remains unchanged, desired remains available for correction or retry, and no partial context is used by a Run

#### Scenario: Order concurrent desired updates
- **WHEN** two authorized updates to the same desired field commit concurrently
- **THEN** the later Core commit is the desired value and the public response contains no revision conflict or revision number

### Requirement: Resolve reproducible artifacts

**Identifier:** WCFG-003

系统 SHALL 为每个 accepted Work context retain immutable image identity, complete copied Skill trees, `AGENTS.md`, and effective non-secret configuration inside Work-owned durable storage. Start, restart, Core recovery, and apply MUST use the Work-owned captured content rather than rereading defaults, Core Skill source imports, operator paths, or mutable external references. Adopting changed Core-managed Skill content SHALL require a new explicit Work Skill selection followed by apply.

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

### Requirement: Expose and enforce supported resource policy

系统 SHALL 查询可支持的资源限制与有效策略，并拒绝无法实际执行的强制限制。第一版 SHALL 执行服务数量、CPU 和内存预算；未支持硬存储字节限制的后端 SHALL 返回 UNSUPPORTED_LIMIT，而不能仅保存一个无效数值。

#### Scenario: Unsupported storage limit

- **WHEN** 用户在不支持硬存储限额的后端请求强制 storage_bytes
- **THEN** 配置被明确拒绝，现有有效配置保持不变
