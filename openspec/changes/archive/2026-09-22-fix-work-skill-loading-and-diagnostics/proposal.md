# Proposal

## Why

Work Skill configuration is not yet a verifiable end-to-end feature: a newly created Work can fail with `invalid Work Skill descriptor` while the user sees only a readiness/network error, and saving desired Skills does not show what pi-agentd actually loaded. Before 0.1, close the path from Core-managed bytes to the Work snapshot, container mount, Pi SDK resource loader, readiness, and actionable diagnostics.

## What Changes

- Make each daemon load exactly its operation-selected Work-owned Skill snapshot before readiness, verify SDK file/base directories, and use that same validated loader for Sessions and Runs. Preserve directory-derived public Skill names.
- Return distinct desired, active, and currently loaded Skill states. Saving configuration remains explicit set-then-apply; updates cannot silently activate, and successful apply requires the captured candidate to pass actual SDK initialization.
- Keep Skills entirely outside agent image builds. Pin and use the captured immutable image identity; detect incompatible runtime/context contracts explicitly. Ordinary import, update, create, reselect, apply, and restart use the same compatible image.
- Make structured success and failure logs, durable Operation diagnostics, early container-exit detection, safe CLI errors, and rollback diagnostics mandatory acceptance criteria.
- **BREAKING (pre-0.1):** tighten the internal agent readiness/context handshake and public Skill/Operation response projections; apply returns an asynchronous Operation with optional CLI waiting. No old agent descriptor, historical Work-context reconstruction, or legacy Session-context conversion is supported. Preserve fresh database initialization and restart of data written by the resulting version; do not automatically reset existing data.
- Add deterministic real-SDK/Docker acceptance proving Skill body and supporting-file reads from the correct Work snapshot, plus README and CLI examples for set/apply/status/failure diagnosis.

Non-goals: automatic model selection of a Skill for arbitrary prompts, importing Skills into the image, automatic apply on set, hot-swapping an executing Run, a general-purpose log aggregation service, and migration of pre-release data. Do not reopen or rewrite the previous change's historical checklist; this follow-up owns the missing behavior and evidence.

## Capabilities

### New Capabilities

- `work-diagnostics`: correlated lifecycle/context logs, durable safe root-cause errors, bounded runtime diagnostic collection, and authorized later inspection.

### Modified Capabilities

- `skill-activation`: exact SDK directory binding, loading before ready, and truthful current load status.
- `work-configuration`: observable desired/active/loaded distinction, verifiable apply including stopped Works, honest rollback outcome, and pre-0.1 context support boundary.
- `runnable-work-runtime`: verified context/Skill handshake, immutable image use, and data-only Skill changes without rebuilding images.
- `control-cli`: complete create/set/clear/apply flow, stable asynchronous Operation output, and immediate plus later failure diagnosis.

## Impact

Touches Core Skill/context configuration and lifecycle orchestration, Docker runtime inspection, agentd initialization and executor, Pi adapter resources, protobuf/control/client contracts, Core store Operation persistence, CLI, tests, and README. No new external service or mandatory real-provider credential is required.

Existing main specs already require isolated Work copies and failure before readiness; current implementation violates those requirements. This change strengthens their observable proof and removes misleading status/error behavior. It explicitly qualifies the previous promise that failed apply always leaves a usable runtime: active data is retained, but failed restoration must report Work unavailable.

Core and agentd must deploy matching contracts once for this software change; adding or changing Skill data thereafter must not rebuild the image. Risks are false readiness, stale-generation status, changed CLI JSON shape, and diagnostic leakage; exact handshake checks, fenced state transitions, bounded allowlisted diagnostics, ownership checks, and integration acceptance address these risks. Legacy conversion is removed, not replaced with a migration project.
