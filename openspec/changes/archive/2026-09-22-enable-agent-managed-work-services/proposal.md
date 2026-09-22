# Proposal

## Why

pi-agentd can write applications but cannot currently deploy them through the running Core: service management, lifecycle hooks, and MCP tooling exist separately and are not wired into production. Users need a Python HTTP application to become a durable Work service that agentd can reach, diagnose, and recover with its files after Work restart.

## What Changes

- Connect the existing Work Service model to a real Docker service runtime and production Core. Deploy from existing images with declarative commands, environment, persistent workspace access, readiness, and resource limits; do not build or commit application images.
- Add a Core-hosted gRPC service control API authenticated by the calling agentd's current Work/generation/instance identity. Only same-Work application services are targets; agentd itself, other Works, arbitrary Docker containers, and user/installation administration are excluded.
- Supply a stdio MCP adapter and register its discovered tools with the real Pi SDK. New installation defaults select this MCP server and the bundled `deploy-work-service` Skill; explicit Skill/MCP overrides continue to work.
- Make SDK file tools and deployed applications use the same persistent workspace, separate from agentd database/history/credentials. Bind service DNS names to the existing Work network and return internal endpoints.
- Complete persistent service mutations, image identity capture, restart/recovery, quota reservations, operation fencing, shutdown, and diagnostics. Stopping Work/Core stops its services even when agentd is absent; starting Work restores enabled services without another model request.
- Supply a deployment Skill that places code and business data in the workspace, describes reproducible dependency installation, calls MCP, waits for readiness, verifies HTTP access, and retrieves failures. Verify actual Skill load and actual model tool discovery rather than configuration presence alone.
- **BREAKING (pre-0.1):** Define explicit agent resource allocations within the Work total budget, separate the shared workspace volume from agent-private storage, and replace service image catalog inputs with deployable image references. No historical Work/context/service data migration or automatic reset is included; unsupported layouts fail explicitly. Same-version restart and recovery are required.
- Correct the old `work-lifecycle` statement that Core exit leaves containers running: graceful Core shutdown stops managed Works and services while preserving their desired state for recovery. This matches the user's earlier shutdown decision and current Core behavior.

## Capabilities

### New Capabilities

- `agent-service-deployment`: Bundled default deployment Skill, its Work-owned loading contract, and the complete SDK-to-MCP-to-container deployment acceptance path.

### Modified Capabilities

- `work-services`: Deployable service definition, gRPC lifecycle interface, internal endpoints, durable operations, runtime reconciliation, and resource enforcement.
- `work-access`: Authenticated current-runtime service scope, explicit exclusion of agentd, and service-log content authorization.
- `work-storage`: Shared persistent workspace, protected agent-private state, write permissions, and shared-data retention.
- `work-lifecycle`: Restore services on every Work start/adoption path and stop all services on Work/Core shutdown, including missing-daemon cases.
- `mcp-tool-access`: Default service MCP registration, SDK tool policy, bounded operation observation, and child-process cleanup.
- `work-configuration`: Total versus agent resource allocations and usable fresh-install deployment defaults.
- `work-diagnostics`: Correlated service lifecycle failures and bounded, separately authorized application log reads.

## Impact

- Core: `apps/core/src/application/core-application.ts`, startup configuration, `work-services/service-management.ts`, `work-management/lifecycle.ts`, authorization, managed Skills, retained volumes, and new service gRPC/Docker adapters.
- Agent and shared packages: agentd startup/executor/working directory, existing `service-tools.ts`, `packages/pi-adapter/src/mcp-bridge.ts`, contracts/protobuf generation, Core storage, and Docker network/mount/runtime capabilities.
- New deliverables: `apps/service-mcp`, packaged `skills/deploy-work-service`, product acceptance coverage, and README deployment/diagnostic examples. Reuse installed gRPC, MCP, TypeBox, Pi SDK, SQLite, and Docker tooling; no new external control plane.
- Risks addressed by the design: stale daemon credentials, stop/create races, false readiness, quota oversubscription, shared file ownership, duplicate restoration, registry failures, and leaking control secrets through logs or mounts.
- Scope excludes image builds, Dockerfile execution, Docker socket exposure, host-port/public ingress, arbitrary host mounts, interactive container exec APIs, a new Console UI, data rollback, and historical migration. Existing runtime images may install application dependencies in the Work workspace through declared startup commands; no build service is introduced.
