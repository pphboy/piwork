# Spec Delta

## MODIFIED Requirements

### Requirement: Create and control Works from the CLI

**Identifier:** CLI-WORK-001

`piwork-cli` SHALL provide Work lifecycle, `work config show`, `work config set`, field-specific configuration commands, and explicit `work config apply` without public revision arguments. `work create` SHALL accept `--base-image <image>`, repeatable `--skill <skill-name>`, `--no-skills`, `--agents-md-file <path>`, and `--config <file>`. If neither Skill option nor a `skills` field is supplied, Core SHALL copy the current default Work Skill selection; explicit Skill flags SHALL replace defaults and a configuration-file selection, while `--no-skills` SHALL select an empty set. The CLI SHALL reject duplicate names and mutually exclusive Skill options before contacting Core. Core SHALL copy selected managed Skill directories, AGENTS content, and the resolved configuration into Work-owned storage before reporting successful creation. `piwork-serve` MUST NOT create or control user Works.

SDK-invalid imported Skill bytes SHALL be diagnosed asynchronously during required initialization rather than rejected as a CLI syntax error. Both `work config set <workId> --config <file>` and `work config skills set <workId>` SHALL update desired state consistently; omitted fields in field-specific commands SHALL preserve unrelated desired fields. `--no-skills` SHALL be parsed as a boolean flag on create, per-Work Skill set, and operator default-Work set. Missing selection on the field-specific Skill-set command SHALL be a usage error, not implicit clearing. `work config apply <workId> [--wait] [--idempotency-key <key>]` SHALL report acceptance immediately unless waiting was requested and use the same durable Operation observation behavior as create/start.

#### Scenario: Create from the current default
- **WHEN** 用户运行 `piwork-cli work create --name <name> --wait` without a Skill selection
- **THEN** the Work receives independent copies of the current default Skills and other effective context, and later default or managed-Skill changes do not alter it

#### Scenario: Create with explicit Skills
- **WHEN** a user supplies one or more `--skill <skill-name>` options
- **THEN** the Work receives exactly those enabled managed Skills in the supplied order, replacing the default or configuration-file selection

#### Scenario: Create with per-Work context overrides
- **WHEN** a user supplies base image, Skills, AGENTS content, or a configuration file while creating a Work
- **THEN** explicit CLI fields take precedence over the corresponding configuration-file and default fields, and Core copies the resulting complete context into the new Work

#### Scenario: Create with no Skills
- **WHEN** a user supplies `--no-skills`
- **THEN** the Work is created with an empty Skill directory and does not inherit default Skills

#### Scenario: Reject invalid create context
- **WHEN** a create request repeats a Skill, combines `--skill` with `--no-skills`, names a missing or disabled Skill, or supplies a missing, unreadable, or oversized AGENTS file
- **THEN** the CLI exits with a usage or validation error, no Work becomes visible, no partial Work context remains, and no secret or host path is disclosed

#### Scenario: Update one Work only
- **WHEN** a user changes Work A configuration without an expected-revision argument
- **THEN** only Work A's desired context changes, later successfully committed updates replace earlier desired values, and other Works and global defaults remain unchanged

#### Scenario: Set Skills and AGENTS independently
- **WHEN** an owner invokes `work config skills set <workId> --skill <name>...`, `work config skills set <workId> --no-skills`, or `work config agents set <workId> --file <path>`
- **THEN** Core copies the requested content into that Work's desired context, preserves unrelated fields, and leaves the running active context unchanged

#### Scenario: Apply pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>`
- **THEN** the CLI submits one apply operation for the desired context captured at acceptance, reports its stable Operation identifier, and does not require a revision or silently cancel an active Run

#### Scenario: Apply a pending Work configuration explicitly
- **WHEN** an owner invokes `piwork-cli work config apply <workId>` while `pendingApply` is true
- **THEN** the CLI applies the desired context captured by that Operation without an expected-revision option and reports the durable Operation state

#### Scenario: Create and wait for a ready Work
- **WHEN** a logged-in user invokes `piwork-cli work create --name <name> --wait` against a configured installation
- **THEN** the CLI returns the stable Work identifier, follows its Operation, and exits successfully only after the Work-owned context is mounted and agentd is ready

#### Scenario: Show a Work preparation failure
- **WHEN** Docker, the image, model configuration, or agent readiness causes an accepted create Operation to fail
- **THEN** the CLI displays the stable Work and Operation identifiers plus a safe actionable failure and exits nonzero

#### Scenario: Stop and restart one Work
- **WHEN** an owner stops a ready Work and later starts it with `--wait`
- **THEN** the CLI observes both Operations and the Work becomes ready again with its retained Work-owned context and data

#### Scenario: Clear Skills through the documented flag
- **WHEN** the owner uses `work config skills set <workId> --no-skills` and successfully applies
- **THEN** desired and active Skills become empty, the ready runtime reports no loaded Skills, and AGENTS/model/image/tool fields are preserved

#### Scenario: Set Skills through configuration JSON
- **WHEN** the owner supplies a valid configuration file with skills [s-a] to the generic set command
- **THEN** it produces the same desired Skill snapshot and pending state as the field-specific set command with s-a, without changing active Skills before apply

#### Scenario: SDK-invalid creation is an Operation failure
- **WHEN** an enabled managed Skill has bytes that pass Core tree validation but fail SDK loading
- **THEN** create returns the accepted Work and Operation, initialization fails before ready, and `--wait` shows the Skill error with those identifiers and exits 6

#### Scenario: Repeated apply key
- **WHEN** a caller repeats an apply with the same idempotency key
- **THEN** the CLI receives the original Operation and reused true, without causing another initialization

## ADDED Requirements

### Requirement: Explain Skill state and durable failures through the CLI

**Identifier:** CLI-DIAG-001

`work config show` and `work config skills list` SHALL display desired, active, pendingApply, and current runtime load state defined by WCFG-004. Set responses in text mode SHALL explain that changes are pending until apply; JSON SHALL expose the structured state. Accepted Work commands with `--wait` SHALL output exactly one JSON value in JSON mode: `{workId, operationId, correlationId, state, result, error, diagnostics}` for a terminal Operation, or those identifiers with state `waiting` and a safe wait error if observation fails. Without `--wait`, output SHALL be the acceptance object. Text-mode failures SHALL show Work ID, Operation ID, stage, code, safe reason, remediation, and the `operation show` command. `operation show` SHALL expose the durable structured result/error including rollback and diagnostic-collection outcome, even after Core restart or container removal. It SHALL exit 0 when the query succeeds, including for a failed Operation; waiting exits SHALL be 0 for succeeded, 6 for failed/superseded, and 5 for timeout/unavailable observation. Existing usage/authentication exits SHALL remain unchanged. JSON stdout MUST NOT be polluted by progress logs or multiple result objects.

#### Scenario: See a saved but inactive Skill
- **WHEN** the owner sets s-a and then runs Skill-list before apply
- **THEN** text and JSON distinguish desired s-a from unchanged active/current loaded state and make pendingApply visible

#### Scenario: See and revisit the root cause
- **WHEN** `work create --wait` fails because agentd could not load a selected Skill
- **THEN** the CLI exits 6 and displays the Skill/stage/code and Operation ID; a later authorized `operation show` returns the same primary diagnostic and exits 0

#### Scenario: Wait without losing the Operation
- **WHEN** waiting times out or loses Core connectivity after acceptance
- **THEN** the CLI exits 5, retains Work and Operation identifiers in its output, does not resubmit, and directs the caller to `operation show`

#### Scenario: One machine-readable failure
- **WHEN** a caller uses `--json work config apply <workId> --wait` and initialization fails
- **THEN** stdout contains one parseable terminal envelope including the structured diagnostic and no raw stack, internal path, or earlier acceptance JSON
