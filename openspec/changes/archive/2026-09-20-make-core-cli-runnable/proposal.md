# Proposal

## Why

The root workspace contains most of the Core, Docker, agentd, persistence, and Pi SDK building blocks, but they are not composed into a runnable product. A user still cannot start Core, create a Work, or exchange messages through the supported `piwork` CLI after the standalone demo is removed.

## What Changes

- Add a long-running `piwork-core serve` command that opens the durable Core store, authenticates users, assembles Work lifecycle and conversation services, starts recovery, connects to Docker, and shuts down without destroying running Works.
- Add a local runtime-profile command and a reproducible agentd image build so an installation can configure an agent image and model credentials without manually editing SQLite or exposing secrets in process arguments.
- Expose authenticated Work create/list/show/start/stop/retry/delete and Operation APIs, backed by the existing durable lifecycle coordinator and a production Docker runtime adapter.
- Run a real agentd server in each Work container, connect Core to the current verified Work generation, and expose Session and Run creation, query, observation, continuation, and cancellation through Core.
- Make the root `piwork` CLI executable: configure one Core URL, securely persist login credentials, create and control Works, and hold scripted or interactive conversations that display streamed agent output.
- Preserve the Core database, login sessions, Work identity, Work data, Session history, and completed conversation history across Core restart; recover or adopt the existing Work container without creating a duplicate daemon.
- Add real child-process and Docker acceptance coverage for bootstrap, login, Work creation, readiness, Pi SDK conversation, Core restart, session continuation, logout, and cleanup. The required automated path uses a deterministic model implementation inside the real agentd container; a separate opt-in smoke uses real model credentials.
- **BREAKING**: Remove the independent `demo/` package and its separate daemon/CLI workflow; the root workspace becomes the only supported entry point.
- Keep the browser Console, agent-managed service containers, TLS termination for remote public deployment, and multi-host scheduling outside this change.

## Capabilities

### New Capabilities

- `core-service-startup`: Bootstrap, configure, start, inspect, recover, and gracefully stop a durable local Core service with an operational Docker Work runtime.
- `control-cli`: Authenticate against Core, persist the local credential safely, create and control Works, and use Session/Run conversation commands from an executable CLI.
- `runnable-work-runtime`: Build and run agentd in Docker, route Core requests to the verified Work generation, execute Pi SDK Runs, and retain conversation state across process replacement.

### Modified Capabilities

None. The project currently has no durable main specs; the completed bootstrap change contains only change-local delta specs.

## Impact

- Affects root scripts and documentation, `apps/core`, `apps/agentd`, `apps/cli`, `packages/client-sdk`, `packages/runtime-docker`, `packages/pi-adapter`, and the control/agent contracts.
- Extends the Core HTTP surface with system, authentication, Work mutation, Operation, Session, Run, event-observation, and cancellation routes.
- Adds an agentd container image, real gRPC server/client composition, installation runtime-profile files and secret material under the Core data directory, and Docker-backed recovery at Core startup.
- Requires a working local Docker engine for Work creation and the full acceptance path. Normal automated acceptance does not require network access or paid model credentials; the opt-in real-model smoke does.
- Deletes `demo/` and its independent lockfile, generated output, local environment, and sample runtime data.
