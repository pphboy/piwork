# Work Diagnostics Specification

## Purpose

Make Work Skill setup, runtime initialization, activation, and restoration observable through correlated safe logs and durable diagnostics, so users can identify and revisit failure causes without direct access to Docker or protected host files.

## Requirements

### Requirement: Log context and runtime stage outcomes

**Identifier:** WDIAG-001

Core SHALL emit structured JSON-line diagnostics to its process stderr for context copy/validation, runtime prepare/start, Skill validation/load, readiness verification, activation, and rollback. Each attempted stage SHALL emit a start and terminal success/failure event, except process termination which SHALL be recovered as an interrupted stage. Events SHALL contain UTC timestamp, level, component, stage, outcome, correlationId, safe code, and safe message; workId and operationId SHALL be present once assigned, and skillName SHALL be present for a Skill-specific event. Agentd SHALL emit safe structured initialization events to container stderr before exiting on initialization failure; Core SHALL relay their validated outcomes into its correlated diagnostics. A successful path SHALL include explicit selected-directory validation, SDK load success, and readiness verification; config persistence alone MUST NOT generate load success. Failures before Work/Operation acceptance SHALL return the same correlationId in the HTTP error and CLI error display and MUST NOT invent a durable Work or Operation.

#### Scenario: Observe successful creation
- **WHEN** a Work with s-a completes initialization
- **THEN** Core stderr contains correlated successful copy, Skill-load, readiness, and activation events with its Work/Operation IDs, and Skill-load identifies s-a without revealing file contents

#### Scenario: Observe failed copy before acceptance
- **WHEN** a create or set request fails while copying a selected Skill before an Operation is accepted
- **THEN** the request fails atomically with a safe copy diagnostic and correlationId, and Core emits the corresponding failure using that correlationId

#### Scenario: Observe a missing required manifest
- **WHEN** agentd detects a missing required manifest during initialization
- **THEN** it emits a structured failure before exit and Core records that Skill/context error instead of reporting only a later network timeout

### Requirement: Preserve actionable Operation diagnostics

**Identifier:** WDIAG-002

Accepted Work initialization/apply Operations SHALL durably retain ordered stage outcomes and terminal root-cause diagnostics. Each failure SHALL contain `code`, `stage`, `message`, `retryable`, `remediation`, and optional public field/Skill identity; the Operation SHALL supply Work/Operation identifiers and correlationId. Store the primary failure independently of `rollback` and `diagnosticCollection` outcomes. Terminal errors and retained stage outcomes SHALL survive same-version Core restart and removal of the failed container. Retention SHALL last for the retained Operation's lifetime. Keep at most the latest 64 terminal stage outcomes and 64 KiB of diagnostic data per Operation; record `truncated: true` if stage outcomes were discarded, without discarding the primary error or rollback outcome. Messages SHALL be at most 1,024 UTF-8 bytes and remediation at most 1,024 bytes. Public Operation reads SHALL use a structured safe projection, not raw persisted request/result/error strings or internal revisions.

#### Scenario: Preserve the initial failure after rollback
- **WHEN** a candidate fails SDK loading and restoration of the previous active runtime also fails
- **THEN** the Operation retains the candidate Skill failure as primary plus a separate failed rollback diagnostic, and Work reports failed

#### Scenario: Query after container removal and Core restart
- **WHEN** a failed initialization's container has been removed and Core restarted
- **THEN** an authorized Operation query returns the retained primary error and stage results without requiring Docker access

#### Scenario: Bound accumulated diagnostic data
- **WHEN** recovery produces more stage outcomes than the retained count or byte limit
- **THEN** oldest stage outcomes are discarded with truncated true while terminal primary/rollback diagnostics remain readable

#### Scenario: Persistence fails
- **WHEN** Core cannot commit a stage or terminal diagnostic to Operation storage
- **THEN** Core emits `DIAGNOSTIC_PERSIST_FAILED` with correlation identifiers to stderr, does not falsely report a successfully persisted terminal Operation, and same-version recovery resolves the incomplete Operation from actual runtime state

### Requirement: Diagnose runtime exit before readiness timeout

**Identifier:** WDIAG-003

During initialization Core SHALL check both readiness and container state. A confirmed early container exit SHALL fail initialization without waiting for the full readiness timeout, capture its exit code, and attempt bounded retrieval of the matching container's initialization diagnostics before cleanup or replacement. Under responsive Docker, exit detection SHALL take at most two seconds after exit and collection at most two additional seconds. Readiness timeout remains bounded at the existing default 30 seconds. Collection SHALL inspect at most the last 200 lines and 64 KiB, never follow logs indefinitely, and report `available`, `unavailable`, `unrecognized`, or `truncated`. A recognized structured initialization error SHALL remain the primary error; absent such a cause, use `AGENT_EXITED` for confirmed exit or `AGENT_READINESS_TIMEOUT` for a running non-ready daemon. Recognized incompatible descriptor/handshake errors SHALL use `AGENT_CONTEXT_INCOMPATIBLE`. Collection failure MUST NOT replace the primary cause or disappear silently.

#### Scenario: Old image exits immediately
- **WHEN** agentd exits with the recognized `invalid Work Skill descriptor` initialization error
- **THEN** the Operation reports context incompatibility, exit code, compatible-runtime remediation, and collected status instead of only EHOSTUNREACH or UNAVAILABLE

#### Scenario: Container exits without useful logs
- **WHEN** the container exits and its output contains no recognized safe initialization error
- **THEN** the Operation reports AGENT_EXITED with the exit code and collection outcome unrecognized, without guessing a Skill failure

#### Scenario: Docker log retrieval fails
- **WHEN** a known initialization failure is followed by a timeout or error retrieving container diagnostics
- **THEN** the original failure remains primary and diagnosticCollection reports unavailable with a safe collection code

#### Scenario: Running daemon never becomes ready
- **WHEN** the container remains running but no valid readiness succeeds within 30 seconds
- **THEN** the Operation fails with AGENT_READINESS_TIMEOUT plus bounded collection outcome and does not claim the daemon exited

### Requirement: Authorize and sanitize diagnostic access

**Identifier:** WDIAG-004

Diagnostic and runtime Skill queries SHALL use existing Work ownership/administrative permissions. Ordinary non-owners SHALL receive the same not-found response as for an absent resource. Core, agentd, HTTP and CLI diagnostic outputs MUST NOT contain passwords, credentials, secret paths, host/import/managed-storage paths, raw configuration, internal digests/context identifiers/revisions, Skill bodies, supporting-file contents, prompts, or Session history. Treat container output, SDK errors, filenames and exception messages as untrusted inputs; publish only recognized codes and allowlisted fields with server-authored safe messages. Unknown output SHALL be summarized by collection status rather than forwarded as a log tail. Work ID, Operation ID, correlationId, validated Skill name, stage, field, exit code, and static remediation are permitted.

#### Scenario: Reject a cross-owner diagnostic query
- **WHEN** a user queries another owner's failed Operation
- **THEN** Core returns NOT_FOUND without confirming the Operation, its Skill names, or failure state

#### Scenario: Redact hostile SDK or container errors
- **WHEN** an SDK error or container output contains a token, host path, manifest body, or a forged structured message
- **THEN** logs and public/persisted diagnostics contain only validated safe fields and server-authored messages, and none of those injected values
