# Design

## Context

Piwork already has catalog, Work configuration, artifact preparation, Docker materialization, and isolated Pi SDK resource-loading layers, but the current Skill path crosses those layers as a host reference. `CatalogService` can create a generic `kind = 'skill'` entry, `ArtifactPreparationService` resolves that entry through `mutable_reference`, `RuntimeConfigurationMaterializer` copies only `SKILL.md`, and `DockerWorkRuntime` reads the catalog source again when starting a Work. There is no supported HTTP or CLI lifecycle for importing a Skill. The public Work configuration also embeds numeric revisions and requires callers to submit `expectedRevision`.

This change makes two ownership boundaries explicit:

1. Core owns an immutable copy of every accepted Skill artifact and selects its current artifact by the imported directory basename. Core does not parse `SKILL.md`.
2. Each Work owns immutable context snapshots containing its selected complete Skill trees, `AGENTS.md`, effective non-secret configuration, and fixed image identity. Runtime execution reads the active Work snapshot only.

The existing SQLite numeric revision columns may remain as internal surrogate keys during migration. They no longer form part of the public contract and are never supplied by a CLI or HTTP caller. An internal immutable snapshot identity is required because apply can overlap a later desired edit and Sessions/Runs must remain bound to the context they started with.

The main affected code is under `apps/core/src/configuration`, `apps/core/src/application`, `apps/core/src/work-management`, `apps/core/src/runtime`, `apps/core/src/cli.ts`, `apps/cli/src/main.ts`, `apps/agentd/src`, `packages/contracts`, `packages/client-sdk`, `packages/core-store`, and `packages/pi-adapter`.

## Goals / Non-Goals

**Goals**

- Import, validate, persist, update, enable, disable, list, show, and remove complete Skill directories through the operator control plane, with the normalized source directory basename as the public ID and no Core-side `SKILL.md` parsing.
- Let users discover enabled Skills and select a complete Skill set while creating or configuring a Work.
- Preserve three distinct Skill-selection inputs: omitted means inherit/preserve, a non-empty array means replace, and an empty array means explicitly select none.
- Persist self-contained Work context snapshots before accepting Work creation or a desired configuration update.
- Start, restart, recover, and execute Runs solely from a Work-owned active snapshot.
- Remove public revision fields, `--expected-revision`, and revision conflict behavior while preserving deterministic last-committed-write and apply-capture semantics.
- Migrate version 4 data without losing an existing Work's active context, and fail visibly when a legacy host reference cannot be safely converted.
- Keep host paths, managed storage paths, internal content identities, secret plaintext, and Skill file content out of ordinary-user responses and errors.

**Non-Goals**

- Installing Skills from URLs, registries, archives, Git repositories, or standard input.
- Editing individual Skill files through Core, merging Skill directories, resolving Skill dependencies, or maintaining user-visible Skill versions.
- Automatically updating an existing Work when a managed Skill or default Work setting changes.
- Adding `set-base-image`; base image remains an input on default Work and per-Work configuration commands already in scope.
- Replacing internal database surrogate keys merely to remove revisions from the public API.
- Changing service-definition revision behavior; this change removes revision semantics only from default Work and per-Work context configuration.

## Decisions

### 1. Store immutable Core Skill artifacts under the Core data directory

`ensureCorePaths` will add:

```text
skillsDirectory       = <data-dir>/skills
workContextsDirectory = <data-dir>/works
```

The managed Skill layout is:

```text
<data-dir>/skills/<skill-name>/
  artifacts/<content-identity>/
    SKILL.md
    scripts/...
    references/...
    templates/...
    ...
```

The database, rather than a filesystem symlink or user-visible `current.json`, is the authoritative current-artifact pointer. This avoids symlink handling in a security-sensitive tree. `<content-identity>` is an internal SHA-256 tree identity computed over a canonical stream of each relative POSIX path, file length, and file bytes in lexical path order. It is used for integrity and deduplication only and MUST NOT appear in public responses.

A new `SkillArtifactStore` in `apps/core/src/configuration` will own import, tree validation, copying, hashing, and deletion. Add/update follows this sequence:

1. Require an absolute source path, normalize it, reject a symbolic-link root, resolve its real path for safe traversal, open it as a directory, and reject the request before reading the path unless the principal is an operator.
2. Walk directory entries without following symbolic links. Reject symlinks, devices, sockets, FIFOs, path escapes, unreadable entries, more than 2,048 regular files, more than 32 MiB total bytes, or a file larger than 8 MiB.
3. Take the final non-empty directory basename from the normalized input as `skill-name` and require `[a-z0-9][a-z0-9-]{0,63}` without rewriting case or characters. Require a readable regular root `SKILL.md`, but treat it as opaque bytes: Core does not decode it, parse frontmatter, or derive identity or public metadata from it.
4. Copy regular files into a sibling staging directory using exclusive creation and restrictive modes. Re-open and validate the staged copy, compute its canonical tree identity, and verify every resolved destination remains below staging.
5. Atomically rename staging to `artifacts/<content-identity>`. If identical content already exists, validate it and discard staging.
6. In one SQLite `BEGIN IMMEDIATE` transaction, create the Skill entry or switch its current artifact pointer. Update requires the source directory basename to match the requested Skill name and returns `SKILL_NAME_MISMATCH` otherwise. A duplicate basename on add returns `SKILL_ALREADY_EXISTS`.
7. If the database transaction fails, leave the previous current pointer unchanged. The newly published immutable directory is an unreferenced orphan and can be removed immediately or by startup cleanup. A failed filesystem validation never changes the database and always removes staging.

Core will not persist the operator's source path. Once import succeeds, creating a Work must succeed after that source directory is deleted. The operator-facing entry uses `id = name = <skill-name>`, `kind = 'skill'`, `mutable_reference = NULL`, and stores no runtime-readable host reference.

### 2. Extend the catalog with explicit Skill artifact metadata and safe views

Migration 5 will add a `skill_artifacts` table:

```text
skill_name        TEXT
content_identity  TEXT
storage_path      TEXT
file_count        INTEGER
total_bytes       INTEGER
created_at        TEXT
PRIMARY KEY (skill_name, content_identity)
FOREIGN KEY (skill_name) REFERENCES catalog_entries(id)
```

The current Skill artifact identity is held in an internal catalog field. It may reuse `catalog_entries.resolved_digest`, provided Skill-specific store methods never expose it through public catalog serialization. `catalog_entries.metadata_json` contains only versioned aggregate file/byte counts; it does not contain parsed `SKILL.md` metadata. `mutable_reference` is null for managed Skills. New Skill-specific store and service methods replace generic catalog creation for `kind = 'skill'`: add, update, get, list, set enabled, and remove. Image/model catalog behavior stays unchanged.

Two view types prevent path and digest leaks:

```ts
type PublicSkill = {
  name: string;
};

type OperatorSkill = PublicSkill & {
  enabled: boolean;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
};
```

User list/show queries select enabled entries only and sort by name. Operator queries include disabled entries and use the same ordering. Neither view includes parsed `SKILL.md` metadata, the import path, storage path, content identity, or file content.

Disable and remove execute under `BEGIN IMMEDIATE`, read the current default Work configuration in the same transaction, and return a field-specific conflict if it still selects the name. Existing Work snapshots are deliberately not counted as references because they own independent copies. Removal deletes the catalog pointer transactionally, then deletes unreferenced Core-managed artifacts; a post-commit deletion failure is logged and cleaned on startup without restoring a publicly removed Skill.

### 3. Represent public Work configuration with Skill names and no revision

`packages/contracts/src/control/work-config.ts` will separate public effective configuration from internal storage identity. The public configuration uses Skill names:

```ts
type WorkConfig = {
  agentImage: { catalogId: string };
  skills: string[];
  agentsMd: string;
  modelRef: string;
  mcpServers: McpServer[];
  resources: ResourcePolicy;
  tools: ToolPolicy;
};

type WorkConfigurationView = {
  workId: string;
  active: WorkConfig | null;
  desired: WorkConfig;
  pendingApply: boolean;
};
```

The public schemas reject additional properties, so legacy `revision`, `desiredRevision`, `activeRevision`, `pendingRestart`, and `expectedRevision` inputs fail with `INVALID_REQUEST` without disclosing a current internal value. Internal records may use `snapshotId`, numeric `revision`, content identities, and resolved image digest, but public mappers must reconstruct only the view above.

All Skill arrays are normalized by rejecting duplicates and validating each name; their supplied order is preserved in a Work configuration and copied snapshot. User selection requires every name to be enabled at the time the desired snapshot is built. A Skill later becoming disabled or removed cannot invalidate an already accepted Work-owned snapshot.

Default Work and Work-create request schemas retain presence information:

- no `skills` property: preserve the existing default on default update, or inherit the current default on Work creation;
- `skills: ["a", "b"]`: replace with exactly those names;
- `skills: []`: explicitly clear the selection.

The CLI maps repeated `--skill` to the array, `--no-skills` to an empty array, and omission to no property. It rejects `--no-skills` combined with `--skill`, duplicate names, and obsolete `--expected-revision` before making an HTTP request. Explicit CLI options override a configuration-file field; an absent CLI selection leaves the file selection in place, and total absence inherits defaults.

### 4. Persist immutable Work-owned context snapshots

Each accepted Work context receives an opaque internal snapshot ID, generated independently of its public contents. The durable layout is:

```text
<data-dir>/works/<work-id>/contexts/<snapshot-id>/
  config.json
  AGENTS.md
  skills/
    <skill-name>/SKILL.md
    <skill-name>/scripts/...
    ...
  metadata.json
```

`config.json` holds effective non-secret runtime configuration and safe secret references; `metadata.json` holds internal snapshot identity, image digest, Skill tree identities, and creation metadata. Secrets remain outside the snapshot in the protected secret store and are materialized into a separate ephemeral/restricted runtime directory when starting the container. Neither file contains secret plaintext.

The snapshot builder replaces `RuntimeMaterializationSource.readSkill()` with directory-copy methods that accept only a resolved Core-managed artifact handle. It builds a sibling staging directory, copies and revalidates every selected complete tree, writes `AGENTS.md`, `config.json`, and `metadata.json` exclusively, fsyncs completed files/directories where supported, and atomically renames the snapshot into place. A database transaction points desired context at it only after the rename succeeds. On transaction failure the snapshot is unreferenced and cleaned immediately or during startup. On copy/validation failure the desired pointer and existing snapshots stay unchanged.

The first context created with a Work is both active and desired only after all files and the immutable image identity are resolved. Subsequent edits create a new desired snapshot and leave the active pointer unchanged. The Work runtime receives a read-only bind mount of only the selected active snapshot at `/run/piwork`; writable data, Session, and cache mounts remain separate. No container bind mount points at `<data-dir>/skills`, an operator source, another Work, or the desired snapshot.

Snapshot validation before readiness recomputes the canonical Skill tree identities, checks each selected directory basename against its configured Skill name, requires a regular root `SKILL.md`, validates `AGENTS.md` UTF-8 and its 256 KiB limit, validates configuration, and checks ownership/containment under the expected Work directory. It does not interpret `SKILL.md`. Agentd's runtime config contains an opaque `contextIdentity`, Core-assigned Skill names, and internal expected identities needed for integrity checks.

Agentd and `packages/pi-adapter` replace the current manifest-name equality check with directory-bound loading. For each configured name, the adapter invokes the Pi SDK loader on `/run/piwork/skills/<name>`, requires exactly one loadable root Skill from that directory, retains SDK-parsed instructions, description, and supported runtime flags, and overwrites the returned `Skill.name` with the configured directory name before exposing it to the resource loader. It correlates a load result by its contained `baseDir`, never by frontmatter `name`. Missing or malformed SDK content, SDK diagnostics that prevent a load, an unexpected base directory, or multiple results block readiness under the safe Core-assigned name. Thus a frontmatter name may be absent or different without renaming the Skill, while invalid Pi SDK content can be imported by Core but fails when a Work attempts activation. Host Skill discovery remains disabled, and supporting scripts, references, and templates remain accessible below the copied directory.

### 5. Use internal snapshot capture to implement revision-free updates and apply

Internal numeric columns in `works` and `work_config_revisions` can remain to minimize migration risk, but services and contracts will rename their meaning to snapshots and keep them private. `pendingApply` is computed as `active_snapshot_id != desired_snapshot_id`; the public view is never computed from caller-supplied state.

Desired updates use `BEGIN IMMEDIATE` and perform the following atomic database step after the snapshot directory exists:

1. read the current desired configuration;
2. merge only the requested fields;
3. insert the new immutable snapshot row;
4. move the Work's desired pointer to it;
5. commit.

SQLite serializes these write transactions. Therefore two successful writers observe commit order and the later commit becomes desired, without a compare-and-swap conflict. Field-specific endpoints merge against the desired configuration read inside their own transaction so unrelated fields from an earlier committed update are retained.

`work config apply` creates an Operation whose internal request records `capturedSnapshotId = current desired snapshot` in the same transaction that accepts the Operation. Lifecycle processing prepares and starts exactly that snapshot. On readiness success it updates active to the captured snapshot even if desired has since moved. Thus applying B while a later edit creates C results in active B, desired C, and `pendingApply: true`. On preparation/readiness failure it leaves active untouched and keeps desired available. Applying when active already equals desired succeeds idempotently without replacing the runtime.

Sessions store the active opaque context identity at creation. A Run captures the Session/active context identity before submission and retains it for its lifetime. New Sessions after apply use the new active context; an already accepted Run continues on its captured context. Cross-Work context lookup requires both Work ID and context ID and rejects a mismatch without disclosing the other Work.

### 6. Add explicit operator and user HTTP surfaces

The operator routes use existing operator authentication and authorization:

```text
GET    /control/skills
POST   /control/skills                  { "path": "/absolute/directory" }
GET    /control/skills/:name
PUT    /control/skills/:name            { "path": "/absolute/directory" }
POST   /control/skills/:name/enable
POST   /control/skills/:name/disable
DELETE /control/skills/:name
```

The user routes use the existing login bearer session and return only enabled public metadata:

```text
GET /api/v1/skills
GET /api/v1/skills/:name
```

The default Work update route no longer accepts `expectedRevision` and treats `skills` as the tri-state field described above. Per-Work routes keep their current paths and remove expected revision:

```text
GET  /api/v1/works/:id/configuration
PUT  /api/v1/works/:id/configuration          { "configuration": ... }
PUT  /api/v1/works/:id/configuration/skills   { "skills": [...] }
PUT  /api/v1/works/:id/configuration/agents   { "agentsMd": "..." }
POST /api/v1/works/:id/configuration/apply    {}
```

`packages/client-sdk` exposes corresponding typed methods without revision parameters. HTTP error mapping uses stable safe codes including `SKILL_ALREADY_EXISTS`, `SKILL_NAME_MISMATCH` for an update/path-basename mismatch, `SKILL_IN_USE_BY_DEFAULT`, `SKILL_UNAVAILABLE`, `INVALID_SKILL_PATH`, `INVALID_SKILL_NAME`, `INVALID_SKILL_STRUCTURE`, `SKILL_IMPORT_LIMIT_EXCEEDED`, `SKILL_LOAD_FAILED` during activation, and the existing authentication/authorization codes. User-facing unavailable behavior does not distinguish missing from disabled. Detailed filesystem causes and paths are logged only on the Core side after redaction.

### 7. Keep command ownership split between `piwork-serve` and `piwork-cli`

`piwork-serve` adds:

```text
skills list
skills show <skill-name>
skills add --path <absolute-directory>
skills update <skill-name> --path <absolute-directory>
skills enable <skill-name>
skills disable <skill-name>
skills remove <skill-name>
config default-work set [--skill <skill-name>]... [--no-skills] ...
```

`piwork-cli` adds:

```text
skills list
skills show <skill-name>
work create ... [--skill <skill-name>]... [--no-skills]
work config skills set <work-id> [--skill <skill-name>]... [--no-skills]
work config apply <work-id>
```

Operator Skill mutation is deliberately absent from `piwork-cli`, and user Work creation/control remains absent from `piwork-serve`. Both clients retain one-JSON-value output in JSON mode. Human output shows Skill names and public state only. Help text contains no `catalog-id`, `revision`, or `expected-revision` terminology for Work context operations.

### 8. Migrate version 4 data through an idempotent filesystem-aware startup phase

SQLite migration 5 creates the Skill artifact and Work context metadata needed for snapshots and adds internal pointer columns or mapping tables. Schema DDL remains transactional. Because existing Skill and active Work conversion reads files and writes directories, a separate startup migration phase records per-item states in an internal migration table and can safely resume after interruption.

Legacy Skill conversion follows these rules:

- For a `kind = 'skill'` catalog entry with a valid readable directory `mutable_reference`, import the complete directory under that directory's validated basename. When the legacy ID differs and the basename is not already used, rename the catalog identity transactionally and rewrite default and Work selections; never inspect `SKILL.md` to decide identity.
- For a reference directly to a regular `SKILL.md`, use its parent directory basename and import that complete parent directory only if containment, root-file, and tree validation pass.
- Never retain the legacy path as a runtime fallback after conversion.
- If safe import is impossible, disable the catalog entry, record a safe migration error, and reject new default/Work selection of it. Existing Work contexts already materialized on disk remain usable.

Default Work configuration is rewritten to the new public shape with Skill names and no embedded public revision. Existing desired and active Work configurations receive internal snapshot rows. For a running or previously materialized Work, migration first copies the current materialized `/run/piwork` tree into Work-owned active storage and validates it. If only a managed legacy source is available, migration imports and copies it once. Desired and active pointers preserve their previous relationship. A Work whose active context cannot be reconstructed is retained with a safe unavailable/migration-error state rather than silently starting from new defaults or current Skill content.

Migration is complete only after all item records are terminal and all database pointers refer to validated Work-owned directories. Startup cleanup removes abandoned staging directories and immutable artifacts/snapshots with no database reference after a grace-free validation pass while Core is not accepting Work operations.

Deployment must stop Core and back up the entire data directory, including SQLite, secrets, runtime data, managed Skills, and Work contexts, before the first upgraded startup. The upgraded database is not supported by older binaries. Rollback therefore restores that complete backup; copying only the old SQLite file over newly migrated directories is unsupported.

### 9. Test at service, process, migration, and Docker boundaries

Tests will prove the following layers:

- Unit tests for normalized directory-basename validation, proof that Core never parses or exposes `SKILL.md` metadata, deterministic tree identity, safe recursive traversal, all size/count limits, symlink and special-file rejection, required regular `SKILL.md`, staging cleanup, duplicate add, update basename mismatch, and path redaction (`SKM-001`–`SKM-003`).
- Store and migration tests for v4 upgrade, resumable item migration, default-reference protection, Skill current pointers, snapshot ownership, last-committed desired updates, captured apply B followed by desired C, apply failure, and public projection without revisions (`WCFG-001`–`WCFG-003`).
- HTTP tests for operator-only mutation, user discovery, missing/disabled indistinguishability, route schemas, legacy revision rejection, and no sensitive fields (`SERVE-CTRL-001`, `CLI-SKILL-001`).
- Real CLI subprocess tests for add-by-path, list/show/update/disable/remove, default Skill selection, inherited/explicit/empty Work creation, per-Work reselection, apply, help text, JSON output, and client separation (`CLI-WORK-001` and control-plane requirements).
- Docker acceptance with a Skill that reads a supporting file and declares a frontmatter name different from its directory basename. Confirm the runtime reports the directory-derived Core identity. After Work creation, delete the original import path; update or remove the Core Skill; restart Core and the Work; confirm the existing Work uses its old complete copy and a newly created/reconfigured Work uses the current copy (`RUNTIME-MATERIALIZE-001`, `RUNTIME-PI-001`, `SKILL-001`–`SKILL-003`).
- Session/Run tests that apply a new context while a Run exists, restart agentd, continue history under the captured context, and reject cross-Work context identity (`CONV-SESSION-001`, `CONV-CONTEXT-001`).
- Security tests for relative paths, invalid basenames, path traversal, root or nested symlinks, FIFO/device/socket entries, unreadable files, missing/non-regular root `SKILL.md`, oversize trees/files, partial-copy crashes, orphan cleanup, and redaction from logs returned through APIs. Separate agentd tests cover malformed or unloadable `SKILL.md` at activation.

The existing deterministic Pi SDK acceptance fixture remains the required model-independent proof. The credential-gated real-model smoke remains optional and verifies that the same Work-owned context reaches the actual configured provider.

## Risks / Trade-offs

- **Disk amplification:** every Work snapshot owns complete Skill copies, and desired/active snapshots may overlap. This is intentional isolation. Internal content identities permit later deduplication, but this change uses ordinary copies so deleting or updating one owner can never change another owner.
- **Database/filesystem atomicity:** SQLite cannot atomically commit a directory rename. Publishing immutable directories before pointer transactions plus startup orphan cleanup ensures a crash yields either the old pointer or a complete new artifact, never a pointer to a partial tree.
- **Internal legacy naming:** retaining numeric revision columns reduces migration risk but can tempt accidental exposure. Public contract types and serializers are separate, route schemas reject revision fields, and regression tests scan every public surface.
- **Last-commit-wins updates:** removing compare-and-swap means concurrent edits to the same field can overwrite each other. This is the selected product behavior. Transactions merge field-specific updates against the latest desired state and deterministic commit order defines the winner.
- **Legacy artifacts may be unrecoverable:** an old host path may already be gone. The migration reports the affected Skill or Work safely and never substitutes newer defaults. Operators restore the path from backup or re-import/reconfigure explicitly.
- **Recursive import attack surface:** an operator-controlled tree can race with traversal. The importer uses no-follow entry inspection, revalidates the staged copy, enforces containment and limits, and only publishes the staged immutable result. Ordinary users cannot invoke path-based operations.
- **Deferred Skill format validation:** Core deliberately treats `SKILL.md` as opaque, so import can succeed for content the Pi SDK cannot load. Activation reports `SKILL_LOAD_FAILED` under the directory-derived name and leaves the previous active context usable. This preserves the requested Core boundary at the cost of detecting semantic errors later.
- **Runtime compatibility:** agentd currently enforces frontmatter-name equality while the Pi SDK prefers frontmatter `name`. Updating runtime configuration and isolated resource loading in one deployment is required so the adapter binds loaded SDK metadata back to the configured directory name; readiness rejects incomplete or unloadable context rather than running with partial Skills.

## Migration Plan

1. Stop the existing Core and create a complete backup of `<data-dir>`.
2. Deploy contracts, store migration, Core, agentd image, and both CLI binaries from the same release. Build/publish the compatible agent image before starting upgraded Works.
3. Start Core. SQLite migration 5 creates internal tables/columns; the resumable startup migration imports legacy Skills and builds Work-owned snapshots before Work reconciliation or Work API mutations are enabled.
4. Inspect startup migration status and repair any safely reported unavailable legacy Skill/Work. Core health remains reachable; readiness remains false for affected required runtime state.
5. Verify operator Skill listing, default Work configuration, one existing Work restart, a new Work creation, and a conversation that reads a supporting Skill file.
6. Update automation to remove `--expected-revision` and revision response parsing. Use `active`, `desired`, and `pendingApply`.
7. If rollback is required, stop Core and restore the complete pre-upgrade data-directory backup before running the prior binary. Do not run the prior binary against schema version 5.
