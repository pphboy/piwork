# Spec Delta

## ADDED Requirements

### Requirement: Verify the loaded context before routing

**Identifier:** RUNTIME-CONTEXT-001

Core SHALL verify that daemon readiness identifies the expected Work, runtime generation, instance, supported context contract, captured context, configured Skill names with matching captured identities, and effective tool policy before routing Sessions/Runs or activating a candidate. The report SHALL describe actual completed SDK loading, not echo input descriptors. Verification SHALL apply to creation, start, restart, apply, rollback, and adoption after Core recovery. Missing required handshake fields or unsupported versions SHALL fail with `AGENT_CONTEXT_INCOMPATIBLE`; wrong context or loaded membership SHALL fail with `AGENT_CONTEXT_MISMATCH`. Internal identity fields MUST NOT appear in public configuration or diagnostics.

#### Scenario: Verify the expected copied Skills
- **WHEN** the current daemon reports the expected context and exactly the configured successfully loaded Skill identities and tools
- **THEN** Core can complete readiness for that context and publish its safe runtime Skill status

#### Scenario: Reject stale or incomplete readiness
- **WHEN** a daemon claims ready with a different context, another Work identity, stale generation, missing Skill, extra Skill, duplicate Skill, or mismatched captured identity
- **THEN** Core does not route or activate it and records a stable mismatch diagnostic

#### Scenario: Reject an old agent protocol
- **WHEN** an agent image omits the context handshake or declares an unsupported contract
- **THEN** the Operation reports `AGENT_CONTEXT_INCOMPATIBLE` with instructions to deploy a compatible Core/agentd pair, and Work is not ready

#### Scenario: Re-adopt after Core restart
- **WHEN** Core finds an existing labeled container after restarting
- **THEN** it validates the actual mounted context and full current handshake before adopting its loaded Skill status, rather than trusting labels or cached ready state alone

### Requirement: Keep Skill data independent of the agent image

**Identifier:** RUNTIME-CONTEXT-002

Importing or updating managed Skills, creating Works with Skills, saving or applying Skill selections, and restarting Works SHALL NOT require an agent image build or embed Skill bytes in an image. Runtime creation SHALL use the captured immutable image identity and the complete operation-selected Work-owned context as a read-only mount. Ordinary restart SHALL use active; apply initialization SHALL use its captured candidate and MUST NOT mount a newer pending candidate. A compatible image update is required only when runtime software/contracts change, and MUST NOT silently replace an existing Work's captured image.

#### Scenario: Complete the lifecycle with one image
- **WHEN** one compatible image is built, then a Skill is imported, used by Work A, updated, used by Work B, reselected/applied to A, and both Works restarted
- **THEN** all operations use that same image identity without another build and each runtime reads its selected copied Skill bytes

#### Scenario: A tag changes after capture
- **WHEN** the original image tag is repointed before start, restart, or a Skill-only apply
- **THEN** Core uses the recorded immutable image identity; if unavailable it fails explicitly instead of substituting the tag's new image

#### Scenario: Candidate directory changes during apply
- **WHEN** apply captured B and a later set creates C
- **THEN** the candidate daemon mounts B read-only and its SDK reads B, while C remains pending

## MODIFIED Requirements

### Requirement: Materialize each Work into an isolated Docker runtime

**Identifier:** RUNTIME-MATERIALIZE-001

Creating or starting a Work SHALL materialize the operation-selected Work-owned context (captured creation/apply candidate or retained active context on ordinary restart), immutable agent image identity, complete Skill directories, `AGENTS.md`, effective runtime configuration, secret references, and tool policy into an isolated container; create or adopt one labeled Work network, persistent data/session storage, internal runtime identity, and one agentd container; then wait for verified readiness. Reconciliation MUST adopt matching resources and MUST NOT create two active agentd instances for one Work. The serving container SHALL receive only that Work's active owned context and MUST NOT read Core defaults, Core-managed Skill artifacts, operator import paths, host user Skill directories, another Work context, or pending desired context. Initial create and apply validation SHALL mount only the Operation-captured candidate with conversation routing closed until verification and activation; no later desired edit may substitute for that candidate.

#### Scenario: Start one Work from its active context
- **WHEN** Core reconciles a valid Work whose desired lifecycle state is running
- **THEN** exactly one agentd container starts with the Work's retained data, Sessions, complete copied Skill trees, AGENTS content, runtime configuration, model credential reference, resource limits, and private network

#### Scenario: Start one Work from an accepted configuration
- **WHEN** Core starts a Work after its creation context was completely copied and accepted
- **THEN** exactly one agentd container receives that Work-owned captured creation context and reaches readiness before activation without rereading Core defaults or Skill sources

#### Scenario: Reconcile an existing instance
- **WHEN** Core repeats reconciliation after losing process state
- **THEN** it adopts the matching labeled container and Work-owned storage after verification instead of creating a duplicate or rereading a Skill import path

#### Scenario: Restart after a Core Skill changes
- **WHEN** a managed Skill used to create Work A is updated, disabled, removed, or its original source path disappears before Work A restarts
- **THEN** Work A restarts with the complete Skill copy in its active context and its behavior does not change

#### Scenario: Reject active context failure
- **WHEN** the Work-owned active context is missing, corrupted, or fails validation
- **THEN** the Operation fails with the Work and safe field identity, no partial or pending context is mounted, and no Run is accepted

#### Scenario: Reject context materialization failure
- **WHEN** Core cannot safely mount or validate the complete Work-owned context selected for an operation
- **THEN** the Operation fails with a safe Work and field identity, the prior active context is retained and restored according to WCFG-002 when present, and no partial context is used by a Run
