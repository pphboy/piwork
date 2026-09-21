# Design

## Context

See proposal.md for motivation. The following are observed in the current repository and the preceding read-only investigation, rather than proposed behavior:

- `WorkContextStore.build` already copies complete trees into `<data>/works/<workId>/contexts/<snapshotId>/skills/<name>`. Docker binds that context to `/run/piwork` read-only. Current agentd derives `/run/piwork/skills`, and the Pi adapter loads each configured name separately and checks its SDK base directory.
- `AgentApplication.create` reads descriptors but calls `daemon.configure` before SDK loading. `PiSdkRunExecutor.execute` calls `loadConfiguredSkills` later. `loadedSkillDigests` defaults to empty and is absent from the protobuf readiness response. Thus existing ready state cannot prove SDK loading.
- The inspected failed containers ran older image code expecting `{catalogId,digest}` descriptors; current Core supplies names plus `{name,identity}` metadata. They exited with `invalid Work Skill descriptor`. The stored Operation contained only a later gRPC/EHOSTUNREACH readiness failure. This is evidence of a deployment contract mismatch, not evidence that Skill data belongs in images.
- `DockerWorkRuntimeAdapter` receives snapshot context but prepares the runtime profile's mutable image reference instead of the snapshot's immutable image identity. `waitReady` retries gRPC without checking early exit or retrieving initialization output.
- `applyConfiguration` waits in the request, derives idempotency from snapshot identity, and returns configuration rather than acceptance. Its stopped-Work branch activates after image preparation without SDK validation; rollback errors are discarded.
- `/configuration/skills` reports desired names only. Both CLI parsers omit `--no-skills` from their boolean option sets. `waitOperation` throws a generic error and JSON create/wait currently emits multiple values.
- Existing Docker acceptance checks mounted supporting bytes with `docker exec cat`, but the deterministic model ignores Skill bodies and always calls a fixture tool. It does not prove an SDK read of the Work's Skill or Skill set/apply.
- `WorkContextMigration` runs on Core startup and reconstructs legacy data. Agentd binds unbound historical Sessions to its current context. These are unnecessary compatibility paths before 0.1.

## Goals / Non-Goals

**Goals:** One immutable context selected by the Operation, one matching runtime mount, one validated SDK loader, one verified readiness report, and one safe diagnostic contract through Core/API/CLI. Implementation must not infer loading from names or successful copies.

**Non-Goals:** Replacing the SDK, creating a generic logging platform, changing Skill import semantics to parse frontmatter in Core, automatic applying, or promising autonomous model use of every configured Skill. Existing Session-to-context binding remains: same-context restart restores Sessions; a Session bound to a different context is not silently rebound after apply.

## Decisions

### 1. Preserve the existing data path and make identity checks mandatory

Use the current managed-artifact and immutable Work-context architecture:

```text
operator directory
  -> Core validated managed artifact
  -> Work desired snapshot (complete copied tree)
  -> Operation captures snapshot
  -> read-only /run/piwork mount of that snapshot
  -> /run/piwork/skills/<Core name>/SKILL.md + supporting files
  -> Pi SDK ResourceLoader
  -> verified initialization -> active context -> Sessions / Runs
```

Core import continues to validate/copy bytes without parsing SKILL.md. Create applies default/explicit/empty selection using existing precedence. Explicit Skill reselection copies current managed bytes, including reselection of the same names; updates to unrelated fields retain the Work's existing copied Skill trees. Skill-only or AGENTS-only updates retain the previous desired snapshot image identity when agentImage selection is unchanged, even if the original tag moved. Resolve a new identity only when image selection changes. A copy or validation error must precede publication and clean staging data. Existing size, type, symlink, path, name, and ownership restrictions remain.

Make `ResolvedWorkRuntimeConfiguration` require `contextIdentity`, `contextDirectory`, and `imageIdentity`; remove legacy fallbacks for user Works. `resolveContextRuntimeConfiguration` loads and verifies ownership and metadata, carries `snapshot.imageIdentity`, and Docker prepares/starts exactly that image identity. Inspect the actual container mount source/destination/readOnly flag, image ID, and context/Work labels during adoption; labels alone are insufficient. No mount of the Core managed-artifact root or operator source is allowed. Candidate B is passed explicitly throughout apply; no later reread of desired C can change it.

At the SDK boundary, resolve and validate both `filePath === <skillRoot>/<name>/SKILL.md` and `baseDir === <skillRoot>/<name>`, using canonical paths after rejecting symlinks and traversal. Exactly one root manifest must be loaded per configured name, with no duplicate or extra registration; preserve the Core name even if SDK metadata differs. Supporting files are covered by full-tree integrity/readability validation. Retain the isolated loader with host resources disabled even for an empty Skill set.

Alternative rejected: scanning a default/global Skills directory or adding Skill bytes to Docker build context. Neither can prove per-Work selection or permit independent data updates. Also replace the production loader's fixture-specific system preamble with the SDK default; the deterministic fixture belongs in the acceptance runtime, not production instructions.

### 2. Initialize once, then use the same loader

In `apps/agentd/src/application.ts`, await descriptor/schema validation, bounded AGENTS decoding, complete Skill-tree hash/read checks, and SDK parsing before configuring daemon readiness. Introduce a `LoadedWorkContext` value containing context identity, resolved tools, immutable SDK resource loader, and validated Skill reports. `PiSdkRunExecutor` receives this object and passes its loader to every created/restored SDK session; it no longer independently reloads a different directory for each Run. A read-only mount and rejected symlinks keep the captured data stable. On loader failure, emit the safe structured failure before process exit and close resources.

The supported context metadata version remains 1 with name-array configuration and `{name,identity}` metadata. Unsupported versions, old object arrays, or absent ownership metadata return CONTEXT_FORMAT_UNSUPPORTED. Missing snapshot files return CONTEXT_NOT_FOUND. Missing/unreadable/modified/unsafe required tree content returns SKILL_VALIDATION_FAILED; SDK parse/register failure returns SKILL_LOAD_FAILED; unexpected SDK location returns SKILL_DIRECTORY_MISMATCH. Error messages must be static catalog text, never raw SDK exceptions or filesystem errors.

Keep supported SDK metadata. Public `modelVisible` equals false when `disableModelInvocation` is true or both `read` and `bash` are denied; metadata suppression has precedence for the visibility reason. A loaded Skill can be hidden from the prompt and that is distinct from load failure. This change proves registration and resource access, not model intent.

Alternative rejected: only validating before the first Run. It permits a false-ready Work and hides failure until a prompt arrives.

### 3. Add an explicit context readiness contract

Extend `packages/contracts/proto/agent.proto` and regenerate its TypeScript definitions using the existing `proto:gen` workspace command. Keep protocol v1, and add mandatory-to-Core semantic fields (protobuf defaults do not imply acceptance):

| Readiness field | Meaning |
| --- | --- |
| context_contract_version | Exactly 1 for this contract; absent/0 is incompatible |
| context_identity | Exact captured snapshot ID, internal only |
| initialization_complete | True only after actual SDK initialization succeeds |
| loaded_skills | Ordered records: name, identity, loaded, model_visible, visibility_reason |
| resolved_tools | Exact effective built-in tool list |
| active_run_count | Current daemon Run count for observation |

Existing Work/generation/instance/protocol/acceptingRuns/draining fields remain. Never populate loaded records directly from unvalidated descriptors. `AgentDaemonControl.configure` requires the loaded context. Normal readiness requires initialization complete, all exact Skill identities loaded, matching tools/context/runtime identity, and acceptingRuns. Wrong membership/identity is AGENT_CONTEXT_MISMATCH; absent or unsupported context-contract fields are AGENT_CONTEXT_INCOMPATIBLE. Every route-opening path, including rollback and re-adoption, uses the same verifier.

For stopped-Work candidate validation, add runtime-config `initializationOnly: true`. The same daemon initializes resources and serves readiness with initialization_complete true and acceptingRuns false; it rejects Session/Run mutation. Core's internal validation verifier accepts this mode only for that Operation, never publishes ready/routing, then stops and confirms termination before committing activation. It does not contact the model or execute Skill scripts. Initialization-only instances use the normal owned container/generation and cannot coexist with a primary.

Alternative rejected: bumping all RPC behavior or trusting container labels. A mandatory context-contract version precisely detects old images without implementing a compatibility adapter.

### 4. Preserve explicit set/apply, with durable acceptance and fenced activation

Modify production routes in `apps/core/src/application/core-application.ts`, lifecycle service, client SDK, and associated HTTP test server projections:

| Endpoint | Contract |
| --- | --- |
| PUT `/api/v1/works/:id/configuration` | Existing full configuration body; atomically capture desired; safe configuration state response |
| PUT `/api/v1/works/:id/configuration/skills` | `{skills: string[]}`; explicitly reselect/copy managed bytes; preserve unrelated fields |
| POST `/api/v1/works/:id/configuration/apply` | `{idempotencyKey: string}`; HTTP 202 `{workId,operationId,reused}` |
| GET `/api/v1/works/:id/configuration` | Existing safe active/desired/pendingApply plus runtime status below |
| GET `/api/v1/works/:id/configuration/skills` | `{desired: string[], active: string[], pendingApply, runtime}` |
| GET `/api/v1/operations/:id` | Safe Operation projection described in decision 6 |

Apply captures desired snapshot and target lifecycle version in the acceptance transaction and queues reconciliation once. Validate required nonempty keys using existing mutation validation. Bind the idempotency digest to the public apply request and Work, not to the subsequently changing desired snapshot: replaying the same key returns its originally captured Operation even after later edits. Distinct keys allow retry; a reused terminal Operation is never re-executed. Reserve the existing Work controlVersion for lifecycle/apply acceptance fences; desired-only configuration edits advance internal configuration revision but do not advance the lifecycle fence. This is essential so a later set C does not supersede an apply of B. A later lifecycle/apply mutation advances the fence under existing latest-target ordering. Preserve internal revisions for desired commit order, but never expose them. If captured snapshot already is active and validated, succeed as a no-op.

For a running Work requiring replacement, prepare candidate/image before touching the current daemon. Add an authenticated `PrepareConfigurationChange` RPC using the usual Work/generation/instance identity. It atomically checks the daemon Run count: if nonzero, return busy without changing the acceptance gate; otherwise close the gate to new Runs and return prepared. Core closes routing while this call and replacement run. This eliminates the race between a readiness count check and a new Run. Busy fails this apply with WORK_BUSY and leaves routing/context unchanged. Candidate initialization cannot silently cancel an existing Run. Failure after closing the gate restores the old daemon through the same verified start/rollback path.

On successful candidate readiness, a transaction verifies the Operation remains current and its lifecycle version has not been superseded, marks exactly its captured context active, stores the verified status, and completes the Operation. Desired can independently be C, so pendingApply stays true. On candidate failure, retain active pointer/data and desired candidate, gather diagnostics before removal, and restore previous active runtime. Restore success makes the Work usable on old context while apply remains failed. Restore failure records both errors and marks Work failed. If stop/delete supersedes apply, clean up candidate and follow the newer lifecycle target; do not rollback into running against a stop request. Same-version recovery uses stored captured IDs and target fences, not mutable defaults or desired data.

For a stopped Work, validate via initialization-only daemon, stop it, verify termination, then activate and finish still stopped. Failure preserves prior active context and stopped desired state; uncertain shutdown reports failed/unknown and prevents a second daemon. For creation, change insertInitialWorkContext to set desired only and leave active_context_id/active_revision null. Store the initial candidate in the create Operation request; initial start/retry must use that captured candidate until first verified activation rather than treating absent active as legacy data. Full configuration returns active null and pendingApply true; Skill-list active is empty. Commit the initial active pointer only after readiness. After first activation, ordinary start/retry always uses retained active, never a newer desired snapshot.

Alternatives rejected: returning only configuration after a long HTTP request; keying retries by snapshot; activating stopped Works after mere file copying. These respectively hide Operation tracking, prevent retries, and skip SDK proof.

### 5. Project truthful runtime state

Define shared control-contract types and use them in `packages/client-sdk`:

```ts
type RuntimeSkillState = {
  state: "ready" | "initializing" | "failed" | "unavailable";
  checkedAt: string | null;
  skills: Array<{
    name: string;
    loaded: true;
    modelVisible: boolean;
    visibilityReason: null | "model-invocation-disabled" | "read-tools-disabled";
  }>;
};
```

Only a verified current active daemon yields nonempty entries. Query readiness with a two-second deadline on configuration/Skill reads; failure produces unavailable and empty skills rather than breaking configuration reads. Stopped/deleted/absent instances are unavailable; current in-progress initialization is initializing; confirmed failed initialization is failed. During candidate preparation the still-routed active daemon may remain ready; after routing is closed for replacement, report initializing with no loaded list until activation or restoration. Set response obtains the same projection, so it cannot imply desired was loaded. `checkedAt` is the completed current observation's UTC time, null if no observation could be completed. Never substitute a historical successful report when the daemon cannot be verified.

Public configuration keeps existing safe fields; Skill-list adopts the table shape above. Work and Operation serializers must omit raw revision/context/digest fields as required by existing specs. Reuse Work ownership/administrative access checks for every projection; unauthorized ordinary users receive NOT_FOUND. This is a pre-0.1 output correction and no response-shape compatibility adapter is provided.

### 6. Diagnostics are a product contract

Add reusable safe diagnostic types in contracts and a small injected Core/agentd JSON-line logger. No external logging dependency is needed. Logs go to process stderr; service supervision can retain them. Durable user inspection comes from Operation storage, not from accessing a log file or Docker socket.

Canonical stages: `context-copy`, `context-validate`, `runtime-prepare`, `runtime-start`, `skill-validate`, `skill-load`, `readiness`, `activation`, `rollback`. Outcomes: `started`, `succeeded`, `failed`, `interrupted`. Levels: info for start/success; error for failure; warn for interrupted/collection truncation. Core assigns a random correlationId at request entry and persists it for accepted Operations. Pre-acceptance failure returns it with the HTTP error. Recovery continues the accepted correlationId; a retried new Operation gets a new ID. Agent runtime configuration receives correlationId/operationId for its startup logs; adoption events belong to the current Core recovery operation, not a historical startup.

Public Operation projection:

```ts
type PublicOperation = {
  operationId: string;
  workId: string;
  kind: string;
  state: "pending" | "running" | "succeeded" | "failed" | "superseded";
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  result: null | { configuration?: PublicWorkConfiguration };
  error: null | {
    code: string;
    stage: string;
    message: string;
    retryable: boolean;
    remediation: string;
    field?: string;
    skillName?: string;
    exitCode?: number;
  };
  diagnostics: {
    stages: SafeTerminalStageEvent[];
    truncated: boolean;
    rollback: { state: "not-required" | "succeeded" | "failed"; error?: SafeDiagnostic };
    diagnosticCollection: {
      state: "not-attempted" | "available" | "unavailable" | "unrecognized" | "truncated";
      code?: string;
    };
  };
};
```

A `SafeTerminalStageEvent` contains the same safe timestamp/component/stage/outcome/code/message/Skill fields as a log event, with correlation supplied by the enclosing Operation. Rollback additionally retains an optional safe underlying cause. Pre-acceptance context-copy events are correlated by request ID; on acceptance, attach their bounded outcomes to the new Operation and emit the correlated accepted summary with assigned Work/Operation IDs.

Extend the existing Operation `result_json` envelope with `{result, diagnostics, correlationId}` and keep the primary error in `error_json`; serializers parse and project typed fields. Internal `request_json` holds captured snapshot/target data only and is never returned. No new log table is required. Every terminal stage appends transactionally; completion atomically commits state, primary error, and final diagnostics. Max 64 terminal stages and 64 KiB aggregate diagnostic JSON; evict oldest stages first, never primary/rollback/collection results. Bound message/remediation to 1,024 UTF-8 bytes and only use static catalog text. Preserve metadata needed to detect a started but unfinished stage across Core crash in the internal Operation envelope; recovery closes it as interrupted before continuing.

Use one stage runner to emit start, execute, persist terminal outcome, and emit terminal log. Core starts Skill stages when daemon initialization begins, then uses verified initialization evidence for success and collected safe agent events for failure, never copied names as proof. If startup ends before those stages can be observed, close the speculative stage records as interrupted; do not invent an SDK validation outcome. Agent emits its own validation/load outcomes before readiness. A Core DB error emits DIAGNOSTIC_PERSIST_FAILED to stderr, leaves the Operation incomplete rather than claiming a durable result, and uses normal recovery to reconcile later.

Minimum diagnostic code catalog and remediation categories:

| Code | Stage / retryable | Static remediation |
| --- | --- | --- |
| CONTEXT_COPY_FAILED | context-copy / false | Check selected managed Skill availability and retry selection |
| CONTEXT_NOT_FOUND, CONTEXT_FORMAT_UNSUPPORTED | context-validate / false | Supply a current-format Work context; historical conversion is unsupported |
| SKILL_VALIDATION_FAILED | skill-validate / false | Correct the named Skill tree, reselect, and apply |
| SKILL_LOAD_FAILED, SKILL_DIRECTORY_MISMATCH | skill-load / false | Correct SDK-compatible Skill content or runtime directory configuration, reselect, and apply |
| RUNTIME_PREPARE_FAILED, RUNTIME_START_FAILED | runtime-prepare/start / true | Restore runtime dependency and retry the Operation with a new key |
| AGENT_CONTEXT_INCOMPATIBLE | readiness / false | Deploy a compatible Core/agentd pair and explicitly select its image for the Work |
| AGENT_CONTEXT_MISMATCH | readiness / false | Correct runtime context binding before retrying |
| AGENT_EXITED, AGENT_READINESS_TIMEOUT | runtime-start/readiness / true | Inspect retained Operation diagnostics, correct the runtime cause, and retry |
| WORK_BUSY | runtime-prepare / true | Wait for the active Run to finish, then apply with a new key |
| ROLLBACK_FAILED | rollback / true | Restore runtime dependency and start/retry the retained active context |
| DIAGNOSTIC_COLLECTION_FAILED | same failing stage / true | Restore Docker access to collect runtime diagnostics |
| DIAGNOSTIC_PERSIST_FAILED | same failing stage / true | Restore Core storage before retrying |
| WORK_OPERATION_FAILED | actual failing stage / false | Inspect the identified stage and correct configuration before retrying |

Preserve existing typed safe validation errors where applicable, including image-unavailable errors, instead of collapsing all known errors to the fallback. `retryable` is guidance for explicit retry, not permission for unbounded automatic attempts; existing recovery budgets still apply. Rollback stores its underlying safe cause alongside ROLLBACK_FAILED. The primary candidate error always wins over network/collection/rollback errors discovered afterward.

Sanitization is allowlisting, not a regex replacement over arbitrary exception text. Public field names come from validated contract paths, Skill names from that Operation's selection, and messages/remediation from the code catalog. Never forward Docker args/stderr, stack traces, SDK diagnostics text, file contents or arbitrary JSON message fields. Apply the same policy before emitting Core/agentd logs and before persisting them. Internal digests used in readiness stay on authenticated internal RPC, not in logs. Ownership checks occur before diagnostic lookup/response.

Alternative rejected: console.error of raw exceptions or only retaining a generic network message. Those either leak protected data or hide the cause users need.

### 7. Detect exits and collect bounded evidence before cleanup

Extend `packages/runtime-docker/src/docker.ts` with an owned-container log-read method; existing inspection already exposes exitCode and mounts. Verify installation/Work/logical ID plus generation/instance before selecting the immutable container ID. Use `docker logs --tail 200 <id>` without follow. Extend the command runner with optional deadline and bounded-output support; retain at most 64 KiB, stop collection at two seconds, and report truncation distinctly. Do not read output from a replacement container selected by a reused name.

In Core `waitReady`, race/poll bounded readiness and inspection with a 200 ms interval and per-attempt deadlines at most one second. Preserve the 30-second overall initialization budget. Responsive Docker must yield an exited state within two seconds. On confirmed exit, collect logs before remove/replacement; on readiness timeout collect once too. Match structured diagnostic codes and safe identities against the expected initialization. Recognize the exact historical line `invalid Work Skill descriptor` as a compatibility diagnostic only when the inspected startup container has exited; this recognizes an error, not legacy execution support. Unknown/plain output is unrecognized and never forwarded. Log retrieval failure is attached separately and cannot hide a recognized root cause or known exit code. Unresponsive Docker inspection yields a dependency/state-unknown diagnostic, not a fabricated exit.

On success, full readiness is the authoritative SDK evidence; Core emits load/readiness success without requiring Docker log availability. Preserve failed evidence before rollback changes the container. Container diagnostic collection is finite and has no user-facing tail endpoint.

### 8. Remove only unsupported context conversion paths

Remove startup `WorkContextMigration`, its implementation/tests, `filesystem_migrations` support used only for that converter, and `attachMigrated*` helpers once no current caller remains. Remove agentd `bindLegacyContexts` and its unbound-Session rewriting helper, plus `@legacy` runtime identity and revision-based missing-context fallbacks. Do not replace them with a new migration workflow.

Keep structural schema initialization machinery in Core/Work stores and same-version recovery. This change does not need a wholesale database schema squash or removal of unrelated historical SQL. Fresh schema creation should omit converter-only bookkeeping and must still contain all current tables/columns. No command in apply may delete/reset the user's existing local database or containers to make tests pass. Unsupported old context fails safely; current-format data is validated and may be used without conversion. Deploy new Core and image together once, then all Skill operations are data-only. Reverting incompatible software requires its separately retained pre-change data; automatic downgrade conversion is outside scope.

### 9. Tests and documentation must prove the closure

Use existing Node tests, generated contracts, deterministic provider and Docker acceptance harness. Add a deterministic model fixture that discovers the configured Skill's `<location>` from the actual SDK system prompt, issues the real SDK `read` tool for that SKILL.md, parses a supporting-file reference from the tool result, reads that file through the SDK, and produces a marker derived from the read results. Do not bypass with direct fixture filesystem reads, `docker exec cat`, hardcoded final answers, or forced Skill names without inspecting the prompt. Unit tests inspect `filePath`/`baseDir`; Docker acceptance proves actual resource access. Marker assertions compare expected fixture outcomes without publishing Skill bodies in diagnostics.

Acceptance matrix:

- Build one compatible acceptance image once. Import version A, remove source, create default/explicit/empty Works, and verify full readiness plus SDK reads. Repeat the same flow through compiled `npm run cli` and operator CLI.
- Update the same name to B, create another Work, and verify A still reads A, B reads B. Change Core content again to C to make accidental global fallback observable. Retag the original image tag and confirm retained image identity is used.
- Generic config set and field-specific set/reselect affect only desired. Apply A to B and verify new Sessions read B; an update to C during B apply remains pending. Clear via --no-skills and verify no global fallback. Stop/start and Core recovery retain captured content.
- Fail before ready for missing/unreadable/tampered tree, SDK-invalid manifest, wrong SDK directory, duplicate membership, stale generation, missing handshake, early exit, old descriptor error, readiness timeout, Docker collection failure, and rollback failure. Assert stage/code/state and sanitized diagnostics immediately and after restart/removal.
- Exercise stopped apply, busy Run rejection with no cancellation, stop superseding apply, duplicate idempotency and new-key retry. Verify one primary daemon and unchanged active pointer on failed apply.
- Inject secrets, host paths, prompt/manifest text, forged JSON logs, and cross-owner requests. Check Core/agentd/CLI outputs and persisted public diagnostic envelope; test bounds and persistence failure.
- Verify fresh initialization and same-version credentials/Work/Session recovery after removing conversion. Do not claim legacy migration coverage.

Update README with the directory flow, desired/active/loaded meanings, loaded-versus-model-use distinction, operator import/default commands, explicit/empty create, set/apply --wait/idempotency examples, Operation show, stderr logging location, safe representative failures and compatible-image deployment. Document that a software image refresh differs from routine Skill import/update. Required gates: typecheck, build, unit tests, integration tests, deterministic Docker acceptance, and strict OpenSpec validation. Optional real-provider smoke stays explicitly optional and is not evidence substituting for the deterministic Skill-read test.

## Risks / Trade-offs

- Loading complete Skill trees before readiness adds startup I/O → bounded existing artifact limits; load once per daemon, reuse the loader.
- Stopped apply briefly creates an initialization-only container → no routing, no accepted Runs, confirm shutdown before activation.
- API/CLI response corrections break pre-release scripts → document exact JSON shapes and update contract/CLI tests together; no compatibility adapter.
- Raw old-container logs are unsafe and sometimes uninformative → finite allowlisted extraction with explicit collection status, never a guessed root cause.
- Runtime failure can make rollback impossible → retain active data, expose both failures, and report failed instead of guaranteeing availability.
- Deterministic tests prove transport/SDK resource access rather than a real model's choice → label that guarantee accurately; optional provider smoke remains separate.
