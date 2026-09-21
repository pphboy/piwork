# Design

## Context

See proposal.md for the motivation and externally visible scope. The repository already stores immutable Work configuration revisions in SQLite, validates WorkConfig, prepares catalog artifacts, and has a runtime materializer that writes Skills and secrets under a per-Work root. The remaining gaps are that WorkConfig has no AGENTS.md content, no persistent default Work configuration exists, the materialized root is not connected to the Docker runtime, and the real Pi SDK executor currently uses a narrow hard-coded tool list and an isolated resource loader that is never passed to the session.

The implementation must preserve existing Core/user/operator credential boundaries and the desired/active revision model. It must remain possible to start an empty Core and initialize it through the operator control plane.

## Goals / Non-Goals

**Goals:**

- Persist and expose one complete operator-managed default Work configuration.
- Add immutable, bounded agentsMd content to every normalized Work configuration.
- Copy the default configuration at Work creation and support per-Work Skills and AGENTS edits with expected-revision concurrency control.
- Materialize the active Work context and pass it to every real Pi SDK Session.
- Make the seven Pi SDK built-in tools available by default inside the isolated container while enforcing the Work tool policy.
- Preserve existing Works, active Runs, idempotency, and secret redaction during migration and configuration apply.

**Non-Goals:**

- A separate set-base-image command; base image changes use default-work configuration or the complete Work configuration update.
- Docker socket access, host Skills, arbitrary host-path mounts, or a WebUI.
- Changing the existing user/operator authentication protocol or adding a second agent conversation protocol.
- Claiming a Docker Agent multi-container conversation chain beyond the existing agentd Run path.

## Decisions

### 1. Normalize configuration at the contract boundary

Extend packages/contracts/src/control/work-config.ts with a required agentsMd: string field. Normalize an empty document to "" and enforce a UTF-8 byte limit of 256 KiB before schema validation. The field is content, never a host path. Keep skills as catalog references with optional immutable digests and keep the existing tools policy shape; add validation that tool names are from the seven built-in names or the configured MCP namespace.

The public JSON representation of default and Work configuration includes revision, agentImage, skills, agentsMd, modelRef, mcpServers, resources, and tools. Secret references remain identifiers and are redacted using the existing response mappers.

### 2. Store the default as a complete revisioned object

Add a Core store migration (schema version 4) that seeds a control_metadata row named default_work_configuration only when it is absent. The value is a versioned envelope containing the normalized WorkConfig, a public revision, and update metadata. On an existing database, backfill every old work_config_revisions.config_json that lacks agentsMd with agentsMd: ""; do not rewrite its revision number or active state.

On first runtime initialization, derive the seed default from the runtime profile (agent image and model reference), empty Skills, empty AGENTS, existing resource defaults, and the full default tool policy. Thereafter, piwork-serve config set updates the runtime profile and atomically updates only the default Work configuration's runtime-linked image/model fields; explicit config default-work set updates the complete default. Neither operation edits any existing Work revision. The store exposes compare-and-swap helpers for the default revision so stale operator updates return a conflict.

### 3. Separate operator default APIs from user Work APIs

Add operator-only HTTP operations under /control/default-work:

- GET returns the default public configuration and revision.
- PUT accepts expectedRevision and a complete normalized configuration, validates catalog entries, digest pinning, AGENTS size/encoding, and public tool policy, then commits atomically.
- GET/PUT /control/runtime/ continues to manage the runtime profile and updates the default's runtime-linked fields as described above.

Extend the authenticated user API under /api/v1/works:

- Work creation accepts either the complete configuration object or normalized CLI overrides. Core obtains the current default in the same transaction, applies explicit overrides, validates the result, and inserts revision 1.
- GET /api/v1/works/:id/configuration returns desired/active revisions with agentsMd content and redacted secrets.
- Existing configuration update remains a complete replacement with expectedRevision; add convenience endpoints for Skills list/set and AGENTS show/set that read the current desired object, change exactly one field, and use the same compare-and-swap update.
- POST /api/v1/works/:id/configuration/apply continues to be the only activation path.

CLI mapping is explicit: piwork-serve config default-work show|set calls the operator API; piwork-cli work create --base-image ... --skill ... --agents-md-file ... --config ... builds overrides; piwork-cli work config skills list|set, agents show|set, show, and apply --expected-revision call the user API. No CLI command named set-base-image is added.

### 4. Make artifact preparation and materialization one activation pipeline

During Work creation and configuration apply, run the existing WorkConfigurationValidator, ArtifactPreparationService, and RuntimeConfigurationMaterializer for the target revision before changing the active revision. Extend prepared artifacts to carry the resolved image digest and every Skill digest. Extend the materialized file at /run/piwork/config.json with agentsMdPath, the resolved tool set, and the active context identity. Write /run/piwork/AGENTS.md with mode 0400; write Skills only under /run/piwork/skills/<catalog-id>/SKILL.md. A failed preparation removes the staging directory and leaves the prior active revision and runtime untouched.

Pass the returned materialized root as a read-only mount to DockerWorkRuntimeAdapter.start, alongside the existing data/session/cache mounts. The container receives no host Skill directory. Runtime labels include Work ID, active revision, and generation so recovery can reject stale contexts.

### 5. Load Work resources through the real Pi SDK session

Extend the agentd runtime configuration contract to include the materialized config path, AGENTS path, configured Skill descriptors, active context identity, and resolved tools. In apps/agentd/src/pi-sdk-executor.ts, call loadConfiguredSkills against the mounted Skill directory and construct a DefaultResourceLoader (or equivalent loader) with skillsOverride and agentsFilesOverride containing only the mounted AGENTS file. Pass that loader to createAgentSession for both deterministic and production models. The loader must return no host extensions, prompts, themes, or host AGENTS files.

Resolve tools centrally: start with read, bash, edit, write, grep, find, and ls; remove names in tools.denied; if tools.allowed is non-empty, intersect with it; reject unknown names during activation. Deterministic fixture_echo remains a test-only custom tool and is appended only by the deterministic acceptance executor. Tool execution errors map to the existing Run failure state without returning credential contents or host paths.

### 6. Keep configuration changes transactional and Run-safe

Work configuration updates use the existing expected revision compare-and-swap and idempotency records. A config set operation changes desired only and marks pending apply; it never calls runtime stop or abort for an active Run. config apply queues behind the Work lifecycle queue, drains according to existing lifecycle bounds, prepares the new context, and swaps active revision only after readiness. Runs record the active context identity at acceptance; a context swap cannot alter an accepted Run. A failed apply retains the old active revision and old materialized root.

Default configuration writes use one SQLite transaction. Work creation reads the default and inserts the copied revision in that same transaction, so a default update cannot produce a partially copied Work. Repeating a create idempotency key returns the original Work and configuration.

### 7. Migration and compatibility

At startup, migration v4 is applied before Core serves traffic. Existing Work revisions receive agentsMd: "", retain their resolved image/runtime profile and active revision, and continue to use their prior tool policy. If no default row exists, it is derived from the persisted runtime profile; an installation without a runtime profile remains RUNTIME_NOT_CONFIGURED and the operator can set the default after configuring runtime. Existing CLI create requests that send a complete configuration remain valid after normalization.

Rollback is a code rollback after the migration has run; the new binary must be used to read agentsMd. A database backup taken before migration can restore the previous schema. No migration deletes conversation or Work data.

### 8. Verification strategy

- Contract and migration unit tests cover required agentsMd, empty/oversized content, default copy isolation, backfill, and compare-and-swap conflicts.
- Core HTTP tests cover operator default show/set, runtime-linked default updates, user create overrides, Skills/AGENTS convenience endpoints, redaction, authorization, and no mutation of existing Works.
- Materialization tests verify AGENTS mode/path, fixed Skill digests, tool resolution, staging cleanup, and absence of host mounts.
- Agentd tests construct a real resource loader and assert Skills, AGENTS, and all seven tools are visible; negative tests assert denied/unknown tools and invalid Skill digests fail readiness.
- Lifecycle tests assert a pending config does not interrupt an active Run and a failed apply preserves the active revision.
- The existing deterministic real-stack acceptance test is extended to create a Skill/AGENTS-configured Work, chat through piwork-cli, restart Core/agentd, and continue the Session. An optional PIWORK_REAL_MODEL_SMOKE=1 test reads the configured provider credentials from the test env without printing them.

## Risks / Trade-offs

- [Risk] A 256 KiB AGENTS document increases configuration and materialization payloads. → Mitigation: enforce the limit before SQLite writes and cap request bodies; expose only metadata in list/status responses.
- [Risk] Opening all built-in tools increases the actions a prompt can request inside a container. → Mitigation: retain non-root isolation, no Docker socket, no host mounts, and make the Work tool policy the final allow/deny contract.
- [Risk] Runtime profile changes and explicit default Work edits could race. → Mitigation: serialize both through one store transaction and return a default revision conflict to stale explicit updates.
- [Risk] Old Work configurations lack AGENTS content. → Mitigation: migration backfills an empty document and preserves every existing revision and active pointer.
- [Risk] A failed context apply could leave stale files. → Mitigation: UUID staging directories, atomic rename, generation labels, and active-revision swap only after readiness.

