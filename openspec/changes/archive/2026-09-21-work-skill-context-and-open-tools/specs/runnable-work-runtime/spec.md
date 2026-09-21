# Spec Delta

## ADDED Requirements

### Requirement: Enable the full container tool set

**Identifier:** RUNTIME-TOOLS-001

每个隔离 Work 容器中的 Pi SDK SHALL 默认启用完整内置工具集：`read`、`bash`、`edit`、`write`、`grep`、`find` 和 `ls`。Work 配置中的 `tools.allowed` 与 `tools.denied` SHALL 作为最终策略：allowed 为空表示不额外收窄，denied 优先于 allowed；策略解析后的工具集合必须通过 agentd readiness 报告。该开放仅适用于隔离容器内的内置工具，不得授予 Docker socket 或宿主路径访问。

#### Scenario: Default tools are available in a Work
- **WHEN** a Work starts with no tool deny policy
- **THEN** the agent session exposes all seven listed built-in tools and readiness reports the resolved set

#### Scenario: Denied tools are excluded
- **WHEN** a Work configuration denies `bash` and `write`
- **THEN** those tools are unavailable to the Pi SDK session while the other allowed built-in tools remain available

#### Scenario: Reject unsupported tool policy
- **WHEN** a configuration names an unknown built-in tool or attempts to grant a host or Docker capability
- **THEN** configuration activation fails with a public validation error and the Work is not reported ready

## MODIFIED Requirements

### Requirement: Materialize each Work into an isolated Docker runtime

**Identifier:** RUNTIME-MATERIALIZE-001

Creating or starting a Work SHALL resolve its configured agent image and model profile, materialize its active base image, Skills, `AGENTS.md`, runtime configuration, and tool policy into an isolated context, create or adopt one labeled Work network, persistent data/session storage, generation-specific runtime identity, and one agentd container, then wait for verified readiness. Repeating reconciliation MUST adopt matching resources and MUST NOT create two active agentd instances for one Work. The container SHALL receive only that Work's materialized context and MUST NOT mount the host user's Skills directory.

#### Scenario: Start one Work from an accepted configuration
- **WHEN** Core reconciles a valid Work whose desired state is running
- **THEN** exactly one agentd container starts with the Work's data, session, materialized Skills and AGENTS context, runtime configuration, model credential reference, resource limits, and private network

#### Scenario: Reconcile an existing instance
- **WHEN** Core repeats reconciliation after losing its process state
- **THEN** it adopts the matching labeled container and storage after verification instead of creating a duplicate

#### Scenario: Reject context materialization failure
- **WHEN** a selected Skill, AGENTS content, or base image cannot be materialized for the active revision
- **THEN** the Operation fails with the Work and field identity, the old active revision remains active, and no partially materialized context is used by a Run

### Requirement: Execute Runs through the real Pi SDK

**Identifier:** RUNTIME-PI-001

Agentd SHALL durably accept a prompt and submission key, execute the Run with the configured model through the Pi SDK, persist ordered mapped events and a unique terminal state, and save the resulting Session history. A client or Core observation disconnect MUST NOT abort execution; explicit cancellation MUST request SDK abort and persist the resulting state. Each Session SHALL be constructed with the active Work resource loader (its Skills and AGENTS content) and resolved tool policy.

#### Scenario: Receive a deterministic acceptance reply through the real stack
- **WHEN** the acceptance fixture submits a prompt to a real agentd container configured with the deterministic model
- **THEN** the real Pi SDK executes it, agentd persists its events and result, and the CLI receives the expected assistant text through Core

#### Scenario: Use a real configured model
- **WHEN** the optional smoke is enabled with valid provider credentials and a user submits a prompt
- **THEN** agentd executes the Run through the configured real Pi SDK model and returns a non-empty assistant result

#### Scenario: Session context is loaded from the Work
- **WHEN** a Run starts for a Work with active Skills and AGENTS content
- **THEN** the Pi SDK resource loader exposes exactly that Work context and the assistant can use its instructions without reading another Work or the host user directory

#### Scenario: Retry a lost submit response
- **WHEN** Core repeats the same Session, submission key, and prompt after losing the first response
- **THEN** agentd returns the original Run and does not invoke the model a second time
