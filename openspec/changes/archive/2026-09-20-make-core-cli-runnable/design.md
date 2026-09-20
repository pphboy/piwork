# Design

## Context

See `proposal.md` for motivation and the three capability specs for the observable contract. The repository already contains a SQLite `CoreStore`, identity services, Work configuration and lifecycle services, a Docker command adapter, a `WorkStore`, Session and Run managers, generated gRPC contracts, Pi SDK persistence/event adapters, and a deterministic Pi SDK model fixture. These pieces are mostly library-level implementations. The current executable files are banners or narrow bootstrap wrappers, agentd has no server composition, the Docker adapter is not connected to `WorkLifecycleService`, and no route takes an authenticated CLI request through Core to a container.

The earlier `bootstrap-work-runtime` change marked its tasks complete based on focused tests. Its acceptance claims do not correspond to a runnable image, a real Core-to-agent transport, or product subprocesses. This change treats those modules as inputs to verify and integrate rather than evidence that the end-to-end path already exists.

The implementation uses Node.js 24 and the existing npm workspace. Docker is the supported local runtime. Core remains a single host process and one agentd process runs in each Work container.

## Goals / Non-Goals

**Goals:**

- Produce one documented path from an empty data directory to administrator login, Work creation, ready agentd, and a CLI-visible assistant reply.
- Reuse and complete the existing lifecycle, Docker, persistence, generated protocol, and Pi SDK modules instead of adding parallel demo implementations.
- Preserve database state, login credentials, Work resources, and Session history across Core restart.
- Exercise the same built Core, CLI, image, Docker adapter, gRPC transport, agentd, and Pi SDK layers in required automated acceptance.
- Keep secrets out of arguments, logs, API responses, Run events, and Session history.

**Non-Goals:**

- Serve the browser Console in this change.
- Complete agent-managed service-container tools or prove arbitrary Skills and MCP configurations end to end.
- Add public TLS termination, remote deployment automation, multi-host scheduling, or high availability.
- Make the deterministic model a documented production model option.

## Decisions

### 1. Keep one data-directory contract for all Core commands

`bootstrap-admin`, `configure-runtime`, and `serve` take required `--data-dir <path>` and resolve the Core database as `<data-dir>/core.sqlite`. Core-owned runtime profiles, CA material, secrets, materialized Work configuration, and installation identity live beneath that directory with restrictive permissions.

The local setup commands are:

```bash
npm run core -- bootstrap-admin --data-dir .piwork/core --account admin --password-stdin
npm run core -- configure-runtime --data-dir .piwork/core \
  --agent-image piwork-agentd:local \
  --model-provider <provider> --model <model> --api-key-stdin
npm run core -- serve --data-dir .piwork/core
```

`configure-runtime` runs while Core is stopped, validates that the image exists and has compatible metadata, reads the credential from a hidden prompt, `--api-key-stdin`, or an explicit protected file, and atomically writes a versioned default profile. It stores the secret separately as a `0600` file and records only its opaque reference in the profile. Reconfiguration creates a new profile revision; existing Work revisions remain reproducible.

A single configuration command is preferable to requiring users to call low-level catalog and secret APIs before their first Work. The internal catalog records remain the source of truth, and advanced Work JSON can still select explicit catalog entries.

### 2. Build one production agent image and one acceptance variant

A multi-stage root Dockerfile builds the workspace and produces the documented `piwork-agentd:local` image with only required production packages and compiled output. Its entrypoint starts agentd, it runs as a fixed non-root numeric user, and it declares protocol/version labels that Core verifies.

The normal image constructs a Pi SDK `ModelRuntime` from provider, model, optional base URL, and mounted API-key file. The acceptance harness builds the same Dockerfile with an explicit fixture target or build argument that enables the in-repository deterministic provider. That provider still executes through the real Pi SDK Session API and event mapper; it only replaces the external model network call. Agentd refuses deterministic configuration in the normal production target.

This keeps required acceptance stable and free of paid credentials while preventing the fixture provider from silently becoming the user-facing default. An opt-in smoke configures the normal image from environment-provided real provider credentials and asserts a non-empty response.

### 3. Compose a complete Core application behind a thin executable

A `CoreApplication` owns configuration, the store lock, `CoreStore`, identity, catalog/configuration services, the production Work runtime adapter, `WorkLifecycleService`, recovery, the agent gateway, HTTP routing, readiness, and shutdown. Construction rolls back acquired resources on failure. `close()` is idempotent.

`serve` verifies bootstrap state but can start when the runtime profile or Docker is unavailable so identity and diagnostics remain accessible. In that state `/healthz` succeeds, `/readyz` reports the safe blocking reason, and Work mutations fail with a stable dependency/configuration error. Startup recovery runs before readiness can succeed.

Normal Core shutdown stops new scheduling and closes HTTP/gRPC/store resources but deliberately does not stop Work containers. The next Core adopts them. Explicit Work stop/delete remains the only path that stops or removes a Work because tying container lifetime to the controller process would defeat restart continuity.

### 4. Adapt the existing Docker primitives to Work lifecycle semantics

A production `DockerWorkRuntimeAdapter` implements the existing `WorkRuntimeAdapter` using `DockerRuntime`, configuration validation/artifact resolution, and materialization. For one Work generation it:

1. Resolves the immutable agent image and model profile.
2. Creates or adopts the labeled private Work network and retained volumes.
3. Generates generation-scoped agent server identity and configuration beneath the Core data directory.
4. Materializes public model metadata plus read-only secret paths, never secret values, into the runtime configuration.
5. Creates or adopts one labeled agent container with deterministic logical identity, mounts, resource limits, no host network, no Docker socket, and no host-published port.
6. Starts the container, obtains its current private-network address from Docker inspection, establishes the authenticated gRPC channel, and waits for readiness.
7. Publishes discovery only after Work ID, generation, instance ID, protocol version, model initialization, and writable Work storage all match.
8. Implements inspect, drain, stop, remove, and managed-instance listing without treating an unknown Docker state as stopped.

The adapter extends `DockerRuntime` only with inspection data and operations needed by this composition. It does not shell out independently or bypass managed-resource labels. Reconciliation adopts only a resource whose installation ID, Work ID, logical ID, generation metadata, and immutable specification match the persisted record.

### 5. Use private-network mTLS for Core-to-agent gRPC

The generated agent protocol is extended with readiness and drain RPCs. Agentd listens on a fixed container port only inside its Work bridge network. Core discovers the container IP through Docker inspection; the address never appears in client APIs.

On first configuration Core creates an installation CA beneath the data directory. Each runtime generation receives a server certificate and a Core client certificate with Work/generation identity, mounted read-only. Agentd requires the client certificate and validates the expected Work and generation from its configuration. Core validates the server certificate and compares the readiness response with the persisted Work ID, generation, and Docker instance ID before publishing discovery.

mTLS is chosen over a bearer value in container environment variables because the prior architecture already requires authenticated encrypted transport and environment values are easy to expose through inspection. There is no host-published agent port, but authentication still matters for other containers and stale instances on Docker networks.

A per-Work gateway object owns channel creation and closure. User bearer tokens terminate at Core and are never forwarded to agentd. Core performs Work authorization first and sends only the internal generation identity on the gRPC call.

### 6. Turn agentd into one resource-owning application

The agentd entrypoint reads one bounded versioned configuration file, validates its container identity, opens `/var/data/work.sqlite`, recovers interrupted Runs, initializes the model runtime, loads the selected Skills and MCP configuration that the existing adapters support, then starts the mTLS gRPC server. Readiness remains false until storage recovery and model initialization finish.

The gRPC handlers delegate to `AgentSessionService` and `RunManager`. Session creation gains persistent idempotency because the protocol already carries a key but the current service ignores it. The Run executor loads the selected persistent Pi SDK Session, appends the user prompt through the SDK, runs the model, maps SDK text/tool/state events into durable Run events, saves the assistant result in SDK history, and commits exactly one terminal Run state.

An observation stream reads existing events after the requested cursor and then follows appended events until a terminal state. Cancelling a client stream only closes that observer. `CancelRun` alone calls the SDK abort path. Drain first prevents new Runs, asks active Runs to finish within the lifecycle bound, and then cancels remaining Runs before acknowledging.

### 7. Route public HTTP control and conversation APIs through one server

One ordered router serves:

1. `GET /healthz` and `GET /readyz`.
2. `POST /api/v1/login`.
3. Bearer authentication for all remaining `/api/v1` routes.
4. `GET /api/v1/me` and `POST /api/v1/logout`.
5. Work list/detail/create and action routes plus Operation detail.
6. Session create/list/detail routes.
7. Run submit/detail/cancel routes and an event stream.

All JSON bodies have a fixed maximum size. Known domain failures map to the existing safe `ApiError` shape, including authentication, not found, conflict, runtime unavailable, Work unavailable/busy, cursor expired, and rate limited. Unexpected details stay in server diagnostics.

The event endpoint uses newline-delimited JSON over a chunked HTTP response. Each line is one complete event and carries its durable sequence. NDJSON fits the Node built-ins already used by the project and is simpler for CLI cursor recovery than adding a WebSocket dependency. A completed stream ends after its terminal event; reconnect includes `after=<sequence>`.

### 8. Put typed transport primitives in the client SDK

`PiworkClient` owns typed methods for health/readiness, authentication, Work lifecycle, Operations, Sessions, Runs, cancellation, and event observation. Its request layer supports empty 204 responses, validates structured errors, limits buffered bodies, and exposes a typed safe error with status, code, retry metadata, and identifiers when available.

The versioned credential record contains Core URL, opaque token, expiration, and public identity. Its default path is `$XDG_CONFIG_HOME/piwork/client.json`, falling back to `$HOME/.config/piwork/client.json`; `PIWORK_CONFIG_PATH` overrides it for tests. POSIX writes reject symlinks and non-regular files, create the directory as `0700`, and atomically replace a same-directory `0600` file.

The SDK event reader parses bounded NDJSON incrementally, rejects malformed or out-of-order events, exposes the latest durable cursor, and distinguishes a transport exception from a terminal Run state.

### 9. Keep the CLI thin but make every required path executable

The CLI owns argument parsing, password input, output formatting, cursor behavior, signal handling, and exit mapping. The SDK owns HTTP details.

`work create --name <name>` asks Core to apply the default runtime profile. `--config <file>` submits an explicit `WorkConfig`. Mutation commands generate a UUID idempotency key unless `--idempotency-key` is given for a caller-controlled retry. `--wait` polls the returned Operation with bounded backoff and prints both identifiers before waiting.

`chat <workId>` creates a Session unless `--session <id>` is provided. `--message <text>` performs one Run; without it an interactive TTY loop reads prompts until EOF. The CLI prints the Session and Run IDs before observation, streams text events, and prints terminal errors separately. On Ctrl-C during a Run it sends one explicit cancel and reports the durable result. On transport loss it retains the Run ID and cursor and gives a `run watch` recovery command; it does not resubmit.

Defined exit statuses are 0 success, 1 unclassified server/local failure, 2 usage, 3 authentication, 4 not found, 5 Core/runtime unavailable, 6 failed Work Operation, and 7 failed/cancelled/interrupted Run. `--json` is one JSON result for bounded commands; `run watch --json` and scripted chat use one documented NDJSON event per line because they are streams.

### 10. Prove the product boundary with real processes and Docker

A root acceptance harness builds the workspaces and deterministic agent image, owns a temporary Core data directory and CLI config path, and uses a unique Docker installation ID. It removes only resources carrying that ID in `finally`.

The required sequence is:

1. Run compiled `piwork-core bootstrap-admin` with password stdin.
2. Configure the deterministic acceptance runtime profile through the compiled Core command.
3. Start compiled Core on `127.0.0.1:0`, parse its structured startup record, and wait for readiness.
4. Run compiled CLI status, login, and whoami processes.
5. Run `work create --wait`; inspect Docker to prove a non-root managed agentd container exists.
6. Run scripted chat and assert the expected deterministic Pi SDK reply plus persisted Session and Run IDs.
7. Send `SIGTERM` to Core, require bounded successful shutdown, and prove the agentd container remained running.
8. Restart Core on the same port and data directory, use the saved CLI credential without `--core` or another login, and continue the same Session with a second prompt.
9. Stop and start the Work, continue the same Session again, then logout and prove the old token is rejected.
10. Delete the Work, stop Core, and verify cleanup leaves no managed container/network while retained-data behavior matches the spec.

The test fails if it detects direct store seeding, a fake lifecycle adapter, an in-process Core/CLI shortcut, or host execution of agentd. Focused unit tests remain useful, but only this acceptance test supports the claim that users can create a Work and converse.

The optional real-model smoke reuses the normal image and the same commands, reads provider/model/key from explicitly named environment variables, sends a low-cost prompt, and asserts a non-empty successful result. It is excluded from the default test command because external credentials, network availability, rate limits, and cost are not deterministic.

### 11. Make the root workspace the only supported entrypoint

Root scripts include `core`, `piwork`, `agent:image`, the Docker-backed acceptance command, and the opt-in real-model smoke. README and operations documentation show the exact image build, bootstrap, runtime configuration, serve, login, Work create, chat, restart, logout, and cleanup commands.

The `demo/` directory is removed only after the Docker acceptance path passes. No compatibility wrapper or demo data migration remains because two independent startup paths would make operational failures and persistence behavior ambiguous.

## Risks / Trade-offs

- [Docker-backed acceptance is slower and requires a usable local engine] -> Keep unit tests fast, give the acceptance script a clear dependency preflight and bounded timeouts, and make it the required release gate for the runnable claim.
- [Container-IP routing is Linux Docker specific] -> State Linux Docker as the first supported runtime and keep address discovery inside `WorkRuntimeAdapter` so a future proxy or runtime can replace it.
- [mTLS lifecycle adds certificate handling] -> Generate all material within the Core data directory, use short-lived generation certificates, restrict file modes, test stale-generation rejection, and avoid exposing certificate paths in APIs.
- [Core can be healthy while Work operations are blocked] -> Keep liveness and readiness distinct and make both `/readyz` and CLI status report the safe blocking dependency.
- [A real provider can fail for external reasons] -> Required acceptance uses the deterministic provider through the real Pi SDK; the opt-in smoke separately proves live-provider configuration without making release tests flaky.
- [Existing library tests overstate implementation completeness] -> Add tests at the adapter, transport, process, container, and product boundaries and do not mark tasks complete solely because an older isolated test passes.

## Migration Plan

1. Add runtime-profile storage, image build, agentd server, production adapters, Core composition, APIs, SDK, and CLI while retaining the demo temporarily.
2. Pass unit, integration, and full Docker process acceptance from a clean temporary installation.
3. Update root scripts and operational documentation to the verified command sequence.
4. Remove `demo/` and all supported references to its commands or state.
5. If rollout fails before any user Work is created, stop Core and restore the previous workspace revision. Core and Work SQLite migrations remain forward-only; rollback after data creation requires restoring the data-directory backup documented by operations guidance.
