# Spec Delta

## MODIFIED Requirements

### Requirement: Manage desired and active context without public revisions

**Identifier:** WCFG-002

系统 SHALL 为每个 Work 保存一个 active context 和一个 desired context，并公开 `pendingApply` 表示二者是否不同。配置读取、修改和 apply 的 CLI、HTTP 请求及响应 MUST NOT require or expose numeric configuration revisions. Each successful update SHALL atomically replace the requested desired fields in Core commit order without interrupting the active runtime. `work config apply` SHALL capture the complete desired context accepted by that Operation; success SHALL make that captured context active, failure SHALL retain the prior active context and restore its runtime when replacement interrupted it, and an update committed during apply SHALL remain desired with `pendingApply: true` after the earlier apply completes.

Apply SHALL be a durable asynchronous Operation with an explicit idempotency key, returning `{workId, operationId, reused}` at acceptance. Repeating the same key SHALL return the same Operation without executing it again; a distinct key SHALL permit retry after a failed attempt, even for the same desired snapshot. An unchanged already validated active context SHALL complete as a no-op. Before the first successful initialization, active SHALL be null in full configuration reads, desired SHALL contain the latest accepted desired context, and pendingApply SHALL be true; Skill-list active SHALL be empty. Initial create/retry SHALL activate its captured context only after verified initialization. A stopped Work with an unvalidated candidate SHALL validate that candidate through agent initialization without accepting Runs, then confirm it stopped before activation; apply MUST NOT change the desired lifecycle state to running. Apply SHALL NOT cancel an active Run: it SHALL fail with `WORK_BUSY` before replacing its daemon, and the owner can retry after the Run completes. Later stop/delete actions SHALL fence an in-flight apply so it cannot reopen routing or overwrite their target.

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

## ADDED Requirements

### Requirement: Distinguish selected active and loaded Skills

**Identifier:** WCFG-004

Authorized Work configuration reads and Skill-list reads SHALL distinguish desired selection, active selection, `pendingApply`, and current runtime Skill status. Runtime status SHALL be `ready`, `initializing`, `failed`, or `unavailable`, with a `skills` list containing `{name, loaded, modelVisible, visibilityReason}` only for the currently verified active daemon; `checkedAt` SHALL identify the readiness observation time or be null when no current observation exists. Visibility reason SHALL be null when visible, otherwise `model-invocation-disabled` or `read-tools-disabled`, with the former taking precedence. Initializing, failed, stopped, unreachable, or stale-generation runtimes SHALL return an empty current loaded list. Stored active selection alone MUST NOT imply a currently loaded Skill. Selection arrays SHALL retain configured order and runtime Skill entries SHALL use active selection order. Existing ownership rules SHALL apply; responses MUST NOT expose internal context identities, digests, revisions, paths, or raw stored records.

#### Scenario: Save without apply
- **WHEN** active contains no Skills and the owner saves desired Skill s-a
- **THEN** the response shows desired [s-a], active [], pendingApply true, and the still-running daemon's empty loaded list

#### Scenario: Successfully apply a Skill
- **WHEN** the captured candidate containing s-a has passed SDK readiness and becomes active
- **THEN** configuration and Skill-list queries show active [s-a] and runtime ready with s-a loaded, while desired reflects any later update independently

#### Scenario: Stop or lose the daemon
- **WHEN** the daemon stops or a current readiness probe cannot verify it
- **THEN** active selection remains visible, runtime is unavailable with no current loaded entries, and a former successful load is not returned as present readiness

#### Scenario: Read another owner's Work
- **WHEN** an ordinary user requests another owner's configuration or runtime Skill state
- **THEN** the request returns the same not-found result as an absent Work and contains no Skill state

### Requirement: Support current-format context without legacy reconstruction

**Identifier:** WCFG-005

The pre-0.1 implementation SHALL initialize fresh storage and recover Work/Session data written by the resulting version without historical descriptor conversion, reconstructing missing snapshots from mutable Core/default content, or assigning unbound historical Sessions to a current context. Unsupported context formats SHALL fail explicitly with `CONTEXT_FORMAT_UNSUPPORTED`; missing required current context SHALL fail with `CONTEXT_NOT_FOUND`. The system MUST NOT automatically delete, reset, or rewrite unsupported user data.

#### Scenario: Fresh install and same-version restart
- **WHEN** a fresh installation creates a Work with Skills and a Session, then Core and agentd restart using that data
- **THEN** the same Work-owned context, Session history, and user credential remain usable without a legacy conversion pass

#### Scenario: Unsupported historical context
- **WHEN** a Work refers to an old object-shaped Skill selection or lacks required context ownership metadata
- **THEN** activation fails with the format error and safe remediation instead of importing defaults, rewriting the record, or resetting data
