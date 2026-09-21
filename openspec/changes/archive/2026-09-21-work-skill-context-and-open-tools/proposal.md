# Proposal

## Why

Work configurations currently store Skill references and tool policy metadata, but the selected Skills are not connected to the real agentd/Pi SDK session. Every agent also lacks a Work-level `AGENTS.md`, and production Runs expose only the read tool even when the container is isolated. This change makes the default Work environment reproducible at creation time and lets each user customize Skills and agent instructions without changing other Works.

## What Changes

- Add a persisted default Work configuration managed by `piwork-serve`, covering the default base image, Skills, and `AGENTS.md` content alongside the existing runtime defaults.
- Copy the current default Work configuration into every newly created Work as its independent desired configuration snapshot.
- Add Work creation inputs for a base image, repeated Skill selections, and an `AGENTS.md` file override; omit a dedicated `set-base-image` command.
- Add `piwork-cli` Work configuration operations for listing/replacing Skills and reading/updating the Work's `AGENTS.md`.
- Materialize each Work's selected immutable Skills and `AGENTS.md` into its isolated runtime and load them through the Pi SDK resource loader.
- Enable the complete supported Pi SDK built-in tool set inside the agent container, while retaining the Work tool policy as the final explicit allow/deny contract.
- Preserve desired/active revisions and explicit `work config apply`; changing global defaults or a Work's desired configuration MUST NOT interrupt an active Run.
- Add migration, API, CLI, deterministic tests, and real-container acceptance proving Skill and `AGENTS.md` behavior survives Work restart and remains isolated between Works.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec/specs/control-cli`: expose default Work configuration controls and user-client Work Skill/`AGENTS.md` commands.
- `openspec/specs/serve-control-plane`: allow operators to inspect and update the default Work configuration without accessing user conversation content.
- `openspec/specs/work-configuration`: define default snapshot copying, per-Work Skills and `AGENTS.md`, base-image creation overrides, revisions, and explicit apply behavior.
- `openspec/specs/skill-activation`: connect configured Skills and Work `AGENTS.md` to the real agent runtime with immutable and isolated loading.
- `openspec/specs/runnable-work-runtime`: materialize Work context and expose the complete Pi SDK tool set inside the isolated container.
- `openspec/specs/agent-conversation`: make the Work context and selected tools observable in real Session/Run execution.

## Impact

- Core contracts and SQLite migrations gain default Work context and per-Work `AGENTS.md`/Skill configuration fields.
- Core control-plane routes and `piwork-serve` gain default Work configuration read/update operations.
- User client routes and `piwork-cli` gain Work Skill and `AGENTS.md` operations plus creation flags.
- Work lifecycle materialization and Docker mounts must pass the snapshot to agentd instead of resolving only the global runtime profile.
- agentd and `@piwork/pi-adapter` must use an isolated resource loader with configured Skills and `AGENTS.md`, and Pi SDK sessions must enable the supported built-in tools.
- Existing Works receive an empty AGENTS.md field during migration while retaining their current configuration, active revision, sessions, and Runs; only newly created Works copy the current default.
- The change does not add a dedicated `set-base-image` command, Docker socket access, host Skill discovery, remote Work sharing, or a WebUI.
- Model credentials, operator credentials, and other secrets remain outside public Work configuration responses and are never placed in `AGENTS.md`, Skill content, Run events, or CLI output.
