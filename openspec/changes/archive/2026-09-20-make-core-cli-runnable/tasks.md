# Tasks

## 1. Core Configuration and Application Boundary

- [x] 1.1 Implement and test the shared `--data-dir` contract, restrictive directory layout, listen-address parsing, loopback default, port `0`, bracketed IPv6, and explicit non-loopback plaintext opt-in for all Core commands.
- [x] 1.2 Extend `piwork-core bootstrap-admin` with hidden interactive or `--password-stdin` input against `<data-dir>/core.sqlite`; verify first bootstrap succeeds, repeat bootstrap is non-destructive, and diagnostics contain no secret material.
- [x] 1.3 Add versioned default runtime-profile storage and `piwork-core configure-runtime` with agent image, provider, model, optional endpoint, protected-file or stdin credential input, atomic `0600` secret storage, and safe inspection; verify reconfiguration, malformed input, symlink refusal, and output redaction.
- [x] 1.4 Build a `CoreApplication` resource owner that opens and migrates the store, verifies bootstrap state, assembles identity and runtime services, owns readiness, rolls back partial startup, and closes listener/channels/store idempotently; verify initialization failure and immediate store-lock reuse after close.
- [x] 1.5 Implement public `/healthz` and `/readyz` behavior that distinguishes process health, missing runtime configuration, Docker failure, recovery in progress, ready state, and shutdown; verify status bodies are bounded and secret-free.
- [x] 1.6 Extend `piwork-core serve` with structured startup output and `SIGINT`/`SIGTERM` handling that leaves running Work containers intact; verify a child process exits within the grace bound and a replacement process opens the same data directory and port.

## 2. Agent Image and Runtime Materialization

- [x] 2.1 Add a multi-stage agentd Dockerfile, non-root entrypoint, protocol/version labels, minimal build context, and root `agent:image` script; verify the built normal image starts as the documented numeric non-root user and contains no Docker socket or development source tree.
- [x] 2.2 Add an explicit deterministic acceptance image target or build argument that uses the in-repository deterministic Pi SDK provider, while rejecting deterministic configuration in the normal target; verify both image identities and the production rejection behavior.
- [x] 2.3 Extend model catalog/profile metadata and runtime materialization with provider, model, optional endpoint, and read-only credential-file reference; verify model credential values never appear in Work config JSON, Docker environment, public views, logs, or returned errors.
- [x] 2.4 Extend Docker inspection with managed container network address, labels, image identity, user, mounts, and resource state needed for adoption; verify fake-runner tests parse expected data and reject missing, ambiguous, cross-installation, or mismatched resources.
- [x] 2.5 Implement `DockerWorkRuntimeAdapter` preparation and start using immutable image resolution, Work network, retained storage, generation identity, materialized config, resource limits, managed labels, and one agent container; verify focused Docker integration tests create one ready-shaped instance and repeated calls adopt it without duplication.
- [x] 2.6 Implement adapter inspect, managed-instance listing, drain, stop, and remove with dependency error mapping and retained-data behavior; verify Docker integration tests never report unknown state as stopped and remove only resources carrying the test installation ID.

## 3. Real agentd Server and Pi SDK Execution

- [x] 3.1 Extend the agent protocol with readiness, protocol identity, runtime generation, and drain operations, regenerate checked-in types, and verify serialization plus gRPC status mappings for incompatible, unavailable, busy, cursor-expired, and authentication failures.
- [x] 3.2 Implement installation CA and per-generation Core/client and agent/server certificate issuance, restrictive persistence, rotation, and verification; verify mTLS tests reject an untrusted client, wrong Work, expired certificate, and stale generation.
- [x] 3.3 Implement an `AgentApplication` that reads and bounds the versioned runtime config, validates Work/generation/instance identity, opens `WorkStore`, recovers interrupted Runs, initializes the selected model and existing Skill/MCP adapters, owns readiness, starts the mTLS gRPC server, and shuts down idempotently; verify failed initialization closes every acquired resource.
- [x] 3.4 Implement gRPC Session handlers over `AgentSessionService`, including persistent Session-create idempotency and Work identity validation; verify create/list/read/continue survive process and store reopen and reject cross-Work identifiers.
- [x] 3.5 Implement a production `RunExecutor` that loads the persistent Pi SDK Session, submits the prompt to the configured model, maps text/tool/state events, persists final history, and redacts provider errors; verify deterministic Pi SDK tests produce the expected reply and exactly one terminal state.
- [x] 3.6 Wire Run submit/get/watch/cancel handlers to `RunManager`, make observation loss independent of execution, enforce one active Run per Work, and connect explicit cancellation to Pi SDK abort; verify idempotent retry, disconnect/resume, cursor expiry, cancellation race, and startup interruption behavior.
- [x] 3.7 Implement bounded drain that rejects new Runs, waits for active execution, cancels at the configured deadline, and acknowledges only after the active slot is released; verify stop tests leave no managed SDK or MCP process running.

## 4. Core Docker Recovery and Agent Gateway

- [x] 4.1 Implement the Core mTLS agent client/channel factory using Docker-discovered private addresses and expected Work/generation identity; verify a real Docker gRPC round trip reaches agentd without a host-published agent port.
- [x] 4.2 Integrate the production runtime adapter with `WorkLifecycleService` and mark a Work ready only after matching agent readiness; verify create/start/stop/retry/delete HTTP integration tests use the adapter contract and expose durable Operation failures.
- [x] 4.3 Implement startup recovery that scans persisted desired state and managed Docker instances, adopts matching agentd, resumes incomplete Operations, reports orphans, and blocks routing until verification; verify fault-injection after container creation does not create a duplicate on Core restart.
- [x] 4.4 Implement an authorized agent gateway for Session and Run calls that enforces the existing Work access policy before gRPC, routes only to the current ready generation, closes stale channels, and never forwards user bearer tokens; verify owner, administrator-control-only, unauthorized, stopped, and stale-generation cases.
- [x] 4.5 Ensure Core shutdown stops recovery/scheduling and closes agent channels without draining or stopping healthy Work containers; verify process tests observe the same container ID running before and after Core replacement.

## 5. Core HTTP API and Client SDK

- [x] 5.1 Build one ordered Core HTTP router for probes, login, Bearer authentication, logout, current identity, Work lifecycle, Operation, Session, and Run routes with bounded JSON parsing and stable safe error mapping; verify route tests cover public/protected ordering, 204 logout, conflicts, dependency failures, Work busy/unavailable, and not-found hiding.
- [x] 5.2 Implement the chunked NDJSON Run event route with cursor input, ordered complete records, terminal completion, bounded buffering, and observer-only disconnect semantics; verify a slow or disconnected HTTP observer does not cancel the Run and can reconnect from its last sequence.
- [x] 5.3 Expand `PiworkClient` with typed health/readiness, authentication, Work lifecycle, Operation, Session, Run, cancellation, and incremental event methods plus a typed safe API error; verify authenticated headers, encoded identifiers, empty responses, malformed/bounded bodies, network failures, and retry metadata.
- [x] 5.4 Replace the token-only file store with the versioned credential record and URL precedence contract, including `PIWORK_CONFIG_PATH`, XDG/HOME defaults, validation, `lstat` checks, atomic replacement, and POSIX `0700`/`0600` modes; verify save/load/clear, malformed records, permissions, and symlink refusal.

## 6. Runnable piwork CLI

- [x] 6.1 Implement a testable CLI parser/runner for global `--core` and `--json`, help, URL precedence, command groups, mutation idempotency options, wait controls, and documented exit statuses; verify parsing and usage failures without network calls.
- [x] 6.2 Implement `status`, `login`, `whoami`, and `logout` with hidden or stdin password input and the specified credential save/reuse/clear semantics; verify stdout, stderr, exit status, and absence of passwords, bearer tokens, and model secrets.
- [x] 6.3 Implement `work create/list/show/start/stop/retry/delete` and `operation show`, including default-profile creation, explicit JSON config, immediate identifier output, and bounded `--wait` polling; verify empty/populated, ready, failed, conflict, unauthorized, unavailable, and JSON cases.
- [x] 6.4 Implement `session list/show` and `run show/watch/cancel` with cursor resume and NDJSON stream output; verify a disconnected watch resumes the original Run without another submit and an expired cursor falls back to durable status/history guidance.
- [x] 6.5 Implement scripted and interactive `chat <workId>`, new or selected Session handling, stable submission keys, streamed rendering, terminal results, Ctrl-C cancellation, and recovery instructions on transport loss; verify deterministic replies, multi-turn continuation, explicit cancel, and no automatic resubmit.
- [x] 6.6 Wire `apps/cli/src/main.ts` as the installed `piwork` entrypoint with top-level safe failure handling; verify compiled subprocesses return every documented status without stack traces or secret output.

## 7. Real Product Acceptance

- [x] 7.1 Add a bounded root acceptance harness that owns temporary Core/client directories and a unique Docker installation ID, builds compiled binaries and the deterministic agent image, checks Docker prerequisites, and cleans only its own child processes and labeled Docker resources in `finally`.
- [x] 7.2 Drive compiled `piwork-core` subprocesses through bootstrap, runtime configuration by stdin, `serve --listen 127.0.0.1:0`, and readiness, then drive compiled CLI subprocesses through status, login, whoami, and `work create --wait`; verify Docker reports one managed non-root agentd container.
- [x] 7.3 Extend the harness through scripted chat and assert the expected assistant response came from a persisted real Pi SDK Run in the Docker agentd process, then verify Session and Run queries through the CLI.
- [x] 7.4 Terminate Core with `SIGTERM`, prove agentd stayed running, restart Core on the same port/data directory, reuse the saved login without `--core`, and continue the same Session; verify the database, bearer session, Work/container identity, Pi SDK history, and second reply all persist.
- [x] 7.5 Stop and restart the Work, continue the same Session once more, logout and reject the captured old token, delete the Work, and verify no managed container/network remains while retained conversation data follows policy.
- [x] 7.6 Register the Docker acceptance harness as a required root verification command and add a separate opt-in real-model smoke using the normal image and explicitly named credential environment variables; verify the default harness scrubs external model credentials and makes no non-loopback network call.

## 8. Root Cutover and Operations

- [x] 8.1 Add root `core`, `piwork`, `agent:image`, acceptance, and real-model-smoke scripts, and verify every script invokes compiled workspace artifacts with Node.js 24.
- [x] 8.2 Update README and operations documentation with exact clean-install, image build, bootstrap, runtime configuration, serve, status, login, Work creation, chat, Session continuation, Core restart, Work stop/start, logout, delete, backup, and shutdown commands; verify every command and option matches executable help.
- [x] 8.3 Document Linux Docker as the supported first runtime, explain health versus readiness, credential/data locations, retained Work data, deterministic acceptance versus real-model smoke, and the current absence of a browser Console and remote production deployment.
- [x] 8.4 Remove the entire independent `demo/` tree only after the real Docker acceptance passes, remove all live references to its commands and state, and verify `test ! -e demo` plus a repository search finds no supported demo startup path.

## 9. Final Verification

- [x] 9.1 Refresh dependencies and lockfile as needed, then run `npm run typecheck`, `npm run build`, unit tests, integration tests, and the Docker product acceptance on Node.js 24; resolve every failure and ensure required acceptance needs no external model credential.
- [x] 9.2 Run the opt-in real-model smoke when credentials are available and record it separately from deterministic acceptance so missing external credentials do not masquerade as product-test success or failure. No real-model credentials were available in this environment; the separate smoke prerequisite and explicit exit status were verified without claiming a provider call.
- [x] 9.3 Audit logs, process arguments, Docker inspection, HTTP/gRPC errors, CLI output, temporary files, and acceptance artifacts for password, bearer-token, API-key, certificate-key, and mounted-secret leakage; add focused regression coverage for every discovered exposure.
- [x] 9.4 Run `openspec validate make-core-cli-runnable --type change --strict` after task updates and verify completed checkboxes correspond to delivered runnable behavior rather than pre-existing library-only tests.
