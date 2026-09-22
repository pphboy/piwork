# Tasks

## 1. Contracts and durable storage

- [x] 1.1 Define normalized deployment input, safe service/Operation views and exact validation limits in contracts; verify missing fields, default normalization, forbidden build/host/secret inputs, ports, probe combinations and immutable names with contract tests. (WSRV-001, WSRV-002, WSRV-010, WSRV-011)
- [x] 1.2 Add typed work-services.proto RPCs and regenerate checked-in grpc-js bindings; verify protobuf round trips and that request schemas contain no caller-controlled Work/runtime identity or Docker target. (WSRV-001, WACC-SERVICE-001)
- [x] 1.3 Add explicit agent resource fields and new format markers; verify fresh defaults fit an agent plus a default service, invalid totals fail, and unsupported old configuration is rejected without rewriting it. (WCFG-SERVICE-001, WSTOR-SERVICE-002)
- [x] 1.4 Extend Core storage for volume roles/layout, service runtime bindings, recovery counters and seed markers; verify structural schema setup, captured revision/image persistence, same-version reopening and old-layout failure without data reset. (WSRV-002, WSRV-003, WSRV-008, WSTOR-SERVICE-002, ADEP-001)

## 2. Persistent workspace and Docker primitives

- [x] 2.1 Add trusted container workingDirectory and agent-only control-host entry support; verify generated Docker arguments retain non-root/read-only/capability restrictions and reject model-provided privilege, aliases, host mounts and port publishing. (WSRV-010, WSRV-011, WACC-SERVICE-001)
- [x] 2.2 Implement preparation of distinct agent-private and workspace volumes, fixed bounded initialization helper, durable bindings and interrupted-helper cleanup; verify missing retained volumes fail instead of being recreated and private volume grants are rejected. (WSTOR-SERVICE-001, WSTOR-SERVICE-002)
- [x] 2.3 Mount the shared workspace at /var/data/workspace in agentd and pass that cwd to SDK Sessions/file/shell tools; verify actual SDK writes survive daemon replacement and use the workspace volume rather than the image directory. (WSTOR-SERVICE-001)
- [x] 2.4 Wire volume references and retained-data cleanup to Work/service deletion; verify removing one consumer preserves shared bytes, referenced purge conflicts, and retained volumes count once regardless of service mounts. (WSTOR-SERVICE-002, WSRV-005, WSRV-007)

## 3. Service runtime and lifecycle manager

- [x] 3.1 Implement DockerServiceRuntimeAdapter with explicit trusted Work scope, immutable image capture, desired-instance adoption, same-network DNS and permitted workspace mounts; verify real Docker creation without build/commit, no duplicate instance, captured image use after retag, and agent-private mount exclusion. (WSRV-002, WSRV-004, WSRV-010)
- [x] 3.2 Implement bounded process/TCP/HTTP/exec readiness and exact-instance stop/remove; verify process-running does not satisfy HTTP readiness, early exit has an exit code, probe timeout is bounded, and a failed stop is not reported successful. (WSRV-008, WLIFE-SERVICE-001)
- [x] 3.3 Refactor service acceptance for typed user/runtime principals, normalized idempotency, captured definition revision and Work fences; verify same-key retry across daemon replacement, changed-payload conflict and stale-revision rejection without side effects. (WSRV-001, WSRV-003, WACC-SERVICE-001)
- [x] 3.4 Implement create/update/start(enable)/stop(disable)/restart/remove/retry execution against captured targets; verify stopped Work behavior, disabled restart refusal, explicit retry, update history and data retention. (WSRV-004, WSRV-005, WSRV-006)
- [x] 3.5 Coordinate service workers with Work lifecycle admission and cancel/fence late side effects; verify stop/delete racing with create/update cannot leave a newly running container or overwrite later target status. (WSRV-003, WSRV-009)
- [x] 3.6 Implement actual-runtime reconciliation, durable recovery budget and optional/required failure handling; verify absent instances restore, unknown Docker state does not create duplicates, exhausted budget survives Core restart, and optional failures leave a routable degraded Work. (WSRV-004, WSRV-008)

## 4. Quota integration

- [x] 4.1 Reserve explicit agent resources on Work acceptance and use agent allocations for Docker limits; verify Work and host service admission includes agent reservation and rejects concurrent oversubscription transactionally. (WSRV-007, WCFG-SERVICE-001)
- [x] 4.2 Charge max(desired, occupied) per dimension and unique volume identities; verify disable/shrink/remove cannot release capacity before confirmed stop and cross-Work host limits are summed correctly. (WSRV-007)
- [x] 4.3 Validate Work budget changes and reserve candidate allocation during apply; verify an invalid reduction preserves configuration, failed apply retains correct prior/uncertain occupation, and customized default resources survive restart. (WCFG-SERVICE-001)

## 5. Core control transport and production wiring

- [x] 5.1 Add reverse-direction server/client certificate roles and per-instance runtime authorization using TLS peer identity; verify untrusted, wrong-role, spoofed-Work, stale-instance and initialization-only mutations are refused before persistence/Docker. (WACC-SERVICE-001)
- [x] 5.2 Add Core gRPC listener lifecycle, listen/advertise CLI/environment settings and private agent control configuration; verify an actual agent-network client reaches the authenticated server, binding failure is explicit, and secrets stay outside workspace and logs. (WSRV-001, WACC-SERVICE-001)
- [x] 5.3 Implement all gRPC handlers with typed projections, deadlines and service-only Operation scope; verify caller self-management, cross-Work service/Operation IDs, malformed requests and quota/conflict error mappings. (WSRV-001, WACC-SERVICE-001, WACC-SERVICE-002)
- [x] 5.4 Instantiate one production service manager/runtime and attach protected owner HTTP routes using the same domain logic; verify production Core create/list/get/update/actions/history/operation routes, owner isolation and non-owner admin control without log content. (WSRV-001, WACC-SERVICE-002)
- [x] 5.5 Integrate services into every Work create/start/adoption/delete path; verify an existing stopped agent container does not skip service restoration and agent-only replacement leaves a healthy application unchanged. (WSRV-004, WLIFE-SERVICE-002)
- [x] 5.6 Implement unconditional service shutdown, independent cleanup after drain failure, Core admission closure and the 45-second process bound; verify missing-agent orphan cleanup, no clean exit with unresolved containers, and restoration of desired-running Works only. (WSRV-009, WLIFE-SERVICE-001, WLIFE-SERVICE-002)

## 6. Service diagnostics and application logs

- [x] 6.1 Extend durable safe diagnostics with service identity/stages and primary-versus-cleanup/collection outcomes; verify invalid image, early exit, readiness failure, storage denial and persistence failure retain safe correlated causes after restart/removal. (WDIAG-SERVICE-001)
- [x] 6.2 Implement exact-bound-container log collection and authorized HTTP/gRPC reads with line/byte/time limits, known-secret redaction and separate application-content responses; verify stdout/stderr coverage, truncation, collection timeout, removal and cross-owner/admin denials. (WDIAG-SERVICE-002, WACC-SERVICE-002)

## 7. MCP adapter and real SDK tools

- [x] 7.1 Create the service-mcp workspace app with the 12 exact MCP schemas and gRPC mapping, reading only the fixed private control configuration; verify actual stdio discovery/calls, no Work/Docker identity parameters, protocol-clean stdout and structured errors. (MCP-SERVICE-001, MCP-SERVICE-002)
- [x] 7.2 Package the adapter and its dependencies in both compatible agent image variants; verify the installed executable works without repository cwd and is absent from service containers/volumes. (MCP-SERVICE-001, WACC-SERVICE-001)
- [x] 7.3 Wire active-context MCP initialization into agentd and discovered tools into SDK customTools for new/restored Sessions; verify actual SDK tool invocations traverse MCP, allow/deny is enforced, omitted profile removes tools, and no native direct service bypass remains. (MCP-SERVICE-001)
- [x] 7.4 Extend context/readiness verification with actual registered MCP tools and initialization outcomes, and bump the contract version; verify required adapter failure has an MCP-stage diagnostic and old agent images cannot report deployment-ready. (MCP-SERVICE-001, WDIAG-SERVICE-001)
- [x] 7.5 Implement adapter/bridge cleanup and bounded reconnect without mutation replay; verify slow image preparation returns durable acceptance, lost replies recover with the same key, and apply/drain/shutdown reaps child processes within five seconds. (MCP-SERVICE-002)

## 8. Bundled Skill and fresh defaults

- [x] 8.1 Author skills/deploy-work-service with SKILL.md, deployment reference and Python stdlib HTTP example; verify SDK loading and review coverage of persistent code/data, dependencies, startup binding, idempotency, operation/log inspection and endpoint verification. (ADEP-001, ADEP-002)
- [x] 8.2 Package Skill assets with Core and seed the managed catalog/default selection once with durable markers; verify fresh defaults include Skill/MCP, interrupted seeding is recoverable, and operator update/disable/remove/empty-default choices are preserved. (ADEP-001, MCP-SERVICE-001, WCFG-SERVICE-001)
- [x] 8.3 Preserve ordinary Skill snapshots and explicit overrides; verify default Work runtime reports the loaded deployment Skill from its own directory, --no-skills excludes it, and managed Skill updates need no agent image rebuild or mutation of existing Works. (ADEP-001)

## 9. End-to-end acceptance and documentation

- [x] 9.1 Add deterministic deployment model behavior that consumes the actual Skill/tool schemas and writes/reads the Python app through SDK tools; verify tool traces prove real MCP/gRPC execution rather than a direct mocked manager call or hardcoded success. (ADEP-002, ADEP-003)
- [x] 9.2 Add Docker acceptance for default Work -> service create -> HTTP access from agentd -> persistent counter -> Work stop/start -> graceful Core restart -> service replacement; verify stable service/image/storage identities, restored data, same network, no host ports and no application image build/commit. (ADEP-003, WSRV-004, WSRV-010, WLIFE-SERVICE-002)
- [x] 9.3 Add integration coverage for default overrides/tool deny, missing or invalid service dependencies, self/cross-Work/stale-identity rejection, create-stop races, missing agentd and missing workspace; verify explicit diagnostics and no unauthorized resource mutations. (WACC-SERVICE-001, WSTOR-SERVICE-001, WSRV-009, MCP-SERVICE-001, WDIAG-SERVICE-001)
- [x] 9.4 Update existing Skill acceptance/test fixtures for fresh defaults, two volumes, explicit agent allocation and readiness version; verify existing Skill snapshot, config apply and conversation recovery assertions still hold. (ADEP-001, WCFG-SERVICE-001, WSTOR-SERVICE-002)
- [x] 9.5 Update README with startup control endpoint settings, default Skill/MCP behavior, the Python deployment demo, persistent directory rules, service stop versus Work stop, operation/log troubleshooting and pre-0.1 no-migration behavior; verify commands and fields match implemented help/contracts. (ADEP-002, WSRV-001, WDIAG-SERVICE-002)
- [x] 9.6 Run npm run typecheck, npm run build, npm test, npm run test:integration, npm run acceptance, openspec validate enable-agent-managed-work-services --strict and git diff --check; verify all required gates pass and all test-owned Core processes/containers/networks/volumes are cleaned on success and failure. (ADEP-003; all delta requirements)
- [x] 9.7 Project canonical dotted MCP names to provider-compatible SDK identifiers while preserving canonical policy/readiness and MCP routing; surface safe terminal Run failures in chat, then verify a real configured provider accepts a message instead of silently exiting. (MCP-SERVICE-001, ADEP-002)
