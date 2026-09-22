# Spec Delta

## ADDED Requirements

### Requirement: Retain correlated service lifecycle diagnostics

**Identifier:** WDIAG-SERVICE-001

Service acceptance, image resolution, storage/network preparation, container start, readiness, recovery, stop and removal SHALL emit structured start and terminal outcomes with workId, serviceId, operationId when assigned, and correlationId. Accepted Operations SHALL durably retain safe error code, stage, message, retryability and remediation under the existing 64-outcome/64-KiB bounds. Preacceptance errors SHALL carry correlationId without inventing service/Operation records. Core restarts and container removal SHALL not erase retained errors. Known codes SHALL distinguish image unavailable, invalid definition, denied mount, quota exceeded, process exit, probe timeout, Docker unavailable, lifecycle supersession, and diagnostic collection failure. Arbitrary container output MUST NOT replace server-authored safe root-cause messages.

#### Scenario: Diagnose an invalid executable
- **WHEN** a service exits because its executable is absent
- **THEN** its Operation reports a safe SERVICE_EXITED or SERVICE_START_FAILED diagnostic, stage and identifiers; failure remains queryable after Core restart

#### Scenario: Separate failure from log collection
- **WHEN** readiness fails and Docker log retrieval also times out
- **THEN** the readiness error remains primary and a separate collection outcome reports unavailable

### Requirement: Read bounded application output as authorized Work content

**Identifier:** WDIAG-SERVICE-002

Service log content SHALL be a separate explicitly requested content response, not a raw tail copied into Core process logs or durable diagnostic messages. Reads SHALL select only the bound application instance for that Work/service, accept tailLines 1..200 (default 100), cap output at 64 KiB and collection at 2 seconds, never follow indefinitely, and report available/unavailable/truncated plus a safe reason. Stop preserves access while the instance exists; removed instances SHALL return unavailable rather than another instance output. Known injected credential values and control credentials SHALL be redacted; application output remains untrusted user content and MUST NOT be interpreted as Core instructions or trusted structured diagnostics. Work ownership/content authorization SHALL govern access. General safe-diagnostic restrictions continue to apply to all lifecycle errors and process logs.

#### Scenario: Inspect application traceback
- **WHEN** the Work owner or current Work agent explicitly asks for its failed service logs
- **THEN** the bounded application output is returned as content with collection status and is not copied into global Core logs

#### Scenario: Cap noisy output
- **WHEN** the service prints more than the requested lines or byte limit
- **THEN** the response is bounded and reports truncation without blocking on a live follow stream

#### Scenario: Do not substitute a sibling log source
- **WHEN** a saved service binding refers to a removed container
- **THEN** the result is unavailable, never logs from agentd, another service or another Work
