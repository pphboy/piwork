# Design

## Context

See proposal.md for the intended user outcome and scope. The relevant baseline is commit `95316f7`:

- `WorkServiceManagementService` persists service definitions and Operations, but production `CoreApplication` does not construct it. `WorkLifecycleService` defaults to `NO_SERVICES`. The standalone HTTP router and service tests are not evidence that production deployment works.
- `ServiceRuntimeAdapter.start/stop/remove` only receive a definition, which lacks Work identity. A real adapter must receive explicit trusted Work scope. Current optional `waitReady` can otherwise produce false success.
- `ensureRunning` only prepares services when agentd is absent; `ensureStopped` only stops services when agentd is running. Both are incomplete for restoration and orphaned service cleanup.
- `DockerRuntime` already labels agent versus service resources, verifies network/volume ownership, and creates non-root containers with read-only root filesystems and no published ports. It lacks a production service adapter and explicit container working-directory/host-control-route configuration.
- `agent.proto` exposes Core-to-agent conversation RPCs. Core has no agent-to-Core service RPC listener. Existing TLS identities have different client/server purposes and cannot simply be reused in reverse.
- `McpBridge` and native `createServiceTools` are not used by `PiSdkRunExecutor`. The installed SDK supports `customTools`; deployment must use actual MCP discovery/invocation through that hook. Native service tools will be removed from the active path to avoid two authorities.
- Agent private data and workspace currently share `work-data` at `/var/data`; Session management uses `/var/data/workspace`, but executor `cwd` is `process.cwd()` and the Docker image starts at `/workspace`. Default maxServices is zero; the whole Work resource budget is passed to the agent container.
- Existing specs require service definition history, idempotency, quotas and recovery. The lifecycle spec's historical Core-exit wording conflicts with the user's prior graceful-shutdown decision; this delta explicitly corrects it. Work configuration revisions remain private; service definition revisions remain public optimistic-concurrency fields.

## Goals / Non-Goals

**Goals:** Make the existing Service abstraction the one durable deployment owner, prove the actual SDK/MCP/gRPC/Docker route, enforce runtime identity in Core, and make storage and shutdown behavior independently observable. Requirements are identified as WSRV, WACC-SERVICE, WSTOR-SERVICE, WLIFE-SERVICE, MCP-SERVICE, WCFG-SERVICE, WDIAG-SERVICE and ADEP in the delta specs.

**Non-Goals:** No application image building, Dockerfile endpoint, container commit, arbitrary Docker API passthrough, interactive exec tool, host ingress, new Console frontend, user secret provisioning system, cross-Work storage, source-code rollback, or old-data migration. The first service API rejects nonempty `secretRefs`; plain environment values are application configuration and must not be used for Core/model/control credentials. Internal exec for an explicitly declared readiness probe is allowed and is not a public container shell API.

## Decisions

### 1. Reuse Service as the durable entity; containers are replaceable instances

Keep the existing tables and manager as the domain foundation. Add `DockerServiceRuntimeAdapter` under Core runtime and inject the same manager into production HTTP, gRPC and Work lifecycle orchestration. Its methods receive `(workId, capturedServiceRevision, operationContext)`; no runtime adapter infers ownership from untrusted definition fields.

Creation/update acceptance is a short transaction that checks authorization, Work admission, schema, revision, name and all quota changes, then writes definition, Operation, idempotency result and storage references. Docker work begins only after commit. All mutation paths use this transaction; HTTP and gRPC do not each implement business rules.

Use a typed `ServicePrincipal` discriminated union for an authenticated owner/admin or authenticated Work runtime. Runtime authorization occurs both at the RPC boundary and in domain acceptance, with no conversion to a synthetic owner credential. Idempotency principal key for daemon requests is `work-agent:<workId>`; replacing the daemon changes authorization, not the key scope. User keys retain their existing user scope. No new key is generated automatically when a response is uncertain.

Operations capture `serviceId`, service revision, action, and Work control fence in durable request data. Workers execute the captured revision, not `service_heads.definition_json` at some later time. Within one Work, serialize destructive reconcile steps and coordinate them with Work lifecycle admission. Acceptance remains transactional and quick while a worker waits for Docker. Every await before publishing state is followed by target/fence revalidation. A stale worker cleans up any obsolete instance it created and becomes `superseded`; it cannot set a later revision ready or failed.

Production owner HTTP routes retain `/api/v1/works/:workId/services`: GET list, POST create; `/:serviceId` GET inspect and PUT update; `/:serviceId/revisions` GET retained definition history; `/:serviceId/{restart,enable,disable,remove,retry}` POST mutation; `/:serviceId/logs?tailLines=N` GET application content. Reuse `/api/v1/operations/:operationId` for owner service Operations. HTTP create/update/action bodies use the same definition, expectedRevision and idempotencyKey fields as the domain; successful reads are 200 and durable acceptance is 202. Runtime gRPC never accepts user/owner tokens. Return 400 for invalid fields, 401 for missing login, 404 for absent/cross-owner targets, 403 for admin content reads, 409 for revision/key/precondition conflicts, 429 for quota, and 503 for unavailable dependencies. No new CLI service command family is required; README demos use agent chat/MCP and existing operation show.

Alternative rejected: a generic container proxy that accepts Docker IDs. It would bypass durable desired state, restart behavior and resource-kind checks.

### 2. Core-hosted reverse gRPC and explicit runtime credentials

Add `packages/contracts/proto/work-services.proto` with package `piwork.core.services.v1` and generated grpc-js types, using the existing generator toolchain. Core owns the server; `apps/service-mcp` owns the client.

| RPC | Request | Result |
| --- | --- | --- |
| GetDeploymentContext | empty | workspacePath, writable capability, current Work lifecycle, resource totals/agent allocations/available headroom, service defaults, API version |
| CreateService | definition, idempotencyKey | acceptance envelope |
| ListServices | empty | service views ordered by name then id |
| GetService | serviceId | service view |
| UpdateService | serviceId, expectedRevision, definition, idempotencyKey | acceptance envelope |
| StartService / StopService | serviceId, idempotencyKey | acceptance envelope, domain enable/disable |
| RestartService / RetryService | serviceId, idempotencyKey | acceptance envelope |
| RemoveService | serviceId, idempotencyKey | acceptance envelope, retain data |
| GetOperation | operationId | scoped service Operation envelope |
| ReadServiceLogs | serviceId, tailLines | collection status, text, safe reason, timestamp |

Define explicit protobuf messages, not an opaque JSON request. Do not put workId, generation, instanceId, Docker IDs, TLS options or host paths in model-supplied fields. Responses may include the public Work ID for correlation. Service views contain definition, desiredRevision, appliedRevision, enabled, observedState, endpoints, readiness kind, safe lastError and timestamps; never return Docker inspect, immutable image IDs, raw persistence rows or credentials. Operation views extend the existing safe projection with serviceId and reuse diagnostics bounds.

Use a separate TLS listener. Defaults: `--agent-grpc-listen 0.0.0.0:7172`, `--agent-grpc-advertise piwork-core:7172`, with matching `PIWORK_AGENT_GRPC_LISTEN` and `PIWORK_AGENT_GRPC_ADVERTISE` environment variables and normal explicit/env-file precedence. The existing public HTTP listen address and plaintext guard do not change. Binding failures fail Core startup, not a silent optional feature. Port 0 is test-only with the resolved port injected into fresh runtime configs; normal restart uses a stable advertised endpoint.

For the local Linux Docker deployment targeted by this change, add a Core-authored `piwork-core:host-gateway` host entry only to agentd. Docker adapters accept this through a narrow trusted option rather than model-supplied extra hosts. The gRPC server certificate identifies the advertised DNS name. Issue a distinct clientAuth certificate with signed identity containing installation/work/generation/instance/role=agent-service-client; install only this leaf key/cert and CA in agentd. Do not mount the CA private key, operator token, or Core's agent-server client key. Existing Core-to-agent TLS roles remain separate. The server reads `call.getAuthContext().sslPeerCertificate` (available in the installed grpc-js types), verifies its signed role/identity and validity, and checks persisted active generation and instance on every call; a trusted certificate alone is insufficient.

Register the new candidate identity before launching it, but keep service mutation authority closed until Work activation. Local MCP discovery does not make a gRPC mutation and therefore cannot deadlock candidate readiness. Draining, stopped, failed, stale or initialization-only instances have no service mutation authority. Core recovery keeps this gate closed until actual daemon verification; already accepted service Operations can be reconciled by Core without a live agent. Revoke old instance authority before replacement becomes active.

Code mappings: invalid/unsupported request -> INVALID_ARGUMENT with safe field code; missing/foreign service -> NOT_FOUND; missing/untrusted credential -> UNAUTHENTICATED; authenticated stale/inactive runtime -> FAILED_PRECONDITION; quota -> RESOURCE_EXHAUSTED; idempotency/revision conflict -> ABORTED; dependency -> UNAVAILABLE. Safe error detail includes code, field if public, remediation and correlationId. No request parameter can override the authenticated scope. Request payloads are limited to 1 MiB, unary metadata/read deadlines default to 5 seconds, mutation acceptance to 10 seconds, log retrieval to 2 seconds. RPC handlers do not hold the call open through container startup.

Alternative rejected: mounting the Docker socket or forwarding an owner token into agentd. Neither provides the requested narrow same-Work application-service authority.

### 3. Define the executable deployment input and private endpoints

Replace the pre-release service image catalog input with `image: { reference: string }`. Allow local image names, registry tag references, and explicit digest references accepted by Docker; reject embedded registry credentials and URL schemes. Image selection does not use the agent image catalog. Use the host Docker daemon's existing registry configuration; adding a credential management product is outside scope.

Canonical service definition input:

| Field | Contract/default |
| --- | --- |
| name | required, `[a-z][a-z0-9-]{0,47}`, immutable after create |
| image.reference | required, nonempty, <=2048 bytes; tag/name or digest, no credentials |
| command | required executable string <=4096 bytes; no implicit shell |
| args | default [], <=128 strings each <=4096 bytes |
| environment | default {}, <=128 environment-name keys, values <=16384 bytes, total request <=1 MiB |
| secretRefs | default []; nonempty -> UNSUPPORTED_SERVICE_OPTION in this version |
| workingDirectory | default `/var/data/workspace`; normalized absolute path at/below workspace |
| mounts | default []; sole supported entry `{source: "workspace", target: "/var/data/workspace", readOnly: boolean}`; zero or one entry |
| ports | default [], <=64 unique names and (protocol, port) pairs; port 1..65535; tcp/udp; arbitrary aliases rejected |
| cpuMillis / memoryBytes | defaults 250 / 134217728; existing minimum 10 / 16777216, CPU max128000 |
| enabled / required | defaults true / false |
| readiness | optional tcp/http/exec; deadlineMs default120000, range1000..300000; per-probe timeoutMs default2000, range1..2000 |
| restartPolicy | default bounded; never or bounded |

HTTP/TCP probes reference a declared TCP port; HTTP has a normalized path beginning `/` and accepts only status 200..299. Exec has an explicit nonempty argv, exit 0 indicates success. Reject missing kind-specific fields and irrelevant combinations. Poll at 500 ms until the total monotonic deadline, clipping individual timeouts to remaining time. No readiness probe means process readiness only. Readiness/working-directory paths reject traversal, NUL and noncanonical path forms. A workspace workingDirectory requires an explicit workspace mount; this keeps the sharing grant explicit. A mount-free service supplies `/` as workingDirectory (the only allowed non-workspace directory), enabling image-native executables without granting arbitrary host paths. Unknown fields and duplicate mounts/names are errors before acceptance.

`DockerServiceRuntimeAdapter` resolves the image then atomically records its immutable ID in the service revision before creating the container. For a captured explicit digest, Docker can fetch that same digest if necessary; for an unavailable captured local ID, fail IMAGE_UNAVAILABLE rather than re-resolving a tag. An update that retains the same image reference carries forward the captured identity; explicitly choosing a different reference/digest starts a new resolution. First resolution failure leaves the accepted definition failed and retryable. Retain tombstone names so create of the same removed name returns CONFLICT; choose a new name rather than silently resurrecting an old service identity.

Extend `DockerContainerSpec` with trusted `workingDirectory` and the narrow agent control host entry. Services use resource kind `service`, logicalId=serviceId, immutable image, explicit entrypoint=command plus args, UID/GID `10001:10001`, read-only rootfs, dropped capabilities, existing PID limits and writable tmpfs `/tmp`. Do not treat arbitrary service labels, host mounts, users or privileges as pass-through options. Inject only explicitly supplied plain environment, never host/Core environment wholesale.

Attach the existing Work network and alias `svc-<name>`; do not create per-service networks or publish ports. Endpoints are derived from declared ports and alias (protocol/host/port, and http URL only for an HTTP probe), not from container IP. Probe the exact bound container from Core using its inspected address or bounded Docker exec for an exec probe. Application-side HTTP verification is separately performed from agentd; endpoint existence alone never counts as success.

Image inspection/registry preparation has a 120-second bound and reports IMAGE_UNAVAILABLE on failure; start/stop/remove commands have a 10-second bound. Container lookup/adoption checks installation, Work, kind, logical ID, desired spec hash and image identity. A different revision is stopped and removed before replacement, with no overlapping application writers.

Alternative rejected: build/commit a bespoke image on each deployment. The user explicitly selected existing runtime images and workspace deployment. Runtime dependency installation uses declared commands, pinned manifests and workspace venv/dependency directories; no implicit `pip` or `npm` step is invented by Core.

### 4. Separate shared workspace from agent-private storage

Use two managed named volumes per fresh Work:

| Logical volume | agentd mount | service mount |
| --- | --- | --- |
| work-data | `/var/data` | forbidden |
| work-workspace | `/var/data/workspace` | exactly that path when explicitly granted |

The parent contains work.sqlite, sessions and agent state; the child volume contains application code/data only. TLS/config/model secrets remain separate protected runtime binds and never enter the shared volume. Docker volume records gain a persisted role (`agent-private` or `workspace`) and layoutVersion=2. Ownership alone does not authorize mounting an agent-private volume. Services do not select volume IDs or host paths; Core resolves the logical workspace grant from trusted Work bindings.

Build the compatible agent runtime software image with these two empty directories owned by 10001:10001. Before any service starts, Work infrastructure preparation creates/validates and initializes the fresh volumes with the compatible prebuilt agent image through a fixed Core-authored non-root helper command, mounts only these Work volumes, and verifies read/write access and layout markers. This helper uses a distinct Core-only `workspace-init` resource kind and deterministic per-Work logical identity, exposes no model-controlled command, uses at most the reserved agent allocation while agentd is absent, has a 10-second bound, and is removed on completion/failure. Recovery inspects/removes a matching interrupted helper before retrying initialization; service APIs can never target this resource kind. Do not recursively chown existing data or copy image application files into the workspace. Record fresh initialization durably; after initial binding a missing volume is failure, not permission to recreate an empty one.

Pass the canonical workspace to `PiSdkRunExecutor` as cwd instead of process.cwd(); every Session and SDK built-in file/shell tool uses it. Keep the image program installation at `/workspace` and absolute entrypoint path; executable code installation need not be the user's working directory. Restore Sessions against the same workspace path.

Shared UID/GID permits editable application files. Read-only grants apply at the container mount. All services granted read-write workspace access share that Work trust domain; per-service filesystem isolation within one Work is not promised. Skill instructions use `apps/<name>` for code and `data/<name>` for business data to avoid accidental conflicts. File mutations are immediately visible; this change does not create immutable source releases. The agent should finish writing before restart/update and avoid modifying live shared code unintentionally.

Retained-volume accounting counts unique volume IDs once, not each consumer. Maintain a Work reference plus service references transactionally, remove only service references on removal, and retain both volumes on Work deletion unless an owner explicitly requests a permitted purge. Agent remove never purges files. Existing owner retained-volume APIs remain the only purge route.

Alternative rejected: share all of `/var/data`, which exposes Session history and agent-private state; alternative rejected: code upload/copy per deployment, which breaks the requested common file view.

### 5. Lifecycle, reconciliation and shutdown must include services on every branch

Refactor Work orchestration into infrastructure preparation, service reconciliation and daemon initialization/verification. Network and volume preparation must precede both service and daemon creation, including restoration of existing containers. Do not start an agent merely to make service preparation possible.

Every desired-running reconcile (fresh start, stopped instance restart, matching running adoption and Core restart) inspects enabled services. Required services must pass readiness before Work conversation readiness; optional failures record per-service errors and Work degraded while leaving agent repair access. Make degraded Works routable whenever their current daemon is verified; failed optional applications must not block their own repair tools. Check all remaining optional services after one fails. A required failure stops readiness promotion but leaves durable service failure details accessible through owner control APIs.

Stop sequence: close mutation admission atomically with target acceptance; mark routing/draining; allow bounded Run drain including up to five seconds reserved for local MCP cleanup; cancel remaining execution; stop/reap local MCP; reconcile and stop every Work service, including late-created instances; stop agentd; inspect all owned agent/service instances before declaring stopped. Drain or one-container stop failure is collected while other stop attempts continue. The service step is unconditional, not nested under agent existence. Delete adds service tombstones/removal then agent/network removal, releasing references and retaining storage. Network removal occurs only after all instances are confirmed gone.

Service disable preserves definition but sets enabled=false; Work stop preserves each enabled flag. Restart is legal only for enabled service on a running Work; explicit retry resets the exhausted recovery allowance for that service and targets its current revision. Disabled/deleted service retry returns FAILED_PRECONDITION. Recovery never converts deliberate disable into enabled.

Maintain a Core-owned service reconciliation loop (2-second interval, no overlapping scan for one Work). Inspect real runtime, execute pending Operations and restore lost enabled instances. Use a `service_recovery` table keyed by (work_id, service_id) with failure_window_start, attempts, next_attempt_at and ready_since, plus a service runtime binding containing the exact container ID and applied revision. Persist an exhausted state until ten ready minutes or explicit retry; elapsed wall time alone does not reset a failed service budget. Defaults are three retries per ten minutes at 1/5/15 seconds, resetting only after ten uninterrupted ready minutes; the backoff schedule is the earliest permitted retry, with loop scheduling adding at most two seconds. For restartPolicy=never, record failure and do not restart automatically. Distinguish Docker unavailable/unknown from confirmed absence; never create another instance when presence is unknown. Required versus optional status is propagated to Work without falsifying the agent readiness evidence.

Core shutdown closes both HTTP and gRPC mutation gates and pauses background retries before draining Works. Keep queries available while drain is underway; accepted Operations finish or retain recoverable state. Each Work has a 30-second drain budget then a 10-second termination/confirmation budget shared by parallel container stops, rather than ten seconds multiplied by service count. Core's process-level timeout currently at 10 seconds must become 45 seconds; timeout yields a nonzero exit and safe summary, never clean shutdown. Concurrent Work shutdowns share the same global bound. Restart keeps desired=running for previously running Works and restores enabled services. Abrupt termination leaves intent for adoption and records interrupted stages upon recovery.

Alternative rejected: tie application container lifespan to the agent process. A conversation daemon replacement must not force recreation of a healthy application; Core is the owner.

### 6. Resource budgeting and safe configuration apply

Extend ResourcePolicy with required `agentCpuMillis` and `agentMemoryBytes` in the new format. Existing total `cpuMillis`/`memoryBytes` remain Work aggregate limits. Fresh values are specified in WCFG-SERVICE-001; they fit an agent plus four default-sized services. Container limits for agentd use its allocation, not total Work budget. Work create reserves the agent; all nondeleted definitions count toward service slots, including disabled definitions. Two persistent volumes consume two slots; mounting them multiple times consumes no additional slots.

For resource dimension R, charged service usage is max(desired reservation R, not-yet-released occupation R). Charge desired agent allocation and retained actual allocation similarly during replacement. Host accounting sums all Work rows atomically. Disable/remove/shrink cannot release occupied resources until the runtime confirms release. A stopped Work retains configured desired budget, but its occupation becomes zero. Existing quota tests need production agent reservations rather than implicitly starting from zero.

Validate desired Work configuration reductions against all retained service reservations; apply rechecks and atomically reserves the candidate agent allocation. Success commits the new allocation; failure restores/reconciles the old one and retains any uncertain occupation. No broad rewrite of unrelated configuration fields or automatic resizing of existing services occurs.

### 7. MCP adapter and SDK integration

Add workspace app `@piwork/service-mcp` with a stdio entrypoint installed in the compatible agent image at `/usr/local/bin/piwork-service-mcp`. It reads a fixed private config path `/etc/piwork/service-control.json` containing Core endpoint and mounted client certificate paths. Model arguments cannot override those. Package/import the existing MCP SDK and grpc-js; do not invoke a shell or Docker CLI from the adapter.

Default MCP selection is `{serverId:"work-services", transport:"stdio", command:"/usr/local/bin/piwork-service-mcp", args:[], required:true, timeoutMs:30000}`. For this serverId reject arbitrary command/args, URL, credentials or a requiredServiceId; it is the Core-controlled adapter profile and cannot depend on a service that needs the adapter to be created. Work-level explicit omission disables registration. Credentials are mounted only when the profile is selected.

Map the 12 MCP tools from MCP-SERVICE-002 one-to-one to the RPCs above; use TypeBox-derived exact input schemas, no loose `Record<string, unknown>` definitions. Keep `work-services.<tool>` as the canonical routing, policy, and readiness namespace. Model APIs reject dots in tool identifiers, so register SDK `customTools` through a deterministic provider-safe projection `work-services__<tool>` (allowed characters only, maximum 64 characters, hash-suffixed when truncated) and close over the canonical name for MCP dispatch. Detect projection collisions before readiness. Export the actual discovered schemas/results through these SDK tools; keep `tools` for the built-ins. Filter both discovered canonical MCP names and built-ins using active allowed/denied policy, with denied winning. WorkContext materialization currently resolves built-ins only, so add MCP profile materialization, discovery and effective canonical tool reporting rather than relying on a config echo. Runtime readiness must report the actually registered permitted canonical tool names and selected MCP initialization outcomes; Core verifies these against the captured profile and policy before routing. Bump the internal context contract version for this change so an old image cannot claim deployment readiness.

Own one bridge per agentd process and inject the same live registry into newly constructed/restored Sessions. The adapter can list static schemas without calling Core; authorization is evaluated for each actual RPC. This avoids the initialization/activation cycle. Required spawn/discovery failure blocks readiness with an MCP-specific stage; do not catch every initialization error as skill-load. Losing Core later yields tool UNAVAILABLE, with no automatic mutation replay. Local adapter loss marks its tools unavailable; bounded reconnection rediscovers the same schema and never retries a mutation with a new key. Serialize replacement of a failed bridge and clean up all old clients before reconnecting. Adapter stdout is protocol only, stderr uses safe stage diagnostics; apply/drain/shutdown closes bridge and reaps subprocess within five seconds, then kills it if necessary.

The unused native `service-tools.ts` must not become a parallel production path. Remove it or replace its exports with the shared MCP schema mapping without importing Core or bypassing transport. Add production-path tests rather than only testing the adapter in isolation.

### 8. Ship a normal managed Skill and seed defaults once

Create `skills/deploy-work-service/SKILL.md` plus a small Python HTTP example and deployment reference. Package these assets with Core (copy into its distributable assets in the build); load by module-relative location so installed execution does not depend on repository cwd. Do not bake Skill bytes into agentd as implicit fallback content.

First-install seeding uses the normal artifact importer and one durable `bundled_deployment_seed_v1` marker. Persist the imported catalog identity/seed atomically before attempting default creation; persist an initial-defaults marker atomically with the first default configuration. If model setup is not yet available, defer only default creation and resume it on runtime configuration; never treat a present configuration containing empty arrays as uninitialized. Before Work defaults are created, stage/validate the bundled tree, then atomically publish catalog identity and seed marker; initialize new defaults with that Skill and MCP profile. A crash leaves either no committed seed or the complete artifact/catalog/marker; orphan cleanup handles abandoned staging. A conflicting preexisting same-name managed Skill is never overwritten: use it if enabled when explicitly creating defaults, otherwise report a safe seed conflict and leave operator data unchanged. Nonempty existing defaults are preserved, and a persisted seed marker prevents resurrection after operator disable/remove or explicit empty defaults. An image/runtime profile change must continue preserving operator Skill/MCP selections.

Skill content follows ADEP-002: request deployment context, write under the discovered persistent directory, avoid credentials in source/environment, deploy an existing image with explicit mount/working directory, use a pinned dependency manifest if needed, wait by Operation polling, inspect service/logs on failure, then verify the returned HTTP endpoint from agentd. Deploy source can use Python stdlib for the minimal example, avoiding dependency downloads entirely. Include separate instructions for read-only static code and read-write application data (the single workspace mount must be writable if any business data under it is written). Use a workspace venv for Python third-party dependencies and rerun declared setup reproducibly on replacement.

Default selection is a starting default, not hidden mandatory injection: explicit Skill names or --no-skills override it; mcpServers [] removes tools separately. An existing Work can select/apply current bundled Skill and MCP through ordinary configuration. Source and supporting files arrive in its immutable Work context and must pass the existing SDK path/identity validation. Operator updates to the managed Skill require no agent image rebuild; introducing the adapter executable does require one compatible runtime software image update.

### 9. Diagnostics versus application log content

Extend the existing safe diagnostic model with serviceId and explicit stages `service-accept`, `service-image`, `service-storage`, `service-start`, `service-readiness`, `service-recovery`, `service-stop`, and `service-remove`. Keep correlation IDs, fixed codes/remediation, 64 retained stage outcomes and 64 KiB total. Codes include INVALID_SERVICE_DEFINITION, UNSUPPORTED_SERVICE_OPTION, IMAGE_UNAVAILABLE, MOUNT_DENIED, QUOTA_EXCEEDED, SERVICE_START_FAILED, SERVICE_EXITED, SERVICE_READINESS_TIMEOUT, DOCKER_UNAVAILABLE and OPERATION_SUPERSEDED. Map only allowlisted Docker errors; never persist an arbitrary exception/raw container output as the public message. Preserve primary failure independently of cleanup and log collection; failure to persist diagnostics emits DIAGNOSTIC_PERSIST_FAILED as before.

Application logs are a distinct Work content endpoint, authorized for the owner/current agent and denied to a non-owner admin. Read only the bound service container, cap 200 lines/64 KiB/2 seconds, merge stdout and stderr, report unavailable after removal, and signal truncation. Remove known injected control/credential values using the existing secret inventory; the service receives no Core/model secret in the first place. Arbitrary application-generated text cannot be guaranteed free of user secrets; it stays explicit private content and is never forwarded into operator/global diagnostics or treated as authoritative failure metadata. Document this boundary rather than promising universal content redaction. Never use an unvalidated structured message in application stdout to impersonate a Core event.

### 10. Verification and concrete demo

Add `scripts/work-services-acceptance.mjs` and include it in `npm run acceptance`, reusing the existing deterministic provider technique. Build the compatible agent software image before deployment testing and obtain a configured existing Python image (`PIWORK_SERVICE_TEST_IMAGE`, default `python:3.12-slim`); record its resolved ID. Do not run docker build/commit during service deployment phases. This is separate from the existing Skill acceptance's intentional image-retag test.

The deterministic provider must observe the real system prompt Skill location and real discovered MCP tool definitions. It requests SDK reads of SKILL.md/reference, SDK write of `apps/demo/server.py`, then the actual `work-services.service_create` with an HTTP probe and writable workspace. The Python app uses stdlib, binds 0.0.0.0:8000, serves `/health`, and exposes a counter whose JSON lives in `data/demo/counter.json`; its startup creates only that app's data directory. Assert trace evidence from SDK tool start/end, MCP, gRPC and durable Operation, not just final text. From agentd use its Node HTTP client through SDK bash to check `http://svc-demo:8000/health` and the counter; agentd need not contain Python or curl.

Then stop/start Work and gracefully stop/start Core. Query persisted service definitions and verify unchanged service ID, image identity, mount identities and counter bytes before another application write. Use agentd execution/SDK tools to access the endpoint again; no service_create replay is permitted. Replace the service container and verify files again. Inspect no port bindings, same Work network, correct service resource kind and no private mounts.

Negative acceptance/integration covers explicit no-Skills, omitted MCP, tool deny, invalid image/command/HTTP readiness, log collection failure, spoofed Work/runtime, missing credentials, stale generation, agentd self-target, cross-Work service/operation/log reads, workload stop during create, missing agentd with live services, missing retained workspace, and daemon replacement without healthy-service restart. Unit tests cover validation, transactional quota/revision/idempotency, seed interruption, recovery budget and supersession. Gate with typecheck, build, unit tests, Docker integration, full acceptance, strict OpenSpec validation and diff checks. Optional real-provider smoke remains optional.

## Risks / Trade-offs

- Shared workspace mutation can affect a live application -> document live-file semantics; provide explicit update/restart, preserve business data, and use separate app directories. No false claim of source or data rollback.
- Host control address may be unreachable under nonstandard Docker routing -> expose listen/advertise options, test the local Linux path, report explicit tool connectivity errors; never put a loopback-only endpoint in container config.
- Required MCP startup can prevent Work readiness -> static local discovery avoids a service-creation dependency cycle; failures identify the MCP stage. Ordinary optional application failure leaves the agent repair path.
- Two volumes and explicit allocations change pre-release persistence -> new format markers and fail-closed old-layout checks; no automatic migration/reset.
- Stop races with image pull or late Docker completion -> durable target fences, bounded workers and final resource inspection; no clean shutdown until stopped is confirmed.
- Adapter/software packaging increases image contents -> normal compatible software release once; Skill and application deployment remain data-driven and require no application image build.

## Migration Plan

No historical user-data migration. Implement new database columns/tables through the project's structural schema mechanism, but do not rewrite old Work contexts, split old volumes, or fabricate missing service image identities. Mark new workspace/config/service formats explicitly and return CONTEXT_FORMAT_UNSUPPORTED or SERVICE_FORMAT_UNSUPPORTED for incompatible stored data with remediation to create a new Work on this pre-0.1 version; preserve the old records/volumes for explicit owner cleanup.

Deployment order is contracts and storage, Core service runtime/control server, compatible agent image containing adapter, bundled Skill/default seeding, then new Work creation. Old agent images must fail context compatibility verification rather than appear to have deployment tools. Rollback stops managed services and restores the previous software with its matching data backup, or uses a separate data directory; no downgrade/reset of current data is automatic. Application recovery is an explicit service update/retry and never a database/data rollback.
