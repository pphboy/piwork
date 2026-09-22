# Proposal

## Why

Core currently lets Work configuration reference Skill catalog entries, but it has no supported operator API or CLI for importing and managing Skills, and the runtime still reads host Skill paths when materializing a Work. This leaves default Skill selection unusable on a fresh installation and prevents a Work from carrying a durable, self-contained copy of the context it was created with.

## What Changes

- Add first-class Core Skill management. An operator imports a complete Skill directory with `piwork-serve skills add --path <directory>`; Core uses the directory basename as the unique public Skill identifier, validates the directory tree without parsing `SKILL.md`, and atomically copies it into Core-managed storage.
- Add operator list, show, update, enable, disable, and remove operations keyed by Skill name. Import paths are accepted only by add/update and never become public identifiers or Work runtime dependencies.
- Keep the default Skill selection in the existing default Work configuration. `config default-work set` accepts repeated `--skill <skill-name>` and `--no-skills`; omitted Skill options preserve the current default selection.
- Let logged-in users list/show enabled Skills, select multiple Skill names while creating a Work, inherit the default Work selection when no Skill option is supplied, or explicitly select no Skills with `--no-skills`.
- Copy every selected complete Skill directory, `AGENTS.md`, and the resolved non-secret configuration into Work-owned durable context while creating or reconfiguring a Work. Work start, restart, recovery, and conversation execution read only the Work-owned active context rather than Core defaults or original import paths.
- Preserve existing Work context when a Core-managed Skill is updated, disabled, removed, or when default Work configuration changes. A Work adopts current Core-managed Skill content only after its owner explicitly selects Skills again and applies the pending context.
- **BREAKING** Remove the public revision contract from default Work and per-Work configuration CLI commands, HTTP requests, and responses. Configuration commands no longer accept `--expected-revision`; callers observe `active`, `desired`, and `pendingApply`, and successful mutations are ordered by Core commit order.
- Make `work config apply` capture the desired context accepted by that operation. A later edit remains pending even if the earlier apply succeeds, while a failed apply leaves the previous active context usable.
- Migrate persisted default and Work configurations and existing runnable Works without losing their active context. Internal snapshot identities and content digests remain implementation details and are never user-managed revisions.

## Capabilities

### New Capabilities

- `skill-management`: Operator import and lifecycle management of Core-owned Skill directories, user discovery of enabled Skills, stable Skill-name identity, and safe storage behavior.

### Modified Capabilities

- `serve-control-plane`: Add operator Skill management and revise default Work Skill selection without public revisions.
- `control-cli`: Add Skill discovery and management commands, define default/explicit/empty Work Skill selection, and remove revision arguments from configuration commands.
- `work-configuration`: Replace the public revision model with active/desired/pending state and require Work-owned snapshots of Skills and other effective context.
- `runnable-work-runtime`: Start and recover containers exclusively from the Work-owned active context and mount complete Skill directories.
- `skill-activation`: Load only copied Work-owned Skill content and preserve existing Work behavior across Core Skill changes.
- `agent-conversation`: Bind Sessions and Runs to an internal immutable Work context identity without exposing configuration revisions.

## Impact

- Core control-plane and user HTTP routes gain Skill endpoints and receive breaking configuration request/response changes.
- `piwork-serve`, `piwork-cli`, and `@piwork/client-sdk` gain Skill commands and lose public revision parameters.
- Contracts change from revision-bearing Skill references and Work configuration envelopes to Skill-name selections plus active/desired/pending public state.
- Core storage gains managed Skill artifacts and durable Work-owned active/pending context directories; SQLite migrations must preserve existing defaults, Works, operations, Sessions, and recoverable runtime state.
- Docker context materialization and agentd Skill validation must handle complete directory trees rather than only `SKILL.md`.
- Security-sensitive recursive copy validation must reject symlinks, path escapes, unsupported file types, invalid or duplicate directory names, missing/non-regular `SKILL.md`, and bounded-size violations without exposing host paths to ordinary users.
- Existing CLI automation using `--expected-revision` or revision fields is intentionally incompatible and must move to the new last-committed-write and `pendingApply` contract.
- No new third-party service or external dependency is introduced.
